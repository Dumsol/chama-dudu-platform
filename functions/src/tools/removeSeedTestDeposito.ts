import { db } from "../infra/config/firebase";
import { depositosByWaCol } from "../infra/firestore/duduPaths";
import {
  SEED_TEST_DEPOSITO_CNPJ,
  SEED_TEST_DEPOSITO_DOC_ID,
  SEED_TEST_DEPOSITO_PHONE_RAW,
} from "../domain/seedTestDeposito";
import { normalizeWhatsAppId } from "../domain/whatsapp/normalize";

function parseTenantIdFromPath(pathValue: string): string | null {
  const parts = String(pathValue).split("/");
  const tenantsIndex = parts.findIndex((item) => item === "tenants");
  if (tenantsIndex === -1) return null;
  const tenantId = parts[tenantsIndex + 1] ?? "";
  return tenantId.trim() || null;
}

async function run(): Promise<void> {
  const dryRun = String(process.env.DRY_RUN ?? "true").trim() !== "false";
  const expectedWaId = normalizeWhatsAppId(SEED_TEST_DEPOSITO_PHONE_RAW);
  const targetCnpj = normalizeWhatsAppId(SEED_TEST_DEPOSITO_CNPJ);

  const byFlag = await db.collectionGroup("depositos").where("isTestSeed", "==", true).get();
  const byCnpj = await db.collectionGroup("depositos").where("cnpj", "==", targetCnpj).get();
  const byWaId = expectedWaId
    ? await db.collectionGroup("depositos").where("waId", "==", expectedWaId).get()
    : { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] };

  const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const doc of byFlag.docs) candidates.set(doc.ref.path, doc);
  for (const doc of byCnpj.docs) candidates.set(doc.ref.path, doc);
  for (const doc of byWaId.docs) candidates.set(doc.ref.path, doc);

  let matched = 0;
  let removed = 0;
  for (const doc of candidates.values()) {
    const data = doc.data() as Record<string, unknown>;
    const waId = normalizeWhatsAppId(String(data.waId ?? data.whatsappRaw ?? ""));
    const cnpj = normalizeWhatsAppId(String(data.cnpj ?? ""));
    const isSeedIdentity =
      doc.id === SEED_TEST_DEPOSITO_DOC_ID || waId === expectedWaId || cnpj === targetCnpj || data.isTestSeed === true;
    if (!isSeedIdentity) continue;

    matched += 1;
    const tenantId = parseTenantIdFromPath(doc.ref.path);
    const shouldDeleteByWa = Boolean(tenantId && waId);
    if (dryRun) {
      console.log(`DRY_RUN match: ${doc.ref.path} waId=${waId || "-"} tenant=${tenantId || "-"}`);
      continue;
    }

    await doc.ref.delete().catch(() => void 0);
    removed += 1;
    if (shouldDeleteByWa && tenantId && waId) {
      await depositosByWaCol(tenantId).doc(waId).delete().catch(() => void 0);
    }
    console.log(`REMOVED: ${doc.ref.path}`);
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        seedDocId: SEED_TEST_DEPOSITO_DOC_ID,
        matched,
        removed,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("removeSeedTestDeposito failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
