import * as logger from "firebase-functions/logger";
import { isFeatureEnabled } from "../../infra/config/featureFlags";
import { STICKERS } from "../../infra/config/stickers";
import {
  depositosCol,
  ordersCol,
} from "../../infra/firestore/duduPaths";
import {
  sendWhatsAppTextMessage,
  sendWhatsAppButtonsMessage,
  sendWhatsAppStickerMessage,
  sendWhatsAppTemplateMessage,
} from "../whatsapp/send";
import type { Order, Deposito } from "../common/types";
import { FieldValue } from "../../infra/config/firebase";
import { logEvent } from "../../infra/obs/eventLogService";

function getPublicCode(order: Order): string {
  const code = (order as any).publicCode ?? order.id;
  return String(code || order.id);
}

function canalLabel(order: Order): string {
  if (order.canal === "DELIVERY") return "DELIVERY";
  if (order.canal === "RETIRADA") return "RETIRADA";
  if ((order as any).canal === "CONSULTA") return "CONSULTA";
  return "N/D";
}

function formatEndereco(order: Order): string {
  if (order.canal !== "DELIVERY") {
    if (order.canal === "RETIRADA") return "RETIRADA no local";
    if ((order as any).canal === "CONSULTA") return "CONSULTA no local";
    return "LOCAL nao informado";
  }

  const endereco =
    typeof (order as any).enderecoEntrega === "string"
      ? (order as any).enderecoEntrega.trim()
      : "";
  const cep = typeof (order as any).cepEntrega === "string" ? (order as any).cepEntrega.trim() : "";
  const ref =
    typeof (order as any).referenciaEntrega === "string"
      ? (order as any).referenciaEntrega.trim()
      : "";

  const parts: string[] = [];
  if (endereco) parts.push(endereco);
  if (cep) parts.push(`CEP: ${cep}`);
  if (ref) parts.push(`Ref: ${ref}`);

  return parts.length ? parts.join("\n") : "endereco nao informado";
}

function motivoHeader(motivo: "NOVO" | "REROUTE"): string {
  return motivo === "NOVO" ? "NOVO PEDIDO" : "PEDIDO REROUTE";
}

function buildResumoPedido(order: Order): string {
  const code = getPublicCode(order);
  const bairro = String(order.bairro ?? "").trim() || "bairro nao informado";
  const itens = String(order.itensDescricao ?? "").trim() || "sem descricao de itens (cliente ainda nao detalhou)";
  const end = formatEndereco(order);

  const linhas: string[] = [];
  linhas.push(`RESUMO DO PEDIDO - ${code}`);
  linhas.push(`Canal: ${canalLabel(order)}`);
  linhas.push(`Bairro: ${bairro}`);
  linhas.push("");
  linhas.push("Itens:");
  linhas.push(itens);
  linhas.push("");
  linhas.push("Entrega/Retirada:");
  linhas.push(end);

  return linhas.join("\n");
}

function buildRodapeOperacional(): string {
  return (
    "\n\nSe der pra atender: clica *Aceitar*.\n" +
    "Se nao der: clica *Recusar* e escolhe o motivo (Sem motoboy / Sem estoque / Ta fechando).\n" +
    "Depois que aceitar, manda o total tipo: *deu 35* (ou *29,90*).\n" +
    "Quando sair: *saiu*. Quando entregar: *entregue*."
  );
}

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const SERVICE_FEE_DEFAULT = 0.99;
const FIRST_ORDER_TEMPLATE_NAME =
  process.env.WA_TEMPLATE_FIRST_ORDER_NAME ??
  process.env.WHATSAPP_TEMPLATE_FIRST_ORDER ??
  "first_order_deposito_v1";

