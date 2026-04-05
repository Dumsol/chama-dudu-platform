import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRecord, WhatsAppInboundMessage } from "../src/domain/whatsapp/types";

const users = new Map<string, UserRecord>();
const transitionCalls: Array<Record<string, unknown>> = [];
const queryRAGMock = vi.fn();

function userKey(tenantId: string, user: { waId?: string | null; bsuId?: string | null }): string {
  return `${tenantId}:${user.waId ?? user.bsuId ?? "unknown"}`;
}

function makeUser(overrides: Partial<UserRecord>): UserRecord {
  return {
    userId: "usr_test",
    tenantId: "app",
    waId: "5581999999999",
    type: "cliente",
    role: "cliente",
    botState: "idle",
    conversationHistory: [],
    activeOrderId: null,
    fallbackCount: 0,
    lastActivityAtMs: Date.now(),
    pendingOffers: [],
    ...overrides,
  } as UserRecord;
}

vi.mock("../src/infra/ai/vertexAiService", () => ({
  queryRAG: (...args: unknown[]) => queryRAGMock(...args),
}));

vi.mock("../src/infra/firestore/duduPaths", () => ({
  tenantConfigDoc: () => ({
    get: async () => ({ data: () => ({}) }),
    set: async () => undefined,
  }),
}));

vi.mock("../src/infra/config/secrets", () => ({
  readDevToken: () => "dev-token",
}));

vi.mock("../src/infra/firestore/opsRepositories", () => ({
  opsRepositories: {
    getUserByTenantWaId: async (tenantId: string, waId: string) => users.get(`${tenantId}:${waId}`) ?? null,
    upsertUser: async (params: any) => {
      const user = makeUser({
        userId: String(params.waId ?? params.bsuId ?? "unknown"),
        tenantId: params.tenantId,
        waId: params.waId ?? null,
        bsuId: params.bsuId ?? undefined,
        waUsername: params.waUsername ?? undefined,
        name: params.name ?? undefined,
        type: params.type,
        role: params.type === "deposito" ? "deposito" : "cliente",
        botState: params.botState,
        conversationHistory: params.conversationHistory ?? [],
      });
      users.set(userKey(params.tenantId, user), user);
      return user;
    },
    transitionUserState: async (params: any) => {
      transitionCalls.push(params);
      const key = userKey(params.tenantId, { waId: params.waId ?? null, bsuId: params.bsuId ?? null });
      const current = users.get(key) ?? makeUser({ userId: key, tenantId: params.tenantId, waId: params.waId ?? null });
      const next = {
        ...current,
        ...params,
        botState: params.botState ?? current.botState,
        conversationHistory: params.conversationHistory ?? current.conversationHistory,
        lastActivityAtMs: params.lastActivityAtMs ?? current.lastActivityAtMs,
      } as UserRecord;
      users.set(key, next);
      return next;
    },
  },
}));

function buildMessage(text: string): WhatsAppInboundMessage {
  return {
    phoneNumberId: "123",
    messageId: `m_${Math.random()}`,
    waId: "5581999999999",
    bsuId: null as any,
    waUsername: "edu",
    type: "text",
    timestamp: String(Date.now()),
    text,
    interactiveId: null,
    interactiveTitle: null,
    profileName: "Eduardo",
    sourceKind: "text",
    location: null,
  };
}

