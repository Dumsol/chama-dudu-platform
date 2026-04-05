import { describe, expect, it } from "vitest";
import { resolveBeverage, buildClarificationQuestion } from "../src/domain/whatsapp/beverageResolver";

describe("resolveBeverage — embalagem clarification", () => {
  it("pede embalagem para 12 Heineken sem volume", () => {
    const r = resolveBeverage("12 heineken");
    expect(r.clarificationNeeded).toBe("embalagem");
    expect(r.packagingResolved).toBe(false);
    expect(r.isAlcoholic).toBe(true);
    expect(r.brand).toBe("Heineken");
  });

  it("pede embalagem para cerveja pura sem embalagem", () => {
    const r = resolveBeverage("2 cervejas geladas");
    expect(r.clarificationNeeded).toBe("embalagem");
    expect(r.packagingResolved).toBe(false);
  });

  it("resolve lata 350ml explícita sem clarificação", () => {
    const r = resolveBeverage("6 Skol lata 350ml");
    expect(r.clarificationNeeded).toBeNull();
    expect(r.packagingResolved).toBe(true);
    expect(r.packType).toBe("lata");
    expect(r.volumeMl).toBe(350);
  });

  it("resolve long neck explícita sem clarificação", () => {
    const r = resolveBeverage("3 Heineken long neck");
    expect(r.clarificationNeeded).toBeNull();
    expect(r.packagingResolved).toBe(true);
    expect(r.packType).toBe("long_neck");
    expect(r.volumeMl).toBe(355);
  });

  it("resolve garrafa 600ml explícita sem clarificação", () => {
    const r = resolveBeverage("4 Skol garrafa 600ml");
    expect(r.clarificationNeeded).toBeNull();
    expect(r.packagingResolved).toBe(true);
    expect(r.packType).toBe("garrafa");
    expect(r.volumeMl).toBe(600);
  });
});

describe("resolveBeverage — vasilhame", () => {
  it("pede vasilhame para litrão sem hasVasilhame informado", () => {
    const r = resolveBeverage("1 litrão de Skol");
    expect(r.clarificationNeeded).toBe("vasilhame");
    expect(r.vasilhameRequired).toBe(true);
    expect(r.packagingResolved).toBe(false);
  });

  it("considera resolvido quando hasVasilhame=true", () => {
    const r = resolveBeverage("1 litrão de Brahma", true);
    expect(r.clarificationNeeded).toBeNull();
    expect(r.packagingResolved).toBe(true);
    expect(r.vasilhameRequired).toBe(true);
  });

  it("considera resolvido quando hasVasilhame=false (sem vasilhame — deve ser redirecionado)", () => {
    const r = resolveBeverage("1 litrão", false);
    // com false, vasilhameResolved = true (já foi perguntado), mas hasVasilhame=false
    // o stateEngine trata hasVasilhame=false separadamente
    expect(r.packagingResolved).toBe(true);
  });

  it("reconhece '1 litro' como litrão", () => {
    const r = resolveBeverage("1 litro de Heineken");
    expect(r.clarificationNeeded).toBe("vasilhame");
    expect(r.vasilhameRequired).toBe(true);
  });
});

describe("resolveBeverage — bebidas não-alcoólicas", () => {
  it("não pede clarificação para água", () => {
    const r = resolveBeverage("2 garrafinhas de água Crystal");
    expect(r.clarificationNeeded).toBeNull();
    expect(r.isAlcoholic).toBe(false);
  });

  it("não pede clarificação para refrigerante", () => {
    const r = resolveBeverage("1 Coca-Cola 2 litros");
    expect(r.isAlcoholic).toBe(false);
  });
});

describe("resolveBeverage — bebidas alcoólicas com marca mas sem cerveja", () => {
  it("vodka não exige clarificação de embalagem", () => {
    const r = resolveBeverage("1 vodka Smirnoff");
    expect(r.clarificationNeeded).toBeNull();
    expect(r.isAlcoholic).toBe(true);
  });

  it("cachaça não exige clarificação de embalagem", () => {
    const r = resolveBeverage("uma cachaça 51");
    expect(r.clarificationNeeded).toBeNull();
    expect(r.isAlcoholic).toBe(true);
  });
});

describe("buildClarificationQuestion", () => {
  it("gera pergunta de embalagem com marca", () => {
    const q = buildClarificationQuestion("embalagem", "Heineken");
    expect(q).toContain("Heineken");
    expect(q).toMatch(/lata|long neck|garrafa/i);
  });

  it("gera pergunta de embalagem sem marca", () => {
    const q = buildClarificationQuestion("embalagem", null);
    expect(q).toContain("cerveja");
  });

  it("gera pergunta de vasilhame", () => {
    const q = buildClarificationQuestion("vasilhame", null);
    expect(q).toMatch(/vasilhame|botij[aã]o|garr[aã]o/i);
  });
});
