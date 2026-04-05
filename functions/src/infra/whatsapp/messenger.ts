import * as logger from "firebase-functions/logger";
import { FieldValue, db } from "../config/firebase";
import { stickerCooldownCol } from "../firestore/duduPaths";
import type { FlowMessenger } from "../../domain/whatsapp/types";
import type { CloudApiClient } from "./cloudApiClient";
import { opsRepositories } from "../firestore/opsRepositories";
import { StickerCatalogService, stickerCatalogService } from "./stickerCatalogService";

const STICKER_COOLDOWN_MS = Number(process.env.WA_STICKER_COOLDOWN_MS ?? "120000");

async function acquireStickerCooldown(params: {
  tenantId: string;
  waId: string;
  windowMs: number;
}): Promise<boolean> {
  const now = Date.now();
  const ref = stickerCooldownCol(params.tenantId).doc(params.waId);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() as { lastAtMs?: number }) : {};
      const lastAtMs = Number(data.lastAtMs ?? 0);
      if (lastAtMs && now - lastAtMs < params.windowMs) return false;
      tx.set(
        ref,
        {
          waId: params.waId,
          lastAtMs: now,
          updatedAt: FieldValue.serverTimestamp(),
          ...(snap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
      return true;
    });
  } catch (error) {
    logger.warn("STICKER_COOLDOWN_FAIL", {
      tenantId: params.tenantId,
      waId: params.waId,
      reason: (error as Error).message,
    });
    return false;
  }
}

async function maybeSendSticker(params: {
  client: CloudApiClient;
  catalog: StickerCatalogService;
  canSendSticker: (params: { tenantId: string; waId: string; windowMs: number }) => Promise<boolean>;
  tenantId: string;
  phoneNumberId: string;
  waId: string;
  stickerName?: string;
  policyEvent?: string;
}): Promise<void> {
  const stickerName = String(params.stickerName ?? "").trim();
  if (!stickerName) return;

  const allowed = await params.canSendSticker({
    tenantId: params.tenantId,
    waId: params.waId,
    windowMs: STICKER_COOLDOWN_MS,
  });
  if (!allowed) {
    logger.info("STICKER_SEND_SKIP", {
      tenantId: params.tenantId,
      waId: params.waId,
      stickerName,
      reason: "cooldown",
      policyEvent: params.policyEvent ?? null,
    });
    return;
  }

  const stickerLink = await params.catalog.resolveStickerLink(stickerName, params.tenantId);
  if (!stickerLink) {
    logger.warn("STICKER_SEND_SKIP", {
      tenantId: params.tenantId,
      waId: params.waId,
      stickerName,
      reason: "link_not_found",
      policyEvent: params.policyEvent ?? null,
    });
    return;
  }

  try {
    await params.client.sendSticker({
      phoneNumberId: params.phoneNumberId,
      to: params.waId,
      stickerLink,
      correlationId: `${params.tenantId}:${params.waId}:sticker:${stickerName}`,
      tenantId: params.tenantId,
    });
    logger.info("STICKER_SEND_OK", {
      tenantId: params.tenantId,
      waId: params.waId,
      stickerName,
      policyEvent: params.policyEvent ?? null,
    });
  } catch (error) {
    logger.warn("STICKER_SEND_FAIL", {
      tenantId: params.tenantId,
      waId: params.waId,
      stickerName,
      reason: (error as Error).message,
      policyEvent: params.policyEvent ?? null,
    });
  }
}

