import type { UserRecord, WhatsAppInboundMessage } from "./types";
import { SYSTEM_PROMPT_V4 } from "../../config/systemPrompt";

export interface PromptContext {
  systemInstruction: string;
  history: string[];
  /** Texto efetivo para enviar ao modelo (pode diferir de message.text) */
  effectiveQuery: string;
  /** Texto limpo para salvar no histórico (sem XML/JSON) */
  normalizedText: string;
}

/**
 * Construtor de prompts contextuais para o Grounded Generation do Chama Dudu.
 * O system prompt e o effectiveQuery são derivados do estado atual do usuário
 * e do tipo de mensagem recebida (texto, botão, GPS).
 */
export const promptBuilder = {
  buildUserPrompt(params: {
    user: UserRecord;
    message: Pick<
      WhatsAppInboundMessage,
      "text" | "sourceKind" | "interactiveId" | "interactiveTitle" | "location"
    >;
  }): PromptContext {
    const { user, message } = params;
    const { sourceKind, interactiveId, interactiveTitle, location, text } =
      message;

    // ── 1. Determina a mensagem textual efetiva para o RAG ─────────────────
    let normalizedText = text?.trim() ?? "";

    if (sourceKind === "interactive" && interactiveId) {
      normalizedText = interactiveTitle ?? interactiveId;
    } else if (sourceKind === "location" && location) {
      const addr = location.address ?? location.name ?? "Localização GPS";
      normalizedText = `Localização compartilhada: ${addr}`;
    } else if (sourceKind === "button" && interactiveId) {
      normalizedText = interactiveTitle ?? interactiveId;
    }

    // ── 2. Metadados dinâmicos (Horário e Dia) ───────────────────────────
    const now = new Date();
    const hora = now.toLocaleTimeString("pt-BR", {
      timeZone: "America/Recife",
      hour12: false,
    });
    const diaSemana = now.toLocaleDateString("pt-BR", {
      timeZone: "America/Recife",
      weekday: "long",
    });
    const isWeekend = [0, 5, 6].includes(now.getDay());

    // ── 3. System Instruction — v4.0 (lida de config/systemPrompt.ts) ──────
    const systemInstruction = SYSTEM_PROMPT_V4;

    // ── 4. Prompt do Usuário Estruturado ──────────────────────────────────
    const effectiveQuery = `
<session_state>
${JSON.stringify({
  currentBotState: user.botState,
  bairroNorm: user.bairroNorm ?? null,
  bairro: (user as any).bairro ?? null,
  isBairroConfirmed: !!user.bairroNorm && user.botState !== "awaiting_neighborhood",
  beverageBrand: user.beverageBrand ?? null,
  beverageVolumeMl: user.beverageVolumeMl ?? null,
  beveragePackType: user.beveragePackType ?? null,
  hasVasilhame: user.hasVasilhame ?? null,
  ageConfirmed: user.ageConfirmed ?? false,
  paymentMethod: user.paymentMethod ?? null,
  activeOrderId: user.activeOrderId ?? null,
  fallbackCount: user.fallbackCount ?? 0,
})}
</session_state>

<meta>
{"hora":"${hora}","diaSemana":"${diaSemana}","isWeekend":${isWeekend}}
</meta>

<user_message>
${normalizedText}
</user_message>
`.trim();

    // ── 5. Histórico da conversa ─────────────────────────────────────────
    const history = (user.conversationHistory ?? []).map(
      (h) => `${h.role}: ${h.content}`,
    );

    return {
      systemInstruction,
      history,
      effectiveQuery,
      normalizedText,
    };
  },
};
