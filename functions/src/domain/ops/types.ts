import type * as admin from "firebase-admin";

export type WarRoomRange = "today" | "7d" | "30d";
export type WarRoomFlowGroupBy = "bairro" | "cidade" | "canal" | "hour";

export type WarRoomKpis = {
  gmvCentavos: number;
  knownCostsCentavos: number;
  profitCentavos: number;
  marginPct: number;
  ordersTotal: number;
  ordersDelivered: number;
  ordersActive: number;
  slaAvgMinutes: number;
  preCadastrosTotal: number;
  preCadastrosConfirmed: number;
  conversionRatePct: number;
};

export type WarRoomMatchingFunnel = {
  semCobertura: number;
  elegiveis: number;
  selecionado: number;
  encaminhado: number;
  aceito: number;
  recusado: number;
  timeout: number;
};

export type WarRoomRolloutHealth = {
  attemptsTotal: number;
  rolloutAllowed: number;
  rolloutBlocked: number;
  blockedRatePct: number;
  rolloutReasonCounts: Record<string, number>;
};

export type WarRoomTopDepositosItem = {
  depositoId: string;
  depositoNome: string;
  gmvCentavos: number;
  deliveredOrders: number;
  acceptanceRatePct: number;
  slaAvgMinutes: number;
};

export type WarRoomFlowPoint = {
  key: string;
  count: number;
  gmvCentavos: number;
};

export type WarRoomAlert = {
  code:
    | "active_backlog"
    | "failed_deliveries"
    | "billing_overdue"
    | "issues_open"
    | "pre_cadastro_pending"
    | "rollout_blocked";
  severity: "info" | "warning" | "critical";
  title: string;
  value: number;
  note?: string;
};

export type WarRoomForecastPoint = {
  date: string;
  ordersBase: number;
  ordersLow: number;
  ordersHigh: number;
  gmvBaseCentavos: number;
  gmvLowCentavos: number;
  gmvHighCentavos: number;
};

export type WarRoomForecast = {
  generatedAtIso: string;
  horizonDays: number;
  points: WarRoomForecastPoint[];
};

export type WarRoomOverview = {
  tenantId: string;
  range: WarRoomRange;
  periodStartMs: number;
  periodEndMs: number;
  kpis: WarRoomKpis;
  matchingFunnel: WarRoomMatchingFunnel;
  rolloutHealth: WarRoomRolloutHealth;
  topDepositos: WarRoomTopDepositosItem[];
  flow: WarRoomFlowPoint[];
  alerts: WarRoomAlert[];
  forecast: WarRoomForecast;
  generatedAtIso: string;
  source: "computed" | "snapshot";
  powerBi: {
    embedUrl: string | null;
    reportId: string | null;
    workspaceId: string | null;
  };
};

export type DepositoMiniDashboard = {
  tenantId: string;
  depositoId: string;
  depositoNome: string;
  status: "ABERTO" | "FECHADO";
  activeOrders: number;
  queueOrders: number;
  deliveredToday: number;
  todayGmvCentavos: number;
  acceptanceRatePct: number;
  avgPrepMinutes: number;
  avgDeliveryMinutes: number;
  alerts: WarRoomAlert[];
  updatedAtIso: string;
};

export type OpsRefreshResult = {
  tenantId: string;
  range: WarRoomRange;
  snapshotId: string;
  realtimeWindowId: string;
  generatedAtIso: string;
  persisted: boolean;
};

export type TimeSeriesDayPoint = {
  key: string;
  orders: number;
  gmvCentavos: number;
};

export type ReadDoc = admin.firestore.QueryDocumentSnapshot<admin.firestore.DocumentData>;
