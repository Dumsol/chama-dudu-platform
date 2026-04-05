import { describe, expect, it } from "vitest";
import {
  StickerCatalogService,
  buildStaticStickerCatalog,
  toCanonicalStickerName,
} from "../src/infra/whatsapp/stickerCatalogService";

describe("sticker catalog service", () => {
  it("normalizes sticker names and file names", () => {
    expect(toCanonicalStickerName("pedidoConfirmado")).toBe("pedido_confirmado");
    expect(toCanonicalStickerName("Dudu Problema Técnico.webp")).toBe("dudu_problema_tecnico");
    expect(toCanonicalStickerName("  pedido-saiu  ")).toBe("pedido_saiu");
  });

  it("resolves dynamic catalog first and falls back to static", async () => {
    const staticCatalog = new Map<string, string>([
      ["hello", "https://static/hello.webp"],
      ["pedido_confirmado", "https://static/pedido_confirmado.webp"],
    ]);
    const service = new StickerCatalogService({
      ttlMs: 60_000,
      staticCatalog,
      loader: async () =>
        new Map<string, string>([
          ["hello", "https://dynamic/hello.webp"],
          ["pedido_saiu", "https://dynamic/pedido_saiu.webp"],
        ]),
    });

    await expect(service.resolveStickerLink("hello", "tenant-a")).resolves.toBe("https://dynamic/hello.webp");
    await expect(service.resolveStickerLink("pedido_confirmado", "tenant-a")).resolves.toBe(
      "https://static/pedido_confirmado.webp",
    );
    await expect(service.resolveStickerLink("pedido_saiu", "tenant-a")).resolves.toBe(
      "https://dynamic/pedido_saiu.webp",
    );
  });

  it("returns null for unknown sticker", async () => {
    const service = new StickerCatalogService({
      ttlMs: 60_000,
      staticCatalog: new Map(),
      loader: async () => new Map(),
    });
    await expect(service.resolveStickerLink("inexistente_total", "tenant-a")).resolves.toBeNull();
  });

  it("builds static aliases from legacy keys", () => {
    const catalog = buildStaticStickerCatalog();
    expect(catalog.get("hello")).toBeTruthy();
    expect(catalog.get("pedido_confirmado")).toBeTruthy();
    expect(catalog.get("problema_geral")).toBeTruthy();
  });
});

