// functions/src/modules/users/userService.ts
import type * as FirebaseFirestore from "firebase-admin/firestore";
import { FieldValue } from "../../infra/config/firebase";
import { usersCol } from "../../infra/firestore/duduPaths";
import type { UserType } from "../common/types";

export interface UpsertUserParams {
  tenantCnpj: string;
  userId: string; // normalmente = waId ou bsuId
  waId?: string | null;
  bsuId?: string | null;
  waUsername?: string | null;
  profileName?: string;
  defaultUserType: UserType;
}

export async function upsertUser(params: UpsertUserParams): Promise<void> {
  const { tenantCnpj, userId, waId, bsuId, waUsername, profileName, defaultUserType } = params;

  const userRef = usersCol(tenantCnpj).doc(userId);

  const snapshot = await userRef.get();
  const existing = snapshot.exists ? (snapshot.data() as any) : undefined;

  const now = FieldValue.serverTimestamp();

  const data: Record<string, unknown> = {
    updatedAt: now,
  };

  if (waId) data.waId = waId;
  if (bsuId) data.bsuId = bsuId;
  if (waUsername) data.waUsername = waUsername;
  if (profileName) data.profileName = profileName;
  else if (existing?.profileName) data.profileName = existing.profileName;

  if (!existing?.type) (data as any).type = defaultUserType;
  if (!snapshot.exists) (data as any).createdAt = now;

  await userRef.set(data, { merge: true });
}

export async function getUserById(
  tenantCnpj: string,
  userId: string,
): Promise<FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData>> {
  return usersCol(tenantCnpj).doc(userId).get();
}