describe("stateEngine regression guards", () => {
  beforeEach(() => {
    users.clear();
    transitionCalls.length = 0;
    queryRAGMock.mockReset();
  });

  it("bloqueia regressão para awaiting_neighborhood em sessão fresca com bairro confirmado", async () => {
    const baseUser = makeUser({
      userId: "5581999999999",
      waId: "5581999999999",
      botState: "awaiting_product",
      bairro: "Pau Amarelo",
      bairroNorm: "pau_amarelo",
      lastActivityAtMs: Date.now() - 2 * 60 * 1000,
    });
    users.set(userKey("app", baseUser), baseUser);
    queryRAGMock.mockResolvedValue({
      answer:
        '<json>{"intent":"product_request","currentBotState":"awaiting_product","nextBotState":"awaiting_neighborhood","effectiveEntities":{"bairroNorm":"pau_amarelo","bairro":"Pau Amarelo","beverageBrand":null,"beverageVolumeMl":null,"beveragePackType":null,"hasVasilhame":null,"ageConfirmed":false,"paymentMethod":null},"responseText":"Qual o bairro da entrega?"}</json>',
      sourceNodes: [],
    });

    const { stateEngine } = await import("../src/domain/whatsapp/stateEngine");
    const response = await stateEngine.processInboundMessage({
      tenantId: "app",
      waId: "5581999999999",
      message: buildMessage("12 bud"),
    });

    const lastTransition = transitionCalls[transitionCalls.length - 1];
    expect(lastTransition.botState).not.toBe("awaiting_neighborhood");
    expect(response.body.toLowerCase()).toContain("embalagem");
  });

  it("permite regressão para awaiting_neighborhood após sessão expirada (>60min)", async () => {
    const baseUser = makeUser({
      userId: "5581999999999",
      waId: "5581999999999",
      botState: "awaiting_product",
      bairro: "Pau Amarelo",
      bairroNorm: "pau_amarelo",
      lastActivityAtMs: Date.now() - 61 * 60 * 1000,
    });
    users.set(userKey("app", baseUser), baseUser);
    queryRAGMock.mockResolvedValue({
      answer:
        '<json>{"intent":"product_request","currentBotState":"awaiting_product","nextBotState":"awaiting_neighborhood","effectiveEntities":{"bairroNorm":"pau_amarelo","bairro":"Pau Amarelo","beverageBrand":null,"beverageVolumeMl":null,"beveragePackType":null,"hasVasilhame":null,"ageConfirmed":false,"paymentMethod":null},"responseText":"Qual o bairro da entrega?"}</json>',
      sourceNodes: [],
    });

    const { stateEngine } = await import("../src/domain/whatsapp/stateEngine");
    await stateEngine.processInboundMessage({
      tenantId: "app",
      waId: "5581999999999",
      message: buildMessage("12 bud"),
    });

    const lastTransition = transitionCalls[transitionCalls.length - 1];
    expect(lastTransition.botState).toBe("awaiting_neighborhood");
  });

  it("envia para awaiting_vasilhame quando litrão surge em clarificação de bebida", async () => {
    const baseUser = makeUser({
      userId: "5581999999999",
      waId: "5581999999999",
      botState: "awaiting_beverage_clarification",
      bairro: "Pau Amarelo",
      bairroNorm: "pau_amarelo",
      ageConfirmed: true,
      lastActivityAtMs: Date.now(),
    });
    users.set(userKey("app", baseUser), baseUser);
    queryRAGMock.mockResolvedValue({
      answer:
        '<json>{"intent":"embalagem_clarification","currentBotState":"awaiting_beverage_clarification","nextBotState":"awaiting_beverage_clarification","effectiveEntities":{"bairroNorm":"pau_amarelo","bairro":"Pau Amarelo","beverageBrand":"Bud","beverageVolumeMl":1000,"beveragePackType":"litrão","hasVasilhame":null,"ageConfirmed":true,"paymentMethod":null},"responseText":"Beleza"}</json>',
      sourceNodes: [],
    });

    const { stateEngine } = await import("../src/domain/whatsapp/stateEngine");
    await stateEngine.processInboundMessage({
      tenantId: "app",
      waId: "5581999999999",
      message: buildMessage("litrão"),
    });

    const lastTransition = transitionCalls[transitionCalls.length - 1];
    expect(lastTransition.botState).toBe("awaiting_vasilhame");
  });

  it("persiste hasVasilhame=true em caminho determinístico", async () => {
    const baseUser = makeUser({
      userId: "5581999999999",
      waId: "5581999999999",
      botState: "awaiting_vasilhame",
      bairro: "Pau Amarelo",
      bairroNorm: "pau_amarelo",
      ageConfirmed: true,
      lastActivityAtMs: Date.now(),
    });
    users.set(userKey("app", baseUser), baseUser);
    queryRAGMock.mockResolvedValue({
      answer:
        '<json>{"intent":"vasilhame_response","currentBotState":"awaiting_vasilhame","nextBotState":"awaiting_vasilhame","effectiveEntities":{"bairroNorm":"pau_amarelo","bairro":"Pau Amarelo","beverageBrand":"Bud","beverageVolumeMl":1000,"beveragePackType":"litrão","hasVasilhame":null,"ageConfirmed":true,"paymentMethod":null},"responseText":"Perfeito"}</json>',
      sourceNodes: [],
    });

    const { stateEngine } = await import("../src/domain/whatsapp/stateEngine");
    await stateEngine.processInboundMessage({
      tenantId: "app",
      waId: "5581999999999",
      message: buildMessage("sim"),
    });

    const lastTransition = transitionCalls[transitionCalls.length - 1];
    expect(lastTransition.hasVasilhame).toBe(true);
    expect(lastTransition.botState).toBe("awaiting_checkout");
  });
});
