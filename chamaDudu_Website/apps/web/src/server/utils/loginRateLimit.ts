import type { H3Event } from 'h3'

type Bucket = {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

function getIp(event: H3Event): string {
  const forwarded = String(getRequestHeader(event, 'x-forwarded-for') || '')
    .split(',')[0]
    .trim()
  if (forwarded) return forwarded
  return getRequestIP(event, { xForwardedFor: true }) || 'unknown'
}

export function enforceLoginRateLimit(event: H3Event, scope: 'admin' | 'deposito'): void {
  const now = Date.now()
  const windowMs = 10 * 60 * 1000
  const maxAttempts = 10
  const key = `${scope}:${getIp(event)}`
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return
  }

  bucket.count += 1
  if (bucket.count > maxAttempts) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Muitas tentativas',
      data: {
        message: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.'
      }
    })
  }
}

export function logLoginAttempt(scope: 'admin' | 'deposito', success: boolean, meta?: Record<string, unknown>): void {
  const payload = {
    scope,
    success,
    timestamp: new Date().toISOString(),
    ...meta
  }
  if (success) {
    console.info('[AUTH_LOGIN]', payload)
  } else {
    console.warn('[AUTH_LOGIN]', payload)
  }
}
