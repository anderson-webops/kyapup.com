import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'
import puppeteer from 'puppeteer-core'

const require = createRequire(import.meta.url)
const axeSourcePath = require.resolve('axe-core/axe.min.js')
const projectRoot = resolve(import.meta.dirname, '..')
const chromePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean).find(candidate => existsSync(candidate))
const colorSchemes = (process.env.A11Y_COLOR_SCHEMES || 'light,dark').split(',').map(value => value.trim()).filter(Boolean)
const viewports = [
  { name: 'desktop', width: 1280, height: 1000, deviceScaleFactor: 1 },
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
]
const fixturePhotos = Array.from({ length: 7 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  alt: `Kya in synthetic photo ${index + 1}`,
  width: 960,
  height: 720,
  visible: index < 6,
  featured: index < 2,
  position: index,
  createdAt: '2026-09-24T12:00:00Z',
  thumbnailUrl: `/api/media/fixture-${index + 1}/thumb.webp`,
  url: `/api/media/fixture-${index + 1}/full.webp`,
}))
const fixtureSettings = { mode: 'cycle', intervalSeconds: 8, heroPhotoId: fixturePhotos[0].id }

async function availablePort() {
  if (process.env.A11Y_FRONTEND_PORT)
    return Number(process.env.A11Y_FRONTEND_PORT)
  const server = net.createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const port = server.address().port
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return port
}

const externalFrontend = process.env.A11Y_BASE_URL ? new URL(process.env.A11Y_BASE_URL) : null
if (externalFrontend) {
  assert.equal(externalFrontend.protocol, 'http:', 'An external accessibility frontend must use local HTTP')
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(externalFrontend.hostname), 'Accessibility fixtures may only run on loopback')
}
const frontendPort = externalFrontend ? Number(externalFrontend.port) : await availablePort()
const baseUrl = externalFrontend?.origin || `http://127.0.0.1:${frontendPort}`
function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}

function startFrontend() {
  const child = spawn('npm', ['exec', '-w', 'front-end', '--', 'nuxt', 'dev', '--host', '127.0.0.1', '--port', String(frontendPort)], {
    cwd: projectRoot,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      BROWSER: 'none',
      NUXT_A11Y_SCAN: 'true',
      NUXT_TELEMETRY_DISABLED: '1',
      // Browser interception supplies every API response. Never reach a real library.
      DEV_API_ORIGIN: 'http://127.0.0.1:1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => {
      const line = data.toString().trim()
      if (line)
        process.stderr.write(`[nuxt] ${line}\n`)
    })
  }
  return child
}

async function waitForFrontend(child) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null)
      throw new Error('Accessibility frontend exited before it became ready')
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2000) })
      await response.arrayBuffer()
      if (response.ok)
        return
    }
    catch {}
    await delay(300)
  }
  throw new Error('Accessibility frontend did not become ready')
}

function signalProcessTree(child, signal) {
  if (!child.pid)
    return
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal)
  }
  catch (error) {
    if (error?.code !== 'ESRCH')
      throw error
  }
}
async function stopFrontend(child) {
  signalProcessTree(child, 'SIGTERM')
  await delay(1000)
  signalProcessTree(child, 'SIGKILL')
  await Promise.race([new Promise(resolveClose => child.once('close', resolveClose)), delay(1000)])
}

const failures = []
async function newFixturePage(browser, viewport, scheme, empty = false) {
  const page = await browser.newPage()
  page.setDefaultTimeout(30_000)
  const { name, ...size } = viewport
  await page.setViewport(size)
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: scheme },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ])
  let authenticated = false
  let settings = { ...fixtureSettings }
  const photos = empty ? [] : structuredClone(fixturePhotos)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', async (request) => {
    const url = new URL(request.url())
    if (url.origin !== baseUrl || !url.pathname.startsWith('/api/')) {
      await request.continue()
      return
    }
    const headers = { 'cache-control': 'no-store', 'cross-origin-resource-policy': 'same-origin' }
    const json = (body, status = 200) => request.respond({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })
    const session = () => ({ authenticated, ...(authenticated ? { csrfToken: 'synthetic-accessibility-token' } : {}) })
    if (url.pathname.startsWith('/api/media/')) {
      await request.respond({ status: 200, contentType: 'image/svg+xml', headers, body: '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="720" viewBox="0 0 960 720"><rect width="960" height="720" fill="#42634e"/><circle cx="480" cy="360" r="190" fill="#cba87a"/><ellipse cx="430" cy="330" rx="18" ry="24" fill="#23382d"/><ellipse cx="540" cy="330" rx="18" ry="24" fill="#23382d"/></svg>' })
      return
    }
    if (url.pathname === '/api/gallery') {
      await json({ photos: photos.filter(photo => photo.visible), settings })
      return
    }
    if (url.pathname === '/api/admin/session') {
      await json(session())
      return
    }
    if (url.pathname === '/api/admin/login') {
      authenticated = true
      await json(session())
      return
    }
    if (url.pathname === '/api/admin/logout') {
      authenticated = false
      await json(session())
      return
    }
    if (url.pathname === '/api/admin/library') {
      await json({ photos, settings }, authenticated ? 200 : 401)
      return
    }
    if (url.pathname === '/api/admin/settings' && request.method() === 'PATCH') {
      settings = { ...settings, ...JSON.parse(request.postData() || '{}') }
      await json(settings)
      return
    }
    errors.push(`Unexpected fixture API request: ${request.method()} ${url.pathname}`)
    await json({ error: 'not_found' }, 404)
  })
  async function navigate(route) {
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('main') && !document.querySelector('main[aria-busy="true"]'))
    await page.addScriptTag({ path: axeSourcePath })
  }
  async function scan(state) {
    // Wait for Vue's enabled controls and browser paint before measuring contrast.
    await page.evaluate(() => new Promise(resolvePaint => requestAnimationFrame(() => requestAnimationFrame(resolvePaint))))
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(Array.from(document.images).filter(image => image.loading !== 'lazy').map(image => image.decode().catch(() => {})))
    })
    const violations = await page.evaluate(async () => (await globalThis.axe.run(document, {
      resultTypes: ['violations'],
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })).violations)
    const result = { state, viewport: name, scheme, url: page.url(), violations, errors: [...errors] }
    if (violations.length || errors.length)
      failures.push(result)
    else console.log(`a11y ok: ${state} [${name}, ${scheme}]`)
  }
  return { page, navigate, scan }
}

