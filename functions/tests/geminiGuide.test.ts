import { describe, expect, it, vi } from "vitest";
import type { GeminiGuideDeps } from "../src/domain/whatsapp/geminiGuide";
import { maybeResolveWithGeminiGuide } from "../src/domain/whatsapp/geminiGuide";
import type { UserRecord } from "../src/domain/whatsapp/types";

function baseUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    userId: "tenant-gem:5581990000001",
    tenantId: "tenant-gem",
    waId: "5581990000001",
    type: "cliente",
    botState: "idle",
    currentFlow: "client",
    currentStep: "idle",
    fallbackCount: 0,
    ...overrides,
  };
}

function baseDeps(raw: string): GeminiGuideDeps {
  return {
    loadConfig: async () => ({
      enabled: true,
      percent: 100,
      replyAssistEnabled: true,
      allowedRoles: ["cliente"],
    }),
    readApiKey: () => "gem-key",
    claimUsage: async (params) => ({ allowed: true, reason: "allowed", reservedTokens: params.reserveTokens }),
    getCache: async () => null,
    setCache: async () => void 0,
    recordUsage: async () => void 0,
    audit: async () => void 0,
    callModel: async () => ({ raw, usageTokens: 64 }),
  };
}

describe("gemini guide", () => {
  it("returns a safe guide decision for bairro inference", async () => {
    const decision = await maybeResolveWithGeminiGuide(
      {
        tenantId: "tenant-gem",
        waId: "5581990000001",
        role: "cliente",
        stage: "post_classification",
        message: {
          raw: "to por ali na area do janga",
          normalized: "to por ali na area do janga",
          compact: "estou por ali na area do janga",
          tokens: ["estou", "por", "ali", "na", "area", "do", "janga"],
        },
        currentUser: baseUser(),
        entities: {
          bairro: null,
          bairroNorm: null,
          cidade: null,
          confirmation: null,
          statusOperacional: null,
          beverage: null,
          orderIntent: false,
          quantity: null,
        },
        classification: {
          intent: "fallback",
          confidence: 0.2,
          reasons: ["score_too_low"],
          alternatives: [],
        },
        socialSignal: null,
        allowReplyAssist: true,
      },
      baseDeps(
        JSON.stringify({
          mode: "guide_only",
          confidence: 0.91,
          safeToUse: true,
          nextSafeAction: "save_bairro",
          bairroCandidate: "Janga",
          reason: "bairro_contextual",
        }),
      ),
    );

    expect(decision.kind).toBe("guide_decision");
    if (decision.kind === "guide_decision") {
      expect(decision.nextSafeAction).toBe("save_bairro");
      expect(decision.bairroCandidate).toBe("Janga");
      expect(decision.bairroNorm).toBe("janga");
    }
  });

  it("allows reply assist only for complex fallback cases", async () => {
    const decision = await maybeResolveWithGeminiGuide(
      {
        tenantId: "tenant-gem",
        waId: "5581990000001",
        role: "cliente",
        stage: "post_classification",
        message: {
          raw: "to com um negocio estranho aqui, queria pedir mas nao sei se voces pegam onde eu to agora",
          normalized: "to com um negocio estranho aqui queria pedir mas nao sei se voces pegam onde eu to agora",
          compact: "estou com um negocio estranho aqui queria pedir mas nao sei se voces pegam onde eu estou agora",
          tokens: ["estou", "com", "um", "negocio", "estranho", "aqui", "queria", "pedir", "mas", "nao", "sei", "se", "voces", "pegam", "onde", "eu", "estou", "agora"],
        },
        currentUser: baseUser(),
        entities: {
          bairro: null,
          bairroNorm: null,
          cidade: null,
          confirmation: null,
          statusOperacional: null,
          beverage: null,
          orderIntent: false,
          quantity: null,
        },
        classification: {
          intent: "fallback",
          confidence: 0.2,
          reasons: ["score_too_low"],
          alternatives: [],
        },
        socialSignal: null,
        allowReplyAssist: true,
      },
      baseDeps(
        JSON.stringify({
          mode: "reply_assist",
          confidence: 0.88,
          safeToSend: true,
          replyPurpose: "clarify",
          replyText: "Fechou. Me manda teu bairro ou tua localizacao que eu te digo se consigo te encaixar agora.",
          reason: "complex_fallback",
        }),
      ),
    );

    expect(decision.kind).toBe("reply_assist_decision");
    if (decision.kind === "reply_assist_decision") {
      expect(decision.replyText.toLowerCase()).toContain("bairro");
    }
  });

  it("blocks reply assist in critical state and discards unsafe mode switch", async () => {
    const callModel = vi.fn(async () => ({
      raw: JSON.stringify({
        mode: "reply_assist",
        confidence: 0.93,
        safeToSend: true,
        replyPurpose: "next_step",
        replyText: "Pode confirmar que eu encaminhei teu pedido agora.",
        reason: "bad_critical_context",
      }),
      usageTokens: 80,
    }));

    const decision = await maybeResolveWithGeminiGuide(
      {
        tenantId: "tenant-gem",
        waId: "5581990000001",
        role: "cliente",
        stage: "post_classification",
        message: {
          raw: "e agora",
          normalized: "e agora",
          compact: "e agora",
          tokens: ["e", "agora"],
        },
        currentUser: baseUser({ botState: "awaiting_confirmation" }),
        entities: {
          bairro: null,
          bairroNorm: null,
          cidade: null,
          confirmation: null,
          statusOperacional: null,
          beverage: null,
          orderIntent: false,
          quantity: null,
        },
        classification: {
          intent: "fallback",
          confidence: 0.2,
          reasons: ["score_too_low"],
          alternatives: [],
        },
        socialSignal: null,
        allowReplyAssist: true,
      },
      {
        ...baseDeps("{}"),
        callModel,
      },
    );

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(decision.kind).toBe("none");
  });
});
