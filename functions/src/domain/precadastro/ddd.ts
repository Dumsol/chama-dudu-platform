export const DEFAULT_SUPPORTED_DDDS = ["81"] as const;

export type RegionStatus = "supported" | "unsupported";

export function onlyDigits(input: string): string {
  return String(input ?? "").replace(/\D/g, "");
}

export function parseSupportedDdds(raw: string | null | undefined): string[] {
  const csv = String(raw ?? "").trim();
  const values = (csv ? csv.split(",") : [...DEFAULT_SUPPORTED_DDDS]).map((item) => onlyDigits(item).slice(0, 2));
  return [...new Set(values.filter((item) => item.length === 2))];
}

export function normalizeBrazilWhatsApp(raw: string): {
  normalized: string;
  local: string;
  ddd: string | null;
  valid: boolean;
} {
  const digits = onlyDigits(raw);
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  const validLocalLength = local.length === 10 || local.length === 11;
  const valid = validLocalLength && local.slice(0, 2) !== "00";
  return {
    normalized: valid ? `55${local}` : digits,
    local,
    ddd: valid ? local.slice(0, 2) : null,
    valid,
  };
}

export function resolveRegionStatus(ddd: string | null, supportedDdds: string[]): RegionStatus {
  if (!ddd) return "unsupported";
  return supportedDdds.includes(ddd) ? "supported" : "unsupported";
}

