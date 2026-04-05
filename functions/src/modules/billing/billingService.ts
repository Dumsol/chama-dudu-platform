import * as admin from "firebase-admin";
import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { FieldValue } from "../../infra/config/firebase";
import {
  billingCyclesCol,
  billingEventsCol,
  depositosCol,
  ordersCol,
} from "../../infra/firestore/duduPaths";
import { computeWeeklyFee } from "./feeCalculator";
import { logEvent } from "../../infra/obs/eventLogService";
import {
  SEED_TEST_IMMEDIATE_BILLING_CYCLE_KEY,
  isSeedTestDepositoIdentity,
} from "../../domain/seedTestDeposito";
import {
  sendWhatsAppTemplateMessage,
  sendWhatsAppTextMessage,
} from "../whatsapp/send";
import {
  createCobPix,
  makeStableTxidFromCycleId,
  getCobByTxid,
} from "./interPixService";

const BILLING_PAYMENT_BASE_URL = String(
  process.env.BILLING_PAYMENT_BASE_URL ?? "https://app.chamadudu.com.br/pagamento",
).replace(/\/+$/, "");

const PIX_EXPIRATION_SECONDS = Number(
  process.env.BILLING_PIX_EXPIRATION_SECONDS ?? String(24 * 3600),
);

const PLATFORM_FEE_DEFAULT_CENTAVOS = 150;
const BILLING_WARNING_WINDOW_MS = 2 * 60 * 60 * 1000;
const BILLING_WARNING_TEMPLATE_NAME =
  process.env.WA_TEMPLATE_BILLING_WARNING ??
  process.env.WHATSAPP_TEMPLATE_BILLING_WARNING ??
  "billing_warning_v2";

const TX_MAX_RETRIES = Math.max(1, Math.min(Number(process.env.TX_MAX_RETRIES ?? "5"), 10));

function shouldRetryTransaction(err: any): boolean {
  const code = String(err?.code ?? err?.status ?? "");
  const msg = String(err?.message ?? "");
  return code === "10" || code === "ABORTED" || msg.toLowerCase().includes("aborted");
}

async function runTransactionWithRetry<T>(
  fn: (tx: admin.firestore.Transaction) => Promise<T>,
): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= TX_MAX_RETRIES; attempt += 1) {
    try {
      return await admin.firestore().runTransaction(fn);
    } catch (err: any) {
      lastErr = err;
      if (!shouldRetryTransaction(err) || attempt >= TX_MAX_RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, 80 * attempt));
    }
  }
  throw lastErr;
}

export type BillingCycleStatus = "OPEN" | "PAID" | "EXPIRED" | "CANCELED";

export type BillingCycleDoc = {
  depositoId: string;
  periodStart: admin.firestore.Timestamp;
  periodEnd: admin.firestore.Timestamp;

  deliveredCount: number;
  gmvCentavos: number;
  serviceFeeRepasseCentavos: number;
  platformCommissionCentavos: number;
  totalCentavos: number;
  baseCentavos: number;
  rateBps: number;
  varCentavos: number;

  status: BillingCycleStatus;

  paymentToken: string;
  paymentUrl: string;

  inter: {
    txid: string;
    brcode: string;
    qrCodeBase64?: string | null;
    createdAt?: admin.firestore.Timestamp | null;
    expiresAt?: admin.firestore.Timestamp | null;
    endToEndId?: string | null;
    paidAt?: admin.firestore.Timestamp | null;
    valorRecebidoCentavos?: number | null;
  };

  warningSentAt?: admin.firestore.Timestamp | null;
  initialNoticeSentAt?: admin.firestore.Timestamp | null;

  createdAt: admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
};

export function cyclesCol(tenantCnpj: string) {
  return billingCyclesCol(tenantCnpj);
}

export function eventsCol(tenantCnpj: string) {
  return billingEventsCol(tenantCnpj);
}

