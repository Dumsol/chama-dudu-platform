// functions/src/domain/whatsapp/koshAgent.ts

import * as logger from "firebase-functions/logger";
import { callGemini } from "../../infra/ai/gemini";
import { CLIENT_FAQ } from "./clientFaq";
import { MERCHANT_FAQ } from "./merchantFaq";
import { UserRecord } from "./types";

export type KoshAgentResult = {
  answer: string;
  suggestedAction?: "VOLTAR" | "ABRIR_TICKET";
  hasPanic: boolean;
};

/**
 * Kosh Agent Support Heuristic.
 * Provides transparent, empathetic, and context-aware help.
 */
export async function runKoshAgent(params: {
  text: string;
  role: "client" | "deposit";
  user: UserRecord;
}): Promise<KoshAgentResult> {
  const faq = params.role === "client" ? CLIENT_FAQ : MERCHANT_FAQ;
  const faqText = faq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");

  const systemInstruction = 
    `Você é o Dudu, um assistente prestativo da plataforma Chama Dudu (Paulista/PE).\n` +
    `Sua missão é ajudar o usuário que está confuso ou pediu ajuda. Seja empático e transparente.\n` +
    `Use o FAQ abaixo como base, mas adapte a resposta ao contexto do usuário (Bebidas, Cervejas, Conveniência).\n` +
    `Sempre informe 'Onde o usuário está' se o contexto permitir (ex: 'Vejo que você está escolhendo o bairro...').\n` +
    `Se a dúvida for muito complexa, mostre que entende e sugira abrir um ticket.\n\n` +
    `FAQ REGULAMENTADO:\n${faqText}\n\n` +
    `REGRAS DE OURO:\n` +
    `1. Resposta curta (máx 3-4 linhas).\n` +
    `2. Tom amigável.\n` +
    `3. Se for pânico (irritação, xingamentos), priorize o 'Safety Net'.\n` +
    `Responda em formato JSON: { "answer": "...", "priority": "normal|high", "isPanic": boolean }`;

  const userMsg = `Mensagem: "${params.text}"\nEstado atual: ${params.user.botState}`;

  try {
    const raw = await callGemini(userMsg, systemInstruction);
    const parsed = parseKoshResponse(raw);

    const answer = parsed?.answer || "Puxa, entendi que você está com uma dúvida. Posso tentar te ajudar a voltar ao fluxo ou abrir um ticket para nossa equipe!";
    
    return {
      answer,
      hasPanic: parsed?.isPanic || false,
      suggestedAction: parsed?.isPanic ? "ABRIR_TICKET" : undefined,
    };
  } catch (err) {
    logger.error("KOSH_AGENT_FAIL", { error: String(err) });
    return {
      answer: "Desculpe, tive um tropeço técnico. Como posso te ajudar? Quer voltar de onde paramos ou abrir um ticket?",
      hasPanic: false,
    };
  }
}

function parseKoshResponse(raw: string) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const json = match ? match[0] : raw;
    return JSON.parse(json);
  } catch {
    return null;
  }
}
