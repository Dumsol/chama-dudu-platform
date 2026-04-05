import * as admin from "firebase-admin";
import { AdminTimestamp, FieldValue } from "../../infra/config/firebase";
import { issuesCol } from "../../infra/firestore/duduPaths";
import type { RiskFlag } from "../common/types";
import { addRiskFlag } from "../orders/orderService";
import { makeIssueId } from "../common/id";

export type IssueType =
  | "MISSING_ITEMS"
  | "NOT_DELIVERED"
  | "WRONG_ORDER"
  | "OVERCHARGED"
  | "LOW_RATING"
  | "OTHER"
  | "VALOR_BAD"
  | "NAO_CHEGOU"
  | "ATRASO"
  | "PRODUTO_ERRADO"
  | "OUTRO";

export type IssueStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "REJECTED";

export interface Issue {
  id: string;
  orderId: string;
  depositoId?: string | null;
  userId: string;
  type: IssueType;
  status: IssueStatus;
  summary?: string | null;

  evidence?: {
    text?: string | null;
    mediaIds?: string[];
  };

  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
  resolvedAt?: admin.firestore.Timestamp | null;
}

function norm(s: string | undefined): string {
  return String(s ?? "").trim().slice(0, 500);
}

/**
 * Idempotente por (orderId + type) enquanto OPEN/IN_PROGRESS.
 */
export async function getOpenIssueByOrder(params: {
  tenantCnpj: string;
  orderId: string;
  type?: IssueType;
}): Promise<Issue | null> {
  const tenantIssues = issuesCol(params.tenantCnpj);
  let q = tenantIssues.where("orderId", "==", params.orderId);
  if (params.type) q = q.where("type", "==", params.type);
  q = q.where("status", "in", ["OPEN", "IN_PROGRESS"] as any);

  const snap = await q.limit(1).get().catch(() => null as any);
  if (!snap || snap.empty) return null;

  const doc = snap.docs[0];
  const d = doc.data() as any;
  return {
    id: doc.id,
    orderId: d.orderId,
    depositoId: d.depositoId ?? null,
    userId: d.userId,
    type: d.type,
    status: d.status,
    summary: d.summary ?? null,
    evidence: d.evidence ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    resolvedAt: d.resolvedAt ?? null,
  };
}

export async function createIssue(params: {
  tenantCnpj: string;
  orderId: string;
  userId: string;
  depositoId?: string | null;
  type: IssueType;
  summary?: string | null;
  extraFields?: Record<string, unknown>;
}): Promise<Issue> {
  const tenantIssues = issuesCol(params.tenantCnpj);

  const existing = await getOpenIssueByOrder({
    tenantCnpj: params.tenantCnpj,
    orderId: params.orderId,
    type: params.type,
  });
  if (existing) return existing;

  const issueId = makeIssueId(params.orderId, params.type);
  const ref = tenantIssues.doc(issueId);
  const now = AdminTimestamp.now();

  const issue: Issue = {
    id: issueId,
    orderId: params.orderId,
    userId: params.userId,
    depositoId: params.depositoId ?? null,
    type: params.type,
    status: "OPEN",
    summary: params.summary ?? null,
    evidence: { text: null, mediaIds: [] },
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
  };

  const extra = params.extraFields && typeof params.extraFields === "object" ? params.extraFields : {};
  await ref.set({
    ...issue,
    ...extra,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // flag de risco no pedido
  const rf: RiskFlag = params.type === "LOW_RATING" ? "LOW_RATING" : "COMPLAINT_OPEN";
  await addRiskFlag({
    tenantCnpj: params.tenantCnpj,
    orderId: params.orderId,
    flag: rf,
  }).catch(() => void 0);

  return issue;
}

export async function addIssueEvidence(params: {
  tenantCnpj: string;
  issueId: string;
  text?: string | null;
  mediaId?: string | null;
}): Promise<void> {
  const tenantIssues = issuesCol(params.tenantCnpj);
  const ref = tenantIssues.doc(params.issueId);

  await tenantIssues.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const d = snap.data() as any;
    const evidence = d.evidence ?? {};
    const mediaIds: string[] = Array.isArray(evidence.mediaIds) ? evidence.mediaIds : [];

    const nextMedia = params.mediaId ? [...mediaIds, String(params.mediaId)].slice(-10) : mediaIds;

    tx.set(
      ref,
      {
        status: d.status === "OPEN" ? "IN_PROGRESS" : d.status,
        evidence: {
          text: params.text != null ? norm(params.text) : (evidence.text ?? null),
          mediaIds: nextMedia,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

export async function resolveIssue(params: {
  tenantCnpj: string;
  issueId: string;
  status: "RESOLVED" | "REJECTED";
  note?: string | null;
}): Promise<void> {
  await issuesCol(params.tenantCnpj).doc(params.issueId).set(
    {
      status: params.status,
      resolutionNote: norm(params.note ?? ""),
      resolvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
