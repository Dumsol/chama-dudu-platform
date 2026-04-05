function buildOverview() {
  return {
    tenantId: 'tenant-e2e',
    range: '7d',
    periodStartMs: Date.now() - 7 * 86400000,
    periodEndMs: Date.now(),
    kpis: {
      gmvCentavos: 1289040,
      knownCostsCentavos: 337000,
      profitCentavos: 952040,
      marginPct: 73.85,
      ordersTotal: 88,
      ordersDelivered: 79,
      ordersActive: 9,
      slaAvgMinutes: 14.3,
      preCadastrosTotal: 24,
      preCadastrosConfirmed: 12,
      conversionRatePct: 50
    },
    matchingFunnel: {
      semCobertura: 6,
      elegiveis: 82,
      selecionado: 80,
      encaminhado: 76,
      aceito: 61,
      recusado: 9,
      timeout: 6
    },
    rolloutHealth: {
      attemptsTotal: 74,
      rolloutAllowed: 68,
      rolloutBlocked: 6,
      blockedRatePct: 8.11,
      rolloutReasonCounts: {
        bucket_blocked: 5,
        disabled_bairro: 1
      }
    },
    topDepositos: [
      {
        depositoId: 'dep_a',
        depositoNome: 'Deposito Boa Viagem',
        gmvCentavos: 503300,
        deliveredOrders: 31,
        acceptanceRatePct: 92.3,
        slaAvgMinutes: 11.4
      },
      {
        depositoId: 'dep_b',
        depositoNome: 'Deposito Centro',
        gmvCentavos: 409700,
        deliveredOrders: 25,
        acceptanceRatePct: 88.1,
        slaAvgMinutes: 15.9
      }
    ],
    flow: [
      { key: 'Centro', count: 27, gmvCentavos: 358000 },
      { key: 'Boa Viagem', count: 19, gmvCentavos: 280000 },
      { key: 'Pina', count: 14, gmvCentavos: 201000 }
    ],
    alerts: [
      {
        code: 'active_backlog',
        severity: 'warning',
        title: 'Backlog de pedidos ativos',
        value: 9
      }
    ],
    forecast: {
      generatedAtIso: new Date().toISOString(),
      horizonDays: 7,
      points: Array.from({ length: 7 }).map((_, idx) => ({
        date: new Date(Date.now() + (idx + 1) * 86400000).toISOString().slice(0, 10),
        ordersBase: 12,
        ordersLow: 9,
        ordersHigh: 15,
        gmvBaseCentavos: 182000,
        gmvLowCentavos: 145000,
        gmvHighCentavos: 219000
      }))
    },
    generatedAtIso: new Date().toISOString(),
    source: 'snapshot',
    powerBi: {
      embedUrl: '',
      reportId: null,
      workspaceId: null
    }
  }
}

export default defineEventHandler(() => ({
  ok: true,
  overview: buildOverview()
}))
