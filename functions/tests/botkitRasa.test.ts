import { describe, it, expect, vi, beforeEach } from "vitest";
import { botkitManager } from "../src/domain/whatsapp/botkitController";
import { parseWithRasa } from "../src/infra/nlu/rasaClient";
import type { FlowRepository, FlowMessenger, WhatsAppInboundMessage, UserRecord } from "../src/domain/whatsapp/types";

// Mock NLU
vi.mock("../src/infra/nlu/rasaClient", () => ({
  parseWithRasa: vi.fn(),
}));

describe("Botkit & Rasa Integration Flow", () => {
  let mockRepo: any;
  let mockMessenger: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo = {
      getUserByTenantWaId: vi.fn(),
      upsertUser: vi.fn((params) => Promise.resolve(params)),
      transitionUserState: vi.fn((params) => Promise.resolve(params)),
      acquireProcessingLock: vi.fn().mockResolvedValue("acquired"),
      releaseProcessingLock: vi.fn().mockResolvedValue(undefined),
      listOpenDepositosByBairro: vi.fn().mockResolvedValue([{ depositoId: "dep_1" }]),
    };
    mockMessenger = {
      sendText: vi.fn().mockResolvedValue(undefined),
      sendClienteButtons: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("should ask for neighborhood when state.bairro is missing", async () => {
    const user: Partial<UserRecord> = {
      waId: "123",
      botState: "idle",
      bairro: null,
      bairroNorm: null,
      slots: {},
    };
    mockRepo.getUserByTenantWaId.mockResolvedValue(user);
    
    (parseWithRasa as any).mockResolvedValue({
      classification: { intent: "saudacao", confidence: 0.9, reasons: ["mock"] },
      entities: { bairro: null, bairroNorm: null, beverage: null },
    });

    const message: Partial<WhatsAppInboundMessage> = {
      waId: "123",
      text: "Oi",
      phoneNumberId: "phone_123",
    };

    await botkitManager.handleInbound({
      tenantId: "t1",
      waId: "123",
      message: message as any,
      repo: mockRepo as any,
      messenger: mockMessenger as any,
    });

    // Check if it sent the menu greeting with buttons (Dudu persona)
    expect(mockMessenger.sendClienteButtons).toHaveBeenCalledWith(expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: "cliente_fazer_pedido" })]),
    }));
  });

  it("should ask for beverage when bairro is known but beverage is missing", async () => {
    const user: Partial<UserRecord> = {
      waId: "123",
      botState: "awaiting_neighborhood",
      bairro: "Pau Amarelo",
      bairroNorm: "pau amarelo",
      slots: {},
    };
    mockRepo.getUserByTenantWaId.mockResolvedValue(user);
    
    (parseWithRasa as any).mockResolvedValue({
      classification: { intent: "inform_neighborhood", confidence: 0.9, reasons: ["mock"] },
      entities: { bairro: "Pau Amarelo", bairroNorm: "pau amarelo", beverage: null },
    });

    const message: Partial<WhatsAppInboundMessage> = {
      waId: "123",
      text: "Pau Amarelo",
    };

    await botkitManager.handleInbound({
      tenantId: "t1",
      waId: "123",
      message: message as any,
      repo: mockRepo as any,
      messenger: mockMessenger as any,
    });

    expect(mockMessenger.sendText).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("beber"),
    }));
  });

  it("should fallback to internal heuristics when Rasa fails (internal fallback)", async () => {
    const user: Partial<UserRecord> = {
      waId: "123",
      botState: "idle",
      bairro: null,
    };
    mockRepo.getUserByTenantWaId.mockResolvedValue(user);
    
    // Simulate Rasa Fallback (it resolves with internal data even if service is down)
    (parseWithRasa as any).mockResolvedValue({
      classification: { intent: "cliente_informar_bairro", confidence: 1, reasons: ["fallback"] },
      entities: { bairro: "Centro", bairroNorm: "centro", beverage: null },
    });

    const message: Partial<WhatsAppInboundMessage> = {
      waId: "123",
      text: "moro no centro",
    };

    await botkitManager.handleInbound({
      tenantId: "t1",
      waId: "123",
      message: message as any,
      repo: mockRepo as any,
      messenger: mockMessenger as any,
    });

    expect(mockMessenger.sendText).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("beber"),
    }));
  });

  it("should send graceful failure message on critical error", async () => {
    const user: Partial<UserRecord> = { waId: "123" };
    mockRepo.getUserByTenantWaId.mockResolvedValue(user);
    
    // Force a crash
    (parseWithRasa as any).mockRejectedValue(new Error("Database Crash"));

    const message: Partial<WhatsAppInboundMessage> = { waId: "123", text: "hi" };

    await botkitManager.handleInbound({
      tenantId: "t1",
      waId: "123",
      message: message as any,
      repo: mockRepo as any,
      messenger: mockMessenger as any,
    });

    expect(mockMessenger.sendText).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("problema"),
    }));
  });

  it("should allow state correction mid-flow", async () => {
    const user: Partial<UserRecord> = {
      waId: "123",
      botState: "awaiting_product",
      bairro: "Pau Amarelo",
      bairroNorm: "pau amarelo",
      slots: { product: null },
    };
    mockRepo.getUserByTenantWaId.mockResolvedValue(user);
    
    (parseWithRasa as any).mockResolvedValue({
      classification: { intent: "cliente_informar_bairro", confidence: 0.9, reasons: ["mock"] },
      entities: { bairro: "Centro", bairroNorm: "centro", beverage: null },
    });

    const message: Partial<WhatsAppInboundMessage> = {
      waId: "123",
      text: "mudei para o centro",
    };

    await botkitManager.handleInbound({
      tenantId: "t1",
      waId: "123",
      message: message as any,
      repo: mockRepo as any,
      messenger: mockMessenger as any,
    });

    // Check if it accepted the new bairro even in 'awaiting_product' state
    expect(mockRepo.transitionUserState).toHaveBeenCalledWith(expect.objectContaining({
      bairroNorm: "centro",
    }));
  });

  it("should trigger Entity Guard when intent is present but entity extraction fails", async () => {
    const user: Partial<UserRecord> = { waId: "123", botState: "idle", bairro: null };
    mockRepo.getUserByTenantWaId.mockResolvedValue(user);
    
    // Rasa detected intent but NO entities
    (parseWithRasa as any).mockResolvedValue({
      classification: { intent: "cliente_informar_bairro", confidence: 0.9, reasons: ["mock"] },
      entities: { bairro: null, bairroNorm: null },
    });

    const message: Partial<WhatsAppInboundMessage> = { waId: "123", text: "moro ali no..." };

    await botkitManager.handleInbound({
      tenantId: "t1", waId: "123", message: message as any, repo: mockRepo as any, messenger: mockMessenger as any,
    });

    // It should trigger the UX Guard retry message
    expect(mockMessenger.sendText).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("Não consegui identificar o bairro"),
    }));
  });

  it("should block duplicate requests via idempotency lock", async () => {
    const message: Partial<WhatsAppInboundMessage> = {
      waId: "123",
      text: "Oi",
      messageId: "msg_duplicate_1",
    };
    
    // First call acquires lock
    mockRepo.acquireProcessingLock.mockResolvedValueOnce("acquired");
    // Second call is blocked
    mockRepo.acquireProcessingLock.mockResolvedValueOnce("blocked");

    mockRepo.getUserByTenantWaId.mockResolvedValue({ waId: "123", botState: "idle" });

    // Call 1
    await botkitManager.handleInbound({
      tenantId: "t1", waId: "123", message: message as any, repo: mockRepo as any, messenger: mockMessenger as any,
    });

    // Call 2 (Simulated duplicate)
    await botkitManager.handleInbound({
      tenantId: "t1", waId: "123", message: message as any, repo: mockRepo as any, messenger: mockMessenger as any,
    });

    // parseWithRasa should only be called once
    expect(parseWithRasa).toHaveBeenCalledTimes(1);
    expect(mockRepo.acquireProcessingLock).toHaveBeenCalledTimes(2);
  });

  it("should reset state to idle if botStateExpiresAtMs is in the past", async () => {
    const expiredUser: Partial<UserRecord> = {
      waId: "123",
      botState: "awaiting_product",
      botStateExpiresAtMs: Date.now() - 1000, // 1s ago
      slots: { product: "Cerveja" },
    };
    mockRepo.getUserByTenantWaId.mockResolvedValue(expiredUser);
    
    (parseWithRasa as any).mockResolvedValue({
      classification: { intent: "saudacao", confidence: 0.9, reasons: ["mock"] },
      entities: { bairro: null, bairroNorm: null, beverage: null },
    });

    const message: Partial<WhatsAppInboundMessage> = { waId: "123", text: "Oi" };

    await botkitManager.handleInbound({
      tenantId: "t1", waId: "123", message: message as any, repo: mockRepo as any, messenger: mockMessenger as any,
    });

    // It should now show the menu greeting (Dudu persona) with buttons
    expect(mockMessenger.sendClienteButtons).toHaveBeenCalledWith(expect.objectContaining({
      buttons: expect.arrayContaining([expect.objectContaining({ id: "cliente_fazer_pedido" })]),
    }));
  });

  it("should identify Heineken as a beverage using heuristic", async () => {
    mockRepo.getUserByTenantWaId.mockResolvedValue({ waId: "123", botState: "idle", bairroNorm: "centro" });
    
    (parseWithRasa as any).mockResolvedValue({
      classification: { intent: "cliente_iniciar_pedido", confidence: 0.9, reasons: ["mock"] },
      entities: { bairro: null, bairroNorm: null, beverage: null }, // Rasa failed
    });

    const message: Partial<WhatsAppInboundMessage> = { waId: "123", text: "Quero uma Heineken" };

    await botkitManager.handleInbound({
      tenantId: "t1", waId: "123", message: message as any, repo: mockRepo as any, messenger: mockMessenger as any,
    });

    // Should transition to awaiting_confirmation because bairro is already known
    expect(mockRepo.transitionUserState).toHaveBeenCalledWith(expect.objectContaining({
      botState: "awaiting_confirmation",
      slots: expect.objectContaining({ product: "Cerveja Heineken" }),
    }));
  });

  it("should identify 'heinken' misspelling and proceed to confirmation", async () => {
    mockRepo.getUserByTenantWaId.mockResolvedValue({ 
      waId: "123", 
      botState: "idle", 
      bairroNorm: "centro" 
    });
    
    (parseWithRasa as any).mockResolvedValue({
      classification: { intent: "cliente_iniciar_pedido", confidence: 0.9, reasons: ["mock"] },
      entities: { beverage: null },
    });

    const message: Partial<WhatsAppInboundMessage> = { waId: "123", text: "Quero uma heinken" };

    await botkitManager.handleInbound({
      tenantId: "t1", waId: "123", message: message as any, repo: mockRepo as any, messenger: mockMessenger as any,
    });

    expect(mockRepo.transitionUserState).toHaveBeenCalledWith(expect.objectContaining({
      slots: expect.objectContaining({ product: "Cerveja Heineken" }),
    }));
  });

  it("should tell user when no stores are open in the neighborhood", async () => {
    mockRepo.getUserByTenantWaId.mockResolvedValue({ 
      waId: "123", 
      botState: "idle", 
      bairroNorm: "centro" 
    });
    
    // Mock NO open stores
    mockRepo.listOpenDepositosByBairro.mockResolvedValue([]);

    (parseWithRasa as any).mockResolvedValue({
      classification: { intent: "cliente_iniciar_pedido", confidence: 0.9, reasons: ["mock"] },
      entities: { beverage: "Cerveja" },
    });

    const message: Partial<WhatsAppInboundMessage> = { waId: "123", text: "Quero uma Cerveja" };

    await botkitManager.handleInbound({
      tenantId: "t1", waId: "123", message: message as any, repo: mockRepo as any, messenger: mockMessenger as any,
    });

    expect(mockMessenger.sendText).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining("Não tem entrega"),
    }));
    expect(mockRepo.transitionUserState).toHaveBeenCalledWith(expect.objectContaining({
      botState: "idle",
    }));
  });
});
