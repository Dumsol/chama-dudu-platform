import * as logger from "firebase-functions/logger";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, db } from "../infra/config/firebase";
import { isFeatureEnabled } from "../infra/config/featureFlags";
import {
  LEGACY_MIGRATORS,
  LEGACY_ROOT_COLLECTIONS,
  buildLegacyAuditReport,
  countCollectionDocuments,
  extractTenantIdFromData,
  type LegacyRootCollection,
  type SuggestedAction,
} from "../tools/legacyRootCollections";
import {
  platformAuditAlertsCol,
  platformAuditProjectsCol,
  platformAuditRunsCol,
} from "../infra/firestore/duduPaths";
import {
  classifyOperationalStatus,
  computeDeltaStatus,
  type MonitorCollectionStatus,
  type MonitorDeltaStatus,
} from "../domain/audit/monitorLogic";

type PreviousCollectionSnapshot = {
  collection: LegacyRootCollection;
  total: number;
  sampleIds: string[];
};

type CollectionRunStatus = {
  collection: LegacyRootCollection;
  total: number;
  sampleIds: string[];
  sampleAnalyzed: number;
  sampleWithTenantId: number;
  sampleWithoutTenantId: number;
  suggestedAction: SuggestedAction;
  recentDocCount: number;
  newestDocTimestamp: string | null;
  deltaStatus: MonitorDeltaStatus;
  deltaTotal: number;
  newSampleIds: string[];
  status: MonitorCollectionStatus;
  knownStableResidual: boolean;
};

type MonitorSnapshot = {
  projectId: string;
  generatedAt: string;
  collections: CollectionRunStatus[];
  status: "OK" | "ALERT";
  alertCollections: LegacyRootCollection[];
  notes: string[];
};

const REGION = "southamerica-east1";
const TIME_ZONE = "America/Sao_Paulo";
const DEFAULT_SCHEDULE = "every day 06:40";
const SAMPLE_LIMIT = Math.max(1, Math.min(Number(process.env.LEGACY_AUDIT_SAMPLE_LIMIT ?? "8"), 50));
const ANALYZE_LIMIT = Math.max(1, Math.min(Number(process.env.LEGACY_AUDIT_ANALYZE_LIMIT ?? "200"), 2000));
const RECENT_WINDOW_HOURS = Math.max(1, Math.min(Number(process.env.LEGACY_AUDIT_RECENT_WINDOW_HOURS ?? "72"), 720));
const THROW_ON_ALERT = String(process.env.LEGACY_AUDIT_THROW_ON_ALERT ?? "true").toLowerCase() === "true";

function platformAuditProjectDoc(projectId: string) {
  return platformAuditProjectsCol().doc(projectId);
}

function parseKnownStableResiduals(): Set<string> {
  const value = String(process.env.LEGACY_AUDIT_KNOWN_STABLE_RESIDUALS ?? "").trim();
  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return new Set(entries);
}

