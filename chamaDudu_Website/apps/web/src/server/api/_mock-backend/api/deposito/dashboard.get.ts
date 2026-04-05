export default defineEventHandler(() => ({
  ok: true,
  dashboard: {
    tenantId: 'tenant-e2e',
    depositoId: 'dep_a',
    depositoNome: 'Deposito Boa Viagem',
    status: 'ABERTO',
    activeOrders: 3,
    queueOrders: 2,
    deliveredToday: 10,
    todayGmvCentavos: 128000,
    acceptanceRatePct: 91.6,
    avgPrepMinutes: 11.2,
    avgDeliveryMinutes: 24.8,
    alerts: [],
    updatedAtIso: new Date().toISOString()
  }
}))
