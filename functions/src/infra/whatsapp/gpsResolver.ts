import * as logger from "firebase-functions/logger";
import * as https from "https";

/**
 * Resultado da resolução GPS via OpenStreetMap Nominatim.
 */
export interface GpsResolveResult {
  bairroNorm: string;
  bairroDisplay: string;
}

/**
 * Campos relevantes da resposta JSON do Nominatim reverse geocoding.
 */
interface NominatimResponse {
  address?: {
    suburb?: string;
    neighbourhood?: string;
    city_district?: string;
    town?: string;
    village?: string;
    county?: string;
  };
  display_name?: string;
  error?: string;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const NOMINATIM_USER_AGENT = "ChamaDudu-Bot/1.0 (contato@chamadudu.com.br)";
const TIMEOUT_MS = 3000;

/**
 * Resolve coordenadas GPS para um bairro normalizado usando OpenStreetMap Nominatim.
 *
 * Política de uso Nominatim:
 * - Máximo 1 request/segundo (bot nunca excede isso — 1 por mensagem de localização)
 * - User-Agent obrigatório
 * - Sem cache necessário — inputs de GPS são únicos por usuário
 *
 * @returns bairroNorm (lowercase, underscores) e bairroDisplay (exibição) ou null se falhar
 */
export async function resolveGPS(
  lat: number,
  lng: number,
): Promise<GpsResolveResult | null> {
  const url = `${NOMINATIM_URL}/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=pt-BR&addressdetails=1`;

  try {
    const raw = await fetchWithTimeout(url, TIMEOUT_MS);
    const data: NominatimResponse = JSON.parse(raw);

    if (data.error) {
      logger.warn("[GPS] Nominatim returned error", { error: data.error, lat, lng });
      return null;
    }

    // Prioridade: suburb > neighbourhood > city_district > town > village
    const bairroRaw =
      data.address?.suburb ??
      data.address?.neighbourhood ??
      data.address?.city_district ??
      data.address?.town ??
      data.address?.village ??
      null;

    if (!bairroRaw) {
      logger.info("[GPS] Nominatim: no bairro found in address", { lat, lng, display_name: data.display_name });
      return null;
    }

    const bairroDisplay = bairroRaw.trim();
    const bairroNorm = normalizeForLookup(bairroDisplay);

    logger.info("[GPS] Resolved", { lat, lng, bairroDisplay, bairroNorm });

    return { bairroNorm, bairroDisplay };
  } catch (err) {
    logger.warn("[GPS] Nominatim fetch failed", { error: String(err), lat, lng });
    return null;
  }
}

/**
 * Normaliza string de bairro para comparação com a lista canônica.
 * Ex: "Pau Amarelo" → "pau_amarelo"
 */
function normalizeForLookup(bairro: string): string {
  return bairro
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Fetch HTTP simples com timeout usando o módulo nativo `https`.
 * Evita dependência de `node-fetch` ou `axios` — Cloud Functions já tem `https`.
 */
function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("GPS_TIMEOUT")), timeoutMs);

    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": NOMINATIM_USER_AGENT,
          "Accept": "application/json",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          clearTimeout(timer);
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        res.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      },
    );

    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
