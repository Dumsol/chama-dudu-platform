import { describe, expect, it } from "vitest";
import { parseWebhookEnvelope } from "../src/domain/whatsapp/parser";
import { createTenantResolver } from "../src/domain/whatsapp/tenantResolver";
import { claimMessageProcessing } from "../src/domain/whatsapp/idempotency";
import { handleInboundBusinessFlow, type FlowMessenger, type FlowRepository } from "../src/domain/whatsapp/stateMachine";
import { normalizeBairro } from "../src/domain/whatsapp/normalize";
import type { ActiveOrderRecord, DepositoRecord, IntentName, MatchingSnapshot, UserRecord } from "../src/domain/whatsapp/types";
import { MATCHING_POLICY_VERSION, MATCHING_SNAPSHOT_VERSION, buildDataFingerprint, buildPolicyHash, selectDepositoWeightedRoundRobin } from "../src/domain/whatsapp/orderMatching";
import type { PreCadastroRecord } from "../src/domain/precadastro/types";

class MemoryIdempotencyStore {
  private readonly set = new Set<string>();

  async createProcessedMessage(messageId: string): Promise<boolean> {
    if (this.set.has(messageId)) return false;
    this.set.add(messageId);
    return true;
  }
}

type OutboundMessage = { waId: string; body: string; kind: "text" | "menu" };

class MemoryFlow implements FlowRepository {
  public users = new Map<string, UserRecord>();
  public depositos = new Map<string, DepositoRecord>();
  public orders = new Map<string, ActiveOrderRecord & { depositoId: string; tenantId: string }>();
  public matchingSnapshots = new Map<string, MatchingSnapshot>();
  public rrPointers = new Map<string, number>();
  public preCadastros = new Map<string, PreCadastroRecord>();
  public sent: OutboundMessage[] = [];
  public devAllowedByTenant = new Map<string, string[]>();
  public devAuthStateByKey = new Map<
    string,
    { failedAttempts: number; lockUntilMs: number | null; lastFailureAtMs: number | null; lastSuccessAtMs: number | null; updatedAtMs: number }
  >();
  public devAuditEvents: Array<Record<string, unknown>> = [];
  public rolloutConfigByTenant = new Map<
    string,
    {
      enabled: boolean;
      defaultPercent: number;
      bairros?: Record<string, { enabled?: boolean; percent?: number }>;
    } | null
  >();
  private orderSeq = 0;

  private userKey(tenantId: string, waId: string): string {
    return `${tenantId}:${waId}`;
  }

  private depositoKey(tenantId: string, waId: string): string {
    return `${tenantId}:${waId}`;
  }

  private orderMapKey(tenantId: string, orderId: string): string {
    return `${tenantId}:${orderId}`;
  }

  private snapshotKey(tenantId: string, orderId: string, attemptNo: number): string {
    return `${tenantId}:${orderId}:${attemptNo}`;
  }

  private devAuthKey(tenantId: string, waId: string): string {
    return `${tenantId}:${waId}`;
  }

  async getUserByTenantWaId(tenantId: string, waId: string): Promise<UserRecord | null> {
    return this.users.get(this.userKey(tenantId, waId)) ?? null;
  }

  async upsertUser(params: {
    tenantId: string;
    waId: string;
    name?: string | null;
    type: "cliente" | "deposito";
    bairro?: string | null;
    bairroNorm?: string | null;
    botState?: UserRecord["botState"];
    botStateExpiresAtMs?: number | null;
    pendingBotState?: UserRecord["pendingBotState"] | null;
    stateHint?: string | null;
    lastIntent?: IntentName;
    lastIntentConfidence?: number;
    lastMessageTextNorm?: string;
    pendingSlot?: UserRecord["pendingSlot"];
    slotRetryCount?: number | null;
    fallbackCount?: number | null;
    lastBotMessage?: string | null;
    slots?: UserRecord["slots"] | null;
    currentFlow?: UserRecord["currentFlow"];
    currentStep?: string | null;
  }): Promise<UserRecord> {
    const key = this.userKey(params.tenantId, params.waId);
    const current = this.users.get(key);
    const next: UserRecord = {
      userId: key,
      tenantId: params.tenantId,
      waId: params.waId,
      type: params.type,
      bairro: params.bairro ?? current?.bairro,
      bairroNorm: params.bairroNorm ?? current?.bairroNorm,
      name: params.name ?? current?.name,
      botState: params.botState ?? current?.botState ?? "idle",
      botStateExpiresAtMs: params.botStateExpiresAtMs ?? current?.botStateExpiresAtMs,
      pendingBotState: params.pendingBotState ?? current?.pendingBotState,
      stateHint: params.stateHint ?? current?.stateHint,
      lastIntent: params.lastIntent ?? current?.lastIntent,
      lastIntentConfidence: params.lastIntentConfidence ?? current?.lastIntentConfidence,
      lastMessageTextNorm: params.lastMessageTextNorm ?? current?.lastMessageTextNorm,
      pendingSlot: params.pendingSlot === undefined ? current?.pendingSlot : params.pendingSlot,
      slotRetryCount: params.slotRetryCount === undefined ? current?.slotRetryCount : params.slotRetryCount,
      fallbackCount: params.fallbackCount === undefined ? current?.fallbackCount : params.fallbackCount,
      lastBotMessage: params.lastBotMessage === undefined ? current?.lastBotMessage ?? null : params.lastBotMessage,
      slots: params.slots === undefined ? current?.slots ?? null : params.slots,
      currentFlow: params.currentFlow === undefined ? current?.currentFlow ?? null : params.currentFlow,
      currentStep: params.currentStep === undefined ? current?.currentStep ?? null : params.currentStep,
    };
    this.users.set(key, next);
    return next;
  }

  async findDepositoByTenantWaId(tenantId: string, waId: string): Promise<DepositoRecord | null> {
    return this.depositos.get(this.depositoKey(tenantId, waId)) ?? null;
  }

  async ensureDepositoForWaId(params: { tenantId: string; waId: string }): Promise<DepositoRecord> {
    const key = this.depositoKey(params.tenantId, params.waId);
    const current = this.depositos.get(key);
    if (current) return current;
    const created: DepositoRecord = {
      depositoId: key,
      tenantId: params.tenantId,
      waId: params.waId,
      aberto: false,
    };
    this.depositos.set(key, created);
    return created;
  }

  async findDepositoById(params: { tenantId: string; depositoId: string }): Promise<DepositoRecord | null> {
    return (
      [...this.depositos.values()].find(
        (item) => item.tenantId === params.tenantId && item.depositoId === params.depositoId,
      ) ?? null
    );
  }

  async fetchMatchingRolloutConfig(tenantId: string): Promise<{
    enabled: boolean;
    defaultPercent: number;
    bairros?: Record<string, { enabled?: boolean; percent?: number }>;
  } | null> {
    return this.rolloutConfigByTenant.get(tenantId) ?? null;
  }

  async updateDepositoBairro(params: {
    tenantId: string;
    depositoId: string;
    bairro: string;
    bairroNorm: string;
  }): Promise<void> {
    for (const [key, deposito] of this.depositos.entries()) {
      if (deposito.depositoId === params.depositoId && key.startsWith(`${params.tenantId}:`)) {
        this.depositos.set(key, {
          ...deposito,
          bairro: params.bairro,
          bairroNorm: params.bairroNorm,
        });
      }
    }
  }

  async updateDepositoStatus(params: {
    tenantId: string;
    depositoId: string;
    aberto: boolean;
  }): Promise<void> {
    for (const [key, deposito] of this.depositos.entries()) {
      if (deposito.depositoId === params.depositoId && key.startsWith(`${params.tenantId}:`)) {
        this.depositos.set(key, {
          ...deposito,
          aberto: params.aberto,
        });
      }
    }
  }

  async setDepositoPause(params: {
    tenantId: string;
    depositoId: string;
    minutes: number;
    reason?: string;
  }): Promise<number> {
    const pausedUntilMs = Date.now() + params.minutes * 60 * 1000;
    for (const [key, deposito] of this.depositos.entries()) {
      if (deposito.depositoId === params.depositoId && key.startsWith(`${params.tenantId}:`)) {
        this.depositos.set(key, {
          ...deposito,
          aberto: true,
          pausedUntilMs,
          pauseReason: params.reason ?? null,
        });
      }
    }
    return pausedUntilMs;
  }

