import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'
import { selectedNpmCli } from './build-toolchain-state.mjs'

test('application and selected npm consumers resolve the maintained Picomatch archive', () => {
  const application = createRequire(import.meta.url)
  const tool = createRequire(selectedNpmCli())
  for (const require of [application, tool]) {
    assert.equal(require('picomatch/package.json').version, '4.0.7-webops.1')
    for (const name of ['tinyglobby', 'fdir']) {
      const consumer = createRequire(require.resolve(`${name}/package.json`))
      assert.equal(consumer.resolve('picomatch'), require.resolve('picomatch'))
    }
  }
})
