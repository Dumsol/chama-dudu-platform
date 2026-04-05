import { z } from "zod";

const StatusSchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    recipient_id: z.string().optional(),
  })
  .passthrough();

const MessageSchema = z
  .object({
    id: z.string().optional(),
    from: z.string().optional(),
    type: z.string().optional(),
    text: z.object({ body: z.string().optional() }).optional(),
    interactive: z.any().optional(),
    button: z.any().optional(),
  })
  .passthrough();

const ValueSchema = z
  .object({
    metadata: z.object({ phone_number_id: z.string() }),
    messages: z.array(MessageSchema).optional(),
    statuses: z.array(StatusSchema).optional(),
    contacts: z.array(z.any()).optional(),
  })
  .passthrough();

const EnvelopeSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z
    .array(
      z.object({
        changes: z.array(z.object({ value: ValueSchema })).nonempty(),
      }),
    )
    .nonempty(),
});

export type ParsedWhatsAppWebhook = {
  phoneNumberId: string;
  waId: string | null;
  waMessageId: string | null;
  kind: "text" | "button" | "status" | "unknown";
  text?: string;
};

export function parseWhatsAppWebhook(payload: unknown):
  | { ok: true; data: ParsedWhatsAppWebhook; hasMessages: boolean; hasStatuses: boolean }
  | { ok: false; reason: "INVALID_PAYLOAD" | "NO_MESSAGES" } {
  const parsed = EnvelopeSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: "INVALID_PAYLOAD" };
  }

  const value = parsed.data.entry[0].changes[0].value;
  const phoneNumberId = String(value.metadata.phone_number_id);
  const statuses = value.statuses ?? [];
  if (statuses.length) {
    const status = statuses[0];
    return {
      ok: true,
      data: {
        phoneNumberId,
        waId: status.recipient_id ?? null,
        waMessageId: status.id ?? null,
        kind: "status",
      },
      hasMessages: false,
      hasStatuses: true,
    };
  }

  const messages = value.messages ?? [];
  if (!messages.length) {
    return { ok: false, reason: "NO_MESSAGES" };
  }

  const message = messages[0];
  const waId = message.from ?? null;
  const waMessageId = message.id ?? null;
  const text = message.text?.body;
  const kind: ParsedWhatsAppWebhook["kind"] =
    message.interactive || message.button
      ? "button"
      : message.type === "text" || text
        ? "text"
        : "unknown";

  return {
    ok: true,
    data: {
      phoneNumberId,
      waId,
      waMessageId,
      kind,
      text,
    },
    hasMessages: true,
    hasStatuses: false,
  };
}