  async getDevTenantStatus(params: { tenantId: string }): Promise<{
    tenantId: string;
    depositosOpen: number;
    depositosTotal: number;
    ordersActive: number;
    preCadastrosPending: number;
  }> {
    const depositos = [...this.depositos.values()].filter((item) => item.tenantId === params.tenantId);
    const orders = [...this.orders.values()].filter((item) => item.tenantId === params.tenantId);
    const preCadastros = [...this.preCadastros.values()].filter((item) => item.tenantId === params.tenantId);
    return {
      tenantId: params.tenantId,
      depositosOpen: depositos.filter((item) => item.aberto).length,
      depositosTotal: depositos.length,
      ordersActive: orders.filter((item) => ["CREATED", "ROUTED", "NOTIFIED", "ACCEPTED"].includes(item.status)).length,
      preCadastrosPending: preCadastros.filter((item) =>
        ["pending_confirmation", "collecting_details", "awaiting_location", "failed_delivery"].includes(item.status),
      ).length,
    };
  }

  async getDevModeAllowedWaIds(tenantId: string): Promise<string[]> {
    return this.devAllowedByTenant.get(tenantId) ?? [];
  }

  async getDevModeAuthState(params: {
    tenantId: string;
    waId: string;
  }): Promise<{
    failedAttempts: number;
    lockUntilMs: number | null;
    lastFailureAtMs: number | null;
    lastSuccessAtMs: number | null;
    updatedAtMs: number;
  } | null> {
    return this.devAuthStateByKey.get(this.devAuthKey(params.tenantId, params.waId)) ?? null;
  }

  async setDevModeAuthState(params: {
    tenantId: string;
    waId: string;
    failedAttempts: number;
    lockUntilMs: number | null;
    success?: boolean;
  }): Promise<void> {
    const prev = this.devAuthStateByKey.get(this.devAuthKey(params.tenantId, params.waId));
    this.devAuthStateByKey.set(this.devAuthKey(params.tenantId, params.waId), {
      failedAttempts: params.failedAttempts,
      lockUntilMs: params.lockUntilMs,
      lastFailureAtMs: params.success ? prev?.lastFailureAtMs ?? null : Date.now(),
      lastSuccessAtMs: params.success ? Date.now() : prev?.lastSuccessAtMs ?? null,
      updatedAtMs: Date.now(),
    });
  }

  async appendDevModeAuditEvent(params: {
    tenantId: string;
    waId: string;
    event: string;
    result: "ok" | "denied" | "failed";
    reason?: string;
    command?: string;
    requestId?: string | null;
  }): Promise<void> {
    this.devAuditEvents.push({
      ...params,
      atMs: Date.now(),
    });
  }

  async devCreateDeposito(params: {
    tenantId: string;
    cnpj: string;
    nome: string;
    wa: string;
    bairro: string;
    cidade: string;
    actorWaId: string;
  }): Promise<{ depositoId: string; created: boolean }> {
    const depositoId = `dep_${params.cnpj}`;
    const exists = [...this.depositos.values()].some(
      (item) => item.tenantId === params.tenantId && item.depositoId === depositoId,
    );
    const next: DepositoRecord = {
      depositoId,
      tenantId: params.tenantId,
      waId: params.wa,
      nomeDeposito: params.nome,
      bairro: params.bairro,
      bairroNorm: normalizeBairro(params.bairro),
      aberto: false,
    };
    this.depositos.set(this.depositoKey(params.tenantId, params.wa), next);
    return { depositoId, created: !exists };
  }

  async getActiveOrderForDeposito(params: {
    tenantId: string;
    depositoId: string;
  }): Promise<ActiveOrderRecord | null> {
    return (
      [...this.orders.values()].find(
        (item) =>
          item.tenantId === params.tenantId &&
          item.depositoId === params.depositoId &&
          ["ROUTED", "NOTIFIED", "ACCEPTED"].includes(item.status),
      ) ?? null
    );
  }

  async getActiveOrderForUser(params: { tenantId: string; userId: string }): Promise<ActiveOrderRecord | null> {
    return (
      [...this.orders.values()].find(
        (item) =>
          item.tenantId === params.tenantId &&
          item.userId === params.userId &&
          ["CREATED", "ROUTED", "NOTIFIED", "ACCEPTED"].includes(item.status),
      ) ?? null
    );
  }

  async getOrderById(params: { tenantId: string; orderId: string }): Promise<ActiveOrderRecord | null> {
    return this.orders.get(this.orderMapKey(params.tenantId, params.orderId)) ?? null;
  }

