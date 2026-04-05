import * as logger from "firebase-functions/logger";
import { FieldValue } from "../../infra/config/firebase";
import {
  assertTenantId,
  billingCyclesCol,
  billingEventsCol,
  depositosCol,
  issuesCol,
  opsRealtimeCol,
  opsSnapshotsCol,
  ordersCol,
  preCadastrosCol,
  tenantConfigDoc,
} from "../../infra/firestore/duduPaths";
import type {
  DepositoMiniDashboard,
  OpsRefreshResult,
  TimeSeriesDayPoint,
  WarRoomAlert,
  WarRoomFlowGroupBy,
  WarRoomMatchingFunnel,
  WarRoomRolloutHealth,
  WarRoomFlowPoint,
  WarRoomForecast,
  WarRoomForecastPoint,
  WarRoomOverview,
  WarRoomRange,
  WarRoomTopDepositosItem,
} from "../../domain/ops/types";

const ACTIVE_ORDER_STATUSES = new Set(["CREATED", "ROUTED", "NOTIFIED", "ACCEPTED"]);
const DELIVERED_FULFILLMENT = new Set(["ENTREGUE_DEPOSITO", "ENTREGUE_PRESUMIDO", "ENTREGUE_CONFIRMADO"]);

const MS_DAY = 24 * 60 * 60 * 1000;

type OrderDocLike = Record<string, any>;

function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const asAny = value as any;
  if (typeof asAny?.toMillis === "function") return Number(asAny.toMillis());
  if (typeof asAny?.seconds === "number") return Number(asAny.seconds) * 1000;
  return null;
}

function nowRange(range: WarRoomRange): { startMs: number; endMs: number } {
  const endMs = Date.now();
  if (range === "today") {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { startMs: start.getTime(), endMs };
  }
  if (range === "7d") return { startMs: endMs - 7 * MS_DAY, endMs };
  return { startMs: endMs - 30 * MS_DAY, endMs };
}

function parseCentavos(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value) && value >= 1000) return Math.max(0, value);
    return Math.max(0, Math.round(value * 100));
  }
  if (typeof value === "string") {
    const clean = value.trim().replace(/\./g, "").replace(",", ".");
    const n = Number(clean);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.round(n * 100));
  }
  return 0;
}

function extractOrderGmvCentavos(order: OrderDocLike): number {
  const candidates = [
    order?.pricing?.totalToCollect,
    order?.valorTotalPedido,
    order?.totalCentavos,
    order?.gmvCentavos,
    order?.total,
  ];
  for (const candidate of candidates) {
    const parsed = parseCentavos(candidate);
    if (parsed > 0) return parsed;
  }
  return 0;
}

function safePct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function toDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function plusDays(baseMs: number, days: number): number {
  return baseMs + days * MS_DAY;
}

function dayOfWeek(ms: number): number {
  return new Date(ms).getUTCDay();
}

function clampFloor(value: number): number {
  return Math.max(0, Math.floor(value));
}

function forecastFromSeries(series: TimeSeriesDayPoint[], horizonDays: number): WarRoomForecast {
  const byDow = new Map<number, Array<{ orders: number; gmvCentavos: number }>>();
  for (const point of series) {
    const parsedMs = Date.parse(point.key);
    if (!Number.isFinite(parsedMs)) continue;
    const dow = dayOfWeek(parsedMs);
    const list = byDow.get(dow) ?? [];
    list.push({ orders: point.orders, gmvCentavos: point.gmvCentavos });
    byDow.set(dow, list);
  }

  const points: WarRoomForecastPoint[] = [];
  const todayMs = Date.now();
  for (let i = 1; i <= horizonDays; i += 1) {
    const targetMs = plusDays(todayMs, i);
    const dow = dayOfWeek(targetMs);
    const history = byDow.get(dow) ?? [];

    const avgOrders = history.length
      ? history.reduce((acc, item) => acc + item.orders, 0) / history.length
      : 0;
    const avgGmv = history.length
      ? history.reduce((acc, item) => acc + item.gmvCentavos, 0) / history.length
      : 0;

    const ordersBase = clampFloor(avgOrders);
    const ordersLow = clampFloor(avgOrders * 0.8);
    const ordersHigh = clampFloor(avgOrders * 1.2);

    const gmvBaseCentavos = clampFloor(avgGmv);
    const gmvLowCentavos = clampFloor(avgGmv * 0.8);
    const gmvHighCentavos = clampFloor(avgGmv * 1.2);

    points.push({
      date: toDateKey(targetMs),
      ordersBase,
      ordersLow,
      ordersHigh,
      gmvBaseCentavos,
      gmvLowCentavos,
      gmvHighCentavos,
    });
  }

  return {
    generatedAtIso: new Date().toISOString(),
    horizonDays,
    points,
  };
}

