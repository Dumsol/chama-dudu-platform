import crypto from "crypto";
import { z } from "zod";
import { normalizeWhatsAppId, sanitizeSnippet } from "./normalize";
import type { ParsedWebhookEnvelope, WhatsAppInboundMessage, WhatsAppStatusEvent } from "./types";

const MessageSchema = z
  .object({
    id: z.string().optional(),
    from: z.string().optional(),
    from_user_id: z.string().optional(),
    timestamp: z.string().optional(),
    type: z.string().optional(),
    text: z.object({ body: z.string().optional() }).optional(),
    interactive: z
      .object({
        button_reply: z.object({ id: z.string().optional(), title: z.string().optional() }).optional(),
        list_reply: z.object({ id: z.string().optional(), title: z.string().optional() }).optional(),
      })
      .optional(),
    button: z.object({ payload: z.string().optional(), text: z.string().optional() }).optional(),
    location: z
      .object({
        latitude: z.union([z.number(), z.string()]).optional(),
        longitude: z.union([z.number(), z.string()]).optional(),
        name: z.string().optional(),
        address: z.string().optional(),
      })
      .optional(),
    image: z.object({ caption: z.string().optional() }).optional(),
    document: z.object({ caption: z.string().optional() }).optional(),
    audio: z.any().optional(),
    video: z.any().optional(),
    sticker: z.any().optional(),
  })
  .passthrough();