function tokenHex(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function buildCycleIdForDeposito(depositoId: string, periodEndKey: string): string {
  return `${depositoId}_${periodEndKey}`;
}

function buildPaymentUrl(depositoId: string, cycleId: string, token: string): string {
  return `${BILLING_PAYMENT_BASE_URL}/${encodeURIComponent(
    depositoId,
  )}?c=${encodeURIComponent(cycleId)}&t=${encodeURIComponent(token)}`;
}

export function asIntCentavosFromUnknown(v: any): number {
  if (v == null) return 0;

  if (typeof v === "number" && Number.isFinite(v)) {
    // Pode ser centavos OU reais. Heuristica:
    if (Number.isInteger(v) && v >= 1000) return Math.max(0, v); // centavos
    return Math.max(0, Math.round(v * 100)); // reais
  }

  if (typeof v === "string") {
    const s = v.trim().replace(",", ".");
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    if (!Number.isInteger(n)) return Math.max(0, Math.round(n * 100));
    return Math.max(0, n);
  }

  return 0;
}

function extractOrderGmvCentavos(order: any): number {
  const candidates = [
    order?.gmvCentavos,
    order?.valorItensCentavos,
    order?.valorTotalItensCentavos,
    order?.valorProdutosCentavos,
    order?.valorTotalPedidoCentavos,
    order?.valorConfirmadoCentavos,
  ];

  for (const c of candidates) {
    const n = asIntCentavosFromUnknown(c);
    if (n > 0) return n;
  }

  const fallback = asIntCentavosFromUnknown(order?.valorTotalPedido ?? order?.valorTotal);
  return fallback > 0 ? fallback : 0;
}

function extractServiceFeeRepasseCentavos(order: any): number {
  const raw = order?.pricing?.serviceFee ?? order?.serviceFee;
  const v = asIntCentavosFromUnknown(raw);
  return v > 0 ? v : 0;
}

function extractPlatformFeeCentavos(order: any): number {
  const raw =
    order?.platformFeeSnapshot ??
    order?.pricing?.platformFeeSnapshot ??
    order?.platformFeePerDelivered ??
    null;
  const v = asIntCentavosFromUnknown(raw);
  return v > 0 ? v : PLATFORM_FEE_DEFAULT_CENTAVOS;
}

function extractDeliveredAtMillis(order: any): number | null {
  const ts =
    order?.deliveredAt ??
    order?.deliveredByClienteAt ??
    order?.deliveredPresumidoAt ??
    null;

  if (!ts) return null;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  if (typeof ts === "number") return ts;
  return null;
}

async function markCyclePaid(
  cycleRef: admin.firestore.DocumentReference,
  params: {
    endToEndId?: string | null;
    valorRecebidoCentavos?: number | null;
  },
): Promise<{ alreadyPaid: boolean; cycleId: string; depositoId: string }> {
  return runTransactionWithRetry(async (tx) => {
    const snap = await tx.get(cycleRef);
    if (!snap.exists) {
      throw new Error(`billing cycle not found: ${cycleRef.path}`);
    }

    const data = snap.data() as any;
    const currentStatus = String(data?.status ?? "OPEN");
    const depositoId = String(data?.depositoId ?? "").trim();

    if (currentStatus === "PAID") {
      return { alreadyPaid: true, cycleId: cycleRef.id, depositoId };
    }

    const currentInter = data?.inter ?? {};
    const interUpdate: any = {
      ...currentInter,
      endToEndId: params.endToEndId ?? currentInter.endToEndId ?? null,
      paidAt: FieldValue.serverTimestamp(),
      valorRecebidoCentavos:
        params.valorRecebidoCentavos != null
          ? params.valorRecebidoCentavos
          : currentInter.valorRecebidoCentavos ?? null,
    };

    tx.set(
      cycleRef,
      {
        status: "PAID",
        inter: interUpdate,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { alreadyPaid: false, cycleId: cycleRef.id, depositoId };
  });
}

/**
 * computeWeeklyTotalsForDeposito(depositoId, periodStart, periodEnd)
 * - deliveredCount: fulfillment entregue (confirmado/presumido), sem cancelamento.
 * - GMV: soma em centavos (sem float).
 *
 * Producao (KISS): se query seletiva falhar (indice ausente/erro), SUPRIME cobranca.
 */
export async function computeWeeklyTotalsForDeposito(
  tenantCnpj: string,
  depositoId: string,
  periodStart: admin.firestore.Timestamp,
  periodEnd: admin.firestore.Timestamp,
): Promise<{
  deliveredCount: number;
  gmvCentavos: number;
  serviceFeeRepasseCentavos: number;
  platformCommissionCentavos: number;
}> {
  const ordersRef = ordersCol(tenantCnpj);
  const delivered = ["ENTREGUE_CONFIRMADO", "ENTREGUE_PRESUMIDO"];

  try {
    const snap = await ordersRef
      .where("depositoId", "==", depositoId)
      .where("deliveredAt", ">=", periodStart)
      .where("deliveredAt", "<", periodEnd)
      .where("fulfillmentStatus", "in", delivered as any)
      .limit(2000)
      .get();

    let deliveredCount = 0;
    let gmvCentavos = 0;
    let serviceFeeRepasseCentavos = 0;
    let platformCommissionCentavos = 0;
    let missingServiceFee = 0;
    let missingPlatformFee = 0;
    let missingDeliveredAt = 0;

    for (const doc of snap.docs) {
      const d = doc.data() as any;
      if (d?.status === "CANCELED" || d?.cancelReason) continue;

      const deliveredAtMs = extractDeliveredAtMillis(d);
      if (!deliveredAtMs) {
        missingDeliveredAt += 1;
        continue;
      }

      deliveredCount += 1;
      gmvCentavos += extractOrderGmvCentavos(d);
      const serviceFee = extractServiceFeeRepasseCentavos(d);
      const platformFee = extractPlatformFeeCentavos(d);
      if (!serviceFee) missingServiceFee += 1;
      if (!platformFee) missingPlatformFee += 1;
      serviceFeeRepasseCentavos += serviceFee;
      platformCommissionCentavos += platformFee;
    }

    if (missingServiceFee || missingPlatformFee || missingDeliveredAt) {
      await logEvent({
        tenantCnpj,
        eventName: "BILLING_Q1_MISSING_FIELDS",
        depositoId,
        payload: {
          missingServiceFee,
          missingPlatformFee,
          missingDeliveredAt,
          periodStartMs: periodStart.toMillis(),
          periodEndMs: periodEnd.toMillis(),
        },
      }).catch(() => void 0);
    }

    return { deliveredCount, gmvCentavos, serviceFeeRepasseCentavos, platformCommissionCentavos };
  } catch (err: any) {
    logger.error("Billing: query seletiva falhou; cobranca suprimida (guardrail)", {
      depositoId,
      error: err?.message ?? String(err),
    });

    await logEvent({
      tenantCnpj,
      eventName: "BILLING_GUARDRAIL_QUERY_FAILED",
      depositoId,
      payload: {
        periodStartMs: periodStart.toMillis(),
        periodEndMs: periodEnd.toMillis(),
        reason: err?.message ?? String(err),
      },
    }).catch(() => void 0);

    return {
      deliveredCount: 0,
      gmvCentavos: 0,
      serviceFeeRepasseCentavos: 0,
      platformCommissionCentavos: 0,
    };
  }
}

export function formatYyyyMmDdInTz(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date).replace(/-/g, "");
}

function weekdayMon0Sun6(date: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const w = fmt.format(date);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[w] ?? 0;
}

function getOffsetMinutesAtInstant(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);

  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const m = /(GMT|UTC)([+-]\d{1,2})(?::?(\d{2}))?/.exec(tzName);
  if (!m) return 0;

  const sign = m[2].startsWith("-") ? -1 : 1;
  const hh = Math.abs(parseInt(m[2], 10));
  const mm = m[3] ? parseInt(m[3], 10) : 0;
  return sign * (hh * 60 + mm);
}

function zonedMidnightToUtc(params: { y: number; m: number; d: number; timeZone: string }): Date {
  const { y, m, d, timeZone } = params;
  let utcMs = Date.UTC(y, m - 1, d, 0, 0, 0);

  for (let i = 0; i < 3; i++) {
    const offMin = getOffsetMinutesAtInstant(timeZone, new Date(utcMs));
    const candidate = Date.UTC(y, m - 1, d, 0, 0, 0) - offMin * 60_000;
    if (candidate === utcMs) break;
    utcMs = candidate;
  }

  return new Date(utcMs);
}

function addDaysYmd(
  y: number,
  m: number,
  d: number,
  delta: number,
): { y: number; m: number; d: number } {
  const base = Date.UTC(y, m - 1, d, 12, 0, 0);
  const shifted = new Date(base + delta * 86_400_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

function ymdInTz(date: Date, timeZone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  return { y, m, d };
}

/**
 * Semana anterior no fuso: segunda 00:00 -> segunda 00:00
 */
export function previousWeekPeriod(timeZone = "America/Recife"): {
  periodStart: admin.firestore.Timestamp;
  periodEnd: admin.firestore.Timestamp;
  periodEndKey: string;
} {
  const now = new Date();

  const { y, m, d } = ymdInTz(now, timeZone);
  const dow = weekdayMon0Sun6(now, timeZone);
  const monday = addDaysYmd(y, m, d, -dow);
  const mondayUtc = zonedMidnightToUtc({ ...monday, timeZone });

  const periodEnd = new Date(mondayUtc.getTime());
  const periodStart = new Date(mondayUtc.getTime() - 7 * 86_400_000);

  const periodEndKey = formatYyyyMmDdInTz(periodEnd, timeZone);

  return {
    periodStart: admin.firestore.Timestamp.fromDate(periodStart),
    periodEnd: admin.firestore.Timestamp.fromDate(periodEnd),
    periodEndKey,
  };
}

export async function listDepositosAtivosIds(tenantCnpj: string): Promise<string[]> {
  const snap = await depositosCol(tenantCnpj).limit(2000).get();
  const ids: string[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as any;
    if (d?.deleted === true) continue;
    if (d?.disabled === true) continue;
    ids.push(doc.id);
  }
  return ids;
}

export async function ensureWeeklyBillingCycleForDeposito(params: {
  tenantCnpj: string;
  depositoId: string;
  periodStart: admin.firestore.Timestamp;
  periodEnd: admin.firestore.Timestamp;
  periodEndKey: string;
}): Promise<{ cycleId: string; created: boolean; skipped: boolean; reason?: string }> {
  const { tenantCnpj, depositoId, periodStart, periodEnd, periodEndKey } = params;

  const cycleId = buildCycleIdForDeposito(depositoId, periodEndKey);
  const cycleRef = cyclesCol(tenantCnpj).doc(cycleId);

  const totals = await computeWeeklyTotalsForDeposito(
    tenantCnpj,
    depositoId,
    periodStart,
    periodEnd,
  );
  const fee = computeWeeklyFee(totals);

  if (fee.deliveredCount === 0 && fee.gmvCentavos === 0) {
    return { cycleId, created: false, skipped: true, reason: "SEM_MOVIMENTO" };
  }
  if (fee.totalCentavos <= 0) {
    return { cycleId, created: false, skipped: true, reason: "TOTAL_ZERO" };
  }

  const txid = makeStableTxidFromCycleId(cycleId);
  const paymentToken = tokenHex(16);
  const paymentUrl = buildPaymentUrl(depositoId, cycleId, paymentToken);

  const created = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(cycleRef);
    if (snap.exists) return false;

    const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + PIX_EXPIRATION_SECONDS * 1000,
    );

    const docData: BillingCycleDoc = {
      depositoId,
      periodStart,
      periodEnd,

      deliveredCount: fee.deliveredCount,
      gmvCentavos: fee.gmvCentavos,
      serviceFeeRepasseCentavos: fee.serviceFeeRepasseCentavos,
      platformCommissionCentavos: fee.platformCommissionCentavos,
      totalCentavos: fee.totalCentavos,
      baseCentavos: 0,
      rateBps: 0,
      varCentavos: 0,

      status: "OPEN",

      paymentToken,
      paymentUrl,

      inter: {
        txid,
        brcode: "",
        qrCodeBase64: null,
        createdAt: null,
        expiresAt,
        endToEndId: null,
        paidAt: null,
        valorRecebidoCentavos: null,
      },

      warningSentAt: null,

      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.set(cycleRef, docData as any, { merge: false });
    return true;
  });

  // Se ja existe, nao recria cobranca. Se existe e brcode ja foi setado antes, deixa quieto.
  const cycleSnap = await cycleRef.get();
  const cycle = cycleSnap.data() as any;
  const alreadyHasBrcode = Boolean(cycle?.inter?.brcode);

  if (!alreadyHasBrcode) {
    const cobranca = await createCobPix({
      txid,
      valorCentavos: fee.totalCentavos,
      expiracaoSegundos: PIX_EXPIRATION_SECONDS,
      solicitacaoPagador: `Chama Dudu - cobranca semanal (${periodEndKey})`,
    });

    await cycleRef.set(
      {
        inter: {
          txid: cobranca.txid,
          brcode: cobranca.brcode,
          qrCodeBase64: cobranca.qrCodeBase64 ?? null,
          createdAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  const latestCycleSnap = await cycleRef.get();
  const latestCycle = latestCycleSnap.data() as any;
  const latestBrcode = String(latestCycle?.inter?.brcode ?? "").trim();
  if (latestBrcode) {
    const noticeLocked = await lockCycleInitialNoticeOnce(cycleRef).catch(() => false);
    if (noticeLocked) {
      await notifyDepositoBillingCreated({
        tenantCnpj,
        cycleId,
        depositoId,
        paymentUrl: String(latestCycle?.paymentUrl ?? paymentUrl ?? ""),
        totalCentavos: Number(latestCycle?.totalCentavos ?? fee.totalCentavos ?? 0),
        brcode: latestBrcode,
        isImmediateTest: periodEndKey === SEED_TEST_IMMEDIATE_BILLING_CYCLE_KEY,
      }).catch(() => void 0);
    }
  }

  return { cycleId, created, skipped: false };
}

async function countDeliveredOrdersForDeposito(params: {
  tenantCnpj: string;
  depositoId: string;
}): Promise<number | null> {
  const delivered = ["ENTREGUE_CONFIRMADO", "ENTREGUE_PRESUMIDO"];
  const snap = await ordersCol(params.tenantCnpj)
    .where("depositoId", "==", params.depositoId)
    .where("fulfillmentStatus", "in", delivered as any)
    .limit(2)
    .get()
    .catch(() => null as any);

  if (!snap) return null;

  let deliveredCount = 0;
  for (const doc of snap.docs) {
    const data = doc.data() as any;
    if (data?.status === "CANCELED" || data?.cancelReason) continue;
    deliveredCount += 1;
  }
  return deliveredCount;
}

export async function maybeTriggerSeedTestImmediateBilling(params: {
  tenantCnpj: string;
  orderId: string;
}): Promise<{ triggered: boolean; reason: string; cycleId?: string }> {
  const orderSnap = await ordersCol(params.tenantCnpj).doc(params.orderId).get();
  if (!orderSnap.exists) {
    return { triggered: false, reason: "ORDER_NOT_FOUND" };
  }

  const orderData = orderSnap.data() as any;
  const fulfillment = String(orderData?.fulfillmentStatus ?? "");
  if (fulfillment !== "ENTREGUE_CONFIRMADO" && fulfillment !== "ENTREGUE_PRESUMIDO") {
    return { triggered: false, reason: "ORDER_NOT_DELIVERED" };
  }

  const depositoId = String(orderData?.depositoId ?? "").trim();
  if (!depositoId) {
    return { triggered: false, reason: "ORDER_WITHOUT_DEPOSITO" };
  }

  const depositoRef = depositosCol(params.tenantCnpj).doc(depositoId);
  const depositoSnap = await depositoRef.get();
  if (!depositoSnap.exists) {
    return { triggered: false, reason: "DEPOSITO_NOT_FOUND" };
  }

  const depositoData = depositoSnap.data() as any;
  const alreadyTriggeredCycleId = String(depositoData?.billing?.seedTestImmediateCycleId ?? "").trim();
  if (alreadyTriggeredCycleId) {
    return { triggered: false, reason: "ALREADY_TRIGGERED", cycleId: alreadyTriggeredCycleId };
  }

  const enabledByFlag = depositoData?.billingTestMode?.immediateOnFirstConfirmedOrder === true;
  const isSeed = enabledByFlag || isSeedTestDepositoIdentity({
    depositoId,
    cnpj: depositoData?.cnpj,
    waId: depositoData?.waId,
    whatsappRaw: depositoData?.whatsappRaw,
  });
  if (!isSeed) {
    return { triggered: false, reason: "NOT_SEED_DEPOSITO" };
  }

  const deliveredCount = await countDeliveredOrdersForDeposito({
    tenantCnpj: params.tenantCnpj,
    depositoId,
  });
  if (deliveredCount != null && deliveredCount > 1) {
    return { triggered: false, reason: "NOT_FIRST_CONFIRMED_ORDER" };
  }

  const nowMs = Date.now();
  const cycleResult = await ensureWeeklyBillingCycleForDeposito({
    tenantCnpj: params.tenantCnpj,
    depositoId,
    periodStart: admin.firestore.Timestamp.fromMillis(0),
    periodEnd: admin.firestore.Timestamp.fromMillis(nowMs + 60_000),
    periodEndKey: SEED_TEST_IMMEDIATE_BILLING_CYCLE_KEY,
  });

  if (cycleResult.skipped) {
    return { triggered: false, reason: cycleResult.reason ?? "CYCLE_SKIPPED", cycleId: cycleResult.cycleId };
  }

  await depositoRef.set(
    {
      billing: {
        seedTestImmediateCycleId: cycleResult.cycleId,
        seedTestImmediateOrderId: params.orderId,
        seedTestImmediateBilledAt: FieldValue.serverTimestamp(),
        seedTestImmediateReason: "FIRST_CONFIRMED_ORDER",
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return { triggered: true, reason: "TRIGGERED", cycleId: cycleResult.cycleId };
}

export async function getPublicCycleOrNull(params: {
  tenantCnpj: string;
  depositoId: string;
  cycleId: string;
  token: string;
}): Promise<any | null> {
  const { tenantCnpj, depositoId, cycleId, token } = params;

  const ref = cyclesCol(tenantCnpj).doc(cycleId);
  const snap = await ref.get();
  if (!snap.exists) return null;

  const d = snap.data() as any;
  if (String(d?.depositoId ?? "") !== depositoId) return null;
  if (String(d?.paymentToken ?? "") !== token) return null;

  const inter = d?.inter ?? {};
  const expiresAt = inter?.expiresAt?.toMillis?.() ?? null;

  const qrBase64 = inter?.qrCodeBase64 ?? null;
  const qrCodeDataUri = qrBase64 ? `data:image/png;base64,${qrBase64}` : null;

  return {
    status: d?.status ?? "OPEN",
    totalCentavos: Number(d?.totalCentavos ?? 0),
    expiresAt,
    brcode: inter?.brcode ?? null,
    qrCodeBase64: qrBase64,
    qrCodeDataUri,
    periodStart: d?.periodStart?.toMillis?.() ?? null,
    periodEnd: d?.periodEnd?.toMillis?.() ?? null,
    breakdown: {
      deliveredCount: Number(d?.deliveredCount ?? d?.pedidosLiquidos ?? 0),
      gmvCentavos: Number(d?.gmvCentavos ?? 0),
      serviceFeeRepasseCentavos: Number(d?.serviceFeeRepasseCentavos ?? 0),
      platformCommissionCentavos: Number(d?.platformCommissionCentavos ?? 0),
      totalCentavos: Number(d?.totalCentavos ?? 0),
      baseCentavos: Number(d?.baseCentavos ?? 0),
      rateBps: Number(d?.rateBps ?? 0),
      varCentavos: Number(d?.varCentavos ?? 0),
    },
  };
}

function formatBRLFromCentavos(v: number): string {
  const safe = Math.max(0, Math.round(v));
  const reais = (safe / 100).toFixed(2).replace(".", ",");
  return `R$ ${reais}`;
}

function extractTemplateUrlSuffix(paymentUrl: string | null): string | null {
  const full = String(paymentUrl ?? "").trim();
  if (!full) return null;

  const baseWithSlash = `${BILLING_PAYMENT_BASE_URL}/`;
  if (full.startsWith(baseWithSlash)) {
    const suffix = full.slice(baseWithSlash.length).trim();
    return suffix || null;
  }

  return null;
}

function buildBillingWarningTemplateComponents(params: {
  totalCentavos: number;
  paymentUrl: string | null;
}): any[] {
  const total = formatBRLFromCentavos(params.totalCentavos);
  const urlSuffix = extractTemplateUrlSuffix(params.paymentUrl);

  const components: any[] = [
    {
      type: "body",
      parameters: [{ type: "text", text: total }],
    },
  ];

  if (urlSuffix) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: urlSuffix }],
    });
  }

  return components;
}

export function resolveCycleTransition(params: {
  currentStatus: BillingCycleStatus;
  paid: boolean;
  expired: boolean;
}): BillingCycleStatus | null {
  if (params.currentStatus !== "OPEN") return null;
  if (params.paid) return "PAID";
  if (params.expired) return "EXPIRED";
  return null;
}

export function hasOverdueOpenCycle(params: {
  cycles: Array<{ status: BillingCycleStatus; expiresAtMs: number | null }>;
  nowMs: number;
}): boolean {
  for (const c of params.cycles) {
    if (c.status !== "OPEN" && c.status !== "EXPIRED") continue;
    const expMs = c.expiresAtMs;
    if (!expMs) return true;
    if (expMs <= params.nowMs) return true;
  }
  return false;
}

async function lockCycleInitialNoticeOnce(cycleRef: admin.firestore.DocumentReference): Promise<boolean> {
  let allowed = false;
  await runTransactionWithRetry(async (tx) => {
    const snap = await tx.get(cycleRef);
    if (!snap.exists) return;

    const data = snap.data() as any;
    if (data?.initialNoticeSentAt) return;

    tx.set(
      cycleRef,
      { initialNoticeSentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    allowed = true;
  });
  return allowed;
}

async function lockBillingWarningOnce(cycleRef: admin.firestore.DocumentReference): Promise<boolean> {
  let allowed = false;
  await runTransactionWithRetry(async (tx) => {
    const snap = await tx.get(cycleRef);
    if (!snap.exists) return;

    const data = snap.data() as any;
    if (data?.warningSentAt) return;

    tx.set(
      cycleRef,
      { warningSentAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    allowed = true;
  });

  return allowed;
}

async function resolveDepositoContact(params: {
  tenantCnpj: string;
  depositoId: string;
}): Promise<{ waId: string | null; nome: string | null; phoneNumberId: string | null }> {
  const depSnap = await depositosCol(params.tenantCnpj)
    .doc(params.depositoId)
    .get()
    .catch(() => null as any);
  const depData = depSnap?.exists ? (depSnap.data() as any) : null;
  const waId = depData?.waId ? String(depData.waId) : null;
  const nome = depData?.nome ? String(depData.nome).slice(0, 80) : null;
  const phoneNumberId = depData?.phoneNumberId ? String(depData.phoneNumberId) : null;

  if (phoneNumberId) return { waId, nome, phoneNumberId };

  const oSnap = await ordersCol(params.tenantCnpj)
    .where("depositoId", "==", params.depositoId)
    .limit(1)
    .get()
    .catch(() => null as any);

  const order = oSnap && !oSnap.empty ? (oSnap.docs[0].data() as any) : null;
  const phoneFromOrder = order?.phoneNumberId ? String(order.phoneNumberId) : null;

  return { waId, nome, phoneNumberId: phoneFromOrder };
}

async function notifyDepositoBillingCreated(params: {
  tenantCnpj: string;
  cycleId: string;
  depositoId: string;
  paymentUrl: string | null;
  totalCentavos: number;
  brcode: string | null;
  isImmediateTest: boolean;
}): Promise<void> {
  const contact = await resolveDepositoContact({
    tenantCnpj: params.tenantCnpj,
    depositoId: params.depositoId,
  });
  if (!contact.waId || !contact.phoneNumberId) {
    logger.warn("Billing: criacao sem contato", {
      cycleId: params.cycleId,
      depositoId: params.depositoId,
    });
    return;
  }

  const total = formatBRLFromCentavos(params.totalCentavos);
  const intro = params.isImmediateTest
    ? "Cobranca de teste gerada apos o primeiro pedido confirmado."
    : "Cobranca semanal gerada.";
  const pixCopyPaste = params.brcode ? `PIX copia e cola:\n${params.brcode}` : "PIX copia e cola pendente.";
  const body =
    `${intro}\n` +
    `Total: ${total}\n` +
    `Pagamento: ${params.paymentUrl ?? "(link pendente)"}\n\n` +
    pixCopyPaste;

  try {
    await sendWhatsAppTextMessage({
      tenantCnpj: params.tenantCnpj,
      phoneNumberId: contact.phoneNumberId,
      to: contact.waId,
      body,
    });
  } catch (err: any) {
    logger.warn("Billing: envio da cobranca falhou", {
      cycleId: params.cycleId,
      depositoId: params.depositoId,
      error: err?.message ?? String(err),
    });
  }
}

async function notifyDepositoBillingWarning(params: {
  tenantCnpj: string;
  cycleId: string;
  depositoId: string;
  paymentUrl: string | null;
  totalCentavos: number;
  expiresAtMs: number | null;
}): Promise<void> {
  const contact = await resolveDepositoContact({
    tenantCnpj: params.tenantCnpj,
    depositoId: params.depositoId,
  });
  if (!contact.waId || !contact.phoneNumberId) {
    logger.warn("Billing: aviso expiracao sem contato", {
      cycleId: params.cycleId,
      depositoId: params.depositoId,
    });
    return;
  }

  const total = formatBRLFromCentavos(params.totalCentavos);
  const body =
    "Aviso: tua cobranca semanal vence em ate 2h.\n" +
    `Total a pagar: ${total}.\n` +
    `Link: ${params.paymentUrl ?? "(link pendente)"}`;

  if (BILLING_WARNING_TEMPLATE_NAME) {
    try {
      await sendWhatsAppTemplateMessage({
        tenantCnpj: params.tenantCnpj,
        phoneNumberId: contact.phoneNumberId,
        to: contact.waId,
        name: BILLING_WARNING_TEMPLATE_NAME,
        components: buildBillingWarningTemplateComponents({
          totalCentavos: params.totalCentavos,
          paymentUrl: params.paymentUrl,
        }),
      });
      return;
    } catch (err: any) {
      logger.warn("Billing: template aviso expiracao falhou", {
        cycleId: params.cycleId,
        depositoId: params.depositoId,
        error: err?.message ?? String(err),
      });
    }
  }

  try {
    await sendWhatsAppTextMessage({
      tenantCnpj: params.tenantCnpj,
      phoneNumberId: contact.phoneNumberId,
      to: contact.waId,
      body,
    });
  } catch (err: any) {
    logger.warn("Billing: aviso expiracao texto falhou", {
      cycleId: params.cycleId,
      depositoId: params.depositoId,
      error: err?.message ?? String(err),
    });
  }
}

/**
 * Webhook idempotente:

 * - cria billingEvents docId endToEndId (se existir) senao txid
 * - localiza cycle por inter.txid == txid
 * - marca cycle como PAID
 * - desbloqueia deposito se nao existir outro atraso pendente
 */
export async function markPaidByInterPixEvent(params: {
  tenantCnpj: string;
  txid: string;
  endToEndId?: string | null;
  valorRecebidoCentavos?: number | null;
  rawEvent?: any;
}): Promise<{ ok: boolean; cycleId?: string; alreadyProcessed?: boolean; alreadyPaid?: boolean }> {
  const txid = String(params.txid ?? "").trim();
  if (!txid) throw new Error("txid obrigatorio no webhook");

  const endToEndId = params.endToEndId ? String(params.endToEndId).trim() : "";
  const eventId = endToEndId ? endToEndId : txid;

  const evRef = eventsCol(params.tenantCnpj).doc(eventId);

  const created = await runTransactionWithRetry(async (tx) => {
    const snap = await tx.get(evRef);
    if (snap.exists) return false;

    tx.set(
      evRef,
      {
        eventId,
        txid,
        endToEndId: endToEndId || null,
        processedAt: FieldValue.serverTimestamp(),
        raw: params.rawEvent ?? null,
      },
      { merge: false },
    );
    return true;
  });

  if (!created) {
    return { ok: true, alreadyProcessed: true };
  }

  const q = await cyclesCol(params.tenantCnpj).where("inter.txid", "==", txid).limit(1).get();
  if (q.empty) {
    logger.error("Webhook Inter: txid nao encontrado em billingCycles", { txid, eventId });
    return { ok: false };
  }

  const cycleDoc = q.docs[0];

  const valorRecebidoCentavos =
    Number.isInteger(params.valorRecebidoCentavos ?? null)
      ? Number(params.valorRecebidoCentavos)
      : null;

  const updateResult = await markCyclePaid(cycleDoc.ref, {
    endToEndId,
    valorRecebidoCentavos,
  });

  if (updateResult.alreadyPaid) {
    logger.warn("Billing cycle already marked as paid", {
      txid,
      cycleId: updateResult.cycleId,
    });
  } else if (updateResult.depositoId) {
    await clearDepositoInadimplenteIfNoOverdueOpen({
      tenantCnpj: params.tenantCnpj,
      depositoId: updateResult.depositoId,
    }).catch(() => void 0);
  }

  return {
    ok: true,
    cycleId: updateResult.cycleId,
    alreadyPaid: updateResult.alreadyPaid,
  };
}

// ------------------------------------------------------------------
// Deposito: inadimplencia
// ------------------------------------------------------------------
export async function setDepositoInadimplente(params: {
  tenantCnpj: string;
  depositoId: string;
  cycleId: string;
  paymentUrl: string | null;
  reason: string;
}): Promise<void> {
  await depositosCol(params.tenantCnpj).doc(params.depositoId).set(
    {
      status: "FECHADO",
      billing: {
        status: "INADIMPLENTE",
        cycleId: params.cycleId,
        paymentUrl: params.paymentUrl ?? null,
        reason: String(params.reason ?? "").slice(0, 220),
        blockedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function clearDepositoInadimplenteIfNoOverdueOpen(params: {
  tenantCnpj: string;
  depositoId: string;
}): Promise<void> {
  const snap = await billingCyclesCol(params.tenantCnpj)
    .where("depositoId", "==", params.depositoId)
    .where("status", "in", ["OPEN", "EXPIRED"] as any)
    .limit(25)
    .get()
    .catch(() => null as any);

  const now = Date.now();
  const cycles =
    snap && !snap.empty
      ? snap.docs.map((d: admin.firestore.QueryDocumentSnapshot) => {
          const x = d.data() as any;
          return {
            status: String(x?.status ?? "OPEN") as BillingCycleStatus,
            expiresAtMs: x?.inter?.expiresAt?.toMillis?.() ?? null,
          };
        })
      : [];

  if (hasOverdueOpenCycle({ cycles, nowMs: now })) return;

  await depositosCol(params.tenantCnpj).doc(params.depositoId).set(
    {
      billing: {
        status: "OK",
        cycleId: null,
        paymentUrl: null,
        reason: null,
        blockedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function expireCycleAndBlockDeposito(params: {
  tenantCnpj: string;
  cycleId: string;
  depositoId: string;
  paymentUrl: string | null;
  reason: string;
}): Promise<void> {
  const cycleRef = cyclesCol(params.tenantCnpj).doc(params.cycleId);

  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(cycleRef);
    if (!snap.exists) return;

    const d = snap.data() as any;
    const st = String(d.status ?? "OPEN");
    if (st === "PAID" || st === "CANCELED" || st === "EXPIRED") return;

    tx.set(
      cycleRef,
      { status: "EXPIRED", updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  });

  await setDepositoInadimplente({
    tenantCnpj: params.tenantCnpj,
    depositoId: params.depositoId,
    cycleId: params.cycleId,
    paymentUrl: params.paymentUrl ?? null,
    reason: params.reason,
  });
}

// ------------------------------------------------------------------
// Reconcile hard fallback (Scheduler): OPEN -> Inter cob/{txid}
// ------------------------------------------------------------------
export async function reconcileOpenBillingCycles(params: {
  tenantCnpj: string;
  limit?: number;
}): Promise<{
  ok: boolean;
  scanned: number;
  paid: number;
  expired: number;
  errors: number;
}> {
  const limit = Math.max(1, Math.min(Number(params.limit ?? 120), 250));

  const snap = await cyclesCol(params.tenantCnpj)
    .where("status", "==", "OPEN")
    .limit(limit)
    .get()
    .catch(() => null as any);

  if (!snap || snap.empty) {
    return { ok: true, scanned: 0, paid: 0, expired: 0, errors: 0 };
  }

  const now = Date.now();
  let paid = 0;
  let expired = 0;
  let errors = 0;

  for (const doc of snap.docs) {
    const c = doc.data() as any;
    const cycleId = doc.id;
    const depositoId = String(c?.depositoId ?? "").trim();
    const txid = String(c?.inter?.txid ?? "").trim();

    if (!depositoId || !txid) continue;

    const cob = await getCobByTxid({ txid });

    if (!cob.ok) {
      errors += 1;
      continue;
    }

    // atualiza metadados uteis (sem brigar com o documento inteiro)
    const patchInter: any = {};
    if (cob.createdAt) patchInter.createdAt = cob.createdAt;
    if (cob.expiresAt) patchInter.expiresAt = cob.expiresAt;

    if (Object.keys(patchInter).length) {
      await doc.ref
        .set({ inter: patchInter, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
        .catch(() => void 0);
    }

    if (cob.paid) {
      const minimalRaw = {
        source: "reconcile",
        txid,
        endToEndId: cob.endToEndId ?? null,
        valorRecebidoCentavos: cob.valorRecebidoCentavos ?? null,
      };

      await markPaidByInterPixEvent({
        tenantCnpj: params.tenantCnpj,
        txid,
        endToEndId: cob.endToEndId,
        valorRecebidoCentavos: cob.valorRecebidoCentavos,
        rawEvent: minimalRaw,
      }).catch(() => void 0);

      await clearDepositoInadimplenteIfNoOverdueOpen({
        tenantCnpj: params.tenantCnpj,
        depositoId,
      }).catch(() => void 0);

      paid += 1;
      continue;
    }

    const expMs =
      (cob.expiresAt?.toMillis?.() ?? null) || (c?.inter?.expiresAt?.toMillis?.() ?? null);

    if (expMs && expMs > now && expMs - now <= BILLING_WARNING_WINDOW_MS) {
      const allowed = await lockBillingWarningOnce(doc.ref).catch(() => false);
      if (allowed) {
        await notifyDepositoBillingWarning({
          tenantCnpj: params.tenantCnpj,
          cycleId,
          depositoId,
          paymentUrl: c?.paymentUrl ?? null,
          totalCentavos: Number(c?.totalCentavos ?? 0),
          expiresAtMs: expMs,
        }).catch(() => void 0);
      }
    }

    if (expMs && expMs <= now) {
      await expireCycleAndBlockDeposito({
        tenantCnpj: params.tenantCnpj,
        cycleId,
        depositoId,
        paymentUrl: c?.paymentUrl ?? null,
        reason: `auto: ciclo expirado (txid=${txid})`,
      }).catch(() => void 0);

      expired += 1;
    }
  }

  return { ok: true, scanned: snap.size, paid, expired, errors };
}

