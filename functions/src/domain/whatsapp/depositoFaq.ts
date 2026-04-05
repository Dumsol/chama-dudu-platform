export interface DepositoFaqItem {
  title: string;
  answer: string;
}

export const DEPOSITO_FAQ_ITEMS: DepositoFaqItem[] = [
  {
    title: "Abrir, fechar e status",
    answer: "Use: abrir, fechar ou status para atualizar a operacao.",
  },
  {
    title: "Pedido atual",
    answer: "Use: pedidos ou pedido atual para ver o que esta em andamento.",
  },
  {
    title: "Aceitar e recusar",
    answer: "Use: aceitar para confirmar. Se precisar recusar, use recusar e informe o motivo.",
  },
  {
    title: "Preparo e ETA",
    answer: "Depois de aceitar: separando e eta 20 (ou outro tempo em minutos).",
  },
  {
    title: "Saiu e entregue",
    answer: "Quando sair para entrega: saiu. Quando finalizar: entregue.",
  },
  {
    title: "Pausa temporaria",
    answer: "Use: pausar, pausa 30, pausa 60 ou pausa 120 para segurar novos pedidos.",
  },
  {
    title: "Problemas comuns",
    answer: "Se travar algo, mande status ou pedidos para retomar contexto rapido.",
  },
  {
    title: "Boas praticas",
    answer: "Atualize ETA real, recuse com motivo curto e feche o pedido assim que entregar.",
  },
];

export function buildDepositoFaqChunks(maxItemsPerChunk = 2): string[] {
  const safeSize = Math.max(1, Math.min(4, Math.floor(maxItemsPerChunk)));
  const chunks: string[] = [];
  for (let index = 0; index < DEPOSITO_FAQ_ITEMS.length; index += safeSize) {
    const slice = DEPOSITO_FAQ_ITEMS.slice(index, index + safeSize);
    const body = slice
      .map((item, localIndex) => `${index + localIndex + 1}. ${item.title}\n${item.answer}`)
      .join("\n\n");
    chunks.push(body);
  }
  return chunks;
}

