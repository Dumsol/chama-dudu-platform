import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { processWebhookPayload } from "../domain/whatsapp/processor";
import { createTenantResolver } from "../domain/whatsapp/tenantResolver";
import { applyFirestoreRateLimit } from "../infra/security/firestoreRateLimiter";
import { opsRepositories } from "../infra/firestore/opsRepositories";
import { depositosCol, messagesCol, processedMessagesCol } from "../infra/firestore/duduPaths";
import type { FlowMessenger } from "../domain/whatsapp/types";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "your-project-id";
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";

process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;

if (!getApps().length) {
  initializeApp({ projectId: PROJECT_ID });
}

const db = getFirestore();

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`SMOKE_FAIL: ${message}`);
}

async function seedData(): Promise<void> {
  await db.collection("tenants").doc("tenant-smoke").set({
    phoneNumberId: "555001",
    name: "Tenant Smoke",
    createdAt: new Date(),
  });

  await depositosCol("tenant-smoke").doc("dep-smoke-open").set({
    tenantId: "tenant-smoke",
    waId: "5511990001000",
    nomeDeposito: "Depósito Avenida",
    bairro: "Boa Viagem",
    bairroNorm: "boa viagem",
    aberto: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function run(): Promise<void> {
  await seedData();
  const tenantResolver = createTenantResolver({
    fetchTenantIdByPhoneNumberId: opsRepositories.fetchTenantIdByPhoneNumberId,
  });

  const sent: Array<{ waId: string; body: string }> = [];
  const messenger: FlowMessenger = {
    async sendText(params: any): Promise<void> {
      sent.push({ waId: params.waId, body: params.body });
      await opsRepositories.saveOutboundMessage({
        tenantId: params.tenantId,
        waId: params.waId,
        messageId: null,
        body: params.body,
        type: "text",
      });
    },
    async sendContactRequest(params: any): Promise<void> {
      sent.push({ waId: params.waId, body: params.body });
    },
    async sendList(params: any): Promise<void> {
      sent.push({ waId: params.waId, body: params.body });
    },
  };

  const payloadCliente = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "555001" },
              contacts: [{ wa_id: "5511988887777", profile: { name: "Cliente Smoke" } }],
              messages: [
                {
                  id: "wamid-smoke-001",
                  from: "5511988887777",
                  type: "text",
                  text: { body: "Boa Viagem" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const replay1 = await processWebhookPayload(
    {
      tenantResolver,
      repo: opsRepositories,
      messenger,
      applyRateLimit: (params) =>
        applyFirestoreRateLimit({
          tenantId: params.tenantId,
          scope: params.scope,
          key: params.key,
          windowMs: params.windowMs,
          maxHits: params.maxHits,
        }),
    },
    payloadCliente,
    { requestId: "smoke-1", requestIp: "127.0.0.1" },
  );
  assert(replay1.processedMessages === 1, "replay1 processed one message");

  const replayDuplicate = await processWebhookPayload(
    {
      tenantResolver,
      repo: opsRepositories,
      messenger,
      applyRateLimit: (params) =>
        applyFirestoreRateLimit({
          tenantId: params.tenantId,
          scope: params.scope,
          key: params.key,
          windowMs: params.windowMs,
          maxHits: params.maxHits,
        }),
    },
    payloadCliente,
    { requestId: "smoke-dup", requestIp: "127.0.0.1" },
  );
  assert(replayDuplicate.duplicateMessages >= 1, "duplicate message counted");

  const payloadDepositoInteractive = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "555001" },
              contacts: [{ wa_id: "5511977776666", profile: { name: "Depósito Smoke" } }],
              messages: [
                {
                  id: "wamid-smoke-002",
                  from: "5511977776666",
                  type: "interactive",
                  interactive: { button_reply: { id: "abrir", title: "Abrir" } },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const replay2 = await processWebhookPayload(
    {
      tenantResolver,
      repo: opsRepositories,
      messenger,
      applyRateLimit: (params) =>
        applyFirestoreRateLimit({
          tenantId: params.tenantId,
          scope: params.scope,
          key: params.key,
          windowMs: params.windowMs,
          maxHits: params.maxHits,
        }),
    },
    payloadDepositoInteractive,
    { requestId: "smoke-2", requestIp: "127.0.0.1" },
  );
  assert(replay2.processedMessages === 1, "replay2 processed one message");

  const processedDoc = await processedMessagesCol("tenant-smoke").doc("tenant-smoke:wamid-smoke-001").get();
  assert(processedDoc.exists, "processed message persisted");

  const userSnap = await db
    .collection("tenants")
    .doc("tenant-smoke")
    .collection("products")
    .doc("dudu")
    .collection("users")
    .where("tenantId", "==", "tenant-smoke")
    .where("waId", "==", "5511988887777")
    .limit(1)
    .get();
  assert(!userSnap.empty, "cliente user persisted");

  const mensagensSnap = await messagesCol("tenant-smoke").where("tenantId", "==", "tenant-smoke").get();
  assert(mensagensSnap.size >= 2, "mensagens persisted");
  assert(sent.length >= 2, "outbound messages generated");

  console.log("SMOKE_OK");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
