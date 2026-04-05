// functions/src/billing/feeCalculator.ts

export type FeeBreakdown = {
  deliveredCount: number;
  gmvCentavos: number;
  serviceFeeRepasseCentavos: number;
  platformCommissionCentavos: number;
  totalCentavos: number;
};

function assertIntNonNeg(n: number, name: string) {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} precisa ser inteiro >= 0 (recebido=${n}).`);
  }
}

/**
 * Regras Q1 (semanal):
 * - Repasse taxa cliente (serviceFee) + comissao fixa por pedido entregue.
 * - GMV e usado apenas para registro (nao entra no calculo).
 */
export function computeWeeklyFee(params: {
  deliveredCount: number;
  gmvCentavos: number;
  serviceFeeRepasseCentavos: number;
  platformCommissionCentavos: number;
}): FeeBreakdown {
  const deliveredCount = params.deliveredCount ?? 0;
  const gmvCentavos = params.gmvCentavos ?? 0;
  const serviceFeeRepasseCentavos = params.serviceFeeRepasseCentavos ?? 0;
  const platformCommissionCentavos = params.platformCommissionCentavos ?? 0;

  assertIntNonNeg(deliveredCount, "deliveredCount");
  assertIntNonNeg(gmvCentavos, "gmvCentavos");
  assertIntNonNeg(serviceFeeRepasseCentavos, "serviceFeeRepasseCentavos");
  assertIntNonNeg(platformCommissionCentavos, "platformCommissionCentavos");

  const totalCentavos = serviceFeeRepasseCentavos + platformCommissionCentavos;

  return {
    deliveredCount,
    gmvCentavos,
    serviceFeeRepasseCentavos,
    platformCommissionCentavos,
    totalCentavos,
  };
}
