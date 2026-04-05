export interface IdempotencyStore {
  createProcessedMessage: (messageId: string, data: { tenantId: string; waId: string; ttlMs: number }) => Promise<boolean>;
}

export async function claimMessageProcessing(
  store: IdempotencyStore,
  params: { messageId: string; tenantId: string; waId: string; ttlMs?: number },
): Promise<"claimed" | "duplicate"> {
  const messageId = String(params.messageId ?? "").trim();
  if (!messageId) {
    throw new Error("messageId is required");
  }
  const dedupKey = `${params.tenantId}:${messageId}`;
  const ok = await store.createProcessedMessage(dedupKey, {
    tenantId: params.tenantId,
    waId: params.waId,
    ttlMs: params.ttlMs ?? 14 * 24 * 60 * 60 * 1000,
  });
  return ok ? "claimed" : "duplicate";
}
