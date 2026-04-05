// functions/src/sla/slaChecker.ts

import * as logger from "firebase-functions/logger";
import * as crypto from "crypto";
import { onRequest } from "firebase-functions/v2/https";
import { readRoboAdminToken, painelConfigSecret } from "../../infra/config/secrets";
import { acquireJobLock, releaseJobLock } from "../../infra/jobs/jobLock";

const SINGLE_TENANT_KEY =
  process.env.SINGLE_TENANT_KEY ?? process.env.SINGLE_TENANT_CNPJ ?? "app";
const SLA_LOCK_ID = "sla_checker_3min";
const SLA_LOCK_LEASE_SEC = Number(process.env.SLA_LOCK_LEASE_SEC ?? "120");

function safeEq(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export async function checkOrdersSlaHandler(): Promise<void> {
  const lock = await acquireJobLock({
    tenantCnpj: SINGLE_TENANT_KEY,
    lockId: SLA_LOCK_ID,
    leaseSeconds: Math.max(30, SLA_LOCK_LEASE_SEC),
  });

  if (!lock.ok) {
    logger.info("SLA_CHECK_SKIPPED_LOCKED", { lockId: SLA_LOCK_ID });
    return;
  }

  let success = false;
  try {
    logger.info("SLA_CHECK_STARTED", {
      lockId: SLA_LOCK_ID,
      tenant: SINGLE_TENANT_KEY,
      startedAtMs: Date.now(),
    });
    success = true;
  } finally {
    await releaseJobLock({
      tenantCnpj: SINGLE_TENANT_KEY,
      lockId: SLA_LOCK_ID,
      success,
    });
  }
}

export const slaChecker3MinHttp = onRequest(
  {
    region: "southamerica-east1",
    secrets: [painelConfigSecret],
  },
  async (req, res) => {
    res.set("Content-Type", "application/json; charset=utf-8");
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }

    const adminToken = readRoboAdminToken().trim();
    if (!adminToken) {
      res.status(500).json({ ok: false, error: "missing_admin_token" });
      return;
    }

    const provided = String(req.header("x-admin-token") ?? "").trim();
    if (!provided || !safeEq(provided, adminToken)) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }

    try {
      await checkOrdersSlaHandler();
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(200).json({
        ok: false,
        error: "internal_error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  },
);

//
// CHECKLIST:
// - SLA HTTP protegido por roboAdminToken (x-admin-token).
// - Lock transacional em job_locks para evitar execucao concorrente.
// - Handler nao executa side effects sem lock.
//
// DEPENDENCIAS:
// - Secrets: KOSH_PROD_DUDU_ROBO_ADMIN_TOKEN.
// - Firestore: job_locks/{sla_checker_3min}.
// - Env: SINGLE_TENANT_KEY/SINGLE_TENANT_CNPJ, SLA_LOCK_LEASE_SEC.
//
