export type MonitorCollectionStatus = "OK" | "residuo_historico_estavel" | "suspeita_write_ativo";

export type MonitorDeltaStatus =
  | "sem_mudanca"
  | "novo_residuo"
  | "crescimento_suspeito"
  | "limpeza_concluida";

export type DeltaComputationInput = {
  currentTotal: number;
  currentSampleIds: string[];
  previousTotal: number | null;
  previousSampleIds: string[];
};

export type DeltaComputationResult = {
  deltaStatus: MonitorDeltaStatus;
  deltaTotal: number;
  newSampleIds: string[];
};

export function computeDeltaStatus(input: DeltaComputationInput): DeltaComputationResult {
  const previousTotal = Number.isFinite(input.previousTotal as number) ? Number(input.previousTotal) : null;
  const currentTotal = Math.max(0, Number(input.currentTotal || 0));
  const previousSampleIds = Array.isArray(input.previousSampleIds) ? input.previousSampleIds : [];
  const currentSampleIds = Array.isArray(input.currentSampleIds) ? input.currentSampleIds : [];
  const previousIds = new Set(previousSampleIds);
  const newSampleIds = currentSampleIds.filter((id) => !previousIds.has(id));

  if (previousTotal == null) {
    return {
      deltaStatus: currentTotal > 0 ? "novo_residuo" : "sem_mudanca",
      deltaTotal: currentTotal,
      newSampleIds,
    };
  }

  const deltaTotal = currentTotal - previousTotal;

  if (previousTotal > 0 && currentTotal <= 0) {
    return {
      deltaStatus: "limpeza_concluida",
      deltaTotal,
      newSampleIds,
    };
  }

  if (previousTotal <= 0 && currentTotal > 0) {
    return {
      deltaStatus: "novo_residuo",
      deltaTotal,
      newSampleIds,
    };
  }

  if (deltaTotal > 0 || (currentTotal > 0 && newSampleIds.length > 0)) {
    return {
      deltaStatus: "crescimento_suspeito",
      deltaTotal,
      newSampleIds,
    };
  }

  return {
    deltaStatus: "sem_mudanca",
    deltaTotal,
    newSampleIds,
  };
}

export function classifyOperationalStatus(params: {
  total: number;
  deltaStatus: MonitorDeltaStatus;
  recentDocCount: number;
  knownStableResidual: boolean;
}): MonitorCollectionStatus {
  if (params.total <= 0 || params.deltaStatus === "limpeza_concluida") return "OK";

  if (params.deltaStatus === "novo_residuo" || params.deltaStatus === "crescimento_suspeito") {
    return params.knownStableResidual ? "residuo_historico_estavel" : "suspeita_write_ativo";
  }

  if (params.recentDocCount > 0 && !params.knownStableResidual) {
    return "suspeita_write_ativo";
  }

  return "residuo_historico_estavel";
}
