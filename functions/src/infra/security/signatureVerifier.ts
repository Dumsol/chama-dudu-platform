import crypto from "crypto";
import { getReplaySecretFromRuntime, isEmulatorRuntime, isProductionRuntime } from "../../config/opsRuntime";

export interface SignatureValidationResult {
  ok: boolean;
  reason?: "MISSING_RAW_BODY" | "MISSING_SIGNATURE" | "INVALID_SIGNATURE";
  bypassed?: boolean;
}

function compareSignatures(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isBypassHeaderAllowed(headers: { replayHeader?: string }): boolean {
  const headerValue = String(headers.replayHeader ?? "").trim();
  if (!headerValue) return false;
  const secret = getReplaySecretFromRuntime();
  if (!secret) return false;
  return compareSignatures(secret, headerValue);
}

export function validateWebhookSignature(params: {
  rawBody: Buffer | null | undefined;
  signatureHeader: string | undefined;
  appSecret: string;
  replayHeader?: string;
}): SignatureValidationResult {
  if (isProductionRuntime()) {
    if (!params.rawBody) return { ok: false, reason: "MISSING_RAW_BODY" };
    if (!params.signatureHeader) return { ok: false, reason: "MISSING_SIGNATURE" };
    const expected = `sha256=${crypto
      .createHmac("sha256", params.appSecret)
      .update(params.rawBody)
      .digest("hex")}`;
    return compareSignatures(expected, params.signatureHeader)
      ? { ok: true }
      : { ok: false, reason: "INVALID_SIGNATURE" };
  }

  if (params.rawBody && params.signatureHeader) {
    const expected = `sha256=${crypto
      .createHmac("sha256", params.appSecret)
      .update(params.rawBody)
      .digest("hex")}`;
    if (compareSignatures(expected, params.signatureHeader)) return { ok: true };
  }

  // Remove bypass automático de emulador para segurança.
  // Testes locais devem usar o internalReplaySecret no cabeçalho.

  if (isBypassHeaderAllowed({ replayHeader: params.replayHeader })) {
    return { ok: true, bypassed: true };
  }

  if (!params.rawBody) return { ok: false, reason: "MISSING_RAW_BODY" };
  if (!params.signatureHeader) return { ok: false, reason: "MISSING_SIGNATURE" };
  return { ok: false, reason: "INVALID_SIGNATURE" };
}

export function canUseReplayEndpoint(replayHeader?: string): boolean {
  if (isProductionRuntime()) return false;
  if (isEmulatorRuntime()) return true;
  return isBypassHeaderAllowed({ replayHeader });
}
