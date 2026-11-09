import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const source = path.join(root, 'vendor/vite-plugin-vue-devtools')

test('the current-host distribution preserves complete original metadata and all 39 upstream files', async () => {
  const upstream = JSON.parse(await readFile(path.join(source, 'UPSTREAM.json'), 'utf8'))
  assert.equal(Object.keys(upstream.files).length, 39)
  const installedRoot = path.dirname(require.resolve('vite-plugin-vue-devtools/package.json'))
  const metadata = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'))
  const expected = structuredClone(upstream.package)
  expected.version = upstream.patchedVersion
  expected.private = true
  expected.peerDependencies['@vitejs/devtools'] = upstream.hostRange
  assert.deepEqual(metadata, expected)
  assert.equal(upstream.package.dependencies['@vitejs/devtools-kit'], '^0.8.2')
  assert.equal(upstream.package.peerDependencies['@vitejs/devtools'], '^0.7.6')
  const original = await readFile(path.join(installedRoot, 'UPSTREAM-PACKAGE.json'))
  assert.deepEqual(JSON.parse(original), upstream.package)
  assert.equal(createHash('sha256').update(original).digest('hex'), upstream.files['package.json'])
  assert.deepEqual(JSON.parse(await readFile(path.join(installedRoot, 'WEBOPS-COMPAT.json'), 'utf8')), upstream)
  for (const [filename, digest] of Object.entries(upstream.files)) {
    if (filename === 'package.json')
      continue
    const installed = await readFile(path.join(installedRoot, filename))
    assert.equal(createHash('sha256').update(installed).digest('hex'), digest, filename)
  }
})

test('the workspace lock binds every Vue plugin to the reproducible current-host distribution', async () => {
  const upstream = JSON.parse(await readFile(path.join(source, 'UPSTREAM.json'), 'utf8'))
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  const archive = await readFile(path.join(root, 'vendor/vite-plugin-vue-devtools-9.0.0-rc.3-webops.1.tgz'))
  const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`
  const plugins = Object.entries(lock.packages).filter(([filename]) => filename.endsWith('/vite-plugin-vue-devtools'))
  assert.ok(plugins.length > 0)
  for (const [filename, metadata] of plugins) {
    assert.equal(metadata.version, upstream.patchedVersion, filename)
    assert.equal(metadata.resolved, 'file:vendor/vite-plugin-vue-devtools-9.0.0-rc.3-webops.1.tgz')
    assert.equal(metadata.integrity, integrity)
    assert.equal(metadata.peerDependencies['@vitejs/devtools'], upstream.hostRange)
  }
})

test('the independent original graph retains official version, payload integrity and legacy peer metadata', async () => {
  const upstream = JSON.parse(await readFile(path.join(source, 'UPSTREAM.json'), 'utf8'))
  const lock = JSON.parse(await readFile(path.join(source, 'upstream/package-lock.json'), 'utf8'))
  const original = lock.packages['node_modules/vite-plugin-vue-devtools']
  assert.equal(original.version, upstream.package.version)
  assert.equal(original.integrity, upstream.registryIntegrity)
  assert.deepEqual(original.peerDependencies, upstream.package.peerDependencies)
})
