import type { IntentName, UserType } from "./types";

export type DomainRoute =
  | "deposito_open"
  | "deposito_close"
  | "deposito_status"
  | "deposito_orders_menu"
  | "deposito_order_current"
  | "deposito_order_accept"
  | "deposito_order_decline"
  | "deposito_order_eta"
  | "deposito_order_preparing"
  | "deposito_order_out_for_delivery"
  | "deposito_order_done"
  | "deposito_pause"
  | "cliente_save_bairro"
  | "cliente_start_order"
  | "cliente_search"
  | "cliente_horario"
  | "cliente_entrega"
  | "cliente_produtos"
  | "cliente_menu"
  | "cliente_precadastro"
  | "help"
  | "menu"
  | "cancel"
  | "complaint"
  | "human"
  | "greeting"
  | "closing"
  | "fallback";

export function resolveDomainRoute(params: {
  role: UserType;
  intent: IntentName;
}): DomainRoute {
  if (params.role === "deposito") {
    if (params.intent === "deposito_abrir") return "deposito_open";
    if (params.intent === "deposito_fechar") return "deposito_close";
    if (params.intent === "deposito_status") return "deposito_status";
    if (params.intent === "deposito_pedidos_menu") return "deposito_orders_menu";
    if (params.intent === "deposito_pedido_atual") return "deposito_order_current";
    if (params.intent === "deposito_aceitar_pedido") return "deposito_order_accept";
    if (params.intent === "deposito_recusar_pedido") return "deposito_order_decline";
    if (params.intent === "deposito_definir_eta") return "deposito_order_eta";
    if (params.intent === "deposito_iniciar_preparo") return "deposito_order_preparing";
    if (params.intent === "deposito_sair_entrega") return "deposito_order_out_for_delivery";
    if (params.intent === "deposito_concluir_entrega") return "deposito_order_done";
    if (params.intent === "deposito_pausar") return "deposito_pause";
    if (params.intent === "ajuda") return "help";
    if (params.intent === "menu") return "menu";
    if (params.intent === "cancelar") return "cancel";
    if (params.intent === "reclamacao") return "complaint";
    if (params.intent === "humano") return "human";
    if (params.intent === "saudacao") return "greeting";
    if (params.intent === "encerramento") return "closing";
    if (params.intent === "cliente_informar_bairro") return "cliente_save_bairro";
    return "fallback";
  }

  if (params.intent === "cliente_informar_bairro") return "cliente_save_bairro";
  if (params.intent === "cliente_iniciar_pedido") return "cliente_start_order";
  if (params.intent === "cliente_buscar_deposito") return "cliente_search";
  if (params.intent === "cliente_menu") return "cliente_menu";
  if (params.intent === "cliente_iniciar_precadastro") return "cliente_precadastro";
  if (params.intent === "ajuda") return "help";
  if (params.intent === "menu") return "menu";
  if (params.intent === "cancelar") return "cancel";
  if (params.intent === "reclamacao") return "complaint";
  if (params.intent === "humano") return "human";
  if (params.intent === "encerramento") return "closing";
  if (params.intent === "cliente_consultar_horario") return "cliente_horario";
  if (params.intent === "cliente_consultar_entrega") return "cliente_entrega";
  if (params.intent === "cliente_consultar_produtos") return "cliente_produtos";
  if (params.intent === "saudacao") return "greeting";
  return "fallback";
}
