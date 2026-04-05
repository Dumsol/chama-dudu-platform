// import { normalizeBairro } from "./normalize";

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
      .replace(/[^\w\s]/g, "") // Remove punctuation
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}

export function calculateSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (!tokensA.size || !tokensB.size) return 0;
  
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function shouldBreakFallbackLoop(params: {
  lastBotMessage: string | null | undefined;
  nextMessage: string;
  fallbackCount: number | null | undefined;
}): boolean {
  const next = String(params.nextMessage ?? "").trim();
  if (!next) return false;
  const last = String(params.lastBotMessage ?? "").trim();
  if (!last) return false;

  const sim = calculateSimilarity(last, next);
  const fallbackCount = Number(params.fallbackCount ?? 0);
  
  // Se a mensagem for idêntica ou muito similar (>85%), quebra rápido
  if (sim > 0.85 && fallbackCount >= 1) return true;
  
  // Se for relativamente similar (>60%) e já falhou 2 vezes
  if (sim > 0.60 && fallbackCount >= 2) return true;

  return false;
}
