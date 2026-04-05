import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { FieldValue } from "../../infra/config/firebase";
import { geminiFallbackRateCol, productDoc } from "../../infra/firestore/duduPaths";
import { last4Digits } from "../whatsapp/validators";
import { getTraceContext } from "../whatsapp/traceContext";
import { z } from "zod";
import { callGemini } from "../../infra/ai/gemini";

export const GEMINI_FALLBACK_ENABLED = (() => {
  const raw = String(process.env.GEMINI_FALLBACK_ENABLED ?? "true").toLowerCase();
  return ["1", "true", "yes"].includes(raw);
})();

const GEMINI_SYSTEM_PROMPT =
  "Você é um classificador de intenções para um bot de WhatsApp. Responda SOMENTE com JSON válido, sem markdown, sem explicações, sem texto adicional.\n" +
  "Siga ESTRITAMENTE o schema fornecido. Não invente ações fora da allowlist.\n" +
  "Se estiver em dúvida, use action='unknown', confidence baixa, e proponha uma pergunta curta em 'clarifying_question'.\n" +
  "Nunca inclua dados pessoais sensíveis. Nunca inclua links. Nunca use emojis.\n" +
  "Retorne um único objeto JSON.";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_COUNT = 15;

const fallbackSchema = z
  .object({
    role: z.union([z.literal("client"), z.literal("deposit")]),
    action: z.enum([
      "buscar_depositos",
      "pedir_localizacao",
      "informar_bairro",
      "fazer_pedido",
      "status_pedido",
      "cancelar",
      "ajuda",
      "humano",
      "unknown",
      "abrir",
      "fechar",
      "status",
      "aceitar_pedido",
      "recusar_pedido",
    ]),
    confidence: z.number().min(0).max(1),
    entities: z.object({
      bairro: z.string().nullable(),
      pedidoId: z.string().nullable(),
      depositoId: z.string().nullable(),
      nome: z.string().nullable(),
      observacao: z.string().nullable(),
    }),
    reply_hint: z.string().nullable(),
    should_ask_clarifying_question: z.boolean(),
    clarifying_question: z.string().nullable(),
    safe_reason: z.string().nullable(),
  })
  .refine((data) => {
    if (data.action === "unknown" && data.confidence > 0.65) return false;
    return true;
  }, { message: "unknown action must have confidence <= 0.65" });

export type FallbackAction = z.infer<typeof fallbackSchema>;

function resolveTenantCnpj(input?: string): string | null {
  const direct = String(input ?? "").trim();
  if (direct) return direct;
  const trace = getTraceContext();
  const fromTrace = String(trace?.tenantCnpj ?? "").trim();
  if (fromTrace) return fromTrace;
  return null;
}

async function canCallGemini(tenantCnpj: string, waId: string): Promise<boolean> {
  try {
    const appRef = productDoc(tenantCnpj);
    const ref = geminiFallbackRateCol(tenantCnpj).doc(waId);
    const now = Date.now();

    let allowed = false;
    await appRef.firestore.runTransaction(async (tx) => {
      const snap = (await tx.get(ref)) as admin.firestore.DocumentSnapshot;
      const data = snap.exists ? (snap.data() as any) : {};
      const windowStart = Number(data.windowStartMs ?? 0);
      const count = Number(data.count ?? 0);

      if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
        allowed = true;
        tx.set(
          ref,
          {
            windowStartMs: now,
            count: 1,
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtMs: now,
          },
          { merge: true },
        );
        return;
      }

      if (count >= RATE_LIMIT_COUNT) {
        allowed = false;
        return;
      }

      allowed = true;
      tx.set(
        ref,
          {
          count: count + 1,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: now,
        },
        { merge: true },
      );
    });

    return allowed;
  } catch (err) {
    logger.warn("GEMINI_FALLBACK_RATE_TX_FAIL", { reason: String(err) });
    return false;
  }
}

function buildUserMessage(params: { role: "client" | "deposit"; text: string; context?: string[] }): string {
  const ctx = params.context?.filter(Boolean).join("\n") ?? "";
  return `Role: ${params.role}\n${ctx ? ctx + "\n" : ""}Mensagem do usuário:\n${params.text}`;
}

export async function inferAction(params: {
  waId: string;
  role: "client" | "deposit";
  text: string;
  context?: string[];
  tenantCnpj?: string;
}): Promise<FallbackAction | null> {
  if (!GEMINI_FALLBACK_ENABLED) return null;
  const trimmed = String(params.text ?? "").trim();
  if (!trimmed) return null;
  const waIdLast4 = last4Digits(params.waId);
  const tenantCnpj = resolveTenantCnpj(params.tenantCnpj);
  if (!tenantCnpj) {
    logger.warn("GEMINI_FALLBACK_NO_TENANT", { waIdLast4 });
    return null;
  }
  const allowedRate = await canCallGemini(tenantCnpj, params.waId);
  if (!allowedRate) {
    logger.info("GEMINI_FALLBACK_RATE_LIMIT", { waIdLast4 });
    return null;
  }

  try {
    const content = await callGemini(buildUserMessage(params), GEMINI_SYSTEM_PROMPT);
    if (!content) return null;

    const parsed = parseFallbackResponse(content);
    if (!parsed) {
      logger.warn("GEMINI_FALLBACK_PARSE_FAIL", { waIdLast4, raw: content.slice(0, 200) });
      return null;
    }

    if (parsed.confidence < 0.65 && parsed.action !== "unknown") {
      parsed.action = "unknown";
    }
    if (parsed.action === "unknown" && parsed.confidence > 0.65) {
      parsed.confidence = 0.65;
    }

    logger.info("GEMINI_FALLBACK_OK", {
      waIdLast4,
      action: parsed.action,
      confidence: parsed.confidence,
    });

    return parsed;
  } catch (err) {
    logger.warn("GEMINI_FALLBACK_ERROR", { error: String(err) });
    return null;
  }
}

export function parseFallbackResponse(raw: string): FallbackAction | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const json = match ? match[0] : raw;
    const data = JSON.parse(json);
    const parsed = fallbackSchema.safeParse(data);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
