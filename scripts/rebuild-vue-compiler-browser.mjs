import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const upstream = JSON.parse(await readFile(path.join(root, 'vendor/vue-compiler/UPSTREAM.json'), 'utf8'))
const directory = path.join(root, 'vendor/vue-compiler/browser-tools')
const require = createRequire(path.join(directory, 'package.json'))
const esbuildEntry = require.resolve('esbuild')
assert.ok(esbuildEntry.startsWith(path.join(directory, 'node_modules/')), 'Use the independent locked browser tooling installation')
const { buildSync, version } = require('esbuild')

assert.equal(version, upstream.browserBundler.esbuild)
const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
assert.deepEqual(metadata.dependencies, upstream.browserTools)
for (const [name, expected] of Object.entries(upstream.browserTools)) {
  const installed = JSON.parse(await readFile(path.join(directory, 'node_modules', name, 'package.json'), 'utf8'))
  assert.equal(installed.name, name)
  assert.equal(installed.version, expected)
}
const chunks = []
let size = 0
for await (const chunk of process.stdin) {
  size += chunk.length
  assert.ok(size <= 8 * 1024 * 1024, 'The browser compiler input exceeds its bound')
  chunks.push(chunk)
}
const result = buildSync({
  stdin: {
    contents: Buffer.concat(chunks).toString('utf8'),
    sourcefile: '@vue/compiler-sfc/maintained-browser.js',
    resolveDir: directory,
    loader: 'js',
  },
  bundle: true,
  write: false,
  metafile: true,
  platform: process.argv.includes('--node-adapter')
    ? 'node'
    : 'browser',
  format: process.argv.includes('--node-adapter')
    ? 'cjs'
    : 'esm',
  target: upstream.browserBundler.target,
  legalComments: 'inline',
  logLevel: 'silent',
})
assert.equal(result.outputFiles.length, 1)
assert.deepEqual(result.warnings, [], 'Compiler rebuilding requires a reviewed, warning-free result')
assert.ok(Object.values(result.metafile.outputs).every(output => output.imports.length === 0), 'The browser compiler must remain standalone')
const inputs = Object.keys(result.metafile.inputs)
const licenses = {}
for (const filename of inputs) {
  if (path.resolve(root, filename) === path.join(directory, '@vue/compiler-sfc/maintained-browser.js'))
    continue
  let packageDirectory = path.resolve(root, filename)
  assert.ok(packageDirectory.startsWith(path.join(directory, 'node_modules/')), 'Compiler bundles use only the independent locked graph')
  while (!existsSync(path.join(packageDirectory, 'package.json')))
    packageDirectory = path.dirname(packageDirectory)
  const dependency = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'))
  const license = [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'license',
  ].map(name => path.join(packageDirectory, name)).find(filename => existsSync(filename))
  assert.ok(license, `Preserve the ${dependency.name} license`)
  licenses[`${dependency.name}@${dependency.version}`] = await readFile(license, 'utf8')
}
for (const name of ['@babel/parser', 'estree-walker', 'magic-string'])
  assert.ok(inputs.some(filename => filename.includes(`/node_modules/${name}/`)), `The standalone compiler must include ${name}`)
process.stdout.write(JSON.stringify({ code: result.outputFiles[0].text, licenses }))
