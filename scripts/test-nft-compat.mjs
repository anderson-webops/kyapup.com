import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const originalRequire = createRequire(path.join(root, 'vendor/nft/upstream/package.json'))
const current = require('@vercel/nft')

const original = originalRequire('@vercel/nft')

function trace(provider, files, options) {
  return provider.nodeFileTrace(files.map(filename => path.resolve(options.base, filename)), options)
}

async function fixture(context) {
  const parent = path.join(root, '.ai-work/runs')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(path.join(parent, 'nft-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  const files = {
    'package.json': JSON.stringify({ private: true }),
    'main.cjs': 'const fs=require("node:fs");const path=require("node:path");const value=require("fixture-package");const shadow=(()=>{const require=()=>0;return require("unavailable-shadowed-package")})();console.log(JSON.stringify(value+Number(fs.readFileSync(path.join(__dirname,"data/value.txt"),"utf8"))+shadow));',
    'data/value.txt': '2',
    'data/ignored.txt': 'retained',
    'node_modules/fixture-package/package.json': JSON.stringify({
      name: 'fixture-package',
      version: '1.0.0',
      exports: { import: './esm.mjs', require: './cjs.cjs' },
    }),
    'node_modules/fixture-package/cjs.cjs': 'module.exports=40;',
    'node_modules/fixture-package/esm.mjs': 'export default 41;',
    'main.mjs': 'import value from "fixture-package";export const answer=value;export const lazy=()=>import("./dynamic/yes.cjs");export {data} from "./reexport.mjs";',
    'reexport.mjs': 'export const data=42;',
    'dynamic/yes.cjs': 'module.exports=42;',
    'dynamic/no.cjs': 'module.exports=41;',
    'conditional.cjs': 'const name=process.env.NFT_SYNTHETIC_BRANCH;module.exports=require(name?"./dynamic/yes.cjs":"./dynamic/no.cjs");',
    'glob.cjs': 'exports.load=name=>require("./dynamic/"+name+".cjs");',
    'missing.cjs': 'module.exports=require("./not-present.cjs");',
    'invalid.cjs': 'function ( {',
    'native.cjs': 'module.exports=require("./synthetic.node");',
    'synthetic.node': 'synthetic fixture only; never executed',
    'symlink.cjs': 'module.exports=require("linked-package");',
    'wrapped.cjs': '(function(define){define(function(require){return require("./dynamic/yes.cjs")})})(typeof define==="function"&&define.amd?define:function(factory){module.exports=factory(require)});',
  }
  for (const [name, source] of Object.entries(files)) {
    const filename = path.join(directory, name)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, source)
  }
  await symlink('fixture-package', path.join(directory, 'node_modules/linked-package'))
  return directory
}

function normalize(result) {
  return {
    files: [...result.fileList].sort(),
    esm: [...result.esmFileList].sort(),
    warnings: [...result.warnings].map(item => item.message).sort(),
    reasons: [...result.reasons].sort(([first], [second]) => first.localeCompare(second)).map(([name, reason]) => [
      name,
      {
        type: [...reason.type].sort(),
        ignored: reason.ignored,
        parents: [...reason.parents].sort(),
      },
    ]),
  }
}

