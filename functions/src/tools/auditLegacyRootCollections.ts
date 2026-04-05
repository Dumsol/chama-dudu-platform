import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  LEGACY_ROOT_COLLECTIONS,
  buildLegacyAuditReport,
  countCollectionDocuments,
  extractTenantIdFromData,
} from "./legacyRootCollections";

type RestDocument = {
  name: string;
  fields?: Record<string, unknown>;
};

const SAMPLE_LIMIT = Math.max(1, Math.min(Number(process.env.SAMPLE_LIMIT ?? "8"), 50));
const ANALYZE_LIMIT = Math.max(1, Math.min(Number(process.env.ANALYZE_LIMIT ?? "200"), 2000));
const PAGE_SIZE = Math.max(20, Math.min(Number(process.env.PAGE_SIZE ?? "300"), 1000));
const RECENT_WINDOW_HOURS = Math.max(1, Math.min(Number(process.env.RECENT_WINDOW_HOURS ?? "72"), 720));
const FAIL_IF_FOUND = String(process.env.FAIL_IF_FOUND ?? "false").toLowerCase() === "true";
const REPORT_JSON_PATH = String(process.env.REPORT_JSON_PATH ?? "").trim();
const REPORT_MD_PATH = String(process.env.REPORT_MD_PATH ?? "").trim();
const AUTH_MODE = String(process.env.AUTH_MODE ?? "auto").toLowerCase(); // auto|admin|gcloud
const PROJECT_ID =
  String(
    process.env.PROJECT_ID ??
      process.env.GCLOUD_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.FIREBASE_PROJECT ??
      "your-project-id",
  ).trim() || "your-project-id";

function ensureAdminApp(): void {
  if (getApps().length) return;
  const rawServiceAccount = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
  ).trim();
  if (rawServiceAccount) {
    const parsed = JSON.parse(rawServiceAccount) as Record<string, unknown>;
    initializeApp({
      credential: cert(parsed as any),
      projectId: PROJECT_ID,
    });
    return;
  }
  initializeApp();
}

function getDocIdFromName(name: string): string {
  const parts = String(name ?? "").split("/");
  return parts[parts.length - 1] ?? "";
}

function getRestField(fields: Record<string, unknown> | undefined, key: string): unknown {
  return (fields as Record<string, any> | undefined)?.[key];
}

function getStringFromRestField(field: unknown): string | null {
  const v = (field as any)?.stringValue;
  const out = String(v ?? "").trim();
  return out || null;
}

function getTimestampFromRestField(field: unknown): string | null {
  const t = String((field as any)?.timestampValue ?? "").trim();
  return t || null;
}

function extractTenantIdFromRestFields(fields: Record<string, unknown> | undefined): string | null {
  return getStringFromRestField(getRestField(fields, "tenantId"));
}

function extractNewestTimestampIso(fields: Record<string, unknown> | undefined): string | null {
  const candidates = ["updatedAt", "createdAt", "lastUpdatedAt", "lastCreatedAt", "timestamp", "receivedAt"];
  for (const key of candidates) {
    const ts = getTimestampFromRestField(getRestField(fields, key));
    if (ts) return ts;
  }
  return null;
}

function classifyOperationalState(params: {
  total: number;
  sampleWithoutTenantId: number;
  recentDocCount: number;
}): "vazio" | "residuo_historico_migravel" | "residuo_historico_orfao" | "suspeita_write_ativo_indevido" {
  if (params.total <= 0) return "vazio";
  if (params.recentDocCount > 0) return "suspeita_write_ativo_indevido";
  if (params.sampleWithoutTenantId > 0) return "residuo_historico_orfao";
  return "residuo_historico_migravel";
}

