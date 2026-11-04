import assert from 'node:assert/strict'
import test from 'node:test'
import { assertDevtoolsProviderVersions } from './devtools-provider.mjs'

for (const version of ['0.8.0', '0.8.1']) {
  test(`the reviewed ${version} host and exact kit pair are accepted`, () => {
    assertDevtoolsProviderVersions({ version }, { version })
  })
}

test('the frontend legacy peer is not accepted as the Nuxt-selected host', () => {
  assert.throws(() => assertDevtoolsProviderVersions({ version: '0.7.6' }, { version: '0.7.6' }))
})

test('host and kit patch mismatches are rejected', () => {
  assert.throws(() => assertDevtoolsProviderVersions({ version: '0.8.1' }, { version: '0.8.0' }))
})

test('unreviewed provider patches and APIs are rejected', () => {
  for (const version of ['0.8.2', '0.9.0', '1.0.0'])
    assert.throws(() => assertDevtoolsProviderVersions({ version }, { version }))
})
