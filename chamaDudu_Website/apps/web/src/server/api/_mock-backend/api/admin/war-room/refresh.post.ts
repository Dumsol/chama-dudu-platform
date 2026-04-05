export default defineEventHandler(() => ({
  ok: true,
  refresh: {
    persisted: true,
    generatedAtIso: new Date().toISOString()
  },
  overview: {
    tenantId: 'tenant-e2e'
  }
}))
