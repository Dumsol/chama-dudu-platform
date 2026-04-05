import * as crypto from "crypto";

export function verifySignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!rawBody || !signatureHeader || !appSecret) {
    return false;
  }

  const expectedSignature =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  return signatureHeader === expectedSignature;
}