async function fetchOrdersInPeriod(tenantId: string, startMs: number): Promise<OrderDocLike[]> {
  const startTs = new Date(startMs);
  const snap = await ordersCol(tenantId).where("createdAt", ">=", startTs).limit(2000).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function fetchIssuesInPeriod(tenantId: string, startMs: number): Promise<Record<string, any>[]> {
  const startTs = new Date(startMs);
  const snap = await issuesCol(tenantId).where("createdAt", ">=", startTs).limit(1000).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function fetchBillingCyclesInPeriod(tenantId: string, startMs: number): Promise<Record<string, any>[]> {
  const startTs = new Date(startMs);
  const snap = await billingCyclesCol(tenantId).where("createdAt", ">=", startTs).limit(1000).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function fetchBillingEventsInPeriod(tenantId: string, startMs: number): Promise<Record<string, any>[]> {
  const startTs = new Date(startMs);
  const snap = await billingEventsCol(tenantId).where("createdAt", ">=", startTs).limit(1000).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function fetchPreCadastrosInPeriod(tenantId: string, startMs: number): Promise<Record<string, any>[]> {
  const startTs = new Date(startMs);
  const snap = await preCadastrosCol(tenantId).where("createdAt", ">=", startTs).limit(2000).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function fetchDepositosMap(tenantId: string): Promise<Map<string, Record<string, any>>> {
  const snap = await depositosCol(tenantId).limit(2000).get();
  const map = new Map<string, Record<string, any>>();
  for (const doc of snap.docs) map.set(doc.id, doc.data());
  return map;
}

function buildFlow(orders: OrderDocLike[], groupBy: WarRoomFlowGroupBy): WarRoomFlowPoint[] {
  const map = new Map<string, { count: number; gmvCentavos: number }>();

  for (const order of orders) {
    let key = "sem_dado";
    if (groupBy === "bairro") key = String(order?.bairro ?? "sem_bairro");
    if (groupBy === "cidade") key = String(order?.cidade ?? "sem_cidade");
    if (groupBy === "canal") key = String(order?.canal ?? "sem_canal");
    if (groupBy === "hour") {
      const createdAtMs = toMillis(order?.createdAt) ?? Date.now();
      key = String(new Date(createdAtMs).getHours()).padStart(2, "0");
    }

    const prev = map.get(key) ?? { count: 0, gmvCentavos: 0 };
    prev.count += 1;
    prev.gmvCentavos += extractOrderGmvCentavos(order);
    map.set(key, prev);
  }

  return Array.from(map.entries())
    .map(([key, value]) => ({ key, count: value.count, gmvCentavos: value.gmvCentavos }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

function buildTopDepositos(orders: OrderDocLike[], depositos: Map<string, Record<string, any>>): WarRoomTopDepositosItem[] {
  const stats = new Map<
    string,
    { gmvCentavos: number; delivered: number; accepted: number; notified: number; slaTotalMin: number; slaCount: number }
  >();

  for (const order of orders) {
    const depositoId = String(order?.depositoId ?? "").trim();
    if (!depositoId) continue;

    const current = stats.get(depositoId) ?? {
      gmvCentavos: 0,
      delivered: 0,
      accepted: 0,
      notified: 0,
      slaTotalMin: 0,
      slaCount: 0,
    };

    current.gmvCentavos += extractOrderGmvCentavos(order);

    const fulfillment = String(order?.fulfillmentStatus ?? "NONE");
    if (DELIVERED_FULFILLMENT.has(fulfillment) || String(order?.status ?? "") === "DONE") {
      current.delivered += 1;
    }
    if (String(order?.status ?? "") === "ACCEPTED") current.accepted += 1;
    if (String(order?.status ?? "") === "NOTIFIED") current.notified += 1;

    const createdAtMs = toMillis(order?.createdAt);
    const acceptedAtMs = toMillis(order?.acceptedAt);
    if (createdAtMs && acceptedAtMs && acceptedAtMs >= createdAtMs) {
      current.slaTotalMin += (acceptedAtMs - createdAtMs) / 60000;
      current.slaCount += 1;
    }

    stats.set(depositoId, current);
  }

  return Array.from(stats.entries())
    .map(([depositoId, data]) => {
      const depositoNome = String(depositos.get(depositoId)?.nome ?? depositoId);
      return {
        depositoId,
        depositoNome,
        gmvCentavos: data.gmvCentavos,
        deliveredOrders: data.delivered,
        acceptanceRatePct: safePct(data.accepted, Math.max(data.notified, data.accepted)),
        slaAvgMinutes: data.slaCount ? Number((data.slaTotalMin / data.slaCount).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.gmvCentavos - a.gmvCentavos)
    .slice(0, 10);
}

function toDailySeries(orders: OrderDocLike[], daysWindow: number): TimeSeriesDayPoint[] {
  const fromMs = Date.now() - daysWindow * MS_DAY;
  const map = new Map<string, TimeSeriesDayPoint>();

  for (const order of orders) {
    const createdAtMs = toMillis(order?.createdAt);
    if (!createdAtMs || createdAtMs < fromMs) continue;
    const day = toDateKey(createdAtMs);
    const current = map.get(day) ?? { key: day, orders: 0, gmvCentavos: 0 };
    current.orders += 1;
    current.gmvCentavos += extractOrderGmvCentavos(order);
    map.set(day, current);
  }

  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function buildAlerts(params: {
  activeOrders: number;
  failedDeliveries: number;
  billingOverdue: number;
  issuesOpen: number;
  precadastrosPending: number;
  rolloutBlockedRatePct: number;
}): WarRoomAlert[] {
  const alerts: WarRoomAlert[] = [];

  if (params.activeOrders > 20) {
    alerts.push({
      code: "active_backlog",
      severity: "warning",
      title: "Backlog de pedidos ativos",
      value: params.activeOrders,
      note: "Pedidos ativos acima do limite recomendado",
    });
  }

  if (params.failedDeliveries > 0) {
    alerts.push({
      code: "failed_deliveries",
      severity: params.failedDeliveries > 5 ? "critical" : "warning",
      title: "Falhas de entrega",
      value: params.failedDeliveries,
    });
  }

  if (params.billingOverdue > 0) {
    alerts.push({
      code: "billing_overdue",
      severity: "warning",
      title: "Cobrancas em atraso",
      value: params.billingOverdue,
    });
  }

  if (params.issuesOpen > 0) {
    alerts.push({
      code: "issues_open",
      severity: params.issuesOpen > 10 ? "critical" : "warning",
      title: "Issues operacionais em aberto",
      value: params.issuesOpen,
    });
  }

  if (params.precadastrosPending > 0) {
    alerts.push({
      code: "pre_cadastro_pending",
      severity: "info",
      title: "Pre-cadastros pendentes",
      value: params.precadastrosPending,
    });
  }

  if (params.rolloutBlockedRatePct >= Number(process.env.ROLLOUT_BLOCKED_ALERT_PCT ?? 40)) {
    alerts.push({
      code: "rollout_blocked",
      severity: params.rolloutBlockedRatePct >= 70 ? "critical" : "warning",
      title: "Saude do rollout em alerta",
      value: Number(params.rolloutBlockedRatePct.toFixed(2)),
      note: "Taxa alta de matching bloqueado por rollout na janela consultada",
    });
  }

  return alerts;
}

function buildMatchingFunnel(orders: OrderDocLike[]): WarRoomMatchingFunnel {
  let semCobertura = 0;
  let elegiveis = 0;
  let selecionado = 0;
  let encaminhado = 0;
  let aceito = 0;
  let recusado = 0;
  let timeout = 0;

  for (const order of orders) {
    const status = String(order?.status ?? "");
    const matching =
      order?.matching && typeof order.matching === "object" && !Array.isArray(order.matching)
        ? (order.matching as Record<string, unknown>)
        : null;
    const eligibleCount = Number(matching?.eligibleCount ?? 0);
    const selectedDepositoId = String(matching?.selectedDepositoId ?? "").trim();
    const forwardResult = String(matching?.forwardResult ?? "").trim();

    if (eligibleCount <= 0) semCobertura += 1;
    if (eligibleCount > 0) elegiveis += 1;
    if (selectedDepositoId) selecionado += 1;
    if (
      forwardResult === "forwarded" ||
      ["ROUTED", "NOTIFIED", "ACCEPTED", "DONE"].includes(status)
    ) {
      encaminhado += 1;
    }
    if (["ACCEPTED", "DONE"].includes(status)) aceito += 1;
    if (status === "DECLINED") recusado += 1;
    if (status === "TIMEOUT") timeout += 1;
  }

  return {
    semCobertura,
    elegiveis,
    selecionado,
    encaminhado,
    aceito,
    recusado,
    timeout,
  };
}

function buildRolloutHealth(orders: OrderDocLike[]): WarRoomRolloutHealth {
  const reasonCounts = new Map<string, number>();
  let attemptsTotal = 0;
  let rolloutAllowed = 0;
  let rolloutBlocked = 0;

  for (const order of orders) {
    const matching =
      order?.matching && typeof order.matching === "object" && !Array.isArray(order.matching)
        ? (order.matching as Record<string, unknown>)
        : null;
    const rollout =
      matching?.rollout && typeof matching.rollout === "object" && !Array.isArray(matching.rollout)
        ? (matching.rollout as Record<string, unknown>)
        : null;
    if (!rollout) continue;
    attemptsTotal += 1;
    const allowed = Boolean(rollout.allowed);
    const reason = String(rollout.reason ?? "unknown");
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    if (allowed) rolloutAllowed += 1;
    else rolloutBlocked += 1;
  }

  return {
    attemptsTotal,
    rolloutAllowed,
    rolloutBlocked,
    blockedRatePct: attemptsTotal > 0 ? Number(((rolloutBlocked / attemptsTotal) * 100).toFixed(2)) : 0,
    rolloutReasonCounts: Object.fromEntries(reasonCounts.entries()),
  };
}

async function readPowerBiConfig(tenantId: string): Promise<{ embedUrl: string | null; reportId: string | null; workspaceId: string | null }> {
  const snap = await tenantConfigDoc(tenantId).get().catch(() => null as any);
  const data = (snap?.data?.() ?? {}) as any;
  const powerBi = data?.powerBi ?? {};
  return {
    embedUrl: String(powerBi.embedUrl ?? "").trim() || null,
    reportId: String(powerBi.reportId ?? "").trim() || null,
    workspaceId: String(powerBi.workspaceId ?? "").trim() || null,
  };
}

export async function computeWarRoomOverview(params: {
  tenantId: string;
  range: WarRoomRange;
  flowGroupBy?: WarRoomFlowGroupBy;
  horizonDays?: number;
}): Promise<WarRoomOverview> {
  const tenantId = assertTenantId(params.tenantId);
  const range = params.range;
  const flowGroupBy = params.flowGroupBy ?? "bairro";
  const horizonDays = Math.max(1, Math.min(Number(params.horizonDays ?? 7), 30));
  const { startMs, endMs } = nowRange(range);

  const [orders, issues, billingCycles, billingEvents, preCadastros, depositosMap, powerBi] = await Promise.all([
    fetchOrdersInPeriod(tenantId, startMs),
    fetchIssuesInPeriod(tenantId, startMs),
    fetchBillingCyclesInPeriod(tenantId, startMs),
    fetchBillingEventsInPeriod(tenantId, startMs),
    fetchPreCadastrosInPeriod(tenantId, startMs),
    fetchDepositosMap(tenantId),
    readPowerBiConfig(tenantId),
  ]);

  let gmvCentavos = 0;
  let deliveredOrders = 0;
  let activeOrders = 0;
  let acceptedOrders = 0;
  let notifiedOrders = 0;
  let slaTotalMin = 0;
  let slaCount = 0;
  let failedDeliveries = 0;

  for (const order of orders) {
    const gmv = extractOrderGmvCentavos(order);
    gmvCentavos += gmv;

    const status = String(order?.status ?? "");
    const fulfillment = String(order?.fulfillmentStatus ?? "NONE");

    if (DELIVERED_FULFILLMENT.has(fulfillment) || status === "DONE") {
      deliveredOrders += 1;
    }
    if (ACTIVE_ORDER_STATUSES.has(status)) activeOrders += 1;
    if (status === "ACCEPTED") acceptedOrders += 1;
    if (status === "NOTIFIED") notifiedOrders += 1;
    if (status === "CANCELED" || status === "TIMEOUT") failedDeliveries += 1;

    const createdAtMs = toMillis(order?.createdAt);
    const acceptedAtMs = toMillis(order?.acceptedAt);
    if (createdAtMs && acceptedAtMs && acceptedAtMs >= createdAtMs) {
      slaTotalMin += (acceptedAtMs - createdAtMs) / 60000;
      slaCount += 1;
    }
  }

  const knownCostsFromCycles = billingCycles.reduce((acc, cycle) => acc + parseCentavos(cycle?.totalCentavos), 0);
  const knownCostsFromEvents = billingEvents.reduce((acc, evt) => {
    const amount = parseCentavos(evt?.valorCentavos ?? evt?.amountCentavos ?? evt?.amount);
    return acc + amount;
  }, 0);
  const knownCostsCentavos = knownCostsFromCycles + knownCostsFromEvents;
  const profitCentavos = gmvCentavos - knownCostsCentavos;

  const preCadastrosTotal = preCadastros.length;
  const preCadastrosConfirmed = preCadastros.filter((item) => String(item?.status ?? "") === "confirmed").length;
  const preCadastrosPending = preCadastros.filter((item) => {
    const status = String(item?.status ?? "");
    return status === "pending_confirmation" || status === "collecting_details" || status === "awaiting_location";
  }).length;

  const billingOverdue = billingCycles.filter((cycle) => {
    const status = String(cycle?.status ?? "");
    return status === "EXPIRED" || status === "OPEN";
  }).length;

  const issuesOpen = issues.filter((issue) => {
    const status = String(issue?.status ?? "OPEN");
    return status === "OPEN" || status === "PENDING";
  }).length;

  const topDepositos = buildTopDepositos(orders, depositosMap);
  const flow = buildFlow(orders, flowGroupBy);
  const matchingFunnel = buildMatchingFunnel(orders);
  const rolloutHealth = buildRolloutHealth(orders);
  const series = toDailySeries(orders, 28);
  const forecast = forecastFromSeries(series, horizonDays);

  const alerts = buildAlerts({
    activeOrders,
    failedDeliveries,
    billingOverdue,
    issuesOpen,
    precadastrosPending: preCadastrosPending,
    rolloutBlockedRatePct: rolloutHealth.blockedRatePct,
  });

  return {
    tenantId,
    range,
    periodStartMs: startMs,
    periodEndMs: endMs,
    kpis: {
      gmvCentavos,
      knownCostsCentavos,
      profitCentavos,
      marginPct: safePct(profitCentavos, gmvCentavos),
      ordersTotal: orders.length,
      ordersDelivered: deliveredOrders,
      ordersActive: activeOrders,
      slaAvgMinutes: slaCount ? Number((slaTotalMin / slaCount).toFixed(2)) : 0,
      preCadastrosTotal,
      preCadastrosConfirmed,
      conversionRatePct: safePct(preCadastrosConfirmed, preCadastrosTotal),
    },
    matchingFunnel,
    rolloutHealth,
    topDepositos,
    flow,
    alerts,
    forecast,
    generatedAtIso: new Date().toISOString(),
    source: "computed",
    powerBi,
  };
}

export async function persistWarRoomSnapshot(params: {
  tenantId: string;
  range: WarRoomRange;
  overview: WarRoomOverview;
  snapshotId?: string;
  realtimeWindowId?: string;
}): Promise<OpsRefreshResult> {
  const tenantId = assertTenantId(params.tenantId);
  const nowIso = new Date().toISOString();
  const dateKey = nowIso.slice(0, 10);
  const snapshotId = params.snapshotId ?? `${params.range}_${dateKey}`;
  const realtimeWindowId = params.realtimeWindowId ?? `${params.range}_rolling`;

  await Promise.all([
    opsSnapshotsCol(tenantId).doc(snapshotId).set(
      {
        tenantId,
        range: params.range,
        generatedAtIso: nowIso,
        generatedAt: FieldValue.serverTimestamp(),
        payload: params.overview,
      },
      { merge: true },
    ),
    opsRealtimeCol(tenantId).doc(realtimeWindowId).set(
      {
        tenantId,
        range: params.range,
        generatedAtIso: nowIso,
        generatedAt: FieldValue.serverTimestamp(),
        payload: params.overview,
      },
      { merge: true },
    ),
  ]);

  return {
    tenantId,
    range: params.range,
    snapshotId,
    realtimeWindowId,
    generatedAtIso: nowIso,
    persisted: true,
  };
}

export async function refreshWarRoomForRange(params: {
  tenantId: string;
  range: WarRoomRange;
  flowGroupBy?: WarRoomFlowGroupBy;
  horizonDays?: number;
}): Promise<{ overview: WarRoomOverview; refresh: OpsRefreshResult }> {
  const overview = await computeWarRoomOverview(params);
  const refresh = await persistWarRoomSnapshot({ tenantId: params.tenantId, range: params.range, overview });
  return { overview, refresh };
}

export async function getWarRoomOverview(params: {
  tenantId: string;
  range: WarRoomRange;
  flowGroupBy?: WarRoomFlowGroupBy;
  horizonDays?: number;
  preferSnapshot?: boolean;
}): Promise<WarRoomOverview> {
  const tenantId = assertTenantId(params.tenantId);
  const preferSnapshot = params.preferSnapshot !== false;
  if (preferSnapshot) {
    const dateKey = new Date().toISOString().slice(0, 10);
    const snapshotId = `${params.range}_${dateKey}`;
    const snap = await opsSnapshotsCol(tenantId).doc(snapshotId).get().catch(() => null as any);
    const payload = snap?.data?.()?.payload as WarRoomOverview | undefined;
    if (payload) {
      return { ...payload, source: "snapshot" };
    }
  }

  return computeWarRoomOverview(params);
}

export async function getTopDepositos(params: {
  tenantId: string;
  range: WarRoomRange;
}): Promise<WarRoomTopDepositosItem[]> {
  const overview = await getWarRoomOverview({ tenantId: params.tenantId, range: params.range });
  return overview.topDepositos;
}

export async function getFlow(params: {
  tenantId: string;
  range: WarRoomRange;
  groupBy?: WarRoomFlowGroupBy;
}): Promise<WarRoomFlowPoint[]> {
  const overview = await getWarRoomOverview({
    tenantId: params.tenantId,
    range: params.range,
    flowGroupBy: params.groupBy,
  });
  return overview.flow;
}

export async function getForecast(params: {
  tenantId: string;
  range: WarRoomRange;
  horizonDays?: number;
}): Promise<WarRoomForecast> {
  const overview = await getWarRoomOverview({
    tenantId: params.tenantId,
    range: params.range,
    horizonDays: params.horizonDays,
  });
  return overview.forecast;
}

export async function getDepositoMiniDashboard(params: {
  tenantId: string;
  depositoId: string;
}): Promise<DepositoMiniDashboard> {
  const tenantId = assertTenantId(params.tenantId);
  const depositoId = String(params.depositoId ?? "").trim();
  if (!depositoId) {
    throw new Error("depositoId_required");
  }

  const [depositoSnap, orders] = await Promise.all([
    depositosCol(tenantId).doc(depositoId).get(),
    fetchOrdersInPeriod(tenantId, Date.now() - 7 * MS_DAY),
  ]);

  const depo = depositoSnap.data() as Record<string, any> | undefined;
  const related = orders.filter((order) => String(order?.depositoId ?? "") === depositoId);

  let activeOrders = 0;
  let queueOrders = 0;
  let deliveredToday = 0;
  let todayGmvCentavos = 0;
  let accepted = 0;
  let notified = 0;
  let prepTotalMin = 0;
  let prepCount = 0;
  let deliveryTotalMin = 0;
  let deliveryCount = 0;

  const todayKey = toDateKey(Date.now());
  for (const order of related) {
    const status = String(order?.status ?? "");

    if (ACTIVE_ORDER_STATUSES.has(status)) activeOrders += 1;
    if (status === "ROUTED" || status === "NOTIFIED") queueOrders += 1;

    if (status === "ACCEPTED") accepted += 1;
    if (status === "NOTIFIED") notified += 1;

    const deliveredAtMs = toMillis(order?.deliveredAt ?? order?.doneAt);
    if (deliveredAtMs && toDateKey(deliveredAtMs) === todayKey) {
      deliveredToday += 1;
      todayGmvCentavos += extractOrderGmvCentavos(order);
    }

    const acceptedAtMs = toMillis(order?.acceptedAt);
    const createdAtMs = toMillis(order?.createdAt);
    if (acceptedAtMs && createdAtMs && acceptedAtMs >= createdAtMs) {
      prepTotalMin += (acceptedAtMs - createdAtMs) / 60000;
      prepCount += 1;
    }

    if (deliveredAtMs && acceptedAtMs && deliveredAtMs >= acceptedAtMs) {
      deliveryTotalMin += (deliveredAtMs - acceptedAtMs) / 60000;
      deliveryCount += 1;
    }
  }

  const alerts = buildAlerts({
    activeOrders,
    failedDeliveries: 0,
    billingOverdue: String(depo?.billing?.status ?? "") === "INADIMPLENTE" ? 1 : 0,
    issuesOpen: 0,
    precadastrosPending: 0,
    rolloutBlockedRatePct: 0,
  }).filter((alert) => alert.code !== "pre_cadastro_pending");

  return {
    tenantId,
    depositoId,
    depositoNome: String(depo?.nome ?? depositoId),
    status: String(depo?.status ?? "FECHADO") === "ABERTO" ? "ABERTO" : "FECHADO",
    activeOrders,
    queueOrders,
    deliveredToday,
    todayGmvCentavos,
    acceptanceRatePct: safePct(accepted, Math.max(notified, accepted)),
    avgPrepMinutes: prepCount ? Number((prepTotalMin / prepCount).toFixed(2)) : 0,
    avgDeliveryMinutes: deliveryCount ? Number((deliveryTotalMin / deliveryCount).toFixed(2)) : 0,
    alerts,
    updatedAtIso: new Date().toISOString(),
  };
}

export async function runWarRoomRealtimeRefreshTask(tenantId: string): Promise<void> {
  const ranges: WarRoomRange[] = ["today", "7d"];
  for (const range of ranges) {
    await refreshWarRoomForRange({ tenantId, range, flowGroupBy: "bairro", horizonDays: 7 });
  }
  logger.info("WAR_ROOM_REALTIME_REFRESH_DONE", { tenantId, ranges });
}

export async function runWarRoomDailyRefreshTask(tenantId: string): Promise<void> {
  const ranges: WarRoomRange[] = ["today", "7d", "30d"];
  for (const range of ranges) {
    await refreshWarRoomForRange({ tenantId, range, flowGroupBy: "bairro", horizonDays: 14 });
  }
  logger.info("WAR_ROOM_DAILY_REFRESH_DONE", { tenantId, ranges });
}
