import { VertexAI } from "@google-cloud/vertexai";
import * as logger from "firebase-functions/logger";
import { readVertexAIConfig } from "../config/secrets";

/**
 * Resultado retornado pelo Vertex AI RAG após a geração com grounding.
 */
export interface VertexSearchResult {
  answer: string;
  sourceNodes: Array<{
    title?: string;
    uri?: string;
    snippet?: string;
  }>;
  /** Presente apenas em fallback — bot state no momento da falha, para que o
   *  caller possa manter o estado em vez de avançar erroneamente. */
  _fallbackBotState?: string;
}

export const EMBEDDED_FALLBACK_RULES: Record<string, string> = {
  idle: "Cumprimentar com calor e perguntar o bairro imediatamente.",
  awaiting_neighborhood:
    "Perguntar o bairro. Se GPS, chamar resolveGPS(). Se sem cobertura, sugerir bairros vizinhos.",
  awaiting_product:
    "Bairro confirmado. Perguntar o que quer beber em texto livre. Nunca exibir menu.",
  awaiting_checkout:
    "Apresentar resumo do pedido e pedir confirmação com botões.",
  awaiting_deposit_response:
    "Pedido roteado. Aguardar depósito. SLA 3 min. Se timeout, tentar bairros vizinhos.",
  awaiting_indicacao:
    "Bairro sem cobertura. Perguntar se cliente conhece depósito na região.",
};

export const MINIMAL_FALLBACK =
  'Responder com calor regional nordestino, max 3 linhas. Para erros: "Eita, deu um probleminha aqui. Tenta de novo em 1 minutinho!"';

/** Tag interna para disparar fallback determinista no stateEngine */
export const RAG_NO_RESULT_FOUND = "RAG_NO_RESULT_FOUND";

/**
 * Serviço de Grounded Generation via Vertex AI RAG nativo.
 *
 * Arquitetura: o corpus RAG é passado como uma Tool diretamente na chamada do
 * Gemini. O Google Cloud cuida do retrieval internamente — sem chamada separada
 * ao Discovery Engine.
 *
 * Corpus: projects/{projectId}/locations/{location}/ragCorpora/{ragCorpusId}
 * Referência: https://cloud.google.com/vertex-ai/generative-ai/docs/rag-overview
 */
