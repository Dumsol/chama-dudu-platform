/**
 * Resolvedor de bebidas — heurística de embalagem, volume e vasilhame.
 *
 * Regras de negócio (fonte: RagCorpusExtra.txt v5.0):
 * - Cerveja sem embalagem explícita → pede clarificação (lata 350ml / long neck / garrafa 600ml)
 * - "litrão" sem vasilhame confirmado → pede se tem vasilhame (botijão/garrão)
 * - long neck, lata, garrafa com volume → considerado resolvido
 * - Refrigerantes, água, sucos → sem clarificação de embalagem necessária
 */

export type BeveragePackType = "lata" | "long_neck" | "garrafa" | "pack" | "litrão";

export interface BeverageParseResult {
  brand: string | null;
  volumeMl: number | null;
  packType: BeveragePackType | null;
  /** Embalagem suficientemente especificada para roteamento */
  packagingResolved: boolean;
  /** Tipo de clarificação necessária antes de rotear */
  clarificationNeeded: "embalagem" | "vasilhame" | null;
  /** Produto é alcoólico (exige gate de maioridade) */
  isAlcoholic: boolean;
  /** Litrão exige vasilhame */
  vasilhameRequired: boolean;
  /** Quantity extracted (e.g. "Skol 5" -> 5) */
  quantity: number | null;
}

// ─── Marcas conhecidas ────────────────────────────────────────────────────────
const BEER_BRANDS = [
  "heineken", "skol", "brahma", "bud", "budweiser", "antarctica",
  "itaipava", "crystal", "kaiser", "devassa", "corona", "stella",
  "original", "bohemia", "spaten", "becks", "eisenbahn",
];

const ALCOHOLIC_KEYWORDS = [
  ...BEER_BRANDS,
  "cerveja", "birra", "chopp",
  "vinho", "espumante", "prosecco", "champagne",
  "whisky", "whiskey", "vodka", "rum", "gin",
  "cachaça", "pinga", "aguardente",
  "destilado", "drinque", "drink",
];

// ─── Mapeamento de texto para tipo de embalagem ───────────────────────────────
const PACK_TYPE_PATTERNS: Array<{ pattern: RegExp; type: BeveragePackType; volumeMl?: number }> = [
  { pattern: /long.?neck/i, type: "long_neck", volumeMl: 355 },
  { pattern: /\blata\b/i, type: "lata", volumeMl: 350 },
  { pattern: /\b350\s*ml\b/i, type: "lata", volumeMl: 350 },
  { pattern: /\b473\s*ml\b/i, type: "lata", volumeMl: 473 },
  { pattern: /\b600\s*ml\b/i, type: "garrafa", volumeMl: 600 },
  { pattern: /\bgarrafa\b/i, type: "garrafa" },
  { pattern: /\blitr[aã]o\b/i, type: "litrão", volumeMl: 1000 },
  { pattern: /\b1\s*litro?\b/i, type: "litrão", volumeMl: 1000 },
  { pattern: /\bpack\b|\bcaixinha\b|\bcaixa\b/i, type: "pack" },
];

// ─── Extração de volume numérico (ex: "600ml", "355 ml") ─────────────────────
function extractVolumeMl(text: string): number | null {
  const match = text.match(/(\d{2,4})\s*ml/i);
  if (!match) return null;
  const ml = parseInt(match[1], 10);
  return ml >= 100 && ml <= 2000 ? ml : null;
}

// ─── Extração de quantidade (ex: "5 skol", "skol 5") ──────────────────────────
function extractQuantity(text: string): number | null {
  const brandsPattern = BEER_BRANDS.join("|");
  
  // Regex 1: [Número] [Marca/Cerveja] -> "5 skol"
  const preMatch = text.match(new RegExp(`(\\d+)\\s*(?:${brandsPattern}|cerveja|birra|chopp)`, "i"));
  if (preMatch) return parseInt(preMatch[1], 10);

  // Regex 2: [Marca/Cerveja] [Número] -> "skol 5"
  const postMatch = text.match(new RegExp(`(?:${brandsPattern}|cerveja|birra|chopp)\\s*(\\d+)`, "i"));
  if (postMatch) return parseInt(postMatch[1], 10);

  return null;
}

/** Normaliza string para comparação: remove acentos, lower, trim */
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Palavras-chave e marcas também normalizadas para comparação uniforme
const ALCOHOLIC_KEYWORDS_NORM = ALCOHOLIC_KEYWORDS.map(norm);
const BEER_BRANDS_NORM = BEER_BRANDS.map(norm);

