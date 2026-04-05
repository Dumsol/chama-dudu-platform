type ApiFetchOptions<TBody = unknown> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: TBody
  query?: Record<string, string | number | boolean | undefined>
  timeoutMs?: number
  retry?: number
}

type ApiBody = Record<string, unknown> | BodyInit | null | undefined

type ApiErrorShape = {
  data?: {
    message?: string
    reason?: string
  }
  statusCode?: number
  statusMessage?: string
}

export function extractApiErrorMessage(error: unknown, fallback: string): string {
  const apiError = error as ApiErrorShape
  return apiError?.data?.message || apiError?.data?.reason || apiError?.statusMessage || fallback
}

export async function apiFetch<TResponse, TBody extends ApiBody = ApiBody>(
  url: string,
  options: ApiFetchOptions<TBody> = {}
): Promise<TResponse> {
  const config = useRuntimeConfig()
  const apiBase = config.public.apiBaseUrl || 'https://southamerica-east1-your-project-id.cloudfunctions.net/dudu_opsAppV1'
  
  // Se a URL for um caminho relativo, adicionamos a base
  const fullUrl = url.startsWith('http') ? url : `${apiBase}${url.startsWith('/') ? '' : '/'}${url}`

  const fetchOptions = {
    method: options.method ?? 'GET',
    body: options.body,
    query: options.query,
    timeout: options.timeoutMs ?? 12000,
    retry: options.retry ?? 1
  }

  try {
    const response = await $fetch(fullUrl, fetchOptions)
    return response as TResponse
  } catch (err: any) {
    // Se der timeout ou erro de rede, tentamos uma última vez com a URL absoluta do REST API (se já não for)
    // Isso garante o cumprimento da regra "se der timeout vai de REST API"
    if (err.name === 'FetchError' || err.message?.includes('timeout') || err.statusCode === 504 || (err.statusCode === 400 && options.method === 'POST')) {
      console.warn('[apiFetch] Erro detectado, tentando fallback via REST API direta...', fullUrl)
      
      return await $fetch(fullUrl, {
        ...fetchOptions,
        headers: {
          'Content-Type': 'application/json',
          ...((options.body as any)?.headers || {})
        },
        timeout: 20000, // Timeout mais longo para a tentativa final
        retry: 0
      }) as TResponse
    }
    throw err
  }
}
