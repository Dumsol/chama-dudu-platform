import { Request, Response } from "express";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { readInternalReplaySecret } from "../../infra/config/secrets";

/**
 * Endpoint para conceder privilégios de admin a um UID específico.
 * Protegido por segredo interno.
 */
export async function setAdminClaimHandler(req: Request, res: Response) {
  const authHeader = req.headers.authorization || "";
  const internalSecret = readInternalReplaySecret();

  if (authHeader !== `Bearer ${internalSecret}`) {
    logger.warn("UNAUTHORIZED_ADMIN_CLAIM_ATTEMPT", { ip: req.ip });
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { uid } = req.body;
  if (!uid || typeof uid !== "string") {
    return res.status(400).json({ error: "Missing or invalid uid" });
  }

  try {
    await admin.auth().setCustomUserClaims(uid, { admin: true });
    
    logger.info("ADMIN_CLAIM_GRANTED", { uid });
    
    return res.json({ 
      success: true, 
      message: `Admin claim granted to ${uid}. User must re-login to update token.` 
    });
  } catch (error) {
    logger.error("ADMIN_CLAIM_ERROR", { uid, error: String(error) });
    return res.status(500).json({ error: "Failed to set admin claim" });
  }
}