export const vertexAiService = {
  async searchAndGenerate(params: {
    query: string;
    currentBotState?: string;
    conversationHistory?: string[];
    sessionId?: string;
    systemInstruction?: string;
  }): Promise<VertexSearchResult> {
    const config = readVertexAIConfig();
    const { projectId, location, ragCorpusId, geminiModel, clientEmail, privateKey } = config;
    // gemini-1.5-flash — modelo de baixa latência e alto desempenho "lite"
    const resolvedModel = geminiModel ?? "gemini-1.5-flash";

    // Nome completo do RAG Corpus no formato esperado pela Tool
    const ragCorpusName = `projects/${projectId}/locations/${location}/ragCorpora/${ragCorpusId}`;

    try {
      // O VertexAI client usa a localização do corpus (us-south1).
      // O modelo Gemini disponível nessa região é acessado automaticamente.
      const vertexAIOptions: ConstructorParameters<typeof VertexAI>[0] = {
        project: projectId,
        location,
      };

      // Usa credenciais explícitas apenas se fornecidas no config (opcional).
      // Em Cloud Functions / Cloud Run, ADC (Application Default Credentials) é preferível.
      if (clientEmail && privateKey) {
        vertexAIOptions.googleAuthOptions = {
          credentials: {
            client_email: clientEmail,
            private_key: privateKey,
          },
        };
      }

      const vertexAI = new VertexAI(vertexAIOptions);

      const model = vertexAI.getGenerativeModel({
        model: resolvedModel,
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.3,
        },
        systemInstruction: params.systemInstruction
          ? {
            role: "system",
            parts: [{ text: params.systemInstruction }],
          }
          : undefined,
      });

      // Tool de RAG: passa o corpus diretamente para o Gemini.
      // O Google faz o retrieval semantico internamente.
      const ragTool = {
        retrieval: {
          vertexRagStore: {
            ragCorpora: [ragCorpusName],
          },
        },
      };

      // Monta o histórico de conversa para contexto (últimas 10 trocas)
      const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

      if (params.conversationHistory?.length) {
        for (const line of params.conversationHistory.slice(-10)) {
          const colonIdx = line.indexOf(": ");
          if (colonIdx === -1) continue;
          const role = line.slice(0, colonIdx) as "user" | "model";
          const content = line.slice(colonIdx + 2);
          if (role === "user" || role === "model") {
            contents.push({ role, parts: [{ text: content }] });
          }
        }
      }

      // Mensagem atual do usuário
      contents.push({ role: "user", parts: [{ text: params.query }] });

      // Timeout de 45s — Gemini 2.5 Pro é potente e o RAG pode levar tempo
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("RAG_TIMEOUT")), 60000),
      );

      const result = await Promise.race([
        (model.generateContent as (
          req: unknown,
        ) => ReturnType<typeof model.generateContent>)({
          contents,
          // O SDK @google-cloud/vertexai nem sempre expõe vertexRagStore nos tipos
          // públicos, mas a API REST aceita a estrutura. Cast via unknown é seguro aqui.
          tools: [ragTool],
          generationConfig: {
            maxOutputTokens: 2048,
          },
        }),
        timeoutPromise,
      ]);

      const response = result.response;
      const answerText =
        response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

      // Extrai metadados de grounding (fontes utilizadas pelo RAG)
      const groundingMetadata = response.candidates?.[0]?.groundingMetadata as
        | {
          groundingChunks?: Array<{
            retrievedContext?: {
              uri?: string;
              title?: string;
              text?: string;
            };
          }>;
        }
        | undefined;

      const sourceNodes =
        groundingMetadata?.groundingChunks?.map((chunk) => ({
          title: chunk.retrievedContext?.title ?? "Corpus Chama Dudu",
          uri: chunk.retrievedContext?.uri ?? "#",
          snippet: chunk.retrievedContext?.text?.slice(0, 200),
        })) ?? [];

      return {
        answer: answerText || RAG_NO_RESULT_FOUND,
        sourceNodes,
      };
    } catch (error) {
      logger.error("[VertexAI] RAG grounded generation error", {
        error: String(error),
        sessionId: params.sessionId,
        botState: params.currentBotState,
        projectId,
        location,
        ragCorpusName,
        model: resolvedModel,
      });

      // Fallback user-facing — EMBEDDED_FALLBACK_RULES é contexto interno, nunca
      // deve ser enviado ao usuário diretamente. Retorna mensagem neutra.
      const isTimeout = String(error).includes("RAG_TIMEOUT");
      logger.warn("[VertexAI] Using fallback", {
        reason: isTimeout ? "timeout" : "error",
        botState: params.currentBotState,
      });
      return {
        answer: "Eita, deu um probleminha aqui. Tenta de novo em 1 minutinho! 🙏",
        sourceNodes: [],
        _fallbackBotState: params.currentBotState ?? "idle",
      };
    }
  },
};

/**
 * Wrapper de alta conveniência para consulta RAG.
 * Trata erros internamente retornando fallbacks semânticos.
 */
export async function queryRAG(
  userInput: string,
  currentBotState: string,
  opts?: {
    conversationHistory?: string[];
    systemInstruction?: string;
    sessionId?: string;
  },
): Promise<VertexSearchResult> {
  return vertexAiService.searchAndGenerate({
    query: userInput,
    currentBotState,
    conversationHistory: opts?.conversationHistory,
    systemInstruction: opts?.systemInstruction,
    sessionId: opts?.sessionId,
  });
}
