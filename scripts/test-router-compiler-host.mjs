import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { build, createServer, preview } from 'vite'
import routerPlugin from 'vue-router/vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const frontend = createRequire(path.join(root, 'front-end/package.json'))
const { default: vue } = await import(pathToFileURL(frontend.resolve('@vitejs/plugin-vue')))
const executablePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find(candidate => candidate && existsSync(candidate))
assert.ok(executablePath, 'A real Chromium browser is required for router compiler acceptance')
const scratchRoot = path.join(root, '.ai-work/runs')
await mkdir(scratchRoot, { recursive: true })
const scratch = await mkdtemp(path.join(scratchRoot, 'router-compiler-host-'))
const pages = path.join(scratch, 'pages')
const personFile = path.join(pages, 'person/[id].vue')
const detailPage = label => `<script setup lang="ts">import {useRoute} from 'vue-router';definePage({name:'compiler-person',meta:{label:'${label}'} satisfies Record<string,string>});const route=useRoute();</script><template><h1>person {{route.params.id}}</h1><output id="label">{{route.meta.label}}</output></template>`
let server
let browser
let previewServer
let page
const errors = []
const changes = []
const watchErrors = []

function configuration() {
  return {
    configFile: false,
    root: scratch,
    cacheDir: path.join(scratch, 'cache'),
    logLevel: 'error',
    plugins: [
      routerPlugin({
        root: scratch,
        routesFolder: pages,
        dts: path.join(scratch, 'typed-routes.d.ts'),
      }),
      vue(),
    ],
    server: { host: '127.0.0.1', port: 0, open: false },
    preview: { host: '127.0.0.1', port: 0, open: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    devtools: false,
    build: {
      outDir: path.join(scratch, 'dist'),
      sourcemap: true,
    },
  }
}

function originFor(httpServer) {
  const address = httpServer.address()
  assert.equal(typeof address, 'object')
  return `http://127.0.0.1:${address.port}`
}

async function navigate(page, origin, label) {
  await page.goto(origin, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'home')
  await page.click('#person')
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'person 7')
  assert.equal(new URL(page.url()).pathname, '/person/7')
  assert.equal(await page.$eval('#label', element => element.textContent), label)
  await page.goBack({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'home')
  await page.goForward({ waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'person 7')
}

async function updateDetailPage() {
  const deadline = Date.now() + 10000
  const directory = path.dirname(personFile)
  const basename = path.basename(personFile)
  while (!server.ws.clients.size || !server.watcher.getWatched()[directory]?.includes(basename)) {
    assert.ok(Date.now() < deadline, 'The browser HMR connection and imported-page watcher must be ready before editing')
    await delay(25)
  }
  const watcher = server.watcher
  let listener
  let timer
  const observed = new Promise((resolve, reject) => {
    listener = (filename) => {
      if (path.resolve(filename) === personFile)
        resolve()
    }
    watcher.on('change', listener)
    timer = setTimeout(() => reject(new Error('The imported route change was not observed')), 10000)
  })
  try {
    await Promise.all([
      observed,
      writeFile(personFile, detailPage('after')),
    ])
  }
  finally {
    clearTimeout(timer)
    watcher.off('change', listener)
  }
}

try {
  await mkdir(path.dirname(personFile), { recursive: true })
  await writeFile(path.join(scratch, 'index.html'), '<!doctype html><html><head><title>Router fixture</title><link rel="icon" href="data:,"></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>')
  await writeFile(path.join(pages, 'index.vue'), '<script setup lang="ts">definePage({name:"compiler-home",meta:{label:"home"}})</script><template><h1>home</h1></template>')
  await writeFile(personFile, detailPage('before'))
  await writeFile(path.join(scratch, 'main.js'), 'import {createApp,h,ref} from "vue";import {createRouter,createWebHistory,RouterView,RouterLink} from "vue-router";import {routes,handleHotUpdate} from "vue-router/auto-routes";const router=createRouter({history:createWebHistory(),routes});if(import.meta.hot)handleHotUpdate(router);const app={setup(){const count=ref(0);return()=>h("main",[h(RouterLink,{id:"person",to:"/person/7"},()=>"person"),h("button",{id:"count",onClick:()=>count.value++},String(count.value)),h(RouterView)])}};createApp(app).use(router).mount("#app");')
  await writeFile(path.join(scratch, 'server.js'), 'import {createSSRApp,h} from "vue";import {renderToString} from "vue/server-renderer";import {createRouter,createMemoryHistory,RouterView} from "vue-router";import {routes} from "vue-router/auto-routes";export async function render(url){const router=createRouter({history:createMemoryHistory(),routes});const app=createSSRApp({render:()=>h(RouterView)});app.use(router);await router.push(url);await router.isReady();return renderToString(app)}')
  server = await createServer(configuration())
  server.watcher.on('all', (event, filename) => {
    if (path.resolve(filename) === personFile && changes.length < 20)
      changes.push(event)
  })
  server.watcher.on('error', error => watchErrors.push(error.message))
  await server.listen()
  const entry = await server.ssrLoadModule('/server.js')
  assert.match(await entry.render('/person/42'), /person 42/)
  const declarations = await readFile(path.join(scratch, 'typed-routes.d.ts'), 'utf8')
  assert.match(declarations, /compiler-home/)
  assert.match(declarations, /compiler-person/)
  console.log('Router compiler: generated route types, typed definePage and actual SSR passed')
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(scratch, 'browser'),
    args: process.platform === 'linux'
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : [],
  })
  page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await navigate(page, originFor(server.httpServer), 'before')
  await page.click('#count')
  await page.waitForFunction(() => document.querySelector('#count')?.textContent === '1')
  await updateDetailPage()
  await page.waitForFunction(() => document.querySelector('#label')?.textContent === 'after')
  assert.equal(await page.$eval('#count', element => element.textContent), '1')
  assert.deepEqual(errors, [])
  assert.deepEqual(watchErrors, [])
  console.log('Router compiler: real navigation, parameters, history and metadata HMR preserved app state')
  await server.close()
  server = undefined
  const config = configuration()
  await build(config)
  previewServer = await preview(config)
  await navigate(page, originFor(previewServer.httpServer), 'after')
  assert.deepEqual(errors, [])
  console.log('Router compiler: production code splitting, macro extraction and browser navigation passed')
}
catch (error) {
  console.error(JSON.stringify({
    message: error.message,
    browserErrors: errors,
    watcherErrors: watchErrors,
    observedChanges: changes,
    connectedHmrClients: server?.ws.clients.size,
    watchedPageFiles: server?.watcher.getWatched()[path.dirname(personFile)],
    routeModules: [
      ...(server?.moduleGraph.getModulesByFile(personFile) || []),
    ].map(module => ({ id: module.id, lastHMRTimestamp: module.lastHMRTimestamp })),
    visible: await page?.evaluate(() => ({ heading: document.querySelector('h1')?.textContent, label: document.querySelector('#label')?.textContent, count: document.querySelector('#count')?.textContent })),
  }))
  throw error
}
finally {
  await browser?.close()
  if (previewServer)
    await new Promise(resolve => previewServer.httpServer.close(resolve))
  await server?.close()
  await rm(scratch, { recursive: true, force: true })
}
