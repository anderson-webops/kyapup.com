import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { createGenerator } from '@unocss/core'
import presetAttributify from '@unocss/preset-attributify'
import presetWind3 from '@unocss/preset-wind3'
import { ESLint } from 'eslint'
import MagicString from 'magic-string'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const original = createRequire(path.join(root, 'vendor/native-providers/upstream/package.json'))
const records = JSON.parse(readFileSync(path.join(root, 'vendor/native-providers/UPSTREAM.json'), 'utf8'))
const load = (name, resolver = require) => import(pathToFileURL(resolver.resolve(name)))
const formatter = await load('oxfmt')
const oldFormatter = await load('oxfmt', original)
const plugin = (await load('eslint-plugin-format')).default
const oldPlugin = (await load('eslint-plugin-format', original)).default
const transformer = (await load('@unocss/transformer-attributify-jsx')).default
const oldTransformer = (await load('@unocss/transformer-attributify-jsx', original)).default

async function temporary(context) {
  const directory = path.join(root, '.ai-work/runs')
  await mkdir(directory, { recursive: true })
  const scratch = await mkdtemp(path.join(directory, 'native-providers-'))
  context.after(() => rm(scratch, { recursive: true, force: true }))
  return scratch
}

function lintEngine(parent, rule, options, fix) {
  return new ESLint({
    cwd: root,
    overrideConfigFile: true,
    fix,
    overrideConfig: [
      {
        files: ['**/*.*'],
        languageOptions: { parser: parent.parserPlain },
        plugins: { format: parent },
        rules: {
          [`format/${rule}`]: ['error', options],
        },
      },
    ],
  })
}

async function transform(parent, generator, source, options = {}, filename = 'fixture.tsx') {
  const adapter = parent(options)
  const output = new MagicString(source)
  if (adapter.idFilter(filename))
    await adapter.transform(output, filename, { uno: generator })
  return output
}

function reviewedSource(name, filename, source) {
  if (name === 'unconfig' && filename === 'dist/index.d.mts')
    return Buffer.from(source.toString().replace('[force?: Args[0] | undefined]', '[force?: boolean | undefined]'))
  if (name === '@unocss/vite' && filename === 'dist/index.mjs') {
    const before = '\t\t\ttransform(code, id) {\n\t\t\t\treturn applyTransformers(ctx, code, id, order);\n\t\t\t},'
    const after = '\t\t\ttransform: {\n\t\t\t\torder: order === "pre" ? "pre" : void 0,\n\t\t\t\thandler(code, id) {\n\t\t\t\t\treturn applyTransformers(ctx, code, id, order);\n\t\t\t\t}\n\t\t\t},'
    assert.equal(source.toString().split(before).length, 2)
    let output = source.toString().replace(before, after)
    for (const indent of ['\t\t', '\t\t\t']) {
      const scan = `${indent}transform(code, id) {\n${indent}\tif (filter(code, id)) tasks.push(extract(code, id));\n${indent}\treturn null;\n${indent}},`
      const handler = `${indent}transform: {\n${indent}\torder: "pre",\n${indent}\thandler(code, id) {\n${indent}\t\tif (filter(code, id)) tasks.push(extract(code, id));\n${indent}\t\treturn null;\n${indent}\t}\n${indent}},`
      assert.equal(output.split(scan).length, 2)
      output = output.replace(scan, handler)
    }
    return Buffer.from(output)
  }
  return source
}

test('all parent consumers resolve the actual current native versions without legacy application copies', () => {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages
  for (const [name, provider, version] of [
    ['eslint-plugin-format', 'oxfmt', '0.78.0'],
    ['@unocss/transformer-attributify-jsx', 'oxc-parser', '0.158.0'],
  ]) {
    const parent = createRequire(require.resolve(name))
    assert.equal(parent.resolve(provider), require.resolve(provider))
    const providers = Object.entries(lock).filter(([filename]) => filename.endsWith(`node_modules/${provider}`))
    assert.ok(providers.length)
    for (const [filename, metadata] of providers)
      assert.equal(metadata.version, version, filename)
    const reference = JSON.parse(readFileSync(original.resolve(`${provider}/package.json`), 'utf8'))
    assert.equal(reference.version, provider === 'oxfmt'
      ? '0.35.0'
      : '0.153.0')
  }
  for (const name of ['@unocss/config', 'taze']) {
    const consumer = createRequire(require.resolve(name))
    assert.equal(consumer.resolve('unconfig'), require.resolve('unconfig'))
  }
  for (const [filename, metadata] of Object.entries(lock)) {
    if (/(?:^|\/)node_modules\/(?:@unocss\/[^/]+|unocss)$/.test(filename))
      assert.match(metadata.version, /^66\.13\.0(?:-webops\.1)?$/, filename)
  }
})