const StatusSchema = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    recipient_id: z.string().optional(),
    recipient_user_id: z.string().optional(),
    timestamp: z.string().optional(),
    errors: z
      .array(z.object({ code: z.union([z.number(), z.string()]).optional(), title: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

const ValueSchema = z
  .object({
    metadata: z.object({ phone_number_id: z.string() }).passthrough(),
    contacts: z
      .array(
        z
          .object({
            wa_id: z.string().optional(),
            user_id: z.string().optional(),
            profile: z.object({ name: z.string().optional(), username: z.string().optional() }).optional(),
          })
          .passthrough(),
      )
      .optional(),
    messages: z.array(MessageSchema).optional(),
    statuses: z.array(StatusSchema).optional(),
  })
  .passthrough();

const ChangeSchema = z.object({
  value: ValueSchema,
});

const EntrySchema = z.object({
  changes: z.array(ChangeSchema),
});

const WebhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(EntrySchema),
});

function findProfileName(contacts: Array<{ wa_id?: string; user_id?: string; profile?: { name?: string; username?: string } }> | undefined, waId: string | null, bsuId: string | null): string | null {
  if (!contacts?.length) return null;
  const match = contacts.find((item) => (waId && normalizeWhatsAppId(item.wa_id ?? "") === waId) || (bsuId && item.user_id === bsuId)) ?? contacts[0];
  return match?.profile?.name ? String(match.profile.name) : null;
}

function findProfileUsername(contacts: Array<{ wa_id?: string; user_id?: string; profile?: { name?: string; username?: string } }> | undefined, waId: string | null, bsuId: string | null): string | null {
  if (!contacts?.length) return null;
  const match = contacts.find((item) => (waId && normalizeWhatsAppId(item.wa_id ?? "") === waId) || (bsuId && item.user_id === bsuId)) ?? contacts[0];
  return match?.profile?.username ? String(match.profile.username) : null;
}

function makeFallbackMessageId(input: {
  phoneNumberId: string;
  waId: string | null;
  bsuId: string | null;
  timestamp: string | null;
  type: string;
  text: string | null;
}): string {
  const source = `${input.phoneNumberId}|${input.waId ?? input.bsuId ?? "nouser"}|${input.timestamp ?? ""}|${input.type}|${input.text ?? ""}`;
  const hash = crypto.createHash("sha256").update(source, "utf8").digest("hex");
  return `generated_${hash.slice(0, 24)}`;
}

function resolveMessageSourceKind(message: z.infer<typeof MessageSchema>): WhatsAppInboundMessage["sourceKind"] {
  if (message.interactive?.button_reply || message.interactive?.list_reply) return "interactive";
  if (message.button?.payload || message.button?.text) return "button";
  if (message.location) return "location";
  if (message.text?.body) return "text";
  if (message.image || message.document || message.audio || message.video || message.sticker) return "media";
  return "unknown";
}

function resolveMessageText(message: z.infer<typeof MessageSchema>): string | null {
  const rawText =
    message.text?.body ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    message.interactive?.button_reply?.id ??
    message.interactive?.list_reply?.id ??
    message.button?.text ??
    message.button?.payload ??
    message.location?.address ??
    message.location?.name ??
    message.image?.caption ??
    message.document?.caption ??
    null;
  return sanitizeSnippet(rawText, 500);
}

function parseMessage(phoneNumberId: string, message: z.infer<typeof MessageSchema>, contacts: z.infer<typeof ValueSchema>["contacts"]): WhatsAppInboundMessage | null {
  const waId = message.from ? normalizeWhatsAppId(message.from) : null;
  const bsuId = message.from_user_id ? String(message.from_user_id) : undefined;
  
  if (!waId && !bsuId) return null;

  const text = resolveMessageText(message);
  const sourceKind = resolveMessageSourceKind(message);
  const messageType = String(message.type ?? sourceKind ?? "unknown");
  const timestamp = message.timestamp ?? null;

  const messageId = String(message.id ?? "").trim() || makeFallbackMessageId({
    phoneNumberId,
    waId,
    bsuId: bsuId ?? null,
    timestamp,
    type: messageType,
    text,
  });

  const latitudeRaw = message.location?.latitude;
  const longitudeRaw = message.location?.longitude;
  const latitude = latitudeRaw == null ? null : Number(latitudeRaw);
  const longitude = longitudeRaw == null ? null : Number(longitudeRaw);

  return {
    phoneNumberId,
    messageId,
    waId,
    bsuId,
    waUsername: findProfileUsername(contacts, waId, bsuId ?? null) ?? undefined,
    type: messageType,
    timestamp,
    text,
    interactiveId:
      message.interactive?.button_reply?.id ??
      message.interactive?.list_reply?.id ??
      message.button?.payload ??
      null,
    interactiveTitle:
      sanitizeSnippet(
        message.interactive?.button_reply?.title ??
          message.interactive?.list_reply?.title ??
          message.button?.text ??
          null,
        120,
      ),
    profileName: findProfileName(contacts, waId, bsuId ?? null),
    sourceKind,
    location: message.location
      ? {
          latitude: Number.isFinite(latitude) ? latitude : null,
          longitude: Number.isFinite(longitude) ? longitude : null,
          address: sanitizeSnippet(message.location.address, 240),
          name: sanitizeSnippet(message.location.name, 120),
        }
      : null,
  };
}

function parseStatus(phoneNumberId: string, status: z.infer<typeof StatusSchema>): WhatsAppStatusEvent | null {
  const messageId = String(status.id ?? "").trim();
  if (!messageId) return null;
  const firstError = status.errors?.[0];
  return {
    phoneNumberId,
    messageId,
    status: String(status.status ?? "unknown"),
    recipientWaId: status.recipient_id ? normalizeWhatsAppId(status.recipient_id) : null,
    // Note: status.recipient_user_id could be added to WhatsAppStatusEvent in types.ts later if needed
    timestamp: status.timestamp ?? null,
    errorCode:
      firstError?.code == null
        ? null
        : typeof firstError.code === "number"
          ? String(firstError.code)
          : firstError.code,
    errorTitle: firstError?.title ? sanitizeSnippet(firstError.title, 160) : null,
  };
}

export function parseWebhookEnvelope(payload: unknown): ParsedWebhookEnvelope {
  const parsed = WebhookSchema.parse(payload);
  const messages: WhatsAppInboundMessage[] = [];
  const statuses: WhatsAppStatusEvent[] = [];

  for (const entry of parsed.entry) {
    for (const change of entry.changes) {
      const phoneNumberId = String(change.value.metadata.phone_number_id ?? "").trim();
      if (!phoneNumberId) continue;

      for (const rawMessage of change.value.messages ?? []) {
        const parsedMessage = parseMessage(phoneNumberId, rawMessage, change.value.contacts);
        if (parsedMessage) messages.push(parsedMessage);
      }

      for (const rawStatus of change.value.statuses ?? []) {
        const parsedStatus = parseStatus(phoneNumberId, rawStatus);
        if (parsedStatus) statuses.push(parsedStatus);
      }
    }
  }

  return { messages, statuses };
}