function toMarkdown(report: any): string {
  const lines: string[] = [];
  lines.push(`# Legacy Root Collections Audit`);
  lines.push(``);
  lines.push(`- projectId: \`${report.projectId}\``);
  lines.push(`- authMode: \`${report.authMode}\``);
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(``);
  lines.push(`| collection | total | sampleWithTenantId | sampleWithoutTenantId | recentDocCount | suggestedAction | classification |`);
  lines.push(`|---|---:|---:|---:|---:|---|---|`);
  for (const item of report.collections as any[]) {
    lines.push(
      `| ${item.collection} | ${item.total} | ${item.sampleWithTenantId} | ${item.sampleWithoutTenantId} | ${item.recentDocCount} | ${item.suggestedAction} | ${item.classification} |`,
    );
  }
  lines.push(``);
  return lines.join("\n");
}

function getGcloudToken(): string {
  const token = execSync("gcloud.cmd auth print-access-token", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim();
  if (!token) throw new Error("gcloud token is empty");
  return token;
}

async function fetchRestPage(params: {
  token: string;
  collection: string;
  pageToken?: string;
  pageSize: number;
}): Promise<{ documents: RestDocument[]; nextPageToken: string }> {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      PROJECT_ID,
    )}/databases/(default)/documents/${encodeURIComponent(params.collection)}`,
  );
  url.searchParams.set("pageSize", String(params.pageSize));
  if (params.pageToken) url.searchParams.set("pageToken", params.pageToken);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${params.token}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`REST_LIST_FAILED collection=${params.collection} status=${response.status} body=${body}`);
  }
  const data = (await response.json()) as any;
  return {
    documents: Array.isArray(data?.documents) ? (data.documents as RestDocument[]) : [],
    nextPageToken: String(data?.nextPageToken ?? ""),
  };
}

async function runAuditWithRestToken(): Promise<any[]> {
  const token = getGcloudToken();
  const nowMs = Date.now();
  const recentWindowMs = RECENT_WINDOW_HOURS * 60 * 60 * 1000;

  const reports: any[] = [];
  for (const collection of LEGACY_ROOT_COLLECTIONS) {
    let total = 0;
    let pageToken = "";
    let sampleWithTenantId = 0;
    let sampleWithoutTenantId = 0;
    let analyzed = 0;
    let recentDocCount = 0;
    let newestDocTimestamp: string | null = null;
    const sampleIds: string[] = [];

    while (true) {
      const page = await fetchRestPage({
        token,
        collection,
        pageToken: pageToken || undefined,
        pageSize: PAGE_SIZE,
      });

      if (!page.documents.length) break;
      total += page.documents.length;

      for (const doc of page.documents) {
        const docId = getDocIdFromName(doc.name);
        if (sampleIds.length < SAMPLE_LIMIT) sampleIds.push(docId);

        const tenantId = extractTenantIdFromRestFields(doc.fields);
        if (analyzed < ANALYZE_LIMIT) {
          if (tenantId) sampleWithTenantId += 1;
          else sampleWithoutTenantId += 1;
          analyzed += 1;
        }

        const tsIso = extractNewestTimestampIso(doc.fields);
        if (tsIso) {
          if (!newestDocTimestamp || Date.parse(tsIso) > Date.parse(newestDocTimestamp)) {
            newestDocTimestamp = tsIso;
          }
          const tsMs = Date.parse(tsIso);
          if (Number.isFinite(tsMs) && nowMs - tsMs <= recentWindowMs) {
            recentDocCount += 1;
          }
        }
      }

      if (!page.nextPageToken) break;
      pageToken = page.nextPageToken;
    }

    const base = buildLegacyAuditReport({
      collection,
      total,
      sampleIds,
      sampleWithTenantId,
      sampleWithoutTenantId,
    });

    reports.push({
      ...base,
      recentDocCount,
      newestDocTimestamp,
      classification: classifyOperationalState({
        total,
        sampleWithoutTenantId,
        recentDocCount,
      }),
    });
  }

  return reports;
}

async function runAuditWithAdminSdk(): Promise<any[]> {
  ensureAdminApp();
  const db = getFirestore();
  const nowMs = Date.now();
  const recentWindowMs = RECENT_WINDOW_HOURS * 60 * 60 * 1000;

  const reports: any[] = [];
  for (const collection of LEGACY_ROOT_COLLECTIONS) {
    const total = await countCollectionDocuments(db, collection);
    const sampleSnap = await db.collection(collection).orderBy("__name__").limit(SAMPLE_LIMIT).get();
    const analyzeSnap = await db.collection(collection).orderBy("__name__").limit(ANALYZE_LIMIT).get();

    let sampleWithTenantId = 0;
    let sampleWithoutTenantId = 0;
    let recentDocCount = 0;
    let newestDocTimestamp: string | null = null;

    for (const doc of analyzeSnap.docs) {
      const data = doc.data();
      if (extractTenantIdFromData(data)) sampleWithTenantId += 1;
      else sampleWithoutTenantId += 1;

      const ts = (data as any)?.updatedAt ?? (data as any)?.createdAt ?? null;
      const iso =
        typeof ts?.toDate === "function"
          ? ts.toDate().toISOString()
          : typeof ts === "string"
            ? ts
            : null;
      if (iso) {
        if (!newestDocTimestamp || Date.parse(iso) > Date.parse(newestDocTimestamp)) newestDocTimestamp = iso;
        const ms = Date.parse(iso);
        if (Number.isFinite(ms) && nowMs - ms <= recentWindowMs) recentDocCount += 1;
      }
    }

    const base = buildLegacyAuditReport({
      collection,
      total,
      sampleIds: sampleSnap.docs.map((doc) => doc.id),
      sampleWithTenantId,
      sampleWithoutTenantId,
    });

    reports.push({
      ...base,
      recentDocCount,
      newestDocTimestamp,
      classification: classifyOperationalState({
        total,
        sampleWithoutTenantId,
        recentDocCount,
      }),
    });
  }

  return reports;
}

async function main(): Promise<void> {
  let reports: any[] = [];
  let authMode = AUTH_MODE;

  if (AUTH_MODE === "admin") {
    reports = await runAuditWithAdminSdk();
    authMode = "admin";
  } else if (AUTH_MODE === "gcloud") {
    reports = await runAuditWithRestToken();
    authMode = "gcloud-token";
  } else {
    try {
      reports = await runAuditWithAdminSdk();
      authMode = "admin";
    } catch (error: any) {
      const msg = String(error?.message ?? error ?? "");
      if (!msg.toLowerCase().includes("default credentials")) throw error;
      reports = await runAuditWithRestToken();
      authMode = "gcloud-token";
    }
  }

  const payload = {
    projectId: PROJECT_ID,
    authMode,
    generatedAt: new Date().toISOString(),
    collections: reports,
  };

  console.log("LEGACY_ROOT_AUDIT_REPORT");
  console.log(JSON.stringify(payload, null, 2));

  if (REPORT_JSON_PATH) {
    writeFileSync(REPORT_JSON_PATH, JSON.stringify(payload, null, 2), "utf8");
    console.log(`LEGACY_ROOT_AUDIT_WRITTEN path=${REPORT_JSON_PATH}`);
  }
  if (REPORT_MD_PATH) {
    writeFileSync(REPORT_MD_PATH, toMarkdown(payload), "utf8");
    console.log(`LEGACY_ROOT_AUDIT_MD_WRITTEN path=${REPORT_MD_PATH}`);
  }

  const hasAnyLegacy = reports.some((item) => Number(item.total ?? 0) > 0);
  if (FAIL_IF_FOUND && hasAnyLegacy) {
    console.error("LEGACY_ROOT_AUDIT_FAIL found documents in legacy root collections");
    process.exit(2);
  }
}

main().catch((error) => {
  console.error("LEGACY_ROOT_AUDIT_ERROR", error);
  process.exit(1);
});
