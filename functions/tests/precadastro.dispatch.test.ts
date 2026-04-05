import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchPreCadastroConfirmation } from "../src/domain/precadastro/templateDispatch";

describe("pre-cadastro template dispatch", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.WA_TEMPLATE_DEPOSITO_PRE_CADASTRO_CONFIRMACAO;
    delete process.env.WHATSAPP_TEMPLATE_DEPOSITO_PRE_CADASTRO_CONFIRMACAO;
    delete process.env.WA_TEMPLATE_PRE_CADASTRO_ALLOW_TEXT_FALLBACK;
  });

  it("sends template when configured", async () => {
    process.env.WA_TEMPLATE_DEPOSITO_PRE_CADASTRO_CONFIRMACAO = "deposito_precadastro_confirmacao_v1";
    const sendTemplate = vi.fn(async () => undefined);
    const sendTextFallback = vi.fn(async () => undefined);
    const claimTemplateDispatch = vi.fn(async () => ({ allowed: true, reason: "claimed" as const }));
    const finishTemplateDispatch = vi.fn(async () => undefined);

    const result = await dispatchPreCadastroConfirmation({
      tenantId: "tenant-a",
      preCadastroId: "pc-1",
      waId: "5581991112222",
      phoneNumberId: "123",
      source: "test",
      repo: { claimTemplateDispatch, finishTemplateDispatch },
      sender: { sendTemplate, sendTextFallback },
    });

    expect(result.sent).toBe(true);
    expect(result.usedFallback).toBe(false);
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    expect(sendTextFallback).not.toHaveBeenCalled();
    expect(finishTemplateDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" }),
    );
  });

  it("is idempotent when dispatch already sent", async () => {
    process.env.WA_TEMPLATE_DEPOSITO_PRE_CADASTRO_CONFIRMACAO = "deposito_precadastro_confirmacao_v1";
    const sendTemplate = vi.fn(async () => undefined);
    const sendTextFallback = vi.fn(async () => undefined);
    const claimTemplateDispatch = vi.fn(async () => ({
      allowed: false,
      reason: "already_sent" as const,
    }));
    const finishTemplateDispatch = vi.fn(async () => undefined);

    const result = await dispatchPreCadastroConfirmation({
      tenantId: "tenant-a",
      preCadastroId: "pc-1",
      waId: "5581991112222",
      phoneNumberId: "123",
      source: "test",
      repo: { claimTemplateDispatch, finishTemplateDispatch },
      sender: { sendTemplate, sendTextFallback },
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("already_sent");
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(finishTemplateDispatch).not.toHaveBeenCalled();
  });

  it("marks failed when template is missing and fallback is disabled", async () => {
    process.env.WA_TEMPLATE_PRE_CADASTRO_ALLOW_TEXT_FALLBACK = "false";
    const sendTemplate = vi.fn(async () => undefined);
    const sendTextFallback = vi.fn(async () => undefined);
    const claimTemplateDispatch = vi.fn(async () => ({ allowed: true, reason: "claimed" as const }));
    const finishTemplateDispatch = vi.fn(async () => undefined);

    const result = await dispatchPreCadastroConfirmation({
      tenantId: "tenant-a",
      preCadastroId: "pc-1",
      waId: "5581991112222",
      phoneNumberId: "123",
      source: "test",
      repo: { claimTemplateDispatch, finishTemplateDispatch },
      sender: { sendTemplate, sendTextFallback },
    });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe("template_name_missing");
    expect(sendTextFallback).not.toHaveBeenCalled();
    expect(finishTemplateDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", nextStatusIfFailed: "failed_delivery" }),
    );
  });
});
