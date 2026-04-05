import * as functions from "firebase-functions/v2";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { painelConfigSecret } from "../../infra/config/secrets";
import { db } from "../../infra/config/firebase";

/**
 * Interface para a solicitação de setup de auth do parceiro.
 */
interface PartnerAuthSetupRequest {
  /** Telefone ou CNPJ do parceiro. */
  identifier: string;
}

/**
 * dudu_partnerAuthSetupV1
 * 
 * Permite que um parceiro (Depósito) realize seu primeiro acesso ou recupere acesso
 * ao painel administrativo. Usa o identificador (Telefone ou CNPJ) como 
 * login e senha inicial.
 */
export const dudu_partnerAuthSetupV1 = functions.https.onCall({
  region: "southamerica-east1",
  secrets: [painelConfigSecret],
}, async (request) => {
  const data = request.data as PartnerAuthSetupRequest;
  const identifier = String(data.identifier ?? "").replace(/\D/g, "");

  if (!identifier || identifier.length < 8) {
    throw new functions.https.HttpsError("invalid-argument", "Identificador inválido.");
  }

  logger.info("PARTNER_AUTH_SETUP_ATTEMPT", { identifier });

  // 1. Buscar se esse identificador pertence a um depósito ou pré-cadastro aprovado
  let foundTenantId: string | null = null;
  let foundDepositoId: string | null = null;
  let partnerName: string = "Parceiro";

  // Busca em depositos (por waId - telefone)
  const depSnap = await db.collectionGroup("depositos")
    .where("waId", "==", identifier)
    .limit(1)
    .get();

  if (!depSnap.empty) {
    const doc = depSnap.docs[0];
    foundTenantId = doc.get("tenantId");
    foundDepositoId = doc.id;
    partnerName = doc.get("nomeDeposito") || partnerName;
  } else {
    // Busca em preCadastros (por cnpj ou whatsapp)
    const preSnapCnpj = await db.collectionGroup("preCadastros")
      .where("cnpj", "==", identifier)
      .limit(1)
      .get();
    
    if (!preSnapCnpj.empty) {
      const doc = preSnapCnpj.docs[0];
      foundTenantId = doc.get("tenantId");
      partnerName = doc.get("nomeDeposito") || partnerName;
    } else {
      const preSnapWa = await db.collectionGroup("preCadastros")
        .where("whatsapp", "==", identifier)
        .limit(1)
        .get();
      
      if (!preSnapWa.empty) {
        const doc = preSnapWa.docs[0];
        foundTenantId = doc.get("tenantId");
        partnerName = doc.get("nomeDeposito") || partnerName;
      }
    }
  }

  if (!foundTenantId) {
    logger.warn("PARTNER_AUTH_NOT_FOUND", { identifier });
    throw new functions.https.HttpsError("not-found", "Parceiro não identificado em nossa base.");
  }

  // 2. Garantir conta no Firebase Auth
  const email = `${identifier}@chamadudu.web.app`;
  let userRecord: admin.auth.UserRecord;

  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (error: any) {
    if (error.code === "auth/user-not-found") {
      // Criar novo usuário com a senha inicial sendo o IDENTIFICADOR
      userRecord = await admin.auth().createUser({
        email,
        password: identifier,
        displayName: partnerName,
      });
      logger.info("PARTNER_AUTH_USER_CREATED", { uid: userRecord.uid, identifier });
    } else {
      throw error;
    }
  }

  // 3. Atribuir Custom Claims
  const claims = {
    partner: true,
    tenantId: foundTenantId,
    depositoId: foundDepositoId || undefined,
  };

  await admin.auth().setCustomUserClaims(userRecord.uid, claims);
  logger.info("PARTNER_AUTH_CLAIMS_SET", { uid: userRecord.uid, claims });

  return {
    ok: true,
    email,
    message: "Acesso configurado com sucesso. Use seu identificador como login e senha.",
  };
});
