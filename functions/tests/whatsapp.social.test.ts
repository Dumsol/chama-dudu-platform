import { describe, expect, it } from "vitest";
import { normalizeMessageText } from "../src/domain/whatsapp/messageNormalizer";
import { detectMetaIntent } from "../src/domain/whatsapp/metaIntentDetector";
import type { UserBotState } from "../src/domain/whatsapp/types";
import {
  composeClienteFallback,
  composeFlowClosing,
  composeFlowDisambiguation,
  composeSocialSmallTalk,
} from "../src/domain/whatsapp/responseComposer";

function meta(text: string, botState: UserBotState = "idle") {
  return detectMetaIntent({
    message: normalizeMessageText(text),
    role: "cliente",
    botState,
    lastIntent: "cliente_buscar_deposito",
    lastIntentConfidence: 0.9,
    lastMessageTextNorm: "tem deposito aberto",
  });
}

describe("social signal coverage", () => {
  it("covers greetings and small talk variants", () => {
    expect(meta("Oi").forcedIntent).toBe("saudacao");
    expect(meta("Oii").forcedIntent).toBe("saudacao");
    expect(meta("Oiii").forcedIntent).toBe("saudacao");
    expect(meta("Eai").forcedIntent).toBe("saudacao");
    expect(meta("Eae meu mano").forcedIntent).toBe("saudacao");
    expect(meta("Fala Dudu").forcedIntent).toBe("saudacao");
    expect(meta("Opa").forcedIntent).toBe("saudacao");
    expect(meta("Dale", "idle").socialSignal).toBe("small_talk");
    expect(meta("Suave?", "idle").socialSignal).toBe("small_talk");
  });

  it("covers closure, cancel and human", () => {
    expect(meta("Valeu").forcedIntent).toBe("encerramento");
    expect(meta("So isso valeu").forcedIntent).toBe("encerramento");
    expect(meta("Mudei de ideia").forcedIntent).toBe("cancelar");
    expect(meta("Esquece isso").forcedIntent).toBe("cancelar");
    expect(meta("Quero outra coisa agora").forcedIntent).toBe("cancelar");
    expect(meta("Quero falar com humano").forcedIntent).toBe("humano");
  });

  it("covers ack short with and without actionable context", () => {
    const noContext = detectMetaIntent({
      message: normalizeMessageText("Dale entao faz"),
      role: "cliente",
      botState: "idle",
    });
    expect(noContext.socialSignal).toBe("ack_short");
    expect(noContext.action).toBe("disambiguate");

    const withContext = detectMetaIntent({
      message: normalizeMessageText("Fechou"),
      role: "cliente",
      botState: "idle",
      lastIntent: "cliente_informar_bairro",
      lastIntentConfidence: 0.9,
      lastMessageTextNorm: "bairro centro",
    });
    expect(withContext.socialSignal).toBe("ack_short");
    expect(withContext.action).toBe("continue");
    expect(withContext.usedContextForAckShort).toBe(true);
  });
});

describe("persona non-dry responses", () => {
  it("returns carismatic fallback and disambiguation", () => {
    const fallback = composeClienteFallback({
      fallbackType: "fallback_operacional",
      waId: "5511999990000",
      normalizedText: "nao entendi",
    });
    const disambiguation = composeFlowDisambiguation({
      waId: "5511999990000",
      normalizedText: "dale entao faz",
    });
    expect(fallback.toLowerCase()).not.toContain("nao entendi bem");
    expect(disambiguation.toLowerCase()).toMatch(/continu|siga|assunto/);
  });

  it("returns social closing and small talk copy", () => {
    const closing = composeFlowClosing({
      waId: "5511999990000",
      normalizedText: "so isso valeu",
    });
    const smallTalk = composeSocialSmallTalk({
      role: "cliente",
      waId: "5511999990000",
      normalizedText: "suave",
    });
    expect(closing.toLowerCase()).toMatch(/chama|chamar/);
    expect(smallTalk.toLowerCase()).toContain("bairro");
  });
});
