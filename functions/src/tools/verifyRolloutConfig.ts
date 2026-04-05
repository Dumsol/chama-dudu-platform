import { tenantConfigDoc } from "../infra/firestore/duduPaths";

type RolloutConfig = {
  enabled: boolean;
  defaultPercent: number;
};

function parseTenantList(): string[] {
  return String(process.env.ROLLOUT_REQUIRED_TENANTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRollout(raw: unknown): RolloutConfig | null {
  const data =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (!data) return null;
  const defaultPercent = Number(data.defaultPercent);
  return {
    enabled: Boolean(data.enabled),
    defaultPercent: Number.isFinite(defaultPercent) ? Math.max(0, Math.min(100, Math.floor(defaultPercent))) : 0,
  };
}

async function main(): Promise<void> {
  const tenants = parseTenantList();
  if (!tenants.length) {
    console.log("verifyRolloutConfig: SKIP (ROLLOUT_REQUIRED_TENANTS vazio)");
    return;
  }

  const missing: string[] = [];
  for (const tenantId of tenants) {
    const snap = await tenantConfigDoc(tenantId).get().catch(() => null as any);
    const data = (snap?.data?.() ?? {}) as Record<string, unknown>;
    const features =
      data.features && typeof data.features === "object" && !Array.isArray(data.features)
        ? (data.features as Record<string, unknown>)
        : {};
    const matching =
      features.matching && typeof features.matching === "object" && !Array.isArray(features.matching)
        ? (features.matching as Record<string, unknown>)
        : {};
    const rollout = parseRollout(matching.rollout);
    if (!rollout) {
      missing.push(tenantId);
      continue;
    }
    console.log(
      `verifyRolloutConfig: tenant=${tenantId} enabled=${String(rollout.enabled)} defaultPercent=${String(
        rollout.defaultPercent,
      )}`,
    );
  }

  if (missing.length > 0) {
    console.error(
      `verifyRolloutConfig: FAIL - tenants sem features.matching.rollout: ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  console.log("verifyRolloutConfig: PASS");
}

void main();
