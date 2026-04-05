import { z } from 'zod'
import { hashToken, setDepositoSession } from '../../utils/auth'
import { readJson } from '../../utils/storage'
import { enforceLoginRateLimit, logLoginAttempt } from '../../utils/loginRateLimit'
import type { Deposit } from '#shared/types'

const schema = z.object({
  token: z.string().min(4)
})

export default defineEventHandler(async (event) => {
  enforceLoginRateLimit(event, 'deposito')
  const body = await readBody(event)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dados invalidos',
      data: { message: 'Token obrigatorio.' }
    })
  }

  const config = useRuntimeConfig()
  if (!config.depositTokenSalt) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Configuracao ausente',
      data: { message: 'DEPOSIT_TOKEN_SALT nao configurado.' }
    })
  }

  const tokenHash = hashToken(parsed.data.token, config.depositTokenSalt)

  // --- Estrategia primaria: validar via Firestore (através do backend) ---
  const tenantId = String(config.public.defaultTenantId ?? '').trim()
  const apiBaseUrl = String(config.public.apiBaseUrl ?? '').trim().replace(/\/$/, '')

  if (tenantId && apiBaseUrl) {
    try {
      const result = await $fetch<{ ok: boolean; depositoId?: string }>(
        `${apiBaseUrl}/api/deposito/validate-token?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: 'POST',
          body: { tokenHash },
          timeout: 8000
        }
      )
      if (result.ok && result.depositoId) {
        setDepositoSession(event, result.depositoId)
        logLoginAttempt('deposito', true, { depositoId: result.depositoId, source: 'firestore' })
        return { ok: true }
      }
    } catch {
      // Estrategia primaria falhou — cai para fallback local abaixo.
    }
  }

  // --- Estrategia de fallback: validar pelo JSON local (cache local) ---
  const deposits = await readJson<Deposit[]>('deposits.json', [])
  const deposito = deposits.find((item) => item.tokenHash === tokenHash)

  if (!deposito) {
    logLoginAttempt('deposito', false, { tokenPrefix: parsed.data.token.slice(0, 2) })
    throw createError({
      statusCode: 401,
      statusMessage: 'Nao autorizado',
      data: { message: 'Token invalido.' }
    })
  }

  setDepositoSession(event, deposito.id)
  logLoginAttempt('deposito', true, { depositoId: deposito.id, source: 'local_fallback' })
  return { ok: true }
})
