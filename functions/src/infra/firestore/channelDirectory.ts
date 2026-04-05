import { channelDirectoryCol } from "./duduPaths";

type ChannelDirectoryEntry = {
  externalId: string;
  tenantId: string;
  productId: string;
  channelType: string;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const directoryCache = new Map<string, { tenantId: string; expiresAt: number }>();

function buildDirectoryDocRef(phoneNumberId: string) {
  return channelDirectoryCol().doc(phoneNumberId);
}

export async function resolveTenantForWhatsAppPhoneNumberId(phoneNumberId: string): Promise<{ tenantId: string }> {
  const cleaned = String(phoneNumberId ?? "").trim();
  if (!cleaned) {
    throw new Error("channelDirectory: phoneNumberId is required");
  }

  const now = Date.now();
  const cached = directoryCache.get(cleaned);
  if (cached && cached.expiresAt > now) {
    return { tenantId: cached.tenantId };
  }

  const snap = await buildDirectoryDocRef(cleaned).get();
  const data = snap.exists ? (snap.data() as ChannelDirectoryEntry) : null;

  if (!data) {
    throw new Error(`channelDirectory: entry not found for ${cleaned}`);
  }

  if (data.productId !== "dudu" || data.channelType !== "whatsapp") {
    throw new Error(`channelDirectory: invalid product/channel for ${cleaned}`);
  }

  const tenantId = String(data.tenantId ?? "").trim();
  if (!tenantId) {
    throw new Error(`channelDirectory: missing tenantId for ${cleaned}`);
  }

  const entry = { tenantId };
  directoryCache.set(cleaned, { tenantId, expiresAt: now + CACHE_TTL_MS });
  return entry;
}
