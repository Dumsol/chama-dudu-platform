import * as logger from "firebase-functions/logger";

import { isFeatureEnabled } from "../infra/config/featureFlags";
import { checkOrdersSlaHandler } from "../modules/ops/slaChecker";

export async function runSlaCheckerTask(): Promise<void> {
  // Controle fino de execucao por env (sem precisar remover o deploy do job)
  const pingEnabled = isFeatureEnabled("FEATURE_SLA_PING_3MIN", true);
  const rerouteEnabled = isFeatureEnabled("FEATURE_SLA_REROUTE_6MIN", true);

  if (!pingEnabled && !rerouteEnabled) return;
  if (!isFeatureEnabled("FEATURE_SLA_ENABLED", true)) return;

  try {
    await checkOrdersSlaHandler();
  } catch (error: any) {
    logger.error("slaChecker3Min falhou", {
      errorMessage: error?.message ?? String(error),
      errorCode: error?.code ?? error?.status,
    });
  }
}
