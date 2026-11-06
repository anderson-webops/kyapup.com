import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const common = require('../vendor/deepmerge')

const context = vm.createContext({
  module: { exports: {} },
  exports: {},
})
vm.runInContext(await readFile(new URL('../vendor/deepmerge/dist/umd.js', import.meta.url), 'utf8'), context)
const variants = [
  ['commonjs', common, Object.prototype],
  [
    'umd',
    context.module.exports,
    vm.runInContext('Object.prototype', context),
  ],
]

for (const [name, merge, expectedPrototype] of variants) {
  test(`${name}: target and null-prototype source keys cannot poison a returned prototype`, () => {
    const payload = JSON.parse('{"__proto__":{"fixturePollution":true},"ordinary":1}')
    const targetResult = merge(payload, { kept: 2 })
    assert.equal(Object.getPrototypeOf(targetResult), expectedPrototype)
    assert.equal(targetResult.fixturePollution, undefined)
    assert.equal(Object.hasOwn(targetResult, '__proto__'), true)
    const sourceResult = merge(Object.create(null), payload)
    assert.equal(Object.getPrototypeOf(sourceResult), expectedPrototype)
    assert.equal(sourceResult.fixturePollution, undefined)
    assert.equal(Object.prototype.fixturePollution, undefined)
    const combined = merge(JSON.parse('{"__proto__":{"first":1}}'), JSON.parse('{"__proto__":{"second":2}}'))
    assert.equal(Object.getPrototypeOf(combined), expectedPrototype)
    assert.equal(combined.first, undefined)
    assert.equal(combined.second, undefined)
    assert.equal(JSON.stringify(combined), '{"__proto__":{"first":1,"second":2}}')
  })

  test(`${name}: nested, array and all merge paths preserve safe prototypes`, () => {
    const payload = JSON.parse('{"__proto__":{"fixturePollution":true}}')
    const results = [
      merge({ nested: payload }, {}).nested,
      merge([payload], [])[0],
      merge.all([
        Object.create(null),
        payload,
      ]),
      merge(payload, { __proto__: null }),
    ]
    for (const result of results) {
      assert.equal(Object.getPrototypeOf(result), expectedPrototype)
      assert.equal(result.fixturePollution, undefined)
    }
  })

  test(`${name}: ordinary options, arrays, symbols and custom merging remain intact`, () => {
    const symbol = Symbol('fixture')
    const source = {
      items: [2],
      nested: { second: true },
      [symbol]: 3,
    }
    const target = {
      items: [1],
      nested: { first: true },
    }
    const result = merge(target, source)
    assert.equal(JSON.stringify(result), '{"items":[1,2],"nested":{"first":true,"second":true}}')
    assert.equal(result[symbol], 3)
    assert.notEqual(result.items, target.items)
    const shared = { keep: true }
    assert.equal(merge({}, { shared }, { clone: false }).shared, shared)
    assert.equal(JSON.stringify(merge([1], [2], {
      arrayMerge: (_target, incoming) => incoming,
    })), '[2]')
    const custom = merge({
      nested: { first: true },
    }, {
      nested: { second: true },
    }, {
      customMerge: key => key === 'nested'
        ? () => ({ custom: true })
        : undefined,
    })
    assert.equal(JSON.stringify(custom), '{"nested":{"custom":true}}')
    const descriptor = Object.getOwnPropertyDescriptor(merge(JSON.parse('{"__proto__":1}'), {}), '__proto__')
    assert.equal(descriptor.enumerable, true)
    assert.equal(descriptor.configurable, true)
    assert.equal(descriptor.writable, true)
    assert.equal(descriptor.value, 1)
  })
}

test('all locked deepmerge consumers use the reviewed guarded fork', async () => {
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const consumers = Object.entries(lock.packages).filter(([name]) => name.endsWith('node_modules/deepmerge'))
  assert.ok(consumers.length > 0)
  for (const [, entry] of consumers) {
    assert.equal(entry.resolved, 'vendor/deepmerge')
  }
  assert.equal(lock.packages['vendor/deepmerge'].version, '4.3.2-webops.1')
})
