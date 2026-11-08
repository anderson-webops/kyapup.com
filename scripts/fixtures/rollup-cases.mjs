import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { rollup } from 'rollup'

export const root = fileURLToPath(new URL('../..', import.meta.url))
export const names = [
  '@rollup/pluginutils',
  '@rollup/plugin-commonjs',
  '@rollup/plugin-inject',
  '@rollup/plugin-replace',
]
const require = createRequire(import.meta.url)
const originalRoot = path.join(root, 'vendor/rollup-plugins/upstream')
const originalRequire = createRequire(path.join(originalRoot, 'package.json'))

export async function providers(original, cjs) {
  const resolve = original ? originalRequire : require
  const loaded = []
  for (const name of names) {
    const entry = resolve.resolve(name)
    assert.ok(entry.startsWith(path.join(original ? originalRoot : root, 'node_modules/')))
    loaded.push(cjs
      ? resolve(name)
      : await import(pathToFileURL(path.join(path.dirname(entry), '../es/index.js'))))
  }
  return {
    utils: loaded[0],
    commonjs: loaded[1].default || loaded[1],
    inject: loaded[2].default || loaded[2],
    replace: loaded[3].default || loaded[3],
  }
}

export const cases = [
  {
    name: 'default function',
    entry: 'import add from "./value.cjs";export const result=add(2);',
    files: { 'value.cjs': 'module.exports=value=>value+40;' },
    expected: 42,
  },
  {
    name: 'named exports',
    entry: 'import {first,second} from "./value.cjs";export const result=first+second;',
    files: { 'value.cjs': 'exports.first=20;exports.second=22;' },
    expected: 42,
  },
  {
    name: 'live exported state',
    entry: 'import state from "./value.cjs";state.add();state.add();export const result=state.value;',
    files: { 'value.cjs': 'exports.value=40;exports.add=()=>++exports.value;' },
    expected: 42,
  },
  {
    name: 'cyclic execution',
    entry: 'import state from "./value.cjs";export const result=state.total();',
    files: { 'value.cjs': 'exports.value=20;const peer=require("./peer.cjs");exports.total=()=>exports.value+peer.value;', 'peer.cjs': 'const state=require("./value.cjs");exports.value=state.value+2;' },
    expected: 42,
    cycle: true,
  },
  {
    name: 'dead conditional require',
    entry: 'import value from "./value.cjs";export const result=value;',
    files: { 'value.cjs': 'if(false)require("./missing.cjs");module.exports=42;' },
    expected: 42,
  },
  {
    name: 'bounded dynamic require',
    entry: 'import value from "./value.cjs";export const result=value;',
    files: { 'value.cjs': 'const name="answer";module.exports=require("./values/"+name+".cjs");', 'values/answer.cjs': 'module.exports=42;' },
    expected: 42,
    dynamic: true,
  },
  {
    name: 'mixed ESM and CommonJS',
    entry: 'import {answer} from "./value.js";export const result=answer;',
    files: { 'value.js': 'import {base} from "./base.js";export const answer=base+require("./number.cjs");', 'base.js': 'export const base=20;', 'number.cjs': 'module.exports=22;' },
    expected: 42,
    mixed: true,
  },
  {
    name: 'external builtin',
    entry: 'import value from "./value.cjs";export const result=value;',
    files: { 'value.cjs': 'const path=require("node:path");module.exports=path.basename("/synthetic/answer");' },
    expected: 'answer',
  },
  {
    name: 'shebang and Unicode',
    entry: 'import value from "./value.cjs";export const result=value;',
    files: { 'value.cjs': '#!/usr/bin/env node\nmodule.exports="café😀";' },
    expected: 'café😀',
  },
  {
    name: 'injection scope and members',
    entry: 'export const result=[supplied,api.answer,((supplied)=>supplied)(3),{key:supplied},"supplied"]',
    files: { 'provider.js': 'export default 42;export const answer=7;' },
    expected: [
      42,
      7,
      3,
      { key: 42 },
      'supplied',
    ],
    injection: true,
  },
  {
    name: 'replacement guards',
    entry: 'export const result=[process.env.NODE_ENV,__BUILD__,typeof process.env.NODE_ENV];',
    files: {},
    expected: ['production', 'qualified', 'string'],
    replacement: true,
  },
]

export async function buildFixture(directory, fixture, provider, format) {
  const files = { 'entry.js': fixture.entry, ...fixture.files }
  for (const [name, source] of Object.entries(files)) {
    const filename = path.join(directory, name)
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, source)
  }
  const plugins = []
  if (fixture.injection) {
    plugins.push(provider.inject({
      'supplied': path.join(directory, 'provider.js'),
      'api.answer': [
        path.join(directory, 'provider.js'),
        'answer',
      ],
    }))
  }
  if (fixture.replacement) {
    plugins.push(provider.replace({
      preventAssignment: true,
      objectGuards: true,
      values: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        '__BUILD__': JSON.stringify('qualified'),
      },
    }))
  }
  plugins.push(provider.commonjs({
    transformMixedEsModules: Boolean(fixture.mixed),
    ...(fixture.dynamic
      ? {
          dynamicRequireTargets: [
            path.relative(process.cwd(), path.join(directory, 'values/*.cjs')),
          ],
          dynamicRequireRoot: directory,
        }
      : {}),
  }))
  const bundle = await rollup({
    input: path.join(directory, 'entry.js'),
    external: ['node:path'],
    plugins,
    onwarn(warning) {
      if (fixture.cycle && warning.code === 'CIRCULAR_DEPENDENCY')
        return
      assert.fail(warning.message)
    },
  })
  try {
    const { output } = await bundle.generate({
      format,
      exports: 'named',
      sourcemap: true,
      name: 'QualifiedFixture',
    })
    const entry = output.find(item => item.type === 'chunk' && item.isEntry)
    assert.ok(entry)
    assert.ok(entry.map)
    assert.ok(entry.map.sourcesContent.includes(fixture.entry))
    return entry
  }
  finally {
    await bundle.close()
  }
}

let execution = 0
export async function execute(code, format) {
  if (format === 'es') {
    const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#fixture-${execution++}`)
    return JSON.parse(JSON.stringify(module.result))
  }
  const module = { exports: {} }
  runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      assert.equal(name, 'node:path')
      return require(name)
    },
  }, { timeout: 2000 })
  return JSON.parse(JSON.stringify(module.exports.result))
}
