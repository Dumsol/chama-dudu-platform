import * as logger from "firebase-functions/logger";
import { MESSAGE_SNIPPET_MAX, WEBHOOK_RATE_LIMIT_MAX, WEBHOOK_RATE_LIMIT_WINDOW_MS } from "../../config/opsRuntime";
import { claimMessageProcessing, type IdempotencyStore } from "./idempotency";
import { parseWebhookEnvelope } from "./parser";
import type { FlowMessenger, FlowRepository } from "./types";
import { stateEngine } from "./stateEngine";
import { sanitizeSnippet } from "./normalize";
import type { WhatsAppInboundMessage } from "./types";

export interface ProcessWebhookDeps {
  tenantResolver: {
    resolveTenantId: (phoneNumberId: string) => Promise<string>;
  };
  repo: FlowRepository & {
    saveInboundMessage: (params: {
      tenantId: string;
      message: WhatsAppInboundMessage;
    }) => Promise<void>;
    saveStatusMessage: (params: {
      tenantId: string;
      status: {
        phoneNumberId: string;
        messageId: string;
        status: string;
        recipientWaId: string | null;
        timestamp: string | null;
        errorCode: string | null;
        errorTitle: string | null;
      };
    }) => Promise<void>;
  } & IdempotencyStore;
  messenger: FlowMessenger;
  applyRateLimit: (params: {
    tenantId: string;
    scope: "webhook";
    key: string;
    windowMs: number;
    maxHits: number;
  }) => Promise<{ allowed: boolean; remaining: number; resetAtMs: number }>;
}

export interface WebhookProcessResult {
  ok: boolean;
  processedMessages: number;
  duplicateMessages: number;
  processedStatuses: number;
  invalidMessages: number;
  errors: number;
  reason?: string;
}

export async function processWebhookPayload(
  deps: ProcessWebhookDeps,
  payload: unknown,
  context: { requestId: string; requestIp: string | null },
): Promise<WebhookProcessResult> {
  let parsed: ReturnType<typeof parseWebhookEnvelope>;
  try {
    parsed = parseWebhookEnvelope(payload);
  } catch (error) {
    logger.warn("WA_INVALID_PAYLOAD", {
      requestId: context.requestId,
      reason: (error as Error).message,
    });
    return {
      ok: false,
      processedMessages: 0,
      duplicateMessages: 0,
      processedStatuses: 0,
      invalidMessages: 1,
      errors: 1,
      reason: "invalid_payload",
    };
  }

  let processedMessages = 0;
  let duplicateMessages = 0;
  let processedStatuses = 0;
  let invalidMessages = 0;
  let errors = 0;

  for (const status of parsed.statuses) {
    try {
      const tenantId = await deps.tenantResolver.resolveTenantId(status.phoneNumberId);
      await deps.repo.saveStatusMessage({ tenantId, status });
      processedStatuses += 1;
    } catch (error) {
      errors += 1;
    }
  }

  for (const message of parsed.messages) {
    try {
      const sessionUserId = message.waId || message.bsuId || "";
      const tenantId = await deps.tenantResolver.resolveTenantId(message.phoneNumberId);
      const rate = await deps.applyRateLimit({
        tenantId,
        scope: "webhook",
        key: sessionUserId || context.requestIp || "anonymous",
        windowMs: WEBHOOK_RATE_LIMIT_WINDOW_MS,
        maxHits: WEBHOOK_RATE_LIMIT_MAX,
      });
      if (!rate.allowed) continue;

      const claim = await claimMessageProcessing(deps.repo, {
        messageId: message.messageId,
        tenantId,
        waId: sessionUserId,
      });
      if (claim === "duplicate") {
        duplicateMessages += 1;
        continue;
      }

      await deps.repo.saveInboundMessage({
        tenantId,
        message: {
          ...message,
          text: sanitizeSnippet(message.text, MESSAGE_SNIPPET_MAX),
        },
      });

      const processPromise = stateEngine.processInboundMessage({
        tenantId,
        waId: sessionUserId,
        message,
      });

      // Se a resposta demorar mais de 3.5s, envia mensagem de "Pensando"
      // para evitar que o usuário ache que o bot travou (especialmente com Gemini Pro / RAG)
      const interimTimer = setTimeout(() => {
        logger.info("[THINKING_MSG] Triggered after 10s delay — waiting for Gemini response");
        deps.messenger
          .sendText({
            tenantId,
            phoneNumberId: message.phoneNumberId || "",
            waId: message.waId || "",
            body: "Dando uma olhadinha aqui, só um segundo...",
          })
          .catch((err) => logger.warn("INTERIM_MSG_FAIL", { err }));
      }, 10000);

      const botResponse = await processPromise;
      clearTimeout(interimTimer);

      await deps.messenger.sendText({
        tenantId,
        phoneNumberId: message.phoneNumberId || "",
        waId: message.waId || "",
        body: botResponse.body || "Olá! Como posso ajudar?",
        buttons: botResponse.buttons,
        isLocationRequest: botResponse.isLocationRequest,
      });
      processedMessages += 1;
    } catch (err) {
      errors += 1;
      invalidMessages += 1;
    }
  }

  return {
    ok: errors === 0,
    processedMessages,
    duplicateMessages,
    processedStatuses,
    invalidMessages,
    errors,
    reason: errors === 0 ? "processed" : "processed_with_errors",
  };
}
