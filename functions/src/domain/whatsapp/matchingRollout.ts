import crypto from "crypto";

export interface MatchingRolloutConfig {
  enabled: boolean;
  defaultPercent: number;
  bairros?: Record<
    string,
    {
      enabled?: boolean;
      percent?: number;
    }
  >;
}

export interface MatchingRolloutDecision {
  allowed: boolean;
  percent: number;
  bucket: number;
  reason:
    | "disabled_global"
    | "disabled_bairro"
    | "percent_zero"
    | "percent_full"
    | "bucket_allowed"
    | "bucket_blocked";
}

function clampPercent(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return 0;
  if (parsed >= 100) return 100;
  return Math.floor(parsed);
}

function normalizeBairroKey(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

function stableBucket(params: {
  tenantId: string;
  bairroNorm: string;
  waId: string;
}): number {
  const seed = `${params.tenantId}|${params.bairroNorm}|${params.waId}`;
  const hash = crypto.createHash("sha1").update(seed).digest("hex");
  const value = Number.parseInt(hash.slice(0, 8), 16);
  if (!Number.isFinite(value)) return 0;
  return value % 100;
}

export function decideMatchingRollout(params: {
  tenantId: string;
  bairroNorm: string;
  waId: string;
  config: MatchingRolloutConfig | null | undefined;
}): MatchingRolloutDecision {
  const config = params.config;
  if (!config?.enabled) {
    return {
      allowed: false,
      percent: 0,
      bucket: 0,
      reason: "disabled_global",
    };
  }

  const bairroKey = normalizeBairroKey(params.bairroNorm);
  const bairroConfig = bairroKey ? config.bairros?.[bairroKey] : undefined;
  if (bairroConfig?.enabled === false) {
    return {
      allowed: false,
      percent: 0,
      bucket: 0,
      reason: "disabled_bairro",
    };
  }

  const percent = clampPercent(bairroConfig?.percent, clampPercent(config.defaultPercent, 0));
  if (percent <= 0) {
    return {
      allowed: false,
      percent: 0,
      bucket: 0,
      reason: "percent_zero",
    };
  }
  if (percent >= 100) {
    return {
      allowed: true,
      percent: 100,
      bucket: 0,
      reason: "percent_full",
    };
  }

  const bucket = stableBucket({
    tenantId: params.tenantId,
    bairroNorm: bairroKey,
    waId: params.waId,
  });
  const allowed = bucket < percent;
  return {
    allowed,
    percent,
    bucket,
    reason: allowed ? "bucket_allowed" : "bucket_blocked",
  };
}

