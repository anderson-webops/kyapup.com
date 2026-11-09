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
import { parseSync } from 'oxc-parser'
import puppeteer from 'puppeteer-core'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const metadata = require('nuxt/package.json')

const cli = path.resolve(path.dirname(require.resolve('nuxt/package.json')), metadata.bin.nuxt)
const executablePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(filename => filename && existsSync(filename))
assert.ok(executablePath, 'A real supported browser is required')
const parent = path.join(root, '.ai-work/runs')
await mkdir(parent, { recursive: true })
const scratch = await mkdtemp(path.join(parent, 'framework-context-'))
const application = path.join(scratch, 'application')
let child
let browser
let page
const errors = []
const exceptions = []
let output = ''

function start(argumentsList, environment) {
  child = spawn(process.execPath, argumentsList, {
    cwd: application,
    detached: true,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => { output = (output + chunk.toString()).slice(-128 * 1024) })
  return child
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

async function port() {
  const listener = net.createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const address = listener.address()
  await new Promise(resolve => listener.close(resolve))
  return address.port
}

try {
  await mkdir(path.join(application, 'plugins'), { recursive: true })
  await writeFile(path.join(application, 'package.json'), JSON.stringify({ type: 'module', private: true }))
  await writeFile(path.join(application, 'nuxt.config.mjs'), 'export default defineNuxtConfig({compatibilityDate:"2026-11-08",devtools:{enabled:false},nitro:{preset:"node-server"},app:{head:{link:[{rel:"icon",href:"data:,"}]}}})')
  await writeFile(path.join(application, 'app.vue'), '<script setup>const tag=useState("fixture-tag",()=>"browser");const count=ref(0);const lazy=ref(0);async function load(){lazy.value=await(await import("./lazy.mjs")).answer()}</script><template><output id="tag">{{tag}}</output><button id="count" @click="count++">{{count}}</button><button id="lazy" @click="load">Load</button><output id="lazy-result">{{lazy}}</output></template>')
  await writeFile(path.join(application, 'lazy.mjs'), 'import "./lazy.css";export async function answer(){return(await import("./nested.mjs")).answer}')
  await writeFile(path.join(application, 'nested.mjs'), 'import "./nested.css";export const answer=42')
  await writeFile(path.join(application, 'lazy.css'), '#lazy-result{color:rgb(1,2,3)}')
  await writeFile(path.join(application, 'nested.css'), '#lazy-result{font-weight:700}')
  await writeFile(path.join(application, 'plugins/context.server.ts'), 'export default defineNuxtPlugin(async()=>{const initial=useNuxtApp();const tag=useRequestHeader("x-fixture")||"browser";await new Promise(resolve=>setTimeout(resolve,20));if(useNuxtApp()!==initial)throw new Error("SSR context changed across await");useState("fixture-tag",()=>tag).value=tag;})')
  await writeFile(path.join(application, 'plugins/ready.client.mjs'), 'import {defineNuxtPlugin,onNuxtReady} from "#app";export default defineNuxtPlugin(()=>{onNuxtReady(()=>{globalThis.__frameworkFixtureReady=true})})')
  const environment = {
    ...process.env,
    CI: 'true',
    NODE_ENV: 'production',
    NUXT_TELEMETRY_DISABLED: '1',
  }
  const build = start([cli, 'build', application], environment)
  const terminal = await once(build, 'exit', {
    signal: AbortSignal.timeout(120000),
  })
  assert.equal(terminal[0], 0, output)
  assert.equal(terminal[1], null, output)
  const assets = path.join(application, '.output/public/_nuxt')
  for (const filename of await readdir(assets)) {
    if (!filename.endsWith('.js'))
      continue
    const source = await readFile(path.join(assets, filename), 'utf8')
    assert.deepEqual(parseSync(filename, source, { sourceType: 'module' }).errors, [], filename)
    assert.doesNotMatch(source, /__VITE_PRELOAD__/)
  }
  const address = await port()
  const origin = `http://127.0.0.1:${address}`
  start([
    path.join(application, '.output/server/index.mjs'),
  ], {
    ...environment,
    HOST: '127.0.0.1',
    PORT: String(address),
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: String(address),
  })
  const deadline = Date.now() + 30000
  for (;;) {
    assert.equal(child.exitCode, null, output)
    try {
      const response = await fetch(origin, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok)
        break
    }
    catch {}
    assert.ok(Date.now() < deadline, output)
    await delay(50)
  }
  await Promise.all(Array.from({ length: 16 }, async (_, index) => {
    const tag = `request-${index}`
    const response = await fetch(origin, {
      headers: { 'x-fixture': tag },
      signal: AbortSignal.timeout(10000),
    })
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.equal(html.match(/<output [^>]*id="tag"[^>]*>(.*?)<\/output>/s)?.[1], tag)
  }))
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(scratch, 'browser'),
    args: process.platform === 'linux'
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : [],
  })
  page = await browser.newPage()
  const debugging = await page.createCDPSession()
  await debugging.send('Runtime.enable')
  debugging.on('Runtime.exceptionThrown', ({ exceptionDetails }) => exceptions.push({
    text: exceptionDetails.text,
    url: exceptionDetails.url,
    line: exceptionDetails.lineNumber,
    column: exceptionDetails.columnNumber,
    description: exceptionDetails.exception?.description,
  }))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => globalThis.__frameworkFixtureReady === true)
  await page.waitForSelector('#count')
  assert.equal(await page.$eval('#tag', element => element.textContent), 'browser')
  await page.click('#count')
  await page.waitForFunction(() => document.querySelector('#count')?.textContent === '1')
  await page.click('#count')
  await page.waitForFunction(() => document.querySelector('#count')?.textContent === '2')
  await page.click('#lazy')
  await page.waitForFunction(() => document.querySelector('#lazy-result')?.textContent === '42')
  assert.deepEqual(await page.$eval('#lazy-result', element => ({ color: getComputedStyle(element).color, weight: getComputedStyle(element).fontWeight })), { color: 'rgb(1, 2, 3)', weight: '700' })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => globalThis.__frameworkFixtureReady === true)
  assert.equal(await page.$eval('#count', element => element.textContent), '0')
  assert.deepEqual(errors, [])
  console.log('Framework parents: real Rolldown1.3 Nuxt/Nitro production build, independently valid emitted scripts, sixteen isolated async SSR contexts, hydration, nested dynamic imports/CSS, live events and reload passed')
}
catch (error) {
  if (page) {
    const state = await page.evaluate(() => ({
      text: document.body.textContent.slice(0, 4000),
      ready: globalThis.__frameworkFixtureReady,
      count: document.querySelector('#count')?.textContent,
    })).catch(() => undefined)
    const sources = []
    for (const exception of exceptions) {
      const pathname = exception.url
        ? new URL(exception.url).pathname
        : ''
      if (/^\/_nuxt\/[\w.-]+\.js$/.test(pathname)) {
        const source = await readFile(path.join(application, '.output/public', pathname), 'utf8').catch(() => '')
        const line = source.split('\n')[exception.line] || ''
        sources.push({
          pathname,
          line: exception.line,
          column: exception.column,
          source: line.slice(Math.max(0, exception.column - 1500), exception.column + 1500),
        })
      }
    }
    error.message += `\nBrowser state: ${JSON.stringify({ state, errors, exceptions, sources })}`
  }
  error.message += `\n${output}`
  throw error
}
finally {
  await browser?.close()
  await stop()
  await rm(scratch, { recursive: true })
}
