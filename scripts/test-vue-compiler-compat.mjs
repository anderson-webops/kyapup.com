import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as compiler from '@vue/compiler-sfc'
import { cases, interactiveSource, sourceFor } from './fixtures/vue-compiler-cases.mjs'
import { optionsFrom } from './fixtures/vue-compiler-options.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const originalRequire = createRequire(path.join(root, 'vendor/vue-compiler/upstream/package.json'))
assert.ok(originalRequire.resolve('@vue/compiler-sfc').startsWith(path.join(root, 'vendor/vue-compiler/upstream/node_modules/')))
const original = originalRequire('@vue/compiler-sfc')

for (const fixture of cases) {
  for (const isProd of [false, true]) {
    test(`${fixture.name} retains real runtime options with isProd=${isProd}`, () => {
      const source = sourceFor(fixture)
      const descriptor = compiler.parse(source, { filename: 'Fixture.vue' }).descriptor
      const baseline = original.parse(source, { filename: 'Fixture.vue' }).descriptor
      const result = compiler.compileScript(descriptor, { id: 'fixture', isProd })
      const expected = original.compileScript(baseline, { id: 'fixture', isProd })
      const options = optionsFrom(result.content)
      assert.deepEqual(options, optionsFrom(expected.content))
      assert.deepEqual(Object.keys(options.props).sort(), (fixture.props || []).toSorted())
      assert.deepEqual(options.emits.toSorted(), (fixture.emits || []).toSorted())
      assert.ok(result.map)
    })
  }
}

test('all actual Vue, Vue plugin and Nuxt compiler consumers share the maintained modern graph', async () => {
  for (const name of [
    'vue',
    '@vitejs/plugin-vue',
    '@nuxt/vite-builder',
    '@vue/compiler-dom',
    '@vue/compiler-ssr',
  ]) {
    const parent = createRequire(import.meta.resolve(name))
    const entry = name === '@vue/compiler-dom' || name === '@vue/compiler-ssr'
      ? '@vue/compiler-core'
      : '@vue/compiler-sfc'
    assert.equal(parent.resolve(entry), require.resolve(entry), name)
  }
  for (const name of ['@vue/compiler-core', '@vue/compiler-sfc']) {
    const parent = createRequire(import.meta.resolve(name))
    assert.equal(JSON.parse(await readFile(parent.resolve('@babel/parser/package.json'), 'utf8')).version, '8.1.0')
    const directory = path.dirname(parent.resolve('@vue/compiler-core/package.json'))
    const adapter = require(path.join(directory, 'dist/webops-compiler-tools.cjs'))
    assert.equal(typeof adapter.walk, 'function')
    assert.equal(compiler.MagicString, adapter.MagicString)
    assert.equal(compiler.babelParse, adapter.parser.parse)
    const names = []
    adapter.walk(compiler.babelParse('const value = import(target)', { sourceType: 'module' }), {
      enter(node) {
        if (node.type === 'Identifier')
          names.push(node.name)
      },
    })
    assert.deepEqual(names, ['value', 'target'])
  }
  const parent = createRequire(import.meta.resolve('@vue/compiler-sfc'))
  assert.equal(JSON.parse(await readFile(parent.resolve('magic-string/package.json'), 'utf8')).version, '1.4.5')
})

test('public script ASTs and Babel entrypoints retain native Babel8 values and fields', () => {
  const source = '<script setup lang="ts">type Box<T>={value:T};const props=defineProps<Box<string>>();const count=1n;const load=()=>import("data",{with:{type:"json"}})</script>'
  const { descriptor } = compiler.parse(source, { filename: 'Native.vue' })
  const result = compiler.compileScript(descriptor, { id: 'native' })
  const body = result.scriptSetupAst
  assert.equal(body[0].typeParameters.params[0].name.type, 'Identifier')
  assert.equal(body[1].declarations[0].init.typeArguments.type, 'TSTypeParameterInstantiation')
  assert.equal(body[2].declarations[0].init.value, 1n)
  assert.equal(body[3].declarations[0].init.body.type, 'ImportExpression')
  assert.equal(body[3].declarations[0].init.body.options.type, 'ObjectExpression')
  const parsed = compiler.babelParse(`type Value=\`item_\${string}\``, {
    sourceType: 'module',
    plugins: ['typescript'],
  })
  assert.equal(parsed.program.body[0].typeAnnotation.type, 'TSTemplateLiteralType')
})

test('macro argument validation still rejects forbidden options and mixed declaration forms', () => {
  for (const script of ['defineOptions<{name:string}>({name:"test"})', 'defineProps<{label:string}>({label:String})', 'defineEmits<(event:"save")=>void>(["save"])']) {
    const { descriptor } = compiler.parse(`<script setup lang="ts">${script}</script>`, { filename: 'Invalid.vue' })
    assert.throws(() => compiler.compileScript(descriptor, { id: 'invalid' }), /cannot accept|type and non-type|both type/i)
  }
})

