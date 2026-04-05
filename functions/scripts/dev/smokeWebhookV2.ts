import * as crypto from "crypto";
import { FieldValue } from "../../src/config/firebase";
import { whatsappWebhookHandler } from "../../src/whatsapp/webhookHandler";
import { channelDirectoryCol, inboundProcessedCol, waDedupeCol } from "../../src/core/duduPaths";

type MockReq = {
  method: string;
  body: any;
  rawBody: Buffer;
  query: Record<string, string>;
  get: (name: string) => string | undefined;
};

type MockRes = {
  statusCode: number;
  payload: any;
  status: (code: number) => MockRes;
  sendStatus: (code: number) => void;
  send: (body: any) => void;
  json: (body: any) => void;
};

function buildSignature(secret: string, raw: Buffer): string {
  const digest = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return `sha256=${digest}`;
}

function makeMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    payload: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    sendStatus(code: number) {
      res.statusCode = code;
    },
    send(body: any) {
      res.payload = body;
    },
    json(body: any) {
      res.payload = body;
    },
  };
  return res;
}

async function main(): Promise<void> {
  process.env.KOSH_PROD_DUDU_WA_APP_SECRET =
    process.env.KOSH_PROD_DUDU_WA_APP_SECRET ?? "test_secret";
  process.env.KOSH_PROD_DUDU_WA_VERIFY_TOKEN =
    process.env.KOSH_PROD_DUDU_WA_VERIFY_TOKEN ?? "test_verify";
  process.env.KOSH_PROD_DUDU_WA_TOKEN =
    process.env.KOSH_PROD_DUDU_WA_TOKEN ?? "test_access";
  const tenantId = "tenant_smoke";
  const phoneNumberId = "1234567890";
  const waId = "558899999999";
  const messageId = "wamid.smoke_001";

  await channelDirectoryCol()
    .doc(phoneNumberId)
    .set(
      {
        externalId: phoneNumberId,
        tenantId,
        productId: "dudu",
        channelType: "whatsapp",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

  const body = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId },
              contacts: [{ wa_id: waId, profile: { name: "Smoke Test" } }],
              messages: [
                {
                  from: waId,
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "status" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const rawBody = Buffer.from(JSON.stringify(body), "utf8");
  const signature = buildSignature(process.env.KOSH_PROD_DUDU_WA_APP_SECRET ?? "", rawBody);

  const req: MockReq = {
    method: "POST",
    body,
    rawBody,
    query: {},
    get(name: string) {
      if (name.toLowerCase() === "x-hub-signature-256") return signature;
      return undefined;
    },
  };

  const res = makeMockRes();
  await whatsappWebhookHandler(req as any, res as any);

  const inboundSnap = await inboundProcessedCol(tenantId).doc(messageId).get();
  const dedupeSnap = await waDedupeCol(tenantId).doc(messageId).get();

  if (!inboundSnap.exists || !dedupeSnap.exists) {
    throw new Error("smokeWebhookV2 failed: missing inboundProcessed or wa_dedupe in V2 path");
  }

  console.log("smokeWebhookV2 ok", {
    tenantId,
    phoneNumberId,
    waId,
    statusCode: res.statusCode,
  });
}

main().catch((err) => {
  console.error("smokeWebhookV2 error", err);
  process.exit(1);
});
