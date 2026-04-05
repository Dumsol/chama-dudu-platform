import * as logger from "firebase-functions/logger";
import { VertexAI } from "@google-cloud/vertexai";
import { readVertexAIConfig } from "../config/secrets";

/**
 * Utilitário para chamadas ao Google Vertex AI Gemini.
 */
export async function callGemini(
  prompt: string,
  systemInstruction?: string,
  modelName?: string
): Promise<string> {
  const vertexConfig = readVertexAIConfig();
  const { projectId, geminiModel, clientEmail, privateKey } = vertexConfig;
  const resolvedModel = modelName ?? geminiModel ?? "gemini-2.5-pro";
  // Vertex AI Gemini para geração direta (sem RAG) usa us-central1.
  // Isso é separado da location do RAG Corpus (us-south1).
  const GEMINI_LOCATION = "us-central1";

  try {
    const vertexAIOptions: ConstructorParameters<typeof VertexAI>[0] = {
      project: projectId,
      location: GEMINI_LOCATION,
    };

    // Credenciais explícitas são opcionais: em Cloud Run/Functions, ADC é preferível.
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
        temperature: 0.4,
      },
      systemInstruction: systemInstruction ? {
        role: "system",
        parts: [{ text: systemInstruction }],
      } : undefined,
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const response = await result.response;
    const content = response.candidates?.[0]?.content?.parts?.[0]?.text || "";
    
    return content.trim();
  } catch (error) {
    logger.error("VERTEX_AI_CRITICAL_ERROR", { 
      error: String(error),
      projectId,
      model: resolvedModel 
    });
    return "";
  }
}


/**
 * Encapsula a lógica de reescrita de promoções.
 */
export async function rewritePromoText(baseText: string): Promise<string> {
  const systemInstruction = "Reescreva em PT-BR curto e objetivo, 3-4 linhas, tom comercial simples, sem falar de IA.";
  return callGemini(baseText, systemInstruction);
}
