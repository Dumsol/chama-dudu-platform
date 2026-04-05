import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

import { FieldValue } from "../config/firebase";
import { jobLocksCol } from "../firestore/duduPaths";

type AcquireParams = {
  tenantCnpj: string;
  lockId: string;
  leaseSeconds: number;
  minIntervalMs?: number;
  runKey?: string | null;
};

type AcquireResult = { ok: boolean; reason?: string };

export async function acquireJobLock(params: AcquireParams): Promise<AcquireResult> {
  const { tenantCnpj, lockId, leaseSeconds } = params;
  const ref = jobLocksCol(tenantCnpj).doc(lockId);
  const nowMs = Date.now();
  const leaseUntilMs = nowMs + Math.max(30, Math.floor(leaseSeconds)) * 1000;

  try {
    const ok = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() as any) : {};

      const legacyLease = data?.leaseExpiresAt?.toMillis?.() ?? 0;
      const leaseUntil = Number(data?.leaseUntilMs ?? legacyLease ?? 0);
      if (leaseUntil && leaseUntil > nowMs) return false;

      const lastRunAtMs = Number(data?.lastRunAtMs ?? 0);
      if (params.minIntervalMs && lastRunAtMs) {
        const delta = nowMs - lastRunAtMs;
        if (delta >= 0 && delta < params.minIntervalMs) return false;
      }

      const lastRunKey = data?.lastRunKey ? String(data.lastRunKey) : "";
      if (params.runKey && lastRunKey && params.runKey === lastRunKey) return false;

      tx.set(
        ref,
        {
          lockId,
          leaseUntilMs,
          leaseExpiresAt: admin.firestore.Timestamp.fromMillis(leaseUntilMs),
          lastAttemptAtMs: nowMs,
          lastAttemptAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          meta: {
            functionName: process.env.FUNCTION_NAME ?? null,
            pid: process.pid ?? null,
          },
        },
        { merge: true },
      );

      return true;
    });

    return { ok };
  } catch (err: any) {
    logger.error("JOB_LOCK_ACQUIRE_FAILED", {
      lockId,
      tenantCnpj,
      error: err?.message ?? String(err),
    });
    return { ok: false, reason: "error" };
  }
}

export async function releaseJobLock(params: {
  tenantCnpj: string;
  lockId: string;
  success: boolean;
  runKey?: string | null;
  stats?: Record<string, unknown> | null;
  error?: string | null;
}): Promise<void> {
  const ref = jobLocksCol(params.tenantCnpj).doc(params.lockId);
  const nowMs = Date.now();

  const patch: Record<string, unknown> = {
    leaseUntilMs: 0,
    leaseExpiresAt: admin.firestore.Timestamp.fromMillis(0),
    lastFinishedAtMs: nowMs,
    lastFinishedAt: FieldValue.serverTimestamp(),
    lastStatus: params.success ? "SUCCESS" : "FAILED",
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (params.success) {
    patch.lastRunAtMs = nowMs;
    patch.lastRunAt = FieldValue.serverTimestamp();
    if (params.runKey) patch.lastRunKey = params.runKey;
  }

  if (params.stats) patch.lastStats = params.stats;
  if (params.error) patch.lastError = String(params.error).slice(0, 400);

  await ref.set(patch, { merge: true }).catch((err: any) => {
    logger.warn("JOB_LOCK_RELEASE_FAILED", {
      lockId: params.lockId,
      tenantCnpj: params.tenantCnpj,
      error: err?.message ?? String(err),
    });
  });
}
