import { z } from "zod";

const PixEventSchema = z
  .object({
    txid: z.string().optional(),
    txId: z.string().optional(),
    endToEndId: z.string().optional(),
    endtoendid: z.string().optional(),
    valor: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const InterWebhookSchema = z
  .object({
    pix: z.array(PixEventSchema).optional(),
  })
  .passthrough();

export type InterPixEvent = z.infer<typeof PixEventSchema>;

export function parseInterWebhookPayload(
  payload: unknown,
): { ok: true; events: InterPixEvent[] } | { ok: false; reason: "INVALID_INTER_PAYLOAD" } {
  const parsed = InterWebhookSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID_INTER_PAYLOAD" };
  }

  const events = Array.isArray(parsed.data.pix) && parsed.data.pix.length
    ? parsed.data.pix
    : [parsed.data as any];

  if (!events.length) {
    return { ok: false, reason: "INVALID_INTER_PAYLOAD" };
  }

  return { ok: true, events };
}
