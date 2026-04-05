import crypto from "crypto";
import type { MatchingCandidate, MatchingExcludedCandidate } from "./types";

export const MATCHING_SNAPSHOT_VERSION = "matching_snapshot_v1";
export const MATCHING_POLICY_VERSION = "matching_policy_v1";

const CONTEXT_PREFIX = "order_ctx:";

export type PedidoCanalFlow = "DELIVERY" | "RETIRADA" | "CONSULTA";

export interface OrderFlowContext {
  orderId: string;
  attemptNo: number;
  selectedDepositoId: string | null;
  snapshotVersion: string;
  policyVersion: string;
  policyHash: string;
  depositsDataFingerprint: string;
  canal: PedidoCanalFlow;
}

export interface MatchingDepositoInput {
  depositoId: string;
  nome: string;
  waId: string | null;
  bairro: string;
  bairroNorm: string;
  aberto: boolean;
  status: string | null;
  routeEligible: boolean;
  pausedUntilMs: number | null;
  blocked: boolean;
  canalDeliveryDisponivel: boolean;
  canalRetiradaDisponivel: boolean;
  commercialPriority: number;
  qualityScore: number;
  financeHealthScore: number;
  acceptRate: number;
  responseAvgMinutes: number | null;
  recentAvailabilityScore: number;
}

export interface MatchingPolicyConfig {
  commercialPriorityWeight: number;
  qualityWeight: number;
  financeWeight: number;
  acceptanceWeight: number;
  responseWeight: number;
  availabilityWeight: number;
}

export const DEFAULT_MATCHING_POLICY: MatchingPolicyConfig = {
  commercialPriorityWeight: 1.25,
  qualityWeight: 2.3,
  financeWeight: 1.5,
  acceptanceWeight: 1.8,
  responseWeight: 1.1,
  availabilityWeight: 1.2,
};

export function inferPedidoCanalFromText(rawText: string): PedidoCanalFlow {
  const compact = String(rawText ?? "").toLowerCase();
  if (/\b(retirada|retirar|buscar no local)\b/.test(compact)) return "RETIRADA";
  if (/\b(consulta|saber|cotar)\b/.test(compact)) return "CONSULTA";
  return "DELIVERY";
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function toRound2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeCandidateScore(params: {
  deposito: MatchingDepositoInput;
  policy: MatchingPolicyConfig;
}): { score: number; weight: number; reasons: string[] } {
  const { deposito, policy } = params;
  const reasons: string[] = [];
  const commercial = Math.max(0, Math.min(5, deposito.commercialPriority));
  const quality = clamp01(deposito.qualityScore);
  const finance = clamp01(deposito.financeHealthScore);
  const acceptRate = clamp01(deposito.acceptRate);
  const availability = clamp01(deposito.recentAvailabilityScore);
  const responseSpeed = deposito.responseAvgMinutes == null
    ? 0.5
    : clamp01((45 - Math.max(0, deposito.responseAvgMinutes)) / 45);

  const score =
    commercial * policy.commercialPriorityWeight +
    quality * policy.qualityWeight +
    finance * policy.financeWeight +
    acceptRate * policy.acceptanceWeight +
    responseSpeed * policy.responseWeight +
    availability * policy.availabilityWeight;

  if (commercial >= 4) reasons.push("commercial_priority_high");
  if (quality >= 0.8) reasons.push("quality_high");
  if (finance >= 0.9) reasons.push("finance_ok");
  if (acceptRate >= 0.8) reasons.push("accept_rate_high");
  if (responseSpeed >= 0.7) reasons.push("response_fast");
  if (availability >= 0.8) reasons.push("availability_recent");

  const weight = Math.max(1, Math.min(8, Math.round(score)));
  return {
    score: toRound2(score),
    weight,
    reasons,
  };
}

function isCanalEligible(params: {
  deposito: MatchingDepositoInput;
  canal: PedidoCanalFlow;
}): boolean {
  if (params.canal === "RETIRADA") return params.deposito.canalRetiradaDisponivel;
  if (params.canal === "DELIVERY") return params.deposito.canalDeliveryDisponivel;
  return true;
}

export function resolveEligibleDepositos(params: {
  depositos: MatchingDepositoInput[];
  canal: PedidoCanalFlow;
  excludeDepositoIds?: string[];
  nowMs?: number;
  policy?: MatchingPolicyConfig;
}): {
  eligible: MatchingCandidate[];
  excluded: MatchingExcludedCandidate[];
} {
  const nowMs = Number(params.nowMs ?? Date.now());
  const exclude = new Set((params.excludeDepositoIds ?? []).map((item) => String(item)));
  const policy = params.policy ?? DEFAULT_MATCHING_POLICY;
  const eligible: MatchingCandidate[] = [];
  const excluded: MatchingExcludedCandidate[] = [];

  for (const deposito of params.depositos) {
    const reasons: string[] = [];
    if (exclude.has(deposito.depositoId)) reasons.push("already_attempted");
    if (!deposito.waId) reasons.push("missing_wa");
    if (!deposito.aberto || String(deposito.status ?? "").toUpperCase() === "FECHADO") reasons.push("closed_now");
    if (!deposito.routeEligible) reasons.push("route_ineligible");
    if (deposito.blocked) reasons.push("blocked");
    if (deposito.pausedUntilMs && deposito.pausedUntilMs > nowMs) reasons.push("paused_now");
    if (!isCanalEligible({ deposito, canal: params.canal })) reasons.push("canal_not_supported");

    if (reasons.length > 0) {
      excluded.push({
        depositoId: deposito.depositoId,
        nome: deposito.nome,
        reasons,
      });
      continue;
    }

    const score = computeCandidateScore({ deposito, policy });
    eligible.push({
      depositoId: deposito.depositoId,
      nome: deposito.nome,
      waId: deposito.waId ?? "",
      bairro: deposito.bairro,
      bairroNorm: deposito.bairroNorm,
      score: score.score,
      weight: score.weight,
      reasons: score.reasons,
    });
  }

  eligible.sort((a, b) => b.score - a.score || b.weight - a.weight || a.depositoId.localeCompare(b.depositoId));
  excluded.sort((a, b) => a.depositoId.localeCompare(b.depositoId));
  return { eligible, excluded };
}

export function selectDepositoWeightedRoundRobin(params: {
  candidates: MatchingCandidate[];
  pointerBefore: number;
}): {
  selectedDepositoId: string | null;
  pointerAfter: number;
} {
  if (!params.candidates.length) {
    return {
      selectedDepositoId: null,
      pointerAfter: -1,
    };
  }

  const ring: string[] = [];
  for (const candidate of params.candidates) {
    const weight = Math.max(1, Math.min(12, Math.floor(candidate.weight)));
    for (let index = 0; index < weight; index += 1) {
      ring.push(candidate.depositoId);
    }
  }
  if (!ring.length) {
    return {
      selectedDepositoId: params.candidates[0]?.depositoId ?? null,
      pointerAfter: 0,
    };
  }

  const base = Number.isFinite(params.pointerBefore) ? Math.floor(params.pointerBefore) : -1;
  const pointerAfter = (base + 1 + ring.length) % ring.length;
  return {
    selectedDepositoId: ring[pointerAfter] ?? null,
    pointerAfter,
  };
}

export function buildPolicyHash(seed: Record<string, unknown>): string {
  const normalized = JSON.stringify(seed, Object.keys(seed).sort());
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 24);
}

