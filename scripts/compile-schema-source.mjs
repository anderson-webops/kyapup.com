import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const tools = path.join(root, 'vendor/schema-parents/tools')
const require = createRequire(path.join(tools, 'package.json'))
const compilerPath = require.resolve('typescript')
assert.ok(compilerPath.startsWith(`${tools}/node_modules/typescript/`))
const compiler = require(compilerPath)
assert.equal(compiler.version, '6.0.3')
const expected = ['lib/core.ts', 'lib/compile/validate/dataType.ts', 'lib/compile/validate/index.ts']
const chunks = []
let size = 0
for await (const chunk of process.stdin) {
  size += chunk.length
  assert.ok(size <= 512 * 1024, 'Compiler input exceeds its bound')
  chunks.push(chunk)
}
const sources = JSON.parse(Buffer.concat(chunks).toString('utf8'))
assert.deepEqual(Object.keys(sources).sort(), [...expected].sort())
const output = {}
for (const filename of expected) {
  assert.equal(typeof sources[filename], 'string')
  const result = compiler.transpileModule(sources[filename], {
    fileName: filename.replace(/\.ts$/, '.cts'),
    reportDiagnostics: true,
    compilerOptions: {
      module: compiler.ModuleKind.NodeNext,
      moduleResolution: compiler.ModuleResolutionKind.NodeNext,
      target: compiler.ScriptTarget.ES2018,
      useDefineForClassFields: false,
      sourceMap: true,
      inlineSources: true,
      newLine: compiler.NewLineKind.LineFeed,
      verbatimModuleSyntax: false,
    },
  })
  const errors = (result.diagnostics || []).filter(diagnostic => diagnostic.category === compiler.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, compiler.formatDiagnosticsWithColorAndContext(errors, {
    getCurrentDirectory: () => root,
    getCanonicalFileName: name => name,
    getNewLine: () => '\n',
  }))
  const target = filename.replace(/^lib\//, 'dist/').replace(/\.ts$/, '.js')
  const mapping = JSON.parse(result.sourceMapText)
  mapping.file = path.posix.basename(target)
  mapping.sourceRoot = ''
  mapping.sources = [
    path.posix.relative(path.posix.dirname(target), filename),
  ]
  mapping.sourcesContent = [sources[filename]]
  const emitted = result.outputText.replace(/\/\/# sourceMappingURL=[^\n]+\n?$/, `//# sourceMappingURL=${path.posix.basename(target)}.map\n`)
  assert.ok(emitted.endsWith(`//# sourceMappingURL=${path.posix.basename(target)}.map\n`))
  output[target] = emitted
  output[`${target}.map`] = JSON.stringify(mapping)
}
process.stdout.write(JSON.stringify(output))
