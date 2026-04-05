export const PRE_CADASTRO_TEMPLATE_ENV = "WA_TEMPLATE_DEPOSITO_PRE_CADASTRO_CONFIRMACAO";
export const PRE_CADASTRO_TEMPLATE_ENV_LEGACY = "WHATSAPP_TEMPLATE_DEPOSITO_PRE_CADASTRO_CONFIRMACAO";
export const PRE_CADASTRO_TEMPLATE_LANG_ENV = "WA_TEMPLATE_DEPOSITO_PRE_CADASTRO_LANG";
export const PRE_CADASTRO_TEMPLATE_CATEGORY = "UTILITY";

export function readPreCadastroTemplateName(): string {
  const primary = String(process.env[PRE_CADASTRO_TEMPLATE_ENV] ?? "").trim();
  if (primary) return primary;
  return String(process.env[PRE_CADASTRO_TEMPLATE_ENV_LEGACY] ?? "").trim();
}

export function readPreCadastroTemplateLanguage(): string {
  return String(process.env[PRE_CADASTRO_TEMPLATE_LANG_ENV] ?? "pt_BR").trim() || "pt_BR";
}

export function allowPreCadastroTextFallback(): boolean {
  const raw = String(process.env.WA_TEMPLATE_PRE_CADASTRO_ALLOW_TEXT_FALLBACK ?? "")
    .trim()
    .toLowerCase();
  if (["1", "true", "yes"].includes(raw)) return true;
  return Boolean(process.env.FUNCTIONS_EMULATOR) || Boolean(process.env.FIREBASE_EMULATOR_HUB);
}

export function preCadastroAbandonAfterMs(): number {
  const hours = Number(process.env.PRE_CADASTRO_ABANDON_AFTER_HOURS ?? "72");
  if (!Number.isFinite(hours) || hours <= 0) return 72 * 60 * 60 * 1000;
  return Math.floor(hours * 60 * 60 * 1000);
}
