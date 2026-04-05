import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";

import { acquireJobLock, releaseJobLock } from "../../infra/jobs/jobLock";
import { assertRequiredConfig } from "../../infra/config/guardrails";
import { readBillingAdminKey, painelConfigSecret } from "../../infra/config/secrets";

import {
  ensureWeeklyBillingCycleForDeposito,
  getPublicCycleOrNull,
  listDepositosAtivosIds,
  previousWeekPeriod,
  reconcileOpenBillingCycles,
} from "./billingService";

const SINGLE_TENANT_KEY =
  process.env.SINGLE_TENANT_KEY ?? process.env.SINGLE_TENANT_CNPJ ?? "app";

function cryptoTimingSafeEqual(a: Buffer, b: Buffer): boolean {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("crypto") as typeof import("crypto");
  return crypto.timingSafeEqual(a, b);
}

function safeEq(a: string, b: string): boolean {
  const aa = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (aa.length !== bb.length) return false;
  return cryptoTimingSafeEqual(aa, bb);
}

async function generateWeeklyInternal(): Promise<any> {
  // Produção: sempre exige config e secrets. Falhar cedo > rodar “meia-boca”.
  assertRequiredConfig({
    context: "billingGenerateWeekly",
    env: [
      "INTER_BASE_URL",
      "INTER_OAUTH_PATH",
      "INTER_PIX_BASE_PATH",
      "INTER_BOLETO_BASE_PATH",
    ],
    secrets: [
      { name: "PAINEL_CONFIG", secret: painelConfigSecret },
    ],
  });

  const tenantCnpj = SINGLE_TENANT_KEY;

  const lock = await acquireJobLock({
    tenantCnpj,
    lockId: "billing_generate_weekly_v1",
    leaseSeconds: 10 * 60,
  });

  if (!lock.ok) {
    return { ok: true, locked: false, message: "lock_active" };
  }

  let success = false;
  try {
    const { periodStart, periodEnd, periodEndKey } = previousWeekPeriod("America/Recife");
    const depositos = await listDepositosAtivosIds(tenantCnpj);

    const results: any[] = [];
    let created = 0;
    let existing = 0;
    let skipped = 0;

    for (const depositoId of depositos) {
      try {
        const r = await ensureWeeklyBillingCycleForDeposito({
          tenantCnpj,
          depositoId,
          periodStart,
          periodEnd,
          periodEndKey,
        });

        if (r.skipped) skipped += 1;
        else if (r.created) created += 1;
        else existing += 1;

        results.push({ depositoId, ...r });
      } catch (err: any) {
        logger.error("Billing: erro ao gerar ciclo", {
          depositoId,
          error: err?.message ?? String(err),
        });
        results.push({ depositoId, error: err?.message ?? String(err) });
      }
    }

    const out = {
      ok: true,
      tenantCnpj,
      periodStart: periodStart.toMillis(),
      periodEnd: periodEnd.toMillis(),
      periodEndKey,
      counts: { depositos: depositos.length, created, existing, skipped },
      results,
    };

    success = true;
    return out;
  } finally {
    await releaseJobLock({
      tenantCnpj,
      lockId: "billing_generate_weekly_v1",
      success,
    });
  }
}

// (A) Admin: gerar faturas
export const billingGenerateWeekly = onRequest(
  {
    region: "southamerica-east1",
    secrets: [painelConfigSecret],
  },
  billingGenerateWeeklyHandler
);

export async function billingGenerateWeeklyHandler(req: any, res: any) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }

    const headerKey = String(req.header("x-admin-key") ?? "");
    const secretKey = readBillingAdminKey();

    // Produção: Se não configurou secret, falha fechado.
    if (!secretKey) {
      logger.error("billingGenerateWeekly: billingAdminKey ausente (misconfig)");
      res.status(500).json({ ok: false, error: "server_misconfigured" });
      return;
    }

    if (!headerKey || !safeEq(headerKey, secretKey)) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }

    try {
      const out = await generateWeeklyInternal();
      res.status(200).json(out);
      return;
    } catch (err: any) {
      logger.error("billingGenerateWeekly falhou", { error: err?.message ?? String(err) });
      res.status(500).json({ ok: false, error: "internal_error" });
      return;
    }
}

// (B) Público: consulta de ciclo
export const billingPublicCycle = onRequest(
  {
    region: "southamerica-east1",
  },
  billingPublicCycleHandler
);

export async function billingPublicCycleHandler(req: any, res: any) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }

    const depositoId = String(req.query.depositoId ?? "").trim();
    const cycleId = String(req.query.cycleId ?? "").trim();
    const token = String(req.query.t ?? "").trim();
    const tenantCnpj = SINGLE_TENANT_KEY;

    if (!depositoId || !cycleId || !token) {
      res.status(404).json({ ok: false, error: "not_found" });
      return;
    }

    try {
      const data = await getPublicCycleOrNull({ tenantCnpj, depositoId, cycleId, token });
      if (!data) {
        res.status(404).json({ ok: false, error: "not_found" });
        return;
      }

      res.status(200).json({ ok: true, ...data });
      return;
    } catch (err: any) {
      logger.error("billingPublicCycle falhou", { error: err?.message ?? String(err) });
      res.status(500).json({ ok: false, error: "internal_error" });
      return;
    }
}

// (5) Scheduler semanal — segunda 09:00 America/Sao_Paulo
export async function runBillingWeeklyTask(): Promise<void> {
    try {
      const out = await generateWeeklyInternal();
      logger.info("billingWeeklyScheduler concluído", out);
    } catch (err: any) {
      logger.error("billingWeeklyScheduler falhou", { error: err?.message ?? String(err) });
    }
}

// (6) Scheduler reconcile hard fallback — a cada 30 min
export async function runBillingReconcileTask(): Promise<void> {
    try {
      const tenantCnpj = SINGLE_TENANT_KEY;
      assertRequiredConfig({
        context: "billingReconcileOpenCycles",
        env: [
          "INTER_BASE_URL",
          "INTER_OAUTH_PATH",
          "INTER_PIX_BASE_PATH",
          "INTER_BOLETO_BASE_PATH",
        ],
        secrets: [
          { name: "PAINEL_CONFIG", secret: painelConfigSecret },
        ],
      });

      const out = await reconcileOpenBillingCycles({ tenantCnpj, limit: 150 });
      logger.info("billingReconcileOpenCycles concluído", out);
    } catch (err: any) {
      logger.error("billingReconcileOpenCycles falhou", { error: err?.message ?? String(err) });
    }
}
