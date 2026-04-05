/**
 * whatsappButtons.ts
 *
 * Catálogo de botões e respostas interativas do Chama Dudu.
 * Cada função retorna um BotResponse pronto para ser despachado pelo processor.ts.
 *
 * Regras do corpus v4:
 * - Máx 3 botões por mensagem (limitação da API Meta)
 * - IDs devem ser estáveis e semânticos (usados pelo stateEngine para routing)
 * - Location request é do tipo "interactive/location_request_message"
 */

import type { BotResponse } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// GATE DE MAIORIDADE (Bloco 4 — Produto Sensível / Bebida Alcoólica)
// ─────────────────────────────────────────────────────────────────────────────

export function buildAgeGateButtons(productName?: string): BotResponse {
  const produto = productName ? ` de ${productName}` : "";
  return {
    body:
      `Opa! Para pedir bebida alcoólica${produto}, preciso confirmar: *você tem 18 anos ou mais?* 🪪\n\n` +
      `Ao confirmar, você declara ser maior de idade (Lei nº 9.294/96).`,
    buttons: [
      { id: "age_confirm_yes", title: "✅ Sim, tenho +18" },
      { id: "age_confirm_no", title: "❌ Não tenho" },
    ],
  };
}

/**
 * Trunca o título de um botão para o limite do WhatsApp (20 caracteres).
 */
