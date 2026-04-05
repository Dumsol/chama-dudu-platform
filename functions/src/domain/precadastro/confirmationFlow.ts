import { normalizeMessageText } from "../whatsapp/messageNormalizer";
import type { AtendimentoMode } from "./types";

export const PRE_CADASTRO_CONFIRMATION_COPY = `Ola! Aqui e o Dudu 👋

Recebemos o pre-cadastro do seu deposito e agora precisamos confirmar algumas informacoes para continuar.

Por favor, responda:
1. Nome do deposito
2. Nome do responsavel
3. Esse numero e mesmo o WhatsApp oficial do deposito?
4. Quais bairros voces atendem hoje?
5. Voces trabalham com retirada, entrega ou os dois?
6. Qual e o horario de atendimento?
7. Envie a localizacao exata do estabelecimento

Importante:
A localizacao enviada agora sera cadastrada como a localizacao oficial do seu deposito no sistema.
Por isso, envie a localizacao somente se voce estiver no proprio estabelecimento.

Se preferir, pode responder por partes. Assim que confirmarmos os dados, seguimos com seu cadastro.`;

export const LOCATION_WARNING_COPY =
  "Perfeito. Agora envie a localizacao exata do estabelecimento.\nAtencao: essa localizacao sera cadastrada no sistema como o ponto oficial do seu deposito.\nEnvie apenas se voce estiver no proprio estabelecimento neste momento.";

const MODE_MAP: Array<{ mode: AtendimentoMode; patterns: RegExp[] }> = [
  { mode: "ambos", patterns: [/\bambos\b/, /\bos dois\b/, /\bretirada e entrega\b/, /\bentrega e retirada\b/] },
  { mode: "retirada", patterns: [/\bretirada\b/, /\bretirar\b/, /\bbalcao\b/] },
  { mode: "entrega", patterns: [/\bentrega\b/, /\bdelivery\b/, /\blevar\b/] },
];

export function parseBairrosFromText(rawText: string): string[] {
  const source = String(rawText ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^bairros?\s*/i, "")
    .replace(/^atendemos\s*/i, "");

  const items = source
    .split(/,|;|\be\b/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && !/^(sim|nao|talvez)$/i.test(item));

  return [...new Set(items)];
}

export function parseAtendimentoMode(rawText: string): AtendimentoMode | null {
  const normalized = normalizeMessageText(rawText).compact;
  for (const entry of MODE_MAP) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) {
      return entry.mode;
    }
  }
  return null;
}

export function parseHorario(rawText: string): string | null {
  const text = normalizeMessageText(rawText).compact;
  if (text.length < 5) return null;
  if (!/\d/.test(text) && !/\bmanha\b|\btarde\b|\bnoite\b/.test(text)) return null;
  return text.slice(0, 160);
}

export function isAffirmative(rawText: string): boolean {
  const text = normalizeMessageText(rawText).compact;
  return /\b(sim|isso|confirmo|ta certo|correto)\b/.test(text);
}
