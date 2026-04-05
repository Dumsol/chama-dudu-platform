// functions/src/billing/interWebhook.ts
import * as crypto from "crypto";
import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";

import { markPaidByInterPixEvent } from "./billingService";
import { readInterWebhookSecret, painelConfigSecret } from "../../infra/config/secrets";
import { parseInterWebhookPayload } from "./interSchemas";
import { log } from "../../infra/obs/logger";
const DEFAULT_TENANT_ID =
  process.env.SINGLE_TENANT_CNPJ ?? process.env.SINGLE_TENANT_KEY ?? "";
const ALLOW_SINGLE_TENANT_FALLBACK =
  Boolean(process.env.FUNCTIONS_EMULATOR) || Boolean(process.env.FIREBASE_EMULATOR_HUB);

function resolveTenantFromRequest(req: any): string {
  const fromQuery = String(req.query?.tenantId ?? req.query?.tenantCnpj ?? "").trim();
  const fromHeader = String(req.header("x-tenant-id") ?? req.header("x-tenant-cnpj") ?? "").trim();
  const resolved = fromQuery || fromHeader;
  if (resolved) return resolved;
  if (ALLOW_SINGLE_TENANT_FALLBACK && DEFAULT_TENANT_ID) return DEFAULT_TENANT_ID;
  throw new Error("tenantCnpj required for interWebhook");
}

function safeEq(a: string, b: string): boolean {
  const aa = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function parseValorToCentavos(v: any): number | null {
  if (v == null) return null;

  if (typeof v === "number" && Number.isFinite(v)) {
    if (Number.isInteger(v)) return v; // pode já vir em centavos
    return Math.round(v * 100); // reais
  }

  const s = String(v).trim().replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  // normalmente vem em reais como string
  return Math.round(n * 100);
}

function extractEvents(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.pix) && payload.pix.length > 0) return payload.pix;
  // alguns webhooks vêm como evento direto
  return [payload];
}

function getTxid(ev: any): string {
  return String(ev?.txid ?? ev?.txId ?? "").trim();
}

function getE2E(ev: any): string | null {
  const v = String(ev?.endToEndId ?? ev?.endtoendid ?? "").trim();
  return v ? v : null;
}

// Webhook Inter (Pix)
export const interWebhook = onRequest(
  {
    region: "southamerica-east1",
    secrets: [painelConfigSecret],
  },
  interWebhookHandler
);

export async function interWebhookHandler(req: any, res: any) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }

    const expected = readInterWebhookSecret().trim();
    if (!expected) {
      logger.error("KOSH_PROD_DUDU_INTER_WEBHOOK_SECRET não configurado");
      res.status(500).json({ ok: false, error: "misconfigured" });
      return;
    }

    const secretFromQuery = String(req.query.secret ?? "").trim();
    const secretFromHeader = String(req.header("x-inter-webhook-secret") ?? "").trim();

    const provided = secretFromQuery || secretFromHeader;
    if (!provided) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const okAuth =
      (secretFromQuery && safeEq(secretFromQuery, expected)) ||
      (secretFromHeader && safeEq(secretFromHeader, expected));

    if (!okAuth) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const payload = req.body as any;
    const parsed = parseInterWebhookPayload(payload);
    if (!parsed.ok) {
      log.warn({ reason: parsed.reason, outcome: "INVALID_INTER_PAYLOAD" }, "INTER_INVALID_PAYLOAD");
      res.status(200).json({ ok: false, reason: parsed.reason });
      return;
    }
    const events = extractEvents(parsed.events);

    const processed: any[] = [];
    let okCount = 0;
    let failCount = 0;
    const tenantCnpj = resolveTenantFromRequest(req);

    for (const ev of events) {
      const txid = getTxid(ev);
      if (!txid) continue;

      const endToEndId = getE2E(ev);
      const valorRecebidoCentavos = parseValorToCentavos(ev?.valor);

      try {
        const r = await markPaidByInterPixEvent({
          tenantCnpj,
          txid,
          endToEndId,
          valorRecebidoCentavos,
          rawEvent: ev,
        });

        processed.push({
          txid,
          endToEndId,
          ok: r.ok,
          cycleId: r.cycleId ?? null,
          alreadyProcessed: r.alreadyProcessed ?? false,
          alreadyPaid: r.alreadyPaid ?? false,
        });

        if (r.ok) okCount += 1;
        else failCount += 1;
      } catch (err: any) {
        failCount += 1;
        logger.error("Inter webhook: erro processando evento", {
          txid,
          endToEndId,
          error: err?.message ?? String(err),
        });
        processed.push({
          txid,
          endToEndId,
          ok: false,
          error: err?.message ?? String(err),
        });
      }
    }

    res.status(200).json({
      ok: true,
      okCount,
      failCount,
      processedCount: processed.length,
      processed,
    });
}
