export const SEED_TEST_DEPOSITO_CNPJ = "5979948800001";
export const SEED_TEST_DEPOSITO_PHONE_RAW = "8196301541";
export const SEED_TEST_DEPOSITO_DOC_ID = `seed_dep_${SEED_TEST_DEPOSITO_CNPJ}`;
export const SEED_TEST_IMMEDIATE_BILLING_CYCLE_KEY = "seed_first_confirmed_v1";

function digitsOnly(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeWaId(value: string | null | undefined): string {
  const digits = digitsOnly(value);
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function isSeedTestDepositoIdentity(params: {
  depositoId?: string | null;
  cnpj?: string | null;
  waId?: string | null;
  whatsappRaw?: string | null;
}): boolean {
  const byId = String(params.depositoId ?? "").trim() === SEED_TEST_DEPOSITO_DOC_ID;
  const byCnpj = digitsOnly(params.cnpj) === SEED_TEST_DEPOSITO_CNPJ;
  const expectedWa = normalizeWaId(SEED_TEST_DEPOSITO_PHONE_RAW);
  const byWa = normalizeWaId(params.waId) === expectedWa || normalizeWaId(params.whatsappRaw) === expectedWa;
  return byId || byCnpj || byWa;
}
