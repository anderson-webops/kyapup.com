import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import puppeteer from 'puppeteer-core'
import { root, wasmBundle } from './fixtures/nitro-tools.mjs'

const executablePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find(candidate => candidate && existsSync(candidate))
assert.ok(executablePath, 'A real Chromium browser is required for WASM acceptance')
const parent = path.join(root, '.ai-work/runs')
await mkdir(parent, { recursive: true })
const scratch = await mkdtemp(path.join(parent, 'nitro-wasm-browser-'))
let browser
let server
let code

try {
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(code)
    }
    else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html><head><title>WASM fixture</title><link rel="icon" href="data:,"></head><body><button id="run">Run</button><output id="answer"></output><script type="module">import {run} from "/bundle.js";document.querySelector("#run").addEventListener("click",async()=>document.querySelector("#answer").textContent=String(await run()))</script></body></html>')
    }
    else {
      response.statusCode = 404
      response.end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
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
  for (const mode of ['named', 'module', 'imports']) {
    for (const lazy of [false, true]) {
      const result = await wasmBundle(path.join(scratch, `${mode}-${lazy}`), { lazy }, false, mode)
      assert.deepEqual(result.warnings, [])
      code = result.code
      await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'networkidle0' })
      await page.click('#run')
      await page.waitForFunction(() => document.querySelector('#answer')?.textContent === '42')
      await page.click('#run')
      assert.equal(await page.$eval('#answer', element => element.textContent), '42')
      assert.deepEqual(errors, [])
    }
  }
  console.log('WASM: six real browser binding cases passed with repeated initialization, native modules and explicit imports')
}
finally {
  await browser?.close()
  if (server)
    await new Promise(resolve => server.close(resolve))
  await rm(scratch, { recursive: true, force: true })
}
