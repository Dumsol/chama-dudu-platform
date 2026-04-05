import { z } from 'zod'
import { getAdminSession } from '../../../utils/auth'
import { opsAdminFetch, resolveTenantIdFromConfig } from '../../../utils/opsApi'

const querySchema = z.object({
  range: z.enum(['today', '7d', '30d']).optional(),
  groupBy: z.enum(['bairro', 'cidade', 'canal', 'hour']).optional(),
  horizon: z.coerce.number().int().min(1).max(30).optional()
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
  return await opsAdminFetch<{ ok: boolean; overview: unknown }>(event, '/api/admin/war-room/overview', {
    query: {
      tenantId,
      range: parsed.data.range,
      groupBy: parsed.data.groupBy,
      horizon: parsed.data.horizon
    }
  })
})
