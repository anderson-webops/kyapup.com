import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const directory = path.join(root, 'vendor/rollup-plugins/tools')
const record = JSON.parse(await readFile(path.join(directory, '../UPSTREAM.json'), 'utf8'))
const require = createRequire(path.join(directory, 'package.json'))
assert.ok(require.resolve('esbuild').startsWith(path.join(directory, 'node_modules/')))
const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
assert.deepEqual(manifest.dependencies, record.tools)
for (const [name, version] of Object.entries(record.tools)) {
  const metadata = JSON.parse(await readFile(path.join(directory, 'node_modules', name, 'package.json'), 'utf8'))
  assert.equal(metadata.name, name)
  assert.equal(metadata.version, version)
}
const { buildSync, version } = require('esbuild')

assert.equal(version, record.tools.esbuild)
const result = buildSync({
  stdin: {
    contents: 'export {walk,asyncWalk} from "estree-walker";export {default as MagicString,Bundle} from "magic-string";export {default as isReference} from "is-reference";',
    resolveDir: directory,
    sourcefile: 'webops-tools-entry.mjs',
    loader: 'js',
  },
  bundle: true,
  write: false,
  metafile: true,
  platform: 'node',
  format: 'cjs',
  target: record.target,
  legalComments: 'inline',
  logLevel: 'silent',
})
assert.equal(result.outputFiles.length, 1)
assert.deepEqual(result.warnings, [])
assert.ok(Object.values(result.metafile.outputs).every(output => output.imports.length === 0))
const licenses = {}
const inputs = Object.keys(result.metafile.inputs)
for (const filename of inputs) {
  if (path.resolve(root, filename) === path.join(directory, 'webops-tools-entry.mjs'))
    continue
  let location = path.resolve(root, filename)
  assert.ok(location.startsWith(path.join(directory, 'node_modules/')), 'Bundle inputs must belong to the independent locked graph')
  while (!existsSync(path.join(location, 'package.json')))
    location = path.dirname(location)
  const metadata = JSON.parse(await readFile(path.join(location, 'package.json'), 'utf8'))
  const license = [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'license',
  ].map(name => path.join(location, name)).find(filename => existsSync(filename))
  if (license) {
    licenses[`${metadata.name}@${metadata.version}`] = await readFile(license, 'utf8')
  }
  else {
    assert.equal(metadata.name, 'is-reference')
    assert.equal(metadata.version, '3.0.3')
    assert.equal(metadata.license, 'MIT')
    const notice = await readFile(path.join(location, 'README.md'), 'utf8')
    assert.match(notice, /## License\s+MIT\s*$/)
    licenses[`${metadata.name}@${metadata.version}`] = { manifest: metadata, publishedNotice: notice }
  }
}
for (const name of ['estree-walker', 'magic-string', 'is-reference'])
  assert.ok(inputs.some(filename => filename.includes(`/node_modules/${name}/`)))
process.stdout.write(JSON.stringify({ code: result.outputFiles[0].text, licenses }))
