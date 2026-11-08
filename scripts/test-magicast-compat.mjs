import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'
import { VISITOR_KEYS } from '@babel/types'
import { builders, generateCode, loadFile, parseExpression, parseModule, writeFile as writeModule } from 'magicast'
import { addNuxtModule, addVitePlugin, getDefaultExportOptions, updateVitePluginConfig } from 'magicast/helpers'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const parserOptions = {
  sourceType: 'module',
  plugins: ['typescript', 'jsx', 'decorators-legacy'],
}
const ignoredFields = new Set([
  'start',
  'end',
  'loc',
  'extra',
  'tokens',
  'comments',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'errors',
])

function semantic(value) {
  if (Array.isArray(value))
    return value.map(semantic)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([name, child]) => !ignoredFields.has(name) && child !== undefined).map(([name, child]) => [
      name,
      semantic(child),
    ]))
  }
  return value
}

function rename(node) {
  if (node.type === 'Identifier' && node.name === 'Target')
    node.name = 'Renamed'
  for (const field of VISITOR_KEYS[node.type] || []) {
    const children = Array.isArray(node[field])
      ? node[field]
      : [node[field]]
    for (const child of children) {
      if (child)
        rename(child)
    }
  }
}

test('every actual Nuxt, wizard and Nitro consumer resolves the maintained native Babel8 editor', async () => {
  const expected = require.resolve('magicast')
  const parents = [
    '@nuxt/devtools',
    '@nuxt/devtools-wizard',
    'nitropack',
    'nuxt',
  ]
  for (const name of parents) {
    const parent = createRequire(import.meta.resolve(name))
    const consumer = name === 'nuxt'
      ? createRequire(parent.resolve('@nuxt/devtools/dist/module.mjs'))
      : parent
    assert.equal(consumer.resolve('magicast'), expected, name)
    const editor = createRequire(consumer.resolve('magicast'))
    for (const dependency of ['@babel/parser', '@babel/types', '@babel/generator']) {
      const metadata = JSON.parse(await readFile(editor.resolve(`${dependency}/package.json`), 'utf8'))
      assert.match(metadata.version, /^8\./)
    }
    assert.equal(JSON.parse(await readFile(editor.resolve('source-map-js/package.json'), 'utf8')).version, '1.2.2')
  }
})

test('native Babel8 bigint values, dynamic import options and type arguments remain public AST values', () => {
  const module = parseModule('const count = 42n; const loader = import("data", {with:{type:"json"}}); const generic = reader<string>; export default {}')
  assert.equal(module.$ast.body[0].declarations[0].init.value, 42n)
  assert.equal(module.$ast.body[1].declarations[0].init.type, 'ImportExpression')
  assert.equal(module.$ast.body[1].declarations[0].init.options.type, 'ObjectExpression')
  assert.equal(module.$ast.body[2].declarations[0].init.typeArguments.type, 'TSTypeParameterInstantiation')
  module.exports.default.count = 9007199254740993n
  assert.match(generateCode(module).code, /9007199254740993n/)
})

const syntaxCases = [
  ['generic reference', 'type Value = Array<Target>'],
  ['generic calls', 'const result = reader<Target>(); const optional = reader?.<Target>(); const constructed = new Reader<Target>()'],
  ['JSX generics', 'const view = <Reader<Target> value="ok" />'],
  ['class heritage', 'class Value extends Reader<Target> implements Other<Target> {}'],
  ['decorated generic class', '@decorate class Value extends Reader<Target> {}'],
  ['exported decorated class', '@decorate export class Value extends Reader<Target> {}'],
  ['function signature', 'type Value = <Target>(input: Target) => Promise<Target>'],
  ['constructor signature', 'type Value = new <Target>(input: Target) => Reader<Target>'],
  ['interface signatures', 'interface Value extends Reader<Target> { (input: Target): Target; new (input: Target): Target; read(input: Target): Target }'],
  ['mapped type', `type Value = { readonly [Target in keyof Reader as \`key_\${Target & string}\`]?: Reader[Target] }`],
  ['enum body', 'enum Value { Target = 1, Other = 2 }'],
  ['namespace qualification', 'namespace Outer.Target { export const value = 1 }'],
  ['import type', 'type Value = import("dependency", {with:{"resolution-mode":"import"}}).Reader<Target>'],
  ['typeof generics', 'type Value = typeof reader<Target>'],
  ['instantiation expression', 'const reader = makeReader<Target>'],
  ['template literal type', `type Value = \`key_\${Target}\``],
  ['type parameter', 'function reader<const Target extends string>(input: Target) { return input }'],
  ['exported import equals', 'export import Target = require("dependency")'],
  ['named rest tuple', 'type Value = [first: Target, ...rest: Array<Target>]'],
  ['conditional infer', 'type Value = Reader extends Promise<infer Target> ? Target : never'],
]

