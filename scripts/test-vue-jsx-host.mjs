import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vueJsx from '@vitejs/plugin-vue-jsx'
import puppeteer from 'puppeteer-core'
import { build, createServer, preview } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const frontend = createRequire(path.join(root, 'front-end/package.json'))
const { default: vue } = await import(pathToFileURL(frontend.resolve('@vitejs/plugin-vue')))
const { createSSRApp } = await import(pathToFileURL(frontend.resolve('vue')))
const { renderToString } = await import(pathToFileURL(frontend.resolve('vue/server-renderer')))
const executablePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find(candidate => candidate && existsSync(candidate))
assert.ok(executablePath, 'A real Chromium browser is required for the JSX host fixture')
const scratchRoot = path.join(root, '.ai-work/runs')
await mkdir(scratchRoot, { recursive: true })
const scratch = await mkdtemp(path.join(scratchRoot, 'vue-jsx-host-'))
const filename = path.join(scratch, 'Counter.tsx')
const component = label => `import {defineComponent,ref} from 'vue';import Slot from './Slot.vue';export default defineComponent(() => {const count=ref<number>(0);const value=ref<string>('start');return () => <><button id="count" onClick={()=>count.value++}>${label}:{count.value}</button><input aria-label="Value" id="value" v-model={value.value}/><output id="output">{value.value}</output><Slot v-slots={{default:()=> <b id="slot">slot works</b>}}/></>})`
let server
let browser
let previewServer

function originFor(httpServer) {
  const address = httpServer.address()
  assert.equal(typeof address, 'object')
  return `http://127.0.0.1:${address.port}`
}

function configuration(tsTransform = 'babel') {
  return {
    configFile: false,
    root: scratch,
    cacheDir: path.join(scratch, `cache-${tsTransform}`),
    logLevel: 'error',
    plugins: [
      vue(),
      vueJsx({ tsTransform }),
    ],
    server: { host: '127.0.0.1', port: 0, open: false },
    preview: { host: '127.0.0.1', port: 0, open: false },
    devtools: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    build: {
      outDir: path.join(scratch, `dist-${tsTransform}`),
      sourcemap: true,
    },
  }
}

async function exercise(page, label) {
  await page.waitForSelector('#count')
  assert.equal(await page.$eval('#count', element => element.textContent), `${label}:0`)
  assert.equal(await page.$eval('#slot', element => element.textContent), 'slot works')
  await page.click('#count')
  await page.waitForFunction(expected => document.querySelector('#count')?.textContent === expected, {}, `${label}:1`)
  await page.$eval('#value', (element) => {
    element.value = 'updated'
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForFunction(() => document.querySelector('#output')?.textContent === 'updated')
}

try {
  await writeFile(path.join(scratch, 'index.html'), '<!doctype html><html><head><title>JSX fixture</title><link rel="icon" href="data:,"></head><body><div id="app"></div><script type="module" src="/main.ts"></script></body></html>')
  await writeFile(path.join(scratch, 'main.ts'), 'import {createApp} from "vue";import Counter from "./Counter.tsx";createApp(Counter).mount("#app");')
  await writeFile(path.join(scratch, 'Slot.vue'), '<template><section><slot /></section></template>')
  await writeFile(filename, component('before'))
  server = await createServer(configuration())
  await server.listen()
  const entry = await server.ssrLoadModule('/Counter.tsx')
  const context = {}
  const markup = await renderToString(createSSRApp(entry.default), context)
  assert.match(markup, /before:0/)
  assert.match(markup, /slot works/)
  assert.ok(context.modules.has('Counter.tsx'))
  const ssr = await server.transformRequest('/Counter.tsx', { ssr: true })
  assert.doesNotMatch(ssr.code, /__VUE_HMR_RUNTIME__|import\.meta\.hot/)
  console.log('JSX host: real Vue SSR, SFC slots and module registration passed')
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
  await page.goto(originFor(server.httpServer), { waitUntil: 'networkidle0' })
  await exercise(page, 'before')
  await writeFile(filename, component('after'))
  await page.waitForFunction(() => document.querySelector('#count')?.textContent === 'after:0')
  await exercise(page, 'after')
  assert.deepEqual(errors, [])
  console.log('JSX host: real browser TSX, v-model, slots, fragments and hot reload passed')
  await server.close()
  server = undefined
  for (const mode of ['babel', 'built-in']) {
    const config = configuration(mode)
    await build(config)
    previewServer = await preview(config)
    await page.goto(originFor(previewServer.httpServer), { waitUntil: 'networkidle0' })
    await exercise(page, 'after')
    assert.deepEqual(errors, [])
    await new Promise((resolve, reject) => previewServer.httpServer.close(error => error
      ? reject(error)
      : resolve()))
    previewServer = undefined
    console.log(`JSX host: production ${mode} transform, live events and binding passed`)
  }
}
finally {
  await browser?.close()
  if (previewServer)
    await new Promise(resolve => previewServer.httpServer.close(resolve))
  await server?.close()
  await rm(scratch, { recursive: true, force: true })
}
