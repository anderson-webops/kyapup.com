import assert from 'node:assert/strict'

export function assertDevtoolsProviderVersions(provider, kit) {
  assert.ok(['0.8.0', '0.8.1'].includes(provider.version), 'Use a reviewed Nuxt-selected Vite DevTools 0.8 provider')
  assert.equal(kit.version, provider.version, 'The Nuxt-selected host and kit must have identical reviewed versions')
}