async function publicChecks(browser, viewport, scheme) {
  const empty = await newFixturePage(browser, viewport, scheme, true)
  try {
    await empty.navigate('/')
    await empty.page.waitForSelector('.gallery-empty')
    await empty.scan('public empty gallery')
  }
  finally { await empty.page.close() }

  const gallery = await newFixturePage(browser, viewport, scheme)
  try {
    await gallery.navigate('/')
    await gallery.page.waitForSelector('.hero-tile img')
    await gallery.scan('public gallery and slideshow controls')
    await gallery.page.focus('.hero-tile')
    await gallery.page.keyboard.press('Enter')
    await gallery.page.waitForSelector('.lightbox[open] img')
    await gallery.scan('photo lightbox')
    const before = await gallery.page.$eval('.lightbox[open] img', image => image.alt)
    await gallery.page.keyboard.press('ArrowRight')
    await gallery.page.waitForFunction(previous => document.querySelector('.lightbox[open] img')?.alt !== previous, {}, before)
    await gallery.page.keyboard.press('Escape')
    await gallery.page.waitForFunction(() => !document.querySelector('.lightbox[open]'))
    assert.equal(await gallery.page.$eval('.hero-tile', element => element === document.activeElement), true, 'Closing the lightbox must restore keyboard focus')
  }
  finally { await gallery.page.close() }
}

async function adminChecks(browser, viewport, scheme) {
  const admin = await newFixturePage(browser, viewport, scheme)
  try {
    await admin.navigate('/admin')
    await admin.page.waitForSelector('#password')
    await admin.scan('admin sign in')
    await admin.page.type('#password', 'Synthetic-accessibility-password')
    await admin.page.click('.sign-in form button')
    await admin.page.waitForSelector('.admin-grid .photo-card')
    await admin.page.waitForSelector('.page-heading .primary-button:not(:disabled)')
    // Disabled controls use reduced opacity. Wait for their computed enabled
    // appearance as well as Vue's attributes before axe snapshots the colors.
    await admin.page.waitForFunction(() => Array.from(document.querySelectorAll('.header-actions button, .page-heading button, .filter-tabs button'))
      .every(button => !button.disabled && getComputedStyle(button).opacity === '1'))
    await admin.scan('admin photo library and spotlight')
    await admin.page.click('.filter-tabs button:nth-child(2)')
    await admin.page.waitForFunction(() => document.querySelectorAll('.photo-card').length === 1)
    await admin.page.click('.photo-select input')
    await admin.page.waitForSelector('.selection-bar')
    await admin.scan('admin archive and selection')
    await admin.page.click('.details-button')
    await admin.page.waitForSelector('.details-dialog[open]')
    await admin.scan('admin photo description dialog')
    await admin.page.keyboard.press('Escape')
  }
  finally { await admin.page.close() }
}

const frontendProcess = externalFrontend ? null : startFrontend()
let browser
try {
  await waitForFrontend(frontendProcess)
  browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  for (const viewport of viewports) {
    for (const scheme of colorSchemes) {
      await publicChecks(browser, viewport, scheme)
      await adminChecks(browser, viewport, scheme)
    }
  }
  for (const failure of failures) {
    console.error(`\nAccessibility issues: ${failure.state} [${failure.viewport}, ${failure.scheme}]`)
    for (const error of failure.errors) console.error(`- Browser error: ${error}`)
    for (const violation of failure.violations) {
      console.error(`- [${violation.impact}] ${violation.id}: ${violation.help}`)
      for (const node of violation.nodes) {
        console.error(`  ${node.target.join(', ')}`)
        console.error(`  ${node.failureSummary}`)
      }
    }
  }
  if (failures.length)
    process.exitCode = 1
}
finally {
  if (browser)
    await browser.close()
  if (frontendProcess)
    await stopFrontend(frontendProcess)
}