for (const [name, source] of syntaxCases) {
  test(`native ${name} edits survive format-preserving and fresh-tree printing`, () => {
    const module = parseModule(`${source}\nexport default {enabled: true}`)
    const expected = parse(`${source}\nexport default {enabled: true}`, parserOptions).program
    rename(module.$ast)
    rename(expected)
    const output = generateCode(module).code
    assert.deepEqual(semantic(parse(output, parserOptions).program), semantic(expected))
    const fresh = generateCode(expected).code
    assert.deepEqual(semantic(parse(fresh, parserOptions).program), semantic(expected))
  })
}

test('dynamic imports keep their native options through configuration edits', () => {
  const module = parseModule('export default { loader: () => import("data", {with:{type:"json"}}) }')
  module.exports.default.loader.$ast.body.source.value = 'changed'
  const output = generateCode(module).code
  assert.match(output, /changed/)
  assert.match(output, /type: ?"json"/)
  assert.deepEqual(semantic(parse(output, parserOptions).program), semantic(parse('export default { loader: () => import("changed", {with:{type:"json"}}) }', parserOptions).program))
})

test('dynamic import proxy arguments preserve the previous call-editing interface on native nodes', () => {
  const module = parseModule('export default { loader: () => import("data") }')
  const loader = module.exports.default.loader.$body
  assert.equal(loader.$callee, 'import')
  assert.equal(loader.$args.length, 1)
  loader.$args[0] = 'updated'
  loader.$args.push({
    with: { type: 'json' },
  })
  assert.equal(loader.$ast.type, 'ImportExpression')
  assert.equal(loader.$ast.source.value, 'updated')
  assert.equal(loader.$args.length, 2)
  assert.equal(loader.$args[1].with.type, 'json')
  assert.equal(loader.$ast.source.type, 'StringLiteral')
  assert.equal(loader.$ast.options.properties[0].type, 'ObjectProperty')
  assert.match(generateCode(loader.$ast).code, /import\("updated",/)
  assert.throws(() => loader.$args.push('invalid'), /at most two arguments/)
  loader.$args.pop()
  assert.equal(loader.$ast.options, null)
  assert.equal(loader.$args.length, 1)
  assert.match(generateCode(module).code, /import\("updated"\)/)
})

test('proxy literals stay native when composing typed or newly generated configuration nodes', async () => {
  const module = parseModule('export default {}')
  module.exports.default.options = {
    empty: null,
    flag: true,
    text: 'value',
    values: [1, 2n],
    pattern: /fixture/gi,
    date: new Date('2026-01-01T00:00:00Z'),
    set: new Set([1, 2]),
    map: new Map([
      ['key', 'value'],
    ]),
    infinite: Infinity,
  }
  const options = module.exports.default.options
  assert.equal(options.empty, null)
  assert.ok(options.$ast.properties.every(property => property.type === 'ObjectProperty'))
  const output = generateCode(options.$ast).code
  const actual = await import(`data:text/javascript,export default ${encodeURIComponent(output)}`)
  assert.equal(actual.default.empty, null)
  assert.equal(actual.default.values[1], 2n)
  assert.equal(actual.default.text, 'value')
  assert.equal(actual.default.pattern.source, 'fixture')
  assert.equal(actual.default.date.toISOString(), '2026-01-01T00:00:00.000Z')
  assert.deepEqual(Array.from(actual.default.set), [1, 2])
  assert.equal(actual.default.map.get('key'), 'value')
  assert.equal(actual.default.infinite, Infinity)
})

test('changed TypeScript comments are preserved exactly once and removed proposals fail explicitly', () => {
  const module = parseModule('// heading\ninterface Target { /* member */ read(value: string): string }\nexport default {}')
  rename(module.$ast)
  const output = generateCode(module).code
  assert.equal(output.match(/heading/g).length, 1)
  assert.equal(output.match(/member/g).length, 1)
  for (const source of [
    'export default 1.2m',
    'export default #{value: 1}',
    'import data from "data" assert {type:"json"}',
    'export default value |> reader',
  ])
    assert.throws(() => parseModule(source))
})

test('externalized source-map handling rejects abusive indexed offsets in a bounded child process', () => {
  const entry = import.meta.resolve('magicast')
  const code = `import assert from 'node:assert/strict';import {parseModule,generateCode} from ${JSON.stringify(entry)};const module=parseModule('export default {enabled:true}',{sourceFileName:'input.ts'});module.exports.default.next=1;for(const line of [1e12,Infinity,-1,0.5]){const map={version:3,sections:[{offset:{line,column:0},map:{version:3,sources:['input.ts'],names:[],mappings:'AAAA',sourcesContent:['x']}}]};assert.throws(()=>generateCode(module,{sourceMapName:'out.js.map',inputSourceMap:map}),/offset/i)};`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.error, undefined)
})

