// functions/src/billing/interClient.ts
import { Agent } from "undici";
import { requestJson } from "../../infra/http/httpClient";

type InterConfig = {
  base_url: string;
  oauth_path: string;
  pix_base_path: string;
  boleto_base_path: string;
  client_id: string;
  client_secret: string;
  pix_key?: string;
  cert_b64: string;
  key_b64: string;
  ca_b64?: string;
  scope_pix?: string;
  scope_cobranca?: string;
};

// ----------------------
// Secrets (dados sensíveis)
// ----------------------

import {
  readInterClientId,
  readInterClientSecret,
  readInterCertB64,
  readInterKeyB64,
  readInterPixKey,
} from "../../infra/config/secrets";

// ----------------------
// Helpers de env (não sensíveis)
// ----------------------

function envOrThrow(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Variável de ambiente ${name} não definida para config do Banco Inter.`,
    );
  }
  return value.trim();
}

// ----------------------
// Cache de config e agent (lazy)
// ----------------------

let cachedConfig: InterConfig | null = null;
let cachedDispatcher: Agent | null = null;

/**
 * Carrega config do Banco Inter.
 * Campos sensíveis via Secrets; não sensíveis via env.
 */
export function getInterConfig(): InterConfig {
  if (cachedConfig) return cachedConfig;

  const clientId = readInterClientId();
  const clientSecret = readInterClientSecret();
  const certB64 = readInterCertB64();
  const keyB64 = readInterKeyB64();
  const pixKey = readInterPixKey();

  if (!clientId || !clientId.trim()) {
    throw new Error("Secret KOSH_PROD_DUDU_INTER_CLIENT_ID não definido.");
  }
  if (!clientSecret || !clientSecret.trim()) {
    throw new Error("Secret KOSH_PROD_DUDU_INTER_CLIENT_SECRET não definido.");
  }
  if (!certB64 || !certB64.trim()) {
    throw new Error("Secret KOSH_PROD_DUDU_INTER_CERT_B64 não definido.");
  }
  if (!keyB64 || !keyB64.trim()) {
    throw new Error("Secret KOSH_PROD_DUDU_INTER_KEY_B64 não definido.");
  }
  if (!pixKey || !pixKey.trim()) {
    throw new Error("Secret KOSH_PROD_DUDU_INTER_PIX_KEY (chave Pix) não definido.");
  }

  cachedConfig = {
    base_url: envOrThrow("INTER_BASE_URL"),
    oauth_path: envOrThrow("INTER_OAUTH_PATH"),
    pix_base_path: envOrThrow("INTER_PIX_BASE_PATH"),
    boleto_base_path: envOrThrow("INTER_BOLETO_BASE_PATH"),

    client_id: clientId.trim(),
    client_secret: clientSecret.trim(),
    cert_b64: certB64.trim(),
    key_b64: keyB64.trim(),
    pix_key: pixKey.trim(),

    ca_b64: process.env.INTER_CA_B64?.trim(),
    scope_pix: process.env.INTER_SCOPE_PIX?.trim(),
    scope_cobranca: process.env.INTER_SCOPE_COBRANCA?.trim(),
  };

  return cachedConfig;
}

/**
 * Retorna (e cacheia) o https.Agent mTLS baseado na config.
 */
function getDispatcher(): Agent {
  if (cachedDispatcher) return cachedDispatcher;

  const cfg = getInterConfig();

  const cert = Buffer.from(cfg.cert_b64, "base64").toString("utf8");
  const key = Buffer.from(cfg.key_b64, "base64").toString("utf8");
  const ca = cfg.ca_b64
    ? Buffer.from(cfg.ca_b64, "base64").toString("utf8")
    : undefined;

  cachedDispatcher = new Agent({
    connect: {
      cert,
      key,
      ca,
    },
  });

  return cachedDispatcher;
}

// ----------------------
// Cache simples de token por escopo
// ----------------------

type TokenCache = {
  accessToken: string;
  expiresAt: number; // epoch ms
};

const tokenCacheByScope = new Map<string, TokenCache>();

async function getOAuthToken(scope: string): Promise<string> {
  const now = Date.now();
  const cached = tokenCacheByScope.get(scope);

  if (cached && cached.expiresAt > now + 30_000) {
    return cached.accessToken;
  }

  const cfg = getInterConfig();
  const dispatcher = getDispatcher();

  const url = `${cfg.base_url}${cfg.oauth_path}`;

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", cfg.client_id);
  params.append("client_secret", cfg.client_secret);
  if (scope && scope.trim().length > 0) {
    params.append("scope", scope.trim());
  }

  const resp = await requestJson<any>({
    url,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    bodyText: params.toString(),
    timeoutMs: 10000,
    retry: { retries: 2 },
    dispatcher,
  });

  const data = resp.data as any;
  if (!data?.access_token) {
    throw new Error("Resposta OAuth do Inter sem access_token");
  }

  const accessToken = String(data.access_token);
  const expiresIn = Number(data.expires_in || 900); // segundos

  tokenCacheByScope.set(scope, {
    accessToken,
    expiresAt: now + expiresIn * 1000,
  });

  return accessToken;
}

// ----------------------
// Client Axios autenticado
// ----------------------

export async function interRequestJson<T>(params: {
  scope: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  bodyJson?: unknown;
}): Promise<{ data: T; statusCode: number }> {
  const cfg = getInterConfig();
  const dispatcher = getDispatcher();
  const token = await getOAuthToken(params.scope);

  const resp = await requestJson<T>({
    url: params.url.startsWith("http") ? params.url : `${cfg.base_url}${params.url}`,
    method: params.method,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    bodyJson: params.bodyJson,
    timeoutMs: 10000,
    retry: { retries: 2 },
    dispatcher,
  });

  return { data: resp.data as T, statusCode: resp.statusCode };
}
