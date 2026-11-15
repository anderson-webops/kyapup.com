import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { dump as consoleDump } from '@poppinss/dumper/console'
import { dump as htmlDump } from '@poppinss/dumper/html'
import { balanced, range } from 'balanced-match'
import { expand } from 'brace-expansion'
import { globsToMatcher, isPromise, pluralize } from 'jest-util'

const root = path.resolve(import.meta.dirname, '..')
const current = createRequire(import.meta.url)
const reference = createRequire(path.join(root, 'vendor/terminal-parents/upstream/package.json'))
const originalBrace = await import(pathToFileURL(reference.resolve('brace-expansion')))
const originalConsole = await import(pathToFileURL(reference.resolve('@poppinss/dumper/console')))
const originalHTML = await import(pathToFileURL(reference.resolve('@poppinss/dumper/html')))
const originalMinimizer = createRequire(reference.resolve('minimizer-webpack-plugin'))

async function temporary(context) {
  const parent = path.join(root, '.ai-work/runs')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(path.join(parent, 'terminal-parents-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('all actual parent and provider consumers bind current qualified identities', () => {
  const records = JSON.parse(readFileSync(path.join(root, 'vendor/terminal-parents/UPSTREAM.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages
  for (const [name, record] of Object.entries(records)) {
    assert.equal(JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version, record.patchedVersion)
    assert.equal(JSON.parse(readFileSync(path.join(root, 'vendor/terminal-parents/upstream/node_modules', name, 'package.json'), 'utf8')).version, record.package.version)
  }
  for (const [name, version] of Object.entries({
    'balanced-match': '5.0.0',
    'supports-color': '11.0.0',
    '@sindresorhus/is': '8.1.0',
    'chalk': '6.0.1',
  })) {
    const consumers = Object.entries(lock).filter(([filename]) => filename.endsWith(`node_modules/${name}`))
    assert.ok(consumers.length, name)
    for (const [filename, metadata] of consumers)
      assert.equal(metadata.version, version, filename)
  }
  assert.equal(createRequire(current.resolve('minimizer-webpack-plugin')).resolve('jest-worker'), current.resolve('jest-worker'))
  assert.equal(createRequire(current.resolve('jest-worker')).resolve('supports-color'), current.resolve('supports-color'))
  assert.equal(createRequire(current.resolve('jest-util')).resolve('chalk'), current.resolve('chalk'))
  assert.equal(createRequire(current.resolve('@poppinss/dumper')).resolve('@sindresorhus/is'), current.resolve('@sindresorhus/is'))
  assert.equal(JSON.parse(readFileSync(originalMinimizer.resolve('jest-worker/package.json'), 'utf8')).version, '27.5.1')
})

for (const pattern of [
  'prefix-{one,two}-{1..3}',
  '{a,{b,c},d}',
  '{01..05..2}',
  '{5..1..2}',
  '{a..e..2}',
  'literal\\{not,expanded\\}',
  'a{b,c{d,e}}f',
  '{,,value}',
  `\${untouched}`,
  'a{unclosed',
  '☀{café,😀}',
]) {
  test(`actual expansion retains the original result for ${pattern}`, () => {
    assert.deepEqual(expand(pattern), originalBrace.expand(pattern))
  })
}

test('Balanced-match5 retains named CommonJS/ESM ranges, regex positions and unmatched behavior', () => {
  const common = current('balanced-match')
  assert.deepEqual(common.balanced('{', '}', 'pre{one{two}three}post'), balanced('{', '}', 'pre{one{two}three}post'))
  assert.deepEqual(range('{', '}', 'pre{one{two}three}post'), [3, 17])
  assert.deepEqual(balanced(/\{/, /\}/, 'a{b}c'), {
    start: 1,
    end: 3,
    pre: 'a',
    body: 'b',
    post: 'c',
  })
  assert.equal(range('{', '}', 'none'), undefined)
  assert.equal(balanced(/missing/, /\}/, 'a{b}c'), undefined)
})

function normalizedHTML(output) {
  const match = /^<div id="(dump-[\w-]{15})" class="dumper-dump">/.exec(output)
  assert.ok(match, 'A real randomized dump root is required')
  assert.equal(output.split(match[1]).length, 3)
  return output.replaceAll(match[1], 'dump-fixture')
}

const formatterCases = [
  [
    'primitives',
    () => ({
      zero: 0,
      nil: null,
      missing: undefined,
      truth: true,
      bigint: 42n,
      symbol: Symbol('fixture'),
    }),
  ],
  [
    'strings',
    () => ({ html: '<img src=x onerror="globalThis.__injected=true">', unicode: 'café ☀ 😀', multiline: 'first\nsecond' }),
  ],
  [
    'collections',
    () => ({
      list: [1, 'two'],
      mapping: new Map([
        ['label', 3],
      ]),
      values: new Set([1, 2]),
      bytes: new Uint8Array([2, 4]),
    }),
  ],
  [
    'native values',
    () => ({
      date: new Date('2026-01-01T00:00:00Z'),
      expression: /fixture/gi,
      buffer: Buffer.from('fixture'),
      view: new DataView(new ArrayBuffer(4)),
    }),
  ],
  [
    'classes and functions',
    () => ({
      Sample: class Sample {},
      instance: new (class Sample {})(),
      callable: function namedFixture() {},
      async: async function asyncFixture() {},
    }),
  ],
  [
    'cycles',
    () => {
      const value = { label: 'circular' }
      value.self = value
      return value
    },
  ],
  [
    'null prototypes',
    () => Object.assign(Object.create(null), {
      label: 'kept',
      nested: { value: 2 },
    }),
  ],
]
for (const [name, makeValue] of formatterCases) {
  test(`Is8 preserves actual console and HTML formatting for ${name}`, () => {
    const configuration = { depth: 3, maxArrayLength: 4, cspNonce: 'synthetic-dumper-nonce' }
    assert.equal(stripVTControlCharacters(consoleDump(makeValue(), configuration)), stripVTControlCharacters(originalConsole.dump(makeValue(), configuration)))
    assert.equal(normalizedHTML(htmlDump(makeValue(), configuration)), normalizedHTML(originalHTML.dump(makeValue(), configuration)))
  })
}

test('HTML preserves nonce, escaping and bounded structures without evaluating getters', () => {
  let getterReads = 0
  const value = {
    label: '<script>globalThis.__injected=true</script>',
    nested: {
      hidden: { deeper: true },
    },
    values: Array.from({ length: 20 }, (unused, index) => index),
  }
  Object.defineProperty(value, 'getter', {
    enumerable: true,
    get() {
      getterReads++
      return 'unexpected'
    },
  })
  const result = htmlDump(value, { depth: 1, maxArrayLength: 2, cspNonce: 'synthetic-dumper-nonce' })
  assert.match(result, /nonce="synthetic-dumper-nonce"/)
  assert.doesNotMatch(result, /<script>globalThis\.__injected/)
  assert.match(result, /&lt;script&gt;/)
  assert.match(result, /dumperActivate/)
  assert.equal(getterReads, 0)
  assert.equal(normalizedHTML(result), normalizedHTML(originalHTML.dump(value, { depth: 1, maxArrayLength: 2, cspNonce: 'synthetic-dumper-nonce' })))
})

test('Jest-util retains actual matcher, promise and plural APIs with current Chalk6', () => {
  const matcher = globsToMatcher(['**/*.js', '!**/ignored/**'])
  assert.equal(matcher('src/index.js'), true)
  assert.equal(matcher('src/.hidden.js'), true)
  assert.equal(matcher('src/ignored/index.js'), false)
  assert.equal(matcher('src/index.ts'), false)
  assert.equal(isPromise(Promise.resolve(1)), true)
  assert.equal(isPromise({ then: 1 }), false)
  assert.equal(pluralize('item', 1), '1 item')
  assert.equal(pluralize('item', 2), '2 items')
})

const workerFixture = `const {threadId,isMainThread}=require('node:worker_threads');const fs=require('node:fs');let active=0;let peak=0;exports.work=async function(id){active++;peak=Math.max(active,peak);await new Promise(resolve=>setTimeout(resolve,15));active--;return{id,pid:process.pid,threadId,isMainThread,peak}};exports.roundTrip=value=>value;exports.fail=()=>{const error=new Error('synthetic worker failure');error.code='ERR_SYNTHETIC_WORKER';throw error};exports.emitOutput=()=>{process.stdout.write('synthetic-worker-stdout\\n');process.stderr.write('synthetic-worker-stderr\\n');return true};exports.color=()=>process.env.FORCE_COLOR??null;exports.crashOnce=filename=>{if(!fs.existsSync(filename)){fs.writeFileSync(filename,'synthetic restart marker');process.exit(17)}return{status:'recovered',pid:process.pid,threadId}};`

async function waitForProcessExit(processIds) {
  const deadline = Date.now() + 3000
  while (true) {
    const alive = [...processIds].filter((processId) => {
      try {
        process.kill(processId, 0)
        return true
      }
      catch (error) {
        if (error.code !== 'ESRCH')
          throw error
        return false
      }
    })
    if (!alive.length)
      return
    assert.ok(Date.now() < deadline, `Owned worker processes must exit: ${alive.join(',')}`)
    await delay(20)
  }
}

for (const [name, requireWorker] of [
  ['legacy27', originalMinimizer],
  ['original30', reference],
  ['current30', current],
]) {
  for (const threads of [false, true]) {
    test(`${name} retains bounded ${threads ? 'thread' : 'process'} queues, serialization, errors and recovery`, { timeout: 20000 }, async (context) => {
      const directory = await temporary(context)
      const filename = path.join(directory, 'worker.cjs')
      await writeFile(filename, workerFixture)
      const { Worker } = requireWorker('jest-worker')
      const farm = new Worker(filename, {
        numWorkers: 2,
        enableWorkerThreads: threads,
        maxRetries: 2,
        forkOptions: { serialization: 'advanced' },
      })
      let ended = false
      context.after(async () => {
        if (!ended)
          await farm.end()
      })
      let stdout = ''
      let stderr = ''
      farm.getStdout().on('data', (chunk) => {
        stdout += chunk.toString()
      })
      farm.getStderr().on('data', (chunk) => {
        stderr += chunk.toString()
      })
      const results = await Promise.all(Array.from({ length: 12 }, (unused, index) => farm.work(index)))
      assert.deepEqual(results.map(result => result.id), Array.from({ length: 12 }, (unused, index) => index))
      assert.equal(new Set(results.map(result => `${result.pid}:${result.threadId}`)).size, 2)
      assert.ok(results.every(result => result.peak === 1 && result.isMainThread !== threads))
      const value = {
        integer: 42n,
        date: new Date('2026-01-01T00:00:00Z'),
        bytes: new Uint8Array([1, 3]),
        mapping: new Map([
          ['key', 5],
        ]),
      }
      assert.deepEqual(await farm.roundTrip(value), value)
      await assert.rejects(farm.fail(), error => error.message === 'synthetic worker failure' && error.code === 'ERR_SYNTHETIC_WORKER')
      assert.equal((await farm.work('after-error')).id, 'after-error')
      assert.equal(await farm.emitOutput(), true)
      const recovered = await farm.crashOnce(path.join(directory, 'restart-marker'))
      assert.equal(recovered.status, 'recovered')
      assert.equal(await readFile(path.join(directory, 'restart-marker'), 'utf8'), 'synthetic restart marker')
      const result = await farm.end()
      ended = true
      assert.equal(result.forceExited, false)
      assert.match(stdout, /synthetic-worker-stdout/)
      assert.match(stderr, /synthetic-worker-stderr/)
      if (!threads) {
        await waitForProcessExit(new Set([
          ...results.map(result => result.pid),
          recovered.pid,
        ]))
      }
    })
  }
}

test('current worker really propagates the ESM provider color result after the environment changes', async (context) => {
  const directory = await temporary(context)
  const fixture = path.join(directory, 'worker.cjs')
  await writeFile(fixture, workerFixture)
  const driver = path.join(directory, 'color.cjs')
  await writeFile(driver, `const assert=require('node:assert/strict');const {createRequire}=require('node:module');const local=createRequire(process.argv[2]);const color=local('supports-color');assert.ok((color.default??color).stdout);delete process.env.FORCE_COLOR;const {Worker}=require(process.argv[2]);const farm=new Worker(process.argv[3],{numWorkers:1});(async()=>{try{assert.equal(await farm.color(),process.argv[4]==='unset'?null:process.argv[4])}finally{await farm.end()}})().catch(error=>{console.error(error);process.exitCode=1});`)
  for (const [name, requireWorker] of [
    ['legacy27', originalMinimizer],
    ['original30', reference],
    ['current30', current],
  ]) {
    const result = spawnSync(process.execPath, [
      driver,
      requireWorker.resolve('jest-worker'),
      fixture,
      '1',
    ], {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: '1' },
      encoding: 'utf8',
      timeout: 15000,
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, name + result.stdout + result.stderr)
  }
  const control = path.join(directory, 'original-worker-current-providers')
  const extract = spawnSync('python3', [
    '-B',
    '-c',
    `import importlib.util,json,sys\nfrom pathlib import Path\nroot=Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('parents',root/'scripts/package-terminal-parents.py');producer=importlib.util.module_from_spec(spec);spec.loader.exec_module(producer)\nrecord=json.loads((producer.SOURCE/'UPSTREAM.json').read_text())['jest-worker'];payload=(producer.SOURCE/record['archive']).read_bytes();producer.build_archive(payload,record);files,modes=producer.ARCHIVES.archive_files(payload)\nfor filename,contents in files.items():\n target=Path(sys.argv[2])/filename.removeprefix('package/');target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(contents);target.chmod(modes[filename])`,
    root,
    control,
  ], { encoding: 'utf8', timeout: 10000 })
  assert.ifError(extract.error)
  assert.equal(extract.status, 0, extract.stderr)
  const negative = spawnSync(process.execPath, [
    driver,
    path.join(control, 'build/index.js'),
    fixture,
    'unset',
  ], {
    cwd: root,
    env: { ...process.env, FORCE_COLOR: '1' },
    encoding: 'utf8',
    timeout: 15000,
  })
  assert.ifError(negative.error)
  assert.equal(negative.status, 0, negative.stdout + negative.stderr)
})

test('actual Dumper and Jest-util callers preserve enabled and disabled terminal colors', async (context) => {
  const directory = await temporary(context)
  const filename = path.join(directory, 'colors.cjs')
  await writeFile(filename, `const {createRequire}=require('node:module');const local=createRequire(process.argv[2]);const {dump}=local('@poppinss/dumper/console');const helpers=local('jest-util');const warnings=[];const original=console.warn;const scope={};console.warn=message=>warnings.push(message);helpers.initializeGarbageCollectionUtils(scope,'soft');helpers.initializeGarbageCollectionUtils(scope,'off');console.warn=original;process.stdout.write(JSON.stringify({dump:dump({fixture:'value'}),warning:warnings[0]}));`)
  for (const level of ['0', '1']) {
    const outputs = []
    for (const requireCaller of [reference, current]) {
      const result = spawnSync(process.execPath, [
        filename,
        requireCaller.resolve('jest-util'),
      ], {
        cwd: root,
        env: { ...process.env, FORCE_COLOR: level },
        encoding: 'utf8',
        timeout: 15000,
      })
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const output = JSON.parse(result.stdout)
      assert.equal(typeof output.warning, 'string')
      assert.match(output.warning, /garbage collection deletion mode already initialized/)
      for (const value of Object.values(output))
        assert.equal(value.includes(`${String.fromCharCode(27)}[`), level === '1')
      outputs.push(Object.fromEntries(Object.entries(output).map(([name, value]) => [
        name,
        stripVTControlCharacters(value),
      ])))
    }
    assert.deepEqual(outputs[0], outputs[1])
  }
})

async function compileWebpack(options, requireCompiler) {
  const compiler = requireCompiler('webpack')(options)
  try {
    return await new Promise((resolve, reject) => compiler.run((error, stats) => error
      ? reject(error)
      : resolve(stats)))
  }
  finally {
    await new Promise((resolve, reject) => compiler.close(error => error
      ? reject(error)
      : resolve()))
  }
}

for (const [name, requireCompiler] of [
  ['original', reference],
  ['current', current],
]) {
  test(`${name} actual Webpack minimizer preserves dynamic chunks, executable results and errors`, async (context) => {
    const directory = await temporary(context)
    await writeFile(path.join(directory, 'entry.mjs'), 'export async function answer(){return(await import("./lazy.mjs")).answer}export const text="<synthetic>";')
    await writeFile(path.join(directory, 'lazy.mjs'), 'export const answer=21*2;')
    const Plugin = requireCompiler('minimizer-webpack-plugin')
    const options = {
      mode: 'production',
      target: 'node26',
      context: directory,
      entry: './entry.mjs',
      devtool: 'source-map',
      output: {
        path: path.join(directory, 'output'),
        filename: 'entry.cjs',
        chunkFilename: '[id].cjs',
        library: { type: 'commonjs2' },
      },
      optimization: {
        minimize: true,
        minimizer: [
          new Plugin({ parallel: 2 }),
        ],
      },
    }
    const stats = await compileWebpack(options, requireCompiler)
    assert.equal(stats.hasErrors(), false, JSON.stringify(stats.toJson({ all: false, errors: true })))
    const result = current(path.join(directory, 'output/entry.cjs'))
    assert.equal(await result.answer(), 42)
    assert.equal(result.text, '<synthetic>')
    assert.ok(stats.toJson({ all: false, assets: true }).assets.filter(asset => asset.name.endsWith('.cjs')).length >= 2)
    assert.match(await readFile(path.join(directory, 'output/entry.cjs.map'), 'utf8'), /entry\.mjs/)
    const broken = await compileWebpack({
      ...options,
      optimization: {
        minimize: true,
        minimizer: [
          new Plugin({
            parallel: 2,
            minify() { throw new Error('synthetic minifier failure') },
          }),
        ],
      },
    }, requireCompiler)
    assert.equal(broken.hasErrors(), true)
    assert.match(JSON.stringify(broken.toJson({ all: false, errors: true })), /synthetic minifier failure/)
    const recovered = await compileWebpack(options, requireCompiler)
    assert.equal(recovered.hasErrors(), false)
  })
}
