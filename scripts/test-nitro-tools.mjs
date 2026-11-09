import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { addBytes, importBundle, importBytes, providers, root, wasmBundle } from './fixtures/nitro-tools.mjs'

const require = createRequire(import.meta.url)

async function temporary(context) {
  const parent = path.join(root, '.ai-work/runs')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(path.join(parent, 'nitro-tools-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('the source-preserved Nitro parent resolves all qualified native and current configuration providers', () => {
  const nitro = createRequire(import.meta.resolve('nitropack'))
  const metadata = JSON.parse(readFileSync(nitro.resolve('nitropack/package.json'), 'utf8'))
  assert.equal(metadata.version, '2.13.6+webops.1')
  const original = JSON.parse(readFileSync(path.join(path.dirname(nitro.resolve('nitropack/package.json')), 'UPSTREAM-PACKAGE.json'), 'utf8'))
  assert.equal(original.version, '2.13.6')
  assert.equal(original.dependencies.c12, '^3.3.4')
  assert.equal(metadata.dependencies.c12, '^4.0.0-rc.4')
  assert.equal(nitro.resolve('c12'), require.resolve('c12'))
  assert.equal(metadata.dependencies.unctx, '^2.5.0')
  assert.equal(metadata.dependencies['magic-string'], '^0.30.21')
  assert.equal(metadata.dependencies.unwasm, '^0.5.3')
  for (const name of ['unctx', 'magic-string'])
    assert.equal(nitro.resolve(name), require.resolve(name))
  assert.equal(nitro.resolve('unwasm/plugin'), require.resolve('unwasm/plugin'))
  assert.equal(JSON.parse(readFileSync(path.join(root, 'node_modules/unctx/package.json'), 'utf8')).version, '3.0.1')
  assert.equal(JSON.parse(readFileSync(path.join(root, 'node_modules/unwasm/package.json'), 'utf8')).version, '0.6.3-webops.1')
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  assert.equal(lock.packages['node_modules/nitropack/node_modules/unctx'], undefined)
  for (const [name, packageInfo] of Object.entries(lock.packages)) {
    if (name.endsWith('/magic-string'))
      assert.match(packageInfo.version, /^1\./, name)
  }
})

for (const original of [false, true]) {
  const tools = await providers(original)
  test(`native context isolation, nesting and cleanup with original=${original}`, async () => {
    const namespace = tools.context.createNamespace({ asyncContext: true, AsyncLocalStorage })
    const context = namespace.get('fixture')
    assert.equal(namespace.get('fixture'), context)
    assert.throws(() => context.use(), /not available/)
    await Promise.all(Array.from({ length: 64 }, async (_unused, index) => {
      const instance = { id: `fixture-${index}` }
      await context.callAsync(instance, async () => {
        assert.equal(context.use(), instance)
        await delay(index % 4)
        assert.equal(context.use(), instance)
        const nested = namespace.get('nested')
        await nested.callAsync({ id: 'nested' }, async () => {
          await delay(1)
          assert.equal(context.use(), instance)
          assert.equal(nested.use().id, 'nested')
        })
      })
    }))
    assert.throws(() => context.use(), /not available/)
    assert.equal(context.tryUse(), original ? undefined : null)
    await assert.rejects(context.callAsync({ id: 'failure' }, async () => {
      await delay(1)
      throw new Error('synthetic context failure')
    }), /synthetic context failure/)
    assert.throws(() => context.use(), /not available/)
    context.set({ id: 'singleton' })
    assert.equal(context.use().id, 'singleton')
    assert.throws(() => context.set({ id: 'conflict' }), /conflict/)
    context.unset()
    assert.throws(() => context.use(), /not available/)
  })

  test(`WASM parser metadata agrees with the native engine with original=${original}`, () => {
    for (const bytes of [addBytes, importBytes]) {
      const module = new WebAssembly.Module(bytes)
      const parsed = tools.tools.parseWasm(bytes)
      assert.deepEqual(parsed.modules.flatMap(module => module.exports.map(item => item.name)), WebAssembly.Module.exports(module).map(item => item.name))
      assert.deepEqual(parsed.modules.flatMap(module => module.imports.map(item => ({ name: item.name, module: item.module }))), WebAssembly.Module.imports(module).map(item => ({ name: item.name, module: item.module })))
    }
    assert.throws(() => tools.tools.parseWasm(Uint8Array.from([0, 1, 2])))
  })

  for (const mode of original
    ? ['named']
    : ['named', 'module', 'imports']) {
    for (const lazy of [false, true]) {
      test(`actual WASM Rollup bindings mode=${mode}, lazy=${lazy}, original=${original}`, async (context) => {
        const scratch = await temporary(context)
        const result = await wasmBundle(scratch, { lazy }, original, mode)
        assert.deepEqual(result.warnings, [])
        const output = await importBundle(result.code)
        assert.equal(await output.run(), 42)
      })
    }
  }

  test(`invalid WASM remains an explicit warning and native compile rejection with original=${original}`, async (context) => {
    const scratch = await temporary(context)
    const result = await wasmBundle(scratch, {}, original, 'invalid')
    assert.equal(result.warnings.length, original ? 0 : 1)
    if (!original)
      assert.match(result.warnings[0].message, /Failed to parse.*WebAssembly/)
    await assert.rejects(importBundle(result.code), WebAssembly.CompileError)
  })
}

for (const version of [true, 'current']) {
  for (const [mode, code] of [
    ['module', 'UNRESOLVED_IMPORT'],
    ['imports', 'MISSING_EXPORT'],
  ]) {
    test(`stock provider=${version} explicitly reproduces ${mode} binding failure`, async (context) => {
      const scratch = await temporary(context)
      await assert.rejects(wasmBundle(scratch, {}, version, mode), error => error.code === code)
    })
  }
}

test('current native context discovery works without supplying a constructor and remains isolated', async () => {
  const { context: tools } = await providers()
  const context = tools.createContext({ asyncContext: true })
  await Promise.all(Array.from({ length: 32 }, (_unused, index) => context.callAsync({ id: index }, async () => {
    await delay(index % 3)
    assert.equal(context.use().id, index)
  })))
  assert.equal(context.tryUse(), null)
})

test('manual WASM binding rejects missing imports through the native engine', async (context) => {
  const scratch = await temporary(context)
  const result = await wasmBundle(scratch, {}, false, 'imports-missing')
  assert.deepEqual(result.warnings, [])
  const module = await importBundle(result.code)
  await assert.rejects(module.run(), error => error instanceof TypeError || error instanceof WebAssembly.LinkError)
})

for (const nested of [false, true]) {
  test(`actual WASM asset publication preserves bytes and current editor source maps with nested=${nested}`, async (context) => {
    const scratch = await temporary(context)
    const result = await wasmBundle(scratch, { esmImport: true }, false, 'named', {
      entryFileNames: nested ? 'nested/entry.mjs' : 'entry.mjs',
    })
    assert.deepEqual(result.warnings, [])
    const assets = result.assets.filter(asset => asset.fileName.endsWith('.wasm'))
    assert.equal(assets.length, 1)
    const asset = assets[0]
    assert.deepEqual(Buffer.from(asset.source), Buffer.from(addBytes))
    assert.ok(asset.fileName.startsWith('wasm/'))
    assert.ok(result.code.includes(`${nested ? '../' : './'}${asset.fileName}`))
    assert.equal(result.code.includes('unwasm:external:'), false)
    assert.ok(result.map.sourcesContent.length > 0)
  })
}

test('the actual legacy Deno text-editing hooks preserve specifiers, content and source maps', async () => {
  const filename = path.join(root, 'node_modules/nitropack/dist/presets/deno/preset-legacy.mjs')
  const { denoServerLegacy } = await import(pathToFileURL(filename))
  const preset = typeof denoServerLegacy === 'function'
    ? await denoServerLegacy()
    : denoServerLegacy
  const plugins = preset.rollupConfig.plugins
  const rewrite = plugins.find(plugin => plugin.name === 'rollup-plugin-node-deno')
  const source = 'import path from "path";import value from "package-value";import other from "./local.mjs";export {path,value,other};'
  const result = rewrite.renderChunk(source)
  assert.match(result.code, /"node:path"/)
  assert.match(result.code, /"npm:package-value"/)
  assert.match(result.code, /"\.\/local.mjs"/)
  assert.ok(result.map.sourcesContent.includes(source))
  const injection = plugins.find(plugin => plugin.name === 'inject-process')
  const inject = injection.renderChunk.handler('export const current=import.meta.url;', { isEntry: true })
  assert.match(inject.code, /globalThis\.process=globalThis\.process\|\|__process__/)
  assert.ok(inject.map)
})

test('current context and WASM public declarations accept correct providers and reject invalid inputs', async (context) => {
  const scratch = await temporary(context)
  await writeFile(path.join(scratch, 'positive.ts'), 'import {createContext} from "unctx";import {unwasm} from "unwasm/plugin";import {parseWasm} from "unwasm/tools";import type {Plugin} from "rollup";const context=createContext<{id:string}>({asyncContext:true});const value:{id:string}|null=context.tryUse();context.callAsync({id:"fixture"},async()=>context.use().id);const plugin:Plugin=unwasm({lazy:false,esmImport:false,silent:false});const parsed=parseWasm(new Uint8Array());void [value,plugin,parsed];')
  const configuration = {
    compilerOptions: {
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      target: 'ESNext',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      types: ['node'],
    },
    files: ['positive.ts'],
  }
  const config = path.join(scratch, 'tsconfig.json')
  await writeFile(config, JSON.stringify(configuration))
  const args = [
    require.resolve('typescript/lib/tsc.js'),
    '--project',
    config,
  ]
  execFileSync(process.execPath, args, { cwd: scratch, encoding: 'utf8', timeout: 20_000 })
  await writeFile(path.join(scratch, 'negative.ts'), 'import {createContext} from "unctx";import {unwasm} from "unwasm/plugin";import {parseWasm} from "unwasm/tools";createContext<{id:string}>().call({id:42},()=>{});unwasm({lazy:"wrong"});parseWasm("wrong");')
  await writeFile(config, JSON.stringify({
    ...configuration,
    files: ['negative.ts'],
  }))
  assert.throws(() => execFileSync(process.execPath, args, {
    cwd: scratch,
    encoding: 'utf8',
    timeout: 20_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }), error => error.status !== 0 && /TS2322/.test(error.stdout) && /TS2345/.test(error.stdout))
})
