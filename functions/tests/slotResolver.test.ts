import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRecord, WhatsAppInboundMessage } from "../src/domain/whatsapp/types";

const resolveNeighborhoodFromCoordsMock = vi.fn();
const validateNeighborhoodGoogleMapsMock = vi.fn();

vi.mock("../src/domain/whatsapp/neighborhoodValidator", () => ({
  resolveNeighborhoodFromCoords: resolveNeighborhoodFromCoordsMock,
  validateNeighborhoodGoogleMaps: validateNeighborhoodGoogleMapsMock,
}));

function baseUser(): UserRecord {
  return {
    userId: "tenant-slot:5511999990000",
    tenantId: "tenant-slot",
    waId: "5511999990000",
    type: "cliente",
    botState: "idle",
    pendingSlot: "awaiting_neighborhood",
  };
}

function textMessage(text: string): WhatsAppInboundMessage {
  return {
    phoneNumberId: "pnid-1",
    messageId: "msg-1",
    waId: "5511999990000",
    type: "text",
    timestamp: null,
    text,
    interactiveId: null,
    interactiveTitle: null,
    profileName: "Cliente",
    sourceKind: "text",
  };
}

describe("slot resolver neighborhood hardening", () => {
  beforeEach(() => {
    resolveNeighborhoodFromCoordsMock.mockReset();
    validateNeighborhoodGoogleMapsMock.mockReset();
    validateNeighborhoodGoogleMapsMock.mockResolvedValue({
      isNeighborhood: false,
      normalizedName: null,
    });
  });

  it("resolves Janga with pending slot and keeps display casing", async () => {
    const { resolvePendingSlot } = await import("../src/domain/whatsapp/slotResolver");
    const result = await resolvePendingSlot({
      tenantId: "tenant-slot",
      message: textMessage("Janga"),
      compactText: "janga",
      entities: {
        bairro: "janga",
        bairroNorm: "janga",
        cidade: null,
        confirmation: null,
        statusOperacional: null,
        beverage: null,
        orderIntent: false,
        quantity: null,
      },
      currentUser: baseUser(),
    });

    expect(result?.resolved).toBe(true);
    if (result?.resolved) {
      expect(result.value).toBe("Janga");
      expect(result.reply).toContain("Janga");
    }
  });

  it("accepts short bairro-like text such as Pau Amarelo before maps fallback", async () => {
    const { resolvePendingSlot } = await import("../src/domain/whatsapp/slotResolver");
    const result = await resolvePendingSlot({
      tenantId: "tenant-slot",
      message: textMessage("Pau Amarelo"),
      compactText: "pau amarelo",
      entities: {
        bairro: "pau amarelo",
        bairroNorm: "pau amarelo",
        cidade: null,
        confirmation: null,
        statusOperacional: null,
        beverage: null,
        orderIntent: false,
        quantity: null,
      },
      currentUser: baseUser(),
    });

    expect(result?.resolved).toBe(true);
    if (result?.resolved) {
      expect(result.value).toBe("Pau Amarelo");
    }
  });

  it("extracts the known bairro from extra trailing words such as Pau amarelo gatinho", async () => {
    const { extractEntities } = await import("../src/domain/whatsapp/entityExtractor");
    const { resolvePendingSlot } = await import("../src/domain/whatsapp/slotResolver");
    const entities = extractEntities({
      message: {
        raw: "Pau amarelo gatinho",
        compact: "pau amarelo gatinho",
        tokens: ["pau", "amarelo", "gatinho"],
      },
      botState: "idle",
      pendingSlot: "awaiting_neighborhood",
      allowFreeformBairroCapture: true,
    });

    expect(entities.bairro).toBe("Pau Amarelo");

    const result = await resolvePendingSlot({
      tenantId: "tenant-slot",
      message: textMessage("Pau amarelo gatinho"),
      compactText: "pau amarelo gatinho",
      entities,
      currentUser: {
        ...baseUser(),
        pendingSlot: "awaiting_neighborhood",
      },
    });

    expect(result?.resolved).toBe(true);
    if (result?.resolved) {
      expect(result.value).toBe("Pau Amarelo");
      expect(result.reply).toContain("Pau Amarelo");
    }
  });

  it("does not accept social/control words as bairro", async () => {
    const { resolvePendingSlot } = await import("../src/domain/whatsapp/slotResolver");
    const result = await resolvePendingSlot({
      tenantId: "tenant-slot",
      message: textMessage("ajuda"),
      compactText: "ajuda",
      entities: {
        bairro: "ajuda",
        bairroNorm: "ajuda",
        cidade: null,
        confirmation: null,
        statusOperacional: null,
        beverage: null,
        orderIntent: false,
        quantity: null,
      },
      currentUser: baseUser(),
    });

    expect(result).toBeNull();
  });

  it("uses explicit pendingSlot even when botState is no longer awaiting bairro", async () => {
    const { resolvePendingSlot } = await import("../src/domain/whatsapp/slotResolver");
    const result = await resolvePendingSlot({
      tenantId: "tenant-slot",
      message: textMessage("Janga"),
      compactText: "janga",
      entities: {
        bairro: "janga",
        bairroNorm: "janga",
        cidade: null,
        confirmation: null,
        statusOperacional: null,
        beverage: null,
        orderIntent: false,
        quantity: null,
      },
      currentUser: {
        ...baseUser(),
        botState: "idle",
        pendingSlot: "awaiting_neighborhood",
      },
    });

    expect(result?.resolved).toBe(true);
    if (result?.resolved) {
      expect(result.value).toBe("Janga");
    }
  });
});