test('maintained parents preserve all original payload bytes except the two exact reviewed corrections', () => {
  const dependencyNames = {
    'eslint-plugin-format': 'oxfmt',
    '@unocss/transformer-attributify-jsx': 'oxc-parser',
    'unconfig': 'unconfig-core',
    '@unocss/vite': '@unocss/core',
  }
  for (const [name, record] of Object.entries(records)) {
    const directory = path.resolve(path.dirname(require.resolve(name)), '..')
    const originalDirectory = path.resolve(path.dirname(original.resolve(name)), '..')
    for (const [filename, digest] of Object.entries(record.files)) {
      const source = readFileSync(path.join(originalDirectory, filename))
      assert.equal(createHash('sha256').update(source).digest('hex'), digest)
      if (filename !== 'package.json') {
        assert.deepEqual(readFileSync(path.join(directory, filename)), reviewedSource(name, filename, source), `${name}/${filename}`)
      }
    }
    const preserved = readFileSync(path.join(directory, 'UPSTREAM-PACKAGE.json'))
    assert.deepEqual(preserved, readFileSync(path.join(originalDirectory, 'package.json')))
    assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'WEBOPS-COMPAT.json'), 'utf8')), record)
    const expected = structuredClone(record.package)
    expected.version = record.patchedVersion
    expected.private = true
    expected.dependencies[dependencyNames[name]] = record.qualifiedRange
    assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')), expected)
  }
})

test('UnoCSS virtual CSS identities preserve queries and remain idempotent', async () => {
  const { fromViteVirtualId, toViteClientPath, toViteVirtualId } = await load('@unocss/vite')
  for (const identity of ['/@unocss/entry.css?inline', 'unocss:chunk-empty-entry', '/spaces in path/entry.css?url&v=🙂']) {
    const virtual = `\0${identity}`
    assert.equal(toViteVirtualId(identity), virtual)
    assert.equal(toViteVirtualId(virtual), virtual)
    assert.equal(fromViteVirtualId(virtual), identity)
    assert.equal(fromViteVirtualId(identity), identity)
    assert.equal(toViteClientPath(virtual), `/@id/__x00__${identity}`)
    assert.equal(toViteClientPath(identity), identity)
  }
})

const formatCases = [
  [
    'fixture.js',
    'const value={name:"value",items:[1,2]}',
    { semi: false, singleQuote: true },
  ],
  [
    'fixture.ts',
    'const value:number=1',
    { semi: true, useTabs: true },
  ],
  [
    'fixture.tsx',
    'const view=<div title="value">hello</div>',
    { singleQuote: true, semi: false },
  ],
  [
    'fixture.json',
    '{"second":2,"first":[1,2]}',
    { tabWidth: 4 },
  ],
  [
    'fixture.css',
    '.value{color:red;display:flex}',
    { useTabs: false, tabWidth: 2 },
  ],
  [
    'fixture.html',
    '<div><span>hello</span></div>',
    { printWidth: 80 },
  ],
  [
    'fixture.vue',
    '<template><div>hello</div></template>',
    { vueIndentScriptAndStyle: true },
  ],
]

for (const [filename, source, options] of formatCases) {
  test(`actual native formatting retains options and repeatability for ${filename}`, async () => {
    const expected = await oldFormatter.format(filename, source, options)
    const current = await formatter.format(filename, source, options)
    assert.deepEqual(expected.errors, [])
    assert.deepEqual(current.errors, [])
    assert.equal(current.code, expected.code)
    assert.equal((await formatter.format(filename, current.code, options)).code, current.code)
  })
}

for (const [rule, options, filename, source] of [
  [
    'oxfmt',
    { semi: false, singleQuote: true },
    'fixture.ts',
    'const value:number=1',
  ],
  [
    'prettier',
    { parser: 'babel', semi: false, singleQuote: true },
    'fixture.js',
    'const value={name:"value"}',
  ],
  [
    'dprint',
    { language: 'toml' },
    'fixture.toml',
    'value=1',
  ],
]) {
  test(`the real ESLint ${rule} worker reports, fixes and accepts repeated source`, async (context) => {
    const scratch = await temporary(context)
    const filePath = path.join(scratch, filename)
    const [reported] = await lintEngine(plugin, rule, options, false).lintText(source, { filePath })
    assert.ok(reported.errorCount > 0)
    assert.ok(reported.messages.every(message => message.ruleId === `format/${rule}` && message.fix))
    const [fixed] = await lintEngine(plugin, rule, options, true).lintText(source, { filePath })
    const [control] = await lintEngine(oldPlugin, rule, options, true).lintText(source, { filePath })
    assert.equal(fixed.errorCount, 0)
    assert.equal(fixed.output, control.output)
    assert.ok(fixed.output)
    const [repeated] = await lintEngine(plugin, rule, options, true).lintText(fixed.output, { filePath })
    assert.equal(repeated.errorCount, 0)
    assert.equal(repeated.output, undefined)
  })
}

