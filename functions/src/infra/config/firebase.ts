// functions/src/config/firebase.ts
import { initializeApp, getApps } from "firebase-admin/app";
import { cert } from "firebase-admin/app";
import type * as FirebaseFirestore from "firebase-admin/firestore";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

let _db: FirebaseFirestore.Firestore | undefined;
let _storage: ReturnType<typeof getStorage> | undefined;

/**
 * Lazy-load Firestore only when first accessed.
 * This avoids calling getFirestore() during the Firebase CLI function discovery phase,
 * resolving the "Timeout after 10000" deployment error.
 */
export const db = new Proxy({} as FirebaseFirestore.Firestore, {
  get(target, prop, receiver) {
    if (!_db) {
      if (!getApps().length) {
        const rawServiceAccount = String(
          process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
        ).trim();
        if (rawServiceAccount) {
          const parsed = JSON.parse(rawServiceAccount) as Record<string, unknown>;
          initializeApp({
            credential: cert(parsed as any),
            projectId: String(
              process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.FIREBASE_PROJECT ?? "",
            ).trim() || undefined,
          });
        } else {
          initializeApp();
        }
      }
      _db = getFirestore();
    }
    return Reflect.get(_db, prop, receiver);
  },
});

export const storage = new Proxy({} as ReturnType<typeof getStorage>, {
  get(target, prop, receiver) {
    if (!_storage) {
      if (!getApps().length) initializeApp();
      _storage = getStorage();
    }
    return Reflect.get(_storage, prop, receiver);
  },
});

export { FieldValue };
export const AdminTimestamp = Timestamp;

export type Firestore = FirebaseFirestore.Firestore;
