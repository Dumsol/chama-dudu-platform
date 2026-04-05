import { TENANT_CACHE_TTL_MS } from "../../config/opsRuntime";

export interface TenantResolverDeps {
  fetchTenantIdByPhoneNumberId: (phoneNumberId: string) => Promise<string | null>;
  fallbackTenantIdByPhoneNumberId?: (phoneNumberId: string) => string | null;
  now?: () => number;
  ttlMs?: number;
}

export interface TenantResolver {
  resolveTenantId: (phoneNumberId: string) => Promise<string>;
  clearCache: () => void;
}

export function createTenantResolver(deps: TenantResolverDeps): TenantResolver {
  const cache = new Map<string, { tenantId: string; expiresAtMs: number }>();
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? TENANT_CACHE_TTL_MS;

  return {
    async resolveTenantId(phoneNumberId: string): Promise<string> {
      const cleanId = String(phoneNumberId ?? "").trim();
      if (!cleanId) throw new Error("phoneNumberId is required");
      const cached = cache.get(cleanId);
      const nowMs = now();
      if (cached && cached.expiresAtMs > nowMs) {
        return cached.tenantId;
      }
      const tenantId = await deps.fetchTenantIdByPhoneNumberId(cleanId);
      if (tenantId) {
        cache.set(cleanId, { tenantId, expiresAtMs: nowMs + ttlMs });
        return tenantId;
      }

      const fallbackTenantId = deps.fallbackTenantIdByPhoneNumberId?.(cleanId) ?? null;
      if (fallbackTenantId) {
        cache.set(cleanId, { tenantId: fallbackTenantId, expiresAtMs: nowMs + ttlMs });
        return fallbackTenantId;
      }

      throw new Error(`tenant not found for phoneNumberId=${cleanId}`);
    },
    clearCache(): void {
      cache.clear();
    },
  };
}