  async createOrderForUser(params: {
    tenantId: string;
    userId: string;
    phoneNumberId: string;
    bairro?: string | null;
    itensDescricao?: string | null;
    canal?: "DELIVERY" | "RETIRADA" | "CONSULTA" | null;
  }): Promise<ActiveOrderRecord> {
    this.orderSeq += 1;
    const orderId = `ord-${this.orderSeq.toString().padStart(4, "0")}`;
    const created: ActiveOrderRecord & { tenantId: string; depositoId: string } = {
      id: orderId,
      tenantId: params.tenantId,
      depositoId: "",
      userId: params.userId,
      status: "CREATED",
      fulfillmentStatus: "NONE",
      bairro: params.bairro ?? null,
      itensDescricao: params.itensDescricao ?? null,
      canal: params.canal ?? "DELIVERY",
      tentativasDepositos: [],
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
    this.orders.set(this.orderMapKey(params.tenantId, orderId), created);
    return created;
  }

  async updateOrderForFlow(params: {
    tenantId: string;
    orderId: string;
    status?: "CREATED" | "ROUTED" | "NOTIFIED" | "TIMEOUT" | "CANCELED";
    extraFields?: Record<string, unknown>;
  }): Promise<void> {
    const key = this.orderMapKey(params.tenantId, params.orderId);
    const current = this.orders.get(key);
    if (!current) return;
    const patch = (params.extraFields ?? {}) as Record<string, unknown>;
    const matchingPatch =
      patch.matching && typeof patch.matching === "object" && !Array.isArray(patch.matching)
        ? (patch.matching as Record<string, unknown>)
        : null;
    const next: ActiveOrderRecord & { tenantId: string; depositoId: string } = {
      ...current,
      status: params.status ?? current.status,
      bairro: patch.bairro ? String(patch.bairro) : current.bairro ?? null,
      itensDescricao: patch.itensDescricao ? String(patch.itensDescricao) : current.itensDescricao ?? null,
      canal: patch.canal ? (String(patch.canal).toUpperCase() as ActiveOrderRecord["canal"]) : current.canal ?? null,
      depositoId: patch.depositoId ? String(patch.depositoId) : current.depositoId,
      tentativasDepositos: Array.isArray(patch.tentativasDepositos)
        ? patch.tentativasDepositos.map((item) => String(item))
        : current.tentativasDepositos ?? [],
      matching: matchingPatch
        ? {
            ...(current.matching ?? {}),
            ...matchingPatch,
          }
        : current.matching ?? null,
    };
    this.orders.set(key, next);
  }

  async buildMatchingSnapshot(params: {
    tenantId: string;
    orderId: string;
    attemptNo: number;
    inputContext: {
      bairro: string;
      bairroNorm: string;
      canal: "DELIVERY" | "RETIRADA" | "CONSULTA";
      intent: IntentName;
      userBotState: NonNullable<UserRecord["botState"]>;
    };
    excludeDepositoIds?: string[];
  }): Promise<MatchingSnapshot> {
    const existing = this.matchingSnapshots.get(this.snapshotKey(params.tenantId, params.orderId, params.attemptNo));
    if (existing) return existing;
    const excludedByAttempt = new Set((params.excludeDepositoIds ?? []).map((id) => String(id)));
    const allByCoverage = [...this.depositos.values()].filter(
      (item) => item.tenantId === params.tenantId && item.bairroNorm === params.inputContext.bairroNorm,
    );

    const excludedCandidates: MatchingSnapshot["excludedCandidates"] = [];
    const eligibleCandidates: MatchingSnapshot["eligibleCandidates"] = [];
    for (const deposito of allByCoverage) {
      const reasons: string[] = [];
      if (excludedByAttempt.has(deposito.depositoId)) reasons.push("already_attempted");
      if (!deposito.aberto) reasons.push("closed_now");
      if ((deposito.pausedUntilMs ?? 0) > Date.now()) reasons.push("paused_now");
      if (!deposito.waId) reasons.push("missing_wa");
      const custom = deposito as unknown as Record<string, unknown>;
      const deliveryOn = custom.deliveryDisponivel === undefined ? true : Boolean(custom.deliveryDisponivel);
      const retiradaOn = custom.retiradaDisponivel === undefined ? true : Boolean(custom.retiradaDisponivel);
      if (params.inputContext.canal === "DELIVERY" && !deliveryOn) reasons.push("canal_not_supported");
      if (params.inputContext.canal === "RETIRADA" && !retiradaOn) reasons.push("canal_not_supported");

      if (reasons.length > 0) {
        excludedCandidates.push({
          depositoId: deposito.depositoId,
          nome: deposito.nomeDeposito ?? deposito.depositoId,
          reasons,
        });
        continue;
      }
      const quality = Number(custom.qualityScore ?? 0.8);
      const priority = Number(custom.commercialPriority ?? custom.priority ?? 3);
      const score = Math.round((quality * 3 + priority) * 100) / 100;
      const weight = Math.max(1, Math.min(8, Math.round(score)));
      eligibleCandidates.push({
        depositoId: deposito.depositoId,
        nome: deposito.nomeDeposito ?? deposito.depositoId,
        waId: deposito.waId ?? "",
        bairro: deposito.bairro ?? params.inputContext.bairro,
        bairroNorm: deposito.bairroNorm ?? params.inputContext.bairroNorm,
        score,
        weight,
        reasons: [],
      });
    }

    eligibleCandidates.sort((a, b) => b.score - a.score || b.weight - a.weight || a.depositoId.localeCompare(b.depositoId));

    const rrKey = `${params.tenantId}:${params.inputContext.bairroNorm}:${params.inputContext.canal}`;
    const rrPointerBefore = this.rrPointers.get(rrKey) ?? -1;
    const rr = selectDepositoWeightedRoundRobin({
      candidates: eligibleCandidates,
      pointerBefore: rrPointerBefore,
    });
    this.rrPointers.set(rrKey, rr.pointerAfter);

    const policyHash = buildPolicyHash({
      policyVersion: MATCHING_POLICY_VERSION,
      tenantId: params.tenantId,
      bairroNorm: params.inputContext.bairroNorm,
      canal: params.inputContext.canal,
      policy: "wrr_default",
    });
    const fingerprint = buildDataFingerprint({
      eligible: eligibleCandidates.map((item) => ({
        depositoId: item.depositoId,
        score: item.score,
        weight: item.weight,
      })),
      excluded: excludedCandidates.map((item) => ({ depositoId: item.depositoId, reasons: item.reasons })),
      rrPointerBefore,
      rrPointerAfter: rr.pointerAfter,
      selectedDepositoId: rr.selectedDepositoId,
    });

    const snapshot: MatchingSnapshot = {
      attemptNo: params.attemptNo,
      snapshotVersion: MATCHING_SNAPSHOT_VERSION,
      policyVersion: MATCHING_POLICY_VERSION,
      policyHash,
      inputContext: params.inputContext,
      eligibleCandidates,
      excludedCandidates,
      rrPointerBefore,
      rrPointerAfter: rr.pointerAfter,
      selectedDepositoId: rr.selectedDepositoId,
      selectionReason: rr.selectedDepositoId ? "weighted_round_robin" : "no_eligible_candidates",
      selectionScore: eligibleCandidates.find((item) => item.depositoId === rr.selectedDepositoId)?.score ?? null,
      generatedAtMs: Date.now(),
      depositsDataFingerprint: fingerprint,
    };
    this.matchingSnapshots.set(this.snapshotKey(params.tenantId, params.orderId, params.attemptNo), snapshot);
    const key = this.orderMapKey(params.tenantId, params.orderId);
    const order = this.orders.get(key);
    if (order) {
      this.orders.set(key, {
        ...order,
        matching: {
          ...(order.matching ?? {}),
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
        },
      });
    }
    return snapshot;
  }

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
    const orderKey = this.orderMapKey(params.tenantId, params.orderId);
    const order = this.orders.get(orderKey);
    const snapshot = this.matchingSnapshots.get(this.snapshotKey(params.tenantId, params.orderId, params.attemptNo));
    if (!order || !snapshot) {
      return { ok: false, forwardResult: "failed", forwardFailureReason: "missing_order_or_snapshot" };
    }
    if (snapshot.snapshotVersion !== params.snapshotVersion || snapshot.policyVersion !== params.policyVersion) {
      return { ok: false, forwardResult: "diverged", forwardFailureReason: "version_mismatch" };
    }
    if (snapshot.policyHash !== params.policyHash) {
      return { ok: false, forwardResult: "diverged", forwardFailureReason: "policy_hash_mismatch" };
    }
    if (snapshot.depositsDataFingerprint !== params.expectedFingerprint) {
      return { ok: false, forwardResult: "diverged", forwardFailureReason: "fingerprint_mismatch" };
    }
    if (snapshot.selectedDepositoId !== params.selectedDepositoId) {
      return { ok: false, forwardResult: "diverged", forwardFailureReason: "selected_mismatch" };
    }

    if (
      order.matching?.forwardResult === "forwarded" &&
      order.matching?.attemptNo === params.attemptNo &&
      order.depositoId === params.selectedDepositoId
    ) {
      return { ok: true, forwardResult: "skipped" };
    }

    const selected = [...this.depositos.values()].find(
      (item) => item.tenantId === params.tenantId && item.depositoId === params.selectedDepositoId,
    );
    if (!selected || !selected.waId || !selected.aberto) {
      this.orders.set(orderKey, {
        ...order,
        matching: {
          ...(order.matching ?? {}),
          forwardResult: "failed",
          forwardFailureReason: "selected_not_available",
        },
      });
      return { ok: false, forwardResult: "failed", forwardFailureReason: "selected_not_available" };
    }

    this.orders.set(orderKey, {
      ...order,
      status: "NOTIFIED",
      depositoId: selected.depositoId,
      tentativasDepositos: [...new Set([...(order.tentativasDepositos ?? []), selected.depositoId])],
      matching: {
        ...(order.matching ?? {}),
        attemptNo: params.attemptNo,
        selectedDepositoId: selected.depositoId,
        forwardResult: "forwarded",
        forwardFailureReason: null,
      },
    });
    return {
      ok: true,
      forwardResult: "forwarded",
      selectedDepositoName: selected.nomeDeposito ?? selected.depositoId,
    };
  }

  async acceptOrder(params: { tenantId: string; orderId: string }): Promise<void> {
    for (const [key, order] of this.orders.entries()) {
      if (order.tenantId === params.tenantId && order.id === params.orderId) {
        this.orders.set(key, { ...order, status: "ACCEPTED" });
      }
    }
  }

  async declineOrder(params: { tenantId: string; orderId: string; reason: string }): Promise<void> {
    for (const [key, order] of this.orders.entries()) {
      if (order.tenantId === params.tenantId && order.id === params.orderId) {
        this.orders.set(key, { ...order, status: "DECLINED", itensDescricao: params.reason });
      }
    }
  }

  async setOrderPreparing(params: { tenantId: string; orderId: string }): Promise<void> {
    for (const [key, order] of this.orders.entries()) {
      if (order.tenantId === params.tenantId && order.id === params.orderId) {
        this.orders.set(key, { ...order, fulfillmentStatus: "SEPARANDO" });
      }
    }
  }

  async setOrderEta(params: { tenantId: string; orderId: string; etaMin: number; sourceText: string }): Promise<void> {
    for (const [key, order] of this.orders.entries()) {
      if (order.tenantId === params.tenantId && order.id === params.orderId) {
        this.orders.set(key, { ...order, etaMin: params.etaMin, itensDescricao: params.sourceText });
      }
    }
  }

  async setOrderOutForDelivery(params: { tenantId: string; orderId: string }): Promise<void> {
    for (const [key, order] of this.orders.entries()) {
      if (order.tenantId === params.tenantId && order.id === params.orderId) {
        this.orders.set(key, { ...order, fulfillmentStatus: "A_CAMINHO" });
      }
    }
  }

