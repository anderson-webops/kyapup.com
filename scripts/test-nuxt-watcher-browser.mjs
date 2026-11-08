import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const nuxtMetadata = require('nuxt/package.json')

const cli = path.resolve(path.dirname(require.resolve('nuxt/package.json')), nuxtMetadata.bin.nuxt)
const chrome = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(filename => filename && existsSync(filename))
assert.ok(chrome, 'A real supported browser is required')
const initialPage = '<script setup>const count=ref(0)</script><template><button @click="count++">watcher {{ count }}</button></template>'
const updatedPage = '<script setup>const count=ref(0)</script><template><button @click="count++">updated {{ count }}</button></template>'

async function availablePort() {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  await new Promise((resolve, reject) => server.close(error => error
    ? reject(error)
    : resolve()))
  return address.port
}

async function waitFor(predicate, child, label) {
  const deadline = Date.now() + 90000
  while (!await predicate()) {
    assert.equal(child.exitCode, null, label)
    assert.equal(child.signalCode, null, label)
    assert.ok(Date.now() < deadline, label)
    await delay(100)
  }
}

async function stop(child) {
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : once(child, 'exit')
  try {
    process.kill(-child.pid, 'SIGTERM')
  }
  catch (error) {
    if (error.code !== 'ESRCH')
      throw error
  }
  await Promise.race([
    exited,
    delay(5000),
  ])
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    }
    catch (error) {
      if (error.code !== 'ESRCH')
        throw error
    }
    await exited
  }
}

async function exerciseCache(directory) {
  for (let round = 0; round < 10; round++) {
    const filename = path.join(directory, `entry-${round}`)
    await writeFile(filename, 'synthetic browser cache')
    await delay(20)
    await rm(filename)
    await delay(20)
  }
}

for (const mode of ['chokidar', 'chokidar-granular']) {
  const parent = path.join(root, '.ai-work/runs')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(path.join(parent, 'nuxt-watcher-'))
  const application = path.join(directory, 'application')
  const port = await availablePort()
  let child
  let browser
  let page
  let phase = 'setup'
  let output = ''
  try {
    await mkdir(path.join(application, 'pages'), { recursive: true })
    await mkdir(path.join(application, 'plugins'))
    await mkdir(path.join(directory, 'cache/watcher-probe'), { recursive: true })
    await copyFile(path.join(root, 'scripts/fixtures/watcher-nuxt.config.mjs'), path.join(application, 'nuxt.config.mjs'))
    await writeFile(path.join(application, 'package.json'), JSON.stringify({ type: 'module', private: true }))
    await writeFile(path.join(application, 'app.vue'), '<template><NuxtPage /></template>')
    await writeFile(path.join(application, 'plugins/acceptance.client.mjs'), 'import {defineNuxtPlugin} from "#app";export default defineNuxtPlugin(({$router})=>{globalThis.__watcherFixture=Object.freeze({hasRoute:pathname=>$router.getRoutes().some(route=>route.path===pathname),navigate:pathname=>$router.push(pathname)})})')
    await writeFile(path.join(application, 'pages/index.vue'), initialPage)
    child = spawn(process.execPath, [
      cli,
      'dev',
      application,
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
      '--no-open',
    ], {
      cwd: application,
      detached: true,
      env: {
        ...process.env,
        CI: '',
        NODE_ENV: 'development',
        VITEST: '',
        TEST: '',
        WATCHER_MODULES_ROOT: path.join(root, 'node_modules'),
        WATCHER_MODE: mode,
        XDG_CONFIG_HOME: path.join(directory, 'config'),
        XDG_CACHE_HOME: path.join(directory, 'cache'),
        NO_COLOR: '1',
        NUXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const collect = (data) => {
      output = (output + data.toString()).slice(-200000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const origin = `http://127.0.0.1:${port}`
    await waitFor(async () => {
      if (!output.includes('WATCHER_DEVTOOLS_4_INITIALIZED') || !output.includes('WATCHER_KIT4_LEGACY_PROCESS_PASSED'))
        return false
      try {
        const response = await fetch(origin)
        return response.ok
      }
      catch { return false }
    }, child, 'The actual Nuxt4/DevTools4 development fixture must become ready')
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      userDataDir: path.join(directory, 'browser'),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    })
    page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    phase = 'initial-render'
    await page.goto(origin, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForFunction(() => document.querySelector('button')?.textContent.includes('watcher 0'))
    await page.click('button')
    await page.waitForFunction(() => document.querySelector('button')?.textContent.includes('watcher 1'))
    assert.equal(await page.evaluate(() => globalThis.__watcherFixture.hasRoute('/added')), false)
    phase = 'state-preserving-hmr-with-cache-writes'
    await Promise.all([
      exerciseCache(path.join(directory, 'cache/watcher-probe')),
      writeFile(path.join(application, 'pages/index.vue'), updatedPage),
    ])
    await page.waitForFunction(() => document.querySelector('button')?.textContent.includes('updated 1'), { timeout: 20000 })
    assert.ok(output.includes('WATCHER_EVENT_change'))
    phase = 'add-route'
    await writeFile(path.join(application, 'pages/added.vue'), '<template><h1>Added route</h1></template>')
    await waitFor(() => output.includes('WATCHER_EVENT_add'), child, 'Nuxt must receive the native add event')
    await page.waitForFunction(async () => {
      const fixture = globalThis.__watcherFixture
      if (!fixture?.hasRoute('/added'))
        return false
      await fixture.navigate('/added')
      return location.pathname === '/added'
    }, { timeout: 20000 })
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Added route')
    phase = 'remove-route'
    await rm(path.join(application, 'pages/added.vue'))
    await waitFor(() => output.includes('WATCHER_EVENT_unlink'), child, 'Nuxt must receive the native unlink event')
    await page.waitForFunction(async () => {
      const fixture = globalThis.__watcherFixture
      if (!fixture || fixture.hasRoute('/added'))
        return false
      await fixture.navigate('/')
      return location.pathname === '/'
    }, { timeout: 20000 })
    await page.waitForFunction(() => document.querySelector('button')?.textContent.includes('updated'))
    const devtools = await fetch(`${origin}/__nuxt_devtools__/client/`)
    assert.equal(devtools.status, 200)
    assert.match(await devtools.text(), /<html/i)
    assert.deepEqual(errors, [])
    assert.ok((await readFile(path.join(application, '.nuxt/nuxt.d.ts'), 'utf8')).length > 0)
    console.log(`Actual Nuxt4/DevTools4 and kit4 lifecycle passed with ${mode}: real rendering/events, state-preserving HMR, route add/remove and developer UI`)
  }
  catch (error) {
    const sanitized = output.split('\n').filter(line => !/auth|token|password|secret/i.test(line)).slice(-60).join('\n')
    const state = await page?.evaluate(() => ({
      pathname: location.pathname,
      button: document.querySelector('button')?.textContent,
      heading: document.querySelector('h1')?.textContent,
      addedRoute: globalThis.__watcherFixture?.hasRoute('/added'),
    })).catch(() => ({ unavailable: true }))
    throw new Error(`${error.message}\n${JSON.stringify({ mode, phase, state })}\n${sanitized}`, { cause: error })
  }
  finally {
    await browser?.close()
    if (child)
      await stop(child)
    await rm(directory, { recursive: true, force: true })
  }
}
