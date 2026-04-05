import { execSync } from "node:child_process";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { LEGACY_MIGRATORS, decideLegacyMigration } from "./legacyRootCollections";

const DRY_RUN = String(process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const FORCE_OVERWRITE = String(process.env.FORCE_OVERWRITE ?? "false").toLowerCase() === "true";
const DELETE_SOURCE_AFTER_MIGRATION =
  String(process.env.DELETE_SOURCE_AFTER_MIGRATION ?? "false").toLowerCase() === "true";
const DELETE_SOURCE_IF_TARGET_EXISTS =
  String(process.env.DELETE_SOURCE_IF_TARGET_EXISTS ?? "false").toLowerCase() === "true";
const PAGE_SIZE = Math.max(50, Math.min(Number(process.env.PAGE_SIZE ?? "250"), 500));
const BATCH_SIZE = Math.max(20, Math.min(Number(process.env.BATCH_SIZE ?? "200"), 400));
const AUTH_MODE = String(process.env.AUTH_MODE ?? "auto").toLowerCase(); // auto|admin|gcloud
const PROJECT_ID =
  String(
    process.env.PROJECT_ID ??
      process.env.GCLOUD_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      process.env.FIREBASE_PROJECT ??
      "your-project-id",
  ).trim() || "your-project-id";

type RestDocument = {
  name: string;
  fields?: Record<string, unknown>;
};

type MigrationStats = {
  source: string;
  scanned: number;
  migrated: number;
  dryRunMigrated: number;
  skippedMissingTenant: number;
  skippedExisting: number;
  deleteEligibleExisting: number;
  deletedSource: number;
  errors: number;
  orphanIds: string[];
};

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

function extractTenantIdFromRestFields(fields: Record<string, unknown> | undefined): string | null {
  const tenantField = (fields as any)?.tenantId;
  const tenantId = String(tenantField?.stringValue ?? "").trim();
  return tenantId || null;
}

function getDocIdFromName(name: string): string {
  const parts = String(name ?? "").split("/");
  return parts[parts.length - 1] ?? "";
}

function buildDocumentName(path: string, docId: string): string {
  return `projects/${PROJECT_ID}/databases/(default)/documents/${path}/${docId}`;
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
}): Promise<{ documents: RestDocument[]; nextPageToken: string }> {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      PROJECT_ID,
    )}/databases/(default)/documents/${encodeURIComponent(params.collection)}`,
  );
  url.searchParams.set("pageSize", String(PAGE_SIZE));
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

async function restGetDoc(params: {
  token: string;
  path: string;
  docId: string;
}): Promise<{ exists: boolean }> {
  const name = buildDocumentName(params.path, params.docId);
  const url = `https://firestore.googleapis.com/v1/${name}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${params.token}` },
  });
  if (response.status === 404) return { exists: false };
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`REST_GET_FAILED ${params.path}/${params.docId} status=${response.status} body=${body}`);
  }
  return { exists: true };
}

async function restCreateDoc(params: {
  token: string;
  path: string;
  docId: string;
  fields: Record<string, unknown>;
}): Promise<void> {
  const parent = `projects/${PROJECT_ID}/databases/(default)/documents/${params.path}`;
  const url = new URL(`https://firestore.googleapis.com/v1/${parent}`);
  url.searchParams.set("documentId", params.docId);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: params.fields }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`REST_CREATE_FAILED ${params.path}/${params.docId} status=${response.status} body=${body}`);
  }
}

async function restPatchDoc(params: {
  token: string;
  path: string;
  docId: string;
  fields: Record<string, unknown>;
}): Promise<void> {
  const name = buildDocumentName(params.path, params.docId);
  const url = `https://firestore.googleapis.com/v1/${name}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: params.fields }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`REST_PATCH_FAILED ${params.path}/${params.docId} status=${response.status} body=${body}`);
  }
}

async function restDeleteDoc(params: {
  token: string;
  source: string;
  docId: string;
}): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${params.source}/${params.docId}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${params.token}` },
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`REST_DELETE_FAILED ${params.source}/${params.docId} status=${response.status} body=${body}`);
  }
}

