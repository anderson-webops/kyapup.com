import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const require = createRequire(import.meta.url)
const axeSourcePath = require.resolve('axe-core/axe.min.js')
const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const frontendPackagePath = resolve(projectRoot, 'front-end/package.json')
const frontendPackage = JSON.parse(readFileSync(frontendPackagePath, 'utf8'))

const siteName = 'Vitesse Nuxt Template'
const frontendKind = 'nuxt'
const frontendPort = Number(process.env.A11Y_FRONTEND_PORT || 3356)
const apiPort = Number(process.env.A11Y_API_PORT || 3056)
const baseUrl = `http://127.0.0.1:${frontendPort}`
const apiUrl = `http://127.0.0.1:${apiPort}/api`
const routes = [
  '/',
  '/hi/a11y',
]
const colorSchemes = (process.env.A11Y_COLOR_SCHEMES || 'light,dark')
  .split(',')
  .map(scheme => scheme.trim())
  .filter(Boolean)

const chromeCandidates = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean)

const chromePath = chromeCandidates.find(candidate => existsSync(candidate))
if (chromePath)
  process.env.PUPPETEER_EXECUTABLE_PATH = chromePath

function writeServerLine(prefix, data) {
  const text = data.toString().trim()
  if (text)
    process.stderr.write(`[${prefix}] ${text}\n`)
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': baseUrl,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  })
  res.end(JSON.stringify(body))
}

function emptyCollection() {
  return {
    items: [],
    results: [],
    data: [],
    records: [],
    total: 0,
  }
}

function responseFor(url) {
  const pathname = url.pathname.replace(/\/+/g, '/')
  if (pathname.endsWith('/pageview'))
    return { pageview: 0, startAt: Date.now() }
  if (pathname.includes('/session'))
    return { authenticated: false, user: null, admin: null }
  if (pathname.includes('/auth') || pathname.includes('/login'))
    return { authenticated: false, user: null, token: '' }
  if (pathname.includes('/me') || pathname.includes('/account'))
    return { user: null, authenticated: false }
  if (pathname.includes('/quotes'))
    return []
  if (pathname.includes('/availability')) {
    const start = new Date(Date.now() + 24 * 60 * 60_000)
    start.setMinutes(0, 0, 0)
    const end = new Date(start.getTime() + 60 * 60_000)
    return [{ id: 'a11y-slot', title: 'Available', start: start.toISOString(), end: end.toISOString() }]
  }
  if (pathname.includes('/topics'))
    return { topics: [], claims: [], ...emptyCollection() }
  if (pathname.includes('/claims'))
    return { claims: [], ...emptyCollection() }
  if (pathname.includes('/search'))
    return { query: url.searchParams.get('q') || '', ...emptyCollection() }
  if (pathname.includes('/submissions') || pathname.includes('/board') || pathname.includes('/items'))
    return emptyCollection()
  if (pathname.includes('/service-directory'))
    return { services: [], categories: [], ...emptyCollection() }
  if (pathname.includes('/elections'))
    return { elections: [], ...emptyCollection() }
  if (pathname.includes('/jurisdictions') || pathname.includes('/locations') || pathname.includes('/districts'))
    return { jurisdictions: [], locations: [], districts: [], ...emptyCollection() }
  if (pathname.includes('/representatives') || pathname.includes('/candidate'))
    return { representatives: [], candidates: [], ...emptyCollection() }
  if (pathname.includes('/sources'))
    return { sources: [], ...emptyCollection() }
  if (pathname.includes('/products'))
    return []
  if (pathname.includes('/contact') || pathname.includes('/cart') || pathname.includes('/orders'))
    return { ok: true }
  return { ok: true, ...emptyCollection() }
}

function createMockApiServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${apiPort}`)
    if (req.method === 'OPTIONS') {
      sendJson(res, {}, 204)
      return
    }
    sendJson(res, responseFor(url))
  })
}

async function listen(server, port) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolveListen)
  })
}

async function waitForHttp(url, timeoutMs = 45_000) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok)
        return
      lastError = new Error(`${url} returned ${response.status}`)
    }
    catch (error) {
      lastError = error
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 400))
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

function startFrontend() {
  const isNuxt = frontendKind === 'nuxt' || Object.values(frontendPackage.scripts || {}).some(script => String(script).includes('nuxt'))
  const args = isNuxt
    ? ['exec', '-w', 'front-end', '--', 'nuxt', 'dev', '--host', '127.0.0.1', '--port', String(frontendPort)]
    : ['exec', '-w', 'front-end', '--', 'vite', '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort']

  const child = spawn('npm', args, {
    cwd: projectRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      BROWSER: 'none',
      DISABLE_ANALYTICS: 'true',
      DEV_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
      NUXT_A11Y_SCAN: 'true',
      NUXT_TELEMETRY_DISABLED: '1',
      NUXT_PUBLIC_APP_URL: baseUrl,
      NUXT_PUBLIC_SITE_URL: baseUrl,
      NUXT_PUBLIC_API_BASE: apiUrl,
      NUXT_PUBLIC_API_BASE_URL: apiUrl,
      PUBLIC_API_BASE: apiUrl,
      INTERNAL_API_BASE: apiUrl,
      API_INTERNAL_BASE: apiUrl,
      ADMIN_API_BASE: apiUrl,
      NUXT_ADMIN_API_BASE: apiUrl,
      ADMIN_API_KEY: 'a11y-smoke',
      NUXT_ADMIN_API_KEY: 'a11y-smoke',
      ADMIN_SESSION_SECRET: 'a11y-smoke-session-secret',
      NUXT_ADMIN_SESSION_SECRET: 'a11y-smoke-session-secret',
      NUXT_SESSION_SIGNING_SECRET: 'a11y-smoke-session-secret',
      SESSION_SIGNING_SECRET: 'a11y-smoke-session-secret',
      NUXT_PUBLIC_BACKEND_MODE: 'mock',
      NUXT_PUBLIC_BILLING_MODE: 'mock',
      NUXT_PUBLIC_ENABLE_DEMO_ACCESS: 'true',
      NUXT_PUBLIC_FEATURE_INVESTMENT_MODULE: 'true',
      NUXT_PUBLIC_PORTAL_URL: baseUrl,
      VITE_API_BASE_URL: apiUrl,
      VITE_API_URL: apiUrl,
      VITE_SSG_API_BASE_URL: apiUrl,
      VITE_PUBLIC_SITE_ORIGIN: baseUrl,
      VITE_SHOW_AD_SLOTS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', data => writeServerLine(isNuxt ? 'nuxt' : 'vite', data))
  child.stderr.on('data', data => writeServerLine(isNuxt ? 'nuxt' : 'vite', data))
  return child
}

function delay(durationMs) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, durationMs))
}

function signalProcessTree(child, signal) {
  if (!child.pid)
    return false

  try {
    if (process.platform === 'win32')
      return child.kill(signal)

    process.kill(-child.pid, signal)
    return true
  }
  catch (error) {
    if (error?.code === 'ESRCH')
      return false
    throw error
  }
}

async function stopProcessTree(child) {
  if (!child.pid)
    return

  signalProcessTree(child, 'SIGTERM')
  await delay(1_000)

  if (process.platform === 'win32') {
    if (child.exitCode === null)
      signalProcessTree(child, 'SIGKILL')
  }
  else {
    try {
      process.kill(-child.pid, 0)
      signalProcessTree(child, 'SIGKILL')
    }
    catch (error) {
      if (error?.code !== 'ESRCH')
        throw error
    }
  }

  await Promise.race([
    new Promise(resolveClose => child.once('close', resolveClose)),
    delay(1_000),
  ])
}

function closeServer(server) {
  return new Promise(resolveClose => server.close(resolveClose))
}

async function analyzePage(browser, route, scheme) {
  const url = `${baseUrl}${route}`
  const page = await browser.newPage()
  page.setDefaultTimeout(30_000)
  await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 1 })
  if (scheme === 'dark' || scheme === 'light') {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }])
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 8_000 }).catch(() => {})
  await page.addScriptTag({ path: axeSourcePath })
  const result = await page.evaluate(async () => {
    return await globalThis.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa'],
      },
    })
  })
  await page.close()
  return {
    url,
    scheme,
    violations: result.violations.filter(violation => violation.id !== 'frame-tested'),
  }
}

const apiServer = createMockApiServer()
const frontendProcess = startFrontend()
let browser

try {
  await listen(apiServer, apiPort)
  await waitForHttp(baseUrl)

  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  const failures = []
  for (const route of routes) {
    for (const scheme of colorSchemes) {
      const result = await analyzePage(browser, route, scheme)
      if (result.violations.length) {
        failures.push(result)
        continue
      }
      console.log(`a11y ok: ${result.url} [${scheme}]`)
    }
  }

  if (failures.length) {
    for (const failure of failures) {
      console.error(`\nAccessibility issues for ${siteName} at ${failure.url} [${failure.scheme}]`)
      for (const violation of failure.violations) {
        console.error(`- [${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}`)
        console.error(`  ${violation.helpUrl}`)
        for (const node of violation.nodes) {
          console.error(`  ${node.target.join(', ')}`)
        }
      }
    }
    process.exitCode = 1
  }
}
finally {
  if (browser)
    await browser.close()
  await stopProcessTree(frontendProcess)
  await closeServer(apiServer)
}
