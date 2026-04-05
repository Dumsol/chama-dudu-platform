import crypto from "crypto";
import { describe, expect, it } from "vitest";
import { validateWebhookSignature } from "../src/infra/security/signatureVerifier";

const APP_SECRET = "test-secret";

function makeSignature(rawBody: Buffer): string {
  return `sha256=${crypto.createHmac("sha256", APP_SECRET).update(rawBody).digest("hex")}`;
}

describe("webhook signature validator", () => {
  it("accepts valid signature", () => {
    const body = Buffer.from(JSON.stringify({ ok: true }), "utf8");
    const result = validateWebhookSignature({
      rawBody: body,
      signatureHeader: makeSignature(body),
      appSecret: APP_SECRET,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects invalid signature", () => {
    const body = Buffer.from(JSON.stringify({ ok: true }), "utf8");
    const result = validateWebhookSignature({
      rawBody: body,
      signatureHeader: "sha256=invalid",
      appSecret: APP_SECRET,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects missing payload in production mode", () => {
    const serviceBefore = process.env.K_SERVICE;
    process.env.K_SERVICE = "prod";
    const result = validateWebhookSignature({
      rawBody: undefined,
      signatureHeader: undefined,
      appSecret: APP_SECRET,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("MISSING_RAW_BODY");
    process.env.K_SERVICE = serviceBefore;
  });

  it("bypasses in emulator mode", () => {
    const emulatorBefore = process.env.FUNCTIONS_EMULATOR;
    process.env.FUNCTIONS_EMULATOR = "true";
    const result = validateWebhookSignature({
      rawBody: undefined,
      signatureHeader: undefined,
      appSecret: APP_SECRET,
    });
    expect(result.ok).toBe(true);
    process.env.FUNCTIONS_EMULATOR = emulatorBefore;
  });
});
