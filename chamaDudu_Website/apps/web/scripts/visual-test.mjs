import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { chromium } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const port = process.env.NUXT_PREVIEW_PORT || '4173'
const rootDir = process.cwd()
const screenshotsDir = path.join(rootDir, 'tests', 'screenshots')
const referencePath = path.join(screenshotsDir, 'reference.png')
const currentPath = path.join(screenshotsDir, 'current.png')
const diffPath = path.join(screenshotsDir, 'diff.png')

const waitForServer = async (url, timeoutMs = 30000) => {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // wait for server
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Servidor nao respondeu em ${timeoutMs}ms.`)
}

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true })
}

if (!fs.existsSync(referencePath)) {
  throw new Error(`Reference nao encontrada em ${referencePath}.`)
}

const previewProcess = spawn('cmd', ['/c', 'pnpm', 'preview', '--port', port], {
  cwd: rootDir,
  stdio: 'inherit'
})

const run = async () => {
  await waitForServer(`http://localhost:${port}`)

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  })
  const page = await context.newPage()
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: currentPath })
  await browser.close()

  const img1 = PNG.sync.read(fs.readFileSync(referencePath))
  const img2 = PNG.sync.read(fs.readFileSync(currentPath))

  if (img1.width !== img2.width || img1.height !== img2.height) {
    throw new Error('Reference e screenshot possuem tamanhos diferentes.')
  }

  const diff = new PNG({ width: img1.width, height: img1.height })
  const diffPixels = pixelmatch(img1.data, img2.data, diff.data, img1.width, img1.height, {
    threshold: 0.05
  })
  fs.writeFileSync(diffPath, PNG.sync.write(diff))
  const diffRatio = diffPixels / (img1.width * img1.height)

  console.log(`Diff ratio: ${(diffRatio * 100).toFixed(2)}%`)

  if (diffRatio > 0.05) {
    throw new Error('Diff acima do limite configurado.')
  }
}

run()
  .then(() => {
    previewProcess.kill()
  })
  .catch((error) => {
    previewProcess.kill()
    console.error(error)
    process.exit(1)
  })
