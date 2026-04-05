import { describe, expect, it } from "vitest";
import { classifyOperationalStatus, computeDeltaStatus } from "../src/ops/legacyAuditMonitorLogic";

describe("legacy audit monitor delta", () => {
  it("marks first non-empty run as novo_residuo", () => {
    const delta = computeDeltaStatus({
      currentTotal: 1,
      currentSampleIds: ["doc-a"],
      previousTotal: null,
      previousSampleIds: [],
    });
    expect(delta.deltaStatus).toBe("novo_residuo");
    expect(delta.deltaTotal).toBe(1);
    expect(delta.newSampleIds).toEqual(["doc-a"]);
  });

  it("marks growth as crescimento_suspeito", () => {
    const delta = computeDeltaStatus({
      currentTotal: 3,
      currentSampleIds: ["doc-a", "doc-b"],
      previousTotal: 1,
      previousSampleIds: ["doc-a"],
    });
    expect(delta.deltaStatus).toBe("crescimento_suspeito");
    expect(delta.deltaTotal).toBe(2);
    expect(delta.newSampleIds).toEqual(["doc-b"]);
  });

  it("marks cleanup when previous had data and current is empty", () => {
    const delta = computeDeltaStatus({
      currentTotal: 0,
      currentSampleIds: [],
      previousTotal: 1,
      previousSampleIds: ["doc-a"],
    });
    expect(delta.deltaStatus).toBe("limpeza_concluida");
    expect(delta.deltaTotal).toBe(-1);
  });
});

describe("legacy audit monitor status", () => {
  it("returns OK for empty collection", () => {
    const status = classifyOperationalStatus({
      total: 0,
      deltaStatus: "sem_mudanca",
      recentDocCount: 0,
      knownStableResidual: false,
    });
    expect(status).toBe("OK");
  });

  it("returns stable residual for known stable item", () => {
    const status = classifyOperationalStatus({
      total: 1,
      deltaStatus: "novo_residuo",
      recentDocCount: 1,
      knownStableResidual: true,
    });
    expect(status).toBe("residuo_historico_estavel");
  });

  it("returns suspect for new unknown residue", () => {
    const status = classifyOperationalStatus({
      total: 1,
      deltaStatus: "novo_residuo",
      recentDocCount: 0,
      knownStableResidual: false,
    });
    expect(status).toBe("suspeita_write_ativo");
  });
});

