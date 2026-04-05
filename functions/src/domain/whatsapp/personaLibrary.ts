// TODO: Refactor persona functions to use DuduResponses
// See: domain/whatsapp/persona/duduResponses.ts (canonical response strings)
// This file should eventually delegate to DuduResponses for consistency.

import crypto from "crypto";
import type { FallbackType, UserType } from "./types";

type PersonaBucket =
  | "greeting_cliente_with_bairro"
  | "greeting_cliente_without_bairro"
  | "greeting_deposito"
  | "small_talk_cliente"
  | "small_talk_deposito"
  | "cancel"
  | "closure"
  | "disambiguation"
  | "complaint"
  | "human"
  | "ack"
  | "fallback_social_cliente"
  | "fallback_desambiguacao_cliente"
  | "fallback_operacional_cliente"
  | "fallback_social_deposito"
  | "fallback_desambiguacao_deposito"
  | "fallback_operacional_deposito";

const PERSONA_COPY: Record<PersonaBucket, string[]> = {
  greeting_cliente_with_bairro: [
    "Oxe, chegou! Sou o Dudu 🤙 Já sei teu bairro. Quer que eu puxe os depósitos abertos agora?",
    "Eita, que bom te ver! Tô aqui, Dudu na área. Bora ver quem tá aberto no teu bairro agora?",
  ],
  greeting_cliente_without_bairro: [
    "Eita, chegou! Sou o Dudu, assistente de entregas aqui em Paulista 🤙 Me manda teu bairro que eu acho quem tá aberto agora!",
    "Oxe, apareceu! Tô aqui, sou o Dudu. Me diz o bairro que a gente resolve isso rapidinho, mermão!",
  ],
  greeting_deposito: [
    "Eae, time! Tô on e pronto pra tocar a operação. Bora? Manda abrir, fechar, status, pedidos ou pausar.",
    "Fala, parceiro! Dudu aqui, na área. Manda o comando: abrir, fechar, status, pedidos ou pausar.",
  ],
  small_talk_cliente: [
    "Dale, dale! Me diz teu bairro que eu te mostro quem tá aberto agora mesmo.",
    "Massa! Bora resolver isso logo. Me manda o bairro que eu acelero por aqui.",
  ],
  small_talk_deposito: [
    "Égua, bora tocar! Manda abrir, fechar, status, pedidos ou pausar.",
    "Dale, tamo junto. Qual o comando? Abrir, fechar, status, pedidos ou pausar.",
  ],
  cancel: [
    "Beleza, pausei aqui de boa, sem estresse. Quando quiser voltar, é só chamar o Dudu 🤙",
    "Dale, parei esse fluxo. Tô na área quando precisar, só chamar!",
  ],
  closure: [
    "Fechou demais! Precisar de mais alguma coisa, chama que tô aqui. Até mais! 🤙",
    "Valeu, parceiro! Foi arretado resolver com você. Qualquer coisa, tô na área.",
  ],
  disambiguation: [
    "Rapaz, me ajuda aqui: continuo de onde parei ou você quer mudar de assunto?",
    "Certo. Quer que eu siga no que tava rolando ou virou outra coisa agora?",
  ],
  complaint: [
    "Égua, valeu por avisar! Me conta em uma frase onde travou que a gente resolve juntos.",
    "Oxe, que situação! Me fala rapidinho o que tá pegando que eu ajusto por aqui.",
  ],
  human: [
    "Tô contigo, parceiro! Enquanto isso, já vou abrindo caminho por aqui.",
    "Dale, sem problema. Se quiser, eu adianto o que puder por aqui enquanto isso.",
  ],
  ack: [
    "Fechou! Tô contigo nesse passo 🤙",
    "Arretado, seguimos juntos por aqui!",
  ],
  fallback_social_cliente: [
    "Égua, quase peguei não! Me manda de novo do teu jeito que tô contigo.",
    "Vixe, não captei direito não. Me fala de novo que eu acompanho você.",
  ],
  fallback_desambiguacao_cliente: [
    "Rapaz, ficou meio solto pra mim. Continuo no assunto anterior ou mudou de ideia?",
    "Oxe, faltou um detalhe. Sigo no fluxo anterior ou é outro assunto agora?",
  ],
  fallback_operacional_cliente: [
    "Tô contigo! Me diz teu bairro ou manda teu pedido numa frase que a gente resolve.",
    "Dale, faltou só um detalhe. Me diz o bairro ou escreve o pedido do teu jeito.",
  ],
  fallback_social_deposito: [
    "Égua, não captei direto não. Manda de novo do teu jeito que tô junto.",
    "Vixe, faltou um detalhe. Manda de novo que eu acompanho.",
  ],
  fallback_desambiguacao_deposito: [
    "Quer que eu continue no fluxo atual ou mudou de assunto, parceiro?",
    "Oxe, ficou aberto aqui. Continuo no que tava ou você quer outra coisa?",
  ],
  fallback_operacional_deposito: [
    "Rapaz, faltou só um detalhe. Manda abrir, fechar, status, pedidos ou pausar que eu sigo.",
    "Dale, tô aqui. Me manda abrir, fechar, status, pedidos ou pausar que continuo contigo.",
  ],
};

