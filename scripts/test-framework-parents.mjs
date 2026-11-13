import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as configuration from 'c12'
import { loadOptions } from 'nitropack'
import { rolldown } from 'rolldown'
import * as currentUtilities from 'rolldown/utils'

const root = path.resolve(import.meta.dirname, '..')
const reference = createRequire(path.join(root, 'vendor/framework-parents/upstream/package.json'))
const originalConfiguration = await import(pathToFileURL(reference.resolve('c12')))
const originalUtilities = await import(pathToFileURL(reference.resolve('rolldown/utils')))

async function temporary(context) {
  const base = path.join(root, '.ai-work/runs')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'framework-parents-'))
  context.after(() => rm(directory, { recursive: true }))
  return directory
}

function options(directory) {
  return {
    cwd: directory,
    name: 'fixture',
    dotenv: false,
    globalRc: false,
    rcFile: false,
    packageJson: false,
  }
}

async function until(predicate, message) {
  const deadline = Date.now() + 10000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, message)
    await delay(20)
  }
}

test('all actual framework consumers bind the qualified providers and complete original parent identities', () => {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages
  const original = JSON.parse(readFileSync(path.join(root, 'vendor/framework-parents/upstream/package-lock.json'), 'utf8')).packages
  for (const [name, version] of Object.entries({
    vite: '8.3.6+webops.3',
    nuxt: '4.6.4+webops.2',
    nitropack: '2.13.6+webops.1',
    rolldown: '1.3.2',
    c12: '4.0.0-rc.4',
  })) {
    const matches = Object.entries(lock).filter(([filename]) => filename.endsWith(`node_modules/${name}`))
    assert.ok(matches.length, name)
    for (const [filename, metadata] of matches)
      assert.equal(metadata.version, version, filename)
  }
  for (const [name, version] of Object.entries({
    vite: '8.3.6',
    nuxt: '4.6.4',
    nitropack: '2.13.6',
    rolldown: '1.2.16',
    c12: '3.3.4',
  }))
    assert.equal(original[`node_modules/${name}`].version, version)
  for (const name of ['vite', 'nuxt', '@nuxt/vite-builder']) {
    const consumer = createRequire(import.meta.resolve(name))
    assert.equal(consumer.resolve('rolldown'), fileURLToPath(import.meta.resolve('rolldown')))
  }
  const nitro = createRequire(import.meta.resolve('nitropack'))
  assert.equal(nitro.resolve('c12'), path.resolve(root, 'node_modules/c12/dist/index.mjs'))
})

for (const [version, provider] of [
  ['original', originalUtilities],
  ['current', currentUtilities],
]) {
  test(`native parser, transform, minifier and diagnostics preserve executable semantics: ${version}`, async () => {
    const source = 'const value: number = 21; export const answer = value * 2;'
    const ast = provider.parseSync('fixture.ts', source)
    assert.deepEqual(ast.errors, [])
    assert.equal(ast.program.type, 'Program')
    const transformed = provider.transformSync('fixture.ts', source, { sourcemap: true })
    assert.deepEqual(transformed.errors, [])
    assert.ok(transformed.map)
    const minified = provider.minifySync('fixture.mjs', transformed.code)
    assert.deepEqual(minified.errors, [])
    const result = await import(`data:text/javascript;base64,${Buffer.from(minified.code).toString('base64')}`)
    assert.equal(result.answer, 42)
    assert.ok(provider.parseSync('invalid.ts', 'const value: = ;').errors.length)
  })
}

test('the current native bundler retains dynamic chunks and runs its emitted entry', async (context) => {
  const directory = await temporary(context)
  await writeFile(path.join(directory, 'entry.mjs'), 'export async function value(){return (await import("./lazy.mjs")).answer}')
  await writeFile(path.join(directory, 'lazy.mjs'), 'export const answer=42')
  const bundle = await rolldown({
    input: path.join(directory, 'entry.mjs'),
    onLog(level, log) { assert.notEqual(level, 'error', log.message) },
  })
  context.after(() => bundle.close())
  const result = await bundle.write({
    dir: path.join(directory, 'output'),
    format: 'esm',
    entryFileNames: 'entry.mjs',
    chunkFileNames: '[name]-[hash].mjs',
    sourcemap: true,
  })
  assert.equal(result.output.filter(item => item.type === 'chunk').length, 2)
  const entry = await import(pathToFileURL(path.join(directory, 'output/entry.mjs')))
  assert.equal(await entry.value(), 42)
})

