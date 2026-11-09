import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import remove from 'unplugin-remove'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const provider = createRequire(require.resolve('unplugin-remove'))
const { originalPositionFor, TraceMap } = require('@jridgewell/trace-mapping')

function raw(options) {
  const plugin = remove.raw(options, { framework: 'vite' })
  assert.equal(plugin.name, 'unplugin-remove-console-debugger')
  assert.equal(plugin.apply, 'build')
  return plugin
}

function transform(code, options, id = '/fixture.js') {
  const plugin = raw(options)
  if (!plugin.transformInclude(id))
    return code
  return plugin.transform(code, id)?.code ?? code
}

function execute(code, options) {
  const calls = []
  const context = {
    console: Object.fromEntries([
      'log',
      'warn',
      'error',
      'info',
      'debug',
    ].map(name => [
      name,
      (...values) => calls.push([name, ...values]),
    ])),
  }
  vm.runInNewContext(transform(code, options), context)
  return { calls, context }
}

test('Nuxt-security resolves the maintained parent and modern nonbundled compiler graph', async () => {
  const security = createRequire(require.resolve('nuxt-security'))
  assert.equal(security.resolve('unplugin-remove/vite'), require.resolve('unplugin-remove/vite'))
  for (const [name, prefix] of [
    ['@babel/parser', '8.1.'],
    ['@babel/traverse', '8.1.'],
    ['@babel/types', '8.1.'],
    ['magic-string', '1.4.'],
    ['unplugin', '3.7.'],
  ]) {
    const metadata = JSON.parse(await readFile(provider.resolve(`${name}/package.json`), 'utf8'))
    assert.ok(metadata.version.startsWith(prefix), `${name} must use its qualified major`)
  }
})

test('configured global console statements are removed while other calls remain', () => {
  const source = 'console.log("drop");console.warn("keep");console.error("keep error");'
  assert.deepEqual(execute(source).calls, [
    ['warn', 'keep'],
    ['error', 'keep error'],
  ])
  assert.deepEqual(execute(source, {
    consoleType: ['warn', 'error'],
  }).calls, [
    ['log', 'drop'],
  ])
  assert.deepEqual(execute(source, { consoleType: [] }).calls, [
    ['log', 'drop'],
    ['warn', 'keep'],
    ['error', 'keep error'],
  ])
  assert.deepEqual(execute(source, null).calls, [
    ['warn', 'keep'],
    ['error', 'keep error'],
  ])
})

test('debugger statements are removed without changing strings, regexes or identifiers', () => {
  const source = 'const debuggerText="debugger;";const expression=/debugger;/;function debuggerFactory(){return debuggerText};debugger;globalThis.result=[debuggerFactory(),expression.test(debuggerText)];'
  const { context } = execute(source)
  assert.deepEqual(Array.from(context.result), ['debugger;', true])
  assert.equal(transform('const text="debugger;";'), 'const text="debugger;";')
})

test('removing a sole control-flow statement preserves valid branches and execution', () => {
  const source = 'let count=0;if(true)console.log("drop");else count=50;for(let index=0;index<2;index++)debugger;globalThis.result=++count;'
  const { context, calls } = execute(source)
  assert.equal(context.result, 1)
  assert.deepEqual(calls, [])
})

test('scope bindings and value-position calls preserve application behavior', () => {
  const source = 'function local(console){console.log("local")}local({log:()=>globalThis.localCount=1});const value=console.log("value");globalThis.returned=value;'
  const { context, calls } = execute(source)
  assert.equal(context.localCount, 1)
  assert.deepEqual(calls, [
    ['log', 'value'],
  ])
})

test('static computed and optional console calls are removed while dynamic properties remain', () => {
  const source = 'console["log"]("drop");console?.log("drop optional");const method="warn";console[method]("keep dynamic");'
  assert.deepEqual(execute(source).calls, [
    ['warn', 'keep dynamic'],
  ])
})

test('nested callbacks in removed statements do not produce overlapping edits', () => {
  const source = 'console.log(()=>{debugger;console.log("nested")});globalThis.result=1;'
  const { calls, context } = execute(source)
  assert.deepEqual(calls, [])
  assert.equal(context.result, 1)
})

test('source maps retain original source and exact positions after multiline removals', () => {
  const source = 'console.log(\n "drop"\n);\nconst kept = 1;\n'
  const output = raw().transform(source, '/fixture.js')
  assert.deepEqual(output.map.sourcesContent, [source])
  const lines = output.code.split('\n')
  const line = lines.findIndex(value => value.includes('kept'))
  const position = originalPositionFor(new TraceMap(output.map), {
    line: line + 1,
    column: lines[line].indexOf('kept'),
  })
  assert.equal(position.source, '/fixture.js')
  assert.equal(position.line, 4)
  assert.equal(position.column, 6)
})

