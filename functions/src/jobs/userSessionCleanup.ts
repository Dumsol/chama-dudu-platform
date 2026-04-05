import * as logger from "firebase-functions/logger";
import { db } from "../infra/config/firebase";
import { tenantsCol, usersCol } from "../infra/firestore/duduPaths";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Window for session inactivity.
 * After 30 minutes of silence, we consider the session "stuck" or "abandoned".
 */
const INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Core logic to cleanup inactive user sessions across all tenants.
 */
export async function cleanupInactiveSessions(): Promise<{
  processedTenants: number;
  resetCount: number;
  errors: string[];
}> {
  const now = Date.now();
  const threshold = now - INACTIVITY_THRESHOLD_MS;
  
  let processedTenants = 0;
  let resetCount = 0;
  const errors: string[] = [];

  try {
    // 1. Get all active tenants/products
    const tenantsSnap = await tenantsCol().get();
    processedTenants = tenantsSnap.size;

    for (const tenantDoc of tenantsSnap.docs) {
      const tenantId = tenantDoc.id;
      
      try {
        // 2. Find users who are NOT idle and haven't had activity in 30+ minutes
        // We use botState != 'idle' to significantly reduce Firestore read costs.
        // NOTE: This requires a composite index: botState (ASC/DESC) + lastActivityAtMs (ASC/DESC)
        const inactiveUsersSnap = await usersCol(tenantId)
          .where("botState", "!=", "idle")
          .where("lastActivityAtMs", "<", threshold)
          .limit(1000) // Safety limit per tenant per run
          .get();

        if (inactiveUsersSnap.empty) continue;

        logger.info(`[Cleanup] Found ${inactiveUsersSnap.size} potentially inactive users for tenant ${tenantId}`);

        // Firestore batches are limited to 500 operations
        const MAX_BATCH_SIZE = 400;
        let currentBatch = db.batch();
        let opsInBatch = 0;
        let tenantResetCount = 0;

        for (const userDoc of inactiveUsersSnap.docs) {
          currentBatch.update(userDoc.ref, {
            botState: "idle",
            slots: FieldValue.delete(), // Reset flow data
            updatedAt: FieldValue.serverTimestamp(),
            resetReason: "inactivity_timeout"
          });
          
          tenantResetCount++;
          opsInBatch++;

          if (opsInBatch >= MAX_BATCH_SIZE) {
            await currentBatch.commit();
            currentBatch = db.batch();
            opsInBatch = 0;
          }
        }

        if (opsInBatch > 0) {
          await currentBatch.commit();
        }
        
        resetCount += tenantResetCount;
        if (tenantResetCount > 0) {
          logger.info(`[Cleanup] Reset ${tenantResetCount} users for tenant ${tenantId}`);
        }
      } catch (err: any) {
        if (err.message?.includes("requires an index")) {
          logger.error(`[Cleanup] Index missing for tenant ${tenantId}: ${err.message}`);
        } else {
          logger.error(`[Cleanup] Failed to process tenant ${tenantId}: ${err.message}`);
        }
        errors.push(`${tenantId}: ${err.message}`);
      }
    }
  } catch (err: any) {
    logger.error(`[Cleanup] Fatal error during cleanup: ${err.message}`);
    errors.push(`fatal: ${err.message}`);
  }

  return { processedTenants, resetCount, errors };
}
