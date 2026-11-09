import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const originalRequire = createRequire(path.join(root, 'vendor/watchers/upstream/package.json'))
const original = await import(pathToFileURL(originalRequire.resolve('jiti')))

async function temporary(context) {
  const parent = path.join(root, '.ai-work/runs')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(path.join(parent, 'jiti-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ type: 'module', private: true }))
  return directory
}

const esm = ['export default {value:1}', 'export default {value:2}']
const commonjs = ['module.exports={value:1}', 'module.exports={value:2}']
const typescript = ['const value:number=1;export default {value}', 'const value:number=2;export default {value}']
const sources = {
  mjs: esm,
  js: esm,
  cjs: commonjs,
  ts: typescript,
  mts: typescript,
  cts: ['const value:number=1;module.exports={value}', 'const value:number=2;module.exports={value}'],
  json: ['{"value":1}', '{"value":2}'],
}

test('the exact original native-ESM cache failure remains a negative control', async (context) => {
  const directory = await temporary(context)
  const filename = path.join(directory, 'config.mjs')
  const loader = original.createJiti(path.join(directory, 'entry.mjs'), { moduleCache: false, fsCache: false })
  await writeFile(filename, esm[0])
  assert.equal((await loader.import(filename, { default: true })).value, 1)
  await writeFile(filename, esm[1])
  assert.equal((await loader.import(filename, { default: true })).value, 1)
})

for (const [extension, content] of Object.entries(sources)) {
  for (const tryNative of [false, true]) {
    test(`cache-disabled fresh source:extension=${extension},tryNative=${tryNative}`, async (context) => {
      const directory = await temporary(context)
      const filename = path.join(directory, `config.${extension}`)
      const loader = createJiti(path.join(directory, 'entry.mjs'), { moduleCache: false, fsCache: false, tryNative })
      await writeFile(filename, content[0])
      assert.equal((await loader.import(filename, { default: true })).value, 1)
      await writeFile(filename, content[1])
      assert.equal((await loader.import(filename, { default: true })).value, 2)
    })
  }
}

for (const tryNative of [false, true]) {
  test(`explicit default caching remains unchanged:tryNative=${tryNative}`, async (context) => {
    const directory = await temporary(context)
    const filename = path.join(directory, 'cached.mjs')
    const loader = createJiti(path.join(directory, 'entry.mjs'), { moduleCache: true, fsCache: false, tryNative })
    await writeFile(filename, esm[0])
    assert.equal((await loader.import(filename, { default: true })).value, 1)
    await writeFile(filename, esm[1])
    assert.equal((await loader.import(filename, { default: true })).value, 1)
  })
}

test('relative imports, native metadata, top-level await and error recovery remain functional', async (context) => {
  const directory = await temporary(context)
  const filename = path.join(directory, 'config.mjs')
  const dependency = path.join(directory, 'child.mjs')
  const loader = createJiti(path.join(directory, 'entry.mjs'), { moduleCache: false, fsCache: false })
  await writeFile(dependency, 'export default 1')
  await writeFile(filename, 'import value from "./child.mjs";await Promise.resolve();export default {value,url:import.meta.url}')
  const initial = await loader.import(filename, { default: true })
  assert.equal(initial.value, 1)
  assert.equal(initial.url, pathToFileURL(filename).href)
  await writeFile(dependency, 'export default 2')
  assert.equal((await loader.import(filename, { default: true })).value, 2)
  await writeFile(filename, 'export default {broken:')
  await assert.rejects(loader.import(filename, { default: true }))
  await writeFile(filename, esm[1])
  assert.equal((await loader.import(filename, { default: true })).value, 2)
})

test('uncached concurrent imports evaluate real source without cache-busting module URLs', async (context) => {
  const directory = await temporary(context)
  const filename = path.join(directory, 'concurrent.mjs')
  const key = Symbol.for('webops-jiti-concurrency-fixture')
  context.after(() => delete globalThis[key])
  globalThis[key] = 0
  await writeFile(filename, 'const key=Symbol.for("webops-jiti-concurrency-fixture");export default {value:++globalThis[key],url:import.meta.url}')
  const loader = createJiti(path.join(directory, 'entry.mjs'), { moduleCache: false, fsCache: false })
  const values = await Promise.all(Array.from({ length: 30 }, () => loader.import(filename, { default: true })))
  assert.equal(new Set(values.map(value => value.value)).size, 30)
  assert.equal(globalThis[key], 30)
  assert.ok(values.every(value => value.url === pathToFileURL(filename).href))
})

test('uncached JSON retains native UTF8 BOM handling across source changes', async (context) => {
  const directory = await temporary(context)
  const filename = path.join(directory, 'config.json')
  const loader = createJiti(path.join(directory, 'entry.mjs'), { moduleCache: false, fsCache: false })
  await writeFile(filename, '\uFEFF{"value":1}')
  assert.equal((await loader.import(filename, { default: true })).value, 1)
  await writeFile(filename, '\uFEFF{"value":2}')
  assert.equal((await loader.import(filename, { default: true })).value, 2)
})

test('uncached CommonJS bindings retain exports this and Node filename globals', async (context) => {
  const directory = await temporary(context)
  await mkdir(path.join(directory, 'common'))
  await writeFile(path.join(directory, 'common/package.json'), JSON.stringify({ type: 'commonjs' }))
  const loader = createJiti(path.join(directory, 'entry.mjs'), { moduleCache: false, fsCache: false })
  for (const relative of ['bindings.cjs', 'common/bindings.js']) {
    const filename = path.join(directory, relative)
    await writeFile(filename, 'this.value=42;exports.filename=__filename;exports.directory=__dirname;exports.same=this===exports;')
    const output = await loader.import(filename, { default: true })
    assert.equal(output.value, 42)
    assert.equal(output.same, true)
    assert.equal(output.filename, filename)
    assert.equal(output.directory, path.dirname(filename))
  }
})

test('the original CLI executes a typed file with the maintained loader', async (context) => {
  const directory = await temporary(context)
  const filename = path.join(directory, 'fixture.ts')
  await writeFile(filename, 'const answer:number=42;console.log(answer)')
  const metadata = require('jiti/package.json')
  assert.equal(metadata.version, '2.7.0-webops.1')
  const cli = path.resolve(path.dirname(require.resolve('jiti/package.json')), metadata.bin.jiti)
  assert.equal(execFileSync(process.execPath, [cli, filename], { cwd: directory, encoding: 'utf8', timeout: 20000 }).trim(), '42')
})

test('standalone public loader types accept cache policy and reject incompatible options', async (context) => {
  const directory = await temporary(context)
  const filename = path.join(directory, 'consumer.mts')
  await writeFile(filename, 'import {createJiti} from "jiti";const loader=createJiti(import.meta.url,{moduleCache:false,fsCache:false,tryNative:true});const result:Promise<unknown>=loader.import("./config.mjs");void result;')
  const flags = [
    '--ignoreConfig',
    '--noEmit',
    '--strict',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--types',
    'node',
  ]
  const compiler = require.resolve('typescript/lib/tsc.js')
  execFileSync(process.execPath, [compiler, ...flags, filename], { cwd: directory, encoding: 'utf8', timeout: 20000 })
  await writeFile(filename, 'import {createJiti} from "jiti";createJiti(import.meta.url,{moduleCache:"invalid"});')
  assert.throws(() => execFileSync(process.execPath, [compiler, ...flags, filename], { cwd: directory, encoding: 'utf8', timeout: 20000 }), error => error.status !== 0 && /TS2322/.test(error.stdout))
  assert.match(await readFile(path.join(root, 'node_modules/jiti/WEBOPS-COMPAT.json'), 'utf8'), /moduleCache:false/)
})
