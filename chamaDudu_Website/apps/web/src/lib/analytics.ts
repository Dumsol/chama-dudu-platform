export async function initAnalytics(): Promise<void> {
  const config = useRuntimeConfig()
  const analyticsId = String(config.public.analyticsId ?? '').trim()
  if (!analyticsId && !config.public.firebaseMeasurementId) return

  const { initFirebaseAnalytics } = await import('~/lib/firebaseClient')
  await initFirebaseAnalytics()
}
