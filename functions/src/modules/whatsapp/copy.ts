const TONE_MARKERS = ["oxente", "visse", "bora", "massa", "arretado"];

export function askNeighborhoodCopy(): string {
  return `Oxente, compartilha teu bairro que eu te mostro os depósitos mais perto.`;
}

export function clarifyIntentCopy(): string {
  return "Manda de novo com mais detalhe e eu te respondo certinho, beleza?";
}

export function clarifyClientIntentCopy(): string {
  return "Oxente, bora direto: tu quer ver deposito, fazer pedido ou falar com um humano?";
}

export function clarifyDepositIntentCopy(): string {
  return "Massa. Tu quer abrir, fechar ou ver teu status agora?";
}

export function helpCopy(): string {
  return "Precisa de ajuda? Manda um 'ajuda' que eu te mostro as opções.";
}

export function noSupplyCopy(): string {
  return (
    "Poxa, irmão, não achei depósito aberto por enquanto. " +
    "Se quiser, me chama mais tarde que eu olho de novo, visse?"
  );
}

export function errorCopy(reason?: string): string {
  return reason
    ? `Algo deu errado (${reason}). Tenta de novo ou chama um atendente.`
    : "Algo não saiu como esperado. Tenta outra vez e eu tento te ajudar.";
}

export function toneMarker(index: number): string {
  return TONE_MARKERS[index % TONE_MARKERS.length];
}
