import * as crypto from "crypto";
import { FieldValue } from "../../infra/config/firebase";
import { outboundRepeatCol, productDoc } from "../../infra/firestore/duduPaths";

export const ANTI_REPEAT_WINDOW_MS = Number(
  process.env.WHATSAPP_OUTBOUND_REPEAT_WINDOW_MS ?? "45000",
);

export type RepeatEntry = {
  hash: string;
  atMs: number;
};

export function buildOutboundHash(kind: string, payload: string): string {
  const normalizedKind = kind.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const input = `${normalizedKind}|${payload ?? ""}`;
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

export function shouldBlockRepeat(entry: RepeatEntry | null, hash: string, windowMs = ANTI_REPEAT_WINDOW_MS, now = Date.now()): boolean {
  if (!entry) return false;
  if (entry.hash !== hash) return false;
  return now - entry.atMs <= windowMs;
}

export async function checkOutboundRepeat(params: {
  tenantCnpj: string;
  toDigits: string;
  kind: string;
  hash: string;
  nowMs?: number;
}): Promise<boolean> {
  const nowMs = params.nowMs ?? Date.now();
  const appRef = productDoc(params.tenantCnpj);
  const ref = outboundRepeatCol(params.tenantCnpj).doc(params.toDigits);
  const kindKey = params.kind.replace(/[^a-z0-9]+/gi, "_").toLowerCase();

  let allowed = true;
  await appRef.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() as any) : {};
    const entries = data.entries ?? {};
    const existing = entries[kindKey] as RepeatEntry | undefined;

    if (shouldBlockRepeat(existing ?? null, params.hash, ANTI_REPEAT_WINDOW_MS, nowMs)) {
      allowed = false;
      return;
    }

    const update: Record<string, unknown> = {
      [`entries.${kindKey}`]: {
        hash: params.hash,
        atMs: nowMs,
      },
      lastUpdatedAt: FieldValue.serverTimestamp(),
      lastUpdatedAtMs: nowMs,
    };

    tx.set(ref, update, { merge: true });
  });

  return allowed;
}
