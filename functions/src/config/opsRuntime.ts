import { readInternalReplaySecret, painelConfigSecret } from "../infra/config/secrets";

export const DEFAULT_REGION = process.env.DEFAULT_REGION ?? "southamerica-east1";
export const TENANT_CACHE_TTL_MS = Number(process.env.TENANT_CACHE_TTL_MS ?? "300000");
export const WEBHOOK_RATE_LIMIT_WINDOW_MS = Number(
  process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS ?? "10000",
);
export const WEBHOOK_RATE_LIMIT_MAX = Number(process.env.WEBHOOK_RATE_LIMIT_MAX ?? "25");
export const PRECADASTRO_RATE_LIMIT_WINDOW_MS = Number(
  process.env.PRECADASTRO_RATE_LIMIT_WINDOW_MS ?? "60000",
);
export const PRECADASTRO_RATE_LIMIT_MAX = Number(
  process.env.PRECADASTRO_RATE_LIMIT_MAX ?? "10",
);
export const MESSAGE_SNIPPET_MAX = Number(process.env.MESSAGE_SNIPPET_MAX ?? "180");

export function isEmulatorRuntime(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true" || Boolean(process.env.FIREBASE_EMULATOR_HUB);
}

export function isProductionRuntime(): boolean {
  return !isEmulatorRuntime() && Boolean(process.env.K_SERVICE);
}

export function isLocalLikeRuntime(): boolean {
  return isEmulatorRuntime() || !process.env.K_SERVICE;
}

export function getAllowedOrigins(): string[] {
  const configured = String(process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (configured.length) return configured;

  const isProd = isProductionRuntime();
  
  if (isProd) {
    return [
      "https://chamadudu.com.br",
      "https://www.chamadudu.com.br",
      "https://app.chamadudu.com.br",
    ];
  }

  // Apenas em ambiente local/dev permitimos localhost
  return [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
}

export function getReplaySecretFromRuntime(): string {
  return readInternalReplaySecret();
}

export const opsSecrets = {
  internalReplaySecret: painelConfigSecret,
};
