import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import * as nodeCompiler from '@vue/compiler-sfc'
import { build, transform } from 'esbuild'
import puppeteer from 'puppeteer-core'
import { cases, interactiveSource, sourceFor } from './fixtures/vue-compiler-cases.mjs'
import { optionsFrom } from './fixtures/vue-compiler-options.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const compilerBytes = await readFile(require.resolve('@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js'))
const fixtures = cases.map(fixture => ({
  ...fixture,
  source: sourceFor(fixture),
}))
const directory = path.join(root, '.ai-work/runs')
await mkdir(directory, { recursive: true })
const scratch = await mkdtemp(path.join(directory, 'vue-compiler-browser-'))
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(filename => existsSync(filename))
assert.ok(executablePath, 'The standalone compiler requires a real browser check')
let browser
let server
const errors = []
try {
  const runtime = await build({
    stdin: { contents: 'export * from "vue";', resolveDir: root, loader: 'js' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    define: {
      'process.env.NODE_ENV': '"development"',
      '__VUE_OPTIONS_API__': 'true',
      '__VUE_PROD_DEVTOOLS__': 'false',
      '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': 'false',
    },
    logLevel: 'silent',
  })
  server = createServer((request, response) => {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html lang="en"><title>Compiler fixture</title><body><main id="app"></main><script type="module">import * as compiler from "/compiler.js";globalThis.compiler=compiler</script></body></html>')
    }
    else if (request.url === '/compiler.js' || request.url === '/runtime.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(request.url === '/compiler.js'
        ? compilerBytes
        : runtime.outputFiles[0].contents)
    }
    else {
      response.writeHead(404).end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(scratch, 'browser'),
    args: process.platform === 'linux'
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : [],
  })
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.waitForFunction(() => globalThis.compiler, { timeout: 15000 })
  const results = await page.evaluate((fixtures) => {
    const compiler = globalThis.compiler
    return fixtures.flatMap(fixture => [false, true].map((isProd) => {
      const descriptor = compiler.parse(fixture.source, { filename: 'Browser.vue' }).descriptor
      const output = compiler.compileScript(descriptor, { id: 'browser', isProd })
      return {
        name: fixture.name,
        isProd,
        content: output.content,
        map: !!output.map,
      }
    }))
  }, fixtures)
  assert.equal(results.length, fixtures.length * 2)
  for (const result of results) {
    const fixture = fixtures.find(item => item.name === result.name)
    const descriptor = nodeCompiler.parse(fixture.source, { filename: 'Browser.vue' }).descriptor
    const expected = nodeCompiler.compileScript(descriptor, { id: 'browser', isProd: result.isProd })
    assert.deepEqual(optionsFrom(result.content), optionsFrom(expected.content), `${result.name}, production=${result.isProd}`)
    assert.equal(result.map, true)
  }
  const compiled = await page.evaluate((source) => {
    const compiler = globalThis.compiler
    const descriptor = compiler.parse(source, { filename: 'Interactive.vue' }).descriptor
    const result = compiler.compileScript(descriptor, { id: 'interactive', inlineTemplate: true })
    const style = compiler.compileStyle({
      source: descriptor.styles[0].content,
      filename: 'Interactive.vue',
      id: 'data-v-interactive',
      scoped: true,
    })
    const parsed = compiler.babelParse('const number=1n;const load=import("data")', { sourceType: 'module' })
    const imported = compiler.parse('<script setup lang="ts">import type {Props} from "./types";defineProps<Props>()</script>')
    let filesystemBoundary = false
    try {
      compiler.compileScript(imported.descriptor, { id: 'unavailable' })
    }
    catch (error) {
      filesystemBoundary = /No fs option provided|File system access/.test(error.message)
    }
    return {
      content: result.content,
      style: style.code,
      errors: style.errors.map(String),
      bigint: typeof parsed.program.body[0].declarations[0].init.value,
      importType: parsed.program.body[1].declarations[0].init.type,
      filesystemBoundary,
    }
  }, interactiveSource)
  assert.equal(compiled.bigint, 'bigint')
  assert.equal(compiled.importType, 'ImportExpression')
  assert.equal(compiled.filesystemBoundary, true)
  assert.deepEqual(compiled.errors, [])
  assert.match(compiled.style, /data-v-interactive/)
  const javascript = (await transform(compiled.content, { loader: 'ts', format: 'esm', target: 'es2022' })).code
  assert.ok(javascript.includes('from "vue"'))
  const executable = javascript.replaceAll('from "vue"', `from ${JSON.stringify(`${origin}/runtime.js`)}`)
  await page.evaluate(async ({ executable, runtime }) => {
    const url = URL.createObjectURL(new Blob([executable], { type: 'text/javascript' }))
    try {
      const [{ default: component }, { createApp }] = await Promise.all([import(url), import(runtime)])
      globalThis.events = []
      globalThis.application = createApp(component, {
        label: 'counter',
        onChange: value => globalThis.events.push(value),
      })
      globalThis.application.mount('#app')
    }
    finally {
      URL.revokeObjectURL(url)
    }
  }, { executable, runtime: `${origin}/runtime.js` })
  assert.equal(await page.$eval('#counter', element => element.textContent), 'counter:0')
  await page.click('#counter')
  await page.click('#counter')
  await page.waitForFunction(() => document.querySelector('#counter')?.textContent === 'counter:2')
  assert.deepEqual(await page.evaluate(() => globalThis.events), [1, 2])
  await page.evaluate(() => globalThis.application.unmount())
  assert.deepEqual(errors, [])
  console.log(`Standalone browser compiler passed ${results.length} macro/parity cases, native ASTs, scoped styles/maps, filesystem boundaries and mounted reactive events`)
}
finally {
  await browser?.close()
  if (server)
    await new Promise(resolve => server.close(resolve))
  await rm(scratch, { recursive: true, force: true })
}