test('the original unsupported top-level macro type boundaries remain explicit', () => {
  for (const script of ['type Props=Record<"label",string>;defineProps<Props>()', 'type Box<T> = {[Key in keyof T]:T[Key]};defineProps<Box<{label:string}>>()']) {
    for (const provider of [original, compiler]) {
      const { descriptor } = provider.parse(`<script setup lang="ts">${script}</script>`)
      assert.throws(() => provider.compileScript(descriptor, { id: 'unsupported' }), /Unresolvable type reference|Failed to resolve index type/)
    }
  }
})

test('imported types resolve through the explicit isolated filesystem contract', () => {
  const files = new Map([
    ['/fixtures/types.ts', 'export interface Props { label:string; count?:number }'],
  ])
  const source = '<script setup lang="ts">import type {Props} from "./types";defineProps<Props>()</script>'
  const { descriptor } = compiler.parse(source, { filename: '/fixtures/Component.vue' })
  const result = compiler.compileScript(descriptor, {
    id: 'imported',
    fs: {
      fileExists: filename => files.has(filename),
      readFile: filename => files.get(filename),
    },
  })
  assert.deepEqual(Object.keys(optionsFrom(result.content).props), ['count', 'label'])
})

test('script/template/style maps and inline typed template compilation preserve source identities', () => {
  const filename = 'Interactive.vue'
  const { descriptor } = compiler.parse(interactiveSource, { filename })
  const result = compiler.compileScript(descriptor, { id: 'fixture', inlineTemplate: true })
  assert.match(result.content, /createElementBlock|createElementVNode/)
  assert.ok(result.map.sources.some(name => name.endsWith(filename)))
  assert.ok(result.map.sourcesContent.includes(interactiveSource))
  const style = compiler.compileStyle({
    source: descriptor.styles[0].content,
    filename,
    id: 'data-v-fixture',
    scoped: true,
  })
  assert.deepEqual(style.errors, [])
  assert.match(style.code, /data-v-fixture/)
})

test('Node production core and import/require entrypoints retain actual template expression compilation', () => {
  const core = require('@vue/compiler-core')
  const output = core.baseCompile('<div>{{ value satisfies string }}</div>', {
    mode: 'module',
    prefixIdentifiers: true,
    expressionPlugins: ['typescript'],
  })
  assert.match(output.code, /_ctx.value/)
  const child = spawnSync(process.execPath, [
    '--conditions=production',
    '--input-type=module',
    '-e',
    'import {baseCompile} from "@vue/compiler-core";import assert from "node:assert/strict";const result=baseCompile("<div>{{value}}</div>",{mode:"module",prefixIdentifiers:true});assert.match(result.code,/_ctx.value/)',
  ], { cwd: root, encoding: 'utf8' })
  assert.equal(child.status, 0, child.stdout + child.stderr)
})

test('concurrent ESM tooling imports cannot race the synchronous compiler dependency graph', () => {
  const source = '<script setup lang="ts">defineProps<{label:string}>()</script>'
  const code = `import assert from "node:assert/strict";const [,compiler]=await Promise.all([import("magic-string"),import("@vue/compiler-sfc"),import("@antfu/eslint-config")]);const editor=new compiler.MagicString("before");editor.overwrite(0,6,"after");assert.equal(editor.toString(),"after");const result=compiler.compileScript(compiler.parse(${JSON.stringify(source)}).descriptor,{id:"race"});assert.match(result.content,/label/);`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, encoding: 'utf8', timeout: 15000 })
  assert.equal(child.status, 0, child.stdout + child.stderr)
  assert.equal(child.error, undefined)
})

test('strict public declarations use current Babel AST types without weakening library checks', async () => {
  const directory = path.join(root, '.ai-work/runs')
  await mkdir(directory, { recursive: true })
  const scratch = await mkdtemp(path.join(directory, 'vue-compiler-types-'))
  try {
    await writeFile(path.join(scratch, 'types.mts'), 'import {parse,compileScript,babelParse,MagicString} from "@vue/compiler-sfc";import type {TSTypeReference,BigIntLiteral} from "@babel/types";const source=parse("<script setup>const value=1</script>");compileScript(source.descriptor,{id:"test"});babelParse("export default {}");new MagicString("source");const value:BigIntLiteral["value"]=1n;let argumentsValue:TSTypeReference["typeArguments"];void value;void argumentsValue;')
    await writeFile(path.join(scratch, 'tsconfig.json'), JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        strict: true,
        skipLibCheck: false,
        types: ['node'],
        noEmit: true,
      },
      files: ['types.mts'],
    }))
    const check = () => spawnSync(process.execPath, [
      require.resolve('typescript/bin/tsc'),
      '--project',
      path.join(scratch, 'tsconfig.json'),
    ], { cwd: root, encoding: 'utf8' })
    const accepted = check()
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
    await writeFile(path.join(scratch, 'types.mts'), 'import type {BigIntLiteral} from "@babel/types";const value:BigIntLiteral["value"]="1";void value;')
    const rejected = check()
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stdout, /TS2322/)
  }
  finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
