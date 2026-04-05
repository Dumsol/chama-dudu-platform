import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

import { FieldValue } from "../../infra/config/firebase";
import {
  depositosCol,
  ordersCol,
  promoLedgerCol as tenantPromoLedgerCol,
  promoStateDoc,
  usersCol,
} from "../../infra/firestore/duduPaths";
import { isFeatureEnabled } from "../../infra/config/featureFlags";
import { getTenantFeatureConfig } from "../../infra/config/tenantFeatures";
import { callGemini } from "../../infra/ai/gemini";
import { sendWhatsAppTextMessage } from "../whatsapp/send";

export type PromoStatus = "DISABLED" | "ACTIVE" | "PAUSED_BUDGET" | "PAUSED_DEMAND_OK";
export type PromoCommand = "STATUS" | "LIST" | "OPT_IN" | "OPT_OUT";
export type PromoPendingAction = "ASK_BUDGET" | "ASK_OPT_OUT_REASON" | "ASK_OPT_OUT_OTHER" | null;
export type PromoOptOutReason = "TA_CARO" | "SEM_RESULTADO" | "PAUSAR" | "OUTRO" | "UNKNOWN";

export type PromoModules = {
  raspadinha: {
    enabled: boolean;
    winProbBps: number;
    maxPrizeCents: number;
    maxWinsPerWeek: number;
    winsThisWeek: number;
  };
};

export type PromoDoc = {
  optIn: boolean;
  status: PromoStatus;
  weeklyBudgetCents: number;
  spentThisWeekCents: number;
  weekKey: string;
  lastEvaluatedAt: admin.firestore.Timestamp | null;
  lastAdvisorAt: admin.firestore.Timestamp | null;
  disabledReason?: string | null;
  eligibility?: {
    manualApproved: boolean;
    minDeliveredOrdersLifetime?: number | null;
    minScore?: number | null;
    eligible: boolean;
    reason?: string | null;
  } | null;
  pendingAction: PromoPendingAction;
  pendingReasonChoice: PromoOptOutReason | null;
  modules: PromoModules;
  lastOptOut?: {
    at: admin.firestore.Timestamp | null;
    reason: string | null;
  } | null;
  advisor?: {
    suggestedAt: admin.firestore.Timestamp | null;
    suggestedWinProbBps?: number | null;
    suggestedRaspadinhaEnabled?: boolean | null;
    note?: string | null;
    raw?: string | null;
  } | null;
};

const PROMO_TIMEZONE = "America/Sao_Paulo";
const DEFAULT_WIN_PROB_BPS = 1000; // 10%
const DEFAULT_MAX_PRIZE_CENTS = 99;
const DEFAULT_MAX_WINS_PER_WEEK = 10;
const SERVICE_FEE_DEFAULT_CENTS = 99;
export const PROMO_BUDGET_MAX_CENTS = 500_00;
export const PROMO_BUDGET_MIN_CENTS = 0;
const BENEFIT_EXPIRES_DAYS = 7;

