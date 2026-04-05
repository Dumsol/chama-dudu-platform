import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT || 4173)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: {
    timeout: 8_000
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: `npm run dev -- --port ${port} --host 127.0.0.1`,
    port,
    reuseExistingServer: true,
    timeout: 900_000,
    env: {
      NUXT_PUBLIC_DEFAULT_TENANT_ID: 'tenant-e2e',
      NUXT_PUBLIC_API_BASE_URL: `${baseURL}/api/_mock-backend`,
      NUXT_PUBLIC_SITE_URL: baseURL,
      ADMIN_PASSWORD: 'playwright-admin',
      DEPOSIT_TOKEN_SALT: 'playwright-salt'
    }
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] }
    }
  ]
})

