import * as logger from "firebase-functions/logger";
import { getStorage } from "firebase-admin/storage";
import { STICKERS } from "../config/stickers";

const DEFAULT_TTL_MS = Number(process.env.STICKER_CATALOG_TTL_MS ?? "3600000"); // 1 hour for Spark Optimization
const DEFAULT_STORAGE_PREFIX = process.env.STICKER_STORAGE_PREFIX ?? "ChamaDudu/Stickers/";

export function toCanonicalStickerName(raw: string): string {
  return String(raw ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^dudu_|^dudu|^Dudu_|^Dudu/, "") // Hardening: Remove persona prefix
    .replace(/^_+|_+$/g, "");
}

function pathFromStorageLikeUrl(url: string): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.hostname.includes("firebasestorage.googleapis.com")) {
      const objectPath = parsed.pathname.split("/o/")[1];
      if (!objectPath) return null;
      return decodeURIComponent(objectPath);
    }
    if (parsed.hostname.includes("storage.googleapis.com")) {
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length < 2) return null;
      return decodeURIComponent(segments.slice(1).join("/"));
    }
  } catch {
    return null;
  }

  return null;
}

function fileNameFromPath(path: string): string {
  const parts = String(path ?? "").split("/");
  return parts[parts.length - 1] ?? "";
}

const STATIC_FALLBACKS: Record<string, string> = {
  deboa: "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2FStickers%2Fdudu_deboa.webp?alt=media&token=b959d7be-884f-40c0-8aa6-edfb4abbdcb4",
  esperando: "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2FStickers%2Fdudu_esperando.webp?alt=media&token=1525dc3c-4c83-400b-9774-11084415e9a8",
  fazendo_pedido: "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2FStickers%2Fdudu_fazendo_pedido.webp?alt=media&token=7cb8ff75-ec5b-4af9-9a6f-7909348b692e",
  hello: "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2FStickers%2Fdudu_hello.webp?alt=media&token=932438a5-d7d7-4033-b42a-17486ac1bd18",
  problema_tecnico: "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2FStickers%2Fdudu_problema_tecnico.webp?alt=media&token=5792cd14-2066-4a7b-a181-6d2db76a2a54",
  recusado: "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2FStickers%2Fdudu_recusado.webp?alt=media&token=7fce3bda-86d2-4a1b-ab83-f92791097345",
  salva_dudu: "https://firebasestorage.googleapis.com/v0/b/your-project-id.firebasestorage.app/o/ChamaDudu%2FStickers%2Fsalva_dudu.webp?alt=media&token=5b70c0fa-8145-4b88-b420-26a44d36c1d1",
};

const STATIC_ALIASES: Record<string, string> = {
  problema_geral: "problemaGeral",
  pedido_confirmado: "pedidoConfirmado",
  pedido_saiu: "pedidoSaiu",
  pedido_entregue: "pedidoEntregue",
  pedido_novo: "pedidoNovo",
  pedido_recusado: "pedidoRecusado",
};

export function buildStaticStickerCatalog(): Map<string, string> {
  const entries = Object.entries(STICKERS) as Array<[string, string]>;
  const map = new Map<string, string>();
  for (const [key, url] of entries) {
    const link = String(url ?? "").trim();
    if (!link) continue;

    const normalizedKey = toCanonicalStickerName(key);
    if (normalizedKey) map.set(normalizedKey, link);

    const path = pathFromStorageLikeUrl(link);
    const byFile = path ? toCanonicalStickerName(fileNameFromPath(path)) : "";
    if (byFile) map.set(byFile, link);
  }

  for (const [alias, targetKey] of Object.entries(STATIC_ALIASES)) {
    const target = map.get(toCanonicalStickerName(targetKey));
    if (target) map.set(alias, target);
  }

  return map;
}

type StickerCatalogSnapshot = {
  syncedAtMs: number;
  items: Map<string, string>;
};

export type StickerDynamicLoader = () => Promise<Map<string, string>>;

export class StickerCatalogService {
  private readonly staticCatalog: Map<string, string>;
  private readonly ttlMs: number;
  private readonly loader: StickerDynamicLoader;
  private cache: StickerCatalogSnapshot | null = null;

  constructor(params?: {
    ttlMs?: number;
    staticCatalog?: Map<string, string>;
    loader?: StickerDynamicLoader;
  }) {
    this.ttlMs = params?.ttlMs ?? DEFAULT_TTL_MS;
    this.staticCatalog = params?.staticCatalog ?? buildStaticStickerCatalog();
    this.loader = params?.loader ?? loadStickerCatalogFromStorage;
  }

