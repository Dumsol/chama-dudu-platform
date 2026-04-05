import { getAdminSession } from '../../utils/auth'
import { resolveTenantIdFromConfig } from '../../utils/opsApi'

type CheckResult = {
  ok: boolean
  latencyMs: number | null
  message?: string
}

function resolveApiBaseUrl(config: ReturnType<typeof useRuntimeConfig>): string {
  const explicit = String(config.public.apiBaseUrl ?? '').trim()
  if (explicit) return explicit.replace(/\/$/, '')
  return 'https://southamerica-east1-your-project-id.cloudfunctions.net/dudu_opsAppV1'
}

async function runCheck<T>(fn: () => Promise<T>): Promise<CheckResult> {
  const start = Date.now()
  try {
    await fn()
    return { ok: true, latencyMs: Date.now() - start }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180)
    }
  }
}

export default defineEventHandler(async (event) => {
  if (!getAdminSession(event)) {
    throw createError({ statusCode: 401, statusMessage: 'Nao autorizado' })
  }

  const config = useRuntimeConfig(event)
  const apiBaseUrl = resolveApiBaseUrl(config)
  const tenantId = resolveTenantIdFromConfig(config)
  const adminKey = String(config.opsAdminApiKey ?? '').trim()
  const headers = adminKey ? { 'x-admin-key': adminKey } : undefined

  const health = await runCheck(async () => {
    await $fetch(`${apiBaseUrl}/api/health`, {
      method: 'GET',
      timeout: 12000,
      retry: 0,
      headers
    })
  })

  const overview = await runCheck(async () => {
    await $fetch(`${apiBaseUrl}/api/admin/war-room/overview`, {
      method: 'GET',
      query: {
        tenantId,
        range: '7d',
        groupBy: 'bairro',
        horizon: 7
      },
      timeout: 15000,
      retry: 0,
      headers
    })
  })

  return {
    ok: health.ok && overview.ok,
    apiBaseUrl,
    tenantId,
    checks: {
      health,
      overview
    },
    timestamp: new Date().toISOString()
  }
})