test('native syntax failures remain explicit while unsupported files retain the original contract', async (context) => {
  const scratch = await temporary(context)
  const options = { semi: false }
  for (const parent of [plugin, oldPlugin]) {
    const [invalid] = await lintEngine(parent, 'oxfmt', options, true).lintText('const =', {
      filePath: path.join(scratch, 'invalid.ts'),
    })
    assert.equal(invalid.errorCount, 1)
    assert.match(invalid.messages[0].message, /Failed to format the code:.*Unexpected token/)
    assert.equal(invalid.output, undefined)
    const [unsupported] = await lintEngine(parent, 'oxfmt', options, true).lintText('unmodified', {
      filePath: path.join(scratch, 'unsupported.nativefixture'),
    })
    assert.equal(unsupported.errorCount, 0)
    assert.equal(unsupported.output, undefined)
  }
  const invalid = await formatter.format('invalid.ts', 'const =', options)
  assert.ok(invalid.errors.length)
  assert.equal(invalid.code, 'const =')
})

test('concurrent native calls and CR/CRLF options retain independent results', async () => {
  await Promise.all(Array.from({ length: 24 }, async (unused, index) => {
    const options = {
      semi: index % 2 === 0,
      endOfLine: index % 3 === 0
        ? 'cr'
        : 'crlf',
    }
    const source = `const value${index}:number=${index}`
    const current = await formatter.format('fixture.ts', source, options)
    const reference = await oldFormatter.format('fixture.ts', source, options)
    assert.deepEqual(current.errors, [])
    assert.equal(current.code, reference.code)
  }))
})

test('legacy formatter option aliases preserve the supported original configuration behavior', async () => {
  for (const [filename, source, options] of [
    [
      'fixture.ts',
      'import {z} from "./z";\nimport {a} from "./a";\nexport {z,a};',
      { experimentalSortImports: {}, semi: false },
    ],
    [
      'package.json',
      '{"version":"1.0.0","scripts":{"z":"last","a":"first"},"name":"fixture"}',
      {
        experimentalSortPackageJson: { sortScripts: true },
      },
    ],
    [
      'fixture.ts',
      'const value=1',
      { insertFinalNewline: false, semi: false },
    ],
  ]) {
    const reference = await oldFormatter.format(filename, source, options)
    const current = await formatter.format(filename, source, options)
    assert.deepEqual(current.errors, [])
    assert.deepEqual(reference.errors, [])
    assert.equal(current.code, reference.code)
  }
})

const jsxCases = [
  'const view = <div flex p-4 text-red-500 />',
  'const view = <><div flex><span font-bold /></div></>',
  'const view = <div title="🙂" flex hover:text-blue-500 />',
  'const view = <div {...props} disabled unknown data-name="kept" flex />',
  'const view = <div title={"<span flex />"} flex={true} p-4 />',
  'const view = <Component flex><div p-4 /></Component>',
  'type Value = number; const view = <div\n flex\n p-4\n />; const preserved = "retained"',
]

test('native JSX transformations preserve nesting, Unicode offsets, attributes and source maps', async () => {
  const generator = await createGenerator({
    presets: [
      presetAttributify(),
      presetWind3(),
    ],
  })
  for (const source of jsxCases) {
    const options = {
      include: [
        { pattern: /\.tsx$/, resolver: 'oxc' },
      ],
    }
    const current = await transform(transformer, generator, source, options)
    const reference = await transform(oldTransformer, generator, source, options)
    assert.equal(current.toString(), reference.toString())
    if (source.includes('flex={true}')) {
      assert.match(current.toString(), /flex=\{true\}/)
      assert.match(current.toString(), /p-4=""/)
    }
    else {
      assert.match(current.toString(), /flex=""/)
    }
    const map = current.generateMap({ hires: true, source: 'fixture.tsx', includeContent: true })
    assert.deepEqual(map.sourcesContent, [source])
    const trace = new TraceMap(map.toString())
    const marker = source.includes('retained')
      ? 'retained'
      : 'const'
    const sourceOffset = source.indexOf(marker)
    const outputOffset = current.toString().indexOf(marker)
    const beforeOutput = current.toString().slice(0, outputOffset).split('\n')
    const beforeSource = source.slice(0, sourceOffset).split('\n')
    const position = originalPositionFor(trace, { line: beforeOutput.length, column: beforeOutput.at(-1).length })
    assert.equal(position.line, beforeSource.length)
    assert.equal(position.column, beforeSource.at(-1).length)
  }
})

