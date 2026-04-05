// functions/src/modules/users/rateLimitService.ts
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { FieldValue } from "../../infra/config/firebase";
import { rateLimitsCol } from "../../infra/firestore/duduPaths";

const BURST_LIMIT_10S = 6;          // muito rígido contra flood
const SOFT_LIMIT_PER_MINUTE = 8;    // começa a frear
const HARD_LIMIT_PER_MINUTE = 12;   // bloqueia
const HARD_LIMIT_PER_HOUR = 60;     // bloqueia forte

const BASE_BLOCK_MINUTES = 20;      // 1º block
const ESCALATE_BLOCK_2_MINUTES = 60;   // 2º block (na janela)
const ESCALATE_BLOCK_3_MINUTES = 240;  // 3º block

const ESCALATION_WINDOW_HOURS = 24; // se reincidir em 24h, escala

interface ApplyRateLimitParams {
  tenantCnpj: string;
  waId: string;
}

export interface RateLimitResult {
  allowed: boolean;
  blocked: boolean;
  reason?: "BURST" | "SOFT_LIMIT" | "HARD_LIMIT" | "BLOCKED";
  shouldNotify: boolean;
  blockMinutes?: number;
}

function nowBuckets(nowMillis: number) {
  const minuteBucket = Math.floor(nowMillis / (60 * 1000));
  const hourBucket = Math.floor(nowMillis / (60 * 60 * 1000));
  const tenSecBucket = Math.floor(nowMillis / (10 * 1000));
  return { minuteBucket, hourBucket, tenSecBucket };
}

export async function applyRateLimit(
  params: ApplyRateLimitParams,
): Promise<RateLimitResult> {
  const { tenantCnpj, waId } = params;

  const rateRef = rateLimitsCol(tenantCnpj).doc(waId);

  const nowMillis = Date.now();
  const { minuteBucket, hourBucket, tenSecBucket } = nowBuckets(nowMillis);

  const res = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const data = snap.exists ? (snap.data() as any) : {};

    let minuteCount: number = Number(data.minuteCount ?? 0);
    let hourCount: number = Number(data.hourCount ?? 0);
    let tenSecCount: number = Number(data.tenSecCount ?? 0);

    let docMinuteBucket: number = Number(data.minuteBucket ?? minuteBucket);
    let docHourBucket: number = Number(data.hourBucket ?? hourBucket);
    let docTenSecBucket: number = Number(data.tenSecBucket ?? tenSecBucket);

    let totalMessages: number = Number(data.totalMessages ?? 0);

    let blockedUntilTs: admin.firestore.Timestamp | null = data.blockedUntil ?? null;

    // escalonamento
    let strikes24h: number = Number(data.strikes24h ?? 0);
    const lastBlockAtMs: number = Number(data.lastBlockAtMs ?? 0);

    // notify guards
    let lastNotifyBucket: number | null = data.lastNotifyBucket ?? null;

    // reset buckets
    if (docTenSecBucket !== tenSecBucket) {
      docTenSecBucket = tenSecBucket;
      tenSecCount = 0;
    }
    if (docMinuteBucket !== minuteBucket) {
      docMinuteBucket = minuteBucket;
      minuteCount = 0;
    }
    if (docHourBucket !== hourBucket) {
      docHourBucket = hourBucket;
      hourCount = 0;
    }

    tenSecCount += 1;
    minuteCount += 1;
    hourCount += 1;
    totalMessages += 1;

    let allowed = true;
    let blocked = false;
    let reason: RateLimitResult["reason"];
    let shouldNotify = false;

    // já bloqueado?
    if (blockedUntilTs && blockedUntilTs.toMillis() > nowMillis) {
      allowed = false;
      blocked = true;
      reason = "BLOCKED";
    } else {
      blockedUntilTs = null;

      // burst 10s: bloqueio imediato
      if (tenSecCount > BURST_LIMIT_10S) {
        allowed = false;
        blocked = true;
        reason = "BURST";
      } else if (minuteCount > HARD_LIMIT_PER_MINUTE || hourCount > HARD_LIMIT_PER_HOUR) {
        allowed = false;
        blocked = true;
        reason = "HARD_LIMIT";
      } else if (minuteCount > SOFT_LIMIT_PER_MINUTE) {
        allowed = false;
        blocked = false;
        reason = "SOFT_LIMIT";
      }
    }

    // aplica bloqueio escalonado se bloqueado agora
    if (blocked && (reason === "BURST" || reason === "HARD_LIMIT")) {
      const diffHours = (nowMillis - lastBlockAtMs) / (60 * 60 * 1000);
      if (!lastBlockAtMs || diffHours > ESCALATION_WINDOW_HOURS) {
        strikes24h = 1;
      } else {
        strikes24h = Math.min(3, strikes24h + 1);
      }

      const blockMinutes =
        strikes24h === 1 ? BASE_BLOCK_MINUTES :
        strikes24h === 2 ? ESCALATE_BLOCK_2_MINUTES :
        ESCALATE_BLOCK_3_MINUTES;

      blockedUntilTs = admin.firestore.Timestamp.fromMillis(nowMillis + blockMinutes * 60 * 1000);

      logger.warn("RateLimit bloqueio aplicado", {
        tenantCnpj,
        waId,
        reason,
        tenSecCount,
        minuteCount,
        hourCount,
        strikes24h,
        blockMinutes,
      });

      shouldNotify = lastNotifyBucket !== minuteBucket;
      lastNotifyBucket = minuteBucket;

      tx.set(rateRef, {
        waId,
        tenSecBucket: docTenSecBucket,
        tenSecCount,
        minuteBucket: docMinuteBucket,
        minuteCount,
        hourBucket: docHourBucket,
        hourCount,
        totalMessages,
        blockedUntil: blockedUntilTs,
        strikes24h,
        lastBlockAtMs: nowMillis,
        lastNotifyBucket,
        updatedAt: FieldValue.serverTimestamp(),
        ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      }, { merge: true });

      return { allowed, blocked, reason, shouldNotify, blockedUntilTs };
    }

    // soft limit: avisa 1x por minuto
    if (!blocked && reason === "SOFT_LIMIT") {
      shouldNotify = lastNotifyBucket !== minuteBucket;
      lastNotifyBucket = minuteBucket;
    }

    tx.set(rateRef, {
      waId,
      tenSecBucket: docTenSecBucket,
      tenSecCount,
      minuteBucket: docMinuteBucket,
      minuteCount,
      hourBucket: docHourBucket,
      hourCount,
      totalMessages,
      blockedUntil: blockedUntilTs ?? null,
      strikes24h,
      lastNotifyBucket,
      updatedAt: FieldValue.serverTimestamp(),
      ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });

    return { allowed, blocked, reason, shouldNotify, blockedUntilTs };
  });

  let blockMinutes: number | undefined;
  if (res.blocked && res.blockedUntilTs) {
    const diffMs = res.blockedUntilTs.toMillis() - nowMillis;
    blockMinutes = Math.max(1, Math.ceil(diffMs / 60000));
  }

  return {
    allowed: res.allowed,
    blocked: res.blocked,
    reason: res.reason,
    shouldNotify: res.shouldNotify,
    blockMinutes,
  };
}
