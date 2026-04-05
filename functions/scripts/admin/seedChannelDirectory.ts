import * as admin from "firebase-admin";
import { FieldValue, db } from "../../src/config/firebase";

async function main(): Promise<void> {
  const args = parseArgs();
  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const docRef = db
    .collection("platform")
    .doc("channelDirectory")
    .collection("directory")
    .doc(args.phoneNumberId);

  const nowMs = Date.now();
  const payload = {
    externalId: args.phoneNumberId,
    tenantId: args.tenantId,
    productId: args.productId,
    channelType: args.channelType,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };

  await docRef.set(payload, { merge: true });
  console.log(
    `channelDirectory seeded: ${args.phoneNumberId} -> tenant ${args.tenantId} (product ${args.productId}, channel ${args.channelType})`,
  );
}

function parseArgs(): {
  phoneNumberId: string;
  tenantId: string;
  productId: string;
  channelType: string;
} {
  const raw = process.argv.slice(2);
  const lookup: Record<string, string> = {};
  for (const arg of raw) {
    const [key, value] = arg.split("=", 2);
    if (!key || !value) continue;
    lookup[key.replace(/^--/, "")] = value;
  }

  const phoneNumberId = lookup.phoneNumberId ?? lookup.phone_number_id;
  const tenantId = lookup.tenantId ?? lookup.tenant_id;
  if (!phoneNumberId || !tenantId) {
    console.error("Usage: tsx scripts/admin/seedChannelDirectory.ts --phoneNumberId=<phone_number_id> --tenantId=<tenant>");
    process.exit(1);
  }

  return {
    phoneNumberId: String(phoneNumberId),
    tenantId: String(tenantId),
    productId: "dudu",
    channelType: "whatsapp",
  };
}

main().catch((err) => {
  console.error("seedChannelDirectory failed", err);
  process.exit(1);
});
