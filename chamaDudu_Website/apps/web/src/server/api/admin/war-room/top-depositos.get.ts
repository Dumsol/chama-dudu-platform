import { z } from 'zod'
import { getAdminSession } from '../../../utils/auth'
import { opsAdminFetch, resolveTenantIdFromConfig } from '../../../utils/opsApi'

const querySchema = z.object({
  range: z.enum(['today', '7d', '30d']).optional()
})

export default defineEventHandler(async (event) => {
  if (!getAdminSession(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Nao autorizado' })
  }

  const parsed = querySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Query invalida' })
  }

  const tenantId = resolveTenantIdFromConfig(useRuntimeConfig(event))
  return await opsAdminFetch<{ ok: boolean; topDepositos: unknown }>(event, '/api/admin/war-room/top-depositos', {
    query: {
      tenantId,
      range: parsed.data.range
    }
  })
})
