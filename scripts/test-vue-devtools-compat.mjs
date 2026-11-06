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

test('registry Vue DevTools keeps original metadata and every upstream payload byte', async () => {
  const upstream = JSON.parse(await readFile(path.join(source, 'UPSTREAM.json'), 'utf8'))
  assert.equal(Object.keys(upstream.files).length, 38)
  const installedRoot = path.dirname(require.resolve('vite-plugin-vue-devtools/package.json'))
  const metadata = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'))
  assert.deepEqual(metadata, upstream.package)
  for (const [filename, digest] of Object.entries(upstream.files)) {
    const installed = await readFile(path.join(installedRoot, filename))
    assert.equal(createHash('sha256').update(installed).digest('hex'), digest, filename)
  }
})

test('the complete lock binds every Vue plugin to unmodified registry metadata', async () => {
  const upstream = JSON.parse(await readFile(path.join(source, 'UPSTREAM.json'), 'utf8'))
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  const plugins = Object.entries(lock.packages).filter(([filename]) => filename.endsWith('/vite-plugin-vue-devtools'))
  assert.ok(plugins.length > 0)
  for (const [filename, metadata] of plugins) {
    assert.equal(metadata.version, upstream.package.version, filename)
    assert.equal(metadata.resolved, `https://registry.npmjs.org/vite-plugin-vue-devtools/-/vite-plugin-vue-devtools-${upstream.package.version}.tgz`)
    assert.equal(metadata.integrity, upstream.registryIntegrity)
    assert.equal(metadata.peerDependencies['@vitejs/devtools'], upstream.package.peerDependencies['@vitejs/devtools'])
  }
})