  async resolveStickerLink(name: string, _tenantId: string): Promise<string | null> {
    const key = toCanonicalStickerName(name);
    if (!key) return null;

    const dynamic = await this.getDynamicCatalog();
    const fromDynamic = dynamic.get(key);
    if (fromDynamic) {
      logger.debug("STICKER_RESOLVE_OK", { key, source: "dynamic" });
      return fromDynamic;
    }

    const fromStatic = this.staticCatalog.get(key);
    if (fromStatic) {
      logger.debug("STICKER_RESOLVE_OK", { key, source: "static" });
      return fromStatic;
    }

    const fromHardcoded = STATIC_FALLBACKS[key];
    if (fromHardcoded) {
      logger.info("STICKER_RESOLVE_OK", { key, source: "hardcoded_fallback" });
      return fromHardcoded;
    }

    logger.warn("STICKER_RESOLVE_FAIL", { key, reason: "not_found" });
    return null;
  }

  async refresh(): Promise<number> {
    const items = await this.loader();
    this.cache = {
      syncedAtMs: Date.now(),
      items,
    };
    return items.size;
  }

  private async getDynamicCatalog(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.cache && now - this.cache.syncedAtMs <= this.ttlMs) {
      return this.cache.items;
    }
    try {
      await this.refresh();
    } catch (error) {
      logger.warn("STICKER_CATALOG_SYNC_FAIL", {
        reason: (error as Error).message,
      });
      if (!this.cache) {
        this.cache = { syncedAtMs: now, items: new Map() };
      }
    }
    return this.cache?.items ?? new Map();
  }
}

function buildFirebaseDownloadUrl(params: {
  bucketName: string;
  objectPath: string;
  token: string;
}): string {
  const encoded = encodeURIComponent(params.objectPath);
  const bucket = encodeURIComponent(params.bucketName);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encoded}?alt=media&token=${params.token}`;
}

async function loadStickerCatalogFromStorage(): Promise<Map<string, string>> {
  const bucketName = String(
    process.env.STICKERS_BUCKET ??
      process.env.FIREBASE_STORAGE_BUCKET ??
      process.env.GCLOUD_STORAGE_BUCKET ??
      "",
  ).trim();
  const storage = getStorage();
  const bucket = bucketName ? storage.bucket(bucketName) : storage.bucket();
  const map = new Map<string, string>();

  // Spark Optimization: Try manifest.json first to avoid whole prefix listing
  const manifestFile = bucket.file(`${DEFAULT_STORAGE_PREFIX}manifest.json`);
  try {
    const [exists] = await manifestFile.exists();
    if (exists) {
      const [content] = await manifestFile.download();
      const manifest = JSON.parse(content.toString());
      if (manifest && typeof manifest === "object") {
        for (const [key, url] of Object.entries(manifest)) {
          map.set(toCanonicalStickerName(key), String(url));
        }
        logger.info("STICKER_CATALOG_MANIFEST_OK", { total: map.size });
        return map;
      }
    }
  } catch (error) {
    logger.warn("STICKER_MANIFEST_PARSE_FAIL", { reason: (error as Error).message });
  }

  const [files] = await bucket.getFiles({ prefix: DEFAULT_STORAGE_PREFIX });

  for (const file of files) {
    const name = String(file.name ?? "");
    // Match ChamaDudu/Stickers or similar (case-insensitive)
    if (!/ChamaDudu\/Stickers\//i.test(name)) continue;
    if (!name.toLowerCase().endsWith(".webp")) continue;
    const [meta] = await file.getMetadata();
    const tokenRaw = String(meta?.metadata?.firebaseStorageDownloadTokens ?? "").trim();
    if (!tokenRaw) continue;
    const token = tokenRaw.split(",")[0]?.trim();
    if (!token) continue;
    const canonical = toCanonicalStickerName(fileNameFromPath(name));
    if (!canonical) continue;
    map.set(
      canonical,
      buildFirebaseDownloadUrl({
        bucketName: bucket.name,
        objectPath: name,
        token,
      }),
    );
  }

  logger.info("STICKER_CATALOG_SYNC_OK", {
    bucket: bucket.name,
    total: map.size,
  });
  return map;
}

export const stickerCatalogService = new StickerCatalogService();

