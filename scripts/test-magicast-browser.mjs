import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('..', import.meta.url))
const directory = path.join(root, '.ai-work/runs')
await mkdir(directory, { recursive: true })
const scratch = await mkdtemp(path.join(directory, 'magicast-browser-'))
const executablePath = process.env.CHROME_BIN || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(filename => existsSync(filename))
assert.ok(executablePath, 'A real Chrome installation is required')
let browser
let server
const errors = []
try {
  const entry = path.join(scratch, 'entry.js')
  await writeFile(entry, `import {parseModule,generateCode} from 'magicast/core';
import {addNuxtModule,getDefaultExportOptions} from 'magicast/helpers';
const module=parseModule('// retained comment\\ntype Value<Target> = { [Key in keyof Target]: Target[Key] }; export default defineNuxtConfig({count:1n,loader:()=>import("data",{with:{type:"json"}})})');
module.$ast.body[0].typeParameters.params[0].name.name='Renamed';
getDefaultExportOptions(module).count=9007199254740993n;
addNuxtModule(module,'test-module','testOptions',{enabled:true});
const output=generateCode(module).code;
const checked=parseModule(output);
globalThis.result={nativeTypeName:checked.$ast.body[0].typeParameters.params[0].name.name,count:String(getDefaultExportOptions(checked).count),module:getDefaultExportOptions(checked).modules[0],options:getDefaultExportOptions(checked).loader.$ast.body.options.type,comment:output.includes('retained comment')};`)
  server = createServer(async (request, response) => {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><html lang="en"><title>Editor fixture</title><body><script type="module" src="/app.js"></script></body></html>')
    }
    else if (request.url === '/app.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(await readFile(path.join(scratch, 'app.js')))
    }
    else {
      response.writeHead(404).end()
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await puppeteer.launch({
    executablePath,
    headless: true,
    userDataDir: path.join(scratch, 'browser'),
    args: process.platform === 'linux'
      ? ['--no-sandbox', '--disable-dev-shm-usage']
      : [],
  })
  for (const minify of [false, true]) {
    await build({
      entryPoints: [entry],
      outfile: path.join(scratch, 'app.js'),
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      minify,
      logLevel: 'silent',
    })
    const page = await browser.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.waitForFunction(() => globalThis.result, { timeout: 15000 })
    assert.deepEqual(await page.evaluate(() => globalThis.result), {
      nativeTypeName: 'Renamed',
      count: '9007199254740993',
      module: 'test-module',
      options: 'ObjectExpression',
      comment: true,
    })
    await page.close()
    console.log(`Browser-safe configuration editor passed with minification=${minify}`)
  }
  assert.deepEqual(errors, [])
}
finally {
  await browser?.close()
  if (server)
    await new Promise(resolve => server.close(resolve))
  await rm(scratch, { recursive: true, force: true })
}