test('prefixes, explicit blocks, exclusions and filters retain exact original behavior', async () => {
  const generator = await createGenerator({
    presets: [
      presetAttributify({ prefix: 'uno-' }),
      presetWind3(),
    ],
  })
  const source = 'const view = <div uno-flex p-4 text-red-500 />'
  const options = {
    blocklist: ['p-4', /^text-/],
    include: [
      { pattern: /\.tsx$/, resolver: 'oxc' },
    ],
  }
  const current = await transform(transformer, generator, source, options)
  assert.equal(current.toString(), (await transform(oldTransformer, generator, source, options)).toString())
  assert.match(current.toString(), /uno-flex="" p-4 text-red-500/)
  assert.equal((await transform(transformer, generator, source, { exclude: /fixture/ })).toString(), source)
  assert.equal((await transform(transformer, generator, source, {}, 'fixture.txt')).toString(), source)
})

test('forced native failures reject and the existing MDX regex fallback remains visible', async () => {
  const generator = await createGenerator({
    presets: [
      presetAttributify(),
      presetWind3(),
    ],
  })
  const warnings = []
  const warn = console.warn
  console.warn = (...arguments_) => warnings.push(arguments_.join(' '))
  try {
    for (const parent of [transformer, oldTransformer]) {
      await assert.rejects(transform(parent, generator, 'const view = <div', {
        include: [
          { pattern: /\.tsx$/, resolver: 'oxc' },
        ],
      }), /Oxc parse errors/)
      const source = '# Heading\n<div flex />'
      const fallback = await transform(parent, generator, source, {}, 'fixture.mdx')
      assert.match(fallback.toString(), /flex=""/)
    }
  }
  finally {
    console.warn = warn
  }
  assert.equal(warnings.length, 2)
  assert.ok(warnings.every(message => message.includes('Oxc resolver failed') && message.includes('falling back to regex')))
})

test('the declaration repair preserves real synchronous, asynchronous, cached and forced configuration loading', async (context) => {
  const scratch = await temporary(context)
  const filename = path.join(scratch, 'fixture.config.json')
  for (const resolver of [require, original]) {
    const { createConfigLoader, loadConfig } = await load('unconfig', resolver)
    const options = {
      cwd: scratch,
      stopAt: path.dirname(scratch),
      defaults: { value: 0 },
      sources: [
        {
          files: 'fixture.config',
          extensions: ['json'],
        },
      ],
    }
    await rm(filename, { force: true })
    const loader = createConfigLoader(options)
    assert.equal((await loader.load.async()).config.value, 0)
    await writeFile(filename, '{"value":1}')
    assert.equal((await loader.load.async(false)).config.value, 0)
    assert.equal((await loader.load.async(true)).config.value, 1)
    await writeFile(filename, '{"value":2}')
    assert.equal((await loader.load.async(false)).config.value, 2)
    assert.equal((await loader.load.async(true)).config.value, 2)
    await writeFile(filename, '{"value":3}')
    assert.equal(loader.load.sync(false).config.value, 3)
    assert.equal(loader.load.sync(true).config.value, 3)
    assert.equal(loadConfig.sync(options).config.value, 3)
    assert.equal((await loadConfig.async(options)).config.value, 3)
    await writeFile(filename, '{invalid')
    await assert.rejects(loader.load.async(true))
    await writeFile(filename, '{"value":4}')
    assert.equal((await loader.load.async(true)).config.value, 4)
    await writeFile(path.join(scratch, 'native.config.ts'), 'export default { value: 5 satisfies number }')
    const typed = {
      cwd: scratch,
      stopAt: path.dirname(scratch),
      sources: [
        {
          files: 'native.config',
          extensions: ['ts'],
        },
      ],
    }
    assert.equal(loadConfig.sync(typed).config.value, 5)
    assert.equal((await loadConfig.async(typed)).config.value, 5)
  }
})
