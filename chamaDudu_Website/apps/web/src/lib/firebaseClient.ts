import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics'

let firebaseApp: FirebaseApp | null = null
let firebaseAnalytics: Analytics | null = null

function getRuntimeFirebaseConfig() {
  const config = useRuntimeConfig()
  return {
    apiKey: String(config.public.firebaseApiKey || '').trim(),
    authDomain: String(config.public.firebaseAuthDomain || '').trim(),
    projectId: String(config.public.firebaseProjectId || '').trim(),
    storageBucket: String(config.public.firebaseStorageBucket || '').trim(),
    messagingSenderId: String(config.public.firebaseMessagingSenderId || '').trim(),
    appId: String(config.public.firebaseAppId || '').trim(),
    measurementId: String(config.public.firebaseMeasurementId || '').trim()
  }
}

function hasMinimalFirebaseConfig(config: ReturnType<typeof getRuntimeFirebaseConfig>): boolean {
  return Boolean(config.apiKey && config.projectId && config.appId)
}

export function getFirebaseClient(): { app: FirebaseApp | null; analytics: Analytics | null } {
  const firebaseConfig = getRuntimeFirebaseConfig()
  if (!hasMinimalFirebaseConfig(firebaseConfig)) {
    return { app: null, analytics: null }
  }

  if (!firebaseApp) {
    firebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
  }

  return { app: firebaseApp, analytics: firebaseAnalytics }
}

export async function initFirebaseAnalytics(): Promise<void> {
  if (!import.meta.client) return
  if (firebaseAnalytics) return

  const { app } = getFirebaseClient()
  if (!app) return

  const supported = await isSupported().catch(() => false)
  if (!supported) return
  firebaseAnalytics = getAnalytics(app)
}
