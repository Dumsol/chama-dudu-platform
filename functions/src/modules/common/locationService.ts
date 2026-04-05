// functions/src/modules/common/locationService.ts

import axios from "axios";
import * as logger from "firebase-functions/logger";

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "ChamaDudu-Bot/1.0 (claudio@kosh.com.br)"; // Required by Nominatim Policy

/**
 * Utility for Geocoding and Reverse Geocoding using OpenStreetMap (Nominatim).
 * Implements a simple 1-second delay for compliance with free tier policy.
 */
export class LocationService {
  private lastRequestAt = 0;

  private async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < 1000) {
      const wait = 1000 - elapsed;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAt = Date.now();
  }

  /**
   * Lat/Lng to Address (focus on Neighborhood/Bairro).
   */
  async reverseGeocode(lat: number, lng: number): Promise<{ bairro: string | null; address: string | null }> {
    await this.throttle();
    try {
      const response = await axios.get(`${NOMINATIM_BASE_URL}/reverse`, {
        params: {
          lat,
          lon: lng,
          format: "json",
          addressdetails: 1,
        },
        headers: { "User-Agent": USER_AGENT },
      });

      const data = response.data;
      const addr = data?.address;
      
      // Nominatim uses 'suburb', 'neighbourhood', or 'quarter' for Bairro in Brazil
      const bairro = addr?.suburb || addr?.neighbourhood || addr?.quarter || addr?.city_district || null;
      
      return {
        bairro,
        address: data?.display_name || null,
      };
    } catch (error) {
      logger.error("OSM_REVERSE_GEOCODE_FAIL", { lat, lng, error: String(error) });
      return { bairro: null, address: null };
    }
  }

  /**
   * Address to Lat/Lng.
   */
  async geocode(text: string): Promise<{ lat: number | null; lng: number | null }> {
    await this.throttle();
    try {
      const response = await axios.get(`${NOMINATIM_BASE_URL}/search`, {
        params: {
          q: text,
          format: "json",
          limit: 1,
        },
        headers: { "User-Agent": USER_AGENT },
      });

      const data = response.data?.[0];
      if (!data) return { lat: null, lng: null };

      return {
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lon),
      };
    } catch (error) {
      logger.error("OSM_GEOCODE_FAIL", { text, error: String(error) });
      return { lat: null, lng: null };
    }
  }
}

export const locationService = new LocationService();
