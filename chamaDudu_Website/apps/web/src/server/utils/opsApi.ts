import type { H3Event } from 'h3'

function resolveApiBaseUrl(config: ReturnType<typeof useRuntimeConfig>): string {
  const explicit = String(config.public.apiBaseUrl ?? '').trim()
  if (explicit) return explicit.replace(/\/$/, '')
  return 'https://southamerica-east1-your-project-id.cloudfunctions.net/dudu_opsAppV1'
}

function isRelativeBaseUrl(baseUrl: string): boolean {
  return baseUrl.startsWith('/')
}

function isMockBackendBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes('/api/_mock-backend')
}

export function resolveTenantIdFromConfig(config: ReturnType<typeof useRuntimeConfig>): string {
  return String(config.public.defaultTenantId ?? '').trim() || 'app'
}

export async function opsAdminFetch<T>(
  event: H3Event,
  path: string,
  options: {
    method?: 'GET' | 'POST'
    query?: Record<string, string | number | undefined>
    body?: unknown
  } = {}
): Promise<T> {
  const config = useRuntimeConfig(event)
  const baseUrl = resolveApiBaseUrl(config)
  const adminKey = String(config.opsAdminApiKey ?? '').trim()
  if (!isRelativeBaseUrl(baseUrl) && !isMockBackendBaseUrl(baseUrl) && !adminKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Configuracao ausente',
      data: { message: 'OPS_ADMIN_API_KEY nao configurado.' }
    })
  }
  const queryParams = new URLSearchParams()
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value == null) continue
    queryParams.set(key, String(value))
  }
  const query = queryParams.size ? `?${queryParams.toString()}` : ''

  const response = await $fetch(`${baseUrl}${path}${query}`, {
    method: options.method ?? 'GET',
    body: options.body as Record<string, unknown> | BodyInit | null | undefined,
    timeout: 15000,
    retry: 1,
    headers: adminKey ? { 'x-admin-key': adminKey } : undefined
  })
  return response as T
}
