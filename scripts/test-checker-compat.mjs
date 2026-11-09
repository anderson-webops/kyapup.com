import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'
import { ESLint } from 'eslint'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const entry = require.resolve('vite-plugin-checker')
const directory = path.dirname(entry)
const checkerRequire = createRequire(entry)
const frames = await import(pathToFileURL(path.join(directory, 'codeFrame.js')))
const logger = await import(pathToFileURL(path.join(directory, 'logger.js')))
const originalRequire = createRequire(path.join(root, 'vendor/vite-plugin-checker/upstream/package.json'))
const originalEntry = originalRequire.resolve('vite-plugin-checker')
assert.ok(originalEntry.startsWith(path.join(root, 'vendor/vite-plugin-checker/upstream/node_modules/')))
const original = await import(pathToFileURL(path.join(path.dirname(originalEntry), 'codeFrame.js')))

async function temporary(context) {
  const parent = path.join(root, '.ai-work/runs')
  await mkdir(parent, { recursive: true })
  const scratch = await mkdtemp(path.join(parent, 'checker-compat-'))
  context.after(() => rm(scratch, { recursive: true, force: true }))
  return scratch
}

test('the maintained ESM checker uses native Babel8 and preserves the exact original identity', () => {
  assert.ok(entry.startsWith(path.join(root, 'node_modules/')))
  const nuxt = createRequire(require.resolve('@nuxt/vite-builder'))
  assert.equal(nuxt.resolve('vite-plugin-checker'), entry)
  const parent = JSON.parse(readFileSync(path.join(directory, '../package.json'), 'utf8'))
  assert.equal(parent.version, '0.14.5-webops.1')
  assert.equal(parent.type, 'module')
  assert.equal(parent.dependencies['@babel/code-frame'], '8.0.6')
  const upstream = JSON.parse(readFileSync(path.join(directory, '../UPSTREAM-PACKAGE.json'), 'utf8'))
  assert.equal(upstream.version, '0.14.5')
  assert.equal(upstream.dependencies['@babel/code-frame'], '^7.29.0')
  const providerPath = checkerRequire.resolve('@babel/code-frame/package.json')
  assert.ok(providerPath.startsWith(path.join(root, 'node_modules/')))
  const provider = JSON.parse(readFileSync(providerPath, 'utf8'))
  assert.equal(provider.version, '8.0.6')
  const dependencies = createRequire(providerPath)
  assert.equal(JSON.parse(readFileSync(dependencies.resolve('@babel/helper-validator-identifier/package.json'), 'utf8')).version, '8.0.6')
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  for (const [location, metadata] of Object.entries(lock.packages)) {
    if (/(?:^|\/)node_modules\/@babel\/[^/]+$/.test(location))
      assert.match(metadata.version, /^8\./, location)
  }
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.overrides['vite-plugin-checker'], '$vite-plugin-checker')
  assert.equal(manifest.overrides['@babel/code-frame'], undefined)
  assert.match(readFileSync(path.join(directory, 'codeFrame.js'), 'utf8'), /import \{ codeFrameColumns \} from "\.\/babel8.js"/)
  const baseline = createRequire(originalEntry)
  assert.equal(JSON.parse(readFileSync(path.join(path.dirname(baseline.resolve('@babel/code-frame')), '../package.json'), 'utf8')).version, '7.29.7')
})

test('TypeScript, line/column and UTF16 offset locations preserve the actual parent conversions', () => {
  assert.deepEqual(frames.tsLikeLocToBabelLoc({
    start: { line: 0, character: 6 },
    end: { line: 0, character: 11 },
  }), {
    start: { line: 1, column: 7 },
    end: { line: 1, column: 12 },
  })
  assert.deepEqual(frames.lineColLocToBabelLoc({
    line: 2,
    column: 3,
    endLine: 2,
    endColumn: 8,
  }), {
    start: { line: 2, column: 3 },
    end: { line: 2, column: 8 },
  })
  const source = 'const sky = "☀😀";\r\nconst café = missing;'
  assert.deepEqual(frames.offsetRangeToBabelLocation(source, source.indexOf('missing'), 7), {
    start: { line: 2, column: 14 },
    end: { line: 2, column: 21 },
  })
  assert.deepEqual(frames.offsetRangeToBabelLocation('', 0, 0), {
    start: { line: 1, column: 1 },
    end: { line: 1, column: 1 },
  })
})