async function migrateWithRestToken(def: (typeof LEGACY_MIGRATORS)[number], token: string): Promise<MigrationStats> {
  const stats: MigrationStats = {
    source: def.source,
    scanned: 0,
    migrated: 0,
    dryRunMigrated: 0,
    skippedMissingTenant: 0,
    skippedExisting: 0,
    deleteEligibleExisting: 0,
    deletedSource: 0,
    errors: 0,
    orphanIds: [],
  };

  let pageToken = "";
  while (true) {
    const page = await fetchRestPage({
      token,
      collection: def.source,
      pageToken: pageToken || undefined,
    });
    if (!page.documents.length) break;

    for (const doc of page.documents) {
      stats.scanned += 1;
      const docId = getDocIdFromName(doc.name);
      const tenantId = extractTenantIdFromRestFields(doc.fields);

      if (!tenantId) {
        stats.skippedMissingTenant += 1;
        if (stats.orphanIds.length < 25) stats.orphanIds.push(docId);
        continue;
      }

      const targetPath = def.target(tenantId).path;
      const targetExists = (await restGetDoc({ token, path: targetPath, docId })).exists;

      const decision = decideLegacyMigration({
        data: { tenantId },
        targetExists,
        dryRun: DRY_RUN,
        forceOverwrite: FORCE_OVERWRITE,
      });

      if (decision.action === "skip_missing_tenant") {
        stats.skippedMissingTenant += 1;
        if (stats.orphanIds.length < 25) stats.orphanIds.push(docId);
        continue;
      }
      if (decision.action === "skip_existing") {
        stats.skippedExisting += 1;
        if (DELETE_SOURCE_IF_TARGET_EXISTS) {
          stats.deleteEligibleExisting += 1;
          if (!DRY_RUN && DELETE_SOURCE_AFTER_MIGRATION) {
            await restDeleteDoc({ token, source: def.source, docId });
            stats.deletedSource += 1;
          }
        }
        continue;
      }
      if (decision.action === "dry_run_migrate") {
        stats.dryRunMigrated += 1;
        continue;
      }

      try {
        const nowIso = new Date().toISOString();
        const sourceFields = (doc.fields ?? {}) as Record<string, unknown>;
        const mergedFields: Record<string, unknown> = {
          ...sourceFields,
          tenantId: { stringValue: tenantId },
          migratedFromLegacyRoot: {
            mapValue: {
              fields: {
                sourceCollection: { stringValue: def.source },
                sourceDocId: { stringValue: docId },
                migratedAt: { timestampValue: nowIso },
              },
            },
          },
          updatedAt: { timestampValue: nowIso },
        };

        if (targetExists && FORCE_OVERWRITE) {
          await restPatchDoc({ token, path: targetPath, docId, fields: mergedFields });
        } else {
          await restCreateDoc({ token, path: targetPath, docId, fields: mergedFields });
        }

        stats.migrated += 1;
        if (DELETE_SOURCE_AFTER_MIGRATION) {
          await restDeleteDoc({ token, source: def.source, docId });
          stats.deletedSource += 1;
        }
      } catch (error) {
        stats.errors += 1;
        console.error(`MIGRATION_DOC_ERROR ${def.source}/${docId}`, error);
      }
    }

    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  return stats;
}

async function migrateWithAdminSdk(def: (typeof LEGACY_MIGRATORS)[number]): Promise<MigrationStats> {
  ensureAdminApp();
  const db = getFirestore();

  const stats: MigrationStats = {
    source: def.source,
    scanned: 0,
    migrated: 0,
    dryRunMigrated: 0,
    skippedMissingTenant: 0,
    skippedExisting: 0,
    deleteEligibleExisting: 0,
    deletedSource: 0,
    errors: 0,
    orphanIds: [],
  };

  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let writeBatch = db.batch();
  let pendingWrites = 0;

  const flushWrites = async (): Promise<void> => {
    if (pendingWrites <= 0) return;
    await writeBatch.commit();
    writeBatch = db.batch();
    pendingWrites = 0;
  };

  while (true) {
    let query: FirebaseFirestore.Query = db.collection(def.source).orderBy("__name__").limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      stats.scanned += 1;
      const data = doc.data() as Record<string, unknown>;
      const tenantId = String(data?.tenantId ?? "").trim();

      if (!tenantId) {
        stats.skippedMissingTenant += 1;
        if (stats.orphanIds.length < 25) stats.orphanIds.push(doc.id);
        continue;
      }

      const targetRef = def.target(tenantId).doc(doc.id);
      const targetSnap = await targetRef.get().catch(() => null as any);
      const targetExists = Boolean(targetSnap?.exists);

      const decision = decideLegacyMigration({
        data,
        targetExists,
        dryRun: DRY_RUN,
        forceOverwrite: FORCE_OVERWRITE,
      });

      if (decision.action === "skip_missing_tenant") {
        stats.skippedMissingTenant += 1;
        if (stats.orphanIds.length < 25) stats.orphanIds.push(doc.id);
        continue;
      }
      if (decision.action === "skip_existing") {
        stats.skippedExisting += 1;
        if (DELETE_SOURCE_IF_TARGET_EXISTS) {
          stats.deleteEligibleExisting += 1;
          if (!DRY_RUN && DELETE_SOURCE_AFTER_MIGRATION) {
            writeBatch.delete(doc.ref);
            pendingWrites += 1;
            stats.deletedSource += 1;
            if (pendingWrites >= BATCH_SIZE) await flushWrites();
          }
        }
        continue;
      }
      if (decision.action === "dry_run_migrate") {
        stats.dryRunMigrated += 1;
        continue;
      }

      try {
        writeBatch.set(
          targetRef,
          {
            ...data,
            tenantId,
            migratedFromLegacyRoot: {
              sourceCollection: def.source,
              sourceDocId: doc.id,
              migratedAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        pendingWrites += 1;
        stats.migrated += 1;

        if (DELETE_SOURCE_AFTER_MIGRATION) {
          writeBatch.delete(doc.ref);
          pendingWrites += 1;
          stats.deletedSource += 1;
        }

        if (pendingWrites >= BATCH_SIZE) await flushWrites();
      } catch (error) {
        stats.errors += 1;
        console.error(`MIGRATION_DOC_ERROR ${def.source}/${doc.id}`, error);
      }
    }

    cursor = snap.docs[snap.docs.length - 1];
  }

  await flushWrites();
  return stats;
}

async function main(): Promise<void> {
  const allStats: MigrationStats[] = [];
  let authMode = AUTH_MODE;

  if (AUTH_MODE === "admin") {
    for (const migrator of LEGACY_MIGRATORS) {
      allStats.push(await migrateWithAdminSdk(migrator));
    }
    authMode = "admin";
  } else if (AUTH_MODE === "gcloud") {
    const token = getGcloudToken();
    for (const migrator of LEGACY_MIGRATORS) {
      allStats.push(await migrateWithRestToken(migrator, token));
    }
    authMode = "gcloud-token";
  } else {
    try {
      for (const migrator of LEGACY_MIGRATORS) {
        allStats.push(await migrateWithAdminSdk(migrator));
      }
      authMode = "admin";
    } catch (error: any) {
      const msg = String(error?.message ?? error ?? "");
      if (!msg.toLowerCase().includes("default credentials")) throw error;
      allStats.length = 0;
      const token = getGcloudToken();
      for (const migrator of LEGACY_MIGRATORS) {
        allStats.push(await migrateWithRestToken(migrator, token));
      }
      authMode = "gcloud-token";
    }
  }

  for (const stats of allStats) {
    console.log(
      `MIGRATION_DONE ${stats.source} scanned=${stats.scanned} migrated=${stats.migrated} dry=${stats.dryRunMigrated} skippedMissingTenant=${stats.skippedMissingTenant} skippedExisting=${stats.skippedExisting} deleteEligibleExisting=${stats.deleteEligibleExisting} deletedSource=${stats.deletedSource} errors=${stats.errors} dryRun=${DRY_RUN}`,
    );
  }

  console.log("MIGRATION_REPORT");
  console.log(
    JSON.stringify(
      {
        projectId: PROJECT_ID,
        authMode,
        dryRun: DRY_RUN,
        forceOverwrite: FORCE_OVERWRITE,
        deleteSourceAfterMigration: DELETE_SOURCE_AFTER_MIGRATION,
        deleteSourceIfTargetExists: DELETE_SOURCE_IF_TARGET_EXISTS,
        generatedAt: new Date().toISOString(),
        collections: allStats,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("MIGRATION_FAILED", error);
  process.exit(1);
});
