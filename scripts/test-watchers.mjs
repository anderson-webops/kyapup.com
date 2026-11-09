import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { recoverThrottledChanges } from '@nuxt/kit'
import { watchConfig } from 'c12'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const originalRequire = createRequire(path.join(root, 'vendor/watchers/upstream/package.json'))
const current = await import('chokidar')
const original = await import(pathToFileURL(originalRequire.resolve('chokidar')))

function metadata(entry) {
  let directory = path.dirname(entry)
  while (!existsSync(path.join(directory, 'package.json')))
    directory = path.dirname(directory)
  return JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
}

async function temporary(context) {
  const parent = path.join(root, '.ai-work/runs')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(path.join(parent, 'watcher-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function until(predicate, label) {
  const deadline = Date.now() + 8000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, label)
    await delay(20)
  }
}

async function watcher(context, provider, directory, options = {}) {
  const events = []
  const errors = []
  const instance = provider.watch(directory, { cwd: directory, ...options })
  context.after(() => instance.close())
  instance.on('all', (event, filename) => events.push({ event, filename }))
  instance.on('error', error => errors.push(error))
  await once(instance, 'ready', {
    signal: AbortSignal.timeout(8000),
  })
  assert.deepEqual(errors, [])
  return { instance, events, errors }
}

test('every actual parent resolves the current native watcher and Nuxt kit without legacy nested copies', () => {
  const names = [
    'nuxt',
    'nitropack',
    'c12',
    'unstorage',
    '@nuxt/eslint',
    '@eslint/config-inspector',
    '@unocss/cli',
    '@unocss/rollup',
    '@unocss/vite',
    '@unocss/webpack',
    'vite-plugin-checker',
    'vue-router',
  ]
  const selected = require.resolve('chokidar')
  for (const name of names) {
    const entry = name === '@eslint/config-inspector'
      ? path.join(root, 'node_modules/@eslint/config-inspector/bin.mjs')
      : fileURLToPath(import.meta.resolve(name))
    assert.ok(existsSync(entry), name)
    const consumer = createRequire(entry)
    assert.equal(consumer.resolve('chokidar'), selected, name)
    assert.equal(metadata(consumer.resolve('chokidar')).version, '6.0.0')
  }
  for (const name of ['nuxt', '@nuxt/eslint']) {
    const consumer = createRequire(fileURLToPath(import.meta.resolve(name)))
    assert.equal(metadata(consumer.resolve('@nuxt/devtools-kit')).version, '4.1.0')
  }
  const nuxt = createRequire(fileURLToPath(import.meta.resolve('nuxt')))
  assert.equal(metadata(nuxt.resolve('@nuxt/devtools')).version, '4.1.0')
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  for (const [location, info] of Object.entries(lock.packages)) {
    if (location.endsWith('/chokidar'))
      assert.equal(info.version, '6.0.0', location)
    if (location.endsWith('/@nuxt/devtools') || location.endsWith('/@nuxt/devtools-kit'))
      assert.equal(info.version, '4.1.0', location)
  }
})

