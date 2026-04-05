// functions/src/modules/crm/loyaltyService.ts

import { db } from "../../infra/config/firebase";
import { usersCol } from "../../infra/firestore/duduPaths";
import * as logger from "firebase-functions/logger";

/**
 * Cleanup task to remove users who have been inactive for more than 30 days.
 * This helps stay within the Firebase Spark plan limits and respects privacy.
 */
export async function runUserCleanup30Days(tenantId: string): Promise<void> {
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const cutoff = now - thirtyDaysMs;

  try {
    const usersRef = usersCol(tenantId);
    
    // We look for users where botState is 'idle' and botStateExpiresAtMs is older than 30 days.
    // Note: botStateExpiresAtMs is usually set to now + 1h when they move out of idle.
    // If they are idle, it might be null, so we also check a generic updatedAt if available.
    
    // For this implementation, we rely on a custom logic: 
    // if botState is idle and they haven't talked in 30 days (lastBotMessage check or similar).
    
    const snapshot = await usersRef
      .where("botState", "==", "idle")
      .get();

    let deletedCount = 0;
    const batch = db.batch();

    snapshot.forEach((doc) => {
      const data = doc.data();
      const lastActive = data.updatedAt?.toMillis() || data.createdAt?.toMillis() || 0;
      
      if (lastActive > 0 && lastActive < cutoff) {
        batch.delete(doc.ref);
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      await batch.commit();
      logger.info("USER_CLEANUP_30D_SUCCESS", { tenantId, deletedCount });
    } else {
      logger.debug("USER_CLEANUP_30D_SKIPPED", { tenantId, reason: "no_stale_users" });
    }
  } catch (error) {
    logger.error("USER_CLEANUP_30D_FAILED", { tenantId, error: String(error) });
  }
}