export function truncateButtonTitle(title: string): string {
  if (title.length <= 20) return title;
  return title.slice(0, 17).trim() + "...";
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRMAÇÃO DE PEDIDO (Bloco 8 — Checkout)
// ─────────────────────────────────────────────────────────────────────────────

export function buildOrderConfirmButtons(params: {
  productSummary: string;
  depositoName: string;
}): BotResponse {
  return {
    body:
      `🛒 *Resumo do Pedido:*\n\n` +
      `📦 ${params.productSummary}\n` +
      `🏢 Depósito: ${params.depositoName}\n\n` +
      `Podemos confirmar? 🚀`,
    buttons: [
      { id: "order_confirm_yes", title: "✅ Confirmar Pedido" },
      { id: "order_confirm_no",  title: "❌ Cancelar" },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PEDIDO DUPLICADO (GR-11)
// ─────────────────────────────────────────────────────────────────────────────

export function buildDuplicateOrderButtons(customBody?: string): BotResponse {
  return {
    body: customBody ||
      `Ei, você já tem um pedido ativo! 🤔\n\n` +
      `Quer cancelar o pedido atual e fazer um novo?`,
    buttons: [
      { id: "duplicate_yes", title: "Sim, cancelar e refazer" },
      { id: "duplicate_no", title: "Não, manter o atual" },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOLICITAÇÃO DE LOCALIZAÇÃO GPS (GR-01 — Bairro não identificado)
// ─────────────────────────────────────────────────────────────────────────────

export function buildLocationRequestMessage(context?: "bairro" | "entrega"): BotResponse {
  const body =
    context === "entrega"
      ? `Para enviar o pedido ao depósito, preciso do seu endereço completo. 📍\nClique no botão abaixo para compartilhar sua localização:`
      : `Não consegui identificar seu bairro. 📍\nPode me enviar sua localização para eu te ajudar melhor?`;

  return {
    body,
    isLocationRequest: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRMAÇÃO DE BAIRRO (após GPS recebido)
// ─────────────────────────────────────────────────────────────────────────────

export function buildBairroConfirmButtons(bairroName: string, body?: string): BotResponse {
  const truncatedBairro = truncateButtonTitle(`Sim, em ${bairroName}`);
  
  return {
    body: body || `📍 Localizei você em *${bairroName}*. Tá certo?`,
    buttons: [
      { id: "bairro_confirm_yes", title: truncatedBairro },
      { id: "bairro_confirm_no",  title: "Mudar bairro 📍" },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUTO INDISPONÍVEL / ESGOTADO (GR-05)
// ─────────────────────────────────────────────────────────────────────────────

export function buildOutOfStockButtons(productName: string): BotResponse {
  return {
    body:
      `😕 Poxa, *${productName}* está esgotado nos depósitos do seu bairro no momento.\n` +
      `Posso te ajudar com outra opção?`,
    buttons: [
      { id: "try_alternative", title: "Ver alternativas" },
      { id: "cancel_order", title: "Cancelar" },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ACEITAR / RECUSAR PEDIDO (VISÃO DEPÓSITO)
// ─────────────────────────────────────────────────────────────────────────────

export function buildDepositoOrderButtons(params: {
  orderId: string;
  productSummary: string;
  bairro: string;
}): BotResponse {
  return {
    body:
      `🔔 *Novo Pedido!*\n` +
      `📦 ${params.productSummary}\n` +
      `📍 Bairro: ${params.bairro}\n\n` +
      `ID: \`${params.orderId.slice(-8)}\``,
    buttons: [
      { id: `order_accept_${params.orderId}`, title: "✅ Aceitar" },
      { id: `order_decline_${params.orderId}`, title: "❌ Recusar" },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDEREÇO PARA ENTREGA (solicitação ao cliente após pedido aceito)
// ─────────────────────────────────────────────────────────────────────────────

export function buildDeliveryAddressRequest(): BotResponse {
  return {
    body:
      `Ótimo! Para finalizar o pedido, preciso do endereço de entrega. 🏠\n` +
      `Clique para compartilhar sua localização ou me informe o endereço completo:`,
    isLocationRequest: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AVALIAÇÃO PÓS-ENTREGA (Bloco 13)
// ─────────────────────────────────────────────────────────────────────────────

export function buildPostDeliveryRatingButtons(): BotResponse {
  return {
    body: `Seu pedido foi entregue! 🎉\nComo foi a experiência?`,
    buttons: [
      { id: "rate_5", title: "⭐⭐⭐⭐⭐ Ótimo!" },
      { id: "rate_3", title: "⭐⭐⭐ Regular" },
      { id: "rate_bad", title: "👎 Problema" },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MENU PRINCIPAL (atalho para clientes)
// ─────────────────────────────────────────────────────────────────────────────

export function buildMainMenuButtons(customBody?: string): BotResponse {
  return {
    body: customBody || `Meu irmão! Sou o *Dudu* 🤙\nComo posso te ajudar hoje? `,
    buttons: [
      { id: "menu_order", title: "🛒 Fazer pedido" },
      { id: "menu_track", title: "📦 Acompanhar pedido" },
      { id: "menu_help", title: "❓ Ajuda" },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMA DE PAGAMENTO (Checkout — pergunta antes de confirmar pedido)
// ─────────────────────────────────────────────────────────────────────────────

export function buildPaymentMethodButtons(productSummary?: string): BotResponse {
  const produto = productSummary ? `\n📦 *Pedido:* ${productSummary}` : "";
  return {
    body:
      `Quase lá! 💳${produto}\n\n` +
      `Como você vai pagar? (O pagamento é feito na entrega)`,
    buttons: [
      { id: "pay_pix", title: "💚 PIX" },
      { id: "pay_cartao", title: "💳 Cartão" },
      { id: "pay_dinheiro", title: "💵 Dinheiro" },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EMBALAGEM / PACKAGING (B05)
// ─────────────────────────────────────────────────────────────────────────────

export function buildBeveragePackagingButtons(brand: string | null): BotResponse {
  const brandLabel = brand ?? "Cerveja";
  return {
    body: `${brandLabel} em qual embalagem? 🍺`,
    buttons: [
      { id: "pack_lata_350", title: "Lata 350ml" },
      { id: "pack_long_neck", title: "Long Neck" },
      { id: "pack_garrafa_600", title: "Garrafa 600ml" },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// VASILHAME (Litrão / Garrafão — B06)
// ─────────────────────────────────────────────────────────────────────────────

export function buildVasilhameButtons(): BotResponse {
  return {
    body: "Você já tem o vasilhame (garrafa vazia ou botijão) para troca? 🫙",
    buttons: [
      { id: "vasilhame_confirm_yes", title: "Sim, eu tenho" },
      { id: "vasilhame_confirm_no", title: "Não, buscar novo" },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DEV PAINEL — MENU PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export function buildDevPanelMainMenu(): BotResponse {
  return {
    body: "✅ *Painel Dev* — escolha uma operação:",
    buttons: [
      { id: "dev_orders_list", title: "📋 Ver pedidos" },
      { id: "dev_depositos_status", title: "🏪 Status depósitos" },
      { id: "dev_stuck_orders", title: "❄️ Pedidos congelados" },
    ],
  };
}

export function buildDevOrdersListResponse(bairro?: string): BotResponse {
  return {
    body: bairro
      ? `📋 *Pedidos em ${bairro}:*\n\nDigite um bairro para filtrar ou "todos" para listar tudo`
      : `📋 *Pedidos ativos* — qual bairro? (ou "todos")`,
  };
}

export function buildDevDepositosStatusResponse(): BotResponse {
  return {
    body: `🏪 *Status de depósitos* — um momento, carregando...`,
  };
}

export function buildDevStuckOrdersResponse(): BotResponse {
  return {
    body: `❄️ *Pedidos congelados* (> SLA) — carregando...`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAPEAMENTO DE IDs → INTENÇÃO SEMÂNTICA
// Usado pelo stateEngine para interpretar cliques de botão
// ─────────────────────────────────────────────────────────────────────────────

export type ButtonSemanticAction =
  | "age_confirmed"
  | "age_rejected"
  | "order_confirmed"
  | "order_rejected"
  | "duplicate_confirmed"
  | "duplicate_rejected"
  | "gps_confirmed"
  | "gps_rejected"
  | "try_alternative"
  | "cancel_order"
  | "order_accept"
  | "order_decline"
  | "delivery_address_sent"
  | "rating_good"
  | "rating_mid"
  | "rating_bad"
  | "vasilhame_confirmed"
  | "vasilhame_rejected"
  | "pack_lata"
  | "pack_long_neck"
  | "pack_garrafa"
  | "menu_order"
  | "menu_track"
  | "menu_help"
  | "payment_pix"
  | "payment_cartao"
  | "payment_dinheiro"
  | "dev_maintenance_on"
  | "dev_maintenance_off"
  | "dev_orders_list"
  | "dev_depositos_status"
  | "dev_stuck_orders"
  | "dev_exit"
  | "unknown";

export function resolveButtonAction(interactiveId: string): ButtonSemanticAction {
  const id = String(interactiveId ?? "").toLowerCase();

  if (id === "age_confirm_yes") return "age_confirmed";
  if (id === "age_confirm_no") return "age_rejected";
  if (id === "order_confirm_yes") return "order_confirmed";
  if (id === "order_confirm_no") return "order_rejected";
  if (id === "duplicate_yes") return "duplicate_confirmed";
  if (id === "duplicate_no") return "duplicate_rejected";
  if (id === "gps_confirm_yes" || id === "bairro_confirm_yes") return "gps_confirmed";
  if (id === "gps_confirm_no" || id === "bairro_confirm_no") return "gps_rejected";
  if (id === "try_alternative") return "try_alternative";
  if (id === "cancel_order") return "cancel_order";
  if (id.startsWith("order_accept_")) return "order_accept";
  if (id.startsWith("order_decline_")) return "order_decline";
  if (id === "rate_5") return "rating_good";
  if (id === "rate_3") return "rating_mid";
  if (id === "rate_bad") return "rating_bad";
  if (id === "vasilhame_confirm_yes") return "vasilhame_confirmed";
  if (id === "vasilhame_confirm_no") return "vasilhame_rejected";
  if (id === "pack_lata_350") return "pack_lata";
  if (id === "pack_long_neck") return "pack_long_neck";
  if (id === "pack_garrafa_600") return "pack_garrafa";
  if (id === "menu_order") return "menu_order";
  if (id === "menu_track") return "menu_track";
  if (id === "menu_help") return "menu_help";
  if (id === "pay_pix") return "payment_pix";
  if (id === "pay_cartao") return "payment_cartao";
  if (id === "pay_dinheiro") return "payment_dinheiro";
  if (id === "dev_maintenance_on") return "dev_maintenance_on";
  if (id === "dev_maintenance_off") return "dev_maintenance_off";
  if (id === "dev_orders_list") return "dev_orders_list";
  if (id === "dev_depositos_status") return "dev_depositos_status";
  if (id === "dev_stuck_orders") return "dev_stuck_orders";
  if (id === "dev_exit") return "dev_exit";

  return "unknown";
}
