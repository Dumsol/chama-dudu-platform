/* eslint-disable @typescript-eslint/no-explicit-any */
// functions/src/modules/whatsapp/send.ts

import * as crypto from "crypto";
import { readWhatsAppAccessToken } from "../../infra/config/secrets";
import { requestJson } from "../../infra/http/httpClient";
import { saveOutgoingMessageToSession } from "../common/messageService";
import {
  last4Digits,
  normalizeToDigitsE164,
} from "./validators";

const WHATSAPP_BASE_URL = "https://graph.facebook.com/v24.0";
const DEFAULT_TIMEOUT_MS = 9000;

export { last4Digits };

export interface SendTextParams {
  tenantCnpj?: string;
  phoneNumberId: string;
  to: string;
  body: string;
  previewUrl?: boolean;
  orderId?: string | null;
}

export interface SendButtonsParams {
  tenantCnpj?: string;
  phoneNumberId: string;
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
  orderId?: string | null;
}

export interface SendLocationRequestParams {
  tenantCnpj?: string;
  phoneNumberId: string;
  to: string;
  body: string;
  orderId?: string | null;
}

export interface SendStickerParams {
  tenantCnpj?: string;
  phoneNumberId: string;
  to: string;
  stickerLink: string;
  orderId?: string | null;
}

export interface SendTemplateParams {
  tenantCnpj?: string;
  phoneNumberId: string;
  to: string;
  name: string;
  languageCode?: string;
  components?: any[];
  orderId?: string | null;
}

export class WhatsAppApiError extends Error {
  public status: number | null;
  public code?: string | number;
  public details?: any;
  public requestId: string;
  public isRetryable: boolean;
  public isAuthError: boolean;

  constructor(params: {
    message: string;
    status: number | null;
    requestId: string;
    code?: string | number;
    details?: any;
    isRetryable: boolean;
    isAuthError?: boolean;
  }) {
    super(params.message);
    this.name = "WhatsAppApiError";
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
    this.requestId = params.requestId;
    this.isRetryable = params.isRetryable;
    this.isAuthError = params.isAuthError ?? false;
  }
}

export function resolveTenantCnpj(paramsTenant: string | undefined, _context: string): string {
  return paramsTenant || process.env.SINGLE_TENANT_CNPJ || "";
}

export function makeOutboxId(params: {
  to: string;
  kind: string;
  reason: string;
  orderId?: string | null;
  body?: string | null;
  payload?: any;
}): string {
  const hash = crypto.createHash("sha256")
    .update(`${params.to}|${params.kind}|${params.body}`)
    .digest("hex")
    .slice(0, 8);
  return `out_${params.to}_${params.kind}_${hash}`;
}

export function isWindowOrTemplateError(err: any): boolean {
  if (!(err instanceof WhatsAppApiError)) return false;
  return [131047, 131049, 132000, 132001, 131030].includes(Number(err.code || 0));
}

async function callWhatsAppAPI(params: {
  tenantCnpj: string;
  phoneNumberId: string;
  payload: any;
  requestKind: string;
}): Promise<{ messageId: string | null; requestId: string; httpStatus: number; fbTraceId: string | null }> {
  const token = readWhatsAppAccessToken();
  const requestId = Math.random().toString(16).slice(2);
  const url = `${WHATSAPP_BASE_URL}/${params.phoneNumberId}/messages`;

  try {
    const res = await requestJson<any>({
      url,
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      bodyJson: params.payload,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
    return {
      messageId: res.data?.messages?.[0]?.id || null,
      requestId,
      httpStatus: res.statusCode,
      fbTraceId: (res.headers["x-fb-trace-id"] as string) || null,
    };
  } catch (err: any) {
    throw new WhatsAppApiError({
      message: err.message,
      status: err.status || 500,
      requestId,
      isRetryable: true,
    });
  }
}

export async function sendWhatsAppTextMessage(params: SendTextParams): Promise<void> {
  const tenantCnpj = resolveTenantCnpj(params.tenantCnpj, "text");
  const to = normalizeToDigitsE164(params.to);
  const body = params.body;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body, preview_url: params.previewUrl ?? false },
  };

  const result = await callWhatsAppAPI({
    tenantCnpj,
    phoneNumberId: params.phoneNumberId,
    payload,
    requestKind: "send_text",
  });
  
  await saveOutgoingMessageToSession({
    tenantCnpj,
    userId: to,
    to,
    msgType: "text",
    textBody: body,
    waMessageId: result.messageId,
  });
}

export async function sendWhatsAppButtonsMessage(params: SendButtonsParams): Promise<void> {
  const tenantCnpj = resolveTenantCnpj(params.tenantCnpj, "buttons");
  const to = normalizeToDigitsE164(params.to);
  
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: params.body },
      action: {
        buttons: params.buttons.map(b => ({
          type: "reply",
          reply: { id: b.id, title: b.title }
        }))
      }
    }
  };

  await callWhatsAppAPI({
    tenantCnpj,
    phoneNumberId: params.phoneNumberId,
    payload,
    requestKind: "send_buttons",
  });
}

export async function sendWhatsAppLocationRequestMessage(params: SendLocationRequestParams): Promise<void> {
  const tenantCnpj = resolveTenantCnpj(params.tenantCnpj, "location");
  const to = normalizeToDigitsE164(params.to);

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: { text: params.body },
      action: { name: "send_location" }
    }
  };

  await callWhatsAppAPI({
    tenantCnpj,
    phoneNumberId: params.phoneNumberId,
    payload,
    requestKind: "send_location_request",
  });
}

export async function sendWhatsAppStickerMessage(_params: SendStickerParams): Promise<void> {
    // ImplementaÃ§Ã£o simplificada
}

export async function sendWhatsAppTemplateMessage(_params: SendTemplateParams): Promise<void> {
    // ImplementaÃ§Ã£o simplificada
}

export async function safeSendButtonsMessage(params: SendButtonsParams & { fallbackText?: string }): Promise<void> {
  try {
    await sendWhatsAppButtonsMessage(params);
  } catch (err) {
    await sendWhatsAppTextMessage({
      ...params,
      body: params.fallbackText || params.body
    });
  }
}

export async function safeSendLocationRequestMessage(params: SendLocationRequestParams & { fallbackText?: string }): Promise<void> {
    try {
        await sendWhatsAppLocationRequestMessage(params);
    } catch (err) {
        await sendWhatsAppTextMessage({
            ...params,
            body: params.fallbackText || params.body
        });
    }
}