export function buildDataFingerprint(seed: unknown): string {
  return crypto.createHash("sha1").update(JSON.stringify(seed)).digest("hex").slice(0, 24);
}

export function serializeOrderFlowContext(context: OrderFlowContext): string {
  return `${CONTEXT_PREFIX}${Buffer.from(JSON.stringify(context), "utf8").toString("base64url")}`;
}

export function parseOrderFlowContext(stateHint: string | null | undefined): OrderFlowContext | null {
  const raw = String(stateHint ?? "").trim();
  if (!raw.startsWith(CONTEXT_PREFIX)) return null;
  try {
    const encoded = raw.slice(CONTEXT_PREFIX.length);
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<OrderFlowContext>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.orderId || typeof parsed.orderId !== "string") return null;
    const attemptNo = Number(parsed.attemptNo);
    if (!Number.isFinite(attemptNo) || attemptNo < 0) return null;
    const selectedDepositoId = parsed.selectedDepositoId ? String(parsed.selectedDepositoId) : null;
    const snapshotVersion = String(parsed.snapshotVersion ?? MATCHING_SNAPSHOT_VERSION);
    const policyVersion = String(parsed.policyVersion ?? MATCHING_POLICY_VERSION);
    const policyHash = String(parsed.policyHash ?? "");
    const depositsDataFingerprint = String(parsed.depositsDataFingerprint ?? "");
    const canalRaw = String(parsed.canal ?? "DELIVERY").toUpperCase();
    const canal: PedidoCanalFlow =
      canalRaw === "RETIRADA" ? "RETIRADA" : canalRaw === "CONSULTA" ? "CONSULTA" : "DELIVERY";
    return {
      orderId: parsed.orderId,
      attemptNo,
      selectedDepositoId,
      snapshotVersion,
      policyVersion,
      policyHash,
      depositsDataFingerprint,
      canal,
    };
  } catch {
    return null;
  }
}
