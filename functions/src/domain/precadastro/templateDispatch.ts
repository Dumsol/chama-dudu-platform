import * as logger from "firebase-functions/logger";
import { PRE_CADASTRO_CONFIRMATION_COPY } from "./confirmationFlow";
import {
  PRE_CADASTRO_TEMPLATE_CATEGORY,
  readPreCadastroTemplateLanguage,
  readPreCadastroTemplateName,
  allowPreCadastroTextFallback,
} from "./runtime";
import type { PreCadastroStatus } from "./types";

export interface PreCadastroTemplateDispatchRepository {
  claimTemplateDispatch: (params: {
    tenantId: string;
    preCadastroId: string;
    dispatchKey: string;
    templateName: string;
    languageCode: string;
    source: string;
  }) => Promise<{ allowed: boolean; reason: "already_sent" | "already_sending" | "claimed" }>;
  finishTemplateDispatch: (params: {
    tenantId: string;
    preCadastroId: string;
    status: "sent" | "failed";
    errorMessage?: string | null;
    nextStatusIfFailed?: PreCadastroStatus;
  }) => Promise<void>;
}

export interface PreCadastroTemplateDispatcher {
  sendTemplate: (params: {
    tenantId: string;
    phoneNumberId: string;
    waId: string;
    templateName: string;
    languageCode: string;
  }) => Promise<void>;
  sendTextFallback: (params: {
    tenantId: string;
    phoneNumberId: string;
    waId: string;
    body: string;
  }) => Promise<void>;
}

export async function dispatchPreCadastroConfirmation(params: {
  tenantId: string;
  preCadastroId: string;
  waId: string;
  phoneNumberId: string;
  source: string;
  repo: PreCadastroTemplateDispatchRepository;
  sender: PreCadastroTemplateDispatcher;
}): Promise<{
  sent: boolean;
  usedFallback: boolean;
  reason?: string;
  templateName?: string;
  languageCode?: string;
}> {
  const templateName = readPreCadastroTemplateName();
  const languageCode = readPreCadastroTemplateLanguage();
  const dispatchKey = `precadastro:${params.preCadastroId}:confirmacao:v1`;
  const allowFallback = allowPreCadastroTextFallback();

  const claim = await params.repo.claimTemplateDispatch({
    tenantId: params.tenantId,
    preCadastroId: params.preCadastroId,
    dispatchKey,
    templateName: templateName || "missing",
    languageCode,
    source: params.source,
  });
  if (!claim.allowed) {
    logger.info("PRE_CADASTRO_TEMPLATE_SKIPPED", {
      tenantId: params.tenantId,
      preCadastroId: params.preCadastroId,
      waId: params.waId,
      dispatchKey,
      reason: claim.reason,
    });
    return { sent: false, usedFallback: false, reason: claim.reason };
  }

  if (!templateName) {
    if (!allowFallback) {
      await params.repo.finishTemplateDispatch({
        tenantId: params.tenantId,
        preCadastroId: params.preCadastroId,
        status: "failed",
        errorMessage: "template_name_missing",
        nextStatusIfFailed: "failed_delivery",
      });
      logger.error("PRE_CADASTRO_TEMPLATE_MISSING", {
        tenantId: params.tenantId,
        preCadastroId: params.preCadastroId,
        waId: params.waId,
      });
      return { sent: false, usedFallback: false, reason: "template_name_missing" };
    }

    await params.sender.sendTextFallback({
      tenantId: params.tenantId,
      phoneNumberId: params.phoneNumberId,
      waId: params.waId,
      body: PRE_CADASTRO_CONFIRMATION_COPY,
    });
    await params.repo.finishTemplateDispatch({
      tenantId: params.tenantId,
      preCadastroId: params.preCadastroId,
      status: "sent",
    });
    logger.warn("PRE_CADASTRO_TEMPLATE_FALLBACK_TEXT_USED", {
      tenantId: params.tenantId,
      preCadastroId: params.preCadastroId,
      waId: params.waId,
      reason: "template_name_missing",
    });
    return { sent: true, usedFallback: true, reason: "template_name_missing" };
  }

  try {
    await params.sender.sendTemplate({
      tenantId: params.tenantId,
      phoneNumberId: params.phoneNumberId,
      waId: params.waId,
      templateName,
      languageCode,
    });
    await params.repo.finishTemplateDispatch({
      tenantId: params.tenantId,
      preCadastroId: params.preCadastroId,
      status: "sent",
    });
    logger.info("PRE_CADASTRO_TEMPLATE_SENT", {
      tenantId: params.tenantId,
      preCadastroId: params.preCadastroId,
      waId: params.waId,
      templateName,
      languageCode,
      templateCategory: PRE_CADASTRO_TEMPLATE_CATEGORY,
    });
    return {
      sent: true,
      usedFallback: false,
      templateName,
      languageCode,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown_template_send_error";
    if (allowFallback) {
      try {
        await params.sender.sendTextFallback({
          tenantId: params.tenantId,
          phoneNumberId: params.phoneNumberId,
          waId: params.waId,
          body: PRE_CADASTRO_CONFIRMATION_COPY,
        });
        await params.repo.finishTemplateDispatch({
          tenantId: params.tenantId,
          preCadastroId: params.preCadastroId,
          status: "sent",
        });
        logger.warn("PRE_CADASTRO_TEMPLATE_FALLBACK_AFTER_ERROR", {
          tenantId: params.tenantId,
          preCadastroId: params.preCadastroId,
          waId: params.waId,
          templateName,
          languageCode,
          error: errorMessage,
        });
        return {
          sent: true,
          usedFallback: true,
          reason: errorMessage,
          templateName,
          languageCode,
        };
      } catch (fallbackError) {
        const fallbackErrorMessage =
          fallbackError instanceof Error ? fallbackError.message : "fallback_send_error";
        await params.repo.finishTemplateDispatch({
          tenantId: params.tenantId,
          preCadastroId: params.preCadastroId,
          status: "failed",
          errorMessage: `${errorMessage};fallback:${fallbackErrorMessage}`,
          nextStatusIfFailed: "failed_delivery",
        });
        logger.error("PRE_CADASTRO_TEMPLATE_AND_FALLBACK_FAILED", {
          tenantId: params.tenantId,
          preCadastroId: params.preCadastroId,
          waId: params.waId,
          templateName,
          languageCode,
          error: errorMessage,
          fallbackError: fallbackErrorMessage,
        });
        return { sent: false, usedFallback: false, reason: fallbackErrorMessage };
      }
    }

    await params.repo.finishTemplateDispatch({
      tenantId: params.tenantId,
      preCadastroId: params.preCadastroId,
      status: "failed",
      errorMessage,
      nextStatusIfFailed: "failed_delivery",
    });
    logger.error("PRE_CADASTRO_TEMPLATE_SEND_FAILED", {
      tenantId: params.tenantId,
      preCadastroId: params.preCadastroId,
      waId: params.waId,
      templateName,
      languageCode,
      error: errorMessage,
    });
    return { sent: false, usedFallback: false, reason: errorMessage, templateName, languageCode };
  }
}
