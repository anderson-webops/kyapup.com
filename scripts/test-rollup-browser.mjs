import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import puppeteer from 'puppeteer-core'
import { buildFixture, providers, root } from './fixtures/rollup-cases.mjs'

const executablePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find(candidate => candidate && existsSync(candidate))
assert.ok(executablePath, 'A real Chromium browser is required for Rollup acceptance')
const parent = path.join(root, '.ai-work/runs')
await mkdir(parent, { recursive: true })
const scratch = await mkdtemp(path.join(parent, 'rollup-browser-'))
let server
let browser
let code = ''

try {
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(code)
    }
    else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end('<!doctype html><html><head><title>Rollup fixture</title><link rel="icon" href="data:,"></head><body><output id="state"></output><button id="increment">Increment</button><script src="/bundle.js"></script></body></html>')
    }
    else {
      response.statusCode = 404
      response.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  const origin = `http://127.0.0.1:${address.port}`
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
  const fixture = {
    name: 'interactive cohort',
    entry: 'import create from "./counter.cjs";class Example{supplied=7};const state=create(supplied);const field=new Example().supplied;const output=document.querySelector("#state");const render=()=>output.textContent=__BUILD__+":"+state.value+":"+field;document.querySelector("#increment").addEventListener("click",()=>{state.increment();render()});render();export const result=__BUILD__;',
    files: { 'counter.cjs': 'module.exports=initial=>({value:initial,increment(){this.value++}});', 'provider.js': 'export default 42;export const answer=7;' },
    injection: true,
    replacement: true,
  }
  for (const cjs of [false, true]) {
    const output = await buildFixture(path.join(scratch, String(cjs)), fixture, await providers(false, cjs), 'iife')
    code = output.code
    await page.goto(origin, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === 'qualified:42:7')
    await page.click('#increment')
    await page.click('#increment')
    await page.waitForFunction(() => document.querySelector('#state')?.textContent === 'qualified:44:7')
    assert.deepEqual(errors, [])
  }
  console.log('Rollup: both ESM and synchronous CJS plugin cohorts produced real browser bundles with working state, injection, class fields and build flags')
}
finally {
  await browser?.close()
  if (server)
    await new Promise(resolve => server.close(resolve))
  await rm(scratch, { recursive: true, force: true })
}
