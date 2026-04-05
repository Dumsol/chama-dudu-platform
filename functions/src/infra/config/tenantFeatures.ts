import type * as FirebaseFirestore from "firebase-admin/firestore";
import { FieldValue } from "./firebase";
import { auditsCol, tenantConfigDoc } from "../firestore/duduPaths";

export type TenantFeatureConfig = {
  tenantKillSwitch: boolean;
  features: {
    promoInteligente: {
      enabled: boolean;
      minDeliveredOrdersLifetime?: number | null;
      minScore?: number | null;
    };
    raspadinha: { enabled: boolean };
    gptAdvisor: { enabled: boolean };
  };
  updatedAt?: FirebaseFirestore.Timestamp | null;
};

const DEFAULT_CONFIG: TenantFeatureConfig = {
  tenantKillSwitch: false,
  features: {
    promoInteligente: { enabled: false, minDeliveredOrdersLifetime: null, minScore: null },
    raspadinha: { enabled: false },
    gptAdvisor: { enabled: false },
  },
};

type CachedEntry = { data: TenantFeatureConfig; atMs: number };
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map<string, CachedEntry>();

function normalizeConfig(raw: any): TenantFeatureConfig {
  const promo = raw?.features?.promoInteligente ?? {};
  const rasp = raw?.features?.raspadinha ?? {};
  const gpt = raw?.features?.gptAdvisor ?? {};

  return {
    tenantKillSwitch: Boolean(raw?.tenantKillSwitch ?? DEFAULT_CONFIG.tenantKillSwitch),
    features: {
      promoInteligente: {
        enabled: Boolean(promo?.enabled ?? DEFAULT_CONFIG.features.promoInteligente.enabled),
        minDeliveredOrdersLifetime:
          typeof promo?.minDeliveredOrdersLifetime === "number"
            ? Math.max(0, Math.floor(promo.minDeliveredOrdersLifetime))
            : DEFAULT_CONFIG.features.promoInteligente.minDeliveredOrdersLifetime,
        minScore:
          typeof promo?.minScore === "number"
            ? Math.max(0, Math.round(promo.minScore * 100) / 100)
            : DEFAULT_CONFIG.features.promoInteligente.minScore,
      },
      raspadinha: { enabled: Boolean(rasp?.enabled ?? DEFAULT_CONFIG.features.raspadinha.enabled) },
      gptAdvisor: { enabled: Boolean(gpt?.enabled ?? DEFAULT_CONFIG.features.gptAdvisor.enabled) },
    },
    updatedAt: raw?.updatedAt ?? null,
  };
}

export async function getTenantFeatureConfig(tenantCnpj: string): Promise<TenantFeatureConfig> {
  const key = String(tenantCnpj ?? "").trim() || "app";
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && now - cached.atMs < CACHE_TTL_MS) return cached.data;

  const ref = tenantConfigDoc(key);
  const snap = await ref.get().catch(() => null as any);
  const data = normalizeConfig(snap?.data?.() ?? snap?.data ?? null);
  cache.set(key, { data, atMs: now });
  return data;
}

export function clearTenantFeatureCache(tenantCnpj: string): void {
  const key = String(tenantCnpj ?? "").trim() || "app";
  cache.delete(key);
}

export function buildTenantFeaturePatch(input: {
  tenantKillSwitch?: boolean;
  promoEnabled?: boolean;
  minDeliveredOrdersLifetime?: number | null;
  minScore?: number | null;
  raspadinhaEnabled?: boolean;
  gptAdvisorEnabled?: boolean;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if (typeof input.tenantKillSwitch === "boolean") {
    patch.tenantKillSwitch = input.tenantKillSwitch;
  }

  if (typeof input.promoEnabled === "boolean") {
    patch["features.promoInteligente.enabled"] = input.promoEnabled;
  }

  if (input.minDeliveredOrdersLifetime != null) {
    patch["features.promoInteligente.minDeliveredOrdersLifetime"] =
      typeof input.minDeliveredOrdersLifetime === "number"
        ? Math.max(0, Math.floor(input.minDeliveredOrdersLifetime))
        : null;
  }

  if (input.minScore != null) {
    patch["features.promoInteligente.minScore"] =
      typeof input.minScore === "number" ? Math.max(0, input.minScore) : null;
  }

  if (typeof input.raspadinhaEnabled === "boolean") {
    patch["features.raspadinha.enabled"] = input.raspadinhaEnabled;
  }

  if (typeof input.gptAdvisorEnabled === "boolean") {
    patch["features.gptAdvisor.enabled"] = input.gptAdvisorEnabled;
  }

  if (Object.keys(patch).length > 0) {
    patch.updatedAt = FieldValue.serverTimestamp();
  }

  return patch;
}

export async function writeTenantAudit(params: {
  tenantCnpj: string;
  actor: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}): Promise<void> {
  const ref = auditsCol(params.tenantCnpj).doc();
  await ref.set(
    {
      actor: params.actor,
      action: params.action,
      before: params.before ?? null,
      after: params.after ?? null,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
