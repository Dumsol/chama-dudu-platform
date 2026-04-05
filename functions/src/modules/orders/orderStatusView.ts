// functions/src/modules/orders/orderStatusView.ts
import type { OrderStatus, FulfillmentStatus, PedidoCanal } from "../common/types";

// ✅ compatível com macro-terminal “DONE”
type OrderStatusLike = OrderStatus | "DONE";

type StepKey =
  | "REALIZADO"
  | "ENVIADO"
  | "ACEITO"
  | "SEPARANDO"
  | "A_CAMINHO"
  | "ENTREGUE"
  | "CONCLUIDO";

const STEPS: Array<{ key: StepKey; label: string }> = [
  { key: "REALIZADO", label: "Pedido realizado" },
  { key: "ENVIADO", label: "Enviado pro depósito" },
  { key: "ACEITO", label: "Pedido aceito" },
  { key: "SEPARANDO", label: "Separando" },
  { key: "A_CAMINHO", label: "A caminho" },
  { key: "ENTREGUE", label: "Entregue" },
  { key: "CONCLUIDO", label: "Concluído" },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function bar(pct: number) {
  const total = 8;
  const filled = clamp(Math.round((pct / 100) * total), 0, total);
  return `${"▰".repeat(filled)}${"▱".repeat(total - filled)} ${pct}%`;
}

function formatBRL(value: number): string {
  return `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
}

function canalLabel(canal: PedidoCanal | string | null | undefined): string | null {
  if (!canal) return null;
  if (canal === "DELIVERY") return "Delivery";
  if (canal === "RETIRADA") return "Retirada";
  if (canal === "CONSULTA") return "Consulta";
  return String(canal);
}

function computeProgress(params: {
  status: OrderStatusLike;
  fulfillment: FulfillmentStatus;
}) {
  const { status, fulfillment } = params;

  // finais ruins
  if (status === "CANCELED") return { pct: 0, note: "❌ Cancelado" };
  if (status === "DECLINED") return { pct: 0, note: "❌ Recusado" };
  if (status === "TIMEOUT") return { pct: 0, note: "⚠️ Expirou (sem resposta)" };

  // macro terminal bom
  if (status === "DONE") return { pct: 100, note: "✅ Concluído" };

  // antes de aceitar
  if (status === "CREATED") return { pct: 15, note: "📝 Montando pedido" };
  if (status === "ROUTED") return { pct: 25, note: "📌 Escolhendo depósito" };
  if (status === "NOTIFIED") return { pct: 35, note: "📨 Aguardando resposta do depósito" };

  // aceito
  if (status === "ACCEPTED") {
    if (fulfillment === "SEPARANDO") return { pct: 60, note: "⏳ Separando teu pedido" };
    if (fulfillment === "A_CAMINHO") return { pct: 80, note: "🛵 Entrega iniciada" };
    if (fulfillment === "ENTREGUE_PRESUMIDO") return { pct: 95, note: "✅ Quase lá (entrega presumida)" };
    if (fulfillment === "ENTREGUE_CONFIRMADO") return { pct: 100, note: "✅ Entregue" };
    return { pct: 50, note: "✅ Pedido aceito" };
  }

  return { pct: 10, note: "⏳ Processando" };
}

type StepState = "DONE" | "DOING" | "PENDING" | "EMPTY";

function stepState(key: StepKey, params: { status: OrderStatusLike; fulfillment: FulfillmentStatus }): StepState {
  const { status, fulfillment } = params;

  if (status === "CANCELED" || status === "DECLINED" || status === "TIMEOUT") return "EMPTY";

  if (key === "REALIZADO") return "DONE";

  if (key === "ENVIADO") {
    if (status === "ROUTED" || status === "NOTIFIED" || status === "ACCEPTED" || status === "DONE") return "DONE";
    return "PENDING";
  }

  if (key === "ACEITO") {
    if (status === "ACCEPTED" || status === "DONE") return "DONE";
    if (status === "NOTIFIED" || status === "ROUTED") return "PENDING";
    return "EMPTY";
  }

  if (key === "SEPARANDO") {
    if (status === "DONE") return "DONE";
    if (status === "ACCEPTED" && (fulfillment === "SEPARANDO" || fulfillment === "NONE")) return "DOING";
    if (status === "ACCEPTED" && (fulfillment === "A_CAMINHO" || fulfillment.startsWith("ENTREGUE"))) return "DONE";
    return status === "ACCEPTED" ? "PENDING" : "EMPTY";
  }

  if (key === "A_CAMINHO") {
    if (status === "DONE") return "DONE";
    if (status === "ACCEPTED" && fulfillment === "A_CAMINHO") return "DOING";
    if (status === "ACCEPTED" && fulfillment.startsWith("ENTREGUE")) return "DONE";
    return status === "ACCEPTED" ? "PENDING" : "EMPTY";
  }

  if (key === "ENTREGUE") {
    if (status === "DONE") return "DONE";
    if (fulfillment === "ENTREGUE_CONFIRMADO") return "DONE";
    if (fulfillment === "ENTREGUE_PRESUMIDO") return "DOING";
    return status === "ACCEPTED" ? "PENDING" : "EMPTY";
  }

  if (key === "CONCLUIDO") {
    return status === "DONE" ? "DONE" : "PENDING";
  }

  return "EMPTY";
}

function icon(state: StepState) {
  if (state === "DONE") return "✅";
  if (state === "DOING") return "⏳";
  return "⬜";
}

export function buildOrderStatusMessage(params: {
  orderId: string;
  orderLabel?: string | null;
  status: OrderStatusLike;
  fulfillment: FulfillmentStatus;
  details?: {
    bairro?: string | null;
    canal?: PedidoCanal | string | null;
    depositoNome?: string | null;
    enderecoEntrega?: string | null;
    valorTotalPedido?: number | null;
    subtotal?: number | null;
    serviceFee?: number | null;
    totalToCollect?: number | null;
    needsValorConfirm?: boolean | null;
  };
}) {
  const progress = computeProgress({ status: params.status, fulfillment: params.fulfillment });

  const title = params.orderLabel?.trim()
    ? `📦 ${params.orderLabel.trim()}`
    : `📦 Pedido ${params.orderId}`;

  const detailLines: string[] = [];
  const b = params.details?.bairro?.trim() ? params.details?.bairro?.trim() : null;
  const c = canalLabel(params.details?.canal ?? null);
  const dep = params.details?.depositoNome?.trim() ? params.details?.depositoNome?.trim() : null;
  const end = params.details?.enderecoEntrega?.trim() ? params.details?.enderecoEntrega?.trim() : null;
  const v = typeof params.details?.valorTotalPedido === "number" ? params.details?.valorTotalPedido : null;
  const subtotal = typeof params.details?.subtotal === "number" ? params.details?.subtotal : null;
  const serviceFee = typeof params.details?.serviceFee === "number" ? params.details?.serviceFee : null;
  const totalToCollect = typeof params.details?.totalToCollect === "number" ? params.details?.totalToCollect : null;

  if (b) detailLines.push(`📍 Bairro: ${b}`);
  if (c) detailLines.push(`🚚 Canal: ${c}`);
  if (dep) detailLines.push(`🏪 Depósito: ${dep}`);
  if (end) detailLines.push(`🏠 Endereço: ${end}`);
  if (v != null) detailLines.push(`💰 Valor: ${formatBRL(v)}`);
  if (subtotal != null) detailLines.push(`Subtotal: ${formatBRL(subtotal)}`);
  if (serviceFee != null) detailLines.push(`Taxa Dudu: ${formatBRL(serviceFee)}`);
  if (totalToCollect != null) detailLines.push(`Total a cobrar: ${formatBRL(totalToCollect)}`);

  const needsValorConfirm = Boolean(params.details?.needsValorConfirm);

  const lines = STEPS.map((s) => {
    const st = stepState(s.key, { status: params.status, fulfillment: params.fulfillment });
    return `${icon(st)} ${s.label}`;
  });

  const out: string[] = [];
  out.push(title);
  out.push("");
  out.push(`${bar(progress.pct)}  (atualizado agora)`);
  out.push(`${progress.note}`);

  if (needsValorConfirm) {
    out.push("");
    out.push("⚠️ Falta tu confirmar o valor: manda “tá certo” ou “tá errado”.");
  }

  if (detailLines.length) {
    out.push("");
    out.push("— Detalhes —");
    out.push(...detailLines);
  }

  out.push("");
  out.push(...lines);

  return out.join("\n");
}
