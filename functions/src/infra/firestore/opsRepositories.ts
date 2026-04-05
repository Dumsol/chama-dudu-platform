import type * as FirebaseFirestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { normalizeBairro, normalizeWhatsAppId, sanitizeSnippet } from "../../domain/whatsapp/normalize";
import type {
  ConfirmationStatus,
  ConfirmationStep,
  PreCadastroConfirmationData,
  PreCadastroRecord,
  PreCadastroStatus,
} from "../../domain/precadastro/types";
import {
  assertTenantId,
  auditsCol,
  channelDirectoryCol,
  devModeAuthCol,
  depositosCol,
  indicacoesCol,
  messagesCol,
  orderMatchingSnapshotsCol,
  ordersCol,
  preCadastrosCol,
  processedMessagesCol,
  routingRrStateDoc,
  routingStateCol,
  tenantConfigDoc,
  tenantsCol,
  usersCol,
} from "./duduPaths";
import type {
  ActiveOrderRecord,
  DepositoRecord,
  IntentName,
  MatchingSnapshot,
  MessageDirection,
  UserBotState,
  UserRecord,
  UserType,
  WhatsAppInboundMessage,
  WhatsAppStatusEvent,
} from "../../domain/whatsapp/types";
import {
  confirmDeliveredByDeposito,
  createOrder,
  getActiveOrderForUser,
  getActiveOrderForDeposito,
  getOrderById,
  touchLastAction,
  updateFulfillmentStatus,
  updateOrderStatus,
} from "../../modules/orders/orderService";
import { encaminharPedidoParaDeposito } from "../../modules/orders/orderRoutingService";
import { getDepositoById } from "../../modules/depositos/depositoService";
import {
  buildDataFingerprint,
  buildPolicyHash,
  DEFAULT_MATCHING_POLICY,
  MATCHING_POLICY_VERSION,
  MATCHING_SNAPSHOT_VERSION,
  resolveEligibleDepositos,
  selectDepositoWeightedRoundRobin,
  type MatchingDepositoInput,
  type PedidoCanalFlow,
} from "../../domain/whatsapp/orderMatching";

const MESSAGE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

type MatchingRolloutConfigRecord = {
  enabled: boolean;
  defaultPercent: number;
  bairros?: Record<
    string,
    {
      enabled?: boolean;
      percent?: number;
    }
  >;
};

type DevModeAuthStateRecord = {
  failedAttempts: number;
  lockUntilMs: number | null;
  lastFailureAtMs: number | null;
  lastSuccessAtMs: number | null;
  updatedAtMs: number;
};

type PreCadastroCreateInput = {
  tenantId: string;
  nomeDeposito: string;
  responsavel: string;
  whatsapp: string;
  bairro: string;
  cidade?: string;
  cnpj?: string;
  whatsappDdd: string | null;
  regionStatus: "supported" | "unsupported";
  status: PreCadastroStatus;
  confirmationStatus: ConfirmationStatus;
  confirmationStep: ConfirmationStep;
  source?: string;
  /** Hash do token de acesso gerado pelo site no momento do pre-cadastro. */
  tokenHash?: string | null;
};

type TemplateDispatchStatus = "pending" | "sending" | "sent" | "failed";

type TemplateDispatchState = {
  key?: string;
  status?: TemplateDispatchStatus;
  templateName?: string;
  languageCode?: string;
  attempts?: number;
  sentAtMs?: number | null;
  lastAttemptAtMs?: number | null;
  lastError?: string | null;
  source?: string | null;
};

const TERMINAL_PRE_CADASTRO_STATUS: PreCadastroStatus[] = [
  "confirmed",
  "unsupported_region",
  "abandoned",
  "manual_review",
];

function isTerminalPreCadastroStatus(status: PreCadastroStatus): boolean {
  return TERMINAL_PRE_CADASTRO_STATUS.includes(status);
}

function sanitizeDocId(input: string): string {
  return String(input ?? "")
    .replace(/[^\w-]/g, "_")
    .slice(0, 180);
}

function userDocId(tenantId: string, waId: string): string {
  return sanitizeDocId(`usr_${tenantId}_${waId}`);
}

function depositoDocId(tenantId: string, waId: string): string {
  return sanitizeDocId(`dep_${tenantId}_${waId}`);
}

function mapUser(data: FirebaseFirestore.DocumentData | undefined, id: string): UserRecord | null {
  if (!data) return null;
  const beveragePackTypeRaw = normalizeOptionalString(data.beveragePackType);
  const beveragePackType =
    beveragePackTypeRaw &&
    ["lata", "long_neck", "garrafa", "pack", "litrão"].includes(beveragePackTypeRaw)
      ? (beveragePackTypeRaw as UserRecord["beveragePackType"])
      : undefined;
  const paymentMethodRaw = normalizeOptionalString(data.paymentMethod);
  const paymentMethod =
    paymentMethodRaw && ["pix", "cartao", "dinheiro"].includes(paymentMethodRaw)
      ? (paymentMethodRaw as UserRecord["paymentMethod"])
      : undefined;
  const slotsRaw =
    data.slots && typeof data.slots === "object" && !Array.isArray(data.slots)
      ? (data.slots as UserRecord["slots"])
      : undefined;
  const lastIntentRaw = normalizeOptionalString(data.lastIntent);
  return {
    userId: id,
    tenantId: String(data.tenantId ?? ""),
    waId: data.waId ? String(data.waId) : null,
    bsuId: normalizeOptionalString(data.bsuId),
    waUsername: normalizeOptionalString(data.waUsername),
    type: data.type === "deposito" ? "deposito" : "cliente",
    role: data.role ?? (data.type === "deposito" ? "deposito" : "cliente"),
    bairro: normalizeOptionalString(data.bairro),
    bairroNorm: normalizeOptionalString(data.bairroNorm),
    name: normalizeOptionalString(data.name),
    beverage: normalizeOptionalString(data.beverage),
    beverageBrand: normalizeOptionalString(data.beverageBrand),
    beverageVolumeMl:
      typeof data.beverageVolumeMl === "number" && Number.isFinite(data.beverageVolumeMl)
        ? Number(data.beverageVolumeMl)
        : undefined,
    beveragePackType,
    hasVasilhame: typeof data.hasVasilhame === "boolean" ? Boolean(data.hasVasilhame) : undefined,
    ageConfirmed: typeof data.ageConfirmed === "boolean" ? Boolean(data.ageConfirmed) : undefined,
    paymentMethod,
    botState: data.botState ?? "idle",
    botStateExpiresAtMs:
      typeof data.botStateExpiresAtMs === "number" ? Number(data.botStateExpiresAtMs) : undefined,
    conversationHistory: Array.isArray(data.conversationHistory) ? data.conversationHistory : [],
    activeOrderId: normalizeOptionalString(data.activeOrderId) ?? null,
    fallbackCount: typeof data.fallbackCount === "number" ? Number(data.fallbackCount) : 0,
    lastActivityAtMs: typeof data.lastActivityAtMs === "number" ? Number(data.lastActivityAtMs) : Date.now(),
    pendingOffers: Array.isArray(data.pendingOffers) ? data.pendingOffers : [],
    slots: slotsRaw,
    lastIntent: (lastIntentRaw as IntentName | undefined) ?? undefined,
    lastIntentConfidence:
      typeof data.lastIntentConfidence === "number" && Number.isFinite(data.lastIntentConfidence)
        ? Number(data.lastIntentConfidence)
        : undefined,
  };
}

function mapDeposito(data: FirebaseFirestore.DocumentData | undefined, id: string): DepositoRecord | null {
  if (!data) return null;
  return {
    depositoId: id,
    tenantId: String(data.tenantId ?? ""),
    waId: data.waId ? String(data.waId) : null,
    bsuId: data.bsuId ? String(data.bsuId) : undefined,
    waUsername: data.waUsername ? String(data.waUsername) : undefined,
    nomeDeposito: data.nomeDeposito ? String(data.nomeDeposito) : undefined,
    bairro: data.bairro ? String(data.bairro) : undefined,
    bairroNorm: data.bairroNorm ? String(data.bairroNorm) : undefined,
    aberto: Boolean(data.aberto),
    pausedUntilMs: typeof data.pausedUntilMs === "number" ? Number(data.pausedUntilMs) : null,
    pauseReason: data.pauseReason ? String(data.pauseReason) : null,
  };
}

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned : undefined;
}

function applyNullableField<T>(target: Record<string, unknown>, key: string, value: T | null | undefined): void {
  if (value === undefined) return;
  target[key] = value === null ? FieldValue.delete() : value;
}

function applyNullableStringField(target: Record<string, unknown>, key: string, value: string | null | undefined): void {
  if (value === undefined) return;
  const cleaned = normalizeOptionalString(value);
  target[key] = cleaned ?? FieldValue.delete();
}

function cleanLegacyNullFields(
  target: Record<string, unknown>,
  current: FirebaseFirestore.DocumentData | undefined,
  fields: string[],
  ignoredFields: Set<string>,
): void {
  if (!current) return;
  for (const field of fields) {
    if (ignoredFields.has(field)) continue;
    if (current[field] === null) {
      target[field] = FieldValue.delete();
    }
  }
}

function mapActiveOrderFromOrder(raw: Record<string, unknown> & { id: string }): ActiveOrderRecord {
  const matchingRaw = raw.matching;
  const matchingData =
    matchingRaw && typeof matchingRaw === "object" && !Array.isArray(matchingRaw)
      ? (matchingRaw as Record<string, unknown>)
      : null;
  return {
    id: raw.id,
    status: String(raw.status ?? "CREATED"),
    fulfillmentStatus: String(raw.fulfillmentStatus ?? "NONE"),
    bairro: raw.bairro ? String(raw.bairro) : null,
    itensDescricao: raw.itensDescricao ? String(raw.itensDescricao) : null,
    etaMin: parseNullableNumber(raw.etaMin),
    valorTotalPedido: parseNullableNumber(raw.valorTotalPedido),
    userId: raw.userId ? String(raw.userId) : null,
    canal: raw.canal ? String(raw.canal).toUpperCase() as ActiveOrderRecord["canal"] : null,
    depositoId: raw.depositoId ? String(raw.depositoId) : null,
    tentativasDepositos: Array.isArray(raw.tentativasDepositos)
      ? raw.tentativasDepositos.map((item) => String(item))
      : [],
    matching: matchingData
      ? {
          attemptNo: parseNullableNumber(matchingData.attemptNo),
          snapshotVersion: matchingData.snapshotVersion ? String(matchingData.snapshotVersion) : null,
          policyVersion: matchingData.policyVersion ? String(matchingData.policyVersion) : null,
          policyHash: matchingData.policyHash ? String(matchingData.policyHash) : null,
          selectedDepositoId: matchingData.selectedDepositoId ? String(matchingData.selectedDepositoId) : null,
          selectionReason: matchingData.selectionReason ? String(matchingData.selectionReason) : null,
          selectionScore: parseNullableNumber(matchingData.selectionScore),
          eligibleCount: parseNullableNumber(matchingData.eligibleCount),
          depositsDataFingerprint: matchingData.depositsDataFingerprint
            ? String(matchingData.depositsDataFingerprint)
            : null,
          rrPointerBefore: parseNullableNumber(matchingData.rrPointerBefore),
          rrPointerAfter: parseNullableNumber(matchingData.rrPointerAfter),
          forwardAttemptedAtMs: parseNullableNumber(matchingData.forwardAttemptedAtMs),
          forwardResult: matchingData.forwardResult
            ? (String(matchingData.forwardResult) as NonNullable<ActiveOrderRecord["matching"]>["forwardResult"])
            : null,
          forwardFailureReason: matchingData.forwardFailureReason ? String(matchingData.forwardFailureReason) : null,
        }
      : null,
  };
}

