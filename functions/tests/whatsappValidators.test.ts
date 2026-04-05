import assert from "node:assert";
import { ensureValidPhoneNumberId, ensureValidToDigits, validateWebpBuffer } from "../src/modules/whatsapp/validators";

function makeMinimalWebp(): Uint8Array {
  const arr = new Uint8Array(32);
  arr.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  arr.set([0x00, 0x00, 0x00, 0x00], 4); // size placeholder
  arr.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  return arr;
}

function makeInvalidWebp(): Uint8Array {
  const arr = makeMinimalWebp();
  arr[0] = 0x00;
  return arr;
}

function run(): void {
  const info = ensureValidPhoneNumberId("   12345678   ");
  assert.strictEqual(info.normalized, "12345678");
  assert.strictEqual(info.digitsLast4, "5678");

  assert.throws(() => ensureValidPhoneNumberId("abc123"), /phoneNumberId inválido/);

  const toDigits = ensureValidToDigits(" +55 (11) 91234-5678 ");
  assert.strictEqual(toDigits, "5511912345678");
  assert.throws(() => ensureValidToDigits("12345"), /to inválido/);

  const buffer = makeMinimalWebp();
  const result = validateWebpBuffer(buffer, 1024);
  assert.strictEqual(result.sizeBytes, 32);

  assert.throws(() => validateWebpBuffer(makeInvalidWebp()), /WebP inválido/);
  assert.throws(() => validateWebpBuffer(buffer, 16), /WebP excede o limite/);

  console.log("tests/whatsappValidators.test.ts ok");
}

run();