// ─── Extração de marca ────────────────────────────────────────────────────────
function extractBrand(text: string): string | null {
  const normalized = norm(text);
  for (let i = 0; i < BEER_BRANDS_NORM.length; i++) {
    if (normalized.includes(BEER_BRANDS_NORM[i])) {
      const brand = BEER_BRANDS[i];
      return brand.charAt(0).toUpperCase() + brand.slice(1);
    }
  }
  return null;
}

/**
 * Analisa o texto do pedido e determina se precisa de clarificação de embalagem
 * ou vasilhame antes de rotear ao depósito.
 *
 * @param productText - Texto livre do pedido (ex: "12 heineken", "litrão de skol", "3 long neck")
 * @param hasVasilhame - Estado já capturado sobre vasilhame do usuário (null = ainda não perguntado)
 */
export function resolveBeverage(
  productText: string,
  hasVasilhame?: boolean | null,
): BeverageParseResult {
  const text = productText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const textNorm = norm(productText);
  // Palavras que indicam bebida não-alcoólica e anulam detecção de marca de cerveja
  const NON_BEER_OVERRIDES_EARLY = ["agua", "suco", "refrigerante", "coca", "pepsi", "guarana"];
  const hasNonBeerOverrideEarly = NON_BEER_OVERRIDES_EARLY.some((kw) => textNorm.includes(kw));
  // Se há contexto de água/suco, exclui marcas de cerveja do check de álcool
  const alcoholicKeywordsToCheck = hasNonBeerOverrideEarly
    ? ALCOHOLIC_KEYWORDS_NORM.filter((kw) => !BEER_BRANDS_NORM.includes(kw))
    : ALCOHOLIC_KEYWORDS_NORM;
  const isAlcoholic = alcoholicKeywordsToCheck.some((kw) => textNorm.includes(kw));
  const brand = extractBrand(text);
  const volumeMl = extractVolumeMl(text);

  // Detecta tipo de embalagem
  let packType: BeveragePackType | null = null;
  let resolvedVolumeMl: number | null = volumeMl;

  for (const { pattern, type, volumeMl: pkgVolume } of PACK_TYPE_PATTERNS) {
    if (pattern.test(productText)) {
      packType = type;
      if (!resolvedVolumeMl && pkgVolume) resolvedVolumeMl = pkgVolume;
      break;
    }
  }

  // ── Regra: litrão exige verificação de vasilhame ──────────────────────────
  const vasilhameRequired = packType === "litrão";
  if (vasilhameRequired) {
    const vasilhameResolved = hasVasilhame !== null && hasVasilhame !== undefined;
    return {
      brand,
      volumeMl: 1000,
      packType: "litrão",
      packagingResolved: vasilhameResolved,
      clarificationNeeded: vasilhameResolved ? null : "vasilhame",
      isAlcoholic,
      vasilhameRequired: true,
      quantity: extractQuantity(text),
    };
  }

  // ── Regra: cerveja sem embalagem precisa de clarificação ──────────────────
  const hasNonBeerOverride = hasNonBeerOverrideEarly;
  const isBeer =
    !hasNonBeerOverride &&
    (brand !== null || textNorm.includes("cerveja") || textNorm.includes("chopp"));
  if (isBeer && packType === null) {
    return {
      brand,
      volumeMl: resolvedVolumeMl,
      packType: null,
      packagingResolved: false,
      clarificationNeeded: "embalagem",
      isAlcoholic: true,
      vasilhameRequired: false,
      quantity: extractQuantity(text),
    };
  }

  // ── Embalagem explícita ou produto sem ambiguidade (água, refrigerante) ───
  return {
    brand,
    volumeMl: resolvedVolumeMl,
    packType,
    packagingResolved: true,
    clarificationNeeded: null,
    isAlcoholic,
    vasilhameRequired: false,
    quantity: extractQuantity(text),
  };
}

/**
 * Gera a pergunta de clarificação adequada para o tipo de ambiguidade.
 */
export function buildClarificationQuestion(
  clarificationType: "embalagem" | "vasilhame",
  brand: string | null,
): string {
  const brandLabel = brand ?? "cerveja";
  if (clarificationType === "embalagem") {
    return `${brandLabel} em qual embalagem? Lata 350ml, long neck ou garrafa 600ml? 🍺`;
  }
  return `Você tem vasilhame (botijão ou garrão)? Preciso saber antes de buscar parceiro que trabalhe com litrão. 🫙`;
}