function formatBRL(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

function buildDayKey(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  const day = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${year}${month}${day}`;
}

function buildFirstOrderText(order: Order): string {
  const resumo = buildResumoPedido(order);
  const pricing = (order as any)?.pricing ?? {};
  const subtotal =
    typeof pricing.subtotal === "number"
      ? pricing.subtotal
      : typeof (order as any)?.valorTotalPedido === "number"
        ? (order as any).valorTotalPedido
        : 0;
  const serviceFee =
    typeof pricing.serviceFee === "number" ? pricing.serviceFee : SERVICE_FEE_DEFAULT;
  const total = Math.round((subtotal + serviceFee) * 100) / 100;
  return (
    `${resumo}\n\nTotal: ${formatBRL(total)}\n` +
    "Cobrar +R$ 0,99 do cliente na entrega (taxa do Dudu)."
  );
}

function buildFirstOrderTemplateComponents(order: Order): any[] {
  const pricing = (order as any)?.pricing ?? {};
  const subtotal =
    typeof pricing.subtotal === "number"
      ? pricing.subtotal
      : typeof (order as any)?.valorTotalPedido === "number"
        ? (order as any).valorTotalPedido
        : 0;
  const serviceFee =
    typeof pricing.serviceFee === "number" ? pricing.serviceFee : SERVICE_FEE_DEFAULT;
  const total = Math.round((subtotal + serviceFee) * 100) / 100;
  const body = [
    getPublicCode(order),
    String(order.itensDescricao ?? "sem itens").slice(0, 240),
    String(order.bairro ?? "bairro nao informado").slice(0, 120),
    formatBRL(total),
  ];

  return [
    {
      type: "body",
      parameters: body.map((text) => ({ type: "text", text })),
    },
    {
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "payload", payload: "DEP_ACEITAR" }],
    },
    {
      type: "button",
      sub_type: "quick_reply",
      index: "1",
      parameters: [{ type: "payload", payload: "DEP_RECUSAR" }],
    },
  ];
}

async function lockFirstOrderUtilityOnce(params: {
  tenantCnpj: string;
  depositoId: string;
  timezone?: string | null;
}): Promise<{ allowed: boolean; dayKey: string }> {
  const tz = String(params.timezone ?? DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE;
  const dayKey = buildDayKey(tz);
  const fieldKey = `firstOrderUtilitySentAt_${dayKey}`;

  const depCol = depositosCol(params.tenantCnpj);
  const depRef = depCol.doc(params.depositoId);
  let allowed = false;

  await depCol.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(depRef);
    if (!snap.exists) return;
    const d = snap.data() as any;
    const existing = d?.reminders?.[fieldKey] ?? null;
    if (existing) return;

    tx.set(
      depRef,
      {
        reminders: {
          ...(d?.reminders),
          [fieldKey]: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    allowed = true;
  });

  return { allowed, dayKey };
}

async function sendFirstOrderUtilityMessage(params: {
  tenantCnpj: string;
  phoneNumberId: string;
  order: Order;
  deposito: Deposito;
}): Promise<{ sent: boolean; usedTemplate: boolean }> {
  if (params.deposito && params.deposito.routeEligible === false) {
    return { sent: false, usedTemplate: false };
  }
  const tz = (params.deposito as any)?.timezone ?? DEFAULT_TIMEZONE;
  const lock = await lockFirstOrderUtilityOnce({
    tenantCnpj: params.tenantCnpj,
    depositoId: params.deposito.id,
    timezone: tz,
  }).catch(() => ({ allowed: false, dayKey: "" }));

  if (!lock.allowed) return { sent: false, usedTemplate: false };

  const body = buildFirstOrderText(params.order);
  const buttons = [
    { id: "DEP_ACEITAR", title: "Aceitar" },
    { id: "DEP_RECUSAR", title: "Recusar" },
  ];

  if (!FIRST_ORDER_TEMPLATE_NAME) {
    await logEvent({
      tenantCnpj: params.tenantCnpj,
      eventName: "WA_TEMPLATE_FAILED",
      orderId: params.order.id,
      depositoId: params.deposito.id,
      payload: { reason: "MISSING_TEMPLATE_NAME", templateName: null },
    }).catch(() => void 0);

    await sendWhatsAppButtonsMessage({
      tenantCnpj: params.tenantCnpj,
      phoneNumberId: params.phoneNumberId,
      to: params.deposito.waId,
      body,
      buttons,
      orderId: params.order.id,
    }).catch(() => void 0);
    return { sent: true, usedTemplate: false };
  }

  try {
    await sendWhatsAppTemplateMessage({
      tenantCnpj: params.tenantCnpj,
      phoneNumberId: params.phoneNumberId,
      to: params.deposito.waId,
      name: FIRST_ORDER_TEMPLATE_NAME,
      components: buildFirstOrderTemplateComponents(params.order),
      orderId: params.order.id,
    });
    return { sent: true, usedTemplate: true };
  } catch (err: any) {
    await logEvent({
      tenantCnpj: params.tenantCnpj,
      eventName: "WA_TEMPLATE_FAILED",
      orderId: params.order.id,
      depositoId: params.deposito.id,
      payload: {
        reason: err?.message ?? String(err),
        templateName: FIRST_ORDER_TEMPLATE_NAME,
      },
    }).catch(() => void 0);

    await sendWhatsAppButtonsMessage({
      tenantCnpj: params.tenantCnpj,
      phoneNumberId: params.phoneNumberId,
      to: params.deposito.waId,
      body,
      buttons,
      orderId: params.order.id,
    }).catch(() => void 0);
    return { sent: true, usedTemplate: false };
  }
}

async function touchDepositoLastRoutedAtBestEffort(params: {
  tenantCnpj: string;
  depositoId: string;
}): Promise<void> {
  await depositosCol(params.tenantCnpj)
    .doc(params.depositoId)
    .set(
      {
        lastRoutedAtMs: Date.now(),
        lastRoutedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch(() => void 0);
}

async function lockNotifyLogOnce(params: {
  tenantCnpj: string;
  orderId: string;
  depositoId: string;
  motivo: "NOVO" | "REROUTE";
}): Promise<{ allowed: boolean; alreadyNotified: boolean }> {
  const orders = ordersCol(params.tenantCnpj);
  const orderRef = orders.doc(params.orderId);

  let result: { allowed: boolean; alreadyNotified: boolean } = { allowed: true, alreadyNotified: false };

  await orders.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      result = { allowed: false, alreadyNotified: false };
      return;
    }

    const d = snap.data() as any;
    const raw = d?.notifyLog;
    const notifyLog: Record<string, unknown> =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

    const existing = (notifyLog as any)[params.depositoId] ?? null;
    const already = Boolean(existing);

    // Anti-spam: nao reenviar NOTIFIED pro mesmo deposito (exceto reroute explicito)
    if (already && params.motivo === "NOVO") {
      result = { allowed: false, alreadyNotified: true };
      return;
    }

    tx.set(
      orderRef,
      {
        notifyLog: {
          ...notifyLog,
          [params.depositoId]: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    result = { allowed: true, alreadyNotified: already };
  });

  return result;
}

async function clearNotifyLogKeyBestEffort(params: {
  tenantCnpj: string;
  orderId: string;
  depositoId: string;
}): Promise<void> {
  const orders = ordersCol(params.tenantCnpj);
  const orderRef = orders.doc(params.orderId);
  await orders.firestore
    .runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) return;

      const raw = (snap.data() as any)?.notifyLog;
      const notifyLog: Record<string, unknown> =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? { ...(raw as Record<string, unknown>) }
          : {};

      if (!Object.prototype.hasOwnProperty.call(notifyLog, params.depositoId)) return;

      delete notifyLog[params.depositoId];

      tx.set(
        orderRef,
        {
          notifyLog,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    })
    .catch(() => void 0);
}

export async function encaminharPedidoParaDeposito(params: {
  tenantCnpj: string;
  phoneNumberId: string;
  order: Order;
  deposito: Deposito;
  motivo: "NOVO" | "REROUTE";
}): Promise<void> {
  const { tenantCnpj, phoneNumberId, order, deposito, motivo } = params;

  const lock = await lockNotifyLogOnce({
    tenantCnpj,
    orderId: order.id,
    depositoId: deposito.id,
    motivo,
  }).catch(() => ({ allowed: true, alreadyNotified: false }));

  if (!lock.allowed) {
    logger.info("Notificacao suprimida (anti-spam notifyLog)", {
      orderId: order.id,
      publicCode: getPublicCode(order),
      depositoId: deposito.id,
      motivo,
    });
    return;
  }

  await touchDepositoLastRoutedAtBestEffort({ tenantCnpj, depositoId: deposito.id });

  const body = `${motivoHeader(motivo)}\n\n${buildResumoPedido(order)}${buildRodapeOperacional()}`;

  logger.info("Encaminhando pedido ao deposito (NOTIFIED)", {
    orderId: order.id,
    publicCode: getPublicCode(order),
    depositoId: deposito.id,
    motivo,
  });

  try {
    const firstOrder = await sendFirstOrderUtilityMessage({
      tenantCnpj,
      phoneNumberId,
      order,
      deposito,
    }).catch(() => ({ sent: false, usedTemplate: false }));

    if (firstOrder.sent) return;

    if (isFeatureEnabled("FEATURE_STICKERS_ENABLED", true)) {
      await sendWhatsAppStickerMessage({
        tenantCnpj,
        phoneNumberId,
        to: deposito.waId,
        stickerLink: (STICKERS as any)?.pedidoNovo ?? (STICKERS as any)?.duduPedido ?? (STICKERS as any)?.hello,
        orderId: order.id,
      }).catch(() => void 0);
    }

    await sendWhatsAppButtonsMessage({
      tenantCnpj,
      phoneNumberId,
      to: deposito.waId,
      body,
      buttons: [
        { id: "DEP_ACEITAR", title: "Aceitar" },
        { id: "DEP_RECUSAR", title: "Recusar" },
        { id: "DEP_STATUS", title: "Status" },
      ],
      orderId: order.id,
    });
  } catch (err: any) {
    logger.warn("Falha ao enviar pedido ao deposito, fallback texto", {
      orderId: order.id,
      depositoId: deposito.id,
      error: err?.message ?? String(err),
    });

    await sendWhatsAppTextMessage({
      tenantCnpj,
      phoneNumberId,
      to: deposito.waId,
      body,
      orderId: order.id,
    }).catch(() => void 0);

    await clearNotifyLogKeyBestEffort({
      tenantCnpj,
      orderId: order.id,
      depositoId: deposito.id,
    });
  }
}