test('the actual checker renders the retained source line and caret range', () => {
  const source = 'const count: number = "bad";\nexport { count };'
  const output = frames.createFrame(source, {
    start: { line: 1, column: 7 },
    end: { line: 1, column: 12 },
  })
  assert.ok(output.includes(`${String.fromCharCode(27)}[`))
  assert.equal(stripVTControlCharacters(output), '  > 1 | const count: number = "bad";\n      |       ^^^^^\n    2 | export { count };')
})

test('the native boundary preserves original single-line and omitted-column output without mutation', () => {
  const sources = [
    'const count: number = "bad";\nexport { count };',
    'const café = "☀😀";\r\nconst value = missing;',
    'alpha\nbeta\ngamma\ndelta\n',
    '',
  ]
  const locations = [
    {
      start: { line: 1, column: 1 },
    },
    {
      start: { line: 1, column: 7 },
      end: { line: 1, column: 12 },
    },
    {
      start: { line: 1 },
      end: { line: 2 },
    },
    {
      start: { line: 2, column: 1 },
      end: { line: 2, column: 5 },
    },
  ]
  for (const source of sources) {
    for (const location of locations) {
      const before = structuredClone(location)
      assert.equal(stripVTControlCharacters(frames.createFrame(source, location)), stripVTControlCharacters(original.createFrame(source, location)))
      assert.deepEqual(location, before)
    }
  }
})

test('multiline ranges use the actual exclusive end column and each intervening source length', () => {
  const source = 'alpha\nbeta\ngamma\ndelta\n'
  const location = frames.offsetRangeToBabelLocation(source, 1, source.indexOf('gamma') + 2 - 1)
  assert.deepEqual(location, {
    start: { line: 1, column: 2 },
    end: { line: 3, column: 3 },
  })
  assert.equal(stripVTControlCharacters(frames.createFrame(source, location)), '  > 1 | alpha\n      |  ^^^^\n  > 2 | beta\n      | ^^^^\n  > 3 | gamma\n      | ^^\n    4 | delta\n    5 |')
})

for (const source of [
  'const café = "☀😀";\r\nconsole.log(café);',
  'const value = import("data", { with: { type: "json" } });',
  'using resource = acquire();',
  'const result = <Widget title="<unsafe>" />;',
  'type Props<T> = { [Key in keyof T]: T[Key] };',
]) {
  test(`current tokenization preserves the source of ${source.split('\n')[0]}`, () => {
    const output = frames.createFrame(source, {
      start: { line: 1, column: 1 },
      end: { line: 1, column: 6 },
    })
    assert.ok(stripVTControlCharacters(output).includes(source.split(/\r?\n/)[0]))
    assert.match(stripVTControlCharacters(output), /\^\^\^\^\^/)
  })
}

test('TypeScript and Vue diagnostics retain message, location, source and browser payload', () => {
  const source = 'const count: number = "bad";'
  const diagnostic = {
    file: ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true),
    start: source.indexOf('count'),
    length: 5,
    category: ts.DiagnosticCategory.Error,
    code: 2322,
    messageText: 'Type string is not assignable to type number.',
  }
  for (const normalize of [logger.normalizeTsDiagnostic, logger.normalizeVueTscDiagnostic]) {
    const result = normalize(diagnostic)
    assert.equal(result.message, diagnostic.messageText)
    assert.deepEqual(result.loc, {
      start: { line: 1, column: 7 },
      end: { line: 1, column: 12 },
    })
    assert.equal(result.id, 'fixture.ts')
    assert.match(result.stripedCodeFrame, /\^\^\^\^\^/)
    const runtime = logger.diagnosticToRuntimeError(result)
    assert.equal(runtime.frame, result.stripedCodeFrame)
    assert.equal(runtime.message, diagnostic.messageText)
    assert.deepEqual(runtime.loc, { file: 'fixture.ts', line: 1, column: 7 })
    assert.equal(runtime.level, ts.DiagnosticCategory.Error)
    assert.ok(stripVTControlCharacters(logger.diagnosticToTerminalLog(result)).includes(source))
  }
  const result = logger.normalizeTsDiagnostic({
    ...diagnostic,
    file: undefined,
    start: undefined,
    length: undefined,
  })
  assert.equal(result.loc, undefined)
  assert.equal(result.codeFrame, undefined)
  assert.equal(result.message, diagnostic.messageText)
})

