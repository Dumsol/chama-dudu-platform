import { z } from 'zod'
import { getAdminSession } from '../../../utils/auth'
import { opsAdminFetch, resolveTenantIdFromConfig } from '../../../utils/opsApi'

const bodySchema = z.object({
  range: z.enum(['today', '7d', '30d']).default('7d'),
  groupBy: z.enum(['bairro', 'cidade', 'canal', 'hour']).default('bairro'),
  horizon: z.number().int().min(1).max(30).default(7)
})

export default defineEventHandler(async (event) => {
  if (!getAdminSession(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Nao autorizado' })
  }

  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Payload invalido' })
  }

  const tenantId = resolveTenantIdFromConfig(useRuntimeConfig(event))
  return await opsAdminFetch<{ ok: boolean; refresh: unknown; overview: unknown }>(
    event,
    '/api/admin/war-room/refresh',
    {
      method: 'POST',
      body: {
        tenantId,
        range: parsed.data.range,
        groupBy: parsed.data.groupBy,
        horizon: parsed.data.horizon
      }
    }
  )
})