test('Nuxt configuration helpers retain comments, modules and option merging without duplicate modules', () => {
  const source = '// retain heading\nexport default defineNuxtConfig({\n  // retain option\n  devtools: {enabled: true},\n  modules: ["existing"]\n})\n'
  const module = parseModule(source)
  addNuxtModule(module, 'new-module', 'moduleOptions', {
    enabled: true,
    nested: { value: 1 },
  })
  addNuxtModule(module, 'new-module', 'moduleOptions', {
    nested: { extra: 2 },
  })
  assert.deepEqual(Array.from(getDefaultExportOptions(module).modules), ['existing', 'new-module'])
  const output = generateCode(module).code
  assert.match(output, /retain heading/)
  assert.match(output, /retain option/)
  const options = getDefaultExportOptions(parseModule(output))
  assert.equal(options.moduleOptions.nested.value, 1)
  assert.equal(options.moduleOptions.nested.extra, 2)
})

test('Vite variable/satisfies helpers add imports and update the real config declaration', () => {
  const module = parseModule('import {defineConfig} from "vite"; const config = defineConfig({plugins: []}) satisfies Config; export default config')
  addVitePlugin(module, {
    from: 'test-plugin',
    constructor: 'testPlugin',
    options: { enabled: true },
  })
  const output = generateCode(module).code
  assert.match(output, /satisfies Config/)
  assert.match(output, /test-plugin/)
  assert.match(output, /testPlugin\(/)
  const direct = parseModule('export default { plugins: [] }')
  addVitePlugin(direct, {
    from: 'test-plugin',
    constructor: 'testPlugin',
    options: { enabled: true },
  })
  assert.equal(updateVitePluginConfig(direct, { from: 'test-plugin' }, { additional: 3 }), true)
  assert.equal(getDefaultExportOptions(direct).plugins[0].$args[0].additional, 3)
})

test('literal builders, imports, exports and source maps retain their exact public contracts', () => {
  const module = parseModule('// untouched\nexport const stable = 42\nexport default {first:1}\n', { sourceFileName: 'nuxt.config.ts' })
  module.exports.default.next = builders.raw('createOptions<Target>({enabled:true})')
  module.imports.$prepend({ from: 'helper', imported: 'createOptions', local: 'createOptions' })
  const output = generateCode(module, { sourceMapName: 'nuxt.config.ts.map' })
  const { SourceMapConsumer } = require('source-map-js')
  const map = new SourceMapConsumer(output.map)
  const line = output.code.split('\n').findIndex(value => value.includes('stable = 42')) + 1
  assert.equal(map.originalPositionFor({
    line,
    column: output.code.split('\n')[line - 1].indexOf('stable'),
  }).line, 2)
  assert.equal(map.sourceContentFor('nuxt.config.ts'), '// untouched\nexport const stable = 42\nexport default {first:1}\n')
  assert.equal(parseExpression('123n'), 123n)
})

test('load/write and strict public Babel8 declarations work from isolated files', async () => {
  const directory = path.join(root, '.ai-work/runs')
  await mkdir(directory, { recursive: true })
  const scratch = await mkdtemp(path.join(directory, 'magicast-files-'))
  try {
    const filename = path.join(scratch, 'config.ts')
    await writeFile(filename, 'export default {first:1}')
    const module = await loadFile(filename)
    module.exports.default.second = 2
    await writeFile(path.join(scratch, 'types.mts'), 'import {parseModule} from "magicast"; import type {BigIntLiteral} from "@babel/types"; const node = parseModule("export default {}").$ast; void node; const value: BigIntLiteral["value"] = 1n; void value;')
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
    await writeModule(module, filename)
    assert.equal((await loadFile(filename)).exports.default.second, 2)
    const checked = spawnSync(process.execPath, [
      require.resolve('typescript/bin/tsc'),
      '--project',
      path.join(scratch, 'tsconfig.json'),
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)
    await writeFile(path.join(scratch, 'types.mts'), 'import type {BigIntLiteral} from "@babel/types"; const value: BigIntLiteral["value"] = "1"; void value;')
    const rejected = spawnSync(process.execPath, [
      require.resolve('typescript/bin/tsc'),
      '--project',
      path.join(scratch, 'tsconfig.json'),
    ], { cwd: root, encoding: 'utf8' })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stdout, /TS2322/)
  }
  finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
