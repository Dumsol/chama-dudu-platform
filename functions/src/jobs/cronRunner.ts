import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { acquireJobLock, releaseJobLock } from "../infra/jobs/jobLock";
import { isFeatureEnabled } from "../infra/config/featureFlags";
import { painelConfigSecret } from "../infra/config/secrets";
import { runWarRoomDailyRefreshTask, runWarRoomRealtimeRefreshTask } from "../modules/ops/warRoomService";


const SINGLE_TENANT_KEY =
  process.env.SINGLE_TENANT_KEY ?? process.env.SINGLE_TENANT_CNPJ ?? "app";

function parseTimeToMinutes(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})(?::|h)?(\d{2})?/i);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2] ?? "0");
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function getLocalParts(nowMs: number, tz: string): {
  year: number;
  month: string;
  day: string;
  weekday: string;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));

  const year = Number(parts.find((p) => p.type === "year")?.value ?? "1970");
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const minutes = hour * 60 + minute;

  return { year, month, day, weekday, minutes };
}

function buildDateKey(parts: { year: number; month: string; day: string }): string {
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isWithinWindow(nowMs: number, tz: string, start: string, end: string): boolean {
  const startMin = parseTimeToMinutes(start);
  const endMin = parseTimeToMinutes(end);
  if (startMin == null || endMin == null) return true;
  const { minutes } = getLocalParts(nowMs, tz);
  if (startMin === endMin) return true;
  if (endMin > startMin) return minutes >= startMin && minutes < endMin;
  return minutes >= startMin || minutes < endMin;
}

async function runWithLock(params: {
  tenantCnpj: string;
  lockId: string;
  leaseSeconds: number;
  minIntervalMs?: number;
  runKey?: string | null;
  task: () => Promise<void>;
}): Promise<void> {
  const lock = await acquireJobLock({
    tenantCnpj: params.tenantCnpj,
    lockId: params.lockId,
    leaseSeconds: params.leaseSeconds,
    minIntervalMs: params.minIntervalMs,
    runKey: params.runKey ?? null,
  });

  if (!lock.ok) {
    logger.debug("CRON_TASK_SKIPPED", {
      lockId: params.lockId,
      tenantCnpj: params.tenantCnpj,
      reason: lock.reason ?? "locked_or_recent",
    });
    return;
  }

  let err: unknown = null;
  try {
    await params.task();
  } catch (error: any) {
    err = error;
    logger.error("CRON_TASK_FAILED", {
      lockId: params.lockId,
      tenantCnpj: params.tenantCnpj,
      error: error?.message ?? String(error),
    });
  }

  await releaseJobLock({
    tenantCnpj: params.tenantCnpj,
    lockId: params.lockId,
    success: !err,
    runKey: params.runKey ?? null,
    error: err ? String((err as any)?.message ?? err) : null,
  });
}

export const dudu_cronRunnerV1 = onSchedule(
  {
    schedule: "every 3 minutes",
    timeZone: "America/Sao_Paulo",
    region: "southamerica-east1",
    secrets: [
      painelConfigSecret,
    ],
  },
  dudu_cronRunnerV1Handler
);

export async function dudu_cronRunnerV1Handler() {
    const tenantCnpj = SINGLE_TENANT_KEY;
    const nowMs = Date.now();

    if (!isFeatureEnabled("FEATURE_CRON_RUNNER_ENABLED", true)) {
      logger.warn("CRON_RUNNER_DISABLED", { tenantCnpj });
      return;
    }

    if (
      isFeatureEnabled("FEATURE_SLA_ENABLED", true) &&
      (isFeatureEnabled("FEATURE_SLA_PING_3MIN", true) ||
        isFeatureEnabled("FEATURE_SLA_REROUTE_6MIN", true))
    ) {
      const { runSlaCheckerTask } = await import("./slaChecker.js");
      await runWithLock({
        tenantCnpj,
        lockId: "cron_sla_3min",
        leaseSeconds: 120,
        minIntervalMs: 2.5 * 60 * 1000,
        task: runSlaCheckerTask,
      });
    }

    if (isFeatureEnabled("FEATURE_ROBO_OPS_GUARD_ENABLED", true)) {
      const { runRoboOpsGuard } = await import("./opsRobot.js");
      await runWithLock({
        tenantCnpj,
        lockId: "cron_ops_guard_5min",
        leaseSeconds: 240,
        minIntervalMs: 5 * 60 * 1000,
        task: runRoboOpsGuard,
      });
    }

    const { runBillingReconcileTask } = await import("../modules/billing/billing.js");
    await runWithLock({
      tenantCnpj,
      lockId: "cron_billing_reconcile_30min",
      leaseSeconds: 600,
      minIntervalMs: 30 * 60 * 1000,
      task: runBillingReconcileTask,
    });

    await runWithLock({
      tenantCnpj,
      lockId: "cron_war_room_realtime_10min",
      leaseSeconds: 300,
      minIntervalMs: 10 * 60 * 1000,
      task: async () => {
        await runWarRoomRealtimeRefreshTask(tenantCnpj);
      },
    });

    const recifeParts = getLocalParts(nowMs, "America/Recife");
    const recifeDateKey = buildDateKey(recifeParts);

    if (
      isFeatureEnabled("FEATURE_ROBO_DAILY_ENABLED", true) &&
      isWithinWindow(nowMs, "America/Recife", "06:20", "06:50")
    ) {
      const { runRoboDailyDepositoRollup } = await import("./opsRobot.js");
      await runWithLock({
        tenantCnpj,
        lockId: "cron_robo_daily_rollup",
        leaseSeconds: 8 * 60,
        runKey: recifeDateKey,
        task: runRoboDailyDepositoRollup,
      });
    }

    if (isWithinWindow(nowMs, "America/Recife", "02:10", "02:45")) {
      await runWithLock({
        tenantCnpj,
        lockId: "cron_war_room_daily_refresh",
        leaseSeconds: 10 * 60,
        runKey: recifeDateKey,
        task: async () => {
          await runWarRoomDailyRefreshTask(tenantCnpj);
        },
      });
    }

    if (
      isFeatureEnabled("FEATURE_PROMO_INTELIGENTE_ENABLED", true) &&
      isWithinWindow(nowMs, "America/Sao_Paulo", "10:05", "10:30")
    ) {
      const { runRoboPromoInteligente } = await import("./opsRobot.js");
      await runWithLock({
        tenantCnpj,
        lockId: "cron_robo_promo_inteligente",
        leaseSeconds: 8 * 60,
        runKey: buildDateKey(getLocalParts(nowMs, "America/Sao_Paulo")),
        task: runRoboPromoInteligente,
      });
    }

    if (
      isFeatureEnabled("FEATURE_PROMO_DAILY_SWEEP", true) &&
      isWithinWindow(nowMs, "America/Sao_Paulo", "10:40", "11:05")
    ) {
      const { runPromoDailySweep } = await import("../modules/promo/promoInteligente.js");
      await runWithLock({
        tenantCnpj,
        lockId: "cron_promo_daily_sweep",
        leaseSeconds: 8 * 60,
        runKey: buildDateKey(getLocalParts(nowMs, "America/Sao_Paulo")),
        task: async () => {
          await runPromoDailySweep(tenantCnpj);
        },
      });
    }

    if (recifeParts.weekday === "Mon" && isWithinWindow(nowMs, "America/Recife", "08:50", "09:20")) {
      const { runBillingWeeklyTask } = await import("../modules/billing/billing.js");
      await runWithLock({
        tenantCnpj,
        lockId: "cron_billing_weekly",
        leaseSeconds: 10 * 60,
        runKey: recifeDateKey,
        task: runBillingWeeklyTask,
      });
    }

    // 30-Day User Cleanup (Retention Policy)
    if (isWithinWindow(nowMs, "America/Recife", "03:10", "03:45")) {
      const { runUserCleanup30Days } = await import("../modules/crm/loyaltyService.js");
      await runWithLock({
        tenantCnpj,
        lockId: "cron_user_cleanup_30d",
        leaseSeconds: 600,
        runKey: recifeDateKey,
        task: async () => {
          await runUserCleanup30Days(tenantCnpj);
        },
      });
    }
}
