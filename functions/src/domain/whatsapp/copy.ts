// TODO: Migrate strings from this object to DuduResponses
// See: domain/whatsapp/persona/duduResponses.ts (canonical response strings)
// This file is being phased out in favor of centralized copy management.

export const botCopy = {
  cliente: {
    // askBairro and noDepositos have been migrated to DuduResponses.ts
    listPrefix: "Depósitos abertos no teu bairro agora 🍺",
  },
  deposito: {
    askBairro:
      "Rapaz, antes de operar preciso saber o bairro do teu depósito. Me manda só o bairro, ex: Janga.",
    bairroSalvo: "Arretado! Bairro salvo. Agora posso operar teu status.",
    help:
      "Comandos do depósito: abrir, fechar, status. Usa os botões ou digita.",
    opened: "Arretado! Marquei teu depósito como *ABERTO* 🟢",
    closed: "Fechou! Marquei teu depósito como *FECHADO* 🔴",
    status: (aberto: boolean, bairro: string | undefined): string =>
      `Status atual: ${aberto ? "🟢 ABERTO" : "🔴 FECHADO"}${bairro ? ` | Bairro: ${bairro}` : ""}.`,
    unknown: "Oxe, não entendi não. Usa: abrir, fechar ou status.",
  },
  fallback: {
    invalid: "Vixe, não consegui entender essa mensagem não. Tenta de novo em texto!",
  },
};

export const clienteConfirmButtons = [
  { id: "sim", title: "Sim, pode ir! 🚀" },
  { id: "nao", title: "Não, cancela" },
];

export const clienteRetryButtons = [
  { id: "outro_bairro", title: "Tentar outro bairro" },
  { id: "aguardar", title: "Aguardar abertura" },
];

export const depositoInteractiveButtons = [
  { id: "abrir", title: "Abrir" },
  { id: "pedidos", title: "Pedidos" },
  { id: "status", title: "Status" },
];

export const depositoOrdersButtons = [
  { id: "aceitar", title: "Aceitar" },
  { id: "eta", title: "ETA" },
  { id: "entregue", title: "Entregue" },
];

export const depositoPauseButtons = [
  { id: "pausa 30", title: "Pausa 30m" },
  { id: "pausa 60", title: "Pausa 60m" },
  { id: "pausa 120", title: "Pausa 120m" },
];
