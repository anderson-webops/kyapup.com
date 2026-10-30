import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const merge = require('../vendor/deepmerge')

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))

test('every locked deepmerge dependency resolves to the guarded fork', () => {
  const entries = Object.entries(lock.packages)
    .filter(([name]) => name.endsWith('node_modules/deepmerge'))

  assert.ok(entries.length > 0)
  for (const [, entry] of entries) {
    assert.equal(entry.resolved, 'vendor/deepmerge')
  }
  assert.equal(lock.packages['vendor/deepmerge'].version, '4.3.2-webops.1')

  const pluginPath = Object.keys(lock.packages)
    .find(name => name.endsWith('node_modules/@rollup/plugin-node-resolve'))
  assert.ok(pluginPath)
  const pluginRequire = createRequire(resolve(pluginPath, 'package.json'))
  assert.equal(pluginRequire('deepmerge'), merge)
  assert.equal(pluginRequire('deepmerge/dist/cjs.js'), merge)
})

test('own prototype keys never change the returned object prototype', () => {
  const source = JSON.parse('{"__proto__":{"poisoned":true},"safe":{"value":1}}')
  const nullPrototypeTarget = Object.create(null)
  const ownPrototypeTarget = JSON.parse('{"__proto__":{"poisoned":true}}')

  for (const target of [null, nullPrototypeTarget, ownPrototypeTarget]) {
    const result = merge(target, source)
    assert.equal(Object.getPrototypeOf(result), Object.prototype)
    assert.equal(Object.hasOwn(result, '__proto__'), false)
    assert.deepEqual(result.safe, { value: 1 })
    assert.equal({}.poisoned, undefined)
  }
})

test('nested and array merges retain ordinary prototypes', () => {
  const nestedSource = JSON.parse('{"layer":{"__proto__":{"poisoned":true},"safe":1}}')
  const nestedResult = merge({
    layer: { retained: true },
  }, nestedSource)
  assert.equal(Object.getPrototypeOf(nestedResult.layer), Object.prototype)
  assert.deepEqual(nestedResult.layer, { retained: true, safe: 1 })

  const arrayResult = merge([], [
    JSON.parse('{"__proto__":{"poisoned":true},"safe":2}'),
  ])
  assert.equal(Object.getPrototypeOf(arrayResult[0]), Object.prototype)
  assert.deepEqual(arrayResult, [
    { safe: 2 },
  ])
  assert.equal({}.poisoned, undefined)
})

test('ordinary object, array, symbol and custom merges retain behavior', () => {
  const symbol = Symbol('retained')
  const first = {
    settings: { left: true },
    list: [1],
    [symbol]: { first: 1 },
  }
  const second = {
    settings: { right: true },
    list: [2],
    [symbol]: { second: 2 },
  }

  assert.deepEqual(merge(first, second).settings, { left: true, right: true })
  assert.deepEqual(merge(first, second).list, [1, 2])
  assert.deepEqual(merge(first, second)[symbol], { first: 1, second: 2 })
  assert.deepEqual(merge.all([
    { first: 1 },
    { second: 2 },
  ]), { first: 1, second: 2 })
  assert.deepEqual(merge({
    list: [1],
  }, {
    list: [2],
  }, {
    customMerge: key => key === 'list'
      ? (left, right) => right
      : undefined,
  }), {
    list: [2],
  })
  assert.equal(merge(first, second).settings === first.settings, false)
})
