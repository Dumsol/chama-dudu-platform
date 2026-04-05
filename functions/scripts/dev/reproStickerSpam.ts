import dotenv from "dotenv";
import { sendWhatsAppStickerMessage } from "../../src/whatsapp/send";
import { outboundMessagesCol } from "../../src/core/duduPaths";

dotenv.config({ path: process.env.DOTENV_PATH ?? "local.env" });

function last4(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.slice(-4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Summary = {
  total: number;
  stickerTotal: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  other: number;
};

async function fetchSummary(tenantCnpj: string, runId: string): Promise<Summary> {
  const snap = await outboundMessagesCol(tenantCnpj)
    .where("orderId", "==", runId)
    .get();

  let sent = 0;
  let delivered = 0;
  let read = 0;
  let failed = 0;
  let other = 0;
  let stickerTotal = 0;

  for (const doc of snap.docs) {
    const data = doc.data() as any;
    if (data.type !== "sticker") continue;
    stickerTotal += 1;
    const status = String(data.status ?? "").toLowerCase();
    if (status === "sent") sent += 1;
    else if (status === "delivered") delivered += 1;
    else if (status === "read") read += 1;
    else if (status === "failed") failed += 1;
    else other += 1;
  }

  return {
    total: snap.size,
    stickerTotal,
    sent,
    delivered,
    read,
    failed,
    other,
  };
}

async function main(): Promise<void> {
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID ?? "";
  const to = process.env.WA_TO ?? "";
  const stickerLink = process.env.WA_STICKER_LINK ?? process.env.WA_STICKER_ID ?? "";
  const tenantCnpj = process.env.SINGLE_TENANT_CNPJ ?? "app";

  if (!phoneNumberId || !to || !stickerLink) {
    throw new Error(
      "Missing env. Required: WA_PHONE_NUMBER_ID, WA_TO, WA_STICKER_LINK (or WA_STICKER_ID).",
    );
  }

  const countRaw = Number(process.env.STICKER_COUNT ?? "5");
  const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(countRaw, 50)) : 5;
  const intervalRaw = Number(process.env.STICKER_INTERVAL_MS ?? "1200");
  const intervalMs = Number.isFinite(intervalRaw) ? Math.max(200, intervalRaw) : 1200;
  const runId = process.env.REPRO_RUN_ID ?? `repro_${Date.now().toString(36)}`;

  console.log(`repro runId=${runId} to=***${last4(to)} count=${count} intervalMs=${intervalMs}`);

  for (let i = 1; i <= count; i += 1) {
    console.log(`sending ${i}/${count} to=***${last4(to)}`);
    await sendWhatsAppStickerMessage({
      tenantCnpj,
      phoneNumberId,
      to,
      stickerLink,
      orderId: runId,
    });
    if (i < count) await sleep(intervalMs);
  }

  const pollAttemptsRaw = Number(process.env.STATUS_POLL_ATTEMPTS ?? "6");
  const pollAttempts = Number.isFinite(pollAttemptsRaw) ? Math.max(1, pollAttemptsRaw) : 6;
  const pollIntervalRaw = Number(process.env.STATUS_POLL_INTERVAL_MS ?? "5000");
  const pollIntervalMs = Number.isFinite(pollIntervalRaw) ? Math.max(1000, pollIntervalRaw) : 5000;

  for (let i = 1; i <= pollAttempts; i += 1) {
    await sleep(pollIntervalMs);
    const summary = await fetchSummary(tenantCnpj, runId);
    console.log(
      `poll ${i}/${pollAttempts} total=${summary.total} stickers=${summary.stickerTotal} ` +
        `sent=${summary.sent} delivered=${summary.delivered} read=${summary.read} ` +
        `failed=${summary.failed} other=${summary.other}`,
    );
  }
}

main().catch((err) => {
  console.error("reproStickerSpam failed", err?.message ?? String(err));
  process.exitCode = 1;
});
