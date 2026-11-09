import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'
import checker from 'vite-plugin-checker'

const root = fileURLToPath(new URL('..', import.meta.url))
const executablePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find(candidate => candidate && existsSync(candidate))
assert.ok(executablePath, 'A real Chromium browser is required for checker acceptance')
const parent = path.join(root, '.ai-work/runs')
await mkdir(parent, { recursive: true })
const scratch = await mkdtemp(path.join(parent, 'checker-browser-'))
const source = path.join(scratch, 'case.ts')
let server
let browser

function overlayContains(message) {
  const overlay = document.querySelector('vite-plugin-checker-error-overlay')
  function text(element) {
    if (!element)
      return ''
    return (element.textContent || '') + (element.shadowRoot
      ? text(element.shadowRoot)
      : '') + Array.from(element.children || [], text).join('')
  }
  return text(overlay).includes(message)
}

try {
  await writeFile(path.join(scratch, 'index.html'), '<!doctype html><html><head><title>Checker fixture</title><link rel="icon" href="data:,"></head><body><output id="count"></output><script type="module" src="/main.ts"></script></body></html>')
  await writeFile(path.join(scratch, 'main.ts'), 'import {count} from "./case";document.querySelector("#count")!.textContent="counter:"+count;')
  await writeFile(path.join(scratch, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      types: [],
      lib: ['ESNext', 'DOM'],
    },
    include: ['case.ts', 'main.ts'],
  }))
  await writeFile(source, 'export const count:number="bad";\n')
  server = await createServer({
    configFile: false,
    root: scratch,
    cacheDir: path.join(scratch, 'cache'),
    logLevel: 'error',
    plugins: [
      checker({ typescript: true, terminal: false }),
    ],
    server: { host: '127.0.0.1', port: 0, open: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    devtools: false,
  })
  await server.listen()
  const address = server.httpServer.address()
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
  await page.goto(origin, { waitUntil: 'networkidle0' })
  await page.waitForFunction(overlayContains, {}, 'not assignable')
  await page.waitForFunction(overlayContains, {}, 'count:number="bad"')
  assert.equal(await page.$eval('#count', element => element.textContent), 'counter:bad')
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForFunction(overlayContains, {}, 'not assignable')
  for (const value of ['2', '"second"', '3']) {
    await writeFile(source, `export const count:number=${value};\n`)
    await page.waitForFunction(expected => document.querySelector('#count')?.textContent === expected, {}, `counter:${JSON.parse(value)}`)
    if (value === '"second"') {
      await page.waitForFunction(overlayContains, {}, 'not assignable')
      await page.waitForFunction(overlayContains, {}, 'count:number="second"')
    }
    else {
      await page.waitForFunction(() => {
        const overlay = document.querySelector('vite-plugin-checker-error-overlay')
        return Boolean(overlay?.shadowRoot) && !overlay.shadowRoot.querySelector('main')
      })
    }
  }
  assert.deepEqual(errors, [])
  await server.close()
  server = undefined
  console.log('Checker: real browser error highlighting, reconnect and repeated source-repair recovery passed')
  const runner = path.join(scratch, 'build.mjs')
  await writeFile(runner, 'import {build} from "vite";import checker from "vite-plugin-checker";await build({configFile:false,root:process.cwd(),logLevel:"error",plugins:[checker({typescript:true})],devtools:false,build:{outDir:"dist"}});')
  await writeFile(source, 'export const count:number="invalid-build";\n')
  const invalid = spawnSync(process.execPath, [runner], {
    cwd: scratch,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  assert.ifError(invalid.error)
  assert.equal(invalid.signal, null)
  assert.equal(invalid.status, 2, invalid.stdout + invalid.stderr)
  assert.match(invalid.stdout + invalid.stderr, /TS2322/)
  await writeFile(source, 'export const count:number=4;\n')
  const accepted = spawnSync(process.execPath, [runner], {
    cwd: scratch,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  assert.ifError(accepted.error)
  assert.equal(accepted.signal, null)
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
  assert.doesNotMatch(await readFile(path.join(scratch, 'dist/index.html'), 'utf8'), /vite-plugin-checker/)
  console.log('Checker: real Vite build rejects a type error and accepts its repaired source without a production overlay')
}
finally {
  await browser?.close()
  await server?.close()
  await rm(scratch, { recursive: true, force: true })
}