test('real ESLint errors and Stylelint adapter fixtures preserve highlighted source', async () => {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: {
      rules: { 'no-debugger': 'error' },
    },
  })
  const [diagnostic] = await eslint.lintText('debugger;\n', { filePath: 'fixture.js' })
  const [result] = logger.normalizeEslintDiagnostic(diagnostic)
  assert.match(result.message, /Unexpected 'debugger' statement.*no-debugger/)
  assert.match(result.stripedCodeFrame, /debugger;/)
  assert.equal(result.loc.start.line, 1)
  assert.equal(result.loc.start.column, 1)
  assert.equal(result.level, 1)
  const [style] = logger.normalizeStylelintDiagnostic({
    source: 'fixture.css',
    _postcssResult: { css: '.fixture { colr: red; }' },
    warnings: [
      {
        text: 'Unexpected property colr',
        rule: 'property-no-unknown',
        severity: 'error',
        line: 1,
        column: 12,
        endLine: 1,
        endColumn: 16,
      },
    ],
  })
  assert.match(style.stripedCodeFrame, /colr: red/)
  assert.match(style.message, /property-no-unknown/)
  assert.equal(style.level, 1)
})

test('the actual TypeScript worker reports an error and clears it after a source repair', { timeout: 30_000 }, async (context) => {
  const scratch = await temporary(context)
  const source = path.join(scratch, 'case.ts')
  await writeFile(source, 'export const count: number = "bad";\n')
  await writeFile(path.join(scratch, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      types: [],
    },
    include: ['case.ts'],
  }))
  const { createServeAndBuild } = await import(pathToFileURL(path.join(directory, 'checkers/typescript/main.js')))
  const { serve } = createServeAndBuild({
    typescript: { root: scratch },
  }, { command: 'serve', mode: 'development' })
  context.after(() => serve.worker.terminate())
  const actions = []
  let failure
  serve.worker.on('error', error => failure = error)
  serve.worker.on('message', action => actions.push(action))
  serve.config({ enableOverlay: true, enableTerminal: true })
  serve.configureServer({ root: scratch })
  async function waitFor(predicate) {
    const deadline = Date.now() + 12_000
    while (Date.now() < deadline) {
      if (failure)
        throw failure
      const result = actions.find(predicate)
      if (result)
        return result
      await delay(30)
    }
    assert.fail(`Missing checker worker outcome: ${JSON.stringify(actions)}`)
  }
  const failed = await waitFor(action => action.type === 'overlayError' && action.payload.data.diagnostics.length > 0)
  const [diagnostic] = failed.payload.data.diagnostics
  assert.equal(diagnostic.id, source)
  assert.match(diagnostic.message, /not assignable/)
  assert.match(diagnostic.frame, /count: number = "bad"/)
  assert.deepEqual(diagnostic.loc, { file: source, line: 1, column: 14 })
  actions.length = 0
  await writeFile(source, 'export const count: number = 2;\n')
  await waitFor(action => action.type === 'overlayError' && action.payload.data.diagnostics.length === 0)
  await waitFor(action => action.type === 'console' && stripVTControlCharacters(action.payload).includes('Found 0 errors'))
})

test('the current public code-frame types support positive and reject invalid location/options contracts', async (context) => {
  const scratch = await temporary(context)
  await writeFile(path.join(scratch, 'positive.ts'), `import {codeFrameColumns,highlight} from "@babel/code-frame";import {createFrame} from ${JSON.stringify(path.join(directory, 'codeFrame.js'))};type SourceLocation=Parameters<typeof codeFrameColumns>[1];const location:SourceLocation={start:{line:1,column:0},end:{line:1,column:3}};const frame:string=codeFrameColumns("const value=1",location,{forceColor:true,linesAbove:1,linesBelow:1,message:"fixture"});const colored:string=highlight(frame);const checked:string=createFrame(colored,{start:{line:1}});void checked;`)
  const configuration = {
    compilerOptions: {
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      target: 'ESNext',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      types: [],
    },
    files: ['positive.ts'],
  }
  const config = path.join(scratch, 'tsconfig.json')
  await writeFile(config, JSON.stringify(configuration))
  const command = [
    require.resolve('typescript/lib/tsc.js'),
    '--project',
    config,
  ]
  execFileSync(process.execPath, command, { cwd: scratch, encoding: 'utf8', timeout: 20_000 })
  await writeFile(path.join(scratch, 'negative.ts'), 'import {codeFrameColumns} from "@babel/code-frame";codeFrameColumns("text",{start:{line:"wrong"}},{forceColor:"wrong"});')
  await writeFile(config, JSON.stringify({
    ...configuration,
    files: ['negative.ts'],
  }))
  assert.throws(() => execFileSync(process.execPath, command, {
    cwd: scratch,
    encoding: 'utf8',
    timeout: 20_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }), error => error.status !== 0 && /TS2322/.test(error.stdout))
})
