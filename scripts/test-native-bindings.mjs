import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveOptionalBinding } from './lockfile-native-bindings.mjs'

const name = '@typescript/typescript-linux-arm64'

test('invalid absolute and traversing dependency paths fail closed', () => {
  for (const parent of ['/outside/package', '../other/package'])
    assert.throws(() => resolveOptionalBinding({}, parent, name), /relative lockfile paths/u)
})

test('native compiler dependencies resolve beneath a nested package alias', () => {
  const packagePath = `back-end/node_modules/typescript-native/node_modules/${name}`
  const packages = {
    [packagePath]: { version: '7.0.2' },
  }
  assert.equal(resolveOptionalBinding(packages, 'back-end/node_modules/typescript-native', name)?.packagePath, packagePath)
})

test('hoisted workspace and repository bindings retain normal Node lookup', () => {
  for (const packagePath of [`back-end/node_modules/${name}`, `node_modules/${name}`]) {
    const packages = {
      [packagePath]: { version: '7.0.2' },
    }
    assert.equal(resolveOptionalBinding(packages, 'back-end/node_modules/typescript-native', name)?.packagePath, packagePath)
  }
})

test('a binding in an unrelated workspace cannot satisfy a missing dependency', () => {
  const packages = {
    [`front-end/node_modules/${name}`]: { version: '7.0.2' },
  }
  assert.equal(resolveOptionalBinding(packages, 'back-end/node_modules/typescript-native', name), undefined)
})

test('a shadowing incompatible binding cannot be skipped for a matching distant version', () => {
  const nested = `back-end/node_modules/typescript-native/node_modules/${name}`
  const packages = {
    [nested]: { version: '6.0.3' },
    [`node_modules/${name}`]: { version: '7.0.2' },
  }
  const binding = resolveOptionalBinding(packages, 'back-end/node_modules/typescript-native', name)
  assert.equal(binding.packagePath, nested)
  assert.equal(binding.packageRecord.version, '6.0.3')
})

test('scoped parents and root declarations resolve without searching unrelated paths', () => {
  const packagePath = `node_modules/${name}`
  const packages = {
    [packagePath]: { version: '7.0.2' },
  }
  assert.equal(resolveOptionalBinding(packages, 'node_modules/@scope/compiler', name)?.packagePath, packagePath)
  assert.equal(resolveOptionalBinding(packages, '', name)?.packagePath, packagePath)
})
