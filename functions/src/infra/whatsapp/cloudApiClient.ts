import * as logger from "firebase-functions/logger";
import { readWhatsAppAccessToken } from "../config/secrets";
import { sendWhatsAppStickerMessage } from "../../modules/whatsapp/send";

const API_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v24.0";
const API_BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

async function postWithRetry(params: {
  path: string;
  body: Record<string, unknown>;
  correlationId: string;
  maxRetries?: number;
}): Promise<{ messageId: string | null }> {
  const token = readWhatsAppAccessToken();
  if (!token) {
    throw new Error("WHATSAPP_ACCESS_TOKEN is required");
  }
  const maxRetries = params.maxRetries ?? 3;
  const url = `${API_BASE_URL}${params.path}`;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params.body),
    });
    const raw = await response.text();
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }
    if (response.ok) {
      const messageId = (data as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id ?? null;
      return { messageId };
    }

    const error = new Error(`WhatsApp API error: status=${response.status}`);
    lastError = error;
    logger.warn("WA_SEND_RETRYABLE_ERROR", {
      correlationId: params.correlationId,
      status: response.status,
      attempt,
      path: params.path,
    });
    if (attempt === maxRetries || !shouldRetry(response.status)) {
      break;
    }
    await sleep(300 * Math.pow(2, attempt));
  }
  throw lastError ?? new Error("WhatsApp API request failed");
}

export interface CloudApiClient {
  sendText: (params: {
    phoneNumberId: string;
    to: string;
    body: string;
    correlationId: string;
  }) => Promise<{ messageId: string | null }>;
  sendReplyButtons: (params: {
    phoneNumberId: string;
    to: string;
    body: string;
    correlationId: string;
    buttons: Array<{ id: string; title: string }>;
  }) => Promise<{ messageId: string | null }>;
  sendLocationRequest: (params: {
    phoneNumberId: string;
    to: string;
    body: string;
    correlationId: string;
  }) => Promise<{ messageId: string | null }>;
  sendContactRequest: (params: {
    phoneNumberId: string;
    to: string;
    body: string;
    correlationId: string;
  }) => Promise<{ messageId: string | null }>;
  sendSticker: (params: {
    phoneNumberId: string;
    to: string;
    stickerLink: string;
    correlationId: string;
    tenantId: string;
  }) => Promise<{ messageId: string | null }>;
  sendDocument: (params: {
    phoneNumberId: string;
    to: string;
    documentUrl: string;
    fileName: string;
    caption?: string;
    correlationId: string;
  }) => Promise<{ messageId: string | null }>;
  sendListMessage: (params: {
    phoneNumberId: string;
    to: string;
    body: string;
    buttonLabel: string;
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
    correlationId: string;
  }) => Promise<{ messageId: string | null }>;
}

export function createCloudApiClient(): CloudApiClient {
  return {
    async sendText(params) {
      return postWithRetry({
        path: `/${encodeURIComponent(params.phoneNumberId)}/messages`,
        body: {
          messaging_product: "whatsapp",
          to: params.to,
          type: "text",
          text: {
            body: params.body,
          },
        },
        correlationId: params.correlationId,
      });
    },
    async sendReplyButtons(params) {
      const safeButtons = params.buttons.slice(0, 3).map((button) => ({
        type: "reply",
        reply: {
          id: button.id.slice(0, 256),
          title: button.title.slice(0, 20),
        },
      }));
      return postWithRetry({
        path: `/${encodeURIComponent(params.phoneNumberId)}/messages`,
        body: {
          messaging_product: "whatsapp",
          to: params.to,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: params.body },
            action: {
              buttons: safeButtons,
            },
          },
        },
        correlationId: params.correlationId,
      });
    },
    async sendLocationRequest(params) {
      return postWithRetry({
        path: `/${encodeURIComponent(params.phoneNumberId)}/messages`,
        body: {
          messaging_product: "whatsapp",
          to: params.to,
          type: "interactive",
          interactive: {
            type: "location_request_message",
            header: { type: "text", text: "Localização 📍" },
            body: { text: params.body },
            action: { name: "send_location" },
          },
        },
        correlationId: params.correlationId,
      });
    },
    async sendContactRequest(params) {
      // Fallback para botão comum pedindo compartilhamento, já que o tipo nativo de request_phone
      // pode variar conforme a versão da API e o rollout do BSUID.
      return this.sendReplyButtons({
        ...params,
        buttons: [{ id: "request_contact_info", title: "Compartilhar meu nº" }],
      });
    },
    async sendSticker(params) {
      try {
        await sendWhatsAppStickerMessage({
          tenantCnpj: params.tenantId,
          phoneNumberId: params.phoneNumberId,
          to: params.to,
          stickerLink: params.stickerLink,
        });
        return { messageId: null };
      } catch (error) {
        logger.warn("WA_SEND_STICKER_FAILED", {
          correlationId: params.correlationId,
          reason: (error as Error).message,
        });
        throw error;
      }
    },
    async sendDocument(params) {
      return postWithRetry({
        path: `/${encodeURIComponent(params.phoneNumberId)}/messages`,
        body: {
          messaging_product: "whatsapp",
          to: params.to,
          type: "document",
          document: {
            link: params.documentUrl,
            filename: params.fileName,
            caption: params.caption,
          },
        },
        correlationId: params.correlationId,
      });
    },
    async sendListMessage(params) {
      return postWithRetry({
        path: `/${encodeURIComponent(params.phoneNumberId)}/messages`,
        body: {
          messaging_product: "whatsapp",
          to: params.to,
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: params.body },
            action: {
              button: params.buttonLabel,
              sections: params.sections,
            },
          },
        },
        correlationId: params.correlationId,
      });
    },
  };
}