function clampInt(value: any, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

export function formatBRLFromCents(cents: number): string {
  const safe = Math.max(0, Math.round(Number(cents) || 0));
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(safe / 100);
}

export function parseBudgetCentsFromText(raw: string): number | null {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  const match = text.replace(",", ".").match(/\d+(?:\.\d{1,2})?/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function validateBudgetCents(cents: number): { ok: boolean; reason?: string } {
  if (!Number.isFinite(cents)) return { ok: false, reason: "invalid" };
  if (cents < PROMO_BUDGET_MIN_CENTS) return { ok: false, reason: "min" };
  if (cents > PROMO_BUDGET_MAX_CENTS) return { ok: false, reason: "max" };
  return { ok: true };
}

export function getWeekKeyForTimeZone(nowMs: number, timeZone = PROMO_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));

  const year = Number(parts.find((p) => p.type === "year")?.value ?? "1970");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");

  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function parsePromoCommand(normalizedText: string): PromoCommand | null {
  const t = String(normalizedText ?? "").trim();
  if (!t) return null;

  const hasPromo = t.includes("promocao inteligente") || t.includes("promo inteligente");
  const hasPromos = t.includes("promocoes") || t.includes("promos");

  if (t.includes("quais") && (hasPromos || hasPromo)) return "LIST";
  if (hasPromo && (t.includes("sair") || t.includes("desativar") || t.includes("cancelar"))) return "OPT_OUT";
  if (hasPromo && (t.includes("entrar") || t.includes("ativar"))) return "OPT_IN";
  if (hasPromo) return "STATUS";

  return null;
}

export function parseOptOutReason(normalizedText: string): PromoOptOutReason | null {
  const t = String(normalizedText ?? "").trim();
  if (!t) return null;

  if (t === "1" || t.includes("caro")) return "TA_CARO";
  if (t === "2" || t.includes("resultado") || t.includes("nao vi")) return "SEM_RESULTADO";
  if (t === "3" || t.includes("pausar") || t.includes("pausa")) return "PAUSAR";
  if (t === "4" || t.includes("outro")) return "OUTRO";

  return null;
}

export function buildRaspadinhaLedgerId(orderId: string): string {
  return String(orderId ?? "").trim();
}

export function decidePromoStatus(params: {
  optIn: boolean;
  isAberto: boolean;
  weeklyBudgetCents: number;
  spentThisWeekCents: number;
  demandLow: boolean;
}): PromoStatus {
  if (!params.optIn) return "DISABLED";
  if (!params.isAberto) return "PAUSED_DEMAND_OK";
  if (params.weeklyBudgetCents <= 0) return "PAUSED_BUDGET";
  if (params.spentThisWeekCents >= params.weeklyBudgetCents) return "PAUSED_BUDGET";
  return params.demandLow ? "ACTIVE" : "PAUSED_DEMAND_OK";
}

function normalizePromoDoc(raw: any, nowMs: number, fallbackOptIn: boolean): PromoDoc {
  const weekKey = getWeekKeyForTimeZone(nowMs);
  const modulesRaw = raw?.modules ?? {};
  const raspadinhaRaw = modulesRaw.raspadinha ?? {};

  const optIn = Boolean(raw?.optIn ?? fallbackOptIn ?? false);
  const status = (raw?.status as PromoStatus) ?? (optIn ? "PAUSED_DEMAND_OK" : "DISABLED");

  return {
    optIn,
    status,
    weeklyBudgetCents: clampInt(raw?.weeklyBudgetCents, 0),
    spentThisWeekCents: clampInt(raw?.spentThisWeekCents, 0),
    weekKey: String(raw?.weekKey ?? weekKey),
    lastEvaluatedAt: raw?.lastEvaluatedAt ?? null,
    lastAdvisorAt: raw?.lastAdvisorAt ?? null,
    disabledReason: raw?.disabledReason ?? null,
    eligibility: raw?.eligibility ?? null,
    pendingAction: (raw?.pendingAction as PromoPendingAction) ?? null,
    pendingReasonChoice: (raw?.pendingReasonChoice as PromoOptOutReason) ?? null,
    modules: {
      raspadinha: {
        enabled: Boolean(raspadinhaRaw.enabled ?? false),
        winProbBps: DEFAULT_WIN_PROB_BPS,
        maxPrizeCents: DEFAULT_MAX_PRIZE_CENTS,
        maxWinsPerWeek: DEFAULT_MAX_WINS_PER_WEEK,
        winsThisWeek: clampInt(raspadinhaRaw.winsThisWeek, 0),
      },
    },
    lastOptOut: raw?.lastOptOut ?? null,
    advisor: raw?.advisor ?? null,
  };
}

function promoDocRef(tenantCnpj: string, depositoId: string) {
  return promoStateDoc(tenantCnpj, depositoId);
}

function promoLedgerCol(tenantCnpj: string, depositoId: string) {
  return tenantPromoLedgerCol(tenantCnpj, depositoId);
}

async function countDeliveredOrders(params: {
  tenantCnpj: string;
  depositoId: string;
  sinceMs: number;
  limit: number;
}): Promise<{ count: number; truncated: boolean }> {
  const sinceTs = admin.firestore.Timestamp.fromMillis(params.sinceMs);
  const delivered = ["ENTREGUE_CONFIRMADO", "ENTREGUE_PRESUMIDO"];

  const snap = await ordersCol(params.tenantCnpj)
    .where("depositoId", "==", params.depositoId)
    .where("deliveredAt", ">=", sinceTs)
    .where("fulfillmentStatus", "in", delivered as any)
    .limit(params.limit)
    .get()
    .catch(() => null as any);

  if (!snap) return { count: 0, truncated: false };
  return { count: snap.size, truncated: snap.size >= params.limit };
}

function demandIsLow(params: {
  ordersLast2h: number;
  ordersLast24h: number;
  baselineDaily: number;
}): boolean {
  const baseline = Math.max(1, Math.round(params.baselineDaily));
  const threshold24h = Math.max(1, Math.round(baseline * 0.6));
  if (params.ordersLast2h > 0) return false;
  return params.ordersLast24h <= threshold24h;
}

function resolveDeliveredLifetimeCount(depData: any): number {
  const stats = depData?.stats ?? {};
  const allTime = stats?.allTime ?? {};
  const last7d = stats?.last7d ?? {};

  const fromAllTime =
    typeof allTime.deliveredCount === "number"
      ? allTime.deliveredCount
      : typeof allTime.ordersDeliveredCount === "number"
        ? allTime.ordersDeliveredCount
        : typeof allTime.ordersAcceptedCount === "number"
          ? allTime.ordersAcceptedCount
          : null;

  if (typeof fromAllTime === "number" && Number.isFinite(fromAllTime)) {
    return Math.max(0, Math.floor(fromAllTime));
  }

  const fromLast7d =
    typeof last7d.ordersAcceptedCount === "number" ? last7d.ordersAcceptedCount : 0;
  return Math.max(0, Math.floor(fromLast7d));
}

function resolveScore(depData: any): number {
  const ratingAvg = depData?.stats?.allTime?.ratingAvg;
  if (typeof ratingAvg === "number" && Number.isFinite(ratingAvg)) return ratingAvg;
  return 0;
}

function buildEligibility(params: {
  depData: any;
  minDeliveredOrdersLifetime?: number | null;
  minScore?: number | null;
}): { eligible: boolean; reason?: string; manualApproved: boolean } {
  const manualApproved = Boolean(params.depData?.promocaoInteligente?.manualApproved ?? false);
  if (!manualApproved) {
    return { eligible: false, reason: "manual_approval_required", manualApproved };
  }

  const delivered = resolveDeliveredLifetimeCount(params.depData);
  const minDelivered = params.minDeliveredOrdersLifetime ?? null;
  if (typeof minDelivered === "number" && delivered < minDelivered) {
    return { eligible: false, reason: "min_delivered", manualApproved };
  }

  const score = resolveScore(params.depData);
  const minScore = params.minScore ?? null;
  if (typeof minScore === "number" && score < minScore) {
    return { eligible: false, reason: "min_score", manualApproved };
  }

  return { eligible: true, manualApproved };
}

async function maybeRunAdvisor(params: {
  promo: PromoDoc;
  metrics: { ordersLast2h: number; ordersLast24h: number; baselineDaily: number };
  nowMs: number;
  enabled: boolean;
}): Promise<{
  suggestedWinProbBps?: number;
  suggestedRaspadinhaEnabled?: boolean;
  note?: string;
  raw?: string;
} | null> {
  if (!params.enabled) return null;

  const payload = {
    promo: {
      status: params.promo.status,
      weeklyBudgetCents: params.promo.weeklyBudgetCents,
      spentThisWeekCents: params.promo.spentThisWeekCents,
      winProbBps: params.promo.modules.raspadinha.winProbBps,
    },
    metrics: params.metrics,
  };

  try {
    const systemInstruction = "Responda em JSON estrito. Campos: raspadinhaEnabled (bool), winProbBps (int), note (string curta).";
    const content = await callGemini(JSON.stringify(payload), systemInstruction);
    if (!content) return null;

    const match = content.match(/\{[\s\S]*\}/);
    const json = match ? match[0] : content;
    const parsed = JSON.parse(json) as any;

    const winProbBps = Number(parsed?.winProbBps) || params.promo.modules.raspadinha.winProbBps;
    const raspadinhaEnabled = parsed?.raspadinhaEnabled;

    return {
      suggestedWinProbBps: Number.isFinite(winProbBps) ? winProbBps : undefined,
      suggestedRaspadinhaEnabled:
        typeof raspadinhaEnabled === "boolean" ? raspadinhaEnabled : undefined,
      note: parsed?.note ? String(parsed.note).slice(0, 220) : undefined,
      raw: content.slice(0, 600),
    };
  } catch (err: any) {
    logger.warn("PROMO_ADVISOR_FAIL", { error: err?.message ?? String(err) });
    return null;
  }
}

export async function evaluatePromoForDeposito(params: {
  tenantCnpj: string;
  depositoId: string;
  nowMs?: number;
  reason?: string;
}): Promise<void> {
  const nowMs = Number.isFinite(params.nowMs ?? null) ? Number(params.nowMs) : Date.now();
  const depRef = depositosCol(params.tenantCnpj).doc(params.depositoId);
  const promoRef = promoDocRef(params.tenantCnpj, params.depositoId);

  const depSnap = await depRef.get().catch(() => null as any);
  if (!depSnap || !depSnap.exists) return;

  const depData = depSnap.data() as any;
  const legacyOptIn = Boolean(depData?.promocaoInteligente?.enabled ?? false);
  const promoSnap = await promoRef.get().catch(() => null as any);
  const promo = normalizePromoDoc(promoSnap?.data?.() ?? promoSnap?.data ?? null, nowMs, legacyOptIn);

  const tenantConfig = await getTenantFeatureConfig(params.tenantCnpj);
  const tenantKillSwitch = tenantConfig.tenantKillSwitch;
  const promoFeatureEnabled = tenantConfig.features.promoInteligente.enabled;
  const raspadinhaFeatureEnabled = tenantConfig.features.raspadinha.enabled;
  const advisorFeatureEnabled = tenantConfig.features.gptAdvisor.enabled;

  const weekKeyNow = getWeekKeyForTimeZone(nowMs);
  const needsReset = promo.weekKey !== weekKeyNow;
  const spentNow = needsReset ? 0 : promo.spentThisWeekCents;

  const twoHoursAgo = nowMs - 2 * 60 * 60 * 1000;
  const dayAgo = nowMs - 24 * 60 * 60 * 1000;

  const [last2h, last24h] = await Promise.all([
    countDeliveredOrders({
      tenantCnpj: params.tenantCnpj,
      depositoId: params.depositoId,
      sinceMs: twoHoursAgo,
      limit: 60,
    }),
    countDeliveredOrders({
      tenantCnpj: params.tenantCnpj,
      depositoId: params.depositoId,
      sinceMs: dayAgo,
      limit: 240,
    }),
  ]);

  const ordersAccepted7d = Number(depData?.stats?.last7d?.ordersAcceptedCount ?? 0);
  const baselineDaily = ordersAccepted7d > 0 ? ordersAccepted7d / 7 : 0;

  const demandLow = demandIsLow({
    ordersLast2h: last2h.count,
    ordersLast24h: last24h.count,
    baselineDaily,
  });

  const eligibility = buildEligibility({
    depData,
    minDeliveredOrdersLifetime: tenantConfig.features.promoInteligente.minDeliveredOrdersLifetime,
    minScore: tenantConfig.features.promoInteligente.minScore,
  });

  let disabledReason: string | null = null;
  if (tenantKillSwitch) disabledReason = "tenant_killswitch";
  else if (!promoFeatureEnabled) disabledReason = "feature_disabled";
  else if (!promo.optIn) disabledReason = "opt_out";
  else if (!eligibility.eligible) disabledReason = eligibility.reason ?? "not_eligible";

  const status = disabledReason
    ? ("DISABLED" as PromoStatus)
    : decidePromoStatus({
        optIn: promo.optIn,
        isAberto: String(depData?.status ?? "FECHADO").toUpperCase() === "ABERTO",
        weeklyBudgetCents: promo.weeklyBudgetCents,
        spentThisWeekCents: spentNow,
        demandLow,
      });

  let advisorSuggestion: {
    suggestedWinProbBps?: number;
    suggestedRaspadinhaEnabled?: boolean;
    note?: string;
    raw?: string;
  } | null = null;

  if (
    isFeatureEnabled("FEATURE_PROMO_ADVISOR", true) &&
    advisorFeatureEnabled &&
    promo.optIn &&
    status === "ACTIVE"
  ) {
    advisorSuggestion = await maybeRunAdvisor({
      promo: { ...promo, status },
      metrics: {
        ordersLast2h: last2h.count,
        ordersLast24h: last24h.count,
        baselineDaily,
      },
      nowMs,
      enabled: advisorFeatureEnabled,
    });
  }

  const nextModules: PromoModules = {
    raspadinha: {
      enabled:
        status === "ACTIVE" &&
        raspadinhaFeatureEnabled &&
        (advisorSuggestion?.suggestedRaspadinhaEnabled ?? true),
      winProbBps: DEFAULT_WIN_PROB_BPS,
      maxPrizeCents: DEFAULT_MAX_PRIZE_CENTS,
      maxWinsPerWeek: DEFAULT_MAX_WINS_PER_WEEK,
      winsThisWeek: needsReset ? 0 : promo.modules.raspadinha.winsThisWeek,
    },
  };

  const patch: Record<string, unknown> = {
    optIn: promo.optIn,
    status,
    disabledReason,
    weeklyBudgetCents: promo.weeklyBudgetCents,
    weekKey: weekKeyNow,
    lastEvaluatedAt: FieldValue.serverTimestamp(),
    modules: nextModules,
    eligibility: {
      manualApproved: eligibility.manualApproved,
      minDeliveredOrdersLifetime: tenantConfig.features.promoInteligente.minDeliveredOrdersLifetime ?? null,
      minScore: tenantConfig.features.promoInteligente.minScore ?? null,
      eligible: eligibility.eligible,
      reason: eligibility.reason ?? null,
    },
    metrics: {
      ordersLast2h: last2h.count,
      ordersLast24h: last24h.count,
      baselineDaily: Math.round(baselineDaily * 10) / 10,
      updatedAt: FieldValue.serverTimestamp(),
    },
  };

  if (needsReset) {
    patch["spentThisWeekCents"] = 0;
    patch["modules.raspadinha.winsThisWeek"] = 0;
  }

  if (advisorSuggestion) {
    patch["lastAdvisorAt"] = FieldValue.serverTimestamp();
    patch["advisor"] = {
      suggestedAt: FieldValue.serverTimestamp(),
      suggestedWinProbBps: advisorSuggestion.suggestedWinProbBps ?? null,
      suggestedRaspadinhaEnabled: advisorSuggestion.suggestedRaspadinhaEnabled ?? null,
      note: advisorSuggestion.note ?? null,
      raw: advisorSuggestion.raw ?? null,
    };
  }

  await promoRef.set(patch, { merge: true }).catch(() => void 0);
  await depRef
    .set(
      {
        promocaoInteligente: {
          enabled: promo.optIn,
          status,
          pendingAction: promo.pendingAction ?? null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch(() => void 0);

  if (params.reason) {
    logger.info("PROMO_EVAL", {
      tenantCnpj: params.tenantCnpj,
      depositoId: params.depositoId,
      status,
      reason: params.reason,
      ordersLast2h: last2h.count,
      ordersLast24h: last24h.count,
    });
  }
}

export async function runPromoDailySweep(tenantCnpj: string): Promise<{ scanned: number }> {
  const tenantConfig = await getTenantFeatureConfig(tenantCnpj);
  if (tenantConfig.tenantKillSwitch || !tenantConfig.features.promoInteligente.enabled) {
    return { scanned: 0 };
  }

  const snap = await depositosCol(tenantCnpj)
    .where("promocaoInteligente.enabled", "==", true)
    .limit(200)
    .get()
    .catch(() => null as any);

  if (!snap || snap.empty) return { scanned: 0 };

  for (const doc of snap.docs) {
    await evaluatePromoForDeposito({
      tenantCnpj,
      depositoId: doc.id,
      reason: "daily_sweep",
    }).catch(() => void 0);
  }

  return { scanned: snap.size };
}

export async function startPromoOptIn(params: { tenantCnpj: string; depositoId: string }): Promise<void> {
  const promoRef = promoDocRef(params.tenantCnpj, params.depositoId);
  await promoRef.set(
    {
      pendingAction: "ASK_BUDGET",
      pendingReasonChoice: null,
      lastUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await depositosCol(params.tenantCnpj)
    .doc(params.depositoId)
    .set(
      {
        promocaoInteligente: {
          pendingAction: "ASK_BUDGET",
          updatedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function startPromoOptOut(params: { tenantCnpj: string; depositoId: string }): Promise<void> {
  const promoRef = promoDocRef(params.tenantCnpj, params.depositoId);
  await promoRef.set(
    {
      pendingAction: "ASK_OPT_OUT_REASON",
      pendingReasonChoice: null,
      lastUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await depositosCol(params.tenantCnpj)
    .doc(params.depositoId)
    .set(
      {
        promocaoInteligente: {
          pendingAction: "ASK_OPT_OUT_REASON",
          updatedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function setPromoPendingOptOutOther(params: {
  tenantCnpj: string;
  depositoId: string;
  reasonChoice: PromoOptOutReason;
}): Promise<void> {
  const promoRef = promoDocRef(params.tenantCnpj, params.depositoId);
  await promoRef.set(
    {
      pendingAction: "ASK_OPT_OUT_OTHER",
      pendingReasonChoice: params.reasonChoice,
      lastUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await depositosCol(params.tenantCnpj)
    .doc(params.depositoId)
    .set(
      {
        promocaoInteligente: {
          pendingAction: "ASK_OPT_OUT_OTHER",
          updatedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function clearPromoPending(params: { tenantCnpj: string; depositoId: string }): Promise<void> {
  const promoRef = promoDocRef(params.tenantCnpj, params.depositoId);
  await promoRef.set(
    {
      pendingAction: null,
      pendingReasonChoice: null,
      lastUpdatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await depositosCol(params.tenantCnpj)
    .doc(params.depositoId)
    .set(
      {
        promocaoInteligente: {
          pendingAction: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function applyPromoBudget(params: {
  tenantCnpj: string;
  depositoId: string;
  weeklyBudgetCents: number;
}): Promise<void> {
  const nowMs = Date.now();
  const weekKey = getWeekKeyForTimeZone(nowMs);
  const promoRef = promoDocRef(params.tenantCnpj, params.depositoId);

  await promoRef.set(
    {
      optIn: true,
      status: "PAUSED_DEMAND_OK",
      disabledReason: null,
      weeklyBudgetCents: params.weeklyBudgetCents,
      spentThisWeekCents: 0,
      weekKey,
      pendingAction: null,
      pendingReasonChoice: null,
      lastEvaluatedAt: FieldValue.serverTimestamp(),
      modules: {
        raspadinha: {
          enabled: false,
          winProbBps: DEFAULT_WIN_PROB_BPS,
          maxPrizeCents: DEFAULT_MAX_PRIZE_CENTS,
          maxWinsPerWeek: DEFAULT_MAX_WINS_PER_WEEK,
          winsThisWeek: 0,
        },
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await depositosCol(params.tenantCnpj)
    .doc(params.depositoId)
    .set(
      {
        promocaoInteligente: {
          enabled: true,
          status: "PAUSED_DEMAND_OK",
          pendingAction: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function applyPromoOptOut(params: {
  tenantCnpj: string;
  depositoId: string;
  reason: string;
}): Promise<void> {
  const promoRef = promoDocRef(params.tenantCnpj, params.depositoId);
  await promoRef.set(
    {
      optIn: false,
      status: "DISABLED",
      disabledReason: "opt_out",
      pendingAction: null,
      pendingReasonChoice: null,
      lastOptOut: {
        at: FieldValue.serverTimestamp(),
        reason: params.reason.slice(0, 120),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await depositosCol(params.tenantCnpj)
    .doc(params.depositoId)
    .set(
      {
        promocaoInteligente: {
          enabled: false,
          status: "DISABLED",
          pendingAction: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

export async function loadPromoDoc(params: {
  tenantCnpj: string;
  depositoId: string;
  fallbackOptIn?: boolean;
}): Promise<PromoDoc> {
  const nowMs = Date.now();
  const promoRef = promoDocRef(params.tenantCnpj, params.depositoId);
  const snap = await promoRef.get().catch(() => null as any);
  return normalizePromoDoc(snap?.data?.() ?? snap?.data ?? null, nowMs, Boolean(params.fallbackOptIn));
}

export function buildPromoStatusText(promo: PromoDoc): string {
  const statusLabel: Record<PromoStatus, string> = {
    DISABLED: "DESATIVADA",
    ACTIVE: "ATIVA",
    PAUSED_BUDGET: "PAUSADA (budget)",
    PAUSED_DEMAND_OK: "PAUSADA (demanda ok)",
  };

  const remaining = Math.max(0, promo.weeklyBudgetCents - promo.spentThisWeekCents);
  const lines: string[] = [];
  const disabledReason = String(promo.disabledReason ?? "").trim();
  const disabledText =
    disabledReason === "tenant_killswitch"
      ? " (indisponivel)"
      : disabledReason === "feature_disabled"
        ? " (off no tenant)"
        : disabledReason === "manual_approval_required"
          ? " (aguardando liberacao)"
          : disabledReason === "min_delivered"
            ? " (poucos pedidos)"
            : disabledReason === "min_score"
              ? " (nota baixa)"
              : "";
  lines.push(`Promocao Inteligente: ${statusLabel[promo.status]}${promo.status === "DISABLED" ? disabledText : ""}`);
  if (promo.eligibility && promo.eligibility.eligible === false) {
    lines.push("Elegibilidade: aguardando liberacao.");
  }
  lines.push(`Orcamento semanal: ${formatBRLFromCents(promo.weeklyBudgetCents)}`);
  lines.push(`Gasto na semana: ${formatBRLFromCents(promo.spentThisWeekCents)}`);
  lines.push(`Saldo: ${formatBRLFromCents(remaining)}`);

  const rasp = promo.modules.raspadinha;
  const raspStatus = rasp.enabled ? "ativa" : "pausada";
  lines.push(
    `Raspadinha: ${raspStatus} (${Math.round(rasp.winProbBps / 100)}% chance, ate ${formatBRLFromCents(rasp.maxPrizeCents)})`,
  );

  return lines.join("\n");
}

export function buildPromoListText(promo: PromoDoc): string {
  const rasp = promo.modules.raspadinha;
  const raspStatus = rasp.enabled
    ? "ativa"
    : promo.status === "PAUSED_BUDGET"
      ? "pausada por budget"
      : promo.status === "DISABLED"
        ? "off"
        : "pausada";

  return [
    `Raspadinha: ${raspStatus}`,
    `Taxa gratis 1x: ${raspStatus}`,
  ].join("\n");
}

export async function handlePromoAfterDelivered(params: {
  tenantCnpj: string;
  orderId: string;
}): Promise<void> {
  const orderSnap = await ordersCol(params.tenantCnpj).doc(params.orderId).get().catch(() => null as any);
  if (!orderSnap || !orderSnap.exists) return;
  const order = orderSnap.data() as any;

  const fulfillment = String(order?.fulfillmentStatus ?? "");
  if (!fulfillment || (fulfillment !== "ENTREGUE_CONFIRMADO" && fulfillment !== "ENTREGUE_PRESUMIDO")) return;

  const depositoId = String(order?.depositoId ?? "").trim();
  if (!depositoId) return;

  await tryAwardRaspadinha({
    tenantCnpj: params.tenantCnpj,
    depositoId,
    orderId: params.orderId,
    waId: String(order?.userId ?? ""),
    phoneNumberId: String(order?.phoneNumberId ?? ""),
    createdAtMs: order?.createdAt?.toMillis?.() ?? Number(order?.createdAtMs ?? 0),
    acceptedAtMs: order?.acceptedAt?.toMillis?.() ?? Number(order?.acceptedAtMs ?? 0),
    deliveredAtMs: order?.deliveredAt?.toMillis?.() ?? Number(order?.deliveredAtMs ?? 0),
    status: String(order?.status ?? ""),
  });

  await evaluatePromoForDeposito({
    tenantCnpj: params.tenantCnpj,
    depositoId,
    reason: "order_delivered",
  }).catch(() => void 0);
}

async function tryAwardRaspadinha(params: {
  tenantCnpj: string;
  depositoId: string;
  orderId: string;
  waId: string;
  phoneNumberId: string;
  createdAtMs: number;
  acceptedAtMs: number;
  deliveredAtMs: number;
  status: string;
}): Promise<void> {
  if (!params.orderId || !params.waId || !params.phoneNumberId) return;

  const tenantConfig = await getTenantFeatureConfig(params.tenantCnpj);
  if (tenantConfig.tenantKillSwitch) return;
  if (!tenantConfig.features.promoInteligente.enabled) return;
  if (!tenantConfig.features.raspadinha.enabled) return;

  const minAgeMs = 5 * 60 * 1000;
  const createdAtMs = Number(params.createdAtMs ?? 0);
  const acceptedAtMs = Number(params.acceptedAtMs ?? 0);
  const deliveredAtMs = Number(params.deliveredAtMs ?? 0);
  if (!createdAtMs || !acceptedAtMs || !deliveredAtMs) return;
  const status = String(params.status ?? "").toUpperCase();
  if (status === "CANCELED" || status === "DECLINED" || status === "TIMEOUT") return;
  if (deliveredAtMs - createdAtMs < minAgeMs) return;

  const promoRef = promoDocRef(params.tenantCnpj, params.depositoId);
  const ledgerRef = promoLedgerCol(params.tenantCnpj, params.depositoId).doc(
    buildRaspadinhaLedgerId(params.orderId),
  );
  const userRef = usersCol(params.tenantCnpj).doc(params.waId);

  const nowMs = Date.now();
  const weekKeyNow = getWeekKeyForTimeZone(nowMs);
  const winRoll = Math.random();

  let win = false;
  let reason = "";
  let prizeCents = 0;

  await admin.firestore().runTransaction(async (tx) => {
    const [promoSnap, ledgerSnap, userSnap] = await Promise.all([
      tx.get(promoRef),
      tx.get(ledgerRef),
      tx.get(userRef),
    ]);

    if (ledgerSnap.exists) {
      reason = "dedupe";
      return;
    }

    const promo = normalizePromoDoc(promoSnap.data() ?? null, nowMs, false);
    if (!promo.optIn || promo.status !== "ACTIVE" || !promo.modules.raspadinha.enabled) {
      reason = "inactive";
      tx.set(
        ledgerRef,
        {
          type: "RASPADINHA_PRIZE",
          amountCents: 0,
          orderId: params.orderId,
          won: false,
          reason,
          weekKey: weekKeyNow,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: nowMs,
        },
        { merge: true },
      );
      return;
    }

    const resetWeek = promo.weekKey !== weekKeyNow;
    const weekKey = resetWeek ? weekKeyNow : promo.weekKey;
    const spentNow = resetWeek ? 0 : promo.spentThisWeekCents;
    const winsNow = resetWeek ? 0 : promo.modules.raspadinha.winsThisWeek;
    const remaining = Math.max(0, promo.weeklyBudgetCents - spentNow);

    const userData = userSnap.exists ? (userSnap.data() as any) : {};
    const benefit = userData?.promoBenefit ?? null;
    const benefitActive = benefit && benefit.status === "ACTIVE";
    const benefitExpiresAtMs = benefit?.expiresAtMs ? Number(benefit.expiresAtMs) : 0;
    if (benefitActive && benefitExpiresAtMs && benefitExpiresAtMs > nowMs) {
      reason = "user_has_benefit";
      tx.set(
        ledgerRef,
        {
          type: "RASPADINHA_PRIZE",
          amountCents: 0,
          orderId: params.orderId,
          won: false,
          reason,
          weekKey,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: nowMs,
        },
        { merge: true },
      );
      return;
    }

    prizeCents = Math.min(SERVICE_FEE_DEFAULT_CENTS, promo.modules.raspadinha.maxPrizeCents);
    if (remaining < prizeCents || prizeCents <= 0) {
      reason = "budget";
      tx.set(
        ledgerRef,
        {
          type: "RASPADINHA_PRIZE",
          amountCents: 0,
          orderId: params.orderId,
          won: false,
          reason,
          weekKey,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: nowMs,
        },
        { merge: true },
      );
      return;
    }

    if (winsNow >= promo.modules.raspadinha.maxWinsPerWeek) {
      reason = "wins_limit";
      tx.set(
        ledgerRef,
        {
          type: "RASPADINHA_PRIZE",
          amountCents: 0,
          orderId: params.orderId,
          won: false,
          reason,
          weekKey,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: nowMs,
        },
        { merge: true },
      );
      return;
    }

    const winProb = Math.max(0, Math.min(10_000, promo.modules.raspadinha.winProbBps));
    const shouldWin = winRoll <= winProb / 10_000;

    if (!shouldWin) {
      reason = "no_win";
      tx.set(
        ledgerRef,
        {
          type: "RASPADINHA_PRIZE",
          amountCents: 0,
          orderId: params.orderId,
          won: false,
          reason,
          weekKey,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: nowMs,
        },
        { merge: true },
      );
      return;
    }

    win = true;
    reason = "win";

    const expiresAtMs = nowMs + BENEFIT_EXPIRES_DAYS * 24 * 60 * 60 * 1000;

    tx.set(
      userRef,
      {
        promoBenefit: {
          kind: "SERVICE_FEE_WAIVER",
          amountCents: prizeCents,
          remainingUses: 1,
          status: "ACTIVE",
          sourceOrderId: params.orderId,
          createdAt: FieldValue.serverTimestamp(),
          createdAtMs: nowMs,
          expiresAtMs,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(
      ledgerRef,
      {
        type: "RASPADINHA_PRIZE",
        amountCents: prizeCents,
        orderId: params.orderId,
        won: true,
        reason,
        weekKey,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: nowMs,
      },
      { merge: true },
    );

    tx.set(
      promoRef,
      {
        weekKey,
        spentThisWeekCents: resetWeek ? prizeCents : FieldValue.increment(prizeCents),
        "modules.raspadinha.winsThisWeek": resetWeek ? 1 : FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  if (!win) return;

  const expiresAt = new Date(nowMs + BENEFIT_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
  const expiresStr = new Intl.DateTimeFormat("pt-BR", {
    timeZone: PROMO_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
  }).format(expiresAt);

  const message =
    "Raspadinha do Dudu: deu bom.\n" +
    `Tu ganhou taxa gratis no proximo pedido (${formatBRLFromCents(prizeCents)}).\n` +
    `Valido ate ${expiresStr}.`;

  await sendWhatsAppTextMessage({
    tenantCnpj: params.tenantCnpj,
    phoneNumberId: params.phoneNumberId,
    to: params.waId,
    body: message,
  }).catch(() => void 0);
}
