import * as logger from "firebase-functions/logger";
import type * as FirebaseFirestore from "firebase-admin/firestore";
import { AdminTimestamp, FieldValue, db } from "../../infra/config/firebase";
import { userMessageSessionsCol, waDedupeCol } from "../../infra/firestore/duduPaths";

export interface SaveIncomingMessageParams {
  tenantCnpj: string;
  userId: string; // waId (doc id do user)
  from: string; // número do WhatsApp (string)
  msgType: string;
  textBody?: string;
  raw: any;
  waMessageId: string;
}

export interface SaveIncomingMessageResult {
  created: boolean;
  sessionId: string;
  shouldProcess: boolean;
  reason:
    | "NEW"
    | "DUPLICATE_PROCESSED"
    | "DUPLICATE_LEASE_ACTIVE"
    | "TAKEOVER"
    | "DUPLICATE_UNKNOWN";
}

type LiteMessage = {
  id: string;
  direction: "IN" | "OUT";
  type: string;
  text?: string | null;
  timestamp: FirebaseFirestore.Timestamp;
  leaseAt?: FirebaseFirestore.Timestamp | null;
  processedAt?: FirebaseFirestore.Timestamp | null;
  processedOk?: boolean | null;
  processedError?: string | null;
  meta?: any;
};

const SESSION_INACTIVITY_MINUTES = 60;
const MAX_MESSAGES_PER_SESSION = 80;
const IDEMPOTENCY_LEASE_MS = 30_000;
const DEDUPE_LEASE_MS = 30_000;
const DEDUPE_TTL_DAYS_RAW = Number(process.env.WA_DEDUPE_TTL_DAYS ?? "14");
const DEDUPE_TTL_DAYS = Number.isFinite(DEDUPE_TTL_DAYS_RAW) ? DEDUPE_TTL_DAYS_RAW : 14;
const DEDUPE_TTL_MS = Math.max(1, DEDUPE_TTL_DAYS) * 24 * 60 * 60 * 1000;
const TX_MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTxError(err: any): boolean {
  const code = Number(err?.code ?? err?.status ?? 0);
  if (code === 10) return true;
  const msg = String(err?.message ?? "");
  return msg.includes("ABORTED") || msg.includes("lock timeout");
}

function isAlreadyExistsError(err: any): boolean {
  const code = Number(err?.code ?? err?.status ?? 0);
  const msg = String(err?.message ?? "");
  return code === 6 || msg.includes("ALREADY_EXISTS") || msg.includes("already exists");
}

async function runTransactionWithRetry<T>(
  fn: (tx: FirebaseFirestore.Transaction) => Promise<T>,
): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= TX_MAX_RETRIES; attempt += 1) {
    try {
      return await db.runTransaction(fn);
    } catch (err: any) {
      lastErr = err;
      if (!isRetryableTxError(err) || attempt >= TX_MAX_RETRIES) throw err;
      await sleep(50 * attempt);
    }
  }
  throw lastErr;
}

