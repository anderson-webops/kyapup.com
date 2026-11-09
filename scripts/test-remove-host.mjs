import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { loadNuxt } from '@nuxt/kit'
import { build as esbuild } from 'esbuild'
import puppeteer from 'puppeteer-core'
import { rolldown } from 'rolldown'
import { rollup } from 'rollup'
import removeEsbuild from 'unplugin-remove/esbuild'
import removeRolldown from 'unplugin-remove/rolldown'
import removeRollup from 'unplugin-remove/rollup'
import removeVite from 'unplugin-remove/vite'
import removeWebpack from 'unplugin-remove/webpack'
import { build, createServer, preview } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const executablePath = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find(candidate => candidate && existsSync(candidate))
assert.ok(executablePath, 'A real Chromium browser is required for removal-plugin acceptance')
const directory = path.join(root, '.ai-work/runs')
await mkdir(directory, { recursive: true })
const scratch = await mkdtemp(path.join(directory, 'remove-host-'))
const filename = path.join(scratch, 'fixture.js')
const source = 'console.log("REMOVE_SENTINEL");console.warn("KEEP_SENTINEL");const debuggerText="debugger;";debugger;function local(console){console.log("local")}local({log:()=>globalThis.localCount=1});globalThis.fixture={text:debuggerText,local:globalThis.localCount};'
let server
let browser
let previewServer
let nuxt

function verifyBundle(code) {
  const calls = []
  const context = {
    console: {
      log: value => calls.push(['log', value]),
      warn: value => calls.push(['warn', value]),
    },
  }
  vm.runInNewContext(code, context)
  assert.equal(context.fixture.text, 'debugger;')
  assert.equal(context.fixture.local, 1)
  assert.deepEqual(calls, [
    ['warn', 'KEEP_SENTINEL'],
  ])
}

function originFor(httpServer) {
  const address = httpServer.address()
  assert.equal(typeof address, 'object')
  return `http://127.0.0.1:${address.port}`
}

function config() {
  return {
    configFile: false,
    root: scratch,
    cacheDir: path.join(scratch, 'cache'),
    plugins: [
      removeVite(),
    ],
    logLevel: 'error',
    devtools: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, open: false },
    preview: { host: '127.0.0.1', port: 0, open: false },
    build: {
      outDir: path.join(scratch, 'dist'),
      sourcemap: true,
    },
  }
}

try {
  await writeFile(filename, source)
  const nuxtRoot = path.join(scratch, 'nuxt')
  await mkdir(nuxtRoot)
  nuxt = await loadNuxt({
    cwd: nuxtRoot,
    dev: false,
    ready: true,
    config: {
      compatibilityDate: '2026-11-08',
      telemetry: false,
      devtools: { enabled: false },
      modules: ['nuxt-security'],
      security: {
        removeLoggers: {
          consoleType: ['log', 'warn'],
        },
      },
    },
  })
  const vite = {
    plugins: [],
    build: {},
    resolve: { alias: {} },
    environments: { client: {}, ssr: {} },
  }
  await nuxt.hooks.callHook('vite:extend', { config: vite, nuxt })
  const selected = vite.plugins.flat().find(plugin => plugin?.name === 'unplugin-remove-console-debugger')
  assert.ok(selected, 'The actual Nuxt-security options branch must register the maintained plugin')
  const handler = typeof selected.transform === 'function'
    ? selected.transform
    : selected.transform.handler
  const transformed = await handler.call({}, 'console.warn("remove");globalThis.fixture="debugger;";', filename)
  assert.doesNotMatch(transformed.code, /console\.warn/)
  assert.match(transformed.code, /debugger;/)
  await nuxt.close()
  nuxt = undefined
  console.log('Removal host: actual Nuxt-security configuration selects and executes the modern plugin')

  const bundle = await rollup({
    input: filename,
    plugins: [
      removeRollup(),
    ],
  })
  try {
    const result = await bundle.generate({ format: 'iife' })
    verifyBundle(result.output.find(output => output.type === 'chunk').code)
  }
  finally {
    await bundle.close()
  }
  const native = await rolldown({
    input: filename,
    plugins: [
      removeRolldown(),
    ],
  })
  try {
    const result = await native.generate({ format: 'iife' })
    verifyBundle(result.output.find(output => output.type === 'chunk').code)
  }
  finally {
    await native.close()
  }
  const built = await esbuild({
    entryPoints: [filename],
    bundle: true,
    write: false,
    format: 'iife',
    plugins: [
      removeEsbuild(),
    ],
  })
  verifyBundle(built.outputFiles[0].text)
  console.log('Removal host: actual Rollup, Rolldown and Esbuild bundles execute with preserved application behavior')

  let webpack
  try {
    webpack = require('webpack')
  }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND')
      throw error
  }
  if (webpack) {
    const outputPath = path.join(scratch, 'webpack')
    const compiler = webpack({
      mode: 'production',
      entry: filename,
      output: { path: outputPath, filename: 'bundle.js' },
      optimization: { minimize: false },
      plugins: [
        removeWebpack(),
      ],
    })
    try {
      await new Promise((resolve, reject) => compiler.run((error, stats) => {
        if (error)
          reject(error)
        else if (stats.hasErrors())
          reject(new Error(stats.toString({ all: false, errors: true })))
        else
          resolve()
      }))
      verifyBundle(await readFile(path.join(outputPath, 'bundle.js'), 'utf8'))
    }
    finally {
      await new Promise((resolve, reject) => compiler.close(error => error
        ? reject(error)
        : resolve()))
    }
    console.log('Removal host: available Webpack compiler and modern loader execute the same fixture')
  }
  else {
    console.log('Removal host: optional Webpack compiler absent; its ESM/CommonJS adapter descriptors are tested separately')
  }

  await writeFile(path.join(scratch, 'index.html'), '<!doctype html><html><head><title>Removal fixture</title><link rel="icon" href="data:,"></head><body><output id="value"></output><script type="module" src="/main.js"></script></body></html>')
  await writeFile(path.join(scratch, 'main.js'), 'import "./fixture.js";document.querySelector("#value").textContent=globalThis.fixture.text;')
  server = await createServer(config())
  await server.listen()
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(scratch, 'browser'),
    args: process.platform === 'linux'
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : [],
  })
  const page = await browser.newPage()
  const messages = []
  const errors = []
  page.on('console', message => messages.push(message.text()))
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(originFor(server.httpServer), { waitUntil: 'networkidle0' })
  assert.ok(messages.includes('REMOVE_SENTINEL'), 'Development logging must remain enabled')
  assert.equal(await page.$eval('#value', element => element.textContent), 'debugger;')
  await server.close()
  server = undefined
  messages.length = 0
  await build(config())
  previewServer = await preview(config())
  await page.goto(originFor(previewServer.httpServer), { waitUntil: 'networkidle0' })
  assert.ok(!messages.includes('REMOVE_SENTINEL'), 'Production logging must follow the configured removal policy')
  assert.ok(messages.includes('KEEP_SENTINEL'))
  assert.equal(await page.$eval('#value', element => element.textContent), 'debugger;')
  assert.deepEqual(errors, [])
  console.log('Removal host: real Vite development/production browsers preserve strings and enforce build-only removal')
}
finally {
  await nuxt?.close()
  await browser?.close()
  if (previewServer)
    await new Promise(resolve => previewServer.httpServer.close(resolve))
  await server?.close()
  await rm(scratch, { recursive: true, force: true })
}
