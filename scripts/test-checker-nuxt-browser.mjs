import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import puppeteer from 'puppeteer-core'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const metadata = require('nuxt/package.json')

const cli = path.resolve(path.dirname(require.resolve('nuxt/package.json')), metadata.bin.nuxt)
const executablePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(filename => filename && existsSync(filename))
assert.ok(executablePath, 'A real supported browser is required for Nuxt checker acceptance')
const parent = path.join(root, '.ai-work/runs')
await mkdir(parent, { recursive: true })
const scratch = await mkdtemp(path.join(parent, 'checker-nuxt-'))
const application = path.join(scratch, 'application')
const source = path.join(application, 'app.vue')
let child
let browser
let output = ''
let phase = 'setup'

function pageSource(value) {
  return `<script setup lang="ts">const count:number=${value}</script><template><output id="count">{{count}}</output></template>`
}

function start(argumentsList, environment) {
  output = ''
  child = spawn(process.execPath, argumentsList, {
    cwd: application,
    detached: true,
    env: {
      ...process.env,
      NUXT_TELEMETRY_DISABLED: '1',
      XDG_CONFIG_HOME: path.join(scratch, 'config'),
      XDG_CACHE_HOME: path.join(scratch, 'cache'),
      NO_COLOR: '1',
      TEST: '',
      VITEST: '',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => { output = (output + chunk.toString()).slice(-200000) })
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 120000
  while (!await predicate()) {
    assert.equal(child.exitCode, null, `${label}: ${output}`)
    assert.equal(child.signalCode, null, `${label}: ${output}`)
    assert.ok(Date.now() < deadline, `${label}: ${output}`)
    await delay(100)
  }
}

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null)
    return
  const exited = once(child, 'exit')
  process.kill(-child.pid, 'SIGTERM')
  await Promise.race([
    exited,
    delay(5000),
  ])
  if (child.exitCode === null && child.signalCode === null) {
    process.kill(-child.pid, 'SIGKILL')
    await exited
  }
}

async function build() {
  start([cli, 'build', application], { CI: 'true', NODE_ENV: 'production' })
  await waitFor(() => child.exitCode !== null || child.signalCode !== null, 'Nuxt build completion')
  assert.equal(child.signalCode, null, output)
  assert.match(output, /CHECKER_NUXT_PARENT_ACTIVE/)
  return child.exitCode
}

async function waitForNuxtDiagnostic(page, source) {
  const errorButton = '[data-level="error"][data-on] button'
  const drawer = 'iframe[title="Problems"]'
  await page.waitForFunction(selector => Boolean(document.querySelector('[data-my-bad]')?.shadowRoot?.querySelector(selector)), {}, errorButton)
  if (!await page.evaluate(selector => Boolean(document.querySelector('[data-my-bad]')?.shadowRoot?.querySelector(selector)), drawer))
    await page.locator(`pierce/${errorButton}`).click()
  await page.waitForFunction(selector => Boolean(document.querySelector('[data-my-bad]')?.shadowRoot?.querySelector(selector)), {}, drawer)
  const handle = await page.evaluateHandle(selector => document.querySelector('[data-my-bad]').shadowRoot.querySelector(selector), drawer)
  try {
    const frame = await handle.asElement().contentFrame()
    assert.ok(frame, 'The actual Nuxt Problems panel must load')
    const diagnostic = await frame.waitForFunction(() => {
      const entries = document.querySelectorAll('button[data-action="select"]')
      return Array.from(entries).find(button => button.textContent.includes('not assignable') && button.textContent.includes('app.vue'))
    })
    try {
      await diagnostic.asElement().click()
    }
    finally {
      await diagnostic.dispose()
    }
    await frame.waitForFunction((expected) => {
      const report = document.querySelector('article.mb-report')
      return report?.querySelector('[data-message]')?.textContent.includes('not assignable')
        && report.textContent.includes(expected)
    }, {}, source)
    assert.equal(new URL(frame.url()).origin, new URL(page.url()).origin)
  }
  finally {
    await handle.dispose()
  }
}

async function waitForNuxtRecovery(page) {
  await page.waitForFunction(() => {
    const badge = document.querySelector('[data-my-bad]')?.shadowRoot
    return badge?.querySelector('[data-level="clear"][data-on]')?.textContent === 'All clear'
      && !badge.querySelector('[data-level="error"][data-on]')
  })
}

