import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { rollup } from 'rollup'

export const root = fileURLToPath(new URL('../..', import.meta.url))
export const addBytes = Uint8Array.from([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  7,
  1,
  96,
  2,
  127,
  127,
  1,
  127,
  3,
  2,
  1,
  0,
  7,
  7,
  1,
  3,
  97,
  100,
  100,
  0,
  0,
  10,
  9,
  1,
  7,
  0,
  32,
  0,
  32,
  1,
  106,
  11,
])
export const importBytes = Uint8Array.from([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  5,
  1,
  96,
  0,
  1,
  127,
  2,
  14,
  1,
  3,
  101,
  110,
  118,
  6,
  111,
  102,
  102,
  115,
  101,
  116,
  0,
  0,
  7,
  9,
  1,
  5,
  118,
  97,
  108,
  117,
  101,
  0,
  0,
])

export async function providers(original = false) {
  const directory = original === 'current'
    ? path.join(root, 'vendor/nitro-tools/current')
    : original
      ? path.join(root, 'vendor/nitro-tools/upstream')
      : root
  const require = createRequire(path.join(directory, 'package.json'))
  const wasmEntry = require.resolve('unwasm/plugin')
  assert.ok(wasmEntry.startsWith(path.join(directory, 'node_modules/')))
  return {
    context: await import(pathToFileURL(path.join(original === 'current'
      ? root
      : directory, 'node_modules/unctx/dist/index.mjs'))),
    wasm: await import(pathToFileURL(wasmEntry)),
    tools: await import(pathToFileURL(require.resolve('unwasm/tools'))),
  }
}

export async function wasmBundle(directory, options = {}, original = false, mode = 'named', outputOptions = {}) {
  await mkdir(directory, { recursive: true })
  const imported = mode === 'imports' || mode === 'imports-missing'
  const bytes = imported
    ? importBytes
    : mode === 'invalid'
      ? Uint8Array.from([0, 1, 2])
      : addBytes
  const filename = path.join(directory, 'fixture.wasm')
  await writeFile(filename, bytes)
  const source = mode === 'module'
    ? 'import module from "./fixture.wasm?module";export async function run(){return new WebAssembly.Instance(await module).exports.add(20,22)}'
    : mode === 'imports-missing'
      ? 'import {value} from "./fixture.wasm";export async function run(){return await value()}'
      : imported
        ? 'import init,{value} from "./fixture.wasm";export async function run(){await init({env:{offset:()=>42}});return await value()}'
        : mode === 'invalid'
          ? 'import module from "./fixture.wasm";export default module;'
          : 'import {add} from "./fixture.wasm";export async function run(){return await add(20,22)}'
  await writeFile(path.join(directory, 'entry.js'), source)
  const provider = await providers(original)
  const warnings = []
  const bundle = await rollup({
    input: path.join(directory, 'entry.js'),
    plugins: [
      provider.wasm.rollup(options),
    ],
    onwarn: warning => warnings.push(warning),
  })
  try {
    const result = await bundle.generate({ format: 'es', sourcemap: true, ...outputOptions })
    const entry = result.output.find(item => item.type === 'chunk' && item.isEntry)
    assert.ok(entry?.map)
    if (mode !== 'invalid')
      assert.ok(entry.map.sourcesContent.includes(source))
    return {
      code: entry.code,
      map: entry.map,
      assets: result.output.filter(item => item.type === 'asset'),
      warnings,
    }
  }
  finally {
    await bundle.close()
  }
}

let execution = 0
export function importBundle(code) {
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#nitro-wasm-${execution++}`)
}
