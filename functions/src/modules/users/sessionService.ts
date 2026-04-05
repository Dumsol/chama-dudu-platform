// functions/src/modules/users/sessionService.ts
import type * as FirebaseFirestore from "firebase-admin/firestore";
import { AdminTimestamp } from "../../infra/config/firebase";
import { userSessionsCol } from "../../infra/firestore/duduPaths";
import { makeSessionId } from "../common/id";

export type SessionStatus = "active" | "closed";

export interface UserSession {
  sessionId: string;
  tenantCnpj: string;
  userId: string; // waId
  status: SessionStatus;
  startedAt: FirebaseFirestore.Timestamp;
  lastActivityAt: FirebaseFirestore.Timestamp;
  closedAt?: FirebaseFirestore.Timestamp;
  closeReason?: string;
}

export async function getOrCreateActiveSession(
  tenantCnpj: string,
  userId: string,
  inactivityMinutes = 60,
): Promise<UserSession> {
  const now = AdminTimestamp.now();

  const sessionsCol = userSessionsCol(tenantCnpj, userId);

  const snap = await sessionsCol.orderBy("lastActivityAt", "desc").limit(5).get();

  const existingDoc = snap.docs.find((doc) => {
    const data = doc.data() as any;
    return data.status === "active";
  });

  if (existingDoc) {
    const data = existingDoc.data() as UserSession;
    const lastActivity = data.lastActivityAt.toDate();
    const diffMin = (Date.now() - lastActivity.getTime()) / 60000;

    if (diffMin <= inactivityMinutes) {
      await existingDoc.ref.update({ lastActivityAt: now });
      return { ...data, lastActivityAt: now };
    }

    await existingDoc.ref.update({
      status: "closed",
      closedAt: now,
      closeReason: "timeout_inatividade",
      lastActivityAt: now,
    });
  }

  const newSessionId = makeSessionId(userId);
  const newSessionRef = sessionsCol.doc(newSessionId);

  const newSession: UserSession = {
    sessionId: newSessionId,
    tenantCnpj,
    userId,
    status: "active",
    startedAt: now,
    lastActivityAt: now,
  };

  await newSessionRef.set(newSession);
  return newSession;
}

export async function closeSession(
  tenantCnpj: string,
  userId: string,
  sessionId: string,
  reason: string,
): Promise<void> {
  const sessionRef = userSessionsCol(tenantCnpj, userId).doc(sessionId);

  const now = AdminTimestamp.now();

  await sessionRef.set(
    {
      status: "closed",
      closedAt: now,
      closeReason: reason,
      lastActivityAt: now,
    },
    { merge: true },
  );
}
