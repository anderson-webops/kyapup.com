import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import presetAttributify from '@unocss/preset-attributify'
import presetWind3 from '@unocss/preset-wind3'
import transformerAttributifyJsx from '@unocss/transformer-attributify-jsx'
import vueJsx from '@vitejs/plugin-vue-jsx'
import puppeteer from 'puppeteer-core'
import UnoCSS from 'unocss/vite'
import { build, createServer, preview } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const frontend = createRequire(path.join(root, 'front-end/package.json'))
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
assert.ok(executablePath, 'A real Chromium browser is required for native JSX provider acceptance')
const parent = path.join(root, '.ai-work/runs')
await mkdir(parent, { recursive: true })
const scratch = await mkdtemp(path.join(parent, 'native-providers-host-'))
const filename = path.join(scratch, 'Counter.tsx')
const component = (label, color) => `import {defineComponent,ref} from 'vue'; export default defineComponent(() => { const count=ref<number>(0); return () => <section id="panel" flex p-4 ${color}><button id="count" onClick={()=>count.value++}>${label}:{count.value}</button><span id="literal" title="🙂">native JSX</span></section> })`
let server
let previewServer
let browser

function origin(httpServer) {
  const address = httpServer.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}

function configuration(mode = 'babel') {
  return {
    configFile: false,
    root: scratch,
    cacheDir: path.join(scratch, `cache-${mode}`),
    logLevel: 'error',
    devtools: false,
    plugins: [
      UnoCSS({
        presets: [
          presetAttributify(),
          presetWind3(),
        ],
        transformers: [
          transformerAttributifyJsx({
            include: [
              { pattern: /\.tsx$/, resolver: 'oxc' },
            ],
          }),
        ],
      }),
      vueJsx({ tsTransform: mode }),
    ],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, open: false },
    preview: { host: '127.0.0.1', port: 0, open: false },
    build: {
      outDir: path.join(scratch, `dist-${mode}`),
      sourcemap: true,
    },
  }
}

async function exercise(page, label, expectedColor) {
  await page.waitForSelector('#panel')
  try {
    await page.waitForFunction(color => getComputedStyle(document.querySelector('#panel')).backgroundColor === color, {}, expectedColor)
  }
  catch (error) {
    const actual = await page.$eval('#panel', element => ({
      markup: element.outerHTML,
      background: getComputedStyle(element).backgroundColor,
      display: getComputedStyle(element).display,
      padding: getComputedStyle(element).padding,
      styles: Array.from(document.styleSheets, sheet => ({
        href: sheet.href,
        rules: Array.from(sheet.cssRules, rule => rule.cssText).join('\n').slice(0, 6000),
      })),
    }))
    error.message += `\nExpected color ${expectedColor}; actual fixture: ${JSON.stringify(actual)}`
    throw error
  }
  assert.deepEqual(await page.$eval('#panel', element => ({
    display: getComputedStyle(element).display,
    padding: getComputedStyle(element).padding,
    flex: element.getAttribute('flex'),
    paddingAttribute: element.getAttribute('p-4'),
  })), {
    display: 'flex',
    padding: '16px',
    flex: '',
    paddingAttribute: '',
  })
  assert.equal(await page.$eval('#literal', element => element.title), '🙂')
  assert.equal(await page.$eval('#count', element => element.textContent), `${label}:0`)
  await page.click('#count')
  await page.waitForFunction(expected => document.querySelector('#count').textContent === expected, {}, `${label}:1`)
}

try {
  await writeFile(path.join(scratch, 'index.html'), '<!doctype html><html><head><title>Native JSX fixture</title><link rel="icon" href="data:,"></head><body><div id="app"></div><script type="module" src="/main.ts"></script></body></html>')
  await writeFile(path.join(scratch, 'main.ts'), 'import {createApp} from "vue"; import "virtual:uno.css"; import Counter from "./Counter.tsx"; createApp(Counter).mount("#app");')
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  for (const mode of ['babel', 'built-in']) {
    await writeFile(filename, component('before', 'bg-red-500'))
    server = await createServer(configuration(mode))
    await server.listen()
    const entry = await server.ssrLoadModule('/Counter.tsx')
    const markup = await renderToString(createSSRApp(entry.default))
    assert.match(markup, /id="panel"/)
    assert.match(markup, /\sflex(?:=""|(?=\s|>))/)
    await page.goto(origin(server.httpServer), { waitUntil: 'networkidle0' })
    await exercise(page, 'before', 'rgb(239, 68, 68)')
    await writeFile(filename, component('after', 'bg-blue-500'))
    await page.waitForFunction(() => document.querySelector('#count')?.textContent === 'after:0')
    await exercise(page, 'after', 'rgb(59, 130, 246)')
    assert.deepEqual(errors, [])
    console.log(`Native JSX development ${mode}: actual CSS, SSR, live events and HMR passed`)
    await server.close()
    server = undefined
  }
  for (const mode of ['babel', 'built-in']) {
    const options = configuration(mode)
    const output = await build(options)
    const assets = output.output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'))
    assert.ok(assets.length, 'The production build must emit CSS')
    previewServer = await preview(options)
    await page.goto(origin(previewServer.httpServer), { waitUntil: 'networkidle0' })
    await exercise(page, 'after', 'rgb(59, 130, 246)')
    assert.deepEqual(errors, [])
    console.log(`Native JSX production ${mode}: actual CSS, empty attributes and live events passed`)
    await new Promise(resolve => previewServer.httpServer.close(resolve))
    previewServer = undefined
  }
  console.log('Native JSX providers: SSR, forced native parsing, CSS, Unicode, live events, HMR and both production transforms passed')
}
finally {
  await browser?.close()
  if (previewServer)
    await new Promise(resolve => previewServer.httpServer.close(resolve))
  await server?.close()
  await rm(scratch, { recursive: true, force: true })
}