export function createFlowMessenger(
  client: CloudApiClient,
  deps?: {
    catalog?: StickerCatalogService;
    acquireStickerCooldown?: (params: { tenantId: string; waId: string; windowMs: number }) => Promise<boolean>;
  },
): FlowMessenger {
  const catalog = deps?.catalog ?? stickerCatalogService;
  const canSendSticker = deps?.acquireStickerCooldown ?? acquireStickerCooldown;
  return {
    async sendText(params: {
      tenantId: string;
      phoneNumberId: string;
      waId: string;
      body: string;
      stickerName?: string;
      policyEvent?: string;
      buttons?: Array<{ id: string; title: string }>;
      isLocationRequest?: boolean;
      pdfUrl?: string;
    }) {
      try {
        // 1. Send Sticker first if requested
        await maybeSendSticker({
          client,
          catalog,
          canSendSticker,
          tenantId: params.tenantId,
          phoneNumberId: params.phoneNumberId,
          waId: params.waId,
          stickerName: params.stickerName,
          policyEvent: params.policyEvent,
        });

        // 2. Determine Message Type
        let result: { messageId: string | null };
        if (params.isLocationRequest) {
          result = await client.sendLocationRequest({
            phoneNumberId: params.phoneNumberId,
            to: params.waId,
            body: params.body,
            correlationId: `${params.tenantId}:${params.waId}:location_request`,
          });
        } else if (params.buttons && params.buttons.length > 0) {
          result = await client.sendReplyButtons({
            phoneNumberId: params.phoneNumberId,
            to: params.waId,
            body: params.body,
            correlationId: `${params.tenantId}:${params.waId}:buttons`,
            buttons: params.buttons,
          });
        } else if (params.pdfUrl) {
          // Send the PDF first, then the text
          await client.sendDocument({
            phoneNumberId: params.phoneNumberId,
            to: params.waId,
            documentUrl: params.pdfUrl,
            fileName: "Recibo_ChamaDudu.pdf",
            caption: "Aqui está o seu recibo! 📄",
            correlationId: `${params.tenantId}:${params.waId}:pdf`,
          });
          result = await client.sendText({
            phoneNumberId: params.phoneNumberId,
            to: params.waId,
            body: params.body,
            correlationId: `${params.tenantId}:${params.waId}:text`,
          });
        } else {
          result = await client.sendText({
            phoneNumberId: params.phoneNumberId,
            to: params.waId,
            body: params.body,
            correlationId: `${params.tenantId}:${params.waId}:text`,
          });
        }

        // 3. Save to Ops Trace
        await opsRepositories.saveOutboundMessage({
          tenantId: params.tenantId,
          waId: params.waId,
          messageId: result.messageId,
          body: params.body,
          type: params.buttons || params.isLocationRequest ? "interactive" : "text",
        });
      } catch (error) {
        logger.error("WA_SEND_TEXT_FAILED", {
          tenantId: params.tenantId,
          waId: params.waId,
          reason: (error as Error).message,
        });
      }
    },
    async sendContactRequest(params: {
      tenantId: string;
      phoneNumberId: string;
      waId: string;
      body: string;
    }) {
      try {
        const result = await client.sendContactRequest({
          phoneNumberId: params.phoneNumberId,
          to: params.waId,
          body: params.body,
          correlationId: `${params.tenantId}:${params.waId}:contact_request`,
        });
        await opsRepositories.saveOutboundMessage({
          tenantId: params.tenantId,
          waId: params.waId,
          messageId: result.messageId,
          body: params.body,
          type: "interactive",
        });
      } catch (error) {
        logger.error("WA_CONTACT_REQUEST_FAILED", {
          tenantId: params.tenantId,
          waId: params.waId,
          reason: (error as Error).message,
        });
      }
    },
    async sendList(params: {
      tenantId: string;
      phoneNumberId: string;
      waId: string;
      body: string;
      buttonLabel: string;
      sections: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    }) {
      try {
        const result = await client.sendListMessage({
          phoneNumberId: params.phoneNumberId,
          to: params.waId,
          body: params.body,
          buttonLabel: params.buttonLabel,
          sections: params.sections,
          correlationId: `${params.tenantId}:${params.waId}:list`,
        });
        await opsRepositories.saveOutboundMessage({
          tenantId: params.tenantId,
          waId: params.waId,
          messageId: result.messageId,
          body: params.body,
          type: "interactive",
        });
      } catch (error) {
        logger.error("WA_SEND_LIST_FAILED", {
          tenantId: params.tenantId,
          waId: params.waId,
          reason: (error as Error).message,
        });
      }
    },
  };
}
