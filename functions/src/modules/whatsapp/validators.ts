import * as logger from "firebase-functions/logger";

const PHONE_NUMBER_ID_REGEX = /^\d{8,30}$/;
const MIN_TO_DIGITS = 10;
const MAX_WEBP_BYTES = 1_048_576; // 1 MiB

export type PhoneNumberIdInfo = {
  normalized: string;
  digits: string;
  digitsLast4: string;
  rawSnippet: string;
  hasNonDigit: boolean;
};

export function normalizeToDigitsE164(value: string): string {
  const str = String(value ?? "").trim();
  // Se contiver letras, ou se for um ID muito longo típico do Graph API (mais de 14 caracteres), 
  // assumimos que é um BSUID ou username e não aplicamos a remoção de não-dígitos.
  if (/[a-zA-Z]/.test(str) || str.length > 14) {
    return str;
  }
  return str.replace(/[^\d]/g, "");
}

export function last4Digits(value: string | null | undefined): string | null {
  const digits = normalizeToDigitsE164(String(value ?? ""));
  if (!digits) return null;
  return digits.slice(-4);
}

export function ensureValidPhoneNumberId(raw: string): PhoneNumberIdInfo {
  const trimmed = String(raw ?? "").trim();
  const snippet = trimmed.slice(0, 48);
  const digitsOnly = trimmed.replace(/\D/g, "");
  const hasNonDigit = /\D/.test(trimmed);

  if (!PHONE_NUMBER_ID_REGEX.test(trimmed)) {
    logger.error("WA_INVALID_PHONE_NUMBER_ID", {
      rawSnippet: snippet,
      hasNonDigit,
      digitsOnly,
    });
    throw new Error(
      `phoneNumberId inválido. Deve ser 8-30 dígitos numéricos. Recebido: ${snippet || "<vazio>"}`,
    );
  }

  return {
    normalized: trimmed,
    digits: digitsOnly,
    digitsLast4: digitsOnly.slice(-4) || digitsOnly,
    rawSnippet: snippet,
    hasNonDigit,
  };
}

export function ensureValidToDigits(raw: string, minDigits = MIN_TO_DIGITS): string {
  const digits = normalizeToDigitsE164(raw);
  if (digits.length < minDigits) {
    throw new Error(`to inválido. Esperado >=${minDigits} dígitos. Recebido: ${raw}`);
  }
  return digits;
}

export function validateWebpBuffer(buffer: ArrayBuffer | Uint8Array, maxBytes = MAX_WEBP_BYTES): {
  sizeBytes: number;
} {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (view.length > maxBytes) {
    throw new Error(`WebP excede o limite de ${maxBytes} bytes.`);
  }
  if (view.length < 12) {
    throw new Error("WebP inválido (arquivo muito pequeno).");
  }

  if (
    view[0] !== 0x52 || // R
    view[1] !== 0x49 || // I
    view[2] !== 0x46 || // F
    view[3] !== 0x46 || // F
    view[8] !== 0x57 || // W
    view[9] !== 0x45 || // E
    view[10] !== 0x42 || // B
    view[11] !== 0x50 // P
  ) {
    throw new Error("WebP inválido (magic bytes não correspondem a RIFF/WEBP).");
  }

  return { sizeBytes: view.length };
}
