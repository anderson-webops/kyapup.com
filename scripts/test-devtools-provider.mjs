import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { assertDevtoolsProviderVersions } from './devtools-provider.mjs'

const require = createRequire(import.meta.url)
const frontendRequire = createRequire(new URL('../front-end/package.json', import.meta.url))

for (const version of ['0.8.0', '0.8.1', '0.8.2']) {
  test(`the reviewed ${version} host and exact kit pair are accepted`, () => {
    assertDevtoolsProviderVersions({ version }, { version })
  })
}

test('a legacy peer is not accepted as the Nuxt-selected host', () => {
  assert.throws(() => assertDevtoolsProviderVersions({ version: '0.7.6' }, { version: '0.7.6' }))
})

test('host and kit patch mismatches are rejected', () => {
  assert.throws(() => assertDevtoolsProviderVersions({ version: '0.8.1' }, { version: '0.8.0' }))
  assert.throws(() => assertDevtoolsProviderVersions({ version: '0.8.2' }, { version: '0.8.1' }))
})

test('unreviewed provider patches and APIs are rejected', () => {
  for (const version of ['0.8.3', '0.9.0', '1.0.0'])
    assert.throws(() => assertDevtoolsProviderVersions({ version }, { version }))
})

test('the actual root and frontend select the same reviewed modern kit', () => {
  const rootMetadata = require('../package.json')
  const frontendMetadata = frontendRequire('./package.json')
  const kit = require('@vitejs/devtools-kit/package.json')
  const providerRequire = createRequire(frontendRequire.resolve('@nuxt/devtools'))
  const provider = providerRequire('@vitejs/devtools/package.json')
  const unheadRequire = createRequire(require.resolve('@unhead/vue'))
  const unheadEntrypoint = unheadRequire.resolve('@unhead/bundler/vite')
  const unheadMetadata = JSON.parse(readFileSync(path.join(path.dirname(unheadEntrypoint), '../package.json'), 'utf8'))
  const unheadKit = createRequire(unheadEntrypoint)('@vitejs/devtools-kit/package.json')
  assert.equal(rootMetadata.devDependencies['@vitejs/devtools-kit'], frontendMetadata.devDependencies['@vitejs/devtools-kit'])
  assert.equal(kit.version, rootMetadata.devDependencies['@vitejs/devtools-kit'])
  assertDevtoolsProviderVersions(provider, kit)
  assertDevtoolsProviderVersions(provider, unheadKit)
  assert.ok(require('semver').satisfies(unheadKit.version, unheadMetadata.peerDependencies['@vitejs/devtools-kit']))
})

test('legacy consumers resolve independent kits within their original declared ranges', () => {
  const semver = require('semver')
  const consumers = [
    {
      metadata: require('vite-plugin-vue-devtools/package.json'),
      require: createRequire(require.resolve('vite-plugin-vue-devtools')),
    },
    {
      metadata: require('@vitejs/devtools/package.json'),
      require: createRequire(require.resolve('@vitejs/devtools')),
    },
  ]
  for (const consumer of consumers) {
    const declared = consumer.metadata.dependencies?.['@vitejs/devtools-kit'] || consumer.metadata.peerDependencies?.['@vitejs/devtools-kit']
    const kit = consumer.require('@vitejs/devtools-kit/package.json')
    assert.ok(semver.satisfies(kit.version, declared), `${consumer.metadata.name} requires ${declared}, resolved ${kit.version}`)
    assert.notEqual(consumer.require.resolve('@vitejs/devtools-kit/package.json'), require.resolve('@vitejs/devtools-kit/package.json'))
  }
})