for (const [version, provider] of [
  ['original', originalConfiguration],
  ['current', configuration],
]) {
  test(`configuration layers, functions, environment overrides and repeat loading remain real: ${version}`, async (context) => {
    const directory = await temporary(context)
    await writeFile(path.join(directory, 'base.config.mjs'), 'export default {inherited:7,nested:{base:true}}')
    await writeFile(path.join(directory, 'fixture.config.mjs'), 'export default context=>({extends:["./base.config.mjs"],value:context.answer,nested:{local:true},$production:{secure:true}})')
    const result = await provider.loadConfig({
      ...options(directory),
      context: { answer: 42 },
      envName: 'production',
      defaults: { defaulted: true },
    })
    assert.equal(result.config.value, 42)
    assert.equal(result.config.inherited, 7)
    assert.equal(result.config.secure, true)
    assert.equal(result.config.defaulted, true)
    assert.deepEqual(result.config.nested, { base: true, local: true })
    await writeFile(path.join(directory, 'fixture.config.mjs'), 'export default {value:84}')
    assert.equal((await provider.loadConfig(options(directory))).config.value, 84)
  })

  test(`TypeScript compatibility loading rereads supported non-strip syntax: ${version}`, async (context) => {
    const directory = await temporary(context)
    const target = path.join(directory, 'fixture.config.ts')
    await writeFile(target, 'enum Value{answer=42};export default {answer:Value.answer}')
    assert.equal((await provider.loadConfig(options(directory))).config.answer, 42)
    await writeFile(target, 'enum Value{answer=84};export default {answer:Value.answer}')
    assert.equal((await provider.loadConfig(options(directory))).config.answer, 84)
  })
}

test('current configuration schema validation and environment ordering remain enforced', async (context) => {
  const directory = await temporary(context)
  await writeFile(path.join(directory, 'fixture.config.mjs'), 'export default {value:1,$first:{value:2},$second:{value:3}}')
  const schema = {
    '~standard': {
      version: 1,
      vendor: 'fixture',
      validate: input => ({
        value: { ...input, checked: true },
      }),
    },
  }
  const result = await configuration.loadConfig({
    ...options(directory),
    envName: ['first', 'second'],
    schema,
  })
  assert.equal(result.config.value, 3)
  assert.equal(result.config.checked, true)
  await assert.rejects(configuration.loadConfig({
    ...options(directory),
    schema: {
      '~standard': {
        version: 1,
        vendor: 'fixture',
        validate: () => ({
          issues: [
            { message: 'fixture rejected' },
          ],
        }),
      },
    },
  }), /fixture rejected/)
})

test('current dotenv loading preserves isolation and requires explicit file-reference expansion', async (context) => {
  const directory = await temporary(context)
  await writeFile(path.join(directory, 'fixture.env'), `FIXTURE_BASE=before\nFIXTURE_COMBINED=\${FIXTURE_BASE}-after\nFIXTURE_VALUE_FILE=${JSON.stringify(path.join(directory, 'sample-value.txt'))}\n`)
  await writeFile(path.join(directory, 'sample-value.txt'), 'synthetic-fixture-value\n')
  const before = { ...process.env }
  const basic = await configuration.loadDotenv({
    cwd: directory,
    fileName: 'fixture.env',
    env: {},
    interpolate: true,
  })
  assert.equal(basic.FIXTURE_COMBINED, 'before-after')
  assert.equal(basic.FIXTURE_VALUE, undefined)
  const expanded = await configuration.loadDotenv({
    cwd: directory,
    fileName: 'fixture.env',
    env: {},
    interpolate: true,
    expandFileReferences: true,
  })
  assert.equal(expanded.FIXTURE_VALUE, 'synthetic-fixture-value')
  assert.deepEqual({ ...process.env }, before)
})

test('the current native configuration watcher survives invalid updates and closes without residual events', async (context) => {
  const directory = await temporary(context)
  const filename = path.join(directory, 'fixture.config.mjs')
  await writeFile(filename, 'export default {value:1}')
  const events = []
  const updates = []
  const warnings = []
  const originalWarning = console.warn
  console.warn = (...messages) => warnings.push(messages.join(' '))
  context.after(() => {
    console.warn = originalWarning
  })
  const watched = await configuration.watchConfig({
    ...options(directory),
    debounce: 20,
    onWatch: event => events.push(event),
    onUpdate: value => updates.push(value),
  })
  context.after(() => watched.unwatch())
  assert.ok(watched.watchingFiles.includes(filename))
  await writeFile(filename, 'export default {')
  await until(() => warnings.length > 0, 'Invalid config must be observed and retained as a failure')
  assert.equal(watched.config.value, 1)
  await writeFile(filename, 'export default {value:2}')
  await until(() => watched.config.value === 2, 'Valid config recovery must arrive')
  assert.equal(updates.at(-1).newConfig.config.value, 2)
  assert.ok(events.some(event => event.type === 'updated'))
  await watched.unwatch()
  const count = events.length
  await writeFile(filename, 'export default {value:3}')
  await delay(100)
  assert.equal(events.length, count)
})

test('the actual Nitro parent reads and watches current-major configuration', async (context) => {
  const directory = await temporary(context)
  await writeFile(path.join(directory, 'nitro.config.mjs'), 'export default {runtimeConfig:{fixture:42}}')
  const current = await loadOptions({ rootDir: directory, preset: 'node-server', compatibilityDate: '2026-11-08' }, {
    watch: true,
    dotenv: false,
    c12: {
      globalRc: false,
      rcFile: false,
      packageJson: false,
      debounce: 20,
    },
  })
  context.after(() => current._c12.unwatch())
  assert.equal(current.runtimeConfig.fixture, 42)
  await writeFile(path.join(directory, 'nitro.config.mjs'), 'export default {runtimeConfig:{fixture:84}}')
  await until(() => current._c12.config.runtimeConfig.fixture === 84, 'Actual Nitro current-major configuration watcher must reload')
})
