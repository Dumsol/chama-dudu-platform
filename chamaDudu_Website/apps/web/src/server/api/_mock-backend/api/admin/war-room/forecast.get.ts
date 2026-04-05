export default defineEventHandler(() => ({
  ok: true,
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
  }
}))