function parseNewestTimestampIso(data: Record<string, unknown>): string | null {
  const candidates = ["updatedAt", "createdAt", "lastUpdatedAt", "lastCreatedAt", "timestamp", "receivedAt"];
  for (const key of candidates) {
    const raw = (data as Record<string, unknown>)[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    const toDate = (raw as { toDate?: () => Date } | null)?.toDate;
    if (typeof toDate === "function") {
      const dt = toDate.call(raw);
      if (dt instanceof Date && Number.isFinite(dt.getTime())) return dt.toISOString();
    }
  }
  return null;
}

function toPreviousSnapshotMap(snapshot: unknown): Map<LegacyRootCollection, PreviousCollectionSnapshot> {
  const map = new Map<LegacyRootCollection, PreviousCollectionSnapshot>();
  const list = (snapshot as { collections?: unknown[] } | null)?.collections;
  if (!Array.isArray(list)) return map;
  for (const item of list) {
    const collection = String((item as Record<string, unknown>)?.collection ?? "") as LegacyRootCollection;
    if (!LEGACY_ROOT_COLLECTIONS.includes(collection)) continue;
    const total = Number((item as Record<string, unknown>)?.total ?? 0);
    const sampleIdsRaw = (item as Record<string, unknown>)?.sampleIds;
    const sampleIds = Array.isArray(sampleIdsRaw)
      ? sampleIdsRaw.map((id) => String(id ?? "").trim()).filter(Boolean)
      : [];
    map.set(collection, {
      collection,
      total: Number.isFinite(total) ? total : 0,
      sampleIds,
    });
  }
  return map;
}

async function hasKnownStableEquivalent(params: {
  collection: LegacyRootCollection;
  sampleId: string;
  tenantId: string | null;
  knownStableSet: Set<string>;
}): Promise<boolean> {
  const sigSimple = `${params.collection}:${params.sampleId}`;
  const sigTenant = params.tenantId ? `${sigSimple}@${params.tenantId}` : "";
  if (!params.knownStableSet.has(sigSimple) && (!sigTenant || !params.knownStableSet.has(sigTenant))) {
    return false;
  }
  if (!params.tenantId) return false;

  const migrator = LEGACY_MIGRATORS.find((item) => item.source === params.collection);
  if (!migrator) return false;
  const targetSnap = await migrator.target(params.tenantId).doc(params.sampleId).get().catch(() => null as any);
  return Boolean(targetSnap?.exists);
}

async function buildCollectionStatus(params: {
  collection: LegacyRootCollection;
  previous: PreviousCollectionSnapshot | null;
  knownStableSet: Set<string>;
}): Promise<CollectionRunStatus> {
  const nowMs = Date.now();
  const recentWindowMs = RECENT_WINDOW_HOURS * 60 * 60 * 1000;
  const collectionRef = db.collection(params.collection);
  const total = await countCollectionDocuments(db, params.collection);
  const sampleSnap = await collectionRef.orderBy("__name__").limit(SAMPLE_LIMIT).get();
  const analyzeSnap = await collectionRef.orderBy("__name__").limit(ANALYZE_LIMIT).get();

  let sampleWithTenantId = 0;
  let sampleWithoutTenantId = 0;
  let recentDocCount = 0;
  let newestDocTimestamp: string | null = null;
  let knownStableResidual = false;

  for (const doc of analyzeSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const tenantId = extractTenantIdFromData(data);
    if (tenantId) sampleWithTenantId += 1;
    else sampleWithoutTenantId += 1;

    const tsIso = parseNewestTimestampIso(data);
    if (tsIso) {
      if (!newestDocTimestamp || Date.parse(tsIso) > Date.parse(newestDocTimestamp)) newestDocTimestamp = tsIso;
      const ms = Date.parse(tsIso);
      if (Number.isFinite(ms) && nowMs - ms <= recentWindowMs) recentDocCount += 1;
    }

    if (!knownStableResidual) {
      knownStableResidual = await hasKnownStableEquivalent({
        collection: params.collection,
        sampleId: doc.id,
        tenantId,
        knownStableSet: params.knownStableSet,
      });
    }
  }

  const sampleIds = sampleSnap.docs.map((doc) => doc.id);
  const base = buildLegacyAuditReport({
    collection: params.collection,
    total,
    sampleIds,
    sampleWithTenantId,
    sampleWithoutTenantId,
  });

  const delta = computeDeltaStatus({
    currentTotal: total,
    currentSampleIds: sampleIds,
    previousTotal: params.previous?.total ?? null,
    previousSampleIds: params.previous?.sampleIds ?? [],
  });

  const status = classifyOperationalStatus({
    total,
    deltaStatus: delta.deltaStatus,
    recentDocCount,
    knownStableResidual,
  });

  return {
    ...base,
    recentDocCount,
    newestDocTimestamp,
    deltaStatus: delta.deltaStatus,
    deltaTotal: delta.deltaTotal,
    newSampleIds: delta.newSampleIds,
    status,
    knownStableResidual,
  };
}

export async function runLegacyRootAuditMonitor(params?: {
  projectId?: string;
  runId?: string;
  generatedAtIso?: string;
}): Promise<MonitorSnapshot> {
  const projectId =
    String(
      params?.projectId ??
        process.env.GCLOUD_PROJECT ??
        process.env.GOOGLE_CLOUD_PROJECT ??
        process.env.FIREBASE_PROJECT ??
        "unknown-project",
    ).trim() || "unknown-project";
  const generatedAt = params?.generatedAtIso ?? new Date().toISOString();
  const runId =
    params?.runId ??
    generatedAt
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")
      .replace("T", "_");

  const knownStableSet = parseKnownStableResiduals();
  const projectDoc = platformAuditProjectDoc(projectId);
  const previousSnapshotMap = toPreviousSnapshotMap((await projectDoc.get()).data()?.latestSnapshot ?? null);

  const collections: CollectionRunStatus[] = [];
  for (const collection of LEGACY_ROOT_COLLECTIONS) {
    const previous = previousSnapshotMap.get(collection) ?? null;
    const item = await buildCollectionStatus({
      collection,
      previous,
      knownStableSet,
    });
    collections.push(item);
  }

  const alertCollections = collections
    .filter((item) => item.status === "suspeita_write_ativo")
    .map((item) => item.collection);

  const notes = [
    "status=OK significa zero documentos na collection raiz proibida ou limpeza concluida",
    "status=residuo_historico_estavel indica resíduo sem crescimento (ou marcado como conhecido e validado)",
    "status=suspeita_write_ativo indica novo resíduo ou crescimento suspeito",
  ];

  const snapshot: MonitorSnapshot = {
    projectId,
    generatedAt,
    collections,
    status: alertCollections.length > 0 ? "ALERT" : "OK",
    alertCollections,
    notes,
  };

  await platformAuditRunsCol(projectId).doc(runId).set({
    ...snapshot,
    createdAt: FieldValue.serverTimestamp(),
    runId,
  });
  await projectDoc.set(
    {
      latestSnapshot: snapshot,
      latestRunId: runId,
      updatedAt: FieldValue.serverTimestamp(),
      lastAlertCollections: alertCollections,
      lastStatus: snapshot.status,
    },
    { merge: true },
  );

  if (snapshot.status === "ALERT") {
    await platformAuditAlertsCol(projectId).doc(runId).set({
      runId,
      projectId,
      generatedAt,
      alertCollections,
      createdAt: FieldValue.serverTimestamp(),
      severity: "ERROR",
    });
  }

  return snapshot;
}

export const legacyRootAuditMonitorDaily = onSchedule(
  {
    schedule: process.env.LEGACY_AUDIT_SCHEDULE || DEFAULT_SCHEDULE,
    timeZone: TIME_ZONE,
    region: REGION,
  },
  legacyRootAuditMonitorDailyHandler
);

export async function legacyRootAuditMonitorDailyHandler() {
    if (!isFeatureEnabled("FEATURE_LEGACY_ROOT_AUDIT_MONITOR_ENABLED", true)) {
      logger.warn("LEGACY_ROOT_AUDIT_MONITOR_DISABLED");
      return;
    }

    const report = await runLegacyRootAuditMonitor();

    if (report.status === "ALERT") {
      logger.error("LEGACY_ROOT_AUDIT_ALERT", {
        projectId: report.projectId,
        alertCollections: report.alertCollections,
        collections: report.collections.map((item) => ({
          collection: item.collection,
          total: item.total,
          status: item.status,
          deltaStatus: item.deltaStatus,
          deltaTotal: item.deltaTotal,
          newSampleIds: item.newSampleIds,
        })),
      });

      if (THROW_ON_ALERT) {
        throw new Error(`LEGACY_ROOT_AUDIT_ALERT collections=${report.alertCollections.join(",")}`);
      }
      return;
    }

    logger.info("LEGACY_ROOT_AUDIT_OK", {
      projectId: report.projectId,
      collections: report.collections.map((item) => ({
        collection: item.collection,
        total: item.total,
        status: item.status,
        deltaStatus: item.deltaStatus,
      })),
    });
}
