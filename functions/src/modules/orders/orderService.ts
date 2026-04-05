// FILE: functions/src/modules/orders/orderService.ts
import type * as FirebaseFirestore from "firebase-admin/firestore";
import { createHash, randomBytes } from "crypto";
import * as logger from "firebase-functions/logger";
import { FieldValue } from "../../infra/config/firebase";
import {
  depositosCol,
  issuesCol,
  ordersCol,
  ordersDoneCol,
  ordersPublicCol,
  promoHistoryCol,
  usersCol,
} from "../../infra/firestore/duduPaths";
import { logEvent } from "../../infra/obs/eventLogService";
import { makeOrderId } from "../common/id";
import { handlePromoAfterDelivered } from "../promo/promoInteligente";
import { maybeTriggerSeedTestImmediateBilling } from "../billing/billingService";
import type {
  Order,
  OrderStatus,
  FulfillmentStatus,
  LastActionBy,
  RiskFlag,
  PedidoCanal,
} from "../common/types";
import { createFlowMessenger } from "../../infra/whatsapp/messenger";
import { createCloudApiClient } from "../../infra/whatsapp/cloudApiClient";
import { buildPostDeliveryRatingButtons } from "../../domain/whatsapp/whatsappButtons";

let _messenger: any = null;
function getMessenger() {
  if (!_messenger) {
    _messenger = createFlowMessenger(createCloudApiClient());
  }
  return _messenger;
}

// ----------------------------
// Helpers
// ----------------------------
const ACTIVE_FOR_USER: OrderStatus[] = ["CREATED", "ROUTED", "NOTIFIED", "ACCEPTED"];
const ACTIVE_FOR_DEPOSITO: OrderStatus[] = ["ROUTED", "NOTIFIED", "ACCEPTED"];

const TERMINAL = new Set<OrderStatus>(["DECLINED", "TIMEOUT", "CANCELED", "DONE"]);
const SERVICE_FEE_DEFAULT = 0.99;
const PLATFORM_FEE_DEFAULT = 1.5;
const DEPOSITO_OFFLINE_TIMEOUT_MS = Number(process.env.DEPOSITO_OFFLINE_TIMEOUT_MS ?? "1800000");
const MAX_HISTORY_ITEMS_PER_ORDER = Number(process.env.MAX_HISTORY_ITEMS_PER_ORDER ?? "12");
const TX_MAX_RETRIES = Number(process.env.TX_MAX_RETRIES ?? "5");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryTransaction(err: any): boolean {
  const code = String(err?.code ?? err?.status ?? "");
  const msg = String(err?.message ?? "");
  return code === "10" || code === "ABORTED" || msg.includes("aborted");
}

async function runTransactionWithRetry<T>(
  appRef: FirebaseFirestore.Firestore,
  fn: (tx: FirebaseFirestore.Transaction) => Promise<T>,
): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= TX_MAX_RETRIES; attempt += 1) {
    try {
      return await appRef.runTransaction(fn);
    } catch (err: any) {
      lastErr = err;
      if (!shouldRetryTransaction(err) || attempt >= TX_MAX_RETRIES) throw err;
      await sleep(60 * attempt);
    }
  }
  throw lastErr;
}

function tenantCollections(tenantId: string) {
  return {
    firestore: ordersCol(tenantId).firestore,
    orders: ordersCol(tenantId),
    users: usersCol(tenantId),
    depositos: depositosCol(tenantId),
    ordersPublic: ordersPublicCol(tenantId),
    ordersDone: ordersDoneCol(tenantId),
    promoHistory: promoHistoryCol(tenantId),
    issues: issuesCol(tenantId),
  };
}

