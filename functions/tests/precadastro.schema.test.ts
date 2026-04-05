import { describe, expect, it } from "vitest";
import { normalizeBrazilWhatsApp, parseSupportedDdds, resolveRegionStatus } from "../src/domain/precadastro/ddd";
import { preCadastroSchema } from "../src/domain/precadastro/schema";

describe("pre-cadastro schema", () => {
  it("accepts valid payload and normalizes whatsapp", () => {
    const parsed = preCadastroSchema.parse({
      nomeDeposito: "Deposito Centro",
      responsavel: "Maria",
      whatsapp: "+55 (81) 99876-1234",
      bairro: "Centro",
      cidade: "Paulista",
      cnpj: "12345678000199",
    });

    expect(parsed.whatsapp).toBe("5581998761234");
  });

  it("rejects invalid payload", () => {
    const parsed = preCadastroSchema.safeParse({
      nomeDeposito: "A",
      responsavel: "B",
      whatsapp: "123",
      bairro: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("classifies supported and unsupported DDD", () => {
    const supported = parseSupportedDdds("81,11");
    expect(resolveRegionStatus("81", supported)).toBe("supported");
    expect(resolveRegionStatus("21", supported)).toBe("unsupported");
  });

  it("normalizes brazil whatsapp and extracts ddd", () => {
    const parsed = normalizeBrazilWhatsApp("(81) 96301-1541");
    expect(parsed.valid).toBe(true);
    expect(parsed.ddd).toBe("81");
    expect(parsed.normalized).toBe("5581963011541");
  });
});
