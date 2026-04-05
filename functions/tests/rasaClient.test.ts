import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { parseWithRasa } from "../src/infra/nlu/rasaClient";

vi.mock("axios");
const mockedAxios = axios as any;

describe("rasaClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return NLU result when confidence is high", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        intent: { name: "greet", confidence: 0.9 },
        entities: [],
        intent_ranking: [{ name: "greet", confidence: 0.9 }]
      }
    });

    const result = await parseWithRasa("oi");
    expect(result.classification.intent).toBe("saudacao");
    expect(result.perf?.nluMs).toBeDefined();
  });

  it("should fallback when confidence is low (< 0.5)", async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        intent: { name: "greet", confidence: 0.3 },
        entities: [],
        intent_ranking: [{ name: "greet", confidence: 0.3 }]
      }
    });

    const result = await parseWithRasa("oi");
    // Fallback to internal heuristics (oi maps to cliente_menu in legacy)
    expect(result.classification.intent).toBe("cliente_menu");
    expect(result.classification.reasons).toContain("exact_match");
  });

  it("should fallback when axios times out", async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error("timeout"));

    const result = await parseWithRasa("oi");
    expect(result.classification.intent).toBe("cliente_menu");
  });
});