  async setOrderDelivered(params: { tenantId: string; orderId: string }): Promise<void> {
    for (const [key, order] of this.orders.entries()) {
      if (order.tenantId === params.tenantId && order.id === params.orderId) {
        this.orders.set(key, { ...order, fulfillmentStatus: "ENTREGUE_DEPOSITO", status: "DONE" });
      }
    }
  }

  async listOpenDepositosByBairro(params: { tenantId: string; bairroNorm: string }): Promise<DepositoRecord[]> {
    return [...this.depositos.values()].filter(
      (item) => item.tenantId === params.tenantId && item.aberto && item.bairroNorm === params.bairroNorm,
    );
  }

  async findLatestPendingPreCadastroByWhatsApp(tenantId: string, waId: string): Promise<PreCadastroRecord | null> {
    return (
      [...this.preCadastros.values()]
        .filter((item) => item.tenantId === tenantId && item.whatsapp === waId)
        .find((item) => item.confirmationStatus !== "confirmed" && item.status !== "unsupported_region") ?? null
    );
  }

  async updatePreCadastroConfirmation(params: {
    tenantId: string;
    preCadastroId: string;
    status?: PreCadastroRecord["status"];
    confirmationStatus?: PreCadastroRecord["confirmationStatus"];
    confirmationStep?: PreCadastroRecord["confirmationStep"];
    confirmationDataPatch?: Partial<NonNullable<PreCadastroRecord["confirmationData"]>>;
  }): Promise<void> {
    const current = this.preCadastros.get(params.preCadastroId);
    if (!current || current.tenantId !== params.tenantId) return;
    this.preCadastros.set(params.preCadastroId, {
      ...current,
      status: params.status ?? current.status,
      confirmationStatus: params.confirmationStatus ?? current.confirmationStatus,
      confirmationStep: params.confirmationStep ?? current.confirmationStep,
      confirmationData: {
        ...(current.confirmationData ?? {}),
        ...(params.confirmationDataPatch ?? {}),
      },
    });
  }
}

function createMessenger(repo: MemoryFlow): FlowMessenger {
  return {
    async sendText(params): Promise<void> {
      repo.sent.push({ waId: params.waId, body: params.body, kind: "text" });
    },
    async sendClienteLocationRequest(params): Promise<void> {
      repo.sent.push({ waId: params.waId, body: params.body, kind: "location_request" });
    },
    async sendClienteButtons(params): Promise<void> {
      repo.sent.push({ waId: params.waId, body: params.body, kind: "buttons" });
    },
    async sendDepositoMenu(params): Promise<void> {
      repo.sent.push({ waId: params.waId, body: params.body, kind: "menu" });
    },
  };
}

describe("ops webhook parser", () => {
  it("parses text and interactive messages", () => {
    const parsed = parseWebhookEnvelope({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123456" },
                contacts: [{ wa_id: "5511999998888", profile: { name: "Leo" } }],
                messages: [
                  {
                    id: "wamid-text-1",
                    from: "5511999998888",
                    type: "text",
                    text: { body: "Oi" },
                  },
                  {
                    id: "wamid-btn-1",
                    from: "5511999998888",
                    type: "interactive",
                    interactive: { button_reply: { id: "abrir", title: "Abrir" } },
                  },
                  {
                    id: "wamid-loc-1",
                    from: "5511999998888",
                    type: "location",
                    location: { latitude: -8.05, longitude: -34.92, address: "Rua A", name: "Deposito A" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[0].text).toBe("Oi");
    expect(parsed.messages[0].sourceKind).toBe("text");
    expect(parsed.messages[1].interactiveId).toBe("abrir");
    expect(parsed.messages[1].sourceKind).toBe("interactive");
    expect(parsed.messages[2].sourceKind).toBe("location");
    expect(parsed.messages[2].location?.latitude).toBe(-8.05);
  });

  it("creates deterministic fallback id when message has no id", () => {
    const parsed = parseWebhookEnvelope({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "123456" },
                messages: [
                  {
                    from: "5511988877665",
                    type: "text",
                    timestamp: "1700000010",
                    text: { body: "quero suporte" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(parsed.messages[0]?.messageId.startsWith("generated_")).toBe(true);
  });
});

describe("tenant resolver cache", () => {
  it("caches by phoneNumberId with ttl", async () => {
    let now = 0;
    let calls = 0;
    const resolver = createTenantResolver({
      now: () => now,
      ttlMs: 1000,
      fetchTenantIdByPhoneNumberId: async (phoneNumberId) => {
        calls += 1;
        return phoneNumberId === "123" ? "tenant-a" : null;
      },
    });

    await expect(resolver.resolveTenantId("123")).resolves.toBe("tenant-a");
    await expect(resolver.resolveTenantId("123")).resolves.toBe("tenant-a");
    now = 2000;
    await expect(resolver.resolveTenantId("123")).resolves.toBe("tenant-a");
    expect(calls).toBe(2);
  });
});

describe("idempotency", () => {
  it("blocks duplicate processing per tenant", async () => {
    const store = new MemoryIdempotencyStore();
    await expect(
      claimMessageProcessing(store, { messageId: "wamid-1", tenantId: "t1", waId: "5511" }),
    ).resolves.toBe("claimed");
    await expect(
      claimMessageProcessing(store, { messageId: "wamid-1", tenantId: "t1", waId: "5511" }),
    ).resolves.toBe("duplicate");
    await expect(
      claimMessageProcessing(store, { messageId: "wamid-1", tenantId: "t2", waId: "5511" }),
    ).resolves.toBe("claimed");
  });
});

describe("deposito flow", () => {
  it("captures bairro and opens status with command variations", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.depositos.set("tenant-x:5511911112222", {
      depositoId: "dep-1",
      tenantId: "tenant-x",
      waId: "5511911112222",
      aberto: false,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "m1",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "abre",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });
    expect(repo.sent.at(-1)?.body).toContain("bairro");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "m2",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "bairro centro",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });
    expect(repo.depositos.get("tenant-x:5511911112222")?.bairroNorm).toBe("centro");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "m3",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "pode abrir",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });

    expect(repo.depositos.get("tenant-x:5511911112222")?.aberto).toBe(true);
  });

  it("runs pedido lifecycle from notified to delivered", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.depositos.set("tenant-x:5511911112222", {
      depositoId: "dep-1",
      tenantId: "tenant-x",
      waId: "5511911112222",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });
    repo.orders.set("tenant-x:o-1", {
      id: "o-1",
      tenantId: "tenant-x",
      depositoId: "dep-1",
      status: "NOTIFIED",
      fulfillmentStatus: "NONE",
      bairro: "Centro",
      etaMin: null,
      itensDescricao: null,
      userId: "u-1",
      valorTotalPedido: null,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "pm1",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "aceitar",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });
    expect(repo.orders.get("tenant-x:o-1")?.status).toBe("ACCEPTED");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "pm2",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "eta 25",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });
    expect(repo.orders.get("tenant-x:o-1")?.etaMin).toBe(25);

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "pm3",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "separando",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });
    expect(repo.orders.get("tenant-x:o-1")?.fulfillmentStatus).toBe("SEPARANDO");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "pm4",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "saiu",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });
    expect(repo.orders.get("tenant-x:o-1")?.fulfillmentStatus).toBe("A_CAMINHO");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "pm5",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "entregue",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });
    expect(repo.orders.get("tenant-x:o-1")?.status).toBe("DONE");
  });

  it("asks for decline reason and applies pause window", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.depositos.set("tenant-x:5511911112222", {
      depositoId: "dep-1",
      tenantId: "tenant-x",
      waId: "5511911112222",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });
    repo.orders.set("tenant-x:o-2", {
      id: "o-2",
      tenantId: "tenant-x",
      depositoId: "dep-1",
      status: "NOTIFIED",
      fulfillmentStatus: "NONE",
      bairro: "Centro",
      etaMin: null,
      itensDescricao: null,
      userId: "u-2",
      valorTotalPedido: null,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "pr1",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "recusar",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });
    expect(repo.sent.at(-1)?.body).toContain("motivo");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "pr2",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "sem motoboy disponivel",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });
    expect(repo.orders.get("tenant-x:o-2")?.status).toBe("DECLINED");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "pr3",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "pausar 60",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });
    expect((repo.depositos.get("tenant-x:5511911112222")?.pausedUntilMs ?? 0) > Date.now()).toBe(true);
  });

  it("closes conversation socially for deposito without opening menu", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.depositos.set("tenant-x:5511911112222", {
      depositoId: "dep-1",
      tenantId: "tenant-x",
      waId: "5511911112222",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });
    repo.users.set("tenant-x:5511911112222", {
      userId: "tenant-x:5511911112222",
      tenantId: "tenant-x",
      waId: "5511911112222",
      type: "deposito",
      botState: "awaiting_deposito_eta",
      botStateExpiresAtMs: Date.now() + 60_000,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-x",
      message: {
        phoneNumberId: "111",
        messageId: "pr4",
        waId: "5511911112222",
        type: "text",
        timestamp: null,
        text: "valeu",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Depo",
        sourceKind: "text",
      },
    });

    expect(repo.sent.at(-1)?.body.toLowerCase()).toMatch(/arretado|chama|area|parceiro/);
    expect(repo.sent.at(-1)?.body.toLowerCase()).not.toContain("menu");
  });
});

