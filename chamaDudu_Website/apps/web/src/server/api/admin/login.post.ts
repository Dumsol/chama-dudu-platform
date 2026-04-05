import { z } from 'zod'
import { setAdminSession } from '../../utils/auth'
import { enforceLoginRateLimit, logLoginAttempt } from '../../utils/loginRateLimit'

const schema = z.object({
  password: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  enforceLoginRateLimit(event, 'admin')
  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dados invalidos',
      data: { message: 'Senha obrigatoria.' }
    })
  }

  const config = useRuntimeConfig()
  if (!config.adminPassword) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Configuracao ausente',
      data: { message: 'ADMIN_PASSWORD nao configurado.' }
    })
  }

  if (parsed.data.password !== config.adminPassword) {
    logLoginAttempt('admin', false)
    throw createError({
      statusCode: 401,
      statusMessage: 'Nao autorizado',
      data: { message: 'Senha invalida.' }
    })
  }

  setAdminSession(event)
  logLoginAttempt('admin', true)
  return { ok: true }
})

