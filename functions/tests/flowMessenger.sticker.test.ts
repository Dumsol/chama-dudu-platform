import { describe, expect, it } from "vitest";
import { createFlowMessenger } from "../src/infra/whatsapp/messenger";
import { StickerCatalogService } from "../src/infra/whatsapp/stickerCatalogService";
import type { CloudApiClient } from "../src/infra/whatsapp/cloudApiClient";

function buildClient(log: string[]): CloudApiClient {
  return {
    async sendText(params) {
      log.push(`text:${params.to}:${params.body}`);
      return { messageId: "msg-text" };
    },
    async sendReplyButtons(params) {
      log.push(`menu:${params.to}:${params.body}`);
      return { messageId: "msg-menu" };
    },
    async sendSticker(params) {
      log.push(`sticker:${params.to}:${params.stickerLink}`);
      return { messageId: null };
    },
  };
}

describe("flow messenger sticker policy", () => {
  it("sends sticker and text when allowed", async () => {
    const calls: string[] = [];
    const catalog = new StickerCatalogService({
      staticCatalog: new Map([["hello", "https://cdn/hello.webp"]]),
      loader: async () => new Map(),
    });
    const messenger = createFlowMessenger(buildClient(calls), {
      catalog,
      acquireStickerCooldown: async () => true,
    });

    await messenger.sendText({
      tenantId: "tenant-1",
      phoneNumberId: "pnid-1",
      waId: "5511999999999",
      body: "Oi",
      stickerName: "hello",
      policyEvent: "test_event",
    });

    expect(calls[0]).toContain("sticker:5511999999999:https://cdn/hello.webp");
    expect(calls[1]).toContain("text:5511999999999:Oi");
  });

  it("keeps text when sticker is blocked by cooldown", async () => {
    const calls: string[] = [];
    const catalog = new StickerCatalogService({
      staticCatalog: new Map([["hello", "https://cdn/hello.webp"]]),
      loader: async () => new Map(),
    });
    const messenger = createFlowMessenger(buildClient(calls), {
      catalog,
      acquireStickerCooldown: async () => false,
    });

    await messenger.sendText({
      tenantId: "tenant-1",
      phoneNumberId: "pnid-1",
      waId: "5511999999999",
      body: "Sem sticker",
      stickerName: "hello",
      policyEvent: "cooldown_case",
    });

    expect(calls.some((item) => item.startsWith("sticker:"))).toBe(false);
    expect(calls.some((item) => item.includes("text:5511999999999:Sem sticker"))).toBe(true);
  });
});

