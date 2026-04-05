import { describe, expect, it } from "vitest";
import {
  extractNeighborhood,
  extractNeighborhoodSync,
} from "../src/domain/whatsapp/neighborhoodExtractor";

describe("neighborhoodExtractor — L1 exact", () => {
  it('resolves "pau amarelo" with exact confidence', async () => {
    const result = await extractNeighborhood("pau amarelo", []);
    expect(result.confidence).toBe("exact");
    expect(result.bairro).toBe("Pau Amarelo");
    expect(result.needsConfirmation).toBe(false);
  });

  it('resolves "janga" exact and normalizes casing', async () => {
    const result = await extractNeighborhood("janga", []);
    expect(result.confidence).toBe("exact");
    expect(result.bairro).toBe("Janga");
  });

  it('resolves "to no janga" with exact via substring', async () => {
    const result = await extractNeighborhood("to no janga", []);
    expect(result.confidence).toBe("exact");
    expect(result.bairro).toBe("Janga");
  });

  it("resolves bairro from tenantBairros list (dynamic)", async () => {
    const result = await extractNeighborhood("nova descoberta", ["nova descoberta"]);
    expect(result.confidence).toBe("exact");
    expect(result.bairro).toBe("Nova Descoberta");
  });
});

describe("neighborhoodExtractor — L2 fuzzy", () => {
  it('resolves "pau amareo" with fuzzy confidence (typo)', async () => {
    const result = await extractNeighborhood("pau amareo", []);
    expect(result.confidence).toBe("fuzzy");
    expect(result.bairro).toBeTruthy();
    expect(result.needsConfirmation).toBe(true);
  });

  it('resolves "jangaa" with fuzzy (single insertion)', async () => {
    const result = await extractNeighborhood("jangaa", []);
    expect(result.confidence).toBe("fuzzy");
    expect(result.needsConfirmation).toBe(true);
  });

  it('does NOT fuzzy-match very short inputs incorrectly ("ja" stays none)', async () => {
    const result = await extractNeighborhood("ja", []);
    // "ja" levenshtein to "janga" = 3, above threshold
    expect(result.confidence).toBe("none");
  });
});

describe("neighborhoodExtractor — L4 none", () => {
  it('returns none for unrelated word "pizza"', async () => {
    const result = await extractNeighborhood("pizza", []);
    expect(result.confidence).toBe("none");
    expect(result.bairro).toBeNull();
    expect(result.needsConfirmation).toBe(false);
  });

  it("returns none for empty string", async () => {
    const result = await extractNeighborhood("", []);
    expect(result.confidence).toBe("none");
  });

  it("returns none for single stop-word", async () => {
    const result = await extractNeighborhood("sim", []);
    expect(result.confidence).toBe("none");
  });
});

describe("neighborhoodExtractor — sync variant matches async", () => {
  it("sync and async return the same result for exact match", async () => {
    const sync = extractNeighborhoodSync("maranguape i", []);
    const async_ = await extractNeighborhood("maranguape i", []);
    expect(sync.confidence).toBe(async_.confidence);
    expect(sync.bairro).toBe(async_.bairro);
  });
});