for (const [version, provider] of [
  ['5', original],
  ['6', current],
]) {
  for (const polling of [false, true]) {
    test(`native file lifecycle and exclusions:version=${version},polling=${polling}`, async (context) => {
      const directory = await temporary(context)
      await writeFile(path.join(directory, 'value.txt'), 'initial')
      const state = await watcher(context, provider, directory, {
        usePolling: polling,
        interval: 20,
        atomic: true,
        ignored: filename => filename.endsWith('.ignore'),
      })
      assert.ok(state.events.some(item => item.event === 'add' && item.filename === 'value.txt'))
      state.events.length = 0
      await writeFile(path.join(directory, 'value.txt'), 'changed')
      await until(() => state.events.some(item => item.event === 'change' && item.filename === 'value.txt'), 'existing file change must arrive')
      await writeFile(path.join(directory, 'new.txt'), 'added')
      await until(() => state.events.some(item => item.event === 'add' && item.filename === 'new.txt'), 'new file must arrive')
      await rm(path.join(directory, 'new.txt'))
      await until(() => state.events.some(item => item.event === 'unlink' && item.filename === 'new.txt'), 'deleted file must arrive')
      await writeFile(path.join(directory, 'ignored.ignore'), 'private synthetic noise')
      await writeFile(path.join(directory, 'next.txt'), 'positive control')
      await until(() => state.events.some(item => item.event === 'add' && item.filename === 'next.txt'), 'positive control must arrive')
      assert.ok(state.events.every(item => item.filename !== 'ignored.ignore'))
      assert.equal(state.instance.unwatch(path.join(directory, 'value.txt')), state.instance)
      state.events.length = 0
      await writeFile(path.join(directory, 'value.txt'), 'unwatched')
      await writeFile(path.join(directory, 'control.txt'), 'control')
      await until(() => state.events.some(item => item.filename === 'control.txt'), 'control after unwatch must arrive')
      assert.ok(state.events.every(item => item.filename !== 'value.txt'))
      await state.instance.close()
      await state.instance.close()
      const before = state.events.length
      await writeFile(path.join(directory, 'closed.txt'), 'closed')
      await delay(100)
      assert.equal(state.events.length, before)
      assert.equal(state.instance.closed, true)
      assert.deepEqual(Object.keys(state.instance.getWatched()), [])
      assert.deepEqual(state.errors, [])
    })
  }

  test(`atomic replacement and stable-write options retain real contents:version=${version}`, async (context) => {
    const directory = await temporary(context)
    const target = path.join(directory, 'value.txt')
    await writeFile(target, 'before')
    const state = await watcher(context, provider, directory, {
      ignoreInitial: true,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 10 },
    })
    await writeFile(path.join(directory, 'replacement'), 'first')
    await rename(path.join(directory, 'replacement'), target)
    await delay(35)
    await appendFile(target, '-second')
    await until(() => state.events.some(item => item.filename === 'value.txt'), 'stable replacement must arrive')
    assert.equal(await readFile(target, 'utf8'), 'first-second')
    assert.equal(state.events.filter(item => item.filename === 'value.txt').length, 1)
  })
}

test('current missing-root recovery and explicit re-add survive repeated removal', async (context) => {
  const directory = await temporary(context)
  const target = path.join(directory, 'later.txt')
  const state = await watcher(context, current, target, { cwd: directory, ignoreInitial: true })
  for (let round = 0; round < 2; round++) {
    state.events.length = 0
    await writeFile(target, String(round))
    await until(() => state.events.some(item => item.event === 'add'), 'missing watched file must be recovered')
    await rm(target)
    await until(() => state.events.some(item => item.event === 'unlink'), 'removal must be reported')
  }
  state.instance.unwatch(target)
  assert.equal(state.instance.add(target), state.instance)
  state.events.length = 0
  await writeFile(target, 're-added')
  await until(() => state.events.some(item => item.event === 'add'), 'explicit re-add must recover')
})

test('current symlink and special directory paths retain containment and safe watched metadata', async (context) => {
  const directory = await temporary(context)
  const observed = path.join(directory, 'observed')
  const external = path.join(directory, 'target')
  await mkdir(path.join(observed, '__proto__'), { recursive: true })
  await mkdir(external)
  await writeFile(path.join(external, 'value.txt'), 'linked')
  await writeFile(path.join(observed, '__proto__/value.txt'), 'ordinary own key')
  await symlink(external, path.join(observed, 'link'))
  const state = await watcher(context, current, observed, { followSymlinks: false })
  assert.ok(state.events.every(item => !item.filename.includes('link/value.txt')))
  const watched = state.instance.getWatched()
  assert.equal(Object.getPrototypeOf(watched), null)
  assert.ok(Object.hasOwn(watched, '__proto__'))
  assert.ok(Object.getOwnPropertyDescriptor(watched, '__proto__').value.includes('value.txt'))
  assert.equal(Object.prototype.value, undefined)
})

