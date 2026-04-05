import { FieldValue } from "firebase-admin/firestore";
import type * as FirebaseFirestore from "firebase-admin/firestore";
import { tenantsCol, usersCol } from "../infra/firestore/duduPaths";

const PAGE_SIZE = 300;
const NULLABLE_USER_FIELDS = [
  "activeOrderId",
  "bsuId",
  "waUsername",
  "name",
  "botStateExpiresAtMs",
  "slots",
  "lastIntent",
  "lastIntentConfidence",
  "bairro",
  "bairroNorm",
  "beverage",
  "beverageBrand",
  "beverageVolumeMl",
  "beveragePackType",
  "hasVasilhame",
  "paymentMethod",
] as const;

function parseTenantIdsFromEnv(): string[] {
  return String(process.env.USERS_SANITIZE_TENANTS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function resolveTenantIds(): Promise<string[]> {
  const fromEnv = parseTenantIdsFromEnv();
  if (fromEnv.length > 0) return fromEnv;
  const snap = await tenantsCol().get();
  return snap.docs.map((doc) => String(doc.id).trim()).filter(Boolean);
}

async function sanitizeTenantUsers(tenantId: string): Promise<{ scanned: number; updated: number }> {
  let scanned = 0;
  let updated = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;

  while (true) {
    let query = usersCol(tenantId).orderBy("__name__").limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.get();
    if (snap.empty) break;

    const batch = snap.docs[0].ref.firestore.batch();
    let dirtyInPage = 0;

    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data() as Record<string, unknown>;
      const patch: Record<string, unknown> = {};

      for (const field of NULLABLE_USER_FIELDS) {
        if (data[field] === null) {
          patch[field] = FieldValue.delete();
        }
      }

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = FieldValue.serverTimestamp();
        batch.set(doc.ref, patch, { merge: true });
        dirtyInPage += 1;
      }
    }

    if (dirtyInPage > 0) {
      await batch.commit();
      updated += dirtyInPage;
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  return { scanned, updated };
}

async function main(): Promise<void> {
  const tenantIds = await resolveTenantIds();
  if (tenantIds.length === 0) {
    console.log("sanitizeUsersNullFields: no tenants found");
    return;
  }

  let totalScanned = 0;
  let totalUpdated = 0;

  for (const tenantId of tenantIds) {
    const result = await sanitizeTenantUsers(tenantId);
    totalScanned += result.scanned;
    totalUpdated += result.updated;
    console.log(
      `sanitizeUsersNullFields: tenant=${tenantId} scanned=${String(result.scanned)} updated=${String(
        result.updated,
      )}`,
    );
  }

  console.log(
    `sanitizeUsersNullFields: done tenants=${String(tenantIds.length)} scanned=${String(
      totalScanned,
    )} updated=${String(totalUpdated)}`,
  );
}

void main();