try {
  await mkdir(application)
  await writeFile(path.join(application, 'package.json'), JSON.stringify({ type: 'module', private: true }))
  await writeFile(path.join(application, 'tsconfig.json'), JSON.stringify({ extends: './.nuxt/tsconfig.json' }))
  await writeFile(path.join(application, 'nuxt.config.mjs'), `import assert from 'node:assert/strict';export default defineNuxtConfig({srcDir:'.',compatibilityDate:'2026-11-15',modulesDir:[${JSON.stringify(path.join(root, 'node_modules'))}],devtools:{enabled:false},typescript:{strict:true,typeCheck:true},app:{head:{link:[{rel:'icon',href:'data:,'}]}},modules:[function checkerAcceptance(options,nuxt){nuxt.hook('vite:configResolved',async(config,environment)=>{const plugins=(await Promise.all(config.plugins)).flat(Infinity);const active=plugins.some(plugin=>plugin?.name==='vite-plugin-checker');assert.equal(active,environment.isClient);if(active)console.log('CHECKER_NUXT_PARENT_ACTIVE')})}]})`)
  await writeFile(source, pageSource('"bad"'))
  const listener = net.createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = listener.address().port
  await new Promise((resolve, reject) => listener.close(error => error
    ? reject(error)
    : resolve()))
  const origin = `http://127.0.0.1:${port}`
  phase = 'Nuxt development with real type checking'
  start([
    cli,
    'dev',
    application,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--no-open',
  ], { CI: '', NODE_ENV: 'development' })
  await waitFor(async () => {
    if (!output.includes('CHECKER_NUXT_PARENT_ACTIVE'))
      return false
    try {
      return (await fetch(origin, {
        signal: AbortSignal.timeout(2000),
      })).ok
    }
    catch {
      return false
    }
  }, 'Nuxt development readiness')
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(scratch, 'browser'),
    args: process.platform === 'linux'
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : [],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const navigation = await page.goto(origin, { waitUntil: 'domcontentloaded' })
  assert.ok(navigation?.ok(), 'Nuxt must serve the checker fixture successfully')
  await page.waitForFunction(() => document.querySelector('#count')?.textContent === 'bad')
  phase = 'initial Nuxt browser diagnostic'
  await waitForNuxtDiagnostic(page, 'count:number="bad"')
  phase = 'Nuxt browser diagnostic after reload'
  const reloaded = await page.reload({ waitUntil: 'domcontentloaded' })
  assert.ok(reloaded?.ok(), 'The checker fixture must reload successfully')
  await page.waitForFunction(() => document.querySelector('#count')?.textContent === 'bad')
  await waitForNuxtDiagnostic(page, 'count:number="bad"')
  for (const value of ['2', '"second"', '3']) {
    phase = `Nuxt browser checker after edit ${value}`
    await writeFile(source, pageSource(value))
    await page.waitForFunction(expected => document.querySelector('#count')?.textContent === expected, {}, String(JSON.parse(value)))
    if (value === '"second"')
      await waitForNuxtDiagnostic(page, 'count:number="second"')
    else
      await waitForNuxtRecovery(page)
  }
  assert.deepEqual(errors, [])
  await browser.close()
  browser = undefined
  await stop()
  phase = 'Nuxt production type-error rejection'
  await writeFile(source, pageSource('"invalid-build"'))
  assert.equal(await build(), 2, output)
  assert.match(output, /TS2322/)
  assert.match(output, /app\.vue/)
  phase = 'Nuxt production repaired build'
  await writeFile(source, pageSource('4'))
  assert.equal(await build(), 0, output)
  const publicRoot = path.join(application, '.output/public')
  for (const filename of await readdir(publicRoot, { recursive: true })) {
    if (/\.(?:js|mjs|html)$/.test(filename))
      assert.doesNotMatch(await readFile(path.join(publicRoot, filename), 'utf8'), /vite-plugin-checker-overlay|@vite-plugin-checker\/overlay|data-my-bad|\/__nuxt_dev__\/error/)
  }
  console.log('Checker1: actual Nuxt Vite-builder admission, Vue diagnostics, browser reconnect/repeated repair, type-error build rejection and overlay-free repaired production build passed')
}
catch (error) {
  console.error(`Nuxt checker acceptance failed during ${phase}\n${output}`)
  throw error
}
finally {
  await browser?.close()
  await stop()
  await rm(scratch, { recursive: true, force: true })
}