test('the actual Nuxt throttle-recovery adapter remains removable and reports native changes', async (context) => {
  const directory = await temporary(context)
  const target = path.join(directory, 'value.txt')
  await writeFile(target, 'initial')
  const state = await watcher(context, current, directory, { alwaysStat: true })
  const dispose = recoverThrottledChanges(state.instance)
  context.after(dispose)
  for (let round = 0; round < 3; round++) {
    state.events.length = 0
    await writeFile(target, `changed-${round}`)
    await until(() => state.events.some(item => item.event === 'change'), 'Nuxt adapter must retain native changes')
  }
  dispose()
  dispose()
})

test('the actual C12 configuration watcher reloads and closes cleanly', async (context) => {
  const directory = await temporary(context)
  const target = path.join(directory, 'fixture.config.mjs')
  await writeFile(target, 'export default {value:1}')
  const updates = []
  const config = await watchConfig({
    name: 'fixture',
    cwd: directory,
    dotenv: false,
    onUpdate: update => updates.push(update),
    debounce: 20,
  })
  context.after(() => config.unwatch())
  assert.equal(config.config.value, 1)
  await delay(100)
  await writeFile(target, 'export default {value:2}')
  await until(() => updates.some(item => item.newConfig.config.value === 2), 'C12 reload must arrive')
  assert.equal(config.config.value, 2)
  await config.unwatch()
})

for (const format of ['esm', 'cjs']) {
  test(`actual Unstorage filesystem driver watches and disposes with ${format}`, async (context) => {
    const directory = await temporary(context)
    const factory = format === 'esm'
      ? (await import('unstorage/drivers/fs')).default
      : require('unstorage/drivers/fs')
    const driver = factory({ base: directory })
    context.after(() => driver.dispose())
    const events = []
    const unwatch = await driver.watch((event, key) => events.push({ event, key }))
    await driver.setItem('value', '42')
    await until(() => events.some(item => item.event === 'update' && item.key === 'value'), 'Unstorage update must arrive')
    assert.equal(await driver.getItem('value'), '42')
    await driver.removeItem('value')
    await until(() => events.some(item => item.event === 'remove' && item.key === 'value'), 'Unstorage removal must arrive')
    await unwatch()
    await driver.dispose()
  })
}

test('strict native watcher types retain supported lifecycle contracts', async (context) => {
  const directory = await temporary(context)
  const source = 'import {watch,type FSWatcher,type ChokidarOptions} from "chokidar";const options:ChokidarOptions={atomic:true,awaitWriteFinish:{stabilityThreshold:100,pollInterval:10},ignored:(filename,stats)=>Boolean(stats?.isFile()&&filename.endsWith(".ignore"))};const watcher:FSWatcher=watch(".",options);watcher.on("change",filename=>filename.toUpperCase());const closed:Promise<void>=watcher.close();void closed;'
  await writeFile(path.join(directory, 'positive.mts'), source)
  await writeFile(path.join(directory, 'negative.mts'), 'import {watch} from "chokidar";watch(".",{awaitWriteFinish:{stabilityThreshold:"bad"}});')
  const compiler = require.resolve('typescript/lib/tsc.js')
  const flags = [
    '--ignoreConfig',
    '--noEmit',
    '--strict',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--types',
    'node',
  ]
  execFileSync(process.execPath, [
    compiler,
    ...flags,
    path.join(directory, 'positive.mts'),
  ], { cwd: directory, encoding: 'utf8', timeout: 30000 })
  assert.throws(() => execFileSync(process.execPath, [
    compiler,
    ...flags,
    path.join(directory, 'negative.mts'),
  ], { cwd: directory, encoding: 'utf8', timeout: 30000 }), error => error.status !== 0 && /TS2322/.test(error.stdout))
})
