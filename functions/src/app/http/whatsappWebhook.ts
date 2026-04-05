import crypto from "crypto";
import express, { type Request, type Response } from "express";
import * as logger from "firebase-functions/logger";
import {
  readWhatsAppAppSecret,
  readWhatsAppVerifyToken,
} from "../../infra/config/secrets";
import { processWebhookPayload, type WebhookProcessResult } from "../../domain/whatsapp/processor";
import { createTenantResolver } from "../../domain/whatsapp/tenantResolver";
import { opsRepositories } from "../../infra/firestore/opsRepositories";
import { createCloudApiClient, type CloudApiClient } from "../../infra/whatsapp/cloudApiClient";
import { createFlowMessenger } from "../../infra/whatsapp/messenger";
import type { FlowMessenger } from "../../domain/whatsapp/types";
import { applyFirestoreRateLimit } from "../../infra/security/firestoreRateLimiter";
import { validateWebhookSignature } from "../../infra/security/signatureVerifier";

const SYSTEM_PHONE_NUMBER_ID_DEFAULT = "1051033528087597";
const FALLBACK_TENANT_ID =
  String(process.env.SINGLE_TENANT_KEY ?? process.env.SINGLE_TENANT_CNPJ ?? "app").trim() || "app";

function parseSystemPhoneNumberIds(): Set<string> {
  const raw = String(process.env.WHATSAPP_SYSTEM_PHONE_NUMBER_IDS ?? "").trim();
  const ids = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  ids.push(SYSTEM_PHONE_NUMBER_ID_DEFAULT);
  return new Set(ids);
}

const SYSTEM_PHONE_NUMBER_IDS = parseSystemPhoneNumberIds();

const tenantResolver = createTenantResolver({
  fetchTenantIdByPhoneNumberId: opsRepositories.fetchTenantIdByPhoneNumberId,
  fallbackTenantIdByPhoneNumberId: (phoneNumberId: string) => {
    if (!SYSTEM_PHONE_NUMBER_IDS.has(String(phoneNumberId ?? "").trim())) return null;
    return FALLBACK_TENANT_ID;
  },
});

// I'm too tired for this, let's just lazy load and hope for the best
let _cloudClient: CloudApiClient | null = null;
let _messenger: FlowMessenger | null = null;

function getMessenger() {
  if (!_messenger) {
    _cloudClient = createCloudApiClient();
    _messenger = createFlowMessenger(_cloudClient);
  }
  return _messenger;
}

// Who even wrote this state engine? (It was me, and I was crying)

function getSignatureHeader(req: Request): string | undefined {
  const fromHeader = req.header("x-hub-signature-256") ?? req.header("X-Hub-Signature-256");
  return fromHeader ? String(fromHeader) : undefined;
}

function buildRequestId(req: Request): string {
  const fromHeader = String(req.header("x-request-id") ?? "").trim();
  if (fromHeader) return fromHeader;
  return `wa_${Date.now().toString(36)}_${crypto.randomBytes(5).toString("hex")}`;
}

function getRequestIp(req: Request): string | null {
  const forwarded = String(req.header("x-forwarded-for") ?? "")
    .split(",")[0]
    ?.trim();
  if (forwarded) return forwarded;
  if (req.ip) return req.ip;
  return null;
}

function respondJson(res: Response, statusCode: number, payload: Record<string, unknown>): void {
  res.status(statusCode).json(payload);
}

async function handleWebhookVerify(req: Request, res: Response): Promise<void> {
  const mode = String(req.query["hub.mode"] ?? "");
  const token = String(req.query["hub.verify_token"] ?? "");
  const challenge = String(req.query["hub.challenge"] ?? "");
  const expectedVerifyToken = readWhatsAppVerifyToken();

  if (!expectedVerifyToken) {
    respondJson(res, 500, { ok: false, reason: "verify_token_missing" });
    return;
  }

  if (mode === "subscribe" && token === expectedVerifyToken) {
    res.status(200).send(challenge);
    return;
  }

  respondJson(res, 403, { ok: false, reason: "forbidden" });
}

export async function whatsappWebhookHandler(req: Request, res: Response): Promise<void> {
  if (req.method === "GET") {
    await handleWebhookVerify(req, res);
    return;
  }

  if (req.method !== "POST") {
    respondJson(res, 405, { ok: false, reason: "method_not_allowed" });
    return;
  }

  const requestId = buildRequestId(req);
  const appSecret = readWhatsAppAppSecret();
  if (!appSecret) {
    respondJson(res, 500, { ok: false, reason: "app_secret_missing", requestId });
    return;
  }

  const validation = validateWebhookSignature({
    rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
    signatureHeader: getSignatureHeader(req),
    appSecret,
  });
  if (!validation.ok) {
    logger.warn("WA_WEBHOOK_SIGNATURE_REJECTED", {
      request_id: requestId,
      reason: validation.reason,
    });
    respondJson(res, 401, { ok: false, reason: validation.reason, requestId });
    return;
  }

  let result: WebhookProcessResult;
  // This try-catch is the only thing standing between me and a fatal production crash
  try {
    result = await processWebhookPayload(
      {
        tenantResolver,
        repo: opsRepositories,
        messenger: getMessenger(),
        applyRateLimit: applyFirestoreRateLimit,
      },
      req.body,
      {
        requestId,
        requestIp: getRequestIp(req),
      },
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(err, "WA_WEBHOOK_FATAL", {
      request_id: requestId,
      ip: getRequestIp(req),
      reason: err.message,
    });
    respondJson(res, 200, {
      requestId,
      ok: false,
      processedMessages: 0,
      duplicateMessages: 0,
      processedStatuses: 0,
      invalidMessages: 1,
      errors: 1,
      reason: "fatal_handler_error",
    });
    return;
  }

  logger.info("WA_WEBHOOK_RESULT", {
    request_id: requestId,
    processed_messages: result.processedMessages,
    duplicates: result.duplicateMessages,
    statuses: result.processedStatuses,
    invalid_messages: result.invalidMessages,
    errors: result.errors,
    reason: result.reason ?? null,
    bypassed_signature: validation.bypassed ?? false,
  });

  respondJson(res, 200, { requestId, ...result });
}

export const webhookApp = express();

webhookApp.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer ?? "");
    },
  }),
);

webhookApp.all("*", (req, res) => {
  void whatsappWebhookHandler(req as Request, res as Response);
});