type MatchingDoc = {
  attemptNo: number;
  snapshotVersion: string;
  policyVersion: string;
  policyHash: string;
  inputContext: {
    bairro: string;
    bairroNorm: string;
    canal: PedidoCanalFlow;
    intent: IntentName;
    userBotState: UserRecord["botState"];
  };
  eligibleCandidates: Array<{
    depositoId: string;
    nome: string;
    waId: string;
    bairro: string;
    bairroNorm: string;
    score: number;
    weight: number;
    reasons: string[];
  }>;
  excludedCandidates: Array<{ depositoId: string; nome: string; reasons: string[] }>;
  rrPointerBefore: number;
  rrPointerAfter: number;
  selectedDepositoId: string | null;
  selectionReason: string;
  selectionScore: number | null;
  generatedAtMs: number;
  depositsDataFingerprint: string;
};

function toMatchingSnapshot(data: Record<string, unknown> | null | undefined): MatchingSnapshot | null {
  if (!data) return null;
  const eligibleRaw = Array.isArray(data.eligibleCandidates) ? data.eligibleCandidates : [];
  const excludedRaw = Array.isArray(data.excludedCandidates) ? data.excludedCandidates : [];
  const inputRaw =
    data.inputContext && typeof data.inputContext === "object" && !Array.isArray(data.inputContext)
      ? (data.inputContext as Record<string, unknown>)
      : null;
  if (!inputRaw) return null;
  const canalValue = String(inputRaw.canal ?? "DELIVERY").toUpperCase();
  const canal: PedidoCanalFlow =
    canalValue === "RETIRADA" ? "RETIRADA" : canalValue === "CONSULTA" ? "CONSULTA" : "DELIVERY";

  return {
    attemptNo: Math.max(1, Number(data.attemptNo ?? 1)),
    snapshotVersion: String(data.snapshotVersion ?? MATCHING_SNAPSHOT_VERSION),
    policyVersion: String(data.policyVersion ?? MATCHING_POLICY_VERSION),
    policyHash: String(data.policyHash ?? ""),
    inputContext: {
      bairro: String(inputRaw.bairro ?? ""),
      bairroNorm: String(inputRaw.bairroNorm ?? ""),
      canal,
      intent: String(inputRaw.intent ?? "fallback") as IntentName,
      userBotState: String(inputRaw.userBotState ?? "idle") as NonNullable<UserRecord["botState"]>,
    },
    eligibleCandidates: eligibleRaw
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          depositoId: String(row.depositoId ?? ""),
          nome: String(row.nome ?? ""),
          waId: String(row.waId ?? ""),
          bairro: String(row.bairro ?? ""),
          bairroNorm: String(row.bairroNorm ?? ""),
          score: Number(row.score ?? 0),
          weight: Number(row.weight ?? 1),
          reasons: Array.isArray(row.reasons) ? row.reasons.map((reason) => String(reason)) : [],
        };
      })
      .filter((item) => item.depositoId.length > 0),
    excludedCandidates: excludedRaw
      .map((item) => {
        const row = item as Record<string, unknown>;
        return {
          depositoId: String(row.depositoId ?? ""),
          nome: String(row.nome ?? ""),
          reasons: Array.isArray(row.reasons) ? row.reasons.map((reason) => String(reason)) : [],
        };
      })
      .filter((item) => item.depositoId.length > 0),
    rrPointerBefore: Number(data.rrPointerBefore ?? -1),
    rrPointerAfter: Number(data.rrPointerAfter ?? -1),
    selectedDepositoId: data.selectedDepositoId ? String(data.selectedDepositoId) : null,
    selectionReason: String(data.selectionReason ?? "weighted_round_robin"),
    selectionScore: parseNullableNumber(data.selectionScore),
    generatedAtMs: Math.max(0, Number(data.generatedAtMs ?? Date.now())),
    depositsDataFingerprint: String(data.depositsDataFingerprint ?? ""),
  };
}

function pointerDocId(params: { bairroNorm: string; canal: PedidoCanalFlow }): string {
  return `wrr__${sanitizeDocId(params.bairroNorm.toLowerCase())}__${String(params.canal).toLowerCase()}`;
}

function parseMatchingRolloutConfig(raw: unknown): MatchingRolloutConfigRecord | null {
  const data =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (!data) return null;
  const bairrosRaw =
    data.bairros && typeof data.bairros === "object" && !Array.isArray(data.bairros)
      ? (data.bairros as Record<string, unknown>)
      : {};
  const bairros: MatchingRolloutConfigRecord["bairros"] = {};
  for (const [key, value] of Object.entries(bairrosRaw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const percent = Number(item.percent);
    bairros[String(key).trim().toLowerCase()] = {
      enabled: item.enabled === undefined ? undefined : Boolean(item.enabled),
      percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.floor(percent))) : undefined,
    };
  }
  return {
    enabled: Boolean(data.enabled),
    defaultPercent: Number.isFinite(Number(data.defaultPercent))
      ? Math.max(0, Math.min(100, Math.floor(Number(data.defaultPercent))))
      : 0,
    bairros,
  };
}

function normalizeRolloutBairrosPatch(
  patch: Record<string, { enabled?: boolean; percent?: number }>,
): MatchingRolloutConfigRecord["bairros"] {
  const normalized: MatchingRolloutConfigRecord["bairros"] = {};
  for (const [rawKey, value] of Object.entries(patch ?? {})) {
    const key = normalizeBairro(rawKey);
    if (!key) continue;
    const item = value ?? {};
    normalized[key] = {
      enabled: item.enabled === undefined ? undefined : Boolean(item.enabled),
      percent:
        item.percent === undefined || !Number.isFinite(Number(item.percent))
          ? undefined
          : Math.max(0, Math.min(100, Math.floor(Number(item.percent)))),
    };
  }
  return normalized;
}

function toMatchingDepositoInput(doc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>): MatchingDepositoInput {
  const data = doc.data() as Record<string, unknown>;
  const allTimeStats =
    data.stats && typeof data.stats === "object" && !Array.isArray(data.stats)
      ? ((data.stats as Record<string, unknown>).allTime as Record<string, unknown> | undefined)
      : undefined;
  const last7dStats =
    data.stats && typeof data.stats === "object" && !Array.isArray(data.stats)
      ? ((data.stats as Record<string, unknown>).last7d as Record<string, unknown> | undefined)
      : undefined;

  const ratingAvg = parseNullableNumber(allTimeStats?.ratingAvg) ?? 4;
  const qualityScore = Math.max(0.2, Math.min(1, ratingAvg / 5));
  const acceptRate = parseNullableNumber(last7dStats?.acceptRate) ?? 0.72;
  const responseAvgMinutes = parseNullableNumber(last7dStats?.notifiedToAcceptAvgMin);
  const recentAvailabilityScore = parseNullableNumber(data.lastSeenScore) ?? 0.8;
  const qualityStatus = String(
    (data.quality as Record<string, unknown> | undefined)?.statusQualidade ?? "OK",
  ).toUpperCase();
  const billingStatus = String((data.billing as Record<string, unknown> | undefined)?.status ?? "OK").toUpperCase();
  const blocked = qualityStatus === "SUSPENSO" || billingStatus === "INADIMPLENTE";

  const commercialPriorityRaw =
    parseNullableNumber(data.commercialPriority) ??
    parseNullableNumber(data.priority) ??
    parseNullableNumber(data.routingPriority) ??
    3;

  const deliveryDisponivel = data.deliveryDisponivel === undefined ? true : Boolean(data.deliveryDisponivel);
  const retiradaDisponivel = data.retiradaDisponivel === undefined ? true : Boolean(data.retiradaDisponivel);
  const statusRaw = String(data.status ?? "").toUpperCase();
  const aberto = typeof data.aberto === "boolean" ? Boolean(data.aberto) : statusRaw === "ABERTO";
  const pausedUntilMs = parseNullableNumber(data.pausedUntilMs);
  const routeEligible = data.routeEligible === undefined ? true : Boolean(data.routeEligible);

  return {
    depositoId: doc.id,
    nome: String(data.nomeDeposito ?? data.nome ?? `Deposito ${doc.id.slice(-4)}`),
    waId: data.waId ? String(data.waId) : null,
    bairro: String(data.bairro ?? ""),
    bairroNorm: String(data.bairroNorm ?? ""),
    aberto,
    status: statusRaw || null,
    routeEligible,
    pausedUntilMs,
    blocked,
    canalDeliveryDisponivel: deliveryDisponivel,
    canalRetiradaDisponivel: retiradaDisponivel,
    commercialPriority: Math.max(1, Math.min(5, Number(commercialPriorityRaw))),
    qualityScore,
    financeHealthScore: billingStatus === "INADIMPLENTE" ? 0.2 : 1,
    acceptRate: Math.max(0.1, Math.min(1, acceptRate)),
    responseAvgMinutes,
    recentAvailabilityScore: Math.max(0.2, Math.min(1, recentAvailabilityScore)),
  };
}

async function loadBairroDepositosForMatching(params: {
  tenantId: string;
  bairroNorm: string;
}): Promise<MatchingDepositoInput[]> {
  const snap = await depositosCol(params.tenantId)
    .where("bairroNorm", "==", params.bairroNorm)
    .limit(80)
    .get();
  return snap.docs.map((doc) => toMatchingDepositoInput(doc));
}

