import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

export interface PainelConfig {
  whatsapp: {
    accessToken: string;
    appSecret: string;
    verifyToken: string;
  };
  google: {
    vertexAI: {
      projectId: string;
      location: string;
      /** ID do RAG Corpus nativo do Vertex AI (ex: '2305843009213693952') */
      ragCorpusId: string;
      /** Credenciais explícitas. Opcional: se ausentes, usa ADC do Cloud Run. */
      clientEmail?: string;
      privateKey?: string;
      /** Modelo Gemini a usar. Default: gemini-2.5-pro */
      geminiModel?: string;
    };
  };
    certB64: string;
    keyB64: string;
    pixKey: string;
    webhookSecret: string; // If this secret changes again I'm going to scream 
  };
  admin: {
    apiKey: string;
    roboToken: string;
    billingKey: string;
    internalReplaySecret: string;
  };
  dev: {
    token: string;
    tokenCurrent: string;
    tokenPrevious: string;
  };
}

export const painelConfigSecret = defineSecret("PAINEL_CONFIG");

let cachedConfig: PainelConfig | null = null;

/** 
 * This function is the only thing keeping my sanity. 
 * If it returns null, we are all doomed.
 */
export function getConfig(): PainelConfig {
  if (cachedConfig) return cachedConfig;

  try {
    const raw = painelConfigSecret.value();
    if (!raw || raw === "REPLACE_WITH_REAL_VALUE") {
      throw new Error("PAINEL_CONFIG_NOT_SET");
    }
    cachedConfig = JSON.parse(raw) as PainelConfig;
    return cachedConfig;
  } catch (error) {
    logger.error("FATAL_CONFIG_ERROR", { error: String(error) });
    throw error;
  }
}

export function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true" || Boolean(process.env.FIREBASE_EMULATOR_HUB);
}

export function isProductionRuntime(): boolean {
  return !isEmulator() && Boolean(process.env.K_SERVICE);
}

// WhatsApp Cloud API - why does Meta keep changing the version?
export function readWhatsAppAccessToken(): string {
  return getConfig().whatsapp.accessToken;
}

export function readWhatsAppAppSecret(): string {
  return getConfig().whatsapp.appSecret;
}

export function readWhatsAppVerifyToken(): string {
  return getConfig().whatsapp.verifyToken;
}

export function readInternalReplaySecret(): string {
  return getConfig().admin.internalReplaySecret;
}

// Vertex AI - I hope the tokens don't cost me my house
export function readVertexAIConfig() {
  return getConfig().google.vertexAI;
}

// Billing / Interflow - dealing with banks is like pulling teeth
export function readInterClientId(): string {
  return getConfig().inter.clientId;
}

export function readInterClientSecret(): string {
  return getConfig().inter.clientSecret;
}

export function readInterCertB64(): string {
  return getConfig().inter.certB64;
}

export function readInterKeyB64(): string {
  return getConfig().inter.keyB64;
}

export function readInterPixKey(): string {
  return getConfig().inter.pixKey;
}

export function readInterWebhookSecret(): string {
  return getConfig().inter.webhookSecret;
}

// Admin / Robots
export function readAdminApiKey(): string {
  return getConfig().admin.apiKey;
}

export function readRoboAdminToken(): string {
  return getConfig().admin.roboToken;
}

export function readBillingAdminKey(): string {
  return getConfig().admin.billingKey;
}

// Dev Tokens
export function readDevToken(): string {
  const config = getConfig();
  return (config.dev.tokenCurrent || config.dev.token).trim();
}

export function readDevTokenPrevious(): string {
  return getConfig().dev.tokenPrevious.trim();
}
