// God help me we define the secret here because I can't stand loading infra at the top anymore
const painelConfigSecret = defineSecret("PAINEL_CONFIG");

// My gosh if these options don't work I'm quitting this career
const globalOpts = {
  region: "southamerica-east1",
  secrets: [painelConfigSecret],
  memory: "256MiB" as const, // Default, I hope this doesn't explode
  timeoutSeconds: 60,
};

// --- HTTP / Webhooks ---

export const dudu_whatsappWebhookV1 = onRequest(
  {
    ...globalOpts,
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async (req, res) => {
    const { webhookApp } = await import("./app/http/whatsappWebhook.js");
    return webhookApp(req, res);
  }
);

export const dudu_diagHttpV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { diagHttpHandler } = await import("./app/http/diag.js");
    return diagHttpHandler(req, res);
  }
);

export const dudu_interWebhookV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { interWebhookHandler } = await import("./app/http/interWebhook.js");
    return interWebhookHandler(req, res);
  }
);

export const dudu_renderReceiptHtmlV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { renderReceiptHtmlHandler } = await import("./app/http/receipt.js");
    return renderReceiptHtmlHandler(req, res);
  }
);

export const dudu_depositoRegisterV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { depositoRegisterHandler } = await import("./app/http/depositoRegister.js");
    return depositoRegisterHandler(req, res);
  }
);

export const dudu_opsAppV1 = onRequest(
  globalOpts,
  async (req, res) => {
    // ConfiguraÃ§Ã£o robusta de CORS manual (compatÃvel com SDK antigo)
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, x-admin-key, Authorization");

    if (req.method === "OPTIONS" || req.method === "options") {
      res.status(204).send("");
      return;
    }

    const path = String(req.path ?? "").replace(/\/$/, "");

    // --- Health Check ---
    if (path === "/api/health" || path === "/health") {
      const { diagHttpHandler } = await import("./app/http/diag.js");
      await diagHttpHandler(req, res);
      return;
    }

    // Still doesn't work perfectly and I'm crying
    if (path === "/api/admin/connectivity" || path === "/admin/connectivity") {
      await import("./infra/config/secrets.js");
      res.json({
        ok: true,
        tenantId: "dudu",
      });
      return;
    }

    // --- Pre-cadastro ---
    if (path === "/api/pre-cadastro-deposito" || path === "/pre-cadastro-deposito") {
      const { depositoRegisterHandler } = await import("./app/http/depositoRegister.js");
      await depositoRegisterHandler(req, res);
      return;
    }

    // I spent 12 hours on CORS and I still hate it
    res.set("Access-Control-Allow-Origin", "*");

    // --- War Room Overview ---
    if (path === "/api/admin/war-room/overview" || path === "/admin/war-room/overview") {
      const { getWarRoomOverview } = await import("./modules/ops/warRoomService.js");
      const query = req.query as any;
      try {
        const overview = await getWarRoomOverview({
          tenantId: String(query.tenantId || "dudu"),
          range: (query.range as any) || "7d",
          flowGroupBy: (query.groupBy as any) || "bairro",
          horizonDays: query.horizon ? Number(query.horizon) : 7,
          preferSnapshot: query.refresh !== "true"
        });
        res.json({ ok: true, overview });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
      }
      return;
    }

    res.status(404).json({ ok: false, error: "not_found", path });
  }
);

export const dudu_slaChecker3MinHttpV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { slaChecker3MinHttp } = await import("./app/http/slaCheckerHttp.js");
    return slaChecker3MinHttp(req, res);
  }
);

export const dudu_promoAdminToggleV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { promoAdminToggleHandler } = await import("./app/http/promoAdmin.js");
    return promoAdminToggleHandler(req, res);
  }
);

export const dudu_opsSetAdminV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { setAdminClaimHandler } = await import("./app/http/adminOps.js");
    await setAdminClaimHandler(req, res);
  }
);

export const dudu_partnerAuthSetupV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { dudu_partnerAuthSetupV1 } = await import("./app/http/partnerAuth.js");
    return dudu_partnerAuthSetupV1(req, res);
  }
);

export const dudu_partnerUpdatePromoV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { dudu_partnerUpdatePromoV1 } = await import("./app/http/partnerPromo.js");
    return dudu_partnerUpdatePromoV1(req, res);
  }
);

export const dudu_billingGenerateWeeklyV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { billingGenerateWeeklyHandler } = await import("./app/http/billing.js");
    return billingGenerateWeeklyHandler(req, res);
  }
);

export const dudu_billingPublicCycleV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { billingPublicCycleHandler } = await import("./app/http/billing.js");
    return billingPublicCycleHandler(req, res);
  }
);

export const dudu_cronRunnerV1 = onSchedule(
  {
    ...globalOpts,
    schedule: "every 3 minutes",
  },
  async () => {
    const { dudu_cronRunnerV1Handler } = await import("./jobs/cronRunner.js");
    return dudu_cronRunnerV1Handler();
  }
);

export const dudu_legacyRootAuditMonitorDailyV1 = onSchedule(
  {
    ...globalOpts,
    schedule: "0 4 * * *",
  },
  async () => {
    const { legacyRootAuditMonitorDailyHandler } = await import("./jobs/legacyRootAuditMonitor.js");
    return legacyRootAuditMonitorDailyHandler();
  }
);

// --- Session Inactivity Reset Cron (30m) ---

export const dudu_userSessionCleanupV1 = onSchedule(
  {
    ...globalOpts,
    schedule: "every 10 minutes",
  },
  async () => {
    const { cleanupInactiveSessions } = await import("./jobs/userSessionCleanup.js");
    await cleanupInactiveSessions();
  }
);

export const dudu_userSessionCleanupTriggerV1 = onRequest(
  globalOpts,
  async (req, res) => {
    const { cleanupInactiveSessions } = await import("./jobs/userSessionCleanup.js");
    const result = await cleanupInactiveSessions();
    res.json({ ok: true, result });
  }
);
