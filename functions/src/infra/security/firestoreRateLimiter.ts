import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import { assertTenantId, rateLimitsCol } from "../firestore/duduPaths";

function keyHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export async function applyFirestoreRateLimit(params: {
  tenantId: string;
  scope: "webhook" | "precadastro";
  key: string;
  windowMs: number;
  maxHits: number;
}): Promise<{ allowed: boolean; remaining: number; resetAtMs: number }> {
  const tenantId = assertTenantId(params.tenantId);
  const nowMs = Date.now();
  const windowStart = Math.floor(nowMs / params.windowMs) * params.windowMs;
  const resetAtMs = windowStart + params.windowMs;
  const docId = `${params.scope}_${keyHash(params.key)}`;
  const ref = rateLimitsCol(tenantId).doc(docId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const currentWindowStart = Number(data?.windowStart ?? 0);
    const currentHits =
      currentWindowStart === windowStart ? Number(data?.hits ?? 0) : 0;
    const nextHits = currentHits + 1;
    const allowed = nextHits <= params.maxHits;
    tx.set(
      ref,
      {
        scope: params.scope,
        tenantId,
        keyHash: keyHash(params.key),
        windowStart,
        hits: nextHits,
        updatedAt: FieldValue.serverTimestamp(),
        ttl: Timestamp.fromMillis(resetAtMs + params.windowMs),
      },
      { merge: true },
    );
    return {
      allowed,
      remaining: Math.max(0, params.maxHits - nextHits),
      resetAtMs,
    };
  });

  return result;
}
