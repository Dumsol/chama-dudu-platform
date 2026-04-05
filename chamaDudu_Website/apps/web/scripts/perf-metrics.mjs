import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { resolve, join } from 'node:path'
import { gzipSync } from 'node:zlib'

const cwd = resolve(process.cwd())
const enforce = process.argv.includes('--enforce')
const DEV_PORT = Number(process.env.PERF_DEV_PORT || '4177')

const BUDGET = {
  buildMs: Number(process.env.PERF_BUDGET_BUILD_MS || '75000'),
  maxChunkRawBytes: Number(process.env.PERF_BUDGET_MAX_CHUNK_RAW_BYTES || String(170 * 1024)),
  maxHeroBytes: Number(process.env.PERF_BUDGET_MAX_HERO_BYTES || String(120 * 1024))
}

function safeKill(child) {
  if (!child?.pid) return Promise.resolve()
  if (process.platform === 'win32') {
    return new Promise((resolveKill) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        cwd,
        shell: false,
        env: process.env,
        stdio: 'ignore'
      })
      killer.on('error', () => resolveKill())
      killer.on('close', () => resolveKill())
    })
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // ignore best-effort kill failures
  }
  return Promise.resolve()
}

function spawnNpm(args) {
  if (process.platform === 'win32') {
    const command = ['npm.cmd', ...args].join(' ')
    return spawn('cmd.exe', ['/d', '/s', '/c', command], {
      cwd,
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  }

  return spawn('npm', args, {
    cwd,
    shell: false,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

function runCommand(args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const start = Date.now()
    const child = spawnNpm(args)

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      const text = String(chunk)
      stdout += text
      opts.onStdout?.(text, child)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', rejectRun)
    child.on('close', (code) => {
      resolveRun({
        code: code ?? 1,
        ms: Date.now() - start,
        stdout,
        stderr
      })
    })
  })
}

async function measureDevReady() {
  return new Promise((resolveDev, rejectDev) => {
    const start = Date.now()
    const child = spawnNpm(['run', 'dev', '--', '--port', String(DEV_PORT), '--host', '127.0.0.1'])

    let done = false
    const timeout = setTimeout(() => {
      if (done) return
      done = true
      safeKill(child).finally(() => rejectDev(new Error('dev_ready_timeout')))
    }, 90000)

    const checkReady = (chunk) => {
      if (done) return
      const text = String(chunk)
      if (text.includes('Local:') || text.includes('? Local')) {
        done = true
        clearTimeout(timeout)
        const ms = Date.now() - start
        safeKill(child).finally(() => resolveDev(ms))
      }
    }

    child.stdout.on('data', checkReady)
    child.stderr.on('data', checkReady)
    child.on('error', (error) => {
      if (done) return
      done = true
      clearTimeout(timeout)
      rejectDev(error)
    })
    child.on('close', (code) => {
      if (!done && code !== 0) {
        done = true
        clearTimeout(timeout)
        rejectDev(new Error(`dev_exit_${code}`))
      }
    })
  })
}

async function listTopClientChunks() {
  const dir = join(cwd, '.nuxt', 'dist', 'client', '_nuxt')
  let files = []
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  const rows = []
  for (const file of files) {
    if (!file.endsWith('.js')) continue
    const full = join(dir, file)
    const content = await fs.readFile(full)
    rows.push({
      file,
      rawBytes: content.byteLength,
      gzipBytes: gzipSync(content).byteLength
    })
  }
  return rows.sort((a, b) => b.rawBytes - a.rawBytes).slice(0, 10)
}

async function listTopPublicImages() {
  const dir = join(cwd, 'public', 'images')
  let files = []
  try {
    files = await fs.readdir(dir)
  } catch {
    return []
  }
  const rows = []
  for (const file of files) {
    const full = join(dir, file)
    const stat = await fs.stat(full)
    if (!stat.isFile()) continue
    rows.push({
      file,
      bytes: stat.size
    })
  }
  return rows.sort((a, b) => b.bytes - a.bytes)
}

function kb(bytes) {
  return Number((bytes / 1024).toFixed(1))
}

function parseNuxtBuildMs(output) {
  const lineMatch = output.match(/\[nuxt\]\s+build:done:\s+([0-9]+):([0-9]+\.[0-9]+)/)
  if (!lineMatch) return null
  const minutes = Number(lineMatch[1])
  const seconds = Number(lineMatch[2])
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null
  return Math.round((minutes * 60 + seconds) * 1000)
}

async function main() {
  let devReadyMs = null
  try {
    devReadyMs = await measureDevReady()
  } catch (error) {
    console.warn('perf-metrics warning: dev ready metric unavailable', error instanceof Error ? error.message : String(error))
  }

  const build = await runCommand(['run', 'build'])
  if (build.code !== 0) {
    throw new Error(`build_failed: ${build.stderr || build.stdout}`)
  }
  const parsedBuildMs = parseNuxtBuildMs(`${build.stdout}\n${build.stderr}`)

  const lint = await runCommand(['run', 'lint'])
  if (lint.code !== 0) {
    throw new Error(`lint_failed: ${lint.stderr || lint.stdout}`)
  }

  const chunks = await listTopClientChunks()
  const images = await listTopPublicImages()
  const topImages = images.slice(0, 10)
  const maxChunk = chunks[0]?.rawBytes ?? 0
  const heroCandidates = images.filter((item) => item.file.includes('hero-mascot') || item.file.includes('hero-right'))
  const smallestHero = heroCandidates.reduce((acc, item) => Math.min(acc, item.bytes), Number.POSITIVE_INFINITY)
  const heroTransfer = Number.isFinite(smallestHero) ? smallestHero : 0

  const report = {
    timestamp: new Date().toISOString(),
    budget: BUDGET,
    metrics: {
      devReadyMs,
      buildMs: parsedBuildMs ?? build.ms,
      buildWallMs: build.ms,
      lintMs: lint.ms,
      maxChunkRawBytes: maxChunk,
      heroTransferBytes: heroTransfer
    },
    topChunks: chunks.map((item) => ({
      file: item.file,
      rawKB: kb(item.rawBytes),
      gzipKB: kb(item.gzipBytes)
    })),
    topImages: topImages.map((item) => ({
      file: item.file,
      sizeKB: kb(item.bytes)
    }))
  }

  const budgetFailures = []
  if (report.metrics.buildMs > BUDGET.buildMs) budgetFailures.push('buildMs')
  if (report.metrics.maxChunkRawBytes > BUDGET.maxChunkRawBytes) budgetFailures.push('maxChunkRawBytes')
  if (report.metrics.heroTransferBytes > BUDGET.maxHeroBytes) budgetFailures.push('heroTransferBytes')

  console.log(JSON.stringify({ ...report, budgetFailures }, null, 2))
  if (enforce && budgetFailures.length) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('perf-metrics failed', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
