import { normalizeBairro } from "./normalize";
import { type NormalizedMessage } from "./types";
export type { NormalizedMessage };

const SLANG_DICTIONARY: Record<string, string> = {
  vc: "voce",
  vcs: "voces",
  c: "voce",
  q: "que",
  pq: "porque",
  pqq: "porque",
  pqpp: "porque",
  obg: "obrigado",
  obgd: "obrigado",
  tb: "tambem",
  tbm: "tambem",
  td: "tudo",
  kd: "onde",
  cad: "onde",
  to: "estou",
  ta: "esta",
  tao: "estao",
  eh: "e",
};

const SOCIAL_ALIAS: Record<string, string> = {
  oii: "oi",
  oiii: "oi",
  opaa: "opa",
  eai: "eae",
  eaee: "eae",
  dalee: "dale",
  blz: "beleza",
  tmj: "valeu",
  vlw: "valeu",
};

function normalizePunctuation(raw: string): string {
  return raw
    .replace(/[!?.,;:]{2,}/g, " ")
    .replace(/[_~`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function squeezeInformalRepeat(token: string): string {
  if (!token) return token;
  const condensed = token.replace(/(.)\1{2,}/g, "$1$1");
  if (condensed.length <= 8) {
    return condensed.replace(/([aeiou])\1+$/g, "$1");
  }
  return condensed;
}

function normalizeToken(token: string): string {
  const squeezed = squeezeInformalRepeat(token);
  const aliased = SOCIAL_ALIAS[squeezed] ?? squeezed;
  return SLANG_DICTIONARY[aliased] ?? aliased;
}

export function normalizeMessageText(rawInput: string | null | undefined): NormalizedMessage {
  const raw = normalizePunctuation(String(rawInput ?? ""));
  const normalized = normalizeBairro(raw);
  const rawTokens = normalized ? normalized.split(" ") : [];
  const expandedTokens = rawTokens.map((token: string) => normalizeToken(token)).filter(Boolean);

  const compact = expandedTokens.join(" ").trim();
  return {
    raw,
    normalized,
    compact,
    tokens: compact ? compact.split(" ") : [],
  };
}