describe("cliente flow", () => {
  it("asks bairro and then lists open depositos", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.depositos.set("tenant-y:5511988887777", {
      depositoId: "dep-2",
      tenantId: "tenant-y",
      waId: "5511988887777",
      nomeDeposito: "Deposito Centro",
      bairro: "Boa Viagem",
      bairroNorm: normalizeBairro("Boa Viagem"),
      aberto: true,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-y",
      message: {
        phoneNumberId: "222",
        messageId: "m10",
        waId: "5511994443333",
        type: "text",
        timestamp: null,
        text: "oi",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });
    expect(repo.sent.at(-1)?.body).toContain("bairro");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-y",
      message: {
        phoneNumberId: "222",
        messageId: "m11",
        waId: "5511994443333",
        type: "text",
        timestamp: null,
        text: "bairro boa viagem",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });

    expect(repo.sent.at(-1)?.body).toContain("Achei");
    expect(repo.sent.at(-1)?.body).toContain("Deposito Centro");
  });

  it("interrupts flow when user changes subject indirectly", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);

    repo.users.set("tenant-z:5511994443333", {
      userId: "tenant-z:5511994443333",
      tenantId: "tenant-z",
      waId: "5511994443333",
      type: "cliente",
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      botStateExpiresAtMs: Date.now() + 60_000,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-z",
      message: {
        phoneNumberId: "222",
        messageId: "m12",
        waId: "5511994443333",
        type: "text",
        timestamp: null,
        text: "qual o horario?",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-z:5511994443333")?.botState).toBe("idle");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("horario");
  });

  it("cancels flow on explicit exit phrases", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);

    repo.users.set("tenant-z:5511994449999", {
      userId: "tenant-z:5511994449999",
      tenantId: "tenant-z",
      waId: "5511994449999",
      type: "cliente",
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      botStateExpiresAtMs: Date.now() + 60_000,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-z",
      message: {
        phoneNumberId: "222",
        messageId: "m13",
        waId: "5511994449999",
        type: "text",
        timestamp: null,
        text: "deixa isso",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-z:5511994449999")?.botState).toBe("idle");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toMatch(/parei|fluxo pausado|retomar/);
  });

  it("greets safely when user says oi during an active flow", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);

    repo.users.set("tenant-z:5511994441212", {
      userId: "tenant-z:5511994441212",
      tenantId: "tenant-z",
      waId: "5511994441212",
      type: "cliente",
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      botStateExpiresAtMs: Date.now() + 60_000,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-z",
      message: {
        phoneNumberId: "222",
        messageId: "m13b",
        waId: "5511994441212",
        type: "text",
        timestamp: null,
        text: "oi",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-z:5511994441212")?.botState).toBe("idle");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("bairro");
  });

  it("asks for disambiguation instead of forcing continuation on ambiguous mid-flow text", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);

    repo.users.set("tenant-z:5511994445656", {
      userId: "tenant-z:5511994445656",
      tenantId: "tenant-z",
      waId: "5511994445656",
      type: "cliente",
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      botStateExpiresAtMs: Date.now() + 60_000,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-z",
      message: {
        phoneNumberId: "222",
        messageId: "m13c",
        waId: "5511994445656",
        type: "text",
        timestamp: null,
        text: "qual?",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-z:5511994445656")?.botState).toBe("idle");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toMatch(/bairro/);
  });

  it("interrupts active flow to provide help or human fallback", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);

    repo.users.set("tenant-z:5511994447878", {
      userId: "tenant-z:5511994447878",
      tenantId: "tenant-z",
      waId: "5511994447878",
      type: "cliente",
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      botStateExpiresAtMs: Date.now() + 60_000,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-z",
      message: {
        phoneNumberId: "222",
        messageId: "m13d",
        waId: "5511994447878",
        type: "text",
        timestamp: null,
        text: "me ajuda",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("eu posso");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-z",
      message: {
        phoneNumberId: "222",
        messageId: "m13e",
        waId: "5511994447878",
        type: "text",
        timestamp: null,
        text: "quero falar com atendente",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-z:5511994447878")?.botState).toBe("idle");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("contigo");
  });

  it("uses ack_short with active context without executing wrong action", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);

    repo.users.set("tenant-z:5511994446767", {
      userId: "tenant-z:5511994446767",
      tenantId: "tenant-z",
      waId: "5511994446767",
      type: "cliente",
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      botStateExpiresAtMs: Date.now() + 60_000,
      lastIntent: "cliente_buscar_deposito",
      lastIntentConfidence: 0.9,
      lastMessageTextNorm: "tem deposito aberto",
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-z",
      message: {
        phoneNumberId: "222",
        messageId: "m13f",
        waId: "5511994446767",
        type: "text",
        timestamp: null,
        text: "fechou",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-z:5511994446767")?.botState).toBe("idle");
    expect(repo.users.get("tenant-z:5511994446767")?.pendingSlot).toBe("awaiting_neighborhood");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("bairro");
  });

  it("stores pendingSlot when asking for bairro and resolves Janga without forbidden fallback", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-slot",
      message: {
        phoneNumberId: "222",
        messageId: "slot-1",
        waId: "5581990001000",
        type: "text",
        timestamp: null,
        text: "quero fazer um pedido",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Slot",
        sourceKind: "text",
      },
    });

    const askedUser = repo.users.get("tenant-slot:5581990001000");
    expect(askedUser?.botState).toBe("idle");
    expect(askedUser?.pendingSlot).toBe("awaiting_neighborhood");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("bairro");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-slot",
      message: {
        phoneNumberId: "222",
        messageId: "slot-2",
        waId: "5581990001000",
        type: "text",
        timestamp: null,
        text: "Janga",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Slot",
        sourceKind: "text",
      },
    });

    const resolvedUser = repo.users.get("tenant-slot:5581990001000");
    expect(resolvedUser?.bairro).toBe("Janga");
    expect(resolvedUser?.pendingSlot).toBeNull();
    expect(repo.sent.at(-1)?.body).toContain("Janga");
    expect(repo.sent.at(-1)?.body.toLowerCase()).not.toContain("saquei certinho");
  });

  it("uses Gemini guide to recover a noisy bairro reply when deterministic match does not close", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    const geminiGuideDeps = {
      loadConfig: async () => ({
        enabled: true,
        percent: 100,
        replyAssistEnabled: false,
        allowedRoles: ["cliente"] as const,
      }),
      readApiKey: () => "gem-key",
      claimUsage: async (params: { reserveTokens: number }) => ({
        allowed: true,
        reason: "allowed",
        reservedTokens: params.reserveTokens,
      }),
      getCache: async () => null,
      setCache: async () => void 0,
      recordUsage: async () => void 0,
      audit: async () => void 0,
      callModel: async () => ({
        raw: JSON.stringify({
          mode: "guide_only",
          confidence: 0.9,
          safeToUse: true,
          nextSafeAction: "save_bairro",
          bairroCandidate: "Pau Amarelo",
          reason: "bairro_ruidoso",
        }),
        usageTokens: 70,
      }),
    };

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-gem-slot",
      geminiGuideDeps,
      message: {
        phoneNumberId: "222",
        messageId: "gem-slot-1",
        waId: "5581990004000",
        type: "text",
        timestamp: null,
        text: "quero fazer um pedido",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Gemini",
        sourceKind: "text",
      },
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-gem-slot",
      geminiGuideDeps,
      message: {
        phoneNumberId: "222",
        messageId: "gem-slot-2",
        waId: "5581990004000",
        type: "text",
        timestamp: null,
        text: "to por ali na orla, depois do sinal",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Gemini",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-gem-slot:5581990004000")?.bairro).toBe("Pau Amarelo");
    expect(repo.sent.at(-1)?.body).toContain("Pau Amarelo");
  });

  it("uses Gemini reply assist only for complex fallback and keeps it non-operational", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    const geminiGuideDeps = {
      loadConfig: async () => ({
        enabled: true,
        percent: 100,
        replyAssistEnabled: true,
        allowedRoles: ["cliente"] as const,
      }),
      readApiKey: () => "gem-key",
      claimUsage: async (params: { reserveTokens: number }) => ({
        allowed: true,
        reason: "allowed",
        reservedTokens: params.reserveTokens,
      }),
      getCache: async () => null,
      setCache: async () => void 0,
      recordUsage: async () => void 0,
      audit: async () => void 0,
      callModel: async () => ({
        raw: JSON.stringify({
          mode: "reply_assist",
          confidence: 0.88,
          safeToSend: true,
          replyPurpose: "clarify",
          replyText: "Fechou. Me manda teu bairro ou tua localizacao que eu te digo o melhor caminho agora.",
          reason: "complex_message",
        }),
        usageTokens: 80,
      }),
    };

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-gem-reply",
      geminiGuideDeps,
      message: {
        phoneNumberId: "222",
        messageId: "gem-reply-1",
        waId: "5581990005000",
        type: "text",
        timestamp: null,
        text: "eu queria ver um negocio mas na verdade nem sei direito como funciona isso ai tudo misturado com as parada",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Gemini Reply",
        sourceKind: "text",
      },
    });

    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("bairro");
    expect(repo.sent.at(-1)?.body.toLowerCase()).not.toContain("encaminhei");
  });

  it("handles social closing without forcing menu", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);

    repo.users.set("tenant-z:5511994443434", {
      userId: "tenant-z:5511994443434",
      tenantId: "tenant-z",
      waId: "5511994443434",
      type: "cliente",
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      botStateExpiresAtMs: Date.now() + 60_000,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-z",
      message: {
        phoneNumberId: "222",
        messageId: "m13g",
        waId: "5511994443434",
        type: "text",
        timestamp: null,
        text: "so isso valeu",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-z:5511994443434")?.botState).toBe("idle");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("depósito");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("bairro");
  });

  it("routes legacy gas and agua mentions to friendly fallback", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-z",
      message: {
        phoneNumberId: "222",
        messageId: "m13h",
        waId: "5511994445454",
        type: "text",
        timestamp: null,
        text: "quero gas e agua",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });

    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("contigo");
    expect(repo.sent.at(-1)?.body.toLowerCase()).not.toContain("pedir gas");
  });

  it("does not let expired state hijack a new greeting", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);

    repo.users.set("tenant-z:5511991231234", {
      userId: "tenant-z:5511991231234",
      tenantId: "tenant-z",
      waId: "5511991231234",
      type: "cliente",
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      botStateExpiresAtMs: Date.now() - 1000,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-z",
      message: {
        phoneNumberId: "222",
        messageId: "m14",
        waId: "5511991231234",
        type: "text",
        timestamp: null,
        text: "oi",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente",
        sourceKind: "text",
      },
    });

    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("bairro");
    expect(repo.users.get("tenant-z:5511991231234")?.botState).toBe("idle");
  });

  it("runs transactional order flow with matching snapshot and forward", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.rolloutConfigByTenant.set("tenant-match", {
      enabled: true,
      defaultPercent: 100,
    });
    repo.depositos.set("tenant-match:5581991111111", {
      depositoId: "dep-a",
      tenantId: "tenant-match",
      waId: "5581991111111",
      nomeDeposito: "Deposito A",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-match",
      message: {
        phoneNumberId: "333",
        messageId: "mc1",
        waId: "5581992222333",
        type: "text",
        timestamp: null,
        text: "bairro centro",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Match",
        sourceKind: "text",
      },
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-match",
      message: {
        phoneNumberId: "333",
        messageId: "mc2",
        waId: "5581992222333",
        type: "text",
        timestamp: null,
        text: "quero pedir",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Match",
        sourceKind: "text",
      },
    });
    expect(repo.users.get("tenant-match:5581992222333")?.botState).toBe("awaiting_order_details");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-match",
      message: {
        phoneNumberId: "333",
        messageId: "mc3",
        waId: "5581992222333",
        type: "text",
        timestamp: null,
        text: "quero 2 packs para hoje a noite",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Match",
        sourceKind: "text",
      },
    });

    const order = [...repo.orders.values()].find((item) => item.tenantId === "tenant-match");
    expect(order).toBeTruthy();
    expect(order?.matching?.attemptNo).toBe(1);
    expect(order?.matching?.snapshotVersion).toBe(MATCHING_SNAPSHOT_VERSION);
    expect(order?.matching?.policyVersion).toBe(MATCHING_POLICY_VERSION);
    const snapshot = repo.matchingSnapshots.get(`tenant-match:${order?.id}:1`);
    expect(snapshot?.selectedDepositoId).toBe("dep-a");
    expect(snapshot?.rrPointerBefore).toBe(-1);
    expect(snapshot?.rrPointerAfter).toBeGreaterThanOrEqual(0);
    expect(repo.users.get("tenant-match:5581992222333")?.botState).toBe("awaiting_checkout");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-match",
      message: {
        phoneNumberId: "333",
        messageId: "mc3-summary-ok",
        waId: "5581992222333",
        type: "text",
        timestamp: null,
        text: "sim",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Match",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-match:5581992222333")?.botState).toBe("awaiting_confirmation");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-match",
      message: {
        phoneNumberId: "333",
        messageId: "mc4",
        waId: "5581992222333",
        type: "text",
        timestamp: null,
        text: "sim",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Match",
        sourceKind: "text",
      },
    });

    const updatedOrder = [...repo.orders.values()].find((item) => item.tenantId === "tenant-match");
    expect(updatedOrder?.status).toBe("NOTIFIED");
    expect(updatedOrder?.matching?.forwardResult).toBe("forwarded");
    expect(repo.users.get("tenant-match:5581992222333")?.botState).toBe("awaiting_deposit_response");
  });

  it("falls back safely when there is no coverage for matching", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.rolloutConfigByTenant.set("tenant-no-cover", {
      enabled: true,
      defaultPercent: 100,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-no-cover",
      message: {
        phoneNumberId: "444",
        messageId: "nc1",
        waId: "5581999991111",
        type: "text",
        timestamp: null,
        text: "bairro centro",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente NC",
        sourceKind: "text",
      },
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-no-cover",
      message: {
        phoneNumberId: "444",
        messageId: "nc2",
        waId: "5581999991111",
        type: "text",
        timestamp: null,
        text: "quero pedir",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente NC",
        sourceKind: "text",
      },
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-no-cover",
      message: {
        phoneNumberId: "444",
        messageId: "nc3",
        waId: "5581999991111",
        type: "text",
        timestamp: null,
        text: "quero combo premium",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente NC",
        sourceKind: "text",
      },
    });

    // Novo comportamento: sem cobertura → resumo → confirmação → convida a indicar depósito
    expect(repo.users.get("tenant-no-cover:5581999991111")?.botState).toBe("awaiting_checkout");
    
    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-no-cover",
      message: {
        phoneNumberId: "444",
        messageId: "nc3-summary-ok",
        waId: "5581999991111",
        type: "text",
        timestamp: null,
        text: "sim",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente NC",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-no-cover:5581999991111")?.botState).toBe("awaiting_indicacao");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toMatch(/deposito|dep[oó]sito|dep|bairro/);
  });

  it("persists weighted round robin progression across snapshot attempts", async () => {
    const repo = new MemoryFlow();
    repo.depositos.set("tenant-rr:5581991110001", {
      depositoId: "dep-rr-1",
      tenantId: "tenant-rr",
      waId: "5581991110001",
      nomeDeposito: "RR 1",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });
    repo.depositos.set("tenant-rr:5581991110002", {
      depositoId: "dep-rr-2",
      tenantId: "tenant-rr",
      waId: "5581991110002",
      nomeDeposito: "RR 2",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });
    await repo.createOrderForUser({
      tenantId: "tenant-rr",
      userId: "u-1",
      phoneNumberId: "555",
      bairro: "Centro",
      canal: "DELIVERY",
      itensDescricao: "pedido teste 1",
    });
    const order = [...repo.orders.values()].find((item) => item.tenantId === "tenant-rr");
    expect(order).toBeTruthy();

    const attempt1 = await repo.buildMatchingSnapshot({
      tenantId: "tenant-rr",
      orderId: order!.id,
      attemptNo: 1,
      inputContext: {
        bairro: "Centro",
        bairroNorm: "centro",
        canal: "DELIVERY",
        intent: "cliente_iniciar_pedido",
        userBotState: "awaiting_order_details",
      },
    });
    const attempt2 = await repo.buildMatchingSnapshot({
      tenantId: "tenant-rr",
      orderId: order!.id,
      attemptNo: 2,
      inputContext: {
        bairro: "Centro",
        bairroNorm: "centro",
        canal: "DELIVERY",
        intent: "cliente_iniciar_pedido",
        userBotState: "awaiting_order_details",
      },
    });

    expect(attempt1.policyHash).toBe(attempt2.policyHash);
    expect(attempt2.rrPointerBefore).toBe(attempt1.rrPointerAfter);
    expect(attempt1.selectedDepositoId).toBeTruthy();
    expect(attempt2.selectedDepositoId).toBeTruthy();
    expect(repo.matchingSnapshots.get(`tenant-rr:${order!.id}:1`)).toBeTruthy();
    expect(repo.matchingSnapshots.get(`tenant-rr:${order!.id}:2`)).toBeTruthy();
  });

  it("applies rollout hold by tenant+bairro and returns open list fallback", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.rolloutConfigByTenant.set("tenant-roll", {
      enabled: true,
      defaultPercent: 0,
      bairros: {
        centro: { enabled: true, percent: 0 },
      },
    });
    repo.depositos.set("tenant-roll:5581993000001", {
      depositoId: "dep-roll-1",
      tenantId: "tenant-roll",
      waId: "5581993000001",
      nomeDeposito: "Roll Centro",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });
    await repo.upsertUser({
      tenantId: "tenant-roll",
      waId: "5581999000000",
      type: "cliente",
      bairro: "Centro",
      bairroNorm: "centro",
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-roll",
      message: {
        phoneNumberId: "600",
        messageId: "roll-1",
        waId: "5581999000000",
        type: "text",
        timestamp: null,
        text: "quero pedir",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Roll",
        sourceKind: "text",
      },
    });
    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-roll",
      message: {
        phoneNumberId: "600",
        messageId: "roll-2",
        waId: "5581999000000",
        type: "text",
        timestamp: null,
        text: "combo de teste entrega",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Roll",
        sourceKind: "text",
      },
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-roll",
      message: {
        phoneNumberId: "600",
        messageId: "roll-summary-ok",
        waId: "5581999000000",
        type: "text",
        timestamp: null,
        text: "sim",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Roll",
        sourceKind: "text",
      },
    });

    const bodies = repo.sent.slice(-2).map((item) => item.body.toLowerCase());
    expect(bodies[0]).toContain("liberacao gradual");
    expect(bodies[1]).toContain("achei 1");
    expect(repo.users.get("tenant-roll:5581999000000")?.botState).toBe("idle");
  });

  it("keeps matching disabled by default when tenant rollout config is missing", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.depositos.set("tenant-roll-default:5581993000001", {
      depositoId: "dep-roll-default-1",
      tenantId: "tenant-roll-default",
      waId: "5581993000001",
      nomeDeposito: "Roll Default Centro",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });
    await repo.upsertUser({
      tenantId: "tenant-roll-default",
      waId: "5581999001000",
      type: "cliente",
      bairro: "Centro",
      bairroNorm: "centro",
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-roll-default",
      message: {
        phoneNumberId: "600",
        messageId: "roll-default-1",
        waId: "5581999001000",
        type: "text",
        timestamp: null,
        text: "quero pedir",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Roll Default",
        sourceKind: "text",
      },
    });
    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-roll-default",
      message: {
        phoneNumberId: "600",
        messageId: "roll-default-2",
        waId: "5581999001000",
        type: "text",
        timestamp: null,
        text: "combo de teste entrega",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Roll Default",
        sourceKind: "text",
      },
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-roll-default",
      message: {
        phoneNumberId: "600",
        messageId: "roll-default-summary-ok",
        waId: "5581999001000",
        type: "text",
        timestamp: null,
        text: "sim",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente Roll Default",
        sourceKind: "text",
      },
    });

    const bodies = repo.sent.slice(-2).map((item) => item.body.toLowerCase());
    expect(bodies[0]).toContain("liberacao gradual");
    expect(bodies[1]).toContain("achei 1");
    expect(repo.users.get("tenant-roll-default:5581999001000")?.botState).toBe("idle");
  });

  it("auto-reroutes after declined while awaiting deposito response", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.rolloutConfigByTenant.set("tenant-reroute", {
      enabled: true,
      defaultPercent: 100,
    });
    repo.depositos.set("tenant-reroute:5581991000001", {
      depositoId: "dep-r-1",
      tenantId: "tenant-reroute",
      waId: "5581991000001",
      nomeDeposito: "Dep R1",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });
    repo.depositos.set("tenant-reroute:5581991000002", {
      depositoId: "dep-r-2",
      tenantId: "tenant-reroute",
      waId: "5581991000002",
      nomeDeposito: "Dep R2",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });
    await repo.upsertUser({
      tenantId: "tenant-reroute",
      waId: "5581999555000",
      type: "cliente",
      bairro: "Centro",
      bairroNorm: "centro",
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-reroute",
      message: {
        phoneNumberId: "601",
        messageId: "rr-1",
        waId: "5581999555000",
        type: "text",
        timestamp: null,
        text: "quero pedir",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente RR",
        sourceKind: "text",
      },
    });
    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-reroute",
      message: {
        phoneNumberId: "601",
        messageId: "rr-2",
        waId: "5581999555000",
        type: "text",
        timestamp: null,
        text: "pedido combo entrega",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente RR",
        sourceKind: "text",
      },
    });
    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-reroute",
      message: {
        phoneNumberId: "601",
        messageId: "rr-3-summary-ok",
        waId: "5581999555000",
        type: "text",
        timestamp: null,
        text: "sim",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente RR",
        sourceKind: "text",
      },
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-reroute",
      message: {
        phoneNumberId: "601",
        messageId: "rr-3",
        waId: "5581999555000",
        type: "text",
        timestamp: null,
        text: "sim",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente RR",
        sourceKind: "text",
      },
    });

    const order = [...repo.orders.values()].find((item) => item.tenantId === "tenant-reroute");
    expect(order).toBeTruthy();
    const latestOrder = repo.orders.get(`tenant-reroute:${order!.id}`);
    repo.orders.set(`tenant-reroute:${order!.id}`, {
      ...latestOrder!,
      status: "DECLINED",
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-reroute",
      message: {
        phoneNumberId: "601",
        messageId: "rr-4",
        waId: "5581999555000",
        type: "text",
        timestamp: null,
        text: "e agora?",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Cliente RR",
        sourceKind: "text",
      },
    });

    const updated = repo.orders.get(`tenant-reroute:${order!.id}`);
    expect(updated?.matching?.attemptNo).toBe(2);
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("ja encaminhei");
    expect(repo.users.get("tenant-reroute:5581999555000")?.botState).toBe("awaiting_deposit_response");
  });

  it("sends deposito FAQ on help route", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.depositos.set("tenant-faq:5581888000001", {
      depositoId: "dep-faq-1",
      tenantId: "tenant-faq",
      waId: "5581888000001",
      nomeDeposito: "Dep FAQ",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: true,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-faq",
      message: {
        phoneNumberId: "602",
        messageId: "faq-1",
        waId: "5581888000001",
        type: "text",
        timestamp: null,
        text: "ajuda",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Dep FAQ",
        sourceKind: "text",
      },
    });

    const sentText = repo.sent.map((item) => item.body.toLowerCase()).join("\n");
    expect(sentText).toContain("boas praticas");
    expect(sentText).toContain("abrir, fechar e status");
    expect(repo.sent.at(-1)?.kind).toBe("menu");
  });

  it("authenticates dev mode and executes safe command", async () => {
    const previousCurrent = process.env.DEV_TOKEN_CURRENT;
    const previousLegacy = process.env.DEV_TOKEN;
    process.env.DEV_TOKEN_CURRENT = "token-123";
    process.env.DEV_TOKEN = "";

    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.depositos.set("tenant-dev:5581997777001", {
      depositoId: "dep-dev-1",
      tenantId: "tenant-dev",
      waId: "5581997777001",
      nomeDeposito: "Dep Dev",
      bairro: "Centro",
      bairroNorm: "centro",
      aberto: false,
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-dev",
      message: {
        phoneNumberId: "603",
        messageId: "dev-1",
        waId: "5581997777001",
        type: "text",
        timestamp: null,
        text: "Dev mode",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Dev User",
        sourceKind: "text",
      },
    });
    expect(repo.users.get("tenant-dev:5581997777001")?.botState).toBe("awaiting_dev_password");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-dev",
      message: {
        phoneNumberId: "603",
        messageId: "dev-2",
        waId: "5581997777001",
        type: "text",
        timestamp: null,
        text: "token-123",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Dev User",
        sourceKind: "text",
      },
    });
    expect(repo.users.get("tenant-dev:5581997777001")?.botState).toBe("dev_mode");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-dev",
      message: {
        phoneNumberId: "603",
        messageId: "dev-3",
        waId: "5581997777001",
        type: "text",
        timestamp: null,
        text: "dev tenant status",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Dev User",
        sourceKind: "text",
      },
    });
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("depositos abertos");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-dev",
      message: {
        phoneNumberId: "603",
        messageId: "dev-4",
        waId: "5581997777001",
        type: "text",
        timestamp: null,
        text: "dev sair",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Dev User",
        sourceKind: "text",
      },
    });
    expect(repo.users.get("tenant-dev:5581997777001")?.botState).toBe("idle");

    process.env.DEV_TOKEN_CURRENT = previousCurrent;
    process.env.DEV_TOKEN = previousLegacy;
  });

  it("ignores allowlist and authenticates with token only", async () => {
    const previousCurrent = process.env.DEV_TOKEN_CURRENT;
    process.env.DEV_TOKEN_CURRENT = "token-123";

    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.devAllowedByTenant.set("tenant-dev-lock", ["5581997777009"]);

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-dev-lock",
      message: {
        phoneNumberId: "604",
        messageId: "dev-lock-1",
        waId: "5581997777001",
        type: "text",
        timestamp: null,
        text: "Dev mode",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Operator",
        sourceKind: "text",
      },
    });
    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-dev-lock",
      message: {
        phoneNumberId: "604",
        messageId: "dev-lock-2",
        waId: "5581997777001",
        type: "text",
        timestamp: null,
        text: "token-123",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Operator",
        sourceKind: "text",
      },
    });

    expect(repo.users.get("tenant-dev-lock:5581997777001")?.botState).toBe("dev_mode");
    process.env.DEV_TOKEN_CURRENT = previousCurrent;
  });

  it("accepts previous token while within rotation window", async () => {
    const prevCurrent = process.env.DEV_TOKEN_CURRENT;
    const prevPrevious = process.env.DEV_TOKEN_PREVIOUS;
    const prevWindow = process.env.DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS;
    process.env.DEV_TOKEN_CURRENT = "token-new";
    process.env.DEV_TOKEN_PREVIOUS = "token-old";
    process.env.DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS = String(Date.now() + 60_000);

    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.devAllowedByTenant.set("tenant-dev-prev", ["5581997777011"]);

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-dev-prev",
      message: {
        phoneNumberId: "605",
        messageId: "dev-prev-1",
        waId: "5581997777011",
        type: "text",
        timestamp: null,
        text: "Dev mode",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Dev User",
        sourceKind: "text",
      },
    });
    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-dev-prev",
      message: {
        phoneNumberId: "605",
        messageId: "dev-prev-2",
        waId: "5581997777011",
        type: "text",
        timestamp: null,
        text: "token-old",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Dev User",
        sourceKind: "text",
      },
    });
    expect(repo.users.get("tenant-dev-prev:5581997777011")?.botState).toBe("dev_mode");

    process.env.DEV_TOKEN_CURRENT = prevCurrent;
    process.env.DEV_TOKEN_PREVIOUS = prevPrevious;
    process.env.DEV_TOKEN_PREVIOUS_VALID_UNTIL_MS = prevWindow;
  });
});

