import * as crypto from "crypto";
import { normalizeDigits, isValidCnpjDigits, validateHorarios } from "../../app/http/depositoRegister";
import { verifySignature } from "../../modules/whatsapp/signature";
import { makeOutboxId } from "../../modules/whatsapp/send";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`SMOKE_FAIL: ${message}`);
  }
}

function calcCnpjDigits(base12: string): string {
  const calcDigit = (base: string, weights: number[]): number => {
    let sum = 0;
    for (let i = 0; i < weights.length; i += 1) {
      sum += Number(base[i]) * weights[i];
    }
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calcDigit(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcDigit(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return base12 + String(d1) + String(d2);
}

function run(): void {
  // ID contracts
  const cnpjDigits = calcCnpjDigits("112223330001");
  const depositoId = `dep_cnpj_${cnpjDigits}`;
  assert(depositoId.startsWith("dep_cnpj_"), "depositoId prefix");
  assert(/^dep_cnpj_\d{14}$/.test(depositoId), "depositoId formato");

  const waDigits = normalizeDigits("+55 (11) 91234-5678");
  assert(waDigits.length >= 10 && waDigits.length <= 13, "waDigits tamanho");
  const ptrId = waDigits;
  assert(ptrId === waDigits, "depositosByWa docId");

  const outboxId = makeOutboxId({
    to: waDigits,
    kind: "send_buttons",
    reason: "window",
    orderId: "ord_app_5511_abc123",
    body: "teste",
    payload: { a: 1 },
  });
  assert(outboxId.startsWith("out_"), "outboxId prefix");
  assert(outboxId.includes(waDigits), "outboxId inclui destino");

  // Validadores
  assert(isValidCnpjDigits(cnpjDigits), "cnpj valido");
  assert(!isValidCnpjDigits("11111111111111"), "cnpj invalido");

  const waInvalid = normalizeDigits("123");
  assert(waInvalid.length < 10, "whatsapp invalido detectado");

  const ufOk = "SP";
  const ufBad = "Sao";
  assert(/^[A-Z]{2}$/.test(ufOk), "uf valida");
  assert(!/^[A-Z]{2}$/.test(ufBad), "uf invalida");

  const horariosErrors = validateHorarios([{ dow: 7, abre: "08:00", fecha: "18:00" } as any]);
  assert(horariosErrors.length > 0, "horarios invalidos");

  const horariosClosedErrors = validateHorarios([{ dow: 1, fechado: true, abre: "08:00" } as any]);
  assert(horariosClosedErrors.length > 0, "horarios fechado invalido");

  // Webhook signature gate
  const rawBody = Buffer.from("{\"ok\":true}", "utf8");
  const secret = "secret";
  const validSig = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  assert(verifySignature(rawBody, validSig, secret), "signature valida");
  assert(!verifySignature(undefined, validSig, secret), "signature missing rawBody");
  assert(!verifySignature(rawBody, undefined, secret), "signature missing header");
  assert(!verifySignature(rawBody, "sha256=deadbeef", secret), "signature invalida");

  console.log("SMOKE_OK");
}

run();