function pickVariant(bucket: PersonaBucket, seed: string): string {
  const variants = PERSONA_COPY[bucket];
  if (!variants?.length) return "";
  const hash = crypto.createHash("sha1").update(seed).digest("hex");
  const numeric = Number.parseInt(hash.slice(0, 8), 16);
  const index = Number.isFinite(numeric) ? numeric % variants.length : 0;
  return variants[index] ?? variants[0];
}

function fallbackBucket(role: UserType, fallbackType: FallbackType): PersonaBucket {
  if (role === "deposito") {
    if (fallbackType === "fallback_social") return "fallback_social_deposito";
    if (fallbackType === "fallback_desambiguacao") return "fallback_desambiguacao_deposito";
    return "fallback_operacional_deposito";
  }
  if (fallbackType === "fallback_social") return "fallback_social_cliente";
  if (fallbackType === "fallback_desambiguacao") return "fallback_desambiguacao_cliente";
  return "fallback_operacional_cliente";
}

export function personaGreeting(params: {
  role: UserType;
  hasKnownBairro?: boolean;
  waId: string;
  normalizedText: string;
}): string {
  const bucket: PersonaBucket =
    params.role === "deposito"
      ? "greeting_deposito"
      : params.hasKnownBairro
        ? "greeting_cliente_with_bairro"
        : "greeting_cliente_without_bairro";
  return pickVariant(bucket, `${params.waId}:greeting:${params.normalizedText}`);
}

export function personaSmallTalk(params: {
  role: UserType;
  waId: string;
  normalizedText: string;
}): string {
  const bucket: PersonaBucket = params.role === "deposito" ? "small_talk_deposito" : "small_talk_cliente";
  return pickVariant(bucket, `${params.waId}:small_talk:${params.normalizedText}`);
}

export function personaCancel(params: { waId: string; normalizedText: string }): string {
  return pickVariant("cancel", `${params.waId}:cancel:${params.normalizedText}`);
}

export function personaClosure(params: { waId: string; normalizedText: string }): string {
  return pickVariant("closure", `${params.waId}:closure:${params.normalizedText}`);
}

export function personaDisambiguation(params: { waId: string; normalizedText: string }): string {
  return pickVariant("disambiguation", `${params.waId}:disambiguation:${params.normalizedText}`);
}

export function personaComplaint(params: { waId: string; normalizedText: string }): string {
  return pickVariant("complaint", `${params.waId}:complaint:${params.normalizedText}`);
}

export function personaHuman(params: { waId: string; normalizedText: string }): string {
  return pickVariant("human", `${params.waId}:human:${params.normalizedText}`);
}

export function personaAck(params: { waId: string; normalizedText: string }): string {
  return pickVariant("ack", `${params.waId}:ack:${params.normalizedText}`);
}

export function personaFallback(params: {
  role: UserType;
  fallbackType: FallbackType;
  waId: string;
  normalizedText: string;
}): string {
  const bucket = fallbackBucket(params.role, params.fallbackType);
  return pickVariant(bucket, `${params.waId}:${params.fallbackType}:${params.normalizedText}`);
}
