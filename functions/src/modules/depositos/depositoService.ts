// FILE: functions/src/modules/depositos/depositoService.ts
import type * as FirebaseFirestore from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger"; // MODIFIED: ensure logger is available
import { FieldValue } from "../../infra/config/firebase";
import {
  depositosByWaCol,
  depositosCol,
  routingStateCol,
} from "../../infra/firestore/duduPaths";
import type { Deposito, DepositoQualidadeStatus } from "../common/types";


export type RoutingState = {
  id: string;
  lastDepositoId: string | null;
  updatedAt: FirebaseFirestore.Timestamp | null;
};
const LASTSEEN_TTL_MS = Number(process.env.DEPOSITO_LASTSEEN_TTL_MS ?? String(25 * 60 * 1000)); // 25min default
const BAIRRO_CACHE_TTL_MS = Number(process.env.DEPOSITO_BAIRRO_CACHE_TTL_MS ?? "50000"); // 50s default

const bairroCache = new Map<string, { atMs: number; data: Deposito[] }>();
const DEFAULT_TIMEZONE = "America/Sao_Paulo";

const WEEKDAY_KEYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];

function toNumOrNull(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function mapStatus(raw: any): "ABERTO" | "FECHADO" {
  const statusRaw = String(raw ?? "FECHADO").toUpperCase();
  return statusRaw === "ABERTO" ? "ABERTO" : "FECHADO";
}

function mapQualidade(raw: any): DepositoQualidadeStatus {
  const qRaw = String(raw ?? "OK").toUpperCase();
  if (qRaw === "SUSPENSO") return "SUSPENSO";
  if (qRaw === "EM_OBSERVACAO") return "EM_OBSERVACAO";
  return "OK";
}

function mapBilling(raw: any): "OK" | "INADIMPLENTE" {
  const bRaw = String(raw ?? "OK").toUpperCase();
  return bRaw === "INADIMPLENTE" ? "INADIMPLENTE" : "OK";
}

function parseTimeToMinutes(raw: any): number | null {
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

function normalizeTimezone(raw: any): string {
  const tz = String(raw ?? "").trim();
  if (!tz) return DEFAULT_TIMEZONE;
  return tz;
}

function getLocalParts(nowMs: number, tz: string): { hour: number; minute: number; weekday: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(new Date(nowMs));
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const weekdayText = String(parts.find((p) => p.type === "weekday")?.value ?? "").slice(0, 3).toLowerCase();
    const weekday = weekdayText === "sun" ? 0 : weekdayText === "mon" ? 1 : weekdayText === "tue" ? 2 : weekdayText === "wed" ? 3 : weekdayText === "thu" ? 4 : weekdayText === "fri" ? 5 : 6;
    return { hour, minute, weekday };
  } catch {
    const d = new Date(nowMs);
    return { hour: d.getHours(), minute: d.getMinutes(), weekday: d.getDay() };
  }
}

function resolveHorarioByWeekday(data: any, weekday: number): { abertura: string; fechamento: string } | null {
  const raw = data?.horarioSemanal ?? data?.horarioSemana ?? data?.horarioPorDia ?? null;
  if (!raw || typeof raw !== "object") return null;

  const keyNum = String(weekday);
  const keyName = WEEKDAY_KEYS[weekday] ?? null;

  const entry =
    (raw as any)[keyNum] ??
    (keyName ? (raw as any)[keyName] : null) ??
    null;
  if (!entry || typeof entry !== "object") return null;

  const abertura = String((entry as any)?.abertura ?? (entry as any)?.abre ?? "").trim();
  const fechamento = String((entry as any)?.fechamento ?? (entry as any)?.fecha ?? "").trim();
  if (!abertura || !fechamento) return null;
  return { abertura, fechamento };
}

export function resolveDepositoHorario(params: {
  data: any;
  nowMs: number;
}): { open: boolean; scheduleFound: boolean; timezone: string } {
  const tz = normalizeTimezone(params.data?.timezone ?? params.data?.horarioTimezone ?? params.data?.timeZone ?? null);
  const { hour, minute, weekday } = getLocalParts(params.nowMs, tz);
  const nowMin = hour * 60 + minute;

  const weekly = resolveHorarioByWeekday(params.data, weekday);
  const aberturaStr = weekly?.abertura ?? String(params.data?.horarioAbertura ?? params.data?.horarioFuncionamento ?? "");
  const fechamentoStr = weekly?.fechamento ?? String(params.data?.horarioFechamento ?? "");

  const openMin = parseTimeToMinutes(aberturaStr);
  const closeMin = parseTimeToMinutes(fechamentoStr);

  if (openMin == null || closeMin == null) {
    return { open: true, scheduleFound: false, timezone: tz };
  }

  if (openMin === closeMin) {
    return { open: true, scheduleFound: true, timezone: tz };
  }

  const open =
    closeMin > openMin
      ? nowMin >= openMin && nowMin < closeMin
      : nowMin >= openMin || nowMin < closeMin;

  return { open, scheduleFound: true, timezone: tz };
}

function computeRouteEligibleFromData(data: any, nowMs: number): boolean {
  if (data?.routeEligible === false) return false;

  const status = mapStatus(data?.status);
  const horario = resolveDepositoHorario({ data, nowMs });
  const autoOpenEnabled =
    horario.scheduleFound && (data?.operational?.autoOpenEnabled ?? true);

  if (horario.scheduleFound && !horario.open) return false;

  if (status !== "ABERTO") {
    if (!autoOpenEnabled) return false;
  }

  const billingStatus = mapBilling(data?.billing?.status);
  if (billingStatus === "INADIMPLENTE") return false;

  const qualidade = mapQualidade(data?.quality?.statusQualidade);
  if (qualidade === "SUSPENSO") return false;

  const pausedUntilMs = toNumOrNull(data?.pausedUntilMs);
  if (pausedUntilMs != null && pausedUntilMs > nowMs) return false;

  const offlineUntilMs = toNumOrNull(data?.operational?.offlineUntilMs);
  if (offlineUntilMs != null && offlineUntilMs > nowMs) return false;

  const lastSeenAtMs = toNumOrNull(data?.lastSeenAtMs);
  if (lastSeenAtMs != null && nowMs - lastSeenAtMs > LASTSEEN_TTL_MS) return false;

  return true;
}

function mapDepositoDoc(
  doc: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>,
  nowMs = Date.now(),
): Deposito | null {
  if (!doc.exists) return null;
  const data = doc.data() as any;

  const status = mapStatus(data.status);
  const statusQualidade = mapQualidade(data?.quality?.statusQualidade);
  const billingStatus = mapBilling(data?.billing?.status);

  const pausedUntilMs = toNumOrNull(data?.pausedUntilMs);
  const pauseReason = typeof data?.pauseReason === "string" ? data.pauseReason.slice(0, 120) : null;

  const lastSeenAtMs = toNumOrNull(data?.lastSeenAtMs);
  const lastRoutedAtMs = toNumOrNull(data?.lastRoutedAtMs);
  const lastInboundAtMs = toNumOrNull(data?.lastInboundAtMs);
  const lastAckAtMs = toNumOrNull(data?.lastAckAtMs);
  const offlineUntilMs = toNumOrNull(data?.operational?.offlineUntilMs);
  const lastEmergencyHelpAt = data?.operational?.lastEmergencyHelpAt ?? null;

  const routeEligible = computeRouteEligibleFromData(data, nowMs);

  return {
    id: doc.id,
    nome: String(data.nome ?? ""),
    bairro: String(data.bairro ?? ""),
    waId: String(data.waId ?? ""),
    status,

    deliveryDisponivel: Boolean(data.deliveryDisponivel),
    retiradaDisponivel: Boolean(data.retiradaDisponivel),

    endereco: data.endereco ?? null,
    horarioFuncionamento: data.horarioFuncionamento ?? null,
    horarioAbertura: data.horarioAbertura ?? null,
    horarioFechamento: data.horarioFechamento ?? null,
    timezone: normalizeTimezone(data?.timezone ?? data?.horarioTimezone ?? data?.timeZone ?? null),

    routeEligible,
    pausedUntilMs,
    pauseReason,
    lastSeenAtMs,
    lastRoutedAtMs,
    lastInboundAtMs,
    lastAckAtMs,
    operational: {
      offlineUntilMs,
      lastEmergencyHelpAt,
      updatedAt: data?.operational?.updatedAt ?? null,
    },

    billing: {
      status: billingStatus,
      cycleId: data?.billing?.cycleId ?? null,
      paymentUrl: data?.billing?.paymentUrl ?? null,
      reason: data?.billing?.reason ?? null,
      blockedAt: data?.billing?.blockedAt ?? null,
      updatedAt: data?.billing?.updatedAt ?? null,
    },

    quality: {
      statusQualidade,
      strikes7d: typeof data?.quality?.strikes7d === "number" ? data.quality.strikes7d : null,
      updatedAt: data?.quality?.updatedAt ?? null,
      reason: data?.quality?.reason ?? null,
    },

    stats: data.stats ?? null,
  };
}

export async function getDepositoById(tenantCnpj: string, depositoId: string): Promise<Deposito | null> {
  const ref = depositosCol(tenantCnpj).doc(depositoId);
  const snap = await ref.get();
  return mapDepositoDoc(snap);
}

/**
 * Otimizacao incremental:
 * - 1) tenta ponteiro: depositosByWa/{waId} -> depositoId (1 read)
 * - 2) tenta doc direto: depositos/{waId} (se um dia voce usar waId como docId)
 * - 3) fallback query .where("waId"=="...") (legado)
 * - Sempre que cair no (2) ou (3), cria/atualiza ponteiro pra proxima.
 */
export async function getDepositoByWaId(tenantCnpj: string, waId: string): Promise<Deposito | null> {
  const depsCol = depositosCol(tenantCnpj);
  const depsByWa = depositosByWaCol(tenantCnpj);

  // 1) ponteiro
  const ptrRef = depsByWa.doc(waId);
  const ptrSnap = await ptrRef.get().catch(() => null as any);
  const ptrId = ptrSnap?.exists ? String((ptrSnap.data() as any)?.depositoId ?? "") : "";
  if (ptrId) {
    const dep = await getDepositoById(tenantCnpj, ptrId).catch(() => null);
    if (dep) return dep;
  }

 // - 2) tenta doc direto: depositos/{waId} (se um dia voce usar waId como docId)
  const directSnap = await depsCol.doc(waId).get().catch(() => null as any);
  if (directSnap?.exists) {
    const d = directSnap.data() as any;
    if (String(d?.waId ?? "") === String(waId)) {
      // cria ponteiro
      await ptrRef
        .set(
          {
            waId,
            depositoId: directSnap.id,
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        .catch(() => void 0);

      return mapDepositoDoc(directSnap);
    }
  }

  // 3) fallback query (legado)
  const snap = await depsCol.where("waId", "==", waId).limit(1).get();
  if (snap.empty) return null;

  const depDoc = snap.docs[0] as any;

  // cria/atualiza ponteiro
  await ptrRef
    .set(
      {
        waId,
        depositoId: depDoc.id,
        updatedAt: FieldValue.serverTimestamp(),
        ...(ptrSnap?.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    )
    .catch(() => void 0);

  return mapDepositoDoc(depDoc);
}

export async function setDepositoStatus(
  tenantCnpj: string,
  depositoId: string,
  status: "ABERTO" | "FECHADO",
): Promise<void> {
  await depositosCol(tenantCnpj)
    .doc(depositoId)
    .set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function setDepositoQualidade(params: {
  tenantCnpj: string;
  depositoId: string;
  statusQualidade: DepositoQualidadeStatus;
  strikes7d?: number | null;
  reason?: string | null;
}): Promise<void> {
  await depositosCol(params.tenantCnpj).doc(params.depositoId).set(
    {
      quality: {
        statusQualidade: params.statusQualidade,
        strikes7d: params.strikes7d ?? null,
        reason: params.reason ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * PAUSAR sem "fechar":
 * - pausar por X ms (TTL)
 * - routeEligible vai virar false pela regra (pausedUntilMs > now)
 */
export async function setDepositoPause(params: {
  tenantCnpj: string;
  depositoId: string;
  pauseMs: number;
  reason?: string | null;
}): Promise<void> {
  const pauseMs = Math.max(10_000, Math.min(24 * 60 * 60 * 1000, Math.floor(params.pauseMs)));
  const untilMs = Date.now() + pauseMs;

  await depositosCol(params.tenantCnpj).doc(params.depositoId).set(
    {
      pausedUntilMs: untilMs,
      pauseReason: (params.reason ?? "PAUSE").slice(0, 120),
      routeEligible: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

export async function clearDepositoPause(tenantCnpj: string, depositoId: string): Promise<void> {
  await depositosCol(tenantCnpj).doc(depositoId).set(
    {
      pausedUntilMs: null,
      pauseReason: null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/**
 * Heartbeat indireto: sempre que deposito falar, atualiza lastSeenAtMs.
 */
export async function touchDepositoLastSeenAt(params: {
  tenantCnpj: string;
  depositoId: string;
  waId?: string | null;
}): Promise<void> {
  const nowMs = Date.now();
  const depsCol = depositosCol(params.tenantCnpj);
  const depsByWa = depositosByWaCol(params.tenantCnpj);

  const batch = depsCol.firestore.batch();

  const depRef = depsCol.doc(params.depositoId);
  batch.set(
    depRef,
    {
      lastSeenAtMs: nowMs,
      lastInboundAtMs: nowMs,
      lastAckAtMs: nowMs,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // se tiver waId, garante ponteiro (barato e reduz query futura)
  if (params.waId) {
    const ptrRef = depsByWa.doc(String(params.waId));
    batch.set(
      ptrRef,
      {
        waId: String(params.waId),
        depositoId: params.depositoId,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  await batch.commit().catch(() => void 0);
}

/**
 * Round-robin barato: marca que esse deposito foi o ultimo roteado recentemente.
 * (Quem esta ha mais tempo sem pedido ganha no desempate.)
 */
export async function touchDepositoLastRoutedAt(tenantCnpj: string, depositoId: string): Promise<void> {
  await depositosCol(tenantCnpj).doc(depositoId).set(
    {
      lastRoutedAtMs: Date.now(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

function qualidadeRank(d: Deposito): number {
  const s = d.quality?.statusQualidade ?? "OK";
  if (s === "SUSPENSO") return 99;
  if (s === "EM_OBSERVACAO") return 10;
  return 0;
}

function cacheKeyForBairro(tenantCnpj: string, bairro: string): string {
  return `${tenantCnpj}:${bairro.trim().toLowerCase()}`;
}

/**
 * Lista depositos ABERTOS por bairro com:
 * - cache curto (reduz read flood)
 * - filtro efetivo (inadimplente/suspenso/pausado/stale)
 * - ordenacao qualidadeRank + lastRoutedAtMs (round-robin)
 * - auto-healing: ajusta routeEligible e limpa pause expirada
 */
// MODIFIED: Added exhaustive logging and error handling for "The Villain" issue
export async function listarDepositosAbertosPorBairro(tenantCnpj: string, bairro: string): Promise<Deposito[]> {
  const key = cacheKeyForBairro(tenantCnpj, bairro);
  const nowMs = Date.now();

  logger.info('[DEPOSIT_LOOKUP] Starting search for:', { tenantCnpj, bairro });

  try {
    const cached = bairroCache.get(key);
    if (cached && nowMs - cached.atMs <= BAIRRO_CACHE_TTL_MS) {
      logger.info('[DEPOSIT_LOOKUP] Cache hit.', { count: cached.data.length });
      return cached.data;
    }

    const depsCol = depositosCol(tenantCnpj);

    const snap = await depsCol
      .where("bairro", "==", bairro)
      .where("status", "==", "ABERTO")
      .limit(80)
      .get()
      .catch((err) => {
        logger.error('[DEPOSIT_LOOKUP] Exception thrown during Firestore query:', err);
        throw err;
      });

    logger.info('[DEPOSIT_LOOKUP] Raw DB response.', { resultCount: snap.size });

    if (snap.empty) {
      logger.warn('[DEPOSIT_LOOKUP] No deposit found — case: [EMPTY_ARRAY]', { tenantCnpj, bairro });
      bairroCache.set(key, { atMs: nowMs, data: [] });
      return [];
    }

    const out: Deposito[] = [];
    const patches: Array<{ ref: FirebaseFirestore.DocumentReference; patch: any }> = [];

    for (const doc of snap.docs) {
      const data = doc.data() as any;
      const d = mapDepositoDoc(doc as any, nowMs);
      if (!d) {
        logger.warn('[DEPOSIT_LOOKUP] No deposit found — case: [MALFORMED]', { id: doc.id });
        continue;
      }

      const storedRouteEligible =
        typeof data.routeEligible === "boolean" ? Boolean(data.routeEligible) : null;

      const storedPausedUntilMs = toNumOrNull(data?.pausedUntilMs);
      const pauseExpired = storedPausedUntilMs != null && storedPausedUntilMs <= nowMs;

      // se a pausa expirou, limpa fields (nao deixa lixo)
      if (pauseExpired) {
        patches.push({
          ref: doc.ref,
          patch: {
            pausedUntilMs: null,
            pauseReason: null,
            updatedAt: FieldValue.serverTimestamp(),
          },
        });
      }

      const horario = resolveDepositoHorario({ data, nowMs });
      const autoOpenEnabled =
        horario.scheduleFound && (data?.operational?.autoOpenEnabled ?? true);

      if (horario.scheduleFound && autoOpenEnabled) {
        const desiredStatus = horario.open ? "ABERTO" : "FECHADO";
        if (mapStatus(data?.status) !== desiredStatus) {
          patches.push({
            ref: doc.ref,
            patch: {
              status: desiredStatus,
              updatedAt: FieldValue.serverTimestamp(),
            },
          });
        }
      }

      // auto-healing routeEligible (top-level) pra permitir query barata futuramente
      if (storedRouteEligible === null || storedRouteEligible !== d.routeEligible) {
        patches.push({
          ref: doc.ref,
          patch: {
            routeEligible: d.routeEligible,
            timezone: d.timezone ?? DEFAULT_TIMEZONE,
            updatedAt: FieldValue.serverTimestamp(),
          },
        });
      }

      if (!d.routeEligible) {
        logger.warn('[DEPOSIT_LOOKUP] No deposit found — case: [FILTERED_OUT]', {
          depositoId: d.id,
          nome: d.nome,
          status: d.status,
          billing: d.billing?.status,
          quality: d.quality?.statusQualidade,
          pausedUntilMs: d.pausedUntilMs,
          lastSeenAtMs: d.lastSeenAtMs,
          nowMs
        });
        continue;
      }

      out.push(d);
    }

    // commit patches (em lotes)
    if (patches.length > 0) {
      let batch = depsCol.firestore.batch();
      let count = 0;

      for (const p of patches) {
        batch.set(p.ref, p.patch, { merge: true });
        count++;
        if (count >= 450) {
          await batch.commit().catch(() => void 0);
          batch = depsCol.firestore.batch();
          count = 0;
        }
      }
      if (count > 0) await batch.commit().catch(() => void 0);
    }

    out.sort((a, b) => {
      const aStats = a.stats?.last7d ?? {};
      const bStats = b.stats?.last7d ?? {};

      const aNotified = typeof aStats.notifiedToAcceptAvgMin === "number" ? aStats.notifiedToAcceptAvgMin : null;
      const bNotified = typeof bStats.notifiedToAcceptAvgMin === "number" ? bStats.notifiedToAcceptAvgMin : null;
      if (aNotified != null || bNotified != null) {
        if (aNotified == null) return 1;
        if (bNotified == null) return -1;
        if (aNotified !== bNotified) return aNotified - bNotified;
      }

      const aIssues = typeof aStats.issueCount === "number" ? aStats.issueCount : null;
      const bIssues = typeof bStats.issueCount === "number" ? bStats.issueCount : null;
      if (aIssues != null || bIssues != null) {
        if (aIssues == null) return 1;
        if (bIssues == null) return -1;
        if (aIssues !== bIssues) return aIssues - bIssues;
      }

      const aLow = typeof aStats.lowRatingCount === "number" ? aStats.lowRatingCount : null;
      const bLow = typeof bStats.lowRatingCount === "number" ? bStats.lowRatingCount : null;
      if (aLow != null || bLow != null) {
        if (aLow == null) return 1;
        if (bLow == null) return -1;
        if (aLow !== bLow) return aLow - bLow;
      }

      const q = qualidadeRank(a) - qualidadeRank(b);
      if (q !== 0) return q;

      const ar = typeof a.lastRoutedAtMs === "number" ? a.lastRoutedAtMs : 0;
      const br = typeof b.lastRoutedAtMs === "number" ? b.lastRoutedAtMs : 0;
      return ar - br;
    });

    if (out.length === 0) {
      logger.warn('[DEPOSIT_LOOKUP] Result count: 0 (post-filter)', { tenantCnpj, bairro });
    } else {
      logger.info('[DEPOSIT_LOOKUP] Success.', { resultCount: out.length });
    }

    bairroCache.set(key, { atMs: nowMs, data: out });
    return out;

  } catch (error) {
    logger.error('[DEPOSIT_LOOKUP] Exception thrown:', error);
    return []; 
  }
}

// MODIFIED: Added logger warning for empty candidates
export async function getRoundRobinNextDeposito(params: {
  tenantCnpj: string;
  bairro: string;
  canal: "DELIVERY" | "RETIRADA" | "CONSULTA" | null;
  excludeIds?: string[];
}): Promise<{ selected: Deposito | null; candidates: Deposito[] }> {
  const { tenantCnpj, bairro, canal } = params;
  const exclude = new Set((params.excludeIds ?? []).map((x) => String(x)));
  const candidatos = (await listarDepositosAbertosPorBairro(tenantCnpj, bairro)).filter((d) => {
    if (exclude.has(d.id)) return false;
    if (canal === "DELIVERY" && !d.deliveryDisponivel) return false;
    if (canal === "RETIRADA" && !d.retiradaDisponivel) return false;
    return true;
  });

  if (!candidatos.length) {
    logger.warn('[DEPOSIT_ROUTING] No candidates found for round-robin.', { tenantCnpj, bairro, canal });
    return { selected: null, candidates: [] };
  }

  const stateId = `${bairro.trim().toLowerCase().replace(/\s+/g, "_")}__${
    String(canal ?? "").toLowerCase()
  }`;
  const stateCol = routingStateCol(tenantCnpj);
  const stateRef = stateCol.doc(stateId);

  let selected: Deposito | null = null;

  await stateCol.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(stateRef);
    const lastDepositoId = snap.exists ? String((snap.data() as any)?.lastDepositoId ?? "") : "";

    let idx = 0;
    if (lastDepositoId) {
      const found = candidatos.findIndex((d) => d.id === lastDepositoId);
      idx = found >= 0 ? (found + 1) % candidatos.length : 0;
    }

    selected = candidatos[idx] ?? null;

    tx.set(
      stateRef,
      {
        bairro: bairro ?? null,
        canal: canal ?? null,
        lastDepositoId: selected ? selected.id : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  return { selected, candidates: candidatos };
}


export async function markDepositoAck(params: { tenantCnpj: string; depositoId: string }): Promise<void> {
  const nowMs = Date.now();
  await depositosCol(params.tenantCnpj)
    .doc(params.depositoId)
    .set(
      {
        lastAckAtMs: nowMs,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    .catch(() => void 0);
}
