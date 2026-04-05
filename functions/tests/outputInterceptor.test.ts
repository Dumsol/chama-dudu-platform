import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const addMock = vi.fn(async () => void 0);
const getMock = vi.fn(async () => ({
  exists: true,
  data: () => ({
    userId: "tenant-1:5511999999999",
    waId: "5511999999999",
    bairro: "Janga",
    pendingSlot: "awaiting_neighborhood",
    slots: {
      neighborhood: "Janga",
      product: null,
    },
  }),
}));

vi.mock("../src/infra/firestore/duduPaths", () => ({
  forbiddenPhraseAlertsCol: () => ({ add: addMock }),
  usersCol: () => ({ doc: () => ({ get: getMock }) }),
}));

describe("output interceptor", () => {
  let interceptOutboundText: typeof import("../src/domain/whatsapp/outputInterceptor")["interceptOutboundText"];
  let outputInterceptorInternals: typeof import("../src/domain/whatsapp/outputInterceptor")["outputInterceptorInternals"];

  beforeAll(async () => {
    const module = await import("../src/domain/whatsapp/outputInterceptor");
    interceptOutboundText = module.interceptOutboundText;
    outputInterceptorInternals = module.outputInterceptorInternals;
  });

  beforeEach(() => {
    addMock.mockClear();
    getMock.mockClear();
  });

  it("keeps safe text unchanged", async () => {
    const result = await interceptOutboundText({
      tenantId: "tenant-1",
      waId: "5511999999999",
      body: "Fechou. Ja encaminhei teu pedido.",
      requestKind: "text",
    });

    expect(result).toBe("Fechou. Ja encaminhei teu pedido.");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("captures forbidden phrase and replaces with contextual safe copy", async () => {
    expect(outputInterceptorInternals.findForbiddenPhrase("Ainda nao saquei certinho.")).toBe("ainda nao saquei certinho");

    const result = await interceptOutboundText({
      tenantId: "tenant-1",
      waId: "5511999999999",
      body: "Ainda nao saquei certinho, mas to contigo. Me diz teu bairro ou escreve o que voce quer fazer agora.",
      requestKind: "text",
    });

    expect(result.toLowerCase()).toContain("bairro");
    expect(result.toLowerCase()).not.toContain("saquei certinho");
    expect(addMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("blocks generic AI opener 'como posso te ajudar' (incompatível com persona PE)", async () => {
    expect(outputInterceptorInternals.findForbiddenPhrase("Olá! Como posso te ajudar hoje?")).toBe("como posso te ajudar");

    const result = await interceptOutboundText({
      tenantId: "tenant-1",
      waId: "5511999999999",
      body: "Olá! Como posso te ajudar hoje? Me diz o que precisa.",
      requestKind: "text",
    });

    expect(result.toLowerCase()).not.toContain("como posso te ajudar");
    expect(addMock).toHaveBeenCalledTimes(1);
  });

  it("blocks 'ainda nao saquei' short variant", () => {
    expect(outputInterceptorInternals.findForbiddenPhrase("Ainda nao saquei direito o que você quer.")).toBe("ainda nao saquei");
    expect(outputInterceptorInternals.findForbiddenPhrase("Ainda nao saquei certinho")).toBe("ainda nao saquei certinho");
  });
});
