// functions/src/modules/common/googleLocationService.ts
import * as logger from "firebase-functions/logger";
import { isFeatureEnabled } from "../../infra/config/featureFlags";

/**
 * Interface de localização padronizada.
 */
export interface ResolvedLocation {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  cep?: string | null;
  bairro?: string | null;
  placeId?: string | null;
  source: "NOMINATIM_OSM" | "FAIL";
}

function isExternalCallsDisabled(): boolean {
  return isFeatureEnabled("EXTERNAL_CALLS_DISABLED", false);
}

const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org";
const USER_AGENT = "ChamaDudu-Bot/1.0 (contato@chamadudu.com.br)";

/**
 * Reverse Geocoding usando Nominatim (OSM).
 */
export async function reverseGeocodeLocation(params: {
  latitude: number;
  longitude: number;
}): Promise<ResolvedLocation | null> {
  if (isExternalCallsDisabled()) return null;

  try {
    const url = `${NOMINATIM_ENDPOINT}/reverse?format=jsonv2&lat=${params.latitude}&lon=${params.longitude}&addressdetails=1`;
    
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!res.ok) return null;
    const data = await res.json();
    
    if (!data || !data.address) return null;

    const address = data.address;
    const bairro = address.suburb || address.neighbourhood || address.residential || address.city_district;
    const cep = address.postcode;

    return {
      formattedAddress: data.display_name,
      latitude: params.latitude,
      longitude: params.longitude,
      cep: cep || null,
      bairro: bairro || null,
      placeId: `osm-${data.place_id}`,
      source: "NOMINATIM_OSM",
    };
  } catch (e: any) {
    logger.warn("NOMINATIM_REVERSE_FAILED", { error: e?.message });
    return null;
  }
}

/**
 * Geocoding (Text/Address) usando Nominatim (OSM).
 */
export async function geocodeAddressFromText(text: string): Promise<ResolvedLocation | null> {
  if (isExternalCallsDisabled()) return null;

  try {
    // Focamos em Paulista, PE para precisão
    const query = `${text}, Paulista, PE, Brasil`;
    const url = `${NOMINATIM_ENDPOINT}/search?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&limit=1`;
    
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!res.ok) return null;
    const results = await res.json();
    
    if (!Array.isArray(results) || results.length === 0) return null;

    const data = results[0];
    const address = data.address;
    const bairro = address.suburb || address.neighbourhood || address.residential || address.city_district;
    const cep = address.postcode;

    return {
      formattedAddress: data.display_name,
      latitude: parseFloat(data.lat),
      longitude: parseFloat(data.lon),
      cep: cep || null,
      bairro: bairro || null,
      placeId: `osm-${data.place_id}`,
      source: "NOMINATIM_OSM",
    };
  } catch (e: any) {
    logger.warn("NOMINATIM_GEOCODE_FAILED", { error: e?.message });
    return null;
  }
}
