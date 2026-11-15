import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as unimport from 'unimport'
import * as addons from 'unimport/addons'
import plugin from 'unimport/unplugin'

const root = fileURLToPath(new URL('..', import.meta.url))
const buildRequire = createRequire(path.join(root, 'vendor/unimport/build/package.json'))
const mlly = await import(pathToFileURL(buildRequire.resolve('mlly')))

async function temporary(context) {
  const parent = path.join(root, '.ai-work/runs')
  await mkdir(parent, { recursive: true })
  const directory = await mkdtemp(path.join(parent, 'unimport-case-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function fixturePackage(directory, name, symbol) {
  const destination = path.join(directory, 'node_modules', name)
  await mkdir(destination, { recursive: true })
  await writeFile(path.join(destination, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    type: 'module',
    exports: './index.mjs',
  }))
  await writeFile(path.join(destination, 'index.mjs'), `export const ${symbol} = 1\n`)
}

test('compiled public entrypoints preserve the upstream API identity', () => {
  assert.equal(unimport.version, '7.0.2')
  assert.equal(typeof unimport.createUnimport, 'function')
  assert.equal(typeof unimport.scanDirExports, 'function')
  assert.equal(typeof addons.vueDirectivesAddon, 'function')
  assert.equal(typeof addons.vueTemplateAddon, 'function')
  assert.equal(typeof plugin.raw, 'function')
})

for (const parser of ['acorn', 'oxc']) {
  test(`compiled auto-import injection preserves alias and source maps:${parser}`, async () => {
    const context = unimport.createUnimport({
      parser,
      imports: [
        { name: 'original', as: 'selected', from: 'fixture-lib' },
      ],
    })
    const result = await context.injectImports('export const value = selected()', 'component.ts')
    assert.match(result.code.toString(), /import \{ original as selected \} from 'fixture-lib'/)
    assert.ok(result.s.generateMap({ hires: true }).mappings)
  })
}

test('package scanning uses the child project while explicit package URLs remain authoritative', async (context) => {
  const directory = await temporary(context)
  const child = path.join(directory, 'child')
  await mkdir(child)
  await fixturePackage(directory, 'unimport-owned-fixture', 'parentOnly')
  await fixturePackage(child, 'unimport-owned-fixture', 'childOnly')
  const previous = process.cwd()
  process.chdir(child)
  try {
    assert.deepEqual(await mlly.resolveModuleExportNames('unimport-owned-fixture'), ['parentOnly'])
    const current = await unimport.resolvePreset({ package: 'unimport-owned-fixture', cache: false })
    assert.deepEqual(current.map(item => item.name), ['childOnly'])
    const explicit = await unimport.resolvePreset({ package: 'unimport-owned-fixture', cache: false, url: pathToFileURL(path.join(directory, 'package.json')).href })
    assert.deepEqual(explicit.map(item => item.name), ['parentOnly'])
  }
  finally {
    process.chdir(previous)
  }
})

test('compiled directory scanning and generated declarations retain value/type imports', async (context) => {
  const directory = await temporary(context)
  await writeFile(path.join(directory, 'symbols.ts'), 'export const value = 1; export interface Entry { value: number }\n')
  const imports = await unimport.scanDirExports([directory])
  assert.ok(imports.some(item => item.name === 'value' && !item.type))
  assert.ok(imports.some(item => item.name === 'Entry' && item.type))
  const instance = unimport.createUnimport({ imports })
  const declarations = await instance.generateTypeDeclarations()
  assert.match(declarations, /value/)
  assert.match(declarations, /Entry/)
})

test('compiled core and addon declarations typecheck with strict NodeNext consumers', async (context) => {
  const directory = await temporary(context)
  const definition = `import { createUnimport, type Import } from 'unimport'\nimport { vueTemplateAddon } from 'unimport/addons'\nconst item: Import = { name: 'selected', from: 'fixture-lib' }\nconst context = createUnimport({ imports: [item], addons: [vueTemplateAddon()] })\nawait context.injectImports('selected()', 'entry.ts')\n`
  await writeFile(path.join(directory, 'consumer.mts'), definition)
  await writeFile(path.join(directory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ESNext',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: ['node'],
    },
    files: ['consumer.mts'],
  }))
  const require = createRequire(import.meta.url)
  execFileSync(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '-p',
    path.join(directory, 'tsconfig.json'),
  ], { cwd: root, stdio: 'inherit', timeout: 60000 })
})

test('each locked consumer carries identical source provenance and archive identity', async () => {
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  const consumers = Object.entries(lock.packages).filter(([location]) => location === 'node_modules/unimport' || location.endsWith('/node_modules/unimport'))
  assert.ok(consumers.length)
  for (const [location, metadata] of consumers) {
    assert.equal(metadata.version, '7.0.2+webops.3')
    const provenance = JSON.parse(await readFile(path.join(root, location, 'WEBOPS-SOURCE.json'), 'utf8'))
    assert.equal(provenance.schemaVersion, 2)
    assert.equal(provenance.source.commit, 'bbd07768ddb4919205bcb5a3cbc06c3a2791981a')
    assert.equal(provenance.source.signerFingerprint, '83DFB8EACB2CCD9ACE75B47CFB8599EBAB9E40B9')
    assert.equal(provenance.build.tool, 'tsdown@0.23.7')
  }
})

test('VueUse preset metadata is resolved from the working project before its parent', async (context) => {
  const directory = await temporary(context)
  const child = path.join(directory, 'child')
  await mkdir(child)
  for (const [location, symbol] of [
    [directory, 'parentOnlySelected'],
    [child, 'childOnlySelected'],
  ]) {
    await fixturePackage(location, '@vueuse/core', symbol)
    const packageDirectory = path.join(location, 'node_modules/@vueuse/core')
    await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({
      name: '@vueuse/core',
      version: '1.0.0',
      type: 'module',
      exports: { '.': './index.mjs', './indexes.json': './indexes.json' },
    }))
    await writeFile(path.join(packageDirectory, 'indexes.json'), JSON.stringify({
      functions: [
        { name: symbol, package: 'core' },
      ],
    }))
  }
  const previous = process.cwd()
  process.chdir(child)
  try {
    const preset = unimport.builtinPresets['@vueuse/core']()
    assert.deepEqual(preset.imports, ['childOnlySelected'])
  }
  finally {
    process.chdir(previous)
  }
})
