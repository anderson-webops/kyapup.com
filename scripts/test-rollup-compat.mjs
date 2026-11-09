import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { parseAst } from 'rollup/parseAst'
import { buildFixture, cases, execute, names, providers, root } from './fixtures/rollup-cases.mjs'

const require = createRequire(import.meta.url)
const record = JSON.parse(readFileSync(path.join(root, 'vendor/rollup-plugins/UPSTREAM.json'), 'utf8'))

async function temporary(context) {
  const parent = path.join(root, '.ai-work/runs')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(path.join(parent, 'rollup-compat-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

for (const cjs of [false, true]) {
  const provider = await providers(false, cjs)
  const original = await providers(true, cjs)
  for (const fixture of cases) {
    test(`${fixture.name}: actual Rollup consumers with CJS=${cjs}`, async (context) => {
      const scratch = await temporary(context)
      for (const format of ['es', 'cjs']) {
        const expected = await buildFixture(path.join(scratch, 'original'), fixture, original, format)
        const output = await buildFixture(path.join(scratch, 'maintained'), fixture, provider, format)
        assert.deepEqual(await execute(output.code, format), fixture.expected)
        assert.deepEqual(await execute(output.code, format), await execute(expected.code, format))
      }
    })
  }
}

test('actual Nitro consumers share the exact maintained cohort and current native dependency graph', () => {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const nitro = createRequire(import.meta.resolve('nitropack'))
  for (const name of names) {
    const filename = require.resolve(name)
    const metadata = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'))
    assert.equal(metadata.version, record.packages[name].patchedVersion)
    for (const [dependency, version] of Object.entries(record.packages[name].dependencies))
      assert.equal(metadata.dependencies[dependency], version)
    if (name !== '@rollup/pluginutils') {
      assert.equal(nitro.resolve(name), filename)
      assert.equal(createRequire(filename).resolve('@rollup/pluginutils'), require.resolve('@rollup/pluginutils'))
    }
    for (const [location, provider] of Object.entries(lock.packages)) {
      if (location.endsWith(`/${name}`))
        assert.equal(provider.version, metadata.version)
    }
  }
  const tools = require('@rollup/pluginutils/webops-tools.cjs')
  assert.equal(typeof tools.walk, 'function')
  assert.equal(typeof tools.asyncWalk, 'function')
  assert.equal(typeof tools.MagicString, 'function')
  assert.equal(typeof tools.Bundle, 'function')
  assert.equal(typeof tools.isReference, 'function')
})

test('scope utilities retain lexical bindings, destructuring and scoped var declarations', async () => {
  const current = (await providers(false, true)).utils
  const original = (await providers(true, true)).utils
  const source = 'const {first:renamed,...rest}=input;function compute({value},...args){var local;{let block;var lifted;}return()=>[value,args,local,lifted,renamed,rest]} '
  for (const utils of [original, current]) {
    const ast = parseAst(source)
    const scope = utils.attachScopes(ast)
    assert.ok(scope.contains('renamed'))
    assert.ok(scope.contains('rest'))
    assert.equal(Boolean(scope.contains('value')), false)
    const inner = ast.body[1].scope
    for (const name of [
      'value',
      'args',
      'local',
      'lifted',
      'renamed',
    ])
      assert.ok(inner.contains(name), name)
    assert.equal(Boolean(inner.contains('block')), false)
    assert.deepEqual(utils.extractAssignedNames(ast.body[0].declarations[0].id), ['renamed', 'rest'])
    assert.equal(utils.createFilter(['**/*.js'], ['**/excluded/**'])('/fixture/module.js'), true)
    assert.equal(utils.createFilter(['**/*.js'], ['**/excluded/**'])('/fixture/excluded/module.js'), false)
  }
})

test('current reference classification and injection preserve class field keys and computed values', async (context) => {
  const tools = require('@rollup/pluginutils/webops-tools.cjs')
  const ast = parseAst('class Example { supplied = value; [computed] = value; }')
  const references = []
  tools.walk(ast, {
    enter(node, parent) {
      if (node.type === 'Identifier' && tools.isReference(node, parent))
        references.push(node.name)
    },
  })
  assert.equal(references.includes('supplied'), false)
  assert.equal(references.includes('computed'), true)
  const scratch = await temporary(context)
  const fixture = {
    name: 'class fields',
    entry: 'class Example {supplied=1;[supplied]=supplied};export const result=new Example()[42];',
    files: { 'provider.js': 'export default 42;' },
    injection: true,
  }
  for (const cjs of [false, true]) {
    const output = await buildFixture(path.join(scratch, String(cjs)), fixture, await providers(false, cjs), 'es')
    assert.equal(await execute(output.code, 'es'), 42)
  }
})

test('CJS consumers stay synchronous while the current native ESM tools load concurrently', () => {
  const source = `const assert=require('node:assert/strict');const loading=Promise.all([import('magic-string'),import('estree-walker'),import('is-reference')]);const utils=require('@rollup/pluginutils');for(const name of ['commonjs','inject','replace'])assert.equal(typeof require('@rollup/plugin-'+name),'function');const tools=require('@rollup/pluginutils/webops-tools.cjs');const text=new tools.MagicString('const value=1');text.overwrite(12,13,'2');assert.equal(text.toString(),'const value=2');assert.equal(utils.makeLegalIdentifier('a-b'),'aB');loading.then(()=>console.log('coherent-sync-tools'));`
  assert.match(execFileSync(process.execPath, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 }), /coherent-sync-tools/)
})

test('native text edits map generated replacements back to the original source token', async () => {
  const { TraceMap, originalPositionFor } = require('@jridgewell/trace-mapping')
  const source = 'const label=__BUILD__;\nexport {label};'
  for (const cjs of [false, true]) {
    const provider = await providers(false, cjs)
    const plugin = provider.replace({
      preventAssignment: true,
      values: {
        __BUILD__: JSON.stringify('qualified'),
      },
    })
    const result = plugin.transform.call({}, source, '/synthetic/fixture.js')
    assert.ok(result.map)
    const generated = result.code.indexOf('"qualified"')
    assert.ok(generated >= 0)
    const position = originalPositionFor(new TraceMap(JSON.parse(result.map.toString())), { line: 1, column: generated })
    assert.equal(position.line, 1)
    assert.equal(position.column, source.indexOf('__BUILD__'))
  }
})

test('strict original public plugin declarations preserve accepted options and reject invalid ones', async (context) => {
  const scratch = await temporary(context)
  const positive = 'import commonjs from "@rollup/plugin-commonjs";import inject from "@rollup/plugin-inject";import replace from "@rollup/plugin-replace";import {createFilter,attachScopes} from "@rollup/pluginutils";import type {Plugin} from "rollup";const plugins:Plugin[]=[commonjs({strictRequires:true,transformMixedEsModules:true}),inject({supplied:["provider","answer"]}),replace({preventAssignment:true,values:{__BUILD__:JSON.stringify("qualified")}})];const filter=createFilter(["**/*.js"]);void [plugins,filter,attachScopes];'
  await writeFile(path.join(scratch, 'positive.ts'), positive)
  await writeFile(path.join(scratch, 'positive.cts'), positive)
  const configuration = {
    compilerOptions: {
      noEmit: true,
      strict: true,
      skipLibCheck: false,
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ESNext',
      types: ['node'],
    },
    files: ['positive.ts', 'positive.cts'],
  }
  const config = path.join(scratch, 'tsconfig.json')
  await writeFile(config, JSON.stringify(configuration))
  const args = [
    require.resolve('typescript/lib/tsc.js'),
    '--project',
    config,
  ]
  execFileSync(process.execPath, args, { cwd: scratch, encoding: 'utf8', timeout: 20_000 })
  await writeFile(path.join(scratch, 'negative.ts'), 'import commonjs from "@rollup/plugin-commonjs";commonjs({strictRequires:42});')
  await writeFile(config, JSON.stringify({
    ...configuration,
    files: ['negative.ts'],
  }))
  assert.throws(() => execFileSync(process.execPath, args, {
    cwd: scratch,
    encoding: 'utf8',
    timeout: 20_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }), error => error.status !== 0 && /TS2322/.test(error.stdout))
})
