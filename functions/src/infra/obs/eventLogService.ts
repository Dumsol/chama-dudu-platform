// FILE: functions/src/core/eventLogService.ts
import * as logger from "firebase-functions/logger";
import { FieldValue } from "../config/firebase";
import { dayEventsItemsCol, orderEventsCol } from "../firestore/duduPaths";
import { isFeatureEnabled } from "../config/featureFlags";
import { makeEventDayId, makeEventId } from "../../modules/common/id";

function dayKeySaoPaulo(d = new Date()): string {
  // YYYY-MM-DD
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export async function logEvent(params: {
  tenantCnpj: string;
  eventName: string;
  orderId?: string | null;
  userId?: string | null;
  depositoId?: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  if (!isFeatureEnabled("FEATURE_EVENTLOG_ENABLED", true)) return;

  const { tenantCnpj, eventName, orderId, userId, depositoId, payload } = params;

  try {
    const base = {
      tenantCnpj,
      eventName,
      orderId: orderId ?? null,
      userId: userId ?? null,
      depositoId: depositoId ?? null,
      payload: payload ?? {},
      createdAt: FieldValue.serverTimestamp(),
      createdAtMs: Date.now(),
    };

    // Organizado por pedido quando existir orderId (debug operacional fica trivial)
    if (orderId) {
      await orderEventsCol(tenantCnpj, String(orderId))
        .doc(makeEventId(String(orderId), String(eventName)))
        .set(base);
      return;
    }

    // Sem orderId: agrupa por dia (evita "lixão" top-level)
    const dayKey = dayKeySaoPaulo();
    await dayEventsItemsCol(tenantCnpj, dayKey)
      .doc(makeEventDayId(dayKey, String(eventName)))
      .set(base);
  } catch (err) {
    logger.warn("Falha ao gravar event log", { tenantCnpj, eventName, err });
  }
}