test('filters and external files preserve excluded modules and query variants', () => {
  const plugin = raw()
  assert.equal(plugin.transformInclude('/src/main.js'), true)
  assert.equal(plugin.transformInclude('/src/View.vue?vue&type=script&lang.ts'), true)
  assert.equal(plugin.transformInclude('/node_modules/provider/index.js'), false)
  assert.equal(plugin.transformInclude('/.git/generated.js'), false)
  assert.equal(plugin.transformInclude('/src/style.css'), false)
  assert.equal(transform('console.log("keep")', {
    external: ['/fixture.js'],
  }), 'console.log("keep")')
  assert.equal(raw({
    external: ['/fixture.vue'],
  }).transform('not JavaScript', '/fixture.vue?vue&type=script'), undefined)
  assert.equal(transform('console.log("keep")', {
    exclude: ['/fixture.js'],
  }), 'console.log("keep")')
})

test('TypeScript, JSX and modern import syntax remain parseable and invalid source fails', async () => {
  const parser = await import(pathToFileURL(provider.resolve('@babel/parser')))
  const source = 'import data from "./data.json" with {type:"json"};console.log(data);export const load=()=>import("./view.js");export const size=1n;'
  assert.doesNotThrow(() => parser.parse(transform(source), { sourceType: 'module' }))
  assert.match(transform('const count:number=1;console.log(count)', {}, '/fixture.ts'), /count:number=1/)
  assert.match(transform('const view=<p>debugger;</p>;console.log(view)', {}, '/fixture.jsx'), /debugger;/)
  assert.throws(() => raw().transform('const value: = 1', '/bad.ts'), error => error.code === 'BABEL_PARSER_SYNTAX_ERROR')
})

test('all original adapter paths load and instantiate through ESM and CommonJS', async () => {
  for (const adapter of [
    'vite',
    'rollup',
    'rolldown',
    'esbuild',
    'webpack',
    'rspack',
  ]) {
    const esm = await import(`unplugin-remove/${adapter}`)
    const common = require(`unplugin-remove/${adapter}`)
    assert.equal(typeof esm.default, 'function', adapter)
    assert.equal(typeof common.default, 'function', adapter)
    for (const factory of [esm.default, common.default]) {
      const plugin = factory()
      if (adapter === 'esbuild')
        assert.equal(typeof plugin.setup, 'function')
      else if (adapter === 'webpack' || adapter === 'rspack')
        assert.equal(typeof plugin.apply, 'function')
      else
        assert.equal(plugin.name, 'unplugin-remove-console-debugger')
    }
  }
  assert.equal(require('unplugin-remove').default, remove)
})

test('strict native adapter types work in ESM/CommonJS and reject invalid options', async () => {
  const directory = path.join(root, '.ai-work/runs')
  await mkdir(directory, { recursive: true })
  const scratch = await mkdtemp(path.join(directory, 'remove-types-'))
  const filename = path.join(scratch, 'fixture.mts')
  const config = path.join(scratch, 'tsconfig.json')
  try {
    const source = 'import remove from "unplugin-remove/vite";import removeRollup from "unplugin-remove/rollup";import removeRolldown from "unplugin-remove/rolldown";import removeEsbuild from "unplugin-remove/esbuild";import removeWebpack from "unplugin-remove/webpack";import type {Plugin as VitePlugin} from "vite";import type {Plugin as RollupPlugin} from "rollup";import type {Plugin as RolldownPlugin} from "rolldown";import type {Plugin as EsbuildPlugin} from "esbuild";import type {WebpackPluginInstance} from "webpack";const plugin:VitePlugin=remove({consoleType:["warn"],external:["/fixture.js"]});const rollup:RollupPlugin=removeRollup();const rolldown:RolldownPlugin=removeRolldown();const esbuild:EsbuildPlugin=removeEsbuild();const webpack:WebpackPluginInstance=removeWebpack();void plugin;void rollup;void rolldown;void esbuild;void webpack;'
    await writeFile(filename, source)
    await writeFile(config, JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        strict: true,
        skipLibCheck: false,
        types: ['node'],
        lib: ['ES2022', 'DOM'],
        noEmit: true,
      },
      files: ['fixture.mts'],
    }))
    const compiler = require.resolve('typescript/bin/tsc')
    const valid = spawnSync(process.execPath, [compiler, '--project', config], { cwd: root, encoding: 'utf8' })
    assert.equal(valid.status, 0, valid.stdout + valid.stderr)
    await writeFile(path.join(scratch, 'fixture.cts'), source)
    const commonConfig = JSON.parse(await readFile(config, 'utf8'))
    commonConfig.files = ['fixture.cts']
    const commonFilename = path.join(scratch, 'common.json')
    await writeFile(commonFilename, JSON.stringify(commonConfig))
    const common = spawnSync(process.execPath, [compiler, '--project', commonFilename], { cwd: root, encoding: 'utf8' })
    assert.equal(common.status, 0, common.stdout + common.stderr)
    await writeFile(filename, source.replace('consoleType:["warn"]', 'consoleType:"warn"'))
    const invalid = spawnSync(process.execPath, [compiler, '--project', config], { cwd: root, encoding: 'utf8' })
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stdout + invalid.stderr, /TS2322/)
  }
  finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