describe("pre-cadastro confirmation flow", () => {
  it("collects bairros, mode, horario and official location until confirmation", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.preCadastros.set("pc-1", {
      id: "pc-1",
      tenantId: "tenant-pc",
      whatsapp: "5581991112222",
      status: "pending_confirmation",
      regionStatus: "supported",
      confirmationStatus: "pending",
      confirmationStep: "awaiting_identity_confirmation",
      confirmationData: {},
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-pc",
      message: {
        phoneNumberId: "333",
        messageId: "pc-1",
        waId: "5581991112222",
        type: "text",
        timestamp: null,
        text: "sim",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Deposito PC",
        sourceKind: "text",
      },
    });
    expect(repo.preCadastros.get("pc-1")?.confirmationStep).toBe("awaiting_bairros");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-pc",
      message: {
        phoneNumberId: "333",
        messageId: "pc-2",
        waId: "5581991112222",
        type: "text",
        timestamp: null,
        text: "Centro, Janga",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Deposito PC",
        sourceKind: "text",
      },
    });
    expect(repo.preCadastros.get("pc-1")?.confirmationData?.bairrosAtendidos).toEqual(["centro", "janga"]);

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-pc",
      message: {
        phoneNumberId: "333",
        messageId: "pc-3",
        waId: "5581991112222",
        type: "text",
        timestamp: null,
        text: "retirada e entrega",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Deposito PC",
        sourceKind: "text",
      },
    });
    expect(repo.preCadastros.get("pc-1")?.confirmationData?.atendimentoMode).toBe("ambos");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-pc",
      message: {
        phoneNumberId: "333",
        messageId: "pc-4",
        waId: "5581991112222",
        type: "text",
        timestamp: null,
        text: "segunda a sabado, 7h as 20h",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Deposito PC",
        sourceKind: "text",
      },
    });
    expect(repo.preCadastros.get("pc-1")?.confirmationStep).toBe("awaiting_location");
    expect(repo.preCadastros.get("pc-1")?.status).toBe("awaiting_location");

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-pc",
      message: {
        phoneNumberId: "333",
        messageId: "pc-5",
        waId: "5581991112222",
        type: "location",
        timestamp: null,
        text: null,
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Deposito PC",
        sourceKind: "location",
        location: {
          latitude: -8.0522,
          longitude: -34.9286,
          address: "Rua do Centro, 100",
          name: "Deposito Centro",
        },
      },
    });

    const updated = repo.preCadastros.get("pc-1");
    expect(updated?.status).toBe("confirmed");
    expect(updated?.confirmationStatus).toBe("confirmed");
    expect(updated?.confirmationStep).toBe("completed");
    expect(updated?.confirmationData?.officialLocation?.latitude).toBe(-8.0522);
  });

  it("marks manual review on inconsistent confirmation step", async () => {
    const repo = new MemoryFlow();
    const messenger = createMessenger(repo);
    repo.preCadastros.set("pc-2", {
      id: "pc-2",
      tenantId: "tenant-pc",
      whatsapp: "5581991113333",
      status: "collecting_details",
      regionStatus: "supported",
      confirmationStatus: "in_progress",
      confirmationStep: "completed",
      confirmationData: {},
    });

    await handleInboundBusinessFlow({
      repo,
      messenger,
      tenantId: "tenant-pc",
      message: {
        phoneNumberId: "333",
        messageId: "pc-6",
        waId: "5581991113333",
        type: "text",
        timestamp: null,
        text: "oi",
        interactiveId: null,
        interactiveTitle: null,
        profileName: "Deposito PC",
        sourceKind: "text",
      },
    });

    const updated = repo.preCadastros.get("pc-2");
    expect(updated?.status).toBe("manual_review");
    expect(repo.sent.at(-1)?.body.toLowerCase()).toContain("revisao manual");
  });
});
