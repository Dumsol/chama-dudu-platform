import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from '@playwright/test'

const port = Number(process.env.HERO_CAPTURE_PORT || 4175)
const baseUrl = `http://127.0.0.1:${port}`
const outDir = path.join(process.cwd(), 'tests', 'screenshots', 'fit-check')

async function waitForServer(url, timeoutMs = 900000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // keep polling until server is ready
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Server nao respondeu em ${timeoutMs}ms`)
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

const proc = spawn('cmd', ['/c', `pnpm build && pnpm preview --port ${port} --host 127.0.0.1`], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: {
    ...process.env,
    NUXT_PUBLIC_DEFAULT_TENANT_ID: 'tenant-e2e',
    NUXT_PUBLIC_API_BASE_URL: `${baseUrl}/api/_mock-backend`,
    NUXT_PUBLIC_SITE_URL: baseUrl
  }
})

const run = async () => {
  await waitForServer(baseUrl)
  const browser = await chromium.launch()

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const desktopPage = await desktop.newPage()
  await desktopPage.goto(baseUrl, { waitUntil: 'networkidle' })
  await desktopPage.screenshot({ path: path.join(outDir, 'desktop-home-after.png'), fullPage: false })
  await desktop.close()

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mobilePage = await mobile.newPage()
  await mobilePage.goto(baseUrl, { waitUntil: 'networkidle' })
  await mobilePage.screenshot({ path: path.join(outDir, 'mobile-home-after.png'), fullPage: false })
  await mobile.close()

  await browser.close()
}

run()
  .then(() => {
    proc.kill()
  })
  .catch((error) => {
    proc.kill()
    console.error(error)
    process.exit(1)
  })
