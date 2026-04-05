import type { Firestore } from "firebase-admin/firestore";
import {
  depositosCol,
  messagesCol,
  preCadastrosCol,
  printQueueCol,
  processedMessagesCol,
  rateLimitsCol,
  usersCol,
} from "../infra/firestore/duduPaths";

export const LEGACY_ROOT_COLLECTIONS = [
  "users",
  "depositos",
  "mensagens",
  "processedMessages",
  "precadastros",
  "rateLimits",
  "printQueue",
] as const;

export type LegacyRootCollection = (typeof LEGACY_ROOT_COLLECTIONS)[number];

export type LegacyCollectionMigrator = {
  source: LegacyRootCollection;
  target: (tenantId: string) => FirebaseFirestore.CollectionReference;
};

export const LEGACY_MIGRATORS: LegacyCollectionMigrator[] = [
  { source: "users", target: usersCol },
  { source: "depositos", target: depositosCol },
  { source: "mensagens", target: messagesCol },
  { source: "processedMessages", target: processedMessagesCol },
  { source: "precadastros", target: preCadastrosCol },
  { source: "rateLimits", target: rateLimitsCol },
  { source: "printQueue", target: printQueueCol },
];

export type SuggestedAction =
  | "ja_vazio"
  | "migrar"
  | "migrar_com_orfaos"
  | "investigar_orfaos";

export type LegacyAuditReport = {
  collection: LegacyRootCollection;
  total: number;
  sampleIds: string[];
  sampleAnalyzed: number;
  sampleWithTenantId: number;
  sampleWithoutTenantId: number;
  suggestedAction: SuggestedAction;
};

export function extractTenantIdFromData(data: unknown): string | null {
  const raw = (data as Record<string, unknown> | null)?.tenantId;
  const tenantId = String(raw ?? "").trim();
  return tenantId || null;
}

export function suggestLegacyAction(params: {
  total: number;
  sampleWithTenantId: number;
  sampleWithoutTenantId: number;
}): SuggestedAction {
  if (params.total <= 0) return "ja_vazio";
  if (params.sampleWithoutTenantId <= 0) return "migrar";
  if (params.sampleWithTenantId > 0) return "migrar_com_orfaos";
  return "investigar_orfaos";
}

export function buildLegacyAuditReport(params: {
  collection: LegacyRootCollection;
  total: number;
  sampleIds: string[];
  sampleWithTenantId: number;
  sampleWithoutTenantId: number;
}): LegacyAuditReport {
  const sampleAnalyzed = params.sampleWithTenantId + params.sampleWithoutTenantId;
  return {
    collection: params.collection,
    total: params.total,
    sampleIds: params.sampleIds,
    sampleAnalyzed,
    sampleWithTenantId: params.sampleWithTenantId,
    sampleWithoutTenantId: params.sampleWithoutTenantId,
    suggestedAction: suggestLegacyAction({
      total: params.total,
      sampleWithTenantId: params.sampleWithTenantId,
      sampleWithoutTenantId: params.sampleWithoutTenantId,
    }),
  };
}

export async function countCollectionDocuments(
  db: Firestore,
  collection: string,
): Promise<number> {
  const col = db.collection(collection);
  const countFn = (col as unknown as { count?: () => { get: () => Promise<any> } }).count;
  if (typeof countFn === "function") {
    const agg = await countFn.call(col).get();
    const count = Number(agg?.data?.()?.count ?? agg?.data()?.count ?? 0);
    if (Number.isFinite(count)) return count;
  }

  let total = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let query: FirebaseFirestore.Query = col.orderBy("__name__").limit(500);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;
    total += snap.size;
    cursor = snap.docs[snap.docs.length - 1];
  }
  return total;
}

export type MigrationDecision =
  | { action: "skip_missing_tenant" }
  | { action: "skip_existing" }
  | { action: "dry_run_migrate"; tenantId: string }
  | { action: "migrate"; tenantId: string };

export function decideLegacyMigration(params: {
  data: unknown;
  targetExists: boolean;
  dryRun: boolean;
  forceOverwrite: boolean;
}): MigrationDecision {
  const tenantId = extractTenantIdFromData(params.data);
  if (!tenantId) return { action: "skip_missing_tenant" };
  if (params.targetExists && !params.forceOverwrite) return { action: "skip_existing" };
  if (params.dryRun) return { action: "dry_run_migrate", tenantId };
  return { action: "migrate", tenantId };
}