function buildDepositsDataFingerprintFromInputs(inputs: MatchingDepositoInput[]): string {
  const normalized = inputs
    .map((item) => ({
      depositoId: item.depositoId,
      aberto: item.aberto,
      routeEligible: item.routeEligible,
      blocked: item.blocked,
      pausedUntilMs: item.pausedUntilMs ?? null,
      canalDeliveryDisponivel: item.canalDeliveryDisponivel,
      canalRetiradaDisponivel: item.canalRetiradaDisponivel,
      commercialPriority: item.commercialPriority,
      qualityScore: item.qualityScore,
      financeHealthScore: item.financeHealthScore,
      acceptRate: item.acceptRate,
      responseAvgMinutes: item.responseAvgMinutes ?? null,
      recentAvailabilityScore: item.recentAvailabilityScore,
      status: item.status ?? null,
      waId: item.waId ?? null,
    }))
    .sort((a, b) => a.depositoId.localeCompare(b.depositoId));
  return buildDataFingerprint(normalized);
}

export const opsRepositories = {
  async fetchTenantIdByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
    const cleanId = String(phoneNumberId ?? "").trim();
    if (!cleanId) return null;

    const directorySnap = await channelDirectoryCol().doc(cleanId).get();
    if (directorySnap.exists) {
      const directoryData = directorySnap.data() as {
        tenantId?: string;
        productId?: string;
        channelType?: string;
      };
      const tenantId = String(directoryData?.tenantId ?? "").trim();
      if (
        tenantId &&
        String(directoryData?.productId ?? "").trim() === "dudu" &&
        String(directoryData?.channelType ?? "").trim() === "whatsapp"
      ) {
        return tenantId;
      }
    }

    const tenantsSnap = await tenantsCol().where("phoneNumberId", "==", cleanId).limit(1).get();
    if (tenantsSnap.empty) return null;
    return String(tenantsSnap.docs[0].id);
  },

  async getUserByTenantWaId(tenantId: string, waId: string): Promise<UserRecord | null> {
    const scopedTenantId = assertTenantId(tenantId);
    if (!waId) return null;

    // Tenta primeiro pelo ID do documento (tradicionalmente waId)
    const doc = await usersCol(scopedTenantId).doc(userDocId(scopedTenantId, waId)).get();
    if (doc.exists) return mapUser(doc.data(), doc.id);

    // Se não encontrou, tenta buscar por campo bsuId (fallback para usernames)
    const bsuQuery = await usersCol(scopedTenantId).where("bsuId", "==", waId).limit(1).get();
    if (!bsuQuery.empty) return mapUser(bsuQuery.docs[0].data(), bsuQuery.docs[0].id);

    return null;
  },

  async findUserByBsuId(tenantId: string, bsuId: string): Promise<UserRecord | null> {
    const scopedTenantId = assertTenantId(tenantId);
    if (!bsuId) return null;
    const query = await usersCol(scopedTenantId).where("bsuId", "==", bsuId).limit(1).get();
    if (query.empty) return null;
    return mapUser(query.docs[0].data(), query.docs[0].id);
  },

  async upsertUser(params: {
    tenantId: string;
    waId: string | null;
    bsuId?: string | null;
    waUsername?: string | null;
    name?: string | null;
    type: UserType;
    botState: UserBotState;
    botStateExpiresAtMs?: number | null;
    conversationHistory?: UserRecord["conversationHistory"];
    activeOrderId?: string | null;
    fallbackCount?: number | null;
    lastActivityAtMs?: number;
    pendingOffers?: any[];
    slots?: UserRecord["slots"] | null;
    lastIntent?: IntentName | null;
    lastIntentConfidence?: number | null;
    bairro?: string | null;
    bairroNorm?: string | null;
  }): Promise<UserRecord> {
    const waId = params.waId ? normalizeWhatsAppId(params.waId) : null;
    const bsuId = params.bsuId?.trim() || null;
    if (!waId && !bsuId) throw new Error("waId or bsuId required");

    const userId = waId || bsuId || "unknown";
    const ref = usersCol(params.tenantId).doc(userId);

    const doc: Record<string, unknown> = {
      userId,
      tenantId: params.tenantId,
      type: params.type,
      role: params.type === "deposito" ? "deposito" : "cliente",
      botState: params.botState,
      conversationHistory: params.conversationHistory ?? [],
      fallbackCount: params.fallbackCount ?? 0,
      lastActivityAtMs: params.lastActivityAtMs ?? Date.now(),
      pendingOffers: params.pendingOffers ?? [],
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (waId) doc.waId = waId;
    applyNullableStringField(doc, "bsuId", bsuId);
    applyNullableStringField(doc, "waUsername", params.waUsername);
    applyNullableStringField(doc, "name", params.name);
    applyNullableField(doc, "botStateExpiresAtMs", params.botStateExpiresAtMs);
    applyNullableStringField(doc, "activeOrderId", params.activeOrderId);
    applyNullableField(doc, "slots", params.slots);
    applyNullableField(doc, "lastIntent", params.lastIntent);
    applyNullableField(doc, "lastIntentConfidence", params.lastIntentConfidence);
    applyNullableStringField(doc, "bairro", params.bairro);
    applyNullableStringField(doc, "bairroNorm", params.bairroNorm);

    await ref.set(doc, { merge: true });
    const snap = await ref.get();
    return (mapUser(snap.data(), snap.id) ?? {
      userId,
      tenantId: params.tenantId,
      waId: waId ?? null,
      bsuId: bsuId ?? undefined,
      waUsername: normalizeOptionalString(params.waUsername),
      type: params.type,
      role: params.type === "deposito" ? "deposito" : "cliente",
      name: normalizeOptionalString(params.name),
      botState: params.botState,
      botStateExpiresAtMs: params.botStateExpiresAtMs ?? undefined,
      conversationHistory: params.conversationHistory ?? [],
      activeOrderId: normalizeOptionalString(params.activeOrderId) ?? null,
      fallbackCount: params.fallbackCount ?? 0,
      lastActivityAtMs: params.lastActivityAtMs ?? Date.now(),
      pendingOffers: params.pendingOffers ?? [],
      slots: params.slots ?? undefined,
      lastIntent: (params.lastIntent as IntentName | undefined) ?? undefined,
      lastIntentConfidence: params.lastIntentConfidence ?? undefined,
    }) as UserRecord;
  },

  /**
   * Transição atômica de botState via Firestore Transaction.
   * Garante read-modify-write sem race condition entre dois webhooks simultâneos.
   */
  async transitionUserState(params: {
    tenantId: string;
    waId: string | null;
    bsuId?: string | null;
    waUsername?: string | null;
    name?: string | null;
    type: UserType;
    botState: UserBotState;
    botStateExpiresAtMs: number | null;
    conversationHistory?: UserRecord["conversationHistory"];
    activeOrderId?: string | null;
    fallbackCount?: number | null;
    lastActivityAtMs?: number;
    pendingOffers?: any[];
    slots?: UserRecord["slots"] | null;
    lastIntent?: IntentName | null;
    lastIntentConfidence?: number | null;
    bairro?: string | null;
    bairroNorm?: string | null;
    beverageBrand?: string | null;
    beverageVolumeMl?: number | null;
    beveragePackType?: UserRecord["beveragePackType"];
    hasVasilhame?: boolean | null;
    ageConfirmed?: boolean | null;
    paymentMethod?: UserRecord["paymentMethod"];
    expectedBotState?: UserBotState | null;
  }): Promise<UserRecord | "conflict"> {
    const waId = params.waId ? normalizeWhatsAppId(params.waId) : null;
    const bsuId = normalizeOptionalString(params.bsuId);
    if (!waId && !bsuId) throw new Error("waId or bsuId required for transition");

    const userId = waId || bsuId || "unknown";
    const ref = usersCol(params.tenantId).doc(userId);

    let resultUser: UserRecord | "conflict" = "conflict";

    await ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.data() as UserRecord | undefined;

      if (params.expectedBotState !== undefined) {
        const actualBotState = current?.botState ?? "idle";
        if (actualBotState !== params.expectedBotState) {
          resultUser = "conflict";
          return;
        }
      }

      const update: Record<string, unknown> = {
        userId,
        tenantId: params.tenantId,
        type: params.type,
        role: params.type === "deposito" ? "deposito" : "cliente",
        botState: params.botState,
        conversationHistory: params.conversationHistory ?? current?.conversationHistory ?? [],
        fallbackCount: params.fallbackCount ?? current?.fallbackCount ?? 0,
        lastActivityAtMs: params.lastActivityAtMs ?? Date.now(),
        pendingOffers: params.pendingOffers ?? current?.pendingOffers ?? [],
        updatedAt: FieldValue.serverTimestamp(),
      };

      if (waId) update.waId = waId;
      applyNullableStringField(update, "bsuId", bsuId);
      applyNullableStringField(update, "waUsername", params.waUsername);
      applyNullableStringField(update, "name", params.name);
      applyNullableField(update, "botStateExpiresAtMs", params.botStateExpiresAtMs);
      applyNullableStringField(update, "activeOrderId", params.activeOrderId);
      applyNullableField(update, "slots", params.slots);
      applyNullableField(update, "lastIntent", params.lastIntent);
      applyNullableField(update, "lastIntentConfidence", params.lastIntentConfidence);
      applyNullableStringField(update, "bairro", params.bairro);
      applyNullableStringField(update, "bairroNorm", params.bairroNorm);
      applyNullableStringField(update, "beverageBrand", params.beverageBrand);
      applyNullableField(update, "beverageVolumeMl", params.beverageVolumeMl);
      applyNullableField(update, "beveragePackType", params.beveragePackType);
      applyNullableField(update, "hasVasilhame", params.hasVasilhame);
      applyNullableField(update, "ageConfirmed", params.ageConfirmed);
      applyNullableField(update, "paymentMethod", params.paymentMethod);

      const explicitlySetFields = new Set<string>([
        "bsuId",
        "waUsername",
        "name",
        "botStateExpiresAtMs",
        "activeOrderId",
        "slots",
        "lastIntent",
        "lastIntentConfidence",
        "bairro",
        "bairroNorm",
        "beverageBrand",
        "beverageVolumeMl",
        "beveragePackType",
        "hasVasilhame",
        "ageConfirmed",
        "paymentMethod",
      ].filter((field) => field in update));
      cleanLegacyNullFields(
        update,
        current as FirebaseFirestore.DocumentData | undefined,
        [
          "bsuId",
          "waUsername",
          "name",
          "botStateExpiresAtMs",
          "activeOrderId",
          "slots",
          "lastIntent",
          "lastIntentConfidence",
          "bairro",
          "bairroNorm",
          "beverageBrand",
          "beverageVolumeMl",
          "beveragePackType",
          "hasVasilhame",
          "ageConfirmed",
          "paymentMethod",
        ],
        explicitlySetFields,
      );

      tx.set(ref, update, { merge: true });
      resultUser = (mapUser({ ...(current ?? {}), ...update }, userId) ?? "conflict") as UserRecord | "conflict";
    });

    return resultUser;
  },

  async findDepositoByTenantWaId(tenantId: string, waId: string): Promise<DepositoRecord | null> {
    const scopedTenantId = assertTenantId(tenantId);
    const normalizedWa = normalizeWhatsAppId(waId);
    const snap = await depositosCol(scopedTenantId)
      .where("waId", "==", normalizedWa)
      .limit(1)
      .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return mapDeposito(doc.data(), doc.id);
  },

  async ensureDepositoForWaId(params: { tenantId: string; waId: string }): Promise<DepositoRecord> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const current = await opsRepositories.findDepositoByTenantWaId(scopedTenantId, params.waId);
    if (current) return current;
    const waId = normalizeWhatsAppId(params.waId);
    const ref = depositosCol(scopedTenantId).doc(depositoDocId(scopedTenantId, waId));
    await ref.set(
      {
        tenantId: scopedTenantId,
        waId,
        aberto: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const doc = await ref.get();
    return mapDeposito(doc.data(), doc.id) as DepositoRecord;
  },

  async updateDepositoBairro(params: {
    tenantId: string;
    depositoId: string;
    bairro: string;
    bairroNorm: string;
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await depositosCol(scopedTenantId).doc(params.depositoId).set(
      {
        tenantId: scopedTenantId,
        bairro: params.bairro,
        bairroNorm: params.bairroNorm,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  },

  async updateDepositoStatus(params: {
    tenantId: string;
    depositoId: string;
    aberto: boolean;
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await depositosCol(scopedTenantId).doc(params.depositoId).set(
      {
        tenantId: scopedTenantId,
        aberto: params.aberto,
        status: params.aberto ? "ABERTO" : "FECHADO",
        pausedUntilMs: params.aberto ? null : FieldValue.delete(),
        pauseReason: params.aberto ? null : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  },

  async listOpenDepositosByBairro(params: {
    tenantId: string;
    bairroNorm: string;
  }): Promise<DepositoRecord[]> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const snap = await depositosCol(scopedTenantId)
      .where("bairroNorm", "==", params.bairroNorm)
      .where("aberto", "==", true)
      .limit(20)
      .get();
    return snap.docs.map((doc) => mapDeposito(doc.data(), doc.id)).filter(Boolean) as DepositoRecord[];
  },

  async getActiveOrderForUser(params: { tenantId: string; userId: string }): Promise<ActiveOrderRecord | null> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const order = await getActiveOrderForUser(scopedTenantId, params.userId);
    if (!order) return null;
    return mapActiveOrderFromOrder({
      ...(order as unknown as Record<string, unknown>),
      id: order.id,
    });
  },

  async getOrderById(params: { tenantId: string; orderId: string }): Promise<ActiveOrderRecord | null> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const order = await getOrderById({
      tenantId: scopedTenantId,
      orderId: params.orderId,
    });
    if (!order) return null;
    return mapActiveOrderFromOrder({
      ...(order as unknown as Record<string, unknown>),
      id: order.id,
    });
  },

  async createOrderForUser(params: {
    tenantId: string;
    userId: string;
    phoneNumberId: string;
    bairro?: string | null;
    itensDescricao?: string | null;
    canal?: PedidoCanalFlow | null;
  }): Promise<ActiveOrderRecord> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const created = await createOrder({
      tenantId: scopedTenantId,
      userId: params.userId,
      phoneNumberId: params.phoneNumberId,
      bairro: params.bairro ?? null,
      itensDescricao: params.itensDescricao ?? null,
      canal: params.canal ?? null,
    });
    await ordersCol(scopedTenantId).doc(created.id).set(
      {
        canal: params.canal ?? created.canal ?? null,
        matching: {
          attemptNo: 0,
          snapshotVersion: MATCHING_SNAPSHOT_VERSION,
          policyVersion: MATCHING_POLICY_VERSION,
          policyHash: null,
          selectedDepositoId: null,
          selectionReason: null,
          selectionScore: null,
          eligibleCount: 0,
          depositsDataFingerprint: null,
          rrPointerBefore: null,
          rrPointerAfter: null,
          forwardResult: null,
          forwardFailureReason: null,
          updatedAtMs: Date.now(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return {
      id: created.id,
      status: created.status,
      fulfillmentStatus: created.fulfillmentStatus,
      bairro: created.bairro ?? null,
      itensDescricao: created.itensDescricao ?? null,
      valorTotalPedido: created.valorTotalPedido ?? null,
      userId: created.userId,
      canal: (created.canal ?? params.canal ?? null) as ActiveOrderRecord["canal"],
      depositoId: created.depositoId ?? null,
      tentativasDepositos: created.tentativasDepositos ?? [],
      matching: {
        attemptNo: 0,
        snapshotVersion: MATCHING_SNAPSHOT_VERSION,
        policyVersion: MATCHING_POLICY_VERSION,
        policyHash: null,
        selectedDepositoId: null,
        selectionReason: null,
        selectionScore: null,
        eligibleCount: 0,
        depositsDataFingerprint: null,
        rrPointerBefore: null,
        rrPointerAfter: null,
        forwardResult: null,
        forwardFailureReason: null,
      },
    };
  },

  async updateOrderForFlow(params: {
    tenantId: string;
    orderId: string;
    status?: "CREATED" | "ROUTED" | "NOTIFIED" | "TIMEOUT" | "CANCELED";
    extraFields?: Record<string, unknown>;
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    if (params.status) {
      await updateOrderStatus({
        tenantCnpj: scopedTenantId,
        orderId: params.orderId,
        newStatus: params.status,
        extraFields: params.extraFields,
      });
      return;
    }
    await ordersCol(scopedTenantId).doc(params.orderId).set(
      {
        ...(params.extraFields ?? {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  },

  async buildMatchingSnapshot(params: {
    tenantId: string;
    orderId: string;
    attemptNo: number;
    inputContext: {
      bairro: string;
      bairroNorm: string;
      canal: PedidoCanalFlow;
      intent: IntentName;
      userBotState: NonNullable<UserRecord["botState"]>;
    };
    excludeDepositoIds?: string[];
  }): Promise<MatchingSnapshot> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const attemptNo = Math.max(1, Math.floor(params.attemptNo));
    const orderRef = ordersCol(scopedTenantId).doc(params.orderId);
    const snapshotRef = orderMatchingSnapshotsCol(scopedTenantId, params.orderId).doc(String(attemptNo).padStart(6, "0"));

    const existingSnap = await snapshotRef.get();
    if (existingSnap.exists) {
      const mapped = toMatchingSnapshot(existingSnap.data() as Record<string, unknown>);
      if (mapped) return mapped;
    }

    const matchingInputs = await loadBairroDepositosForMatching({
      tenantId: scopedTenantId,
      bairroNorm: params.inputContext.bairroNorm,
    });
    const policySeed = {
      policyVersion: MATCHING_POLICY_VERSION,
      ...DEFAULT_MATCHING_POLICY,
      tenantId: scopedTenantId,
      bairroNorm: params.inputContext.bairroNorm,
      canal: params.inputContext.canal,
    };
    const policyHash = buildPolicyHash(policySeed);
    const resolution = resolveEligibleDepositos({
      depositos: matchingInputs,
      canal: params.inputContext.canal,
      excludeDepositoIds: params.excludeDepositoIds ?? [],
      policy: DEFAULT_MATCHING_POLICY,
    });

    const pointerRef = routingStateCol(scopedTenantId).doc(pointerDocId({
      bairroNorm: params.inputContext.bairroNorm,
      canal: params.inputContext.canal,
    }));
    const globalPointerRef = routingRrStateDoc(scopedTenantId);

    const rrResult = await pointerRef.firestore.runTransaction(async (tx) => {
      const [pointerSnap, globalSnap] = await Promise.all([
        tx.get(pointerRef),
        tx.get(globalPointerRef),
      ]);
      const pointerBefore = pointerSnap.exists
        ? Math.floor(Number((pointerSnap.data() as { pointer?: number })?.pointer ?? -1))
        : -1;
      const globalPointerBefore = globalSnap.exists
        ? Math.floor(Number((globalSnap.data() as { pointer?: number })?.pointer ?? -1))
        : -1;

      // Sort equal-score candidates using global pointer as cross-bairro tie-breaker
      const sortedCandidates = resolution.eligible.slice().sort((a, b) => {
        const scoreDiff = b.score - a.score;
        if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
        // Equal scores: use global pointer to rotate who comes first
        const ids = resolution.eligible.map((c) => c.depositoId).sort();
        const aIdx = (ids.indexOf(a.depositoId) - globalPointerBefore - 1 + ids.length) % ids.length;
        const bIdx = (ids.indexOf(b.depositoId) - globalPointerBefore - 1 + ids.length) % ids.length;
        return aIdx - bIdx;
      });

      const selected = selectDepositoWeightedRoundRobin({
        candidates: sortedCandidates,
        pointerBefore,
      });

      const nowMs = Date.now();
      tx.set(
        pointerRef,
        {
          pointer: selected.pointerAfter,
          selectedDepositoId: selected.selectedDepositoId,
          attemptNo,
          policyVersion: MATCHING_POLICY_VERSION,
          policyHash,
          bairroNorm: params.inputContext.bairroNorm,
          canal: params.inputContext.canal,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        },
        { merge: true },
      );
      const globalPointerAfter = (globalPointerBefore + 1) % Math.max(1, resolution.eligible.length);
      tx.set(
        globalPointerRef,
        {
          pointer: globalPointerAfter,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        },
        { merge: true },
      );
      return {
        pointerBefore,
        pointerAfter: selected.pointerAfter,
        selectedDepositoId: selected.selectedDepositoId,
      };
    });

    const selectedCandidate = resolution.eligible.find((item) => item.depositoId === rrResult.selectedDepositoId) ?? null;
    const fingerprint = buildDepositsDataFingerprintFromInputs(matchingInputs);

    const snapshot: MatchingSnapshot = {
      attemptNo,
      snapshotVersion: MATCHING_SNAPSHOT_VERSION,
      policyVersion: MATCHING_POLICY_VERSION,
      policyHash,
      inputContext: params.inputContext,
      eligibleCandidates: resolution.eligible,
      excludedCandidates: resolution.excluded,
      rrPointerBefore: rrResult.pointerBefore,
      rrPointerAfter: rrResult.pointerAfter,
      selectedDepositoId: rrResult.selectedDepositoId,
      selectionReason: rrResult.selectedDepositoId ? "weighted_round_robin" : "no_eligible_candidates",
      selectionScore: selectedCandidate?.score ?? null,
      generatedAtMs: Date.now(),
      depositsDataFingerprint: fingerprint,
    };

    const snapshotDoc: MatchingDoc = {
      ...snapshot,
    };

    const batch = orderRef.firestore.batch();
    batch.set(
      snapshotRef,
      {
        ...snapshotDoc,
        createdAt: FieldValue.serverTimestamp(),
        createdAtMs: snapshot.generatedAtMs,
      },
      { merge: false },
    );
    batch.set(
      orderRef,
      {
        matching: {
          attemptNo: snapshot.attemptNo,
          snapshotVersion: snapshot.snapshotVersion,
          policyVersion: snapshot.policyVersion,
          policyHash: snapshot.policyHash,
          selectedDepositoId: snapshot.selectedDepositoId,
          selectionReason: snapshot.selectionReason,
          selectionScore: snapshot.selectionScore,
          eligibleCount: snapshot.eligibleCandidates.length,
          depositsDataFingerprint: snapshot.depositsDataFingerprint,
          rrPointerBefore: snapshot.rrPointerBefore,
          rrPointerAfter: snapshot.rrPointerAfter,
          forwardResult: null,
          forwardFailureReason: null,
          updatedAtMs: Date.now(),
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await batch.commit();
    logger.info("WA_MATCHING_SNAPSHOT_BUILT", {
      tenantId: scopedTenantId,
      orderId: params.orderId,
      attemptNo,
      bairroNorm: params.inputContext.bairroNorm,
      canal: params.inputContext.canal,
      eligibleDepositsCount: snapshot.eligibleCandidates.length,
      excludedDepositsCount: snapshot.excludedCandidates.length,
      selectedDepositoId: snapshot.selectedDepositoId,
      selectionReason: snapshot.selectionReason,
      rankingScore: snapshot.selectionScore,
      rrPointerBefore: snapshot.rrPointerBefore,
      rrPointerAfter: snapshot.rrPointerAfter,
      snapshotVersion: snapshot.snapshotVersion,
      policyVersion: snapshot.policyVersion,
      policyHash: snapshot.policyHash,
      depositsDataFingerprint: snapshot.depositsDataFingerprint,
    });
    return snapshot;
  },

  async forwardOrderToDeposito(params: {
    tenantId: string;
    phoneNumberId: string;
    orderId: string;
    attemptNo: number;
    selectedDepositoId: string;
    expectedFingerprint: string;
    snapshotVersion: string;
    policyVersion: string;
    policyHash: string;
  }): Promise<{
    ok: boolean;
    forwardResult: "forwarded" | "failed" | "diverged" | "skipped";
    forwardFailureReason?: string;
    selectedDepositoName?: string;
  }> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const attemptNo = Math.max(1, Math.floor(params.attemptNo));
    const forwardTxKey = `${params.orderId}:${attemptNo}:${params.selectedDepositoId}`;
    logger.info("WA_ORDER_FORWARD_ATTEMPT", {
      tenantId: scopedTenantId,
      orderId: params.orderId,
      attemptNo,
      selectedDepositoId: params.selectedDepositoId,
      snapshotVersion: params.snapshotVersion,
      policyVersion: params.policyVersion,
      policyHash: params.policyHash,
      forwardTxKey,
    });
    const orderRef = ordersCol(scopedTenantId).doc(params.orderId);
    const snapshotRef = orderMatchingSnapshotsCol(scopedTenantId, params.orderId).doc(String(attemptNo).padStart(6, "0"));
    const [orderSnap, snapshotSnap] = await Promise.all([orderRef.get(), snapshotRef.get()]);
    if (!orderSnap.exists || !snapshotSnap.exists) {
      return { ok: false, forwardResult: "failed", forwardFailureReason: "missing_order_or_snapshot" };
    }

    const orderData = (orderSnap.data() ?? {}) as Record<string, unknown>;
    const snapshot = toMatchingSnapshot(snapshotSnap.data() as Record<string, unknown>);
    if (!snapshot) {
      return { ok: false, forwardResult: "failed", forwardFailureReason: "invalid_snapshot" };
    }

    if (
      snapshot.snapshotVersion !== params.snapshotVersion ||
      snapshot.policyVersion !== params.policyVersion ||
      snapshot.policyHash !== params.policyHash
    ) {
      return { ok: false, forwardResult: "diverged", forwardFailureReason: "policy_version_mismatch" };
    }

    if (snapshot.selectedDepositoId !== params.selectedDepositoId) {
      return { ok: false, forwardResult: "diverged", forwardFailureReason: "selected_deposito_mismatch" };
    }

    if (snapshot.depositsDataFingerprint !== params.expectedFingerprint) {
      return { ok: false, forwardResult: "diverged", forwardFailureReason: "fingerprint_context_mismatch" };
    }

    const currentMatchingInputs = await loadBairroDepositosForMatching({
      tenantId: scopedTenantId,
      bairroNorm: snapshot.inputContext.bairroNorm,
    });
    const currentFingerprint = buildDepositsDataFingerprintFromInputs(currentMatchingInputs);
    if (currentFingerprint !== snapshot.depositsDataFingerprint) {
      await orderRef.set(
        {
          matching: {
            forwardResult: "diverged",
            forwardFailureReason: "fingerprint_changed_before_forward",
            updatedAtMs: Date.now(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await snapshotRef.set(
        {
          forward: {
            status: "diverged",
            reason: "fingerprint_changed_before_forward",
            atMs: Date.now(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: false, forwardResult: "diverged", forwardFailureReason: "fingerprint_changed_before_forward" };
    }

    const currentForwardResult =
      (orderData.matching as Record<string, unknown> | undefined)?.forwardResult;
    const currentForwardKey = String(
      (orderData.matching as Record<string, unknown> | undefined)?.forwardTxKey ?? "",
    );
    if (String(currentForwardResult ?? "").toLowerCase() === "forwarded") {
      return {
        ok: true,
        forwardResult: "skipped",
      };
    }
    if (currentForwardKey === forwardTxKey && String(currentForwardResult ?? "").toLowerCase() === "skipped") {
      return {
        ok: true,
        forwardResult: "skipped",
      };
    }

    const orderModel = await getOrderById({
      tenantId: scopedTenantId,
      orderId: params.orderId,
    });
    if (!orderModel) {
      return { ok: false, forwardResult: "failed", forwardFailureReason: "order_not_found" };
    }

    const selectedDeposito = await getDepositoById(scopedTenantId, params.selectedDepositoId);
    if (!selectedDeposito || !selectedDeposito.waId) {
      await orderRef.set(
        {
          matching: {
            forwardResult: "failed",
            forwardFailureReason: "selected_deposito_not_available",
            updatedAtMs: Date.now(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { ok: false, forwardResult: "failed", forwardFailureReason: "selected_deposito_not_available" };
    }

    await updateOrderStatus({
      tenantCnpj: scopedTenantId,
      orderId: params.orderId,
      newStatus: "ROUTED",
      extraFields: {
        depositoId: selectedDeposito.id,
        tentativasDepositos: FieldValue.arrayUnion(selectedDeposito.id),
        matching: {
          attemptNo,
          snapshotVersion: snapshot.snapshotVersion,
          policyVersion: snapshot.policyVersion,
          policyHash: snapshot.policyHash,
          selectedDepositoId: selectedDeposito.id,
          selectionReason: snapshot.selectionReason,
          selectionScore: snapshot.selectionScore,
          eligibleCount: snapshot.eligibleCandidates.length,
          depositsDataFingerprint: snapshot.depositsDataFingerprint,
          rrPointerBefore: snapshot.rrPointerBefore,
          rrPointerAfter: snapshot.rrPointerAfter,
          forwardResult: "skipped",
          forwardFailureReason: null,
          forwardTxKey,
          forwardAttemptedAtMs: Date.now(),
          updatedAtMs: Date.now(),
        },
      },
    });

    try {
      await encaminharPedidoParaDeposito({
        tenantCnpj: scopedTenantId,
        phoneNumberId: params.phoneNumberId,
        order: orderModel,
        deposito: selectedDeposito,
        motivo: attemptNo === 1 ? "NOVO" : "REROUTE",
      });
      await updateOrderStatus({
        tenantCnpj: scopedTenantId,
        orderId: params.orderId,
        newStatus: "NOTIFIED",
      });
      await orderRef.set(
        {
          matching: {
            forwardResult: "forwarded",
            forwardFailureReason: null,
            selectedDepositoId: selectedDeposito.id,
            forwardTxKey,
            forwardAttemptedAtMs: Date.now(),
            updatedAtMs: Date.now(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await snapshotRef.set(
        {
          forward: {
            status: "forwarded",
            selectedDepositoId: selectedDeposito.id,
            atMs: Date.now(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      logger.info("WA_ORDER_FORWARD_RESULT", {
        tenantId: scopedTenantId,
        orderId: params.orderId,
        attemptNo,
        forwardResult: "forwarded",
        selectedDepositoId: selectedDeposito.id,
      });
      return {
        ok: true,
        forwardResult: "forwarded",
        selectedDepositoName: selectedDeposito.nome,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const sanitizedReason = sanitizeSnippet(reason, 240) ?? "forward_failed";
      await orderRef.set(
        {
          matching: {
            forwardResult: "failed",
            forwardFailureReason: sanitizedReason,
            forwardTxKey,
            forwardAttemptedAtMs: Date.now(),
            updatedAtMs: Date.now(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      await snapshotRef.set(
        {
          forward: {
            status: "failed",
            reason: sanitizedReason,
            atMs: Date.now(),
          },
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      logger.warn("WA_ORDER_FORWARD_RESULT", {
        tenantId: scopedTenantId,
        orderId: params.orderId,
        attemptNo,
        forwardResult: "failed",
        reason: sanitizedReason,
        selectedDepositoId: params.selectedDepositoId,
      });
      return {
        ok: false,
        forwardResult: "failed",
        forwardFailureReason: sanitizedReason,
      };
    }
  },

  async setDepositoPause(params: {
    tenantId: string;
    depositoId: string;
    minutes: number;
    reason?: string;
  }): Promise<number> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const minutes = Math.max(5, Math.min(12 * 60, Math.floor(params.minutes)));
    const pausedUntilMs = Date.now() + minutes * 60 * 1000;
    await depositosCol(scopedTenantId).doc(params.depositoId).set(
      {
        tenantId: scopedTenantId,
        pausedUntilMs,
        pauseReason: params.reason ?? "manual_pause_whatsapp",
        status: "ABERTO",
        aberto: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return pausedUntilMs;
  },

  async getActiveOrderForDeposito(params: {
    tenantId: string;
    depositoId: string;
  }): Promise<ActiveOrderRecord | null> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const order = await getActiveOrderForDeposito(scopedTenantId, params.depositoId);
    if (!order) return null;
    return {
      id: order.id,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      bairro: order.bairro ?? null,
      itensDescricao: order.itensDescricao ?? null,
      etaMin: typeof order.etaMin === "number" ? order.etaMin : null,
      valorTotalPedido: typeof order.valorTotalPedido === "number" ? order.valorTotalPedido : null,
      userId: order.userId ?? null,
    };
  },

  async acceptOrder(params: { tenantId: string; orderId: string }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await updateOrderStatus({ tenantCnpj: scopedTenantId, orderId: params.orderId, newStatus: "ACCEPTED" });
    await touchLastAction({
      tenantCnpj: scopedTenantId,
      orderId: params.orderId,
      by: "deposito",
      textPreview: "wa_deposito_aceitou",
    });
  },

  async declineOrder(params: { tenantId: string; orderId: string; reason: string }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await updateOrderStatus({
      tenantCnpj: scopedTenantId,
      orderId: params.orderId,
      newStatus: "DECLINED",
      extraFields: {
        declineReasonByDeposito: sanitizeSnippet(params.reason, 160),
      },
    });
    await touchLastAction({
      tenantCnpj: scopedTenantId,
      orderId: params.orderId,
      by: "deposito",
      textPreview: `wa_deposito_recusou:${sanitizeSnippet(params.reason, 80)}`,
    });
  },

  async setOrderPreparing(params: { tenantId: string; orderId: string }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await updateFulfillmentStatus({
      tenantCnpj: scopedTenantId,
      orderId: params.orderId,
      newFulfillmentStatus: "SEPARANDO",
    });
    await touchLastAction({
      tenantCnpj: scopedTenantId,
      orderId: params.orderId,
      by: "deposito",
      textPreview: "wa_deposito_separando",
    });
  },

  async setOrderEta(params: { tenantId: string; orderId: string; etaMin: number; sourceText: string }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const etaMin = Math.max(5, Math.min(180, Math.floor(params.etaMin)));
    await ordersCol(scopedTenantId).doc(params.orderId).set(
      {
        etaMin,
        etaSourceText: sanitizeSnippet(params.sourceText, 120),
        etaSetAt: FieldValue.serverTimestamp(),
        lastActionBy: "deposito",
        lastActionAt: FieldValue.serverTimestamp(),
        lastActionTextPreview: "wa_deposito_eta",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  },

  async setOrderOutForDelivery(params: { tenantId: string; orderId: string }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await updateFulfillmentStatus({
      tenantCnpj: scopedTenantId,
      orderId: params.orderId,
      newFulfillmentStatus: "A_CAMINHO",
    });
    await touchLastAction({
      tenantCnpj: scopedTenantId,
      orderId: params.orderId,
      by: "deposito",
      textPreview: "wa_deposito_saiu",
    });
  },

  async setOrderDelivered(params: { tenantId: string; orderId: string }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await confirmDeliveredByDeposito(scopedTenantId, params.orderId);
    await touchLastAction({
      tenantCnpj: scopedTenantId,
      orderId: params.orderId,
      by: "deposito",
      textPreview: "wa_deposito_entregue",
    });
  },

  async createProcessedMessage(messageId: string, data: { tenantId: string; waId: string; ttlMs: number }): Promise<boolean> {
    const scopedTenantId = assertTenantId(data.tenantId);
    const ref = processedMessagesCol(scopedTenantId).doc(sanitizeDocId(messageId));
    try {
      await ref.create({
        tenantId: scopedTenantId,
        waId: data.waId,
        createdAt: FieldValue.serverTimestamp(),
        ttl: new Date(Date.now() + data.ttlMs),
      });
      return true;
    } catch (error: unknown) {
      const code = (error as { code?: number | string }).code;
      if (code === 6 || code === "already-exists") {
        return false;
      }
      throw error;
    }
  },

  async saveInboundMessage(params: { tenantId: string; message: WhatsAppInboundMessage }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await messagesCol(scopedTenantId).add({
      tenantId: scopedTenantId,
      waId: params.message.waId,
      direction: "in" as MessageDirection,
      messageId: params.message.messageId,
      type: params.message.type,
      sourceKind: params.message.sourceKind,
      body: sanitizeSnippet(params.message.text, 180),
      createdAt: FieldValue.serverTimestamp(),
      ttl: new Date(Date.now() + MESSAGE_TTL_MS),
    });
  },

  async saveOutboundMessage(params: {
    tenantId: string;
    waId: string;
    messageId: string | null;
    body: string;
    type: "text" | "interactive";
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await messagesCol(scopedTenantId).add({
      tenantId: scopedTenantId,
      waId: params.waId,
      direction: "out" as MessageDirection,
      messageId: params.messageId,
      type: params.type,
      body: sanitizeSnippet(params.body, 180),
      createdAt: FieldValue.serverTimestamp(),
      ttl: new Date(Date.now() + MESSAGE_TTL_MS),
    });
  },

  async saveStatusMessage(params: {
    tenantId: string;
    status: WhatsAppStatusEvent;
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await messagesCol(scopedTenantId).add({
      tenantId: scopedTenantId,
      waId: params.status.recipientWaId,
      direction: "in" as MessageDirection,
      messageId: params.status.messageId,
      type: "status",
      body: sanitizeSnippet(
        `${params.status.status}${params.status.errorCode ? ` (${params.status.errorCode})` : ""}`,
        180,
      ),
      createdAt: FieldValue.serverTimestamp(),
      ttl: new Date(Date.now() + MESSAGE_TTL_MS),
    });
  },

  async getTenantChannelConfig(tenantId: string): Promise<{ phoneNumberId: string | null }> {
    const scopedTenantId = assertTenantId(tenantId);
    const snap = await tenantsCol().doc(scopedTenantId).get();
    const data = snap.data() as { phoneNumberId?: string } | undefined;
    return {
      phoneNumberId: data?.phoneNumberId ? String(data.phoneNumberId).trim() || null : null,
    };
  },

  async findLatestPendingPreCadastroByWhatsApp(tenantId: string, waId: string): Promise<PreCadastroRecord | null> {
    const scopedTenantId = assertTenantId(tenantId);
    const cleanWa = normalizeWhatsAppId(waId);
    if (!cleanWa) return null;

    const query = await preCadastrosCol(scopedTenantId)
      .where("whatsapp", "==", cleanWa)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (query.empty) return null;
    const doc = query.docs[0];
    const data = doc.data() as Record<string, unknown>;
    const status = String(data.status ?? "pending_confirmation") as PreCadastroStatus;
    const confirmationStatus = String(data.confirmationStatus ?? "pending") as ConfirmationStatus;
    if (isTerminalPreCadastroStatus(status) || confirmationStatus === "confirmed") {
      return null;
    }

    return {
      id: doc.id,
      tenantId: scopedTenantId,
      whatsapp: cleanWa,
      status,
      regionStatus: data.regionStatus === "unsupported" ? "unsupported" : "supported",
      confirmationStatus,
      confirmationStep: String(data.confirmationStep ?? "awaiting_identity_confirmation") as ConfirmationStep,
      confirmationData: (data.confirmationData ?? undefined) as PreCadastroConfirmationData | undefined,
      templateDispatch: (data.templateDispatch ?? undefined) as PreCadastroRecord["templateDispatch"],
    };
  },

  async updatePreCadastroConfirmation(params: {
    tenantId: string;
    preCadastroId: string;
    status?: PreCadastroStatus;
    confirmationStatus?: ConfirmationStatus;
    confirmationStep?: ConfirmationStep;
    confirmationDataPatch?: Partial<PreCadastroConfirmationData>;
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const ref = preCadastrosCol(scopedTenantId).doc(params.preCadastroId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const current = (snap.data() ?? {}) as Record<string, unknown>;
    const currentData = (current.confirmationData ?? {}) as PreCadastroConfirmationData;

    const nextData = params.confirmationDataPatch
      ? {
          ...currentData,
          ...params.confirmationDataPatch,
        }
      : currentData;

    const prevStep = String(current.confirmationStep ?? "awaiting_identity_confirmation") as ConfirmationStep;
    const nextStep = (params.confirmationStep ?? prevStep) as ConfirmationStep;
    const prevStatus = String(current.status ?? "pending_confirmation") as PreCadastroStatus;
    const nextStatus = (params.status ?? prevStatus) as PreCadastroStatus;
    const stepTimestamps = (current.stepTimestamps ?? {}) as Record<string, unknown>;
    const nowMs = Date.now();

    const patch: Record<string, unknown> = {
      status: nextStatus,
      confirmationStatus: params.confirmationStatus ?? current.confirmationStatus ?? "pending",
      confirmationStep: nextStep,
      confirmationData: nextData,
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      lastInteractionAtMs: nowMs,
    };

    if (!stepTimestamps[nextStep]) {
      patch[`stepTimestamps.${nextStep}`] = nowMs;
    }
    if (nextStep !== prevStep) {
      patch.previousConfirmationStep = prevStep;
      patch.lastStepTransitionAtMs = nowMs;
    }
    if (nextStatus === "confirmed" || params.confirmationStatus === "confirmed") {
      patch.confirmedAt = FieldValue.serverTimestamp();
      patch.confirmedAtMs = nowMs;
    }
    if (nextStatus === "failed_delivery") {
      patch.failedDeliveryAtMs = nowMs;
    }
    if (nextStatus === "abandoned") {
      patch.abandonedAtMs = nowMs;
    }

    await ref.set(patch, { merge: true });

    if (params.status === "confirmed" || params.confirmationStatus === "confirmed") {
      await depositosCol(scopedTenantId).doc(params.preCadastroId).set(
        {
          bairrosAtendidos: nextData.bairrosAtendidos ?? [],
          atendimentoMode: nextData.atendimentoMode ?? null,
          horarioAtendimento: nextData.horarioAtendimento ?? null,
          localizacaoOficial: nextData.officialLocation ?? null,
          preCadastroConfirmedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  },

  async claimTemplateDispatch(params: {
    tenantId: string;
    preCadastroId: string;
    dispatchKey: string;
    templateName: string;
    languageCode: string;
    source: string;
  }): Promise<{ allowed: boolean; reason: "already_sent" | "already_sending" | "claimed" }> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const ref = preCadastrosCol(scopedTenantId).doc(params.preCadastroId);
    return ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { allowed: false, reason: "already_sent" as const };
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const status = String(data.status ?? "pending_confirmation") as PreCadastroStatus;
      if (isTerminalPreCadastroStatus(status)) {
        return { allowed: false, reason: "already_sent" as const };
      }

      const dispatch = (data.templateDispatch ?? {}) as TemplateDispatchState;
      if (dispatch.status === "sent" && dispatch.key === params.dispatchKey) {
        return { allowed: false, reason: "already_sent" as const };
      }
      if (dispatch.status === "sending" && dispatch.key === params.dispatchKey) {
        return { allowed: false, reason: "already_sending" as const };
      }

      tx.set(
        ref,
        {
          templateDispatch: {
            key: params.dispatchKey,
            status: "sending",
            templateName: params.templateName,
            languageCode: params.languageCode,
            attempts: Number(dispatch.attempts ?? 0) + 1,
            lastAttemptAtMs: Date.now(),
            source: params.source,
            lastError: null,
          },
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: Date.now(),
        },
        { merge: true },
      );
      return { allowed: true, reason: "claimed" as const };
    });
  },

  async finishTemplateDispatch(params: {
    tenantId: string;
    preCadastroId: string;
    status: "sent" | "failed";
    errorMessage?: string | null;
    nextStatusIfFailed?: PreCadastroStatus;
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const ref = preCadastrosCol(scopedTenantId).doc(params.preCadastroId);
    const nowMs = Date.now();
    await ref.set(
      {
        templateDispatch: {
          status: params.status,
          sentAtMs: params.status === "sent" ? nowMs : null,
          lastAttemptAtMs: nowMs,
          lastError: params.errorMessage ?? null,
        },
        status: params.status === "failed" ? (params.nextStatusIfFailed ?? "failed_delivery") : "pending_confirmation",
        confirmationStatus: params.status === "failed" ? "pending" : "in_progress",
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
        failedDeliveryAtMs: params.status === "failed" ? nowMs : FieldValue.delete(),
      },
      { merge: true },
    );
  },

  async markStalePreCadastrosAsAbandoned(params: {
    tenantId: string;
    staleBeforeMs: number;
    limit?: number;
  }): Promise<number> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const limit = Math.max(1, Math.min(200, params.limit ?? 100));
    const snap = await preCadastrosCol(scopedTenantId)
      .where("status", "in", ["pending_confirmation", "collecting_details", "awaiting_location", "failed_delivery"])
      .limit(limit)
      .get();
    let updates = 0;
    const batch = snap.docs[0]?.ref.firestore.batch();
    if (!batch) return 0;
    for (const doc of snap.docs) {
      const data = (doc.data() ?? {}) as Record<string, unknown>;
      const lastInteractionAtMs = Number(
        data.lastInteractionAtMs ?? data.updatedAtMs ?? data.createdAtMs ?? 0,
      );
      if (!lastInteractionAtMs || lastInteractionAtMs > params.staleBeforeMs) continue;
      batch.set(
        doc.ref,
        {
          status: "abandoned",
          confirmationStatus: "pending",
          abandonedAtMs: Date.now(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtMs: Date.now(),
        },
        { merge: true },
      );
      updates += 1;
    }
    if (updates > 0) await batch.commit();
    return updates;
  },

  async getPreCadastroQueueView(params: { tenantId: string; limit?: number }): Promise<{
    counts: Record<string, number>;
    byStep: Record<string, number>;
    manualReview: Array<Record<string, unknown>>;
    failedDelivery: Array<Record<string, unknown>>;
    awaitingLocation: Array<Record<string, unknown>>;
  }> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const limit = Math.max(1, Math.min(50, params.limit ?? 20));
    const statuses: PreCadastroStatus[] = [
      "pending_confirmation",
      "collecting_details",
      "awaiting_location",
      "confirmed",
      "unsupported_region",
      "abandoned",
      "failed_delivery",
      "manual_review",
    ];

    const counts: Record<string, number> = {};
    for (const status of statuses) {
      const query = await preCadastrosCol(scopedTenantId).where("status", "==", status).get();
      counts[status] = query.size;
    }

    const all = await preCadastrosCol(scopedTenantId)
      .orderBy("updatedAt", "desc")
      .limit(Math.max(limit * 5, 100))
      .get();

    const byStep: Record<string, number> = {};
    const toItem = (
      doc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>,
    ): Record<string, unknown> => {
      const data = doc.data();
      return {
        id: doc.id,
        whatsapp: data.whatsapp ?? null,
        status: data.status ?? null,
        confirmationStep: data.confirmationStep ?? null,
        confirmationStatus: data.confirmationStatus ?? null,
        updatedAtMs: data.updatedAtMs ?? data.lastInteractionAtMs ?? null,
        templateDispatch: data.templateDispatch ?? null,
      };
    };

    const manualReview: Array<Record<string, unknown>> = [];
    const failedDelivery: Array<Record<string, unknown>> = [];
    const awaitingLocation: Array<Record<string, unknown>> = [];

    for (const doc of all.docs) {
      const data = doc.data();
      const step = String(data.confirmationStep ?? "awaiting_identity_confirmation");
      byStep[step] = Number(byStep[step] ?? 0) + 1;
      if (String(data.status ?? "") === "manual_review" && manualReview.length < limit) manualReview.push(toItem(doc));
      if (String(data.status ?? "") === "failed_delivery" && failedDelivery.length < limit) failedDelivery.push(toItem(doc));
      if (String(data.confirmationStep ?? "") === "awaiting_location" && awaitingLocation.length < limit) {
        awaitingLocation.push(toItem(doc));
      }
    }

    return { counts, byStep, manualReview, failedDelivery, awaitingLocation };
  },

  async fetchMatchingRolloutConfig(tenantId: string): Promise<MatchingRolloutConfigRecord | null> {
    const scopedTenantId = assertTenantId(tenantId);
    const snap = await tenantConfigDoc(scopedTenantId).get();
    if (!snap.exists) return null;
    const raw = (snap.data() ?? {}) as Record<string, unknown>;
    const matching =
      raw.features && typeof raw.features === "object" && !Array.isArray(raw.features)
        ? (raw.features as Record<string, unknown>).matching
        : null;
    const rollout =
      matching && typeof matching === "object" && !Array.isArray(matching)
        ? (matching as Record<string, unknown>).rollout
        : null;
    return parseMatchingRolloutConfig(rollout);
  },

  async ensureMatchingRolloutBootstrap(tenantId: string): Promise<{
    created: boolean;
    config: MatchingRolloutConfigRecord;
  }> {
    const scopedTenantId = assertTenantId(tenantId);
    const ref = tenantConfigDoc(scopedTenantId);
    const nowMs = Date.now();
    const result = await ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const raw = (snap.data() ?? {}) as Record<string, unknown>;
      const features =
        raw.features && typeof raw.features === "object" && !Array.isArray(raw.features)
          ? (raw.features as Record<string, unknown>)
          : {};
      const matching =
        features.matching && typeof features.matching === "object" && !Array.isArray(features.matching)
          ? (features.matching as Record<string, unknown>)
          : {};
      const rollout = parseMatchingRolloutConfig(matching.rollout);
      if (rollout) {
        return { created: false, config: rollout };
      }
      const config: MatchingRolloutConfigRecord = {
        enabled: false,
        defaultPercent: 0,
        bairros: {},
      };
      tx.set(
        ref,
        {
          features: {
            ...features,
            matching: {
              ...matching,
              rollout: config,
            },
          },
          updatedBy: "bootstrap",
          updatedAtMs: nowMs,
          source: "bootstrap",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { created: true, config };
    });
    return result;
  },

  async setMatchingRollout(params: {
    tenantId: string;
    enabled: boolean;
    defaultPercent: number;
    bairrosPatch?: Record<string, { enabled?: boolean; percent?: number }>;
    actor: string;
  }): Promise<MatchingRolloutConfigRecord> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const ref = tenantConfigDoc(scopedTenantId);
    const next = await ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const raw = (snap.data() ?? {}) as Record<string, unknown>;
      const features =
        raw.features && typeof raw.features === "object" && !Array.isArray(raw.features)
          ? (raw.features as Record<string, unknown>)
          : {};
      const matching =
        features.matching && typeof features.matching === "object" && !Array.isArray(features.matching)
          ? (features.matching as Record<string, unknown>)
          : {};
      const current = parseMatchingRolloutConfig(matching.rollout) ?? {
        enabled: false,
        defaultPercent: 0,
        bairros: {},
      };
      const patchBairros = normalizeRolloutBairrosPatch(params.bairrosPatch ?? {});
      const mergedBairros = { ...(current.bairros ?? {}), ...patchBairros };
      const config: MatchingRolloutConfigRecord = {
        enabled: Boolean(params.enabled),
        defaultPercent: Math.max(0, Math.min(100, Math.floor(Number(params.defaultPercent)))),
        bairros: mergedBairros,
      };
      tx.set(
        ref,
        {
          features: {
            ...features,
            matching: {
              ...matching,
              rollout: config,
            },
          },
          updatedBy: params.actor,
          updatedAtMs: Date.now(),
          source: "admin_set_rollout",
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return config;
    });
    await auditsCol(scopedTenantId).add({
      kind: "rollout_config_update",
      actor: params.actor,
      payload: {
        enabled: next.enabled,
        defaultPercent: next.defaultPercent,
        bairrosUpdated: Object.keys(params.bairrosPatch ?? {}),
      },
      createdAtMs: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
    });
    return next;
  },

  async getDevModeAllowedWaIds(tenantId: string): Promise<string[]> {
    const scopedTenantId = assertTenantId(tenantId);
    const snap = await tenantConfigDoc(scopedTenantId).get();
    const raw = (snap.data() ?? {}) as Record<string, unknown>;
    const features =
      raw.features && typeof raw.features === "object" && !Array.isArray(raw.features)
        ? (raw.features as Record<string, unknown>)
        : {};
    const devMode =
      features.devMode && typeof features.devMode === "object" && !Array.isArray(features.devMode)
        ? (features.devMode as Record<string, unknown>)
        : {};
    const list = Array.isArray(devMode.allowedWaIds) ? devMode.allowedWaIds : [];
    return list
      .map((item) => normalizeWhatsAppId(String(item ?? "")))
      .filter((item) => item.length >= 10);
  },

  async getDevModeAuthState(params: { tenantId: string; waId: string }): Promise<DevModeAuthStateRecord | null> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const doc = await devModeAuthCol(scopedTenantId).doc(normalizeWhatsAppId(params.waId)).get();
    if (!doc.exists) return null;
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    return {
      failedAttempts: Math.max(0, Number(data.failedAttempts ?? 0)),
      lockUntilMs: parseNullableNumber(data.lockUntilMs),
      lastFailureAtMs: parseNullableNumber(data.lastFailureAtMs),
      lastSuccessAtMs: parseNullableNumber(data.lastSuccessAtMs),
      updatedAtMs: Math.max(0, Number(data.updatedAtMs ?? 0)),
    };
  },

  async setDevModeAuthState(params: {
    tenantId: string;
    waId: string;
    failedAttempts: number;
    lockUntilMs: number | null;
    success?: boolean;
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const nowMs = Date.now();
    const waId = normalizeWhatsAppId(params.waId);
    await devModeAuthCol(scopedTenantId).doc(waId).set(
      {
        tenantId: scopedTenantId,
        waId,
        failedAttempts: Math.max(0, Math.floor(params.failedAttempts)),
        lockUntilMs: params.lockUntilMs ?? null,
        lastFailureAtMs: params.success ? FieldValue.delete() : nowMs,
        lastSuccessAtMs: params.success ? nowMs : FieldValue.delete(),
        updatedAtMs: nowMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  },

  async appendDevModeAuditEvent(params: {
    tenantId: string;
    waId: string;
    event: string;
    result: "ok" | "denied" | "failed";
    reason?: string;
    command?: string;
    requestId?: string | null;
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await auditsCol(scopedTenantId).add({
      kind: "dev_mode_event",
      event: params.event,
      result: params.result,
      reason: params.reason ?? null,
      command: params.command ?? null,
      requestId: params.requestId ?? null,
      waId: normalizeWhatsAppId(params.waId),
      createdAtMs: Date.now(),
      createdAt: FieldValue.serverTimestamp(),
    });
  },

  async getDevModeAuditView(params: { tenantId: string; limit?: number; nowMs?: number }): Promise<{
    locks: Array<Record<string, unknown>>;
    recentEvents: Array<Record<string, unknown>>;
  }> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const limit = Math.max(1, Math.min(100, params.limit ?? 20));
    const nowMs = Number(params.nowMs ?? Date.now());
    const [locksSnap, auditsSnap] = await Promise.all([
      devModeAuthCol(scopedTenantId).where("lockUntilMs", ">", nowMs).orderBy("lockUntilMs", "desc").limit(limit).get(),
      auditsCol(scopedTenantId).orderBy("createdAt", "desc").limit(Math.max(limit * 3, 60)).get(),
    ]);
    const locks = locksSnap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        waId: data.waId ?? doc.id,
        failedAttempts: Number(data.failedAttempts ?? 0),
        lockUntilMs: parseNullableNumber(data.lockUntilMs),
        updatedAtMs: parseNullableNumber(data.updatedAtMs),
      };
    });
    const recentEvents = auditsSnap.docs
      .map((doc): Record<string, unknown> => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
      .filter((item) => String(item.kind ?? "") === "dev_mode_event")
      .slice(0, limit);
    return { locks, recentEvents };
  },

  async findDepositoById(params: {
    tenantId: string;
    depositoId: string;
  }): Promise<DepositoRecord | null> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const ref = depositosCol(scopedTenantId).doc(String(params.depositoId ?? "").trim());
    const snap = await ref.get();
    if (!snap.exists) return null;
    return mapDeposito(snap.data(), snap.id);
  },

  async getDevTenantStatus(params: { tenantId: string }): Promise<{
    tenantId: string;
    depositosOpen: number;
    depositosTotal: number;
    ordersActive: number;
    preCadastrosPending: number;
  }> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const [openSnap, allSnap, ordersActiveSnap, preCadastroPendingSnap] = await Promise.all([
      depositosCol(scopedTenantId).where("aberto", "==", true).limit(2000).get(),
      depositosCol(scopedTenantId).limit(2000).get(),
      ordersCol(scopedTenantId)
        .where("status", "in", ["CREATED", "ROUTED", "NOTIFIED", "ACCEPTED"])
        .limit(2000)
        .get(),
      preCadastrosCol(scopedTenantId)
        .where("status", "in", ["pending_confirmation", "collecting_details", "awaiting_location", "failed_delivery"])
        .limit(2000)
        .get(),
    ]);
    return {
      tenantId: scopedTenantId,
      depositosOpen: openSnap.size,
      depositosTotal: allSnap.size,
      ordersActive: ordersActiveSnap.size,
      preCadastrosPending: preCadastroPendingSnap.size,
    };
  },

  async devCreateDeposito(params: {
    tenantId: string;
    cnpj: string;
    nome: string;
    wa: string;
    bairro: string;
    cidade: string;
    actorWaId: string;
  }): Promise<{ depositoId: string; created: boolean }> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const wa = normalizeWhatsAppId(params.wa);
    const cnpj = String(params.cnpj ?? "").replace(/[^\d]/g, "");
    const bairroNorm = normalizeBairro(params.bairro);
    const depositoId = sanitizeDocId(`dep_${cnpj || wa}`);
    const ref = depositosCol(scopedTenantId).doc(depositoId);
    const existing = await ref.get();
    const created = !existing.exists;
    await ref.set(
      {
        tenantId: scopedTenantId,
        waId: wa,
        cnpj,
        nomeDeposito: sanitizeSnippet(params.nome, 120),
        bairro: sanitizeSnippet(params.bairro, 120),
        bairroNorm,
        cidade: sanitizeSnippet(params.cidade, 120),
        aberto: false,
        status: "FECHADO",
        routeEligible: true,
        createdAt: existing.exists ? (existing.data()?.createdAt ?? FieldValue.serverTimestamp()) : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await auditsCol(scopedTenantId).add({
      actor: `wa:${params.actorWaId}`,
      action: "dev_create_deposito",
      payload: {
        depositoId,
        cnpj,
        wa,
        bairroNorm,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    return { depositoId, created };
  },

  async createPreCadastro(input: PreCadastroCreateInput): Promise<{ id: string }> {
    const tenantId = assertTenantId(input.tenantId);
    const cleanWa = normalizeWhatsAppId(input.whatsapp);
    const bairroNorm = normalizeBairro(input.bairro);
    const nowMs = Date.now();
    const doc = await preCadastrosCol(tenantId).add({
      tenantId,
      nomeDeposito: sanitizeSnippet(input.nomeDeposito, 120),
      responsavel: sanitizeSnippet(input.responsavel, 120),
      whatsapp: cleanWa,
      bairro: sanitizeSnippet(input.bairro, 120),
      bairroNorm,
      cidade: input.cidade ? sanitizeSnippet(input.cidade, 120) : null,
      cnpj: input.cnpj ? sanitizeSnippet(input.cnpj, 40) : null,
      whatsappDdd: input.whatsappDdd,
      regionStatus: input.regionStatus,
      status: input.status,
      confirmationStatus: input.confirmationStatus,
      confirmationStep: input.confirmationStep,
      confirmationData: {},
      source: input.source ?? "site_form",
      ...(input.tokenHash ? { tokenHash: input.tokenHash } : {}),
      stepTimestamps: {
        [input.confirmationStep]: nowMs,
      },
      lastInteractionAtMs: nowMs,
      templateDispatch: {
        status: "pending",
        attempts: 0,
        sentAtMs: null,
        lastAttemptAtMs: null,
        lastError: null,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    });

    if (input.regionStatus === "supported") {
      await depositosCol(tenantId).doc(doc.id).set(
        {
          tenantId,
          waId: cleanWa || null,
          nomeDeposito: sanitizeSnippet(input.nomeDeposito, 120),
          bairro: sanitizeSnippet(input.bairro, 120),
          bairroNorm,
          aberto: false,
          ...(input.tokenHash ? { tokenHash: input.tokenHash } : {}),
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    return { id: doc.id };
  },

  /**
   * Busca um deposito pelo tokenHash gerado pelo site no pre-cadastro.
   * Utilizado pelo site para autenticar o deposito sem depender de JSON local.
   */
  async findDepositoByTokenHash(params: {
    tenantId: string;
    tokenHash: string;
  }): Promise<{ depositoId: string } | null> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const cleanHash = String(params.tokenHash ?? "").trim();
    if (!cleanHash) return null;

    const snap = await depositosCol(scopedTenantId)
      .where("tokenHash", "==", cleanHash)
      .limit(1)
      .get();

    if (snap.empty) return null;
    return { depositoId: snap.docs[0].id };
  },

  async acquireProcessingLock(params: {
    tenantId: string;
    waId: string;
    messageId: string;
    ttlMs: number;
  }): Promise<"acquired" | "blocked"> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const waId = normalizeWhatsAppId(params.waId);
    const ref = usersCol(scopedTenantId).doc(userDocId(scopedTenantId, waId));
    const now = Date.now();
    let result: "acquired" | "blocked" = "acquired";

    await ref.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const lock = snap.exists
        ? (snap.data() as { processingLock?: { messageId: string; expiresAt: number } | null }).processingLock
        : null;

      if (lock && lock.messageId !== params.messageId && lock.expiresAt > now) {
        result = "blocked";
        return;
      }

      tx.set(
        ref,
        { processingLock: { messageId: params.messageId, expiresAt: now + params.ttlMs } },
        { merge: true },
      );
    });

    return result;
  },

  async releaseProcessingLock(params: {
    tenantId: string;
    waId: string;
    messageId: string;
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    const waId = normalizeWhatsAppId(params.waId);
    const ref = usersCol(scopedTenantId).doc(userDocId(scopedTenantId, waId));

    try {
      await ref.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const lock = (snap.data() as { processingLock?: { messageId: string } | null }).processingLock;
        // Só libera se ainda é o nosso lock (evita liberação cruzada)
        if (lock?.messageId !== params.messageId) return;
        tx.set(ref, { processingLock: FieldValue.delete() }, { merge: true });
      });
    } catch {
      // Fail silently — o TTL cuida do cleanup se necessário
    }
  },

  async saveIndicacao(params: {
    tenantId: string;
    waId: string;
    bairro: string;
    bairroNorm: string;
    nomeDeposito: string | null;
    telefoneDeposito: string | null;
  }): Promise<void> {
    const scopedTenantId = assertTenantId(params.tenantId);
    await indicacoesCol(scopedTenantId).add({
      waId: params.waId,
      bairro: params.bairro,
      bairroNorm: params.bairroNorm,
      nomeDeposito: params.nomeDeposito,
      telefoneDeposito: params.telefoneDeposito,
      createdAt: FieldValue.serverTimestamp(),
      status: "pendente",
    });
  },
};
