import { getDepositoSession } from '../../utils/auth'
import { opsAdminFetch, resolveTenantIdFromConfig } from '../../utils/opsApi'

export default defineEventHandler(async (event) => {
  const depositoId = getDepositoSession(event)
  if (!depositoId) {
    throw createError({ statusCode: 401, statusMessage: 'Nao autorizado' })
  }

  const tenantId = resolveTenantIdFromConfig(useRuntimeConfig(event))
  return await opsAdminFetch<{ ok: boolean; dashboard: unknown }>(event, '/api/deposito/dashboard', {
    query: {
      tenantId,
      depositoId
    }
  })
})