function normalizeText(text: string | undefined): string {
  return (text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDateKeySaoPaulo(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  const day = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

function digitsOnly(value: string): string {
  const cleaned = (value ?? "").replace(/[^\d]/g, "");
  return cleaned.length ? cleaned : "semnumero";
}

function buildSessionId(from: string, nowMillis: number): string {
  // Prefixo = número (exigência prática: fácil bater o olho no Firestore)
  const prefix = digitsOnly(from);
  const suffix = nowMillis.toString(36);
  return `${prefix}_${suffix}`;
}


function pickIncomingRawLite(raw: any): any {
  try {
    const msg = raw?.message ?? raw?.messages?.[0] ?? raw ?? {};
    const type = msg?.type ?? raw?.type ?? null;
    const id = msg?.id ?? raw?.id ?? null;
    const timestamp = msg?.timestamp ?? raw?.timestamp ?? null;

    const body =
      msg?.text?.body ??
      msg?.button?.text ??
      msg?.interactive?.button_reply?.title ??
      msg?.interactive?.list_reply?.title ??
      msg?.image?.caption ??
      msg?.document?.caption ??
      null;

    const media =
      msg?.image?.id ??
      msg?.document?.id ??
      msg?.audio?.id ??
      msg?.video?.id ??
      msg?.sticker?.id ??
      null;

    return { id, type, timestamp, body, media };
  } catch {
    return null;
  }
}

function pickOutgoingRawLite(raw: any): any {
  try {
    if (!raw) return null;

    const type = raw?.type ?? raw?.requestKind ?? null;
    const id = raw?.waMessageId ?? raw?.messageId ?? null;

    const body =
      raw?.text ??
      raw?.body ??
      raw?.templateName ??
      raw?.stickerLink ??
      raw?.kind ??
      null;

    return {
      id,
      type,
      body,
      requestKind: raw?.requestKind ?? null,
      templateName: raw?.templateName ?? null,
      stickerLink: raw?.stickerLink ? String(raw.stickerLink).slice(0, 160) : null,
    };
  } catch {
    return null;
  }
}

function buildSyntheticOutgoingId(nowMillis: number): string {
  const rand = Math.random().toString(16).slice(2, 8);
  return `out_${nowMillis.toString(36)}_${rand}`;
}

type ResolveSessionResult = {
  sessionRef: FirebaseFirestore.DocumentReference;
  sessionData: any | null;
  createdNew: boolean;
};

async function resolveWritableSession(params: {
  tenantCnpj: string;
  userId: string;
  fromOrTo: string;
  nowTimestamp: FirebaseFirestore.Timestamp;
  nowMillis: number;
  dateKey: string;
  transaction: FirebaseFirestore.Transaction;
}): Promise<ResolveSessionResult> {
  const sessionsCollection = userMessageSessionsCol(params.tenantCnpj, params.userId);

  const lastSessionQuery = sessionsCollection.orderBy("lastMessageAt", "desc").limit(1);
  const lastSessionSnapshot = await params.transaction.get(lastSessionQuery);
  const lastSessionDoc = lastSessionSnapshot.empty ? null : lastSessionSnapshot.docs[0];

  let sessionRef: FirebaseFirestore.DocumentReference;
  let sessionData: any = null;
  let createdNew = false;

  if (lastSessionDoc) {
    sessionRef = lastSessionDoc.ref;
    sessionData = lastSessionDoc.data() as any;

    const lastAt: FirebaseFirestore.Timestamp | null = sessionData?.lastMessageAt ?? null;
    const lastMillis = lastAt?.toMillis?.() ?? 0;
    const diffMinutes = (params.nowMillis - lastMillis) / 60000;

    const lastDateKey: string | null =
      typeof sessionData?.dateKey === "string" ? sessionData.dateKey : null;

    if (lastDateKey !== params.dateKey || diffMinutes > SESSION_INACTIVITY_MINUTES) {
      sessionRef = sessionsCollection.doc(buildSessionId(params.fromOrTo, params.nowMillis));
      sessionData = null;
      createdNew = true;
    }
  } else {
    sessionRef = sessionsCollection.doc(buildSessionId(params.fromOrTo, params.nowMillis));
    sessionData = null;
    createdNew = true;
  }

  return { sessionRef, sessionData, createdNew };
}

export async function saveIncomingMessageIdempotent(
  params: SaveIncomingMessageParams,
): Promise<SaveIncomingMessageResult> {
  const { tenantCnpj, userId, from, msgType, textBody, raw, waMessageId } = params;

  const nowTimestamp = AdminTimestamp.now();
  const nowMillis = nowTimestamp.toMillis();
  const dedupeExpiresAt = AdminTimestamp.fromMillis(nowMillis + DEDUPE_TTL_MS);
  const dateKey = buildDateKeySaoPaulo(new Date());
  const normalized = normalizeText(textBody);
  const rawLite = pickIncomingRawLite(raw);
  const dedupeRef = waDedupeCol(tenantCnpj).doc(waMessageId);

    try {
      const transactionResult = await runTransactionWithRetry(async (transaction) => {
      const dedupeSnap = await transaction.get(dedupeRef);
      if (dedupeSnap.exists) {
        const dd = dedupeSnap.data() as any;
        const processedAt = dd?.processedAt ?? null;
        const leaseAt = dd?.leaseAt ?? null;
        const leaseAgeMs =
          leaseAt && typeof leaseAt.toMillis === "function"
            ? nowTimestamp.toMillis() - leaseAt.toMillis()
            : Number.POSITIVE_INFINITY;

        if (processedAt) {
          return {
            created: false,
            sessionId: String(dd?.lastSessionId ?? ""),
            shouldProcess: false,
            reason: "DUPLICATE_PROCESSED" as const,
          };
        }

        if (leaseAt && leaseAgeMs >= 0 && leaseAgeMs < DEDUPE_LEASE_MS) {
          return {
            created: false,
            sessionId: String(dd?.lastSessionId ?? ""),
            shouldProcess: false,
            reason: "DUPLICATE_LEASE_ACTIVE" as const,
          };
        }
      }

      const resolved = await resolveWritableSession({
        tenantCnpj,
        userId,
        fromOrTo: from,
        nowTimestamp,
        nowMillis,
        dateKey,
        transaction,
      });

      const sessionRef = resolved.sessionRef;
      const sessionData = resolved.sessionData;

      const existingMessageIds: string[] = Array.isArray(sessionData?.messageIds)
        ? sessionData.messageIds
        : [];

      const existingMessages: LiteMessage[] = Array.isArray(sessionData?.messagesLite)
        ? sessionData.messagesLite
        : [];

      const existingIndex = existingMessages.findIndex((m) => m?.id === waMessageId);
      const existsByIds = existingMessageIds.includes(waMessageId);

      if (existsByIds && existingIndex < 0) {
        return {
          created: false,
          sessionId: sessionRef.id,
          shouldProcess: false,
          reason: "DUPLICATE_UNKNOWN" as const,
        };
      }

      if (existingIndex >= 0) {
        const existing = existingMessages[existingIndex] as LiteMessage;
        const processedAt = existing?.processedAt ?? null;

        if (processedAt) {
          return {
            created: false,
            sessionId: sessionRef.id,
            shouldProcess: false,
            reason: "DUPLICATE_PROCESSED" as const,
          };
        }

        const leaseAt = existing?.leaseAt ?? null;
        const leaseAgeMs =
          leaseAt && typeof leaseAt.toMillis === "function"
            ? nowTimestamp.toMillis() - leaseAt.toMillis()
            : Number.POSITIVE_INFINITY;

        if (leaseAt && leaseAgeMs >= 0 && leaseAgeMs < IDEMPOTENCY_LEASE_MS) {
          return {
            created: false,
            sessionId: sessionRef.id,
            shouldProcess: false,
            reason: "DUPLICATE_LEASE_ACTIVE" as const,
          };
        }

        const updatedMessages = [...existingMessages];
        updatedMessages[existingIndex] = {
          ...existing,
          leaseAt: nowTimestamp,
        };

        transaction.set(
          sessionRef,
          {
            processingTakeoverCount: FieldValue.increment(1),
            messagesLite: updatedMessages,
            lastMessageAt: FieldValue.serverTimestamp(),
            lastDirection: "IN",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        transaction.set(
          dedupeRef,
          {
            waMessageId,
            userId,
            from,
            msgType,
            leaseAt: nowTimestamp,
            processedAt: null,
            processedOk: null,
            processedError: null,
            lastSessionId: sessionRef.id,
            lastMsgType: msgType,
            lastTextPreview: (textBody ?? "").slice(0, 140) || null,
            rawLite,
            expiresAt: dedupeExpiresAt,
            updatedAt: FieldValue.serverTimestamp(),
            ...(dedupeSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );

        return {
          created: false,
          sessionId: sessionRef.id,
          shouldProcess: true,
          reason: "TAKEOVER" as const,
        };
      }

      const nextMessageIds = [...existingMessageIds, waMessageId].slice(
        -MAX_MESSAGES_PER_SESSION,
      );

      const nextMessages = [
        ...existingMessages,
        {
          id: waMessageId,
          direction: "IN",
          type: msgType,
          text: normalized ? (textBody ?? null) : null,
          timestamp: nowTimestamp,
          leaseAt: nowTimestamp,
          processedAt: null,
          processedOk: null,
          processedError: null,
        },
      ].slice(-MAX_MESSAGES_PER_SESSION);

      const baseFields = sessionData
        ? {}
        : {
            sessionId: sessionRef.id,
            tenantCnpj,
            userId,
            from,
            dateKey,
            createdAt: FieldValue.serverTimestamp(),
          };

      transaction.set(
        sessionRef,
        {
          ...baseFields,
          messageIds: nextMessageIds,
          messagesLite: nextMessages,
          msgCount: (sessionData?.msgCount ?? 0) + 1,
          lastMessageAt: FieldValue.serverTimestamp(),
          lastDirection: "IN",
          lastMsgType: msgType,
          lastTextPreview: (textBody ?? "").slice(0, 140) || null,
          rawLite,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      transaction.set(
        dedupeRef,
        {
          waMessageId,
          userId,
          from,
          msgType,
          leaseAt: nowTimestamp,
          processedAt: null,
          processedOk: null,
          processedError: null,
          lastSessionId: sessionRef.id,
          lastMsgType: msgType,
          lastTextPreview: (textBody ?? "").slice(0, 140) || null,
          rawLite,
          expiresAt: dedupeExpiresAt,
          updatedAt: FieldValue.serverTimestamp(),
          ...(dedupeSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );

      return {
        created: true,
        sessionId: sessionRef.id,
        shouldProcess: true,
        reason: "NEW" as const,
      };
    });

      return transactionResult;
    } catch (error: any) {
      if (isRetryableTxError(error)) {
        try {
          const existing = await dedupeRef.get().catch(() => null as any);
          if (existing && existing.exists) {
            const dd = existing.data() as any;
            const processedAt = dd?.processedAt ?? null;
            const leaseAt = dd?.leaseAt ?? null;
            const leaseAgeMs =
              leaseAt && typeof leaseAt.toMillis === "function"
                ? nowTimestamp.toMillis() - leaseAt.toMillis()
                : Number.POSITIVE_INFINITY;

            if (processedAt) {
              return {
                created: false,
                sessionId: String(dd?.lastSessionId ?? ""),
                shouldProcess: false,
                reason: "DUPLICATE_PROCESSED" as const,
              };
            }

            if (leaseAt && leaseAgeMs >= 0 && leaseAgeMs < DEDUPE_LEASE_MS) {
              return {
                created: false,
                sessionId: String(dd?.lastSessionId ?? ""),
                shouldProcess: false,
                reason: "DUPLICATE_LEASE_ACTIVE" as const,
              };
            }
          }

          try {
            await dedupeRef.create({
              waMessageId,
              userId,
              from,
              msgType,
              leaseAt: nowTimestamp,
              processedAt: null,
              processedOk: null,
              processedError: null,
              lastSessionId: null,
              lastMsgType: msgType,
              lastTextPreview: (textBody ?? "").slice(0, 140) || null,
              rawLite,
              expiresAt: dedupeExpiresAt,
              createdAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
          } catch (createErr: any) {
            if (isAlreadyExistsError(createErr)) {
              const again = await dedupeRef.get().catch(() => null as any);
              if (again && again.exists) {
                const dd = again.data() as any;
                return {
                  created: false,
                  sessionId: String(dd?.lastSessionId ?? ""),
                  shouldProcess: false,
                  reason: "DUPLICATE_PROCESSED" as const,
                };
              }
            }
            throw createErr;
          }

          const sessionId = buildSessionId(from, nowMillis);
          const sessionRef = userMessageSessionsCol(tenantCnpj, userId).doc(sessionId);

          const lite: LiteMessage = {
            id: waMessageId,
            direction: "IN",
            type: msgType,
            text: normalized ? (textBody ?? null) : null,
            timestamp: nowTimestamp,
            leaseAt: nowTimestamp,
            processedAt: null,
            processedOk: null,
            processedError: null,
          };

          await sessionRef.set(
            {
              sessionId,
              tenantCnpj,
              userId,
              from,
              dateKey,
              messageIds: FieldValue.arrayUnion(waMessageId),
              messagesLite: FieldValue.arrayUnion(lite),
              msgCount: FieldValue.increment(1),
              lastMessageAt: FieldValue.serverTimestamp(),
              lastDirection: "IN",
              lastMsgType: msgType,
              lastTextPreview: (textBody ?? "").slice(0, 140) || null,
              rawLite,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );

          await dedupeRef.set(
            {
              lastSessionId: sessionId,
              lastMsgType: msgType,
              lastTextPreview: (textBody ?? "").slice(0, 140) || null,
              rawLite,
              expiresAt: dedupeExpiresAt,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          );

          return {
            created: true,
            sessionId,
            shouldProcess: true,
            reason: "NEW" as const,
          };
        } catch (fallbackErr: any) {
          logger.error("saveIncomingMessageIdempotent fallback falhou", {
            tenantCnpj,
            userId,
            waMessageId,
            code: fallbackErr?.code ?? fallbackErr?.status,
            message: fallbackErr?.message ?? String(fallbackErr),
          });
        }
      }
      logger.error("saveIncomingMessageIdempotent falhou", {
        tenantCnpj,
        userId,
        waMessageId,
        code: error?.code ?? error?.status,
      message: error?.message ?? String(error),
    });
    throw error;
  }
}

export interface MarkIncomingMessageProcessedParams {
  tenantCnpj: string;
  userId: string;
  sessionId: string;
  waMessageId: string;
  processedOk: boolean;
  processedError?: string | null;
}

export async function markIncomingMessageProcessed(
  params: MarkIncomingMessageProcessedParams,
): Promise<void> {
  const { tenantCnpj, userId, sessionId, waMessageId, processedOk, processedError } =
    params;

  const sessionRef = userMessageSessionsCol(tenantCnpj, userId).doc(sessionId);
  const dedupeRef = waDedupeCol(tenantCnpj).doc(waMessageId);

  const now = AdminTimestamp.now();
  const dedupeExpiresAt = AdminTimestamp.fromMillis(now.toMillis() + DEDUPE_TTL_MS);
  const safeError = processedError ? String(processedError).slice(0, 800) : null;

  await runTransactionWithRetry(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) {
      tx.set(
        dedupeRef,
        {
          processedAt: now,
          processedOk,
          processedError: safeError,
          leaseAt: null,
          expiresAt: dedupeExpiresAt,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    const data = snap.data() as any;
    const existingMessages: LiteMessage[] = Array.isArray(data?.messagesLite)
      ? data.messagesLite
      : [];

    const idx = existingMessages.findIndex((m) => m?.id === waMessageId);
    if (idx < 0) {
      tx.set(
        sessionRef,
        {
          lastProcessedAt: now,
          lastProcessedMessageId: waMessageId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return;
    }

    const updatedMessages = [...existingMessages];
    const current = updatedMessages[idx] as LiteMessage;

    updatedMessages[idx] = {
      ...current,
      leaseAt: null,
      processedAt: now,
      processedOk,
      processedError: safeError,
    };

    tx.set(
      sessionRef,
      {
        messagesLite: updatedMessages,
        lastProcessedAt: now,
        lastProcessedMessageId: waMessageId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(
      dedupeRef,
      {
        processedAt: now,
        processedOk,
        processedError: safeError,
        leaseAt: null,
        expiresAt: dedupeExpiresAt,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export interface SaveOutgoingMessageParams {
  tenantCnpj: string;
  userId: string; // waId (digits-only)
  to: string; // número (digits-only)
  msgType: string;
  textBody?: string | null;
  waMessageId?: string | null;
  raw?: any;
}

export interface SaveOutgoingMessageResult {
  sessionId: string;
  created: boolean;
  deduped: boolean;
  messageId: string;
}

export async function saveOutgoingMessageToSession(
  params: SaveOutgoingMessageParams,
): Promise<SaveOutgoingMessageResult> {
  const { tenantCnpj, userId, to, msgType, textBody, waMessageId, raw } = params;

  const nowTimestamp = AdminTimestamp.now();
  const nowMillis = nowTimestamp.toMillis();
  const dateKey = buildDateKeySaoPaulo(new Date());
  const normalized = normalizeText(textBody ?? undefined);

  const messageId =
    waMessageId && String(waMessageId).trim()
      ? String(waMessageId).trim()
      : buildSyntheticOutgoingId(nowMillis);

  const rawLite = pickOutgoingRawLite({
    ...(raw ?? null),
    waMessageId: messageId,
    type: msgType,
    text: textBody ?? null,
  });

  try {
    const result = await runTransactionWithRetry(async (transaction) => {
      const resolved = await resolveWritableSession({
        tenantCnpj,
        userId,
        fromOrTo: to,
        nowTimestamp,
        nowMillis,
        dateKey,
        transaction,
      });

      const sessionRef = resolved.sessionRef;
      const sessionData = resolved.sessionData;

      const existingMessageIds: string[] = Array.isArray(sessionData?.messageIds)
        ? sessionData.messageIds
        : [];

      const existingMessages: LiteMessage[] = Array.isArray(sessionData?.messagesLite)
        ? sessionData.messagesLite
        : [];

      const lastDirection = String(sessionData?.lastDirection ?? "");
      if (lastDirection === "OUT") {
        transaction.set(
          sessionRef,
          {
            lastMessageAt: FieldValue.serverTimestamp(),
            lastDirection: "OUT",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        return {
          sessionId: sessionRef.id,
          created: resolved.createdNew,
          deduped: true,
        };
      }

      const existsByIds = existingMessageIds.includes(messageId);
      const existsByLite = existingMessages.some((m) => m?.id === messageId);

      if (existsByIds || existsByLite) {
        transaction.set(
          sessionRef,
          {
            lastMessageAt: FieldValue.serverTimestamp(),
            lastDirection: "OUT",
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

        return {
          sessionId: sessionRef.id,
          created: resolved.createdNew,
          deduped: true,
        };
      }

      const nextMessageIds = [...existingMessageIds, messageId].slice(
        -MAX_MESSAGES_PER_SESSION,
      );

      const nextMessages = [
        ...existingMessages,
        {
          id: messageId,
          direction: "OUT",
          type: msgType,
          text: normalized ? (textBody ?? null) : null,
          timestamp: nowTimestamp,
          leaseAt: null,
          processedAt: null,
          processedOk: null,
          processedError: null,
          meta: rawLite,
        },
      ].slice(-MAX_MESSAGES_PER_SESSION);

      const baseFields = sessionData
        ? {}
        : {
            sessionId: sessionRef.id,
            tenantCnpj,
            userId,
            from: to,
            dateKey,
            createdAt: FieldValue.serverTimestamp(),
          };

      transaction.set(
        sessionRef,
        {
          ...baseFields,
          messageIds: nextMessageIds,
          messagesLite: nextMessages,
          msgCount: (sessionData?.msgCount ?? 0) + 1,
          lastMessageAt: FieldValue.serverTimestamp(),
          lastDirection: "OUT",
          lastMsgType: msgType,
          lastTextPreview: (textBody ?? "").slice(0, 140) || null,
          rawLite,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return {
        sessionId: sessionRef.id,
        created: resolved.createdNew,
        deduped: false,
      };
    });

    return {
      sessionId: result.sessionId,
      created: result.created,
      deduped: result.deduped,
      messageId,
    };
  } catch (error: any) {
    logger.warn("saveOutgoingMessageToSession falhou", {
      tenantCnpj,
      userId,
      to,
      msgType,
      messageId,
      code: error?.code ?? error?.status,
      message: error?.message ?? String(error),
    });
    throw error;
  }
}

export type BotReplyGuardState = {
  allowed: boolean;
  reason: "OK" | "NO_SESSION" | "MAX_CONSECUTIVE";
  sessionId: string | null;
  lastInboundId: string | null;
  consecutiveOut: number;
  outgoingCount: number;
};

export async function getBotReplyGuardState(params: {
  tenantCnpj: string;
  userId: string;
  maxConsecutive: number;
}): Promise<BotReplyGuardState> {
  const sessionSnap = await userMessageSessionsCol(params.tenantCnpj, params.userId)
    .orderBy("lastMessageAt", "desc")
    .limit(1)
    .get();

  if (sessionSnap.empty) {
    return {
      allowed: true,
      reason: "NO_SESSION",
      sessionId: null,
      lastInboundId: null,
      consecutiveOut: 0,
      outgoingCount: 0,
    };
  }

  const sessDoc = sessionSnap.docs[0];
  const data = sessDoc.data() as any;
  const messages = Array.isArray(data?.messagesLite) ? data.messagesLite : [];
  if (!messages.length) {
    return {
      allowed: true,
      reason: "OK",
      sessionId: sessDoc.id,
      lastInboundId: null,
      consecutiveOut: 0,
      outgoingCount: 0,
    };
  }

  messages.sort((a: any, b: any) => {
    const ta = typeof a?.timestamp?.toMillis === "function" ? a.timestamp.toMillis() : 0;
    const tb = typeof b?.timestamp?.toMillis === "function" ? b.timestamp.toMillis() : 0;
    return ta - tb;
  });

  let consecutiveOut = 0;
  let outgoingCount = 0;
  let lastInboundId: string | null = null;
  for (const msg of messages) {
    const direction = String(msg?.direction ?? "");
    if (direction === "IN") {
      consecutiveOut = 0;
      lastInboundId = String(msg?.id ?? "") || lastInboundId;
      continue;
    }
    if (direction === "OUT") {
      consecutiveOut += 1;
      outgoingCount += 1;
    }
  }

  if (consecutiveOut >= params.maxConsecutive) {
    return {
      allowed: false,
      reason: "MAX_CONSECUTIVE",
      sessionId: sessDoc.id,
      lastInboundId,
      consecutiveOut,
      outgoingCount,
    };
  }

  return {
    allowed: true,
    reason: "OK",
    sessionId: sessDoc.id,
    lastInboundId,
    consecutiveOut,
    outgoingCount,
  };
}

//
// CHECKLIST:
// - Entrada: sessão única por usuário com janela de 60 min e troca obrigatória por dia.
// - Idempotência: lease + processedAt no mesmo doc de sessão (sem doc por mensagem).
// - Saída: mensagens OUT são anexadas na mesma sessão, sem quebrar compatibilidade com o fluxo de entrada.
//
// DEPENDÊNCIAS:
// - Firestore: users/{waId}/messageSessions/{sessionId} (doc de sessão com messageIds/messagesLite).
// - Nenhuma env/secret nova.
//
