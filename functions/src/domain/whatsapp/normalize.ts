export function normalizeWhatsAppId(input: string): string {
  return String(input ?? "").replace(/[^\d]/g, "");
}

export function normalizeBairro(input: string): string {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCommand(input: string): string {
  const normalized = normalizeBairro(input);
  if (!normalized) return "";
  return normalized
    .replace(/\bto\b/g, "estou")
    .replace(/\bta\b/g, "esta")
    .replace(/\bvc\b/g, "voce")
    .replace(/\bpq\b/g, "porque")
    .replace(/\bblz\b/g, "beleza")
    .trim();
}

export function sanitizeSnippet(input: string | null | undefined, max = 180): string | null {
  if (!input) return null;
  const oneLine = String(input).replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine;
}
