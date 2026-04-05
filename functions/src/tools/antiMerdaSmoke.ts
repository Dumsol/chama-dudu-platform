import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as admin from "firebase-admin";

const PROJECT_ID = "kosh-tecnology";
const REGION = "southamerica-east1";
const WEBHOOK_URL = `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}/dudu_whatsappWebhookV1`;
const DIAG_URL = `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}/dudu_diagHttpV1`;

function randomSuffix(): string {
  return crypto.randomBytes(4).toString("hex");
}

function hmacSignature(secret: string, body: Buffer): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function nowSec(): string {
  return String(Math.floor(Date.now() / 1000));
}

async function main(): Promise<void> {
  const verifyToken = String(process.env.KOSH_PROD_DUDU_WA_VERIFY_TOKEN ?? "").trim();
  const appSecret = String(process.env.KOSH_PROD_DUDU_WA_APP_SECRET ?? "").trim();
  assert(verifyToken, "missing KOSH_PROD_DUDU_WA_VERIFY_TOKEN");
  assert(appSecret, "missing KOSH_PROD_DUDU_WA_APP_SECRET");

  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT_ID });
  }
  const db = admin.firestore();

  const suffix = randomSuffix();
  const tenantId = `test-${Date.now()}-${suffix}`;
  const phoneNumberId = `PNID_${suffix}`;
  const phoneNumberIdNoMap = `PNID_NO_MAP_${suffix}`;
  const waId1 = `558199999999${Math.floor(Math.random() * 90 + 10)}`;
  const waId2 = `558199999998${Math.floor(Math.random() * 90 + 10)}`;
  const waId3 = `558199999997${Math.floor(Math.random() * 90 + 10)}`;
  const waMessageId1 = `wamid.TEST_${suffix}`;
  const waMessageId2 = `wamid.TEST_NEG_${suffix}`;
  const waMessageId3 = `wamid.TEST_BADSIG_${suffix}`;
  const challenge = `CHALLENGE_${suffix}`;

  await db
    .collection("platform")
    .doc("channelDirectory")
    .collection("directory")
    .doc(phoneNumberId)
    .set(
      {
        externalId: phoneNumberId,
        tenantId,
        productId: "dudu",
        channelType: "whatsapp",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  {
    const url = new URL(WEBHOOK_URL);
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", verifyToken);
    url.searchParams.set("hub.challenge", challenge);
    const resp = await fetch(url.toString());
    const body = await resp.text();
    assert.equal(resp.status, 200, "verify GET status");
    assert.equal(body, challenge, "verify GET challenge body");
  }

  const payload1 = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: waId1, profile: { name: "Teste" } }],
              messages: [
                {
                  from: waId1,
                  id: waMessageId1,
                  timestamp: nowSec(),
                  type: "text",
                  text: { body: "teste anti-merda" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const rawBody1 = Buffer.from(JSON.stringify(payload1), "utf8");
  const sig1 = hmacSignature(appSecret, rawBody1);

  const resp1 = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sig1,
    },
    body: rawBody1,
  });
  const resp1Body = await resp1.text();
  assert.equal(resp1.status, 200, `POST status: ${resp1Body}`);

  const baseRef = db.collection("tenants").doc(tenantId).collection("products").doc("dudu");
  const userSnap = await baseRef.collection("users").doc(waId1).get();
  assert(userSnap.exists, "user doc missing");

  const dedupeSnap = await baseRef.collection("inboundProcessed").doc(waMessageId1).get();
  const dedupeAlt = await baseRef.collection("wa_dedupe").doc(waMessageId1).get();
  assert(dedupeSnap.exists || dedupeAlt.exists, "dedupe doc missing");

  const startMs = Date.now();
  const resp1b = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sig1,
    },
    body: rawBody1,
  });
  const latencyMs = Date.now() - startMs;
  assert.equal(resp1b.status, 200, "idempotent POST status");
  assert(latencyMs <= 800, `latency ${latencyMs}ms > 800ms`);

  const payload2 = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberIdNoMap },
              contacts: [{ wa_id: waId2, profile: { name: "Teste2" } }],
              messages: [
                {
                  from: waId2,
                  id: waMessageId2,
                  timestamp: nowSec(),
                  type: "text",
                  text: { body: "teste sem mapping" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const rawBody2 = Buffer.from(JSON.stringify(payload2), "utf8");
  const sig2 = hmacSignature(appSecret, rawBody2);
  const resp2 = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sig2,
    },
    body: rawBody2,
  });
  const resp2Json = await resp2.json();
  assert.equal(resp2.status, 200, "no-mapping status");
  assert.equal(resp2Json.reason, "NO_CHANNEL_MAPPING", "no-mapping reason");
  const userNoMap = await baseRef.collection("users").doc(waId2).get();
  assert.equal(userNoMap.exists, false, "user should not exist for no mapping");

  const payload3 = {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: waId3, profile: { name: "Teste3" } }],
              messages: [
                {
                  from: waId3,
                  id: waMessageId3,
                  timestamp: nowSec(),
                  type: "text",
                  text: { body: "teste bad sig" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const rawBody3 = Buffer.from(JSON.stringify(payload3), "utf8");
  const resp3 = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": "sha256=deadbeef",
    },
    body: rawBody3,
  });
  assert([401, 403].includes(resp3.status), "bad signature should be 401/403");
  const dedupeBad = await baseRef.collection("inboundProcessed").doc(waMessageId3).get();
  const dedupeBadAlt = await baseRef.collection("wa_dedupe").doc(waMessageId3).get();
  assert(!dedupeBad.exists && !dedupeBadAlt.exists, "dedupe should not exist for bad signature");

  const payload4 = { object: "whatsapp_business_account" };
  const rawBody4 = Buffer.from(JSON.stringify(payload4), "utf8");
  const sig4 = hmacSignature(appSecret, rawBody4);
  const resp4 = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Hub-Signature-256": sig4,
    },
    body: rawBody4,
  });
  const resp4Json = await resp4.json();
  assert.equal(resp4.status, 200, "invalid payload status");
  assert.equal(resp4Json.reason, "INVALID_PAYLOAD", "invalid payload reason");

  const diagResp = await fetch(DIAG_URL);
  const diagJson = await diagResp.json();
  assert.equal(diagResp.status, 200, "diag status");
  assert.equal(diagJson.ok, true, "diag ok");
  assert(diagJson.sendDisabledHits >= 1, "sendDisabledHits should be >= 1");
  assert(diagJson.lastCorrelationId, "lastCorrelationId missing");

  console.log("PASS", { tenantId, phoneNumberId });
}

main().catch((err) => {
  console.error("antiMerdaSmoke failed:", err?.message ?? String(err));
  process.exit(1);
});
