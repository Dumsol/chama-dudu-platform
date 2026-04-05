import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";

import { FieldValue } from "../../infra/config/firebase";
import { painelConfigSecret, readAdminApiKey } from "../../infra/config/secrets";
import { depositosCol, tenantConfigDoc } from "../../infra/firestore/duduPaths";
import { buildTenantFeaturePatch, clearTenantFeatureCache, getTenantFeatureConfig, writeTenantAudit } from "../../infra/config/tenantFeatures";

function cryptoTimingSafeEqual(a: Buffer, b: Buffer): boolean {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("crypto") as typeof import("crypto");
  return crypto.timingSafeEqual(a, b);
}

function safeEq(a: string, b: string): boolean {
  const aa = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  if (aa.length !== bb.length) return false;
  return cryptoTimingSafeEqual(aa, bb);
}

function parseJsonBody(raw: any): any {
  if (raw && typeof raw === "object") return raw;
  if (!raw) return {};
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

export const promoAdminToggle = onRequest(
  {
    region: "southamerica-east1",
    secrets: [painelConfigSecret],
  },
  promoAdminToggleHandler
);

export async function promoAdminToggleHandler(req: any, res: any) {
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Cache-Control", "no-store");

    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }

    const headerKey = String(req.header("x-admin-key") ?? "");
    const secretKey = readAdminApiKey().trim();
    if (!secretKey) {
      logger.error("promoAdminToggle: adminApiKey ausente (misconfig)");
      res.status(500).json({ ok: false, error: "server_misconfigured" });
      return;
    }

    if (!headerKey || !safeEq(headerKey, secretKey)) {
      res.status(403).json({ ok: false, error: "forbidden" });
      return;
    }

    const payload = parseJsonBody(req.body);
    const tenantCnpj = String(payload.tenantCnpj ?? "").trim();
    if (!tenantCnpj) {
      res.status(400).json({ ok: false, error: "missing_tenant" });
      return;
    }

    const actor = String(req.header("x-admin-actor") ?? payload.actor ?? "admin-api").slice(0, 80);

    try {
      const before = await getTenantFeatureConfig(tenantCnpj);
      const patch = buildTenantFeaturePatch({
        tenantKillSwitch: payload.tenantKillSwitch,
        promoEnabled: payload?.features?.promoInteligente?.enabled,
        minDeliveredOrdersLifetime: payload?.features?.promoInteligente?.minDeliveredOrdersLifetime ?? null,
        minScore: payload?.features?.promoInteligente?.minScore ?? null,
        raspadinhaEnabled: payload?.features?.raspadinha?.enabled,
        gptAdvisorEnabled: payload?.features?.gptAdvisor?.enabled,
      });

      let configUpdated = false;
      if (Object.keys(patch).length > 0) {
        await tenantConfigDoc(tenantCnpj).set(patch, { merge: true });
        configUpdated = true;
      }

      let manualUpdated = false;
      const depositoId = String(payload.depositoId ?? "").trim();
      if (depositoId && typeof payload.manualApproved === "boolean") {
        await depositosCol(tenantCnpj).doc(depositoId).set(
          {
            promocaoInteligente: {
              manualApproved: payload.manualApproved,
              updatedAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        manualUpdated = true;
      }

      if (!configUpdated && !manualUpdated) {
        res.status(400).json({ ok: false, error: "no_changes" });
        return;
      }

      clearTenantFeatureCache(tenantCnpj);
      const after = await getTenantFeatureConfig(tenantCnpj);

      if (configUpdated) {
        await writeTenantAudit({
          tenantCnpj,
          actor,
          action: "toggleFeature",
          before,
          after,
        }).catch(() => void 0);
      }

      if (manualUpdated) {
        await writeTenantAudit({
          tenantCnpj,
          actor,
          action: "toggleManualApproved",
          before: { depositoId, manualApproved: !payload.manualApproved },
          after: { depositoId, manualApproved: payload.manualApproved },
        }).catch(() => void 0);
      }

      res.status(200).json({
        ok: true,
        tenantCnpj,
        configUpdated,
        manualUpdated,
      });
      return;
    } catch (err: any) {
      logger.error("promoAdminToggle falhou", { error: err?.message ?? String(err) });
      res.status(500).json({ ok: false, error: "internal_error" });
      return;
    }
}