test('the actual file tracer consumes the current native ESM walker with unchanged public declarations', async () => {
  assert.ok(require.resolve('@vercel/nft').startsWith(path.join(root, 'node_modules/@vercel/nft/')))
  assert.ok(originalRequire.resolve('@vercel/nft').startsWith(path.join(root, 'vendor/nft/upstream/node_modules/@vercel/nft/')))
  const metadata = require('@vercel/nft/package.json')
  assert.equal(metadata.version, '1.11.1-webops.1')
  assert.equal(metadata.dependencies['estree-walker'], '3.0.3')
  assert.equal(originalRequire('@vercel/nft/package.json').dependencies['estree-walker'], '2.0.2')
  const walker = JSON.parse(await readFile(path.join(root, 'node_modules/estree-walker/package.json'), 'utf8'))
  assert.equal(walker.version, '3.0.3')
  assert.throws(() => require('estree-walker'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
  const modern = await import('estree-walker')
  assert.equal(typeof modern.asyncWalk, 'function')
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  for (const [name, info] of Object.entries(lock.packages)) {
    if (name.endsWith('/estree-walker'))
      assert.equal(info.version, '3.0.3', name)
  }
})

for (const entry of [
  'main.cjs',
  'main.mjs',
  'conditional.cjs',
  'glob.cjs',
  'missing.cjs',
  'invalid.cjs',
  'native.cjs',
  'symlink.cjs',
  'wrapped.cjs',
]) {
  test(`actual tracing and reasons match the original consumer for ${entry}`, async (context) => {
    const directory = await fixture(context)
    const options = { base: directory, processCwd: directory, fileIOConcurrency: 3 }
    const expected = normalize(await trace(original, [entry], options))
    const actual = normalize(await trace(current, [entry], options))
    assert.deepEqual(actual, expected)
    assert.ok(actual.files.includes(entry))
    if (entry === 'main.cjs') {
      assert.deepEqual(actual.warnings, [])
      for (const name of ['data/value.txt', 'node_modules/fixture-package/cjs.cjs', 'node_modules/fixture-package/package.json'])
        assert.ok(actual.files.includes(name), name)
      assert.ok(actual.files.every(name => !name.includes('unavailable-shadowed-package')))
    }
    if (entry === 'main.mjs') {
      assert.ok(actual.files.includes('node_modules/fixture-package/esm.mjs'))
      assert.ok(actual.files.includes('dynamic/yes.cjs'))
      assert.ok(actual.esm.includes('main.mjs'))
    }
    if (entry === 'conditional.cjs' || entry === 'glob.cjs') {
      assert.ok(actual.files.includes('dynamic/yes.cjs'))
      assert.ok(actual.files.includes('dynamic/no.cjs'))
    }
    if (entry === 'missing.cjs' || entry === 'invalid.cjs')
      assert.ok(actual.warnings.length > 0)
    if (entry === 'native.cjs')
      assert.ok(actual.files.includes('synthetic.node'))
    if (entry === 'wrapped.cjs')
      assert.ok(actual.files.includes('dynamic/yes.cjs'))
  })
}

test('ignored assets remain explicitly ignored with original reason chains', async (context) => {
  const directory = await fixture(context)
  const inspected = []
  const options = {
    base: directory,
    processCwd: directory,
    ignore: (filename) => {
      inspected.push(filename)
      return filename.startsWith('data/')
    },
  }
  const actual = normalize(await trace(current, ['main.cjs'], options))
  assert.deepEqual(actual, normalize(await trace(original, ['main.cjs'], options)))
  assert.ok(!actual.files.includes('data/value.txt'))
  assert.ok(inspected.includes('data/value.txt'))
  assert.equal(actual.reasons.find(([name]) => name === 'data/value.txt'), undefined)
})

test('concurrent asynchronous traversal, cached repeat and failure recovery preserve every dependency', async (context) => {
  const directory = await fixture(context)
  const options = { base: directory, processCwd: directory }
  const expected = normalize(await trace(original, [
    'main.cjs',
    'main.mjs',
    'conditional.cjs',
    'glob.cjs',
  ], options))
  const results = await Promise.all(Array.from({ length: 12 }, async (_unused, index) => {
    const cache = {}
    const delayed = {
      ...options,
      cache,
      readFile: async (filename) => {
        await delay(index % 3)
        try {
          return await readFile(filename)
        }
        catch (error) {
          if (error.code === 'ENOENT' || error.code === 'EISDIR')
            return null
          throw error
        }
      },
    }
    const first = normalize(await trace(current, [
      'main.cjs',
      'main.mjs',
      'conditional.cjs',
      'glob.cjs',
    ], delayed))
    const second = normalize(await trace(current, [
      'main.cjs',
      'main.mjs',
      'conditional.cjs',
      'glob.cjs',
    ], delayed))
    assert.deepEqual(second, first)
    return first
  }))
  for (const result of results)
    assert.deepEqual(result, expected)
  const broken = await trace(current, ['missing.cjs'], options)
  assert.ok(broken.warnings.size > 0)
  assert.deepEqual(normalize(await trace(current, [
    'main.cjs',
    'main.mjs',
    'conditional.cjs',
    'glob.cjs',
  ], options)), expected)
})

test('the actual CLI prints reasons and copies a trace that runs without source or development reads', async (context) => {
  const directory = await fixture(context)
  const cli = require.resolve('@vercel/nft/out/cli.js')
  const invoke = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8', timeout: 30000 })
  const printed = invoke('print', 'main.cjs')
  assert.match(printed, /FILELIST:/)
  assert.match(printed, /data\/value\.txt/)
  assert.match(invoke('why', 'main.cjs', 'data/value.txt'), /main\.cjs/)
  assert.match(invoke('size', 'main.cjs'), /\d+ bytes total/)
  invoke('build', 'main.cjs')
  const output = path.join(directory, 'dist')
  const guardedEntry = `const assert=require('node:assert/strict');const fs=require('node:fs');for(const filename of ${JSON.stringify([
    path.join(directory, 'main.cjs'),
    path.join(root, 'package.json'),
  ])})assert.throws(()=>fs.readFileSync(filename),{code:'ERR_ACCESS_DENIED'});require(${JSON.stringify(path.join(output, 'main.cjs'))});`
  for (let round = 0; round < 2; round++) {
    const value = execFileSync(process.execPath, [
      '--permission',
      `--allow-fs-read=${output}`,
      '--eval',
      guardedEntry,
    ], { cwd: output, encoding: 'utf8', timeout: 10000 })
    assert.equal(JSON.parse(value), 42)
  }
  await assert.rejects(readFile(path.join(output, 'data/ignored.txt')), { code: 'ENOENT' })
})

test('strict public file-tracer types accept supported options and reject invalid ones', async (context) => {
  const directory = await fixture(context)
  await writeFile(path.join(directory, 'positive.cts'), 'import {nodeFileTrace} from "@vercel/nft";import type {NodeFileTraceOptions,NodeFileTraceResult} from "@vercel/nft";const options:NodeFileTraceOptions={base:process.cwd(),fileIOConcurrency:2,conditions:["node"],ignore:filename=>filename.endsWith(".ignore")};const result:Promise<NodeFileTraceResult>=nodeFileTrace(["main.cjs"],options);void result;')
  await writeFile(path.join(directory, 'negative.cts'), 'import {nodeFileTrace} from "@vercel/nft";nodeFileTrace(["main.cjs"],{fileIOConcurrency:"invalid"});')
  const flags = [
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
    '--ignoreConfig',
  ]
  const nativeMetadata = require.resolve('typescript-native/package.json')
  const nativeCompiler = path.resolve(path.dirname(nativeMetadata), require(nativeMetadata).bin.tsc)
  for (const compiler of [
    require.resolve('typescript/lib/tsc.js'),
    nativeCompiler,
  ]) {
    execFileSync(process.execPath, [
      compiler,
      ...flags,
      path.join(directory, 'positive.cts'),
    ], { cwd: root, encoding: 'utf8', timeout: 30000 })
    assert.throws(() => execFileSync(process.execPath, [
      compiler,
      ...flags,
      path.join(directory, 'negative.cts'),
    ], { cwd: root, encoding: 'utf8', timeout: 30000 }), error => error.status !== 0 && /string.*number/.test(error.stdout))
  }
})