function createdAtMillis(o: any): number {
  const ts = o?.createdAt;
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function digitsOnly(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function last4Digits(value: string | null | undefined): string {
  const digits = digitsOnly(value);
  if (!digits) return "0000";
  const tail = digits.slice(-4);
  return tail.padStart(4, "0");
}

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

function normalizeProductName(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseItemsForHistory(raw: string): Array<{ productName: string; quantity: number }> {
  const base = String(raw ?? "").replace(/\r/g, "\n");
  const parts = base
    .split(/\n|,|;|\s+e\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const map = new Map<string, number>();

  for (const p of parts) {
    let qty = 1;
    let name = p;

    const m = p.match(/^\s*(\d{1,2})\s*(x|un|unid|unidades)?\s+(.*)$/i);
    if (m?.[1]) {
      qty = Number(m[1]);
      name = m[3] ?? p;
    }

    const normalized = normalizeProductName(name);
    if (!normalized) continue;
    const nextQty = Math.max(1, Math.min(99, Math.floor(qty)));
    map.set(normalized, (map.get(normalized) ?? 0) + nextQty);
  }

  const items = Array.from(map.entries())
    .map(([productName, quantity]) => ({ productName, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.productName.localeCompare(b.productName));

  return items.slice(0, Math.max(1, MAX_HISTORY_ITEMS_PER_ORDER));
}

function buildPromoHistoryDocId(orderId: string, productName: string): string {
  const base = `${orderId}|${productName}`;
  return `${orderId}_${shortHash(base)}`;
}

export async function recordPromoHistoryForOrder(params: {
  tenantCnpj: string;
  orderId: string;
  reason: string;
}): Promise<void> {
  const appRef = tenantCollections(params.tenantCnpj);
  const orderRef = appRef.orders.doc(params.orderId);

  const snap = await orderRef.get();
  if (!snap.exists) return;

  const data = snap.data() as any;
  if (data?.promoHistoryRecordedAt) return;

  const fulfillment = String(data?.fulfillmentStatus ?? "NONE");
  if (!["ENTREGUE_CONFIRMADO", "ENTREGUE_PRESUMIDO"].includes(fulfillment)) return;

  const depositoId = String(data?.depositoId ?? "");
  const userId = String(data?.userId ?? "");
  if (!depositoId || !userId) return;

  const items = parseItemsForHistory(String(data?.itensDescricao ?? ""));
  const concludedAt =
    data?.doneAt ??
    data?.deliveredByClienteAt ??
    data?.deliveredPresumidoAt ??
    FieldValue.serverTimestamp();

  const batch = appRef.firestore.batch();
  const historyRef = appRef.promoHistory;

  for (const item of items) {
    const docId = buildPromoHistoryDocId(params.orderId, item.productName);
    batch.set(
      historyRef.doc(docId),
      {
        depositoId,
        userId,
        orderId: params.orderId,
        publicCode: data?.publicCode ?? null,
        productName: item.productName,
        quantity: item.quantity,
        concludedAt,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  batch.set(
    orderRef,
    {
      promoHistoryRecordedAt: FieldValue.serverTimestamp(),
      promoHistoryCount: items.length,
      promoHistoryReason: params.reason.slice(0, 80),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await batch.commit().catch(() => void 0);
}

function buildReceiptText(params: {
  publicCode: string;
  depositoNome: string;
  clienteNome: string;
  clienteWaId: string;
  endereco: string;
  bairro: string;
  referencia: string;
  itens: string;
  subtotal: number | null;
  serviceFee: number | null;
  totalToCollect: number | null;
}): string {
  const subtotal = params.subtotal != null ? params.subtotal : 0;
  const serviceFee = params.serviceFee != null ? params.serviceFee : SERVICE_FEE_DEFAULT;
  const total = params.totalToCollect != null ? params.totalToCollect : subtotal + serviceFee;

  const lines: string[] = [];
  lines.push(params.publicCode);
  lines.push(`Deposito: ${params.depositoNome || "N/D"}`);
  lines.push(`Cliente: ${params.clienteNome || "Cliente"} (${params.clienteWaId || "N/D"})`);
  lines.push(`Bairro: ${params.bairro || "N/D"}`);
  if (params.endereco) lines.push(`Endereco: ${params.endereco}`);
  if (params.referencia) lines.push(`Referencia: ${params.referencia}`);
  lines.push("Itens:");
  lines.push(params.itens || "Sem descricao de itens.");
  lines.push(`Subtotal: R$ ${subtotal.toFixed(2).replace(".", ",")}`);
  lines.push(`Taxa Dudu: R$ ${serviceFee.toFixed(2).replace(".", ",")}`);
  lines.push(`Total a cobrar: R$ ${total.toFixed(2).replace(".", ",")}`);
  lines.push("Pedido feito pelo Chama Dudu. Valeu por confiar no Dudu.");

  return lines.join("\n").slice(0, 1800);
}

function mapOrderDoc(doc: FirebaseFirestore.QueryDocumentSnapshot): Order {
  const data = doc.data() as any;

  const tentativas = Array.isArray(data.tentativasDepositos)
    ? data.tentativasDepositos.map((x: any) => String(x))
    : [];

  const riskFlags: RiskFlag[] = Array.isArray(data.riskFlags)
    ? data.riskFlags.map((x: any) => String(x))
    : [];

  return {
    id: doc.id,
    tenantId: String(data.tenantId ?? "app"),
    userId: String(data.userId ?? ""),
    phoneNumberId: String(data.phoneNumberId ?? ""),

    publicSeq: typeof data.publicSeq === "number" ? data.publicSeq : null,
    publicCode: data.publicCode ?? null,
    publicHash: data.publicHash ?? null,
    publicWaId: data.publicWaId ?? null,
    publicClientName: data.publicClientName ?? null,

    bairro: data.bairro ?? null,
    itensDescricao: data.itensDescricao ?? null,
    canal: (data.canal as PedidoCanal | null) ?? null,

    depositoId: data.depositoId ?? null,
    tentativasDepositos: tentativas,

    status: (data.status as OrderStatus) ?? "CREATED",
    fulfillmentStatus: (data.fulfillmentStatus as FulfillmentStatus) ?? "NONE",

    valorTotalPedido: typeof data.valorTotalPedido === "number" ? data.valorTotalPedido : null,
    valorSourceText: data.valorSourceText ?? null,
    valorPropostoAt: data.valorPropostoAt ?? null,
    valorConfirmadoAt: data.valorConfirmadoAt ?? null,
    valorRejeitadoAt: data.valorRejeitadoAt ?? null,
    pricing: data.pricing ?? null,
    promoBenefitApplied: data.promoBenefitApplied ?? null,
    platformFeeSnapshot:
      typeof data.platformFeeSnapshot === "number" ? data.platformFeeSnapshot : null,

    lastActionBy: data.lastActionBy ?? null,
    lastActionAt: data.lastActionAt ?? null,
    lastActionTextPreview: data.lastActionTextPreview ?? null,

    riskFlags,
    complaintOpen: Boolean(data.complaintOpen ?? false),
    missingItemsReported: Boolean(data.missingItemsReported ?? false),
    evidenceRequested: Boolean(data.evidenceRequested ?? false),

    feedbackNota: typeof data.feedbackNota === "number" ? data.feedbackNota : null,
    feedbackAt: data.feedbackAt ?? null,

    issueOpenId: data.issueOpenId ?? null,

    reminders: data.reminders ?? null,

    deliveredByClienteAt: data.deliveredByClienteAt ?? null,
    deliveredByDepositoAt: data.deliveredByDepositoAt ?? null,
    deliveredPresumidoAt: data.deliveredPresumidoAt ?? null,
    deliveredAt: data.deliveredAt ?? null,
    printKey: data.printKey ?? null,
    promoDiscountCandidate: data.promoDiscountCandidate ?? null,
    promoHistoryRecordedAt: data.promoHistoryRecordedAt ?? null,
    notifyLog: data.notifyLog ?? null,
    actionLog: data.actionLog ?? null,

    addressChangeCount: typeof data.addressChangeCount === "number" ? data.addressChangeCount : 0,
    itemAddCount: typeof data.itemAddCount === "number" ? data.itemAddCount : 0,
    itemAddLastText: data.itemAddLastText ?? null,

    clientDepositoAnnouncedId: data.clientDepositoAnnouncedId ?? null,
    clientDepositoAnnouncedAt: data.clientDepositoAnnouncedAt ?? null,

    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    routedAt: data.routedAt ?? null,
    notifiedAt: data.notifiedAt ?? null,
    acceptedAt: data.acceptedAt ?? null,
    declinedAt: data.declinedAt ?? null,
    timeoutAt: data.timeoutAt ?? null,
    canceledAt: data.canceledAt ?? null,
    doneAt: data.doneAt ?? null,
  };
}

// Rank de fulfillment (não volta pra trás)
function fRank(s: FulfillmentStatus): number {
  const map: Record<FulfillmentStatus, number> = {
    NONE: 0,
    SEPARANDO: 1,
    A_CAMINHO: 2,
    ENTREGUE_DEPOSITO: 3,
    ENTREGUE_PRESUMIDO: 4,
    ENTREGUE_CONFIRMADO: 5,
  };
  return map[s] ?? 0;
}

function buildPricingFromSubtotal(subtotal: number, serviceFeeOverride?: number): {
  subtotal: number;
  serviceFee: number;
  totalToCollect: number;
} {
  const safeSubtotal = Math.max(0, Math.round(subtotal * 100) / 100);
  const serviceFee =
    typeof serviceFeeOverride === "number" && Number.isFinite(serviceFeeOverride)
      ? Math.max(0, Math.round(serviceFeeOverride * 100) / 100)
      : SERVICE_FEE_DEFAULT;
  const totalToCollect = Math.round((safeSubtotal + serviceFee) * 100) / 100;
  return { subtotal: safeSubtotal, serviceFee, totalToCollect };
}

// Máquina macro (MVP)
const ALLOWED: Record<OrderStatus, Set<OrderStatus>> = {
  CREATED: new Set<OrderStatus>(["CREATED", "ROUTED", "CANCELED"]),
  ROUTED: new Set<OrderStatus>(["ROUTED", "NOTIFIED", "TIMEOUT", "CANCELED"]),
  NOTIFIED: new Set<OrderStatus>(["NOTIFIED", "ACCEPTED", "DECLINED", "TIMEOUT", "CANCELED"]),
  ACCEPTED: new Set<OrderStatus>(["ACCEPTED", "DONE", "CANCELED"]),
  DECLINED: new Set<OrderStatus>(["DECLINED"]),
  TIMEOUT: new Set<OrderStatus>(["TIMEOUT"]),
  CANCELED: new Set<OrderStatus>(["CANCELED"]),
  DONE: new Set<OrderStatus>(["DONE"]),
};

// ----------------------------
// Queries
// ----------------------------
export async function getLastDeliveredOrderForUser(tenantCnpj: string, userId: string): Promise<Order | null> {
  const appRef = tenantCollections(tenantCnpj);
  const snap = await appRef.orders.where("userId", "==", userId).limit(50).get();
  if (snap.empty) return null;

  const delivered = new Set<FulfillmentStatus>(["ENTREGUE_CONFIRMADO", "ENTREGUE_PRESUMIDO"]);
  const orders = snap.docs.map(mapOrderDoc).filter((o) => delivered.has(o.fulfillmentStatus));
  if (!orders.length) return null;

  orders.sort((a, b) => createdAtMillis(b) - createdAtMillis(a));
  return orders[0];
}

export async function getActiveOrderForUser(tenantCnpj: string, userId: string): Promise<Order | null> {
  const appRef = tenantCollections(tenantCnpj);

  // prefer o ponteiro (MVP: mantém fluxo rápido)
  const uRef = appRef.users.doc(userId);
  const uSnap = await uRef.get();
  const activeOrderId = uSnap.exists ? ((uSnap.data() as any)?.activeOrderId ?? null) : null;

  if (activeOrderId) {
    const oRef = appRef.orders.doc(String(activeOrderId));
    const oSnap = await oRef.get();
    if (oSnap.exists) {
      const o = mapOrderDoc(oSnap as any);
      const active = new Set<OrderStatus>(ACTIVE_FOR_USER);
      if (active.has(o.status)) return o;

      // ponteiro ficou sujo -> limpa (sem travar o usuário)
      await uRef.set(
        {
          activeOrderId: null,
          activeOrderUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } else {
      // pedido sumiu -> limpa ponteiro
      await uRef.set(
        {
          activeOrderId: null,
          activeOrderUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  }

  // fallback (legado): scan
  const snap = await appRef.orders.where("userId", "==", userId).limit(50).get();
  if (snap.empty) return null;

  const active = new Set<OrderStatus>(ACTIVE_FOR_USER);
  const orders = snap.docs.map(mapOrderDoc).filter((o) => active.has(o.status));
  if (!orders.length) return null;

  orders.sort((a, b) => createdAtMillis(b) - createdAtMillis(a));
  return orders[0];
}

export async function getActiveOrderForDeposito(tenantCnpj: string, depositoId: string): Promise<Order | null> {
  const appRef = tenantCollections(tenantCnpj);
  const snap = await appRef.orders.where("depositoId", "==", depositoId).limit(50).get();
  if (snap.empty) return null;

  const active = new Set<OrderStatus>(ACTIVE_FOR_DEPOSITO);
  const orders = snap.docs.map(mapOrderDoc).filter((o) => active.has(o.status));
  if (!orders.length) return null;

  orders.sort((a, b) => createdAtMillis(b) - createdAtMillis(a));
  return orders[0];
}

// ----------------------------
// Create
// ----------------------------
export interface CreateOrderParams {
  tenantId: string;
  userId: string;
  phoneNumberId: string;
  bairro?: string | null;
  itensDescricao?: string | null;
  canal?: PedidoCanal | null;
}

export async function createOrder(params: CreateOrderParams): Promise<Order> {
  const appRef = tenantCollections(params.tenantId);
  const ordersRef = appRef.orders;
  const now = FieldValue.serverTimestamp();

  const orderPayload = {
    tenantId: params.tenantId,
    userId: params.userId,
    phoneNumberId: params.phoneNumberId,

    // public fields (serão preenchidos depois)
    publicSeq: null,
    publicCode: null,
    publicHash: null,
    publicWaId: null,
    publicClientName: null,

    bairro: params.bairro ?? null,
    itensDescricao: params.itensDescricao ?? null,
    canal: params.canal ?? null,

    depositoId: null,

    enderecoEntrega: null,
    cepEntrega: null,
    referenciaEntrega: null,
    geoLat: null,
    geoLng: null,
    enderecoConfirmado: null,

    tentativasDepositos: [],

    status: "CREATED",
    fulfillmentStatus: "NONE",

    valorTotalPedido: null,
    valorSourceText: null,
    valorPropostoAt: null,
    valorConfirmadoAt: null,
    valorRejeitadoAt: null,
    pricing: {
      subtotal: null,
      serviceFee: SERVICE_FEE_DEFAULT,
      totalToCollect: null,
    },
    platformFeeSnapshot: PLATFORM_FEE_DEFAULT,

    lastActionBy: "system",
    lastActionAt: now,
    lastActionTextPreview: "order_created",

    riskFlags: [],
    complaintOpen: false,
    missingItemsReported: false,
    evidenceRequested: false,

    feedbackNota: null,
    feedbackAt: null,

    issueOpenId: null,
    reminders: {
      acceptedNoValorPingAt: null,
      clientNoConfirmPingAt: null,
      presumidoNotifiedAt: null,
      issuePingAt: null,
      aCaminhoPingAt: null,

      deliveredConfirmButtonsSentAt: null,
      deliveredConfirmPing5At: null,
      deliveredConfirmPing13At: null,
    },

    deliveredByClienteAt: null,
    deliveredByDepositoAt: null,
    deliveredPresumidoAt: null,
    deliveredAt: null,

    printKey: null,
    promoDiscountCandidate: null,
    promoHistoryRecordedAt: null,
    notifyLog: null,
    actionLog: null,

    addressChangeCount: 0,
    itemAddCount: 0,
    itemAddLastText: null,

    clientDepositoAnnouncedId: null,
    clientDepositoAnnouncedAt: null,

    doneAt: null,
    createdAt: now,
    updatedAt: now,
    routedAt: null,
    notifiedAt: null,
    acceptedAt: null,
    declinedAt: null,
    timeoutAt: null,
    canceledAt: null,
  };

  let docRef: FirebaseFirestore.DocumentReference | null = null;
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const orderId = makeOrderId(params.tenantId, params.userId);
    const candidateRef = ordersRef.doc(orderId);
    try {
      await candidateRef.create(orderPayload);
      docRef = candidateRef;
      break;
    } catch (err: any) {
      lastErr = err;
      const code = err?.code ?? err?.status ?? "";
      const msg = String(err?.message ?? "");
      const isAlreadyExists = code === 6 || code === "already-exists" || msg.includes("ALREADY_EXISTS");
      if (!isAlreadyExists) throw err;
    }
  }
  if (!docRef) {
    throw new Error(`Falha ao criar pedido (collision): ${lastErr?.message ?? String(lastErr)}`);
  }

  // ✅ salva ponteiro do pedido ativo no usuário
  await setUserActiveOrderId({
    tenantId: params.tenantId,
    userId: params.userId,
    orderId: docRef.id,
  });

  return {
    id: docRef.id,
    tenantId: params.tenantId,
    userId: params.userId,
    phoneNumberId: params.phoneNumberId,
    bairro: params.bairro ?? null,
    itensDescricao: params.itensDescricao ?? null,
    canal: params.canal ?? null,
    depositoId: null,
    tentativasDepositos: [],
    status: "CREATED",
    fulfillmentStatus: "NONE",
    publicSeq: null,
    publicCode: null,
    publicHash: null,
    publicWaId: null,
    publicClientName: null,
  };
}

// ----------------------------
// Public code + hash (reserva anti-colisao)
// ----------------------------
export async function ensurePublicCodeAndHash(params: {
  tenantId: string;
  orderId: string;
  depositoId: string;
}): Promise<{ publicCode: string | null; publicHash: string | null; printKey: string | null }> {
  const appRef = tenantCollections(params.tenantId);
  const orderRef = appRef.orders.doc(params.orderId);
  const depRef = appRef.depositos.doc(params.depositoId);
  const pubRefBase = appRef.ordersPublic;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    let result: { collision: boolean; publicCode: string | null; publicHash: string | null; printKey: string | null } = {
      collision: false,
      publicCode: null,
      publicHash: null,
      printKey: null,
    };

    await appRef.firestore.runTransaction(async (tx) => {
      const [orderSnap, depSnap] = await Promise.all([tx.get(orderRef), tx.get(depRef)]);
      if (!orderSnap.exists || !depSnap.exists) {
        result = { collision: false, publicCode: null, publicHash: null, printKey: null };
        return;
      }

      const o = orderSnap.data() as any;
      const d = depSnap.data() as any;
      const existingCode = o?.publicCode ?? null;
      const existingHash = o?.publicHash ?? null;
      const existingPrintKey = o?.printKey ?? null;

      if (existingCode && existingHash && existingPrintKey) {
        result = { collision: false, publicCode: existingCode, publicHash: existingHash, printKey: existingPrintKey };
        return;
      }

      const depLast4 = last4Digits(d?.waId);
      const rand4 = String(1000 + Math.floor(Math.random() * 9000));
      const publicCode = `Pedido Dudu ${depLast4}_#${rand4}`;
      const publicRef = pubRefBase.doc(publicCode);

      const pubSnap = await tx.get(publicRef);
      if (pubSnap.exists) {
        const existingOrderId = String((pubSnap.data() as any)?.orderId ?? "");
        if (existingOrderId && existingOrderId !== params.orderId) {
          result = { collision: true, publicCode: null, publicHash: null, printKey: null };
          return;
        }
      }

      const createdAtMs = createdAtMillis(o) || Date.now();
      const publicHash = existingHash ?? shortHash(`${params.orderId}|${params.tenantId}|${createdAtMs}`);
      const printKey = existingPrintKey ?? randomBytes(12).toString("hex");

      tx.set(
        publicRef,
        {
          orderId: params.orderId,
          tenantId: params.tenantId,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      tx.set(
        orderRef,
        {
          publicCode,
          publicHash,
          printKey,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      result = { collision: false, publicCode, publicHash, printKey };
    });

    if (!result.collision) return result;
  }

  return { publicCode: null, publicHash: null, printKey: null };
}

// ----------------------------
// Snapshot DONE (auditoria rapida)
// ----------------------------
export async function saveOrderDoneSnapshot(params: {
  tenantId: string;
  orderId: string;
}): Promise<void> {
  const appRef = tenantCollections(params.tenantId);
  const orderRef = appRef.orders.doc(params.orderId);
  const doneRef = appRef.ordersDone.doc(params.orderId);

  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) return;

  const o = orderSnap.data() as any;
  const depositoId = String(o?.depositoId ?? "");
  const depSnap = depositoId ? await appRef.depositos.doc(depositoId).get().catch(() => null as any) : null;
  const depData = depSnap?.exists ? (depSnap.data() as any) : null;

  if (!o?.publicCode && depositoId) {
    await ensurePublicCodeAndHash({
      tenantId: params.tenantId,
      orderId: params.orderId,
      depositoId,
    }).catch(() => void 0);
  }

  const pricing = o?.pricing ?? {};
  const subtotal =
    typeof pricing.subtotal === "number"
      ? pricing.subtotal
      : typeof o?.valorTotalPedido === "number"
        ? o.valorTotalPedido
        : null;
  const serviceFee = typeof pricing.serviceFee === "number" ? pricing.serviceFee : SERVICE_FEE_DEFAULT;
  const totalToCollect =
    typeof pricing.totalToCollect === "number"
      ? pricing.totalToCollect
      : subtotal != null
        ? Math.round((subtotal + serviceFee) * 100) / 100
        : null;

  const issuesSnap = await appRef
    .issues
    .where("orderId", "==", params.orderId)
    .limit(10)
    .get()
    .catch(() => null as any);

  const issues = issuesSnap?.empty
    ? []
    : issuesSnap.docs.map((d: any) => {
        const data = d.data() as any;
        return {
          id: d.id,
          type: data?.type ?? null,
          status: data?.status ?? null,
          summary: data?.summary ?? null,
          createdAt: data?.createdAt ?? null,
          resolvedAt: data?.resolvedAt ?? null,
        };
      });

  const receiptText = buildReceiptText({
    publicCode: String(o?.publicCode ?? o?.id ?? params.orderId),
    depositoNome: String(depData?.nome ?? ""),
    clienteNome: String(o?.publicClientName ?? ""),
    clienteWaId: String(o?.publicWaId ?? o?.userId ?? ""),
    endereco: String(o?.enderecoEntrega ?? ""),
    bairro: String(o?.bairro ?? ""),
    referencia: String(o?.referenciaEntrega ?? ""),
    itens: String(o?.itensDescricao ?? ""),
    subtotal,
    serviceFee,
    totalToCollect,
  });

  await doneRef.set(
    {
      orderId: params.orderId,
      tenantId: params.tenantId,
      userId: o?.userId ?? null,
      depositoId: depositoId || null,
      publicCode: o?.publicCode ?? null,
      publicHash: o?.publicHash ?? null,
      publicWaId: o?.publicWaId ?? null,
      publicClientName: o?.publicClientName ?? null,
      bairro: o?.bairro ?? null,
      canal: o?.canal ?? null,
      itensDescricao: o?.itensDescricao ?? null,
      pricing: {
        subtotal: subtotal ?? null,
        serviceFee: serviceFee ?? null,
        totalToCollect: totalToCollect ?? null,
      },
      platformFeeSnapshot: o?.platformFeeSnapshot ?? null,
      fulfillmentStatus: o?.fulfillmentStatus ?? null,
      status: o?.status ?? null,
      timeline: {
        createdAt: o?.createdAt ?? null,
        routedAt: o?.routedAt ?? null,
        notifiedAt: o?.notifiedAt ?? null,
        acceptedAt: o?.acceptedAt ?? null,
        deliveredByDepositoAt: o?.deliveredByDepositoAt ?? null,
        deliveredByClienteAt: o?.deliveredByClienteAt ?? null,
        deliveredPresumidoAt: o?.deliveredPresumidoAt ?? null,
        deliveredAt: o?.deliveredAt ?? null,
        doneAt: o?.doneAt ?? null,
      },
      deposito: depData
        ? {
            id: depositoId,
            nome: depData?.nome ?? null,
            waId: depData?.waId ?? null,
            bairro: depData?.bairro ?? null,
          }
        : null,
      issues,
      receiptText,
      receiptHtmlVersion: "v1",
      snapshotAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// ----------------------------
// Auditoria: last action
// ----------------------------
export async function touchLastAction(params: {
  tenantCnpj: string;
  orderId: string;
  by: LastActionBy;
  textPreview?: string | null;
}): Promise<void> {
  const appRef = tenantCollections(params.tenantCnpj);
  const orderRef = appRef.orders.doc(params.orderId);

  await orderRef.set(
    {
      lastActionBy: params.by,
      lastActionAt: FieldValue.serverTimestamp(),
      lastActionTextPreview: (params.textPreview ?? "").slice(0, 140) || null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// ----------------------------
// Risk flags
// ----------------------------
export async function addRiskFlag(params: { tenantCnpj: string; orderId: string; flag: RiskFlag }): Promise<void> {
  const appRef = tenantCollections(params.tenantCnpj);
  const orderId = params.orderId;
  const flag = params.flag;
  const orderRef = appRef.orders.doc(orderId);

  await runTransactionWithRetry(appRef.firestore, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;

    const data = snap.data() as any;
    const flags: string[] = Array.isArray(data.riskFlags) ? data.riskFlags : [];
    if (flags.includes(flag)) return;

    const next = flags.concat([flag]).slice(-12);
    tx.set(orderRef, { riskFlags: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

// ----------------------------
// Update status (macro)
// ----------------------------
export async function updateOrderStatus(params: {
  tenantCnpj: string;
  orderId: string;
  newStatus: OrderStatus;
  extraFields?: Record<string, unknown>;
}): Promise<void> {
  const { tenantCnpj, orderId, newStatus, extraFields } = params;

  const appRef = tenantCollections(tenantCnpj);
  const orderRef = appRef.orders.doc(orderId);

  await appRef.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;

    const current = (snap.data() as any)?.status as OrderStatus | undefined;
    const cur: OrderStatus = current ?? "CREATED";

    if (TERMINAL.has(cur) && cur !== newStatus) return;

    const allowed = ALLOWED[cur] ?? new Set<OrderStatus>([cur]);
    if (!allowed.has(newStatus)) return;

    const payload: Record<string, unknown> = {
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (extraFields && typeof extraFields === "object") {
      Object.assign(payload, extraFields);
    }

    if (newStatus === "ROUTED") payload["routedAt"] = FieldValue.serverTimestamp();
    if (newStatus === "NOTIFIED") payload["notifiedAt"] = FieldValue.serverTimestamp();
    if (newStatus === "ACCEPTED") payload["acceptedAt"] = FieldValue.serverTimestamp();
    if (newStatus === "DECLINED") payload["declinedAt"] = FieldValue.serverTimestamp();
    if (newStatus === "TIMEOUT") payload["timeoutAt"] = FieldValue.serverTimestamp();
    if (newStatus === "CANCELED") payload["canceledAt"] = FieldValue.serverTimestamp();
    if (newStatus === "DONE") payload["doneAt"] = FieldValue.serverTimestamp();

    tx.set(orderRef, payload, { merge: true });
  });
}

// ----------------------------
// Update fulfillment (micro)
// ----------------------------
export async function updateFulfillmentStatus(params: {
  tenantCnpj: string;
  orderId: string;
  newFulfillmentStatus: FulfillmentStatus;
  extraFields?: Record<string, unknown>;
}): Promise<void> {
  const { tenantCnpj, orderId, newFulfillmentStatus, extraFields } = params;

  const appRef = tenantCollections(tenantCnpj);
  const orderRef = appRef.orders.doc(orderId);

  await runTransactionWithRetry(appRef.firestore, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;

    const data = snap.data() as any;
    const current = (data.fulfillmentStatus as FulfillmentStatus) ?? "NONE";
    if (fRank(newFulfillmentStatus) < fRank(current)) return;

    const patch: Record<string, unknown> = {
      fulfillmentStatus: newFulfillmentStatus,
      updatedAt: FieldValue.serverTimestamp(),
    };

    const isDelivered =
      newFulfillmentStatus === "ENTREGUE_CONFIRMADO" ||
      newFulfillmentStatus === "ENTREGUE_PRESUMIDO";
    if (isDelivered) {
      if (!data.deliveredAt) patch["deliveredAt"] = FieldValue.serverTimestamp();
      if (newFulfillmentStatus === "ENTREGUE_PRESUMIDO" && !data.deliveredPresumidoAt) {
        patch["deliveredPresumidoAt"] = FieldValue.serverTimestamp();
      }
    }

    if (extraFields && typeof extraFields === "object") {
      Object.assign(patch, extraFields);
    }

    tx.set(orderRef, patch, { merge: true });
  });
  if (newFulfillmentStatus === "ENTREGUE_CONFIRMADO" || newFulfillmentStatus === "ENTREGUE_PRESUMIDO") {
    await recordPromoHistoryForOrder({
      tenantCnpj,
      orderId,
      reason: `fulfillment:${newFulfillmentStatus}`,
    }).catch(() => void 0);
    await handlePromoAfterDelivered({ tenantCnpj, orderId }).catch(() => void 0);
    await maybeTriggerSeedTestImmediateBilling({ tenantCnpj, orderId }).catch((err: any) => {
      void logEvent({
        tenantCnpj,
        eventName: "BILLING_SEED_TRIGGER_ERROR",
        orderId,
        payload: {
          error: err?.message ?? String(err),
          fulfillment: newFulfillmentStatus,
        },
      });
    });
  }
}

// ----------------------------
// Valor: depósito propõe / cliente confirma
// ----------------------------
export async function proposeValorByDeposito(params: {
  tenantCnpj: string;
  orderId: string;
  valor: number;
  sourceText: string;
}): Promise<{ pricing: { subtotal: number; serviceFee: number; totalToCollect: number }; benefitApplied: boolean; discountCents: number }> {
  const appRef = tenantCollections(params.tenantCnpj);
  const orderRef = appRef.orders.doc(params.orderId);
  let result = {
    pricing: buildPricingFromSubtotal(params.valor),
    benefitApplied: false,
    discountCents: 0,
  };

  await runTransactionWithRetry(appRef.firestore, async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) return;
    const order = orderSnap.data() as any;

    const userId = String(order?.userId ?? "");
    const userRef = userId ? appRef.users.doc(userId) : null;
    const userSnap = userRef ? await tx.get(userRef) : null;
    const userData = userSnap?.exists ? (userSnap.data() as any) : {};

    const benefit = userData?.promoBenefit ?? null;
    const benefitActive = benefit && benefit.status === "ACTIVE";
    const benefitKind = benefit?.kind === "SERVICE_FEE_WAIVER";
    const benefitExpiresAtMs = benefit?.expiresAtMs ? Number(benefit.expiresAtMs) : 0;
    const nowMs = Date.now();
    const expired = benefitExpiresAtMs && benefitExpiresAtMs <= nowMs;
    const remainingUses = typeof benefit?.remainingUses === "number" ? benefit.remainingUses : 0;
    const alreadyApplied = Boolean(order?.promoBenefitApplied);

    let serviceFeeOverride: number | null = null;
    let benefitApplied = false;
    let discountCents = 0;

    if (benefitActive && benefitKind && !expired && remainingUses > 0 && !alreadyApplied) {
      serviceFeeOverride = 0;
      benefitApplied = true;
      const amountCents =
        typeof benefit?.amountCents === "number" ? Math.max(0, Math.floor(benefit.amountCents)) : 0;
      discountCents = Math.max(0, Math.min(Math.round(SERVICE_FEE_DEFAULT * 100), amountCents));

      if (userRef) {
        const nextUses = Math.max(0, remainingUses - 1);
        tx.set(
          userRef,
          {
            promoBenefit: {
              ...benefit,
              remainingUses: nextUses,
              status: nextUses > 0 ? "ACTIVE" : "USED",
              usedAt: FieldValue.serverTimestamp(),
              usedAtMs: nowMs,
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    const pricing = buildPricingFromSubtotal(params.valor, serviceFeeOverride ?? undefined);
    result = { pricing, benefitApplied, discountCents };

    const orderPatch: Record<string, unknown> = {
      valorTotalPedido: params.valor,
      valorSourceText: (params.sourceText ?? "").slice(0, 300) || null,
      valorPropostoAt: FieldValue.serverTimestamp(),
      valorConfirmadoAt: null,
      valorRejeitadoAt: null,
      pricing,
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (benefitApplied) {
      orderPatch.promoBenefitApplied = {
        kind: "SERVICE_FEE_WAIVER",
        amountCents: Math.round(SERVICE_FEE_DEFAULT * 100),
        discountCents,
        appliedAt: FieldValue.serverTimestamp(),
        appliedAtMs: nowMs,
      };
    }

    tx.set(orderRef, orderPatch, { merge: true });
  });

  return result;
}

export async function lockOrderActionOnce(params: {
  tenantCnpj: string;
  orderId: string;
  actionId: string;
}): Promise<boolean> {
  const appRef = tenantCollections(params.tenantCnpj);
  const orderRef = appRef.orders.doc(params.orderId);
  const actionId = String(params.actionId ?? "").trim();
  if (!actionId) return false;

  let allowed = false;

  await runTransactionWithRetry(appRef.firestore, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;

    const data = snap.data() as any;
    const raw = data?.actionLog;
    const actionLog: Record<string, unknown> =
      raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};

    if (actionLog[actionId]) return;

    tx.set(
      orderRef,
      {
        actionLog: {
          ...actionLog,
          [actionId]: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    allowed = true;
  });

  return allowed;
}

export async function confirmValorByCliente(tenantCnpj: string, orderId: string): Promise<void> {
  const appRef = tenantCollections(tenantCnpj);
  const orderRef = appRef.orders.doc(orderId);

  await orderRef.set(
    {
      valorConfirmadoAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function rejectValorByCliente(tenantCnpj: string, orderId: string): Promise<void> {
  const appRef = tenantCollections(tenantCnpj);
  const orderRef = appRef.orders.doc(orderId);

  await orderRef.set(
    {
      valorRejeitadoAt: FieldValue.serverTimestamp(),
      valorConfirmadoAt: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

// ----------------------------
// Entrega: dupla confirmação
// ----------------------------
export async function confirmDeliveredByCliente(tenantCnpj: string, orderId: string): Promise<void> {
  const appRef = tenantCollections(tenantCnpj);
  const orderRef = appRef.orders.doc(orderId);

  await runTransactionWithRetry(appRef.firestore, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;

    const data = snap.data() as any;

    const alreadyAt = data.deliveredByClienteAt ?? null;
    const deliveredAt = data.deliveredAt ?? null;
    const currentF: FulfillmentStatus = (data.fulfillmentStatus as FulfillmentStatus) ?? "NONE";

    const needsTs = !alreadyAt;
    const needsF = fRank(currentF) < fRank("ENTREGUE_CONFIRMADO");
    const needsDeliveredAt = !deliveredAt;

    // idempotência: evita writes quando não há mudança
    if (!needsTs && !needsF) return;

    const payload: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (needsTs) payload["deliveredByClienteAt"] = FieldValue.serverTimestamp();
    if (needsF) {
      payload["fulfillmentStatus"] = "ENTREGUE_CONFIRMADO";
      // ADDED: Trigger post-delivery rating buttons
      if (data.userId && data.phoneNumberId) {
        const ratingButtons = buildPostDeliveryRatingButtons();
        getMessenger().sendText({
          tenantId: tenantCnpj,
          phoneNumberId: data.phoneNumberId,
          waId: data.userId,
          body: ratingButtons.body,
          buttons: ratingButtons.buttons!,
        }).catch((err: any) => logger.error("[REVIEW_PROMPT_FAIL]", { orderId, err }));
      }
    }
    if (needsDeliveredAt) payload["deliveredAt"] = FieldValue.serverTimestamp();

    tx.set(orderRef, payload, { merge: true });
  });
}

export async function confirmDeliveredByDeposito(tenantCnpj: string, orderId: string): Promise<void> {
  const appRef = tenantCollections(tenantCnpj);
  const orderRef = appRef.orders.doc(orderId);

  await runTransactionWithRetry(appRef.firestore, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) return;

    const data = snap.data() as any;

    const alreadyAt = data.deliveredByDepositoAt ?? null;
    const deliveredAt = data.deliveredAt ?? null;
    const deliveredByClienteAt = data.deliveredByClienteAt ?? null;

    const currentF: FulfillmentStatus = (data.fulfillmentStatus as FulfillmentStatus) ?? "NONE";

    // Regra nova:
    // - Depósito marcar "entregue" NÃO fecha o ciclo; vira ENTREGUE_DEPOSITO.
    // - Se o cliente já tinha confirmado (legado: deliveredByClienteAt setado), sobe pra ENTREGUE_CONFIRMADO.
    let targetF: FulfillmentStatus | null = null;

    if (deliveredByClienteAt && fRank(currentF) < fRank("ENTREGUE_CONFIRMADO")) {
      targetF = "ENTREGUE_CONFIRMADO";
    } else if (fRank(currentF) < fRank("ENTREGUE_DEPOSITO")) {
      targetF = "ENTREGUE_DEPOSITO";
    }

    const needsTs = !alreadyAt;
    const needsF = Boolean(targetF);

    // idempotência: evita writes quando não há mudança
    if (!needsTs && !needsF) return;

    const payload: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (needsTs) payload["deliveredByDepositoAt"] = FieldValue.serverTimestamp();
    if (needsF) payload["fulfillmentStatus"] = targetF;
    if (targetF === "ENTREGUE_CONFIRMADO" && !deliveredAt) {
      payload["deliveredAt"] = FieldValue.serverTimestamp();
    }

    tx.set(orderRef, payload, { merge: true });
    // ADDED: Trigger post-delivery rating buttons
    if (needsF && (targetF === "ENTREGUE_DEPOSITO" || targetF === "ENTREGUE_CONFIRMADO")) {
      if (data.userId && data.phoneNumberId) {
        const ratingButtons = buildPostDeliveryRatingButtons();
        getMessenger().sendText({
          tenantId: tenantCnpj,
          phoneNumberId: data.phoneNumberId,
          waId: data.userId,
          body: ratingButtons.body,
          buttons: ratingButtons.buttons!,
        }).catch((err: any) => logger.error("[REVIEW_PROMPT_FAIL_DEP]", { orderId: snap.id, err }));
      }
    }
  });
}

// ----------------------------
// Feedback (e grava no depósito)
// ----------------------------
export async function setFeedbackNota(params: {
  tenantCnpj: string;
  orderId: string;
  nota: number;
}): Promise<void> {
  const n = Math.max(1, Math.min(5, Math.floor(params.nota)));
  const appRef = tenantCollections(params.tenantCnpj);
  const orderRef = appRef.orders.doc(params.orderId);

  await appRef.firestore.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) return;

    const od = orderSnap.data() as any;

    // idempotência: só grava 1 vez
    if (typeof od.feedbackNota === "number" && od.feedbackNota >= 1 && od.feedbackNota <= 5) return;

    tx.set(
      orderRef,
      {
        feedbackNota: n,
        feedbackAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const depositoId = od.depositoId ? String(od.depositoId) : null;
    if (!depositoId) return;

    const depRef = appRef.depositos.doc(depositoId);
    const depSnap = await tx.get(depRef);
    if (!depSnap.exists) {
      tx.set(
        depRef,
        {
          stats: {
            allTime: {
              ratingCount: 1,
              ratingSum: n,
              ratingAvg: n,
              lastRating: n,
              lastRatingAt: FieldValue.serverTimestamp(),
              lowRatingCountTotal: n <= 2 ? 1 : 0,
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    const dd = depSnap.data() as any;
    const allTime = dd?.stats?.allTime ?? {};
    const prevCount = typeof allTime.ratingCount === "number" ? allTime.ratingCount : 0;
    const prevSum = typeof allTime.ratingSum === "number" ? allTime.ratingSum : 0;

    const nextCount = prevCount + 1;
    const nextSum = prevSum + n;
    const nextAvg = nextCount > 0 ? Math.round((nextSum / nextCount) * 100) / 100 : null;

    const prevLow = typeof allTime.lowRatingCountTotal === "number" ? allTime.lowRatingCountTotal : 0;
    const nextLow = n <= 2 ? prevLow + 1 : prevLow;

    tx.set(
      depRef,
      {
        stats: {
          allTime: {
            ratingCount: nextCount,
            ratingSum: nextSum,
            ratingAvg: nextAvg,
            lastRating: n,
            lastRatingAt: FieldValue.serverTimestamp(),
            lowRatingCountTotal: nextLow,
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

// ----------------------------
// NOVO: adicionar item extra (1 vez)
// ----------------------------
export async function addExtraItemsOnce(params: {
  tenantCnpj: string;
  orderId: string;
  extraText: string;
}): Promise<{ ok: boolean; reason?: string; mergedText?: string }> {
  const extra = (params.extraText ?? "").trim().slice(0, 280);
  if (!extra) return { ok: false, reason: "EMPTY" };

  const appRef = tenantCollections(params.tenantCnpj);
  const orderRef = appRef.orders.doc(params.orderId);

  let result: { ok: boolean; reason?: string; mergedText?: string } = { ok: false, reason: "UNKNOWN" };

  await appRef.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      result = { ok: false, reason: "NOT_FOUND" };
      return;
    }

    const d = snap.data() as any;
    const status: OrderStatus = (d.status as OrderStatus) ?? "CREATED";
    const f: FulfillmentStatus = (d.fulfillmentStatus as FulfillmentStatus) ?? "NONE";

    if (TERMINAL.has(status)) {
      result = { ok: false, reason: "TERMINAL" };
      return;
    }

    // só antes de A_CAMINHO
    if (fRank(f) >= fRank("A_CAMINHO")) {
      result = { ok: false, reason: "TOO_LATE" };
      return;
    }

    const count = typeof d.itemAddCount === "number" ? d.itemAddCount : 0;
    if (count >= 1) {
      result = { ok: false, reason: "ALREADY_USED" };
      return;
    }

    const base = String(d.itensDescricao ?? "").trim();
    const merged = base
      ? `${base}\n\n+ EXTRA (cliente): ${extra}`
      : `+ EXTRA (cliente): ${extra}`;

    tx.set(
      orderRef,
      {
        itensDescricao: merged,
        itemAddCount: 1,
        itemAddLastText: extra,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    result = { ok: true, mergedText: merged };
  });

  return result;
}

// ----------------------------
// NOVO: mudar endereço (1 vez) antes de A_CAMINHO
// ----------------------------
export async function changeDeliveryAddressOnce(params: {
  tenantCnpj: string;
  orderId: string;
  formattedAddress: string;
  cep?: string | null;
  lat?: number | null;
  lng?: number | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const address = (params.formattedAddress ?? "").trim().slice(0, 300);
  if (!address) return { ok: false, reason: "EMPTY" };

  const appRef = tenantCollections(params.tenantCnpj);
  const orderRef = appRef.orders.doc(params.orderId);

  let result: { ok: boolean; reason?: string } = { ok: false, reason: "UNKNOWN" };

  await appRef.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) {
      result = { ok: false, reason: "NOT_FOUND" };
      return;
    }

    const d = snap.data() as any;
    const status: OrderStatus = (d.status as OrderStatus) ?? "CREATED";
    const f: FulfillmentStatus = (d.fulfillmentStatus as FulfillmentStatus) ?? "NONE";
    const canal: PedidoCanal | null = (d.canal as PedidoCanal | null) ?? null;

    if (TERMINAL.has(status)) {
      result = { ok: false, reason: "TERMINAL" };
      return;
    }

    if (canal !== "DELIVERY") {
      result = { ok: false, reason: "NOT_DELIVERY" };
      return;
    }

    if (fRank(f) >= fRank("A_CAMINHO")) {
      result = { ok: false, reason: "TOO_LATE" };
      return;
    }

    const count = typeof d.addressChangeCount === "number" ? d.addressChangeCount : 0;
    if (count >= 1) {
      result = { ok: false, reason: "ALREADY_USED" };
      return;
    }

    tx.set(
      orderRef,
      {
        enderecoEntrega: address,
        cepEntrega: params.cep ?? null,
        geoLat: typeof params.lat === "number" ? params.lat : null,
        geoLng: typeof params.lng === "number" ? params.lng : null,
        enderecoConfirmado: true,
        addressChangeCount: 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    result = { ok: true };
  });

  return result;
}

// ----------------------------
// Active order pointer (user)
// ----------------------------
function userRef(tenantId: string, userId: string) {
  return usersCol(tenantId).doc(userId);
}

function orderRef(tenantId: string, orderId: string) {
  return ordersCol(tenantId).doc(orderId);
}

export async function setUserActiveOrderId(params: {
  tenantId: string;
  userId: string;
  orderId: string;
}): Promise<void> {
  await userRef(params.tenantId, params.userId).set(
    {
      activeOrderId: params.orderId,
      activeOrderUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function clearUserActiveOrderId(params: {
  tenantId: string;
  userId: string;
  ifOrderId?: string | null;
}): Promise<void> {
  const ref = userRef(params.tenantId, params.userId);

  await ref.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const cur = (snap.data() as any)?.activeOrderId ?? null;
    if (params.ifOrderId && cur && String(cur) !== String(params.ifOrderId)) return;

    tx.set(
      ref,
      {
        activeOrderId: null,
        activeOrderUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function tryCloseOrderCycle(params: {
  tenantId: string;
  userId: string;
  orderId: string;
}): Promise<{ closed: boolean; pointerCleared: boolean; reason: string }> {
  const oRef = orderRef(params.tenantId, params.orderId);
  const uRef = userRef(params.tenantId, params.userId);

  let result: { closed: boolean; pointerCleared: boolean; reason: string } = {
    closed: false,
    pointerCleared: false,
    reason: "UNKNOWN",
  };

  await oRef.firestore.runTransaction(async (tx) => {
    const [oSnap, uSnap] = await Promise.all([tx.get(oRef), tx.get(uRef)]);
    if (!oSnap.exists) {
      result = { closed: false, pointerCleared: false, reason: "ORDER_NOT_FOUND" };
      return;
    }

    const status = ((oSnap.data() as any)?.status as OrderStatus) ?? "CREATED";
    const canClose = status === "ACCEPTED" || status === "DONE";
    if (!canClose) {
      result = { closed: false, pointerCleared: false, reason: "INVALID_STATUS" };
      return;
    }

    let pointerCleared = false;
    if (uSnap.exists) {
      const cur = (uSnap.data() as any)?.activeOrderId ?? null;
      if (cur && String(cur) === String(params.orderId)) {
        tx.set(
          uRef,
          {
            activeOrderId: null,
            activeOrderUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        pointerCleared = true;
      }
    }

    if (status === "ACCEPTED") {
      tx.set(
        oRef,
        {
          status: "DONE",
          doneAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      result = { closed: true, pointerCleared, reason: "OK" };
      return;
    }

    result = { closed: false, pointerCleared, reason: "ALREADY_DONE" };
  });

  return result;
}

export async function getOrderById(params: {
  tenantId: string;
  orderId: string;
}): Promise<Order | null> {
  const snap = await orderRef(params.tenantId, params.orderId).get();
  if (!snap.exists) return null;

  const data = snap.data() as any;

  const tentativas = Array.isArray(data.tentativasDepositos)
    ? data.tentativasDepositos.map((x: any) => String(x))
    : [];

  const riskFlags: RiskFlag[] = Array.isArray(data.riskFlags)
    ? data.riskFlags.map((x: any) => String(x))
    : [];

  return {
    id: snap.id,
    tenantId: String(data.tenantId ?? params.tenantId ?? "app"),
    userId: String(data.userId ?? ""),
    phoneNumberId: String(data.phoneNumberId ?? ""),

    publicSeq: typeof data.publicSeq === "number" ? data.publicSeq : null,
    publicCode: data.publicCode ?? null,
    publicHash: data.publicHash ?? null,
    publicWaId: data.publicWaId ?? null,
    publicClientName: data.publicClientName ?? null,

    bairro: data.bairro ?? null,
    itensDescricao: data.itensDescricao ?? null,
    canal: (data.canal as PedidoCanal | null) ?? null,

    depositoId: data.depositoId ?? null,

    enderecoEntrega: data.enderecoEntrega ?? null,
    cepEntrega: data.cepEntrega ?? null,
    referenciaEntrega: data.referenciaEntrega ?? null,
    geoLat: typeof data.geoLat === "number" ? data.geoLat : null,
    geoLng: typeof data.geoLng === "number" ? data.geoLng : null,
    enderecoConfirmado:
      typeof data.enderecoConfirmado === "boolean" ? data.enderecoConfirmado : null,

    tentativasDepositos: tentativas,

    status: (data.status as OrderStatus) ?? "CREATED",
    fulfillmentStatus: (data.fulfillmentStatus as FulfillmentStatus) ?? "NONE",

    valorTotalPedido: typeof data.valorTotalPedido === "number" ? data.valorTotalPedido : null,
    valorSourceText: data.valorSourceText ?? null,
    valorPropostoAt: data.valorPropostoAt ?? null,
    valorConfirmadoAt: data.valorConfirmadoAt ?? null,
    valorRejeitadoAt: data.valorRejeitadoAt ?? null,
    pricing: data.pricing ?? null,

    lastActionBy: data.lastActionBy ?? null,
    lastActionAt: data.lastActionAt ?? null,
    lastActionTextPreview: data.lastActionTextPreview ?? null,

    riskFlags,
    complaintOpen: Boolean(data.complaintOpen ?? false),
    missingItemsReported: Boolean(data.missingItemsReported ?? false),
    evidenceRequested: Boolean(data.evidenceRequested ?? false),

    feedbackNota: typeof data.feedbackNota === "number" ? data.feedbackNota : null,
    feedbackAt: data.feedbackAt ?? null,

    issueOpenId: data.issueOpenId ?? null,

    reminders: data.reminders ?? null,

    deliveredByClienteAt: data.deliveredByClienteAt ?? null,
    deliveredByDepositoAt: data.deliveredByDepositoAt ?? null,
    deliveredPresumidoAt: data.deliveredPresumidoAt ?? null,

    printKey: data.printKey ?? null,
    promoDiscountCandidate: data.promoDiscountCandidate ?? null,
    promoHistoryRecordedAt: data.promoHistoryRecordedAt ?? null,
    notifyLog: data.notifyLog ?? null,
    actionLog: data.actionLog ?? null,

    addressChangeCount: typeof data.addressChangeCount === "number" ? data.addressChangeCount : 0,
    itemAddCount: typeof data.itemAddCount === "number" ? data.itemAddCount : 0,
    itemAddLastText: data.itemAddLastText ?? null,

    clientDepositoAnnouncedId: data.clientDepositoAnnouncedId ?? null,
    clientDepositoAnnouncedAt: data.clientDepositoAnnouncedAt ?? null,

    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    routedAt: data.routedAt ?? null,
    notifiedAt: data.notifiedAt ?? null,
    acceptedAt: data.acceptedAt ?? null,
    declinedAt: data.declinedAt ?? null,
    timeoutAt: data.timeoutAt ?? null,
    canceledAt: data.canceledAt ?? null,
    doneAt: data.doneAt ?? null,
  };
}

/**
 * Cancelamento "limpo":
 * - Se status=CREATED: deleta o doc (hard reset)
 * - Se status=ROUTED/NOTIFIED: marca CANCELED (mantém auditoria)
 * - Sempre limpa users/{userId}.activeOrderId se estiver apontando pra esse orderId
 */
export async function cancelOrderAndClearPointer(params: {
  tenantId: string;
  userId: string;
  orderId: string;
  reason: string;
}): Promise<{ deleted: boolean; canceled: boolean }> {
  const oRef = orderRef(params.tenantId, params.orderId);
  const uRef = userRef(params.tenantId, params.userId);

  let out = { deleted: false, canceled: false };

  await oRef.firestore.runTransaction(async (tx) => {
    const [oSnap, uSnap] = await Promise.all([tx.get(oRef), tx.get(uRef)]);

    // limpa ponteiro mesmo se o pedido sumiu
    if (uSnap.exists) {
      const cur = (uSnap.data() as any)?.activeOrderId ?? null;
      if (cur && String(cur) === String(params.orderId)) {
        tx.set(
          uRef,
          {
            activeOrderId: null,
            activeOrderUpdatedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
    }

    if (!oSnap.exists) return;

    const curStatus = ((oSnap.data() as any)?.status as OrderStatus) ?? "CREATED";

    if (curStatus === "CREATED") {
      tx.delete(oRef);
      out = { deleted: true, canceled: false };
      return;
    }

    if (curStatus === "ROUTED" || curStatus === "NOTIFIED") {
      tx.set(
        oRef,
        {
          status: "CANCELED",
          cancelReason: params.reason.slice(0, 120),
          cancelBy: "cliente",
          canceledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      out = { deleted: false, canceled: true };
      return;
    }

    // ACCEPTED e além: não mexe aqui
  });

  return out;
}

// ----------------------------
// NOVO: marcar strike hard no depósito (anti-reputação)
// ----------------------------
export async function strikeDepositoHard(params: {
  tenantCnpj: string;
  depositoId: string;
  reason: string;
  kind: "TIMEOUT" | "NO_VALOR" | "NO_UPDATE" | "ISSUE_STALE";
}): Promise<void> {
  const appRef = tenantCollections(params.tenantCnpj);
  const depRef = appRef.depositos.doc(params.depositoId);

  await appRef.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(depRef);
    const d = snap.exists ? (snap.data() as any) : {};

    const allTime = d?.stats?.allTime ?? {};
    const prevStrikes = typeof allTime.strikesHard === "number" ? allTime.strikesHard : 0;

    const nextStrikes = prevStrikes + 1;

    const allTimePatch: any = {
      strikesHard: nextStrikes,
    };

    if (params.kind === "TIMEOUT") allTimePatch.timeoutCountTotal = FieldValue.increment(1);
    if (params.kind === "ISSUE_STALE") allTimePatch.issueCountTotal = FieldValue.increment(1);

    const patch: any = {
      stats: {
        allTime: allTimePatch,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (params.kind === "TIMEOUT") {
      patch.operational = {
        offlineUntilMs: Date.now() + DEPOSITO_OFFLINE_TIMEOUT_MS,
        updatedAt: FieldValue.serverTimestamp(),
      };
    }

    // hard fallback: strikesHard >= 4 => EM_OBSERVACAO, >= 8 => SUSPENSO
    let statusQualidade: string | null = null;
    if (nextStrikes >= 8) statusQualidade = "SUSPENSO";
    else if (nextStrikes >= 4) statusQualidade = "EM_OBSERVACAO";

    if (statusQualidade) {
      patch.quality = {
        statusQualidade,
        reason: `hard:${params.kind}:${params.reason}`.slice(0, 220),
        updatedAt: FieldValue.serverTimestamp(),
      };
    }

    tx.set(depRef, patch, { merge: true });
  });
}

// ----------------------------
// Observabilidade: outbound (WhatsApp)
// ----------------------------
export async function trackOrderOutboundMessage(params: {
  tenantCnpj: string;
  orderId: string;
  userId?: string | null;
  depositoId?: string | null;
  phoneNumberId?: string | null;
  toWaId: string;
  kind: "sticker" | "text" | "buttons" | "template" | "location_request" | "other";
  ok: boolean;
  motivo?: string | null;
  bodyPreview?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  const tenantCnpj = String(params.tenantCnpj ?? "app") || "app";
  const orderId = String(params.orderId ?? "").trim();
  if (!orderId) return;

  const kind = params.kind ?? "other";
  const ok = Boolean(params.ok);

  const eventName = `WA_OUT_${String(kind).toUpperCase()}_${ok ? "OK" : "FAIL"}`;

  const merged: Record<string, unknown> = {
    toWaId: String(params.toWaId ?? "").replace(/\D/g, ""),
    phoneNumberId: params.phoneNumberId ?? null,
    motivo: params.motivo ?? null,
    bodyPreview: (params.bodyPreview ?? "").slice(0, 220) || null,
  };

  const extra = params.payload ?? null;
  if (extra && typeof extra === "object") {
    for (const [k, v] of Object.entries(extra)) {
      if (k in merged) continue;
      merged[k] = v as unknown;
    }
  }

  await logEvent({
    tenantCnpj,
    eventName,
    orderId,
    userId: params.userId ?? null,
    depositoId: params.depositoId ?? null,
    payload: merged,
  });
}

/**
 * CHECKLIST:
 * - trackOrderOutboundMessage grava eventos WA_OUT_* por orderId via eventLogService (OK/FAIL).
 * - Evita reticências de placeholder no arquivo; sem uso de operadores de espalhamento.
 * - Mantém compatibilidade com schema atual de orders/depositos/users.
 *
 * DEPENDÊNCIAS:
 * - Feature flag: FEATURE_EVENTLOG_ENABLED (se false, não grava eventos).
 * - Firestore: orders/{orderId}/events (eventLogService) ou events_days/{YYYY-MM-DD}/items (fallback sem orderId).
 * - Nenhum ENV novo.
 */

