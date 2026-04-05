import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { painelConfigSecret } from "../../infra/config/secrets";
import { db } from "../../infra/config/firebase";

/**
 * Interface para a solicitação de atualização de promoções.
 */
interface PartnerUpdatePromoRequest {
  /** Configurações de cada tipo de promoção ativa. */
  promotions: {
    percent?: { enabled: boolean; value: number; threshold: number };
    free_shipping?: { enabled: boolean; threshold: number };
    voucher?: { enabled: boolean; value: number; threshold: number };
  };
}

/**
 * dudu_partnerUpdatePromoV1
 * 
 * Permite que um parceiro (Depósito) gerencie suas 3 promoções.
 * As promoções são salvas no documento do tenant.
 */
export const dudu_partnerUpdatePromoV1 = functions.https.onCall({
  region: "southamerica-east1",
  secrets: [painelConfigSecret],
}, async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new functions.https.HttpsError("unauthenticated", "Usuário não autenticado.");
  }

  const { partner, tenantId } = auth.token as { partner?: boolean; tenantId?: string };
  if (!partner || !tenantId) {
    throw new functions.https.HttpsError("permission-denied", "Acesso restrito a parceiros.");
  }

  const data = request.data as PartnerUpdatePromoRequest;
  const { promotions } = data;

  if (!promotions) {
    throw new functions.https.HttpsError("invalid-argument", "Promozioni non fornite.");
  }

  logger.info("PARTNER_UPDATE_PROMO_ATTEMPT", { tenantId, promotions });

  // 1. Validar e Sanitizar dados
  // Regra fixa de R$ 100 exigida pelo Dudu para anunciar (internalAuditThreshold)
  const DUDU_GLOBAL_THRESHOLD = 100;
  
  const cleanPromo = {
    percent: promotions.percent ? {
      enabled: Boolean(promotions.percent.enabled),
      value: Math.max(0, Math.min(100, Number(promotions.percent.value))),
      threshold: Math.max(0, Number(promotions.percent.threshold)),
    } : null,
    free_shipping: promotions.free_shipping ? {
      enabled: Boolean(promotions.free_shipping.enabled),
      threshold: Math.max(0, Number(promotions.free_shipping.threshold)),
    } : null,
    voucher: promotions.voucher ? {
      enabled: Boolean(promotions.voucher.enabled),
      value: Math.max(0, Number(promotions.voucher.value)),
      threshold: Math.max(0, Number(promotions.voucher.threshold)),
    } : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    duduAnnouncementRule: {
      minOrderValue: DUDU_GLOBAL_THRESHOLD,
      message: "Promoções só ativadas pelo Dudu para pedidos acima de R$ 100,00."
    }
  };

  // 2. Salvar no documento do tenant
  // Caminho sugerido: tenants/{tenantId}/config/features/promocoes
  const promoRef = db.collection("tenants").doc(tenantId)
    .collection("config").doc("features")
    .collection("promotions").doc("active");

  await promoRef.set(cleanPromo, { merge: true });

  logger.info("PARTNER_UPDATE_PROMO_SUCCESS", { tenantId, uid: auth.uid });

  return {
    ok: true,
    message: "Promoções atualizadas com sucesso! Lembre-se: Dudu só anuncia para pedidos > R$ 100.",
  };
});
