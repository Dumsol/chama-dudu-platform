import { describe, expect, it } from "vitest";
import { normalizeMessageText } from "../src/domain/whatsapp/messageNormalizer";
import { extractEntities } from "../src/domain/whatsapp/entityExtractor";
import { decideNextState } from "../src/domain/whatsapp/clientStateCoordinator";
import { UserRecord, MessageInterpretation } from "../src/domain/whatsapp/types";
import { classifyIntent } from "../src/domain/whatsapp/intentClassifier";

function mockInterpretation(text: string, user: UserRecord): MessageInterpretation {
  const normalized = normalizeMessageText(text);
  const entities = extractEntities({
    message: normalized,
    botState: user.botState,
    pendingSlot: user.pendingSlot,
  });
  const classification = classifyIntent({
    message: normalized,
    entities,
    role: "cliente",
  });

  return {
    normalized,
    classification,
    entities,
    metaIntent: { action: "continue", confidence: 1, reason: "test" },
    geminiDecision: { kind: "none", reason: "test" },
    effectiveIntent: classification.intent,
    effectiveEntities: entities,
    effectiveClassification: classification,
    pendingSlotResult: null,
  };
}

describe("Chatbot Drink Delivery Flow (3-Step)", () => {
  const emptyUser: UserRecord = {
    userId: "user1",
    tenantId: "t1",
    waId: "123",
    type: "cliente",
    botState: "idle",
  };

  it("Step 1: asks for bairro if missing (user says 'quero bebida')", () => {
    const text = "quero bebida";
    const interpretation = mockInterpretation(text, emptyUser);
    const decision = decideNextState({ interpretation, currentUser: emptyUser });
    
    expect(decision.nextState).toBe("awaiting_neighborhood");
    expect(decision.nextStep).toBe("ask_bairro");
  });

  it("Step 2: asks for bebida if bairro exists but bebida missing", () => {
    const userWithBairro: UserRecord = { ...emptyUser, bairroNorm: "pau amarelo", bairro: "Pau Amarelo" };
    const text = "oi";
    const interpretation = mockInterpretation(text, userWithBairro);
    const decision = decideNextState({ interpretation, currentUser: userWithBairro });
    
    expect(decision.nextState).toBe("awaiting_product");
    expect(decision.replyBody).toBe("O que você quer beber?");
  });

  it("Step 2 (extraction): captures bebida and proceeds to Step 3 if bairro already known", () => {
    const userWithBairro: UserRecord = { ...emptyUser, bairroNorm: "pau amarelo", bairro: "Pau Amarelo" };
    const text = "quero cerveja";
    const interpretation = mockInterpretation(text, userWithBairro);
    const decision = decideNextState({ interpretation, currentUser: userWithBairro });
    
    expect(decision.nextStep).toBe("availability_check");
    // @ts-ignore
    const body = decision.replyBody?.body || decision.replyBody;
    expect(body).toBe("Temos sim no *Pau Amarelo*. Quer confirmar o pedido?");
  });

  it("Step 3: simulate availability check if both exist in state", () => {
    const userWithBoth: UserRecord = { 
        ...emptyUser, 
        bairroNorm: "pau amarelo", 
        bairro: "Pau Amarelo",
        slots: { product: "cerveja" }
    };
    const text = "oi";
    const interpretation = mockInterpretation(text, userWithBoth);
    const decision = decideNextState({ interpretation, currentUser: userWithBoth });
    
    expect(decision.nextStep).toBe("availability_check");
    // @ts-ignore
    const body = decision.replyBody?.body || decision.replyBody;
    expect(body).toBe("Temos sim no *Pau Amarelo*. Quer confirmar o pedido?");
  });

  it("Step 3: shows not available if bairro is unknown", () => {
    const userWithUnknownBairro: UserRecord = { 
        ...emptyUser, 
        bairroNorm: "outro", 
        bairro: "Outro",
        slots: { product: "cerveja" }
    };
    const text = "oi";
    const interpretation = mockInterpretation(text, userWithUnknownBairro);
    const decision = decideNextState({ interpretation, currentUser: userWithUnknownBairro });
    
    expect(decision.nextStep).toBe("availability_check");
    // @ts-ignore
    const body = decision.replyBody?.body || decision.replyBody;
    expect(body).toBe("Não tem entrega no *Outro* agora 😕 Quer tentar outro bairro ou ver depois?");
  });

  it("Extracts both in one message and proceeds to Step 3", () => {
    const text = "quero cerveja no pau amarelo";
    const interpretation = mockInterpretation(text, emptyUser);
    const decision = decideNextState({ interpretation, currentUser: emptyUser });
    
    expect(decision.nextStep).toBe("availability_check");
    // @ts-ignore
    const body = decision.replyBody?.body || decision.replyBody;
    expect(body).toBe("Temos sim no *pau amarelo*. Quer confirmar o pedido?");
  });

  it("Handles unclear message with default fallback", () => {
    const text = "asdfghjk";
    const interpretation = mockInterpretation(text, emptyUser);
    const decision = decideNextState({ interpretation, currentUser: emptyUser });
    
    expect(decision.nextStep).toBe("unclear_message_fallback");
    expect(decision.replyBody).toBe("Não entendi 😅 pode me falar seu bairro e o que quer beber?");
  });
});
