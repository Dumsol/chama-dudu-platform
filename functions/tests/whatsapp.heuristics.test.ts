import { describe, expect, it } from "vitest";
import { normalizeMessageText } from "../src/domain/whatsapp/messageNormalizer";
import { extractEntities } from "../src/domain/whatsapp/entityExtractor";
import { classifyIntent } from "../src/domain/whatsapp/intentClassifier";
import { resolveConversationState } from "../src/domain/whatsapp/conversationStateResolver";
import { detectMetaIntent } from "../src/domain/whatsapp/metaIntentDetector";

function classify(
  text: string,
  role: "cliente" | "deposito",
  botState?:
    | "idle"
    | "awaiting_confirmation"
    | "awaiting_disambiguation"
    | "awaiting_neighborhood",
) {
  const normalized = normalizeMessageText(text);
  let pendingSlot: string | null = null;
  if (botState === "awaiting_neighborhood") {
    pendingSlot = "awaiting_neighborhood";
    botState = "idle";
  }
  const entities = extractEntities({
    message: normalized,
    botState,
    pendingSlot,
  });
  const classification = classifyIntent({
    message: normalized,
    entities,
    role,
  });
  return {
    normalized,
    entities,
    classification,
    pendingSlot,
  };
}

describe("message normalization", () => {
  it("normalizes accents, spaces and slang", () => {
    const normalized = normalizeMessageText("  TÔ   ABÉRTO!!!  ");
    expect(normalized.compact).toBe("estou aberto");
  });

  it("normalizes social elongated forms", () => {
    expect(normalizeMessageText("Oiii").compact).toBe("oi");
    expect(normalizeMessageText("opaa").compact).toBe("opa");
    expect(normalizeMessageText("eaee").compact).toBe("eae");
    expect(normalizeMessageText("dalee").compact).toBe("dale");
    expect(normalizeMessageText("blz??!!").compact).toBe("beleza");
  });
});

describe("intent classification for deposito", () => {
  it("classifies open variants", () => {
    const samples = ["abrir", "abre", "to aberto", "pode abrir"];
    for (const sample of samples) {
      const result = classify(sample, "deposito");
      expect(result.classification.intent).toBe("deposito_abrir");
      expect(result.classification.confidence).toBeGreaterThan(0.6);
    }
  });

  it("classifies close and status variants", () => {
    const close = classify("fechar", "deposito");
    const closeAlt = classify("fecha aqui", "deposito");
    const status = classify("como ta meu status", "deposito");
    expect(close.classification.intent).toBe("deposito_fechar");
    expect(closeAlt.classification.intent).toBe("deposito_fechar");
    expect(classify("status", "deposito").classification.intent).toBe("deposito_status");
    expect(status.classification.intent).toBe("deposito_status");
  });
});

describe("intent classification for cliente", () => {
  it("extracts bairro from natural sentence", () => {
    const sample = classify("tem deposito aberto no centro?", "cliente");
    expect(sample.entities.bairroNorm).toBe("centro");
    expect(sample.classification.intent).toBe("cliente_buscar_deposito");
  });

  it("extracts bairro from explicit phrase", () => {
    const sample = classify("bairro centro", "cliente");
    expect(sample.entities.bairroNorm).toBe("centro");
    expect(sample.classification.intent).toBe("cliente_informar_bairro");
  });

  it("classifies shift-of-topic questions", () => {
    expect(classify("quanto custa a entrega?", "cliente").classification.intent).toBe(
      "cliente_consultar_entrega",
    );
    expect(classify("qual o horario?", "cliente").classification.intent).toBe(
      "cliente_consultar_horario",
    );
  });
});

describe("conversation resolution", () => {
  it("uses context to treat isolated confirmation", () => {
    const sample = classify("sim", "cliente", "awaiting_neighborhood");
    const resolution = resolveConversationState({
      role: "cliente",
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      hasKnownBairro: false,
      classification: sample.classification,
      entities: sample.entities,
    });
    expect(resolution.effectiveIntent).toBe("fallback");
    expect(resolution.shouldExecute).toBe(false);
  });

  it("treats unknown or typo text as fallback", () => {
    const sample = classify("abriii", "cliente");
    const resolution = resolveConversationState({
      role: "cliente",
      botState: "idle",
      hasKnownBairro: false,
      classification: sample.classification,
      entities: sample.entities,
    });
    expect(resolution.effectiveIntent).toBe("fallback");
  });

  it("captures bairro while awaiting context", () => {
    const sample = classify("centro", "cliente", "awaiting_neighborhood");
    const resolution = resolveConversationState({
      role: "cliente",
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      hasKnownBairro: false,
      classification: sample.classification,
      entities: sample.entities,
    });
    expect(resolution.effectiveIntent).toBe("cliente_informar_bairro");
    expect(resolution.shouldExecute).toBe(true);
  });
});

describe("meta intent detection", () => {
  it("detects explicit exit during active flow", () => {
    const message = normalizeMessageText("deixa isso");
    const decision = detectMetaIntent({
      message,
      role: "cliente",
      botState: "idle",
    });
    expect(decision.action).toBe("cancel");
    expect(decision.forcedIntent).toBe("cancelar");
  });

  it("detects social closure", () => {
    const message = normalizeMessageText("so isso valeu");
    const decision = detectMetaIntent({
      message,
      role: "cliente",
      botState: "idle",
    });
    expect(decision.socialSignal).toBe("closure");
    expect(decision.forcedIntent).toBe("encerramento");
  });

  it("detects ack short without context as disambiguation", () => {
    const message = normalizeMessageText("dale entao faz");
    const decision = detectMetaIntent({
      message,
      role: "cliente",
      botState: "idle",
    });
    expect(decision.socialSignal).toBe("ack_short");
    expect(decision.action).toBe("disambiguate");
    expect(decision.fallbackType).toBe("fallback_desambiguacao");
  });

  it("detects ack short with active context as continue", () => {
    const message = normalizeMessageText("fechou");
    const decision = detectMetaIntent({
      message,
      role: "cliente",
      botState: "idle",
      lastIntent: "cliente_informar_bairro",
      lastIntentConfidence: 0.9,
      lastMessageTextNorm: "bairro centro",
    });
    expect(decision.socialSignal).toBe("ack_short");
    expect(decision.action).toBe("continue");
    expect(decision.usedContextForAckShort).toBe(true);
  });

  it("detects help and human requests during active flow", () => {
    const helpDecision = detectMetaIntent({
      message: normalizeMessageText("me ajuda"),
      role: "cliente",
      botState: "awaiting_confirmation",
    });
    const humanDecision = detectMetaIntent({
      message: normalizeMessageText("quero falar com atendente"),
      role: "cliente",
      botState: "awaiting_confirmation",
    });

    expect(helpDecision.action).toBe("interrupt");
    expect(helpDecision.forcedIntent).toBe("ajuda");
    expect(humanDecision.action).toBe("interrupt");
    expect(humanDecision.forcedIntent).toBe("humano");
  });
});
