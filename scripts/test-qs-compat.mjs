import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const backendRequire = createRequire(new URL('../back-end/package.json', import.meta.url))
const browser = await readFile(new URL('../vendor/qs/dist/qs.js', import.meta.url), 'utf8')
const variants = [
  {
    name: 'commonjs',
    library: backendRequire('qs'),
    input: text => JSON.parse(text),
    evaluate: expression => vm.runInThisContext(expression),
    prototype: Object.prototype,
  },
]

for (const mode of ['module', 'global', 'amd']) {
  const context = vm.createContext(mode === 'module'
    ? {
        module: { exports: {} },
        exports: {},
      }
    : {})
  if (mode === 'amd') {
    context.define = (_dependencies, factory) => {
      context.result = factory()
    }
    context.define.amd = {}
  }
  vm.runInContext(browser, context)
  variants.push({
    name: `browser-${mode}`,
    library: mode === 'module'
      ? context.module.exports
      : mode === 'amd'
        ? context.result
        : context.Qs,
    input: text => vm.runInContext(`JSON.parse(${JSON.stringify(text)})`, context),
    evaluate: expression => vm.runInContext(expression, context),
    prototype: vm.runInContext('Object.prototype', context),
  })
}

function* largeArrayLimitOptions() {
  for (const arrayLimit of [Infinity, 1e20]) {
    for (const allowSparse of [false, true]) {
      for (const plainObjects of [false, true]) {
        for (const throwOnLimitExceeded of [false, true]) {
          yield {
            arrayLimit,
            allowSparse,
            plainObjects,
            throwOnLimitExceeded,
          }
        }
      }
    }
  }
}

for (const { name, library, input, evaluate, prototype } of variants) {
  test(`${name}: large configured array limits preserve non-array indexes`, () => {
    for (const options of largeArrayLimitOptions()) {
      for (const index of ['4294967295', '9007199254740992']) {
        const next = String(BigInt(index) + 1n)
        for (const [query, expected] of [
          [
            `a=first&a[${index}]=second`,
            { 0: 'first', [next]: 'second' },
          ],
          [
            `a[${index}]=first&a=second`,
            { [index]: 'first', [next]: 'second' },
          ],
        ]) {
          const result = library.parse(query, options).a
          assert.equal(Array.isArray(result), false)
          assert.deepEqual(Object.entries(result), Object.entries(expected))
          assert.equal(Object.getPrototypeOf(result), options.plainObjects ? null : prototype)
        }
      }
      assert.equal(JSON.stringify(library.parse('a[0]=first&a[1]=second', options)), '{"a":["first","second"]}')
    }
    assert.throws(() => library.parse('a[4294967295]=blocked', {
      arrayLimit: 20,
      throwOnLimitExceeded: true,
    }), { name: 'RangeError' })
  })

  test(`${name}: overflow indexes retain precision and every original value`, () => {
    const cases = [
      [
        'a[9007199254740992]=first&a=second',
        {
          '9007199254740992': 'first',
          '9007199254740993': 'second',
        },
      ],
      [
        'a=first&a[9007199254740992]=second',
        {
          '0': 'first',
          '9007199254740993': 'second',
        },
      ],
      [
        'a[9007199254740992]=first&a[9007199254740993]=second&a=third',
        {
          '9007199254740992': 'first',
          '9007199254740993': 'second',
          '9007199254740994': 'third',
        },
      ],
      [
        'a[999999999999999999999999999999]=first&a[21]=second&a=third',
        {
          '21': 'second',
          '999999999999999999999999999999': 'first',
          '1000000000000000000000000000000': 'third',
        },
      ],
    ]
    for (const plainObjects of [false, true]) {
      for (const strictMerge of [false, true]) {
        for (const [query, expected] of cases) {
          const result = library.parse(query, { plainObjects, strictMerge }).a
          assert.deepEqual(Object.entries(result), Object.entries(expected))
          assert.equal(Object.getPrototypeOf(result), plainObjects ? null : prototype)
        }
      }
    }
  })

  test(`${name}: overflow appends preserve numeric own keys and prototypes`, () => {
    for (const plainObjects of [false, true]) {
      const options = {
        arrayLimit: 1,
        plainObjects,
        allowDots: true,
        allowPrototypes: true,
      }
      const ordinary = library.parse('values=first&values=second&values=__proto__&values=constructor', options)
      assert.equal(Array.isArray(ordinary.values), false)
      assert.deepEqual(Object.keys(ordinary.values), ['0', '1', '2', '3'])
      assert.deepEqual(Object.values(ordinary.values), [
        'first',
        'second',
        '__proto__',
        'constructor',
      ])
      assert.equal(Object.getPrototypeOf(ordinary.values), plainObjects ? null : prototype)
      for (const query of [
        'values=first&values=second&values=third&values[__proto__][qsOverflowInjected]=yes',
        'values=first&values=second&values=third&values[%5F%5Fproto%5F%5F][qsOverflowInjected]=yes',
        'values=first&values=second&values=third&values.__proto__.qsOverflowInjected=yes',
      ]) {
        const result = library.parse(query, options)
        assert.deepEqual(Object.keys(result.values), ['0', '1', '2'])
        assert.deepEqual(Object.values(result.values), ['first', 'second', 'third'])
        assert.equal(Object.getPrototypeOf(result.values), plainObjects ? null : prototype)
        assert.equal(prototype.qsOverflowInjected, undefined)
      }
    }
  })

  test(`${name}: zero-depth parsing guards the bracket-normalized prototype key`, () => {
    for (const depth of [0, false]) {
      for (const query of ['[toString]=blocked', '%5BhasOwnProperty%5D=blocked', '.toString=blocked']) {
        assert.deepEqual(Object.keys(library.parse(query, { depth, allowDots: true })), [])
      }
    }
    assert.equal(library.parse('[toString]=kept', { depth: 0, allowPrototypes: true }).toString, 'kept')
    assert.equal(library.parse('[[toString]]=kept', { depth: 0 })['[toString]'], 'kept')
    const plain = library.parse('[toString]=kept', { depth: 0, plainObjects: true })
    assert.equal(Object.getPrototypeOf(plain), null)
    assert.equal(plain.toString, 'kept')
  })

  test(`${name}: non-array bracket parsing preserves null object prototypes`, () => {
    const parsed = library.parse('items[]=kept&items[hasOwnProperty]=owned', { parseArrays: false, plainObjects: true })
    assert.equal(Object.getPrototypeOf(parsed), null)
    assert.equal(Object.getPrototypeOf(parsed.items), null)
    assert.equal(parsed.items[0], 'kept')
    assert.equal(parsed.items.hasOwnProperty, 'owned')
  })

  test(`${name}: numeric entities preserve supplementary Unicode characters`, () => {
    for (const [entity, expected] of [
      ['65535', '\uFFFF'],
      ['65536', '\uD800\uDC00'],
      ['128512', '\uD83D\uDE00'],
      ['1114111', '\uDBFF\uDFFF'],
    ]) {
      const parsed = library.parse(`value=%26%23${entity}%3B`, { charset: 'iso-8859-1', interpretNumericEntities: true })
      assert.equal(parsed.value, expected)
    }
  })

  test(`${name}: array limits count sparse values rather than empty slots`, () => {
    const parsed = library.parse('items[19]=first&items=second', { throwOnLimitExceeded: true })
    assert.equal(JSON.stringify(parsed), '{"items":["first","second"]}')
    const mixed = library.parse('items[]=new&items[19]=old&items[0]=zero', { throwOnLimitExceeded: true })
    assert.equal(JSON.stringify(mixed), '{"items":["new","old","zero"]}')
    assert.throws(() => library.parse('items[1]=one&items[]=two&items[]=three', { arrayLimit: 2, throwOnLimitExceeded: true }), /Array limit exceeded/)
  })

  test(`${name}: nested object copies retain safe prototypes and caller data`, () => {
    const original = input('{"filter":{"__proto__":{"injected":true},"label":"kept"},"items":[{"__proto__":{"injected":true},"label":"item"}]}')
    const before = JSON.stringify(original)
    const parsed = library.parse(original)
    for (const item of [parsed.filter, parsed.items[0]]) {
      assert.equal(Object.getPrototypeOf(item), prototype)
      assert.equal(item.injected, undefined)
    }
    assert.equal(parsed.filter.label, 'kept')
    assert.equal(parsed.items[0].label, 'item')
    assert.equal(JSON.stringify(original), before)
    assert.equal(Object.prototype.injected, undefined)
  })

  test(`${name}: native comma-array coercion is safe across realms`, () => {
    for (const encodeValuesOnly of [false, true]) {
      for (const value of ['blocked', 1, null, false, {}]) {
        const serialized = JSON.stringify({
          items: [
            [
              { toString: value },
            ],
          ],
        })
        const inputs = [
          input(serialized),
          vm.runInNewContext(`JSON.parse(${JSON.stringify(serialized)})`),
        ]
        for (const record of inputs)
          assert.doesNotThrow(() => library.stringify(record, { arrayFormat: 'comma', encodeValuesOnly }))
      }
    }
  })

  test(`${name}: custom conversion and join functions retain their receiver and call count`, () => {
    for (const property of ['toString', 'join']) {
      const nested = input('[1,2]')
      let calls = 0
      nested[property] = function () {
        calls += 1
        assert.equal(this, nested)
        return 'custom'
      }
      assert.equal(library.stringify({
        items: [nested],
      }, { arrayFormat: 'comma' }), 'items=custom')
      assert.equal(calls, 1)
    }
    const nested = input('[1,2]')
    nested.toString = Object.prototype.toString
    assert.equal(library.stringify({
      items: [nested],
    }, { arrayFormat: 'comma' }), 'items=%5Bobject%20Array%5D')
  })

  test(`${name}: comma coercion observes each index getter only once`, () => {
    for (const construct of [
      evaluate,
      expression => vm.runInNewContext(expression),
    ]) {
      for (const options of [
        { encodeValuesOnly: false },
        { encodeValuesOnly: true },
        { encode: false },
      ]) {
        for (const changing of [false, true]) {
          const nested = construct(`(() => {
            let reads = 0;
            return Object.defineProperty([], 0, {
              get() { return ++reads === 1 || !${changing} ? reads : { toString: 'blocked' }; }
            });
          })()`)
          assert.equal(library.stringify({
            items: [nested],
          }, { arrayFormat: 'comma', ...options }), 'items=1')
        }
        const prefix = construct(`(() => {
          let reads = 0;
          const value = [0, { toString: 'blocked' }];
          return Object.defineProperty(value, 0, { get() { return ++reads; } });
        })()`)
        const query = library.stringify({
          items: [prefix],
        }, { arrayFormat: 'comma', ...options })
        assert.equal(decodeURIComponent(query), 'items=1,[object Object]')
      }
    }
  })

  test(`${name}: delegated default encoding observes each array index once`, () => {
    for (const construct of [
      evaluate,
      expression => vm.runInNewContext(expression),
    ]) {
      const nested = construct(`(() => {
        let reads = 0;
        return Object.defineProperty([], 0, { get() { return ++reads; } });
      })()`)
      const query = library.stringify({ items: 'delegated' }, {
        encoder(value, defaultEncoder, charset, kind, format) {
          return defaultEncoder(kind === 'value'
            ? nested
            : value, defaultEncoder, charset, kind, format)
        },
      })
      assert.equal(query, 'items=1')
    }
  })

  test(`${name}: element conversion precedes the next index read`, () => {
    for (const construct of [
      evaluate,
      expression => vm.runInNewContext(expression),
    ]) {
      for (const encodeValuesOnly of [false, true]) {
        const nested = construct(`(() => {
          const value = [{ toString() { value[1] = 'changed'; return 'first'; } }, { toString: 'blocked' }];
          return value;
        })()`)
        assert.equal(decodeURIComponent(library.stringify({
          items: [nested],
        }, { arrayFormat: 'comma', encodeValuesOnly })), 'items=first,changed')
      }
    }
  })

  test(`${name}: native array length is captured before index getters or conversion`, () => {
    const cases = [
      { expression: `(() => { const value = [0, 'tail', 'last']; Object.defineProperty(value, 0, { get() { value.length = 1; return 'first'; } }); return value; })()`, expected: 'first,,' },
      { expression: `(() => { const value = [0]; Object.defineProperty(value, 0, { get() { value.push('tail'); return 'first'; } }); return value; })()`, expected: 'first' },
      { expression: `(() => { const value = [{ toString() { value.length = 1; return 'first'; } }, { toString: 'blocked' }, 'last']; return value; })()`, expected: 'first,,' },
      { expression: `(() => { const value = [{ toString() { value.push('tail'); return 'first'; } }, { toString: 'blocked' }]; return value; })()`, expected: 'first,[object Object]' },
      { expression: `new Proxy(['first', 'tail'], { get(target, key, receiver) { return key === 'length' ? 1.9 : Reflect.get(target, key, receiver); } })`, expected: 'first' },
    ]
    for (const construct of [
      evaluate,
      expression => vm.runInNewContext(expression),
    ]) {
      for (const encodeValuesOnly of [false, true]) {
        for (const { expression, expected } of cases) {
          const nested = construct(expression)
          assert.equal(decodeURIComponent(library.stringify({
            items: [nested],
          }, { arrayFormat: 'comma', encodeValuesOnly })), `items=${expected}`)
        }
      }
    }
  })

  test(`${name}: sparse indices, cycles and repeated aliases retain join semantics`, () => {
    const cases = [
      { expression: `(() => { const value = ['first', , null, undefined, 'last']; const parent = Object.create(Array.prototype); parent[1] = 'inherited'; Object.setPrototypeOf(value, parent); return [value]; })()`, expected: 'first,inherited,,,last' },
      { expression: `(() => { const value = ['first']; value.push(value, 'last'); return [value]; })()`, expected: 'first,,last' },
      { expression: `(() => { const first = ['first']; const second = ['second', first]; first.push(second, 'last'); return [first]; })()`, expected: 'first,second,,last' },
      { expression: `(() => { let reads = 0; const value = Object.defineProperty([], 0, { get() { return ++reads; } }); return [value, value]; })()`, expected: '1,2' },
    ]
    for (const construct of [
      evaluate,
      expression => vm.runInNewContext(expression),
    ]) {
      for (const encodeValuesOnly of [false, true]) {
        for (const { expression, expected } of cases) {
          assert.equal(decodeURIComponent(library.stringify({
            items: construct(expression),
          }, { arrayFormat: 'comma', encodeValuesOnly })), `items=${expected}`)
        }
      }
    }
  })

  test(`${name}: conversion hints, Symbols and original exception identities remain intact`, () => {
    for (const encodeValuesOnly of [false, true]) {
      for (const expression of ['[Symbol("nested")]', '[{ [Symbol.toPrimitive]() { return Symbol("nested"); } }]']) {
        assert.throws(() => library.stringify({
          items: [
            evaluate(expression),
          ],
        }, { arrayFormat: 'comma', encodeValuesOnly }), { name: 'TypeError' })
      }
      let calls = 0
      const nested = [
        {
          [Symbol.toPrimitive](hint) {
            calls += 1
            assert.equal(hint, 'string')
            assert.equal(this, nested[0])
            return 'custom'
          },
        },
      ]
      assert.equal(library.stringify({
        items: [nested],
      }, { arrayFormat: 'comma', encodeValuesOnly }), 'items=custom')
      assert.equal(calls, 1)
      const sentinel = new Error('intentional conversion failure')
      for (const value of [
        [
          {
            toString() { throw sentinel },
          },
        ],
        Object.defineProperty([], 0, {
          get() { throw sentinel },
        }),
      ]) {
        assert.throws(() => library.stringify({
          items: [value],
        }, { arrayFormat: 'comma', encodeValuesOnly }), error => error === sentinel)
      }
    }
  })

  test(`${name}: reentrant native joins retain cycle suppression and a single indexed read`, () => {
    for (const construct of [
      evaluate,
      expression => vm.runInNewContext(expression),
    ]) {
      for (const encodeValuesOnly of [false, true]) {
        for (const blockSecondRead of [false, true]) {
          const expression = `(() => {
            let reads = 0;
            const value = ['', 'tail'];
            Object.defineProperty(value, 0, {
              get() {
                reads += 1;
                return ${blockSecondRead} && reads > 1
                  ? { toString: 'blocked' }
                  : { toString() { return value.join(','); } };
              }
            });
            return value;
          })()`
          const nested = construct(expression)
          const query = library.stringify({
            items: [nested],
          }, { arrayFormat: 'comma', encodeValuesOnly })
          assert.equal(decodeURIComponent(query), 'items=,tail')
          const delegated = construct(expression)
          const encoded = library.stringify({ items: 'delegated' }, {
            encoder(value, defaultEncoder, charset, kind, format) {
              return defaultEncoder(kind === 'value'
                ? delegated
                : value, defaultEncoder, charset, kind, format)
            },
          })
          assert.equal(decodeURIComponent(encoded), 'items=,tail')
        }
      }
    }
  })

  test(`${name}: ordinary parsing, formats and limits remain intact`, () => {
    assert.equal(JSON.stringify(library.parse('tag=one&tag=two')), '{"tag":["one","two"]}')
    assert.equal(JSON.stringify(library.parse('filter[0]=one&filter[1]=two')), '{"filter":["one","two"]}')
    assert.equal(JSON.stringify(library.parse('filter.name=one', { allowDots: true })), '{"filter":{"name":"one"}}')
    assert.equal(library.stringify({
      items: ['one', 'two'],
    }, { arrayFormat: 'comma' }), 'items=one%2Ctwo')
    assert.equal(library.stringify({ text: 'one two' }, { format: 'RFC1738' }), 'text=one+two')
    assert.equal(library.stringify({ text: 'one two' }), 'text=one%20two')
    assert.throws(() => library.parse('one=1&two=2', {
      parameterLimit: 1,
      throwOnLimitExceeded: true,
    }), { name: 'RangeError' })
  })
}

for (const entrypoint of ['qs/lib/utils', '../vendor/qs/lib/utils']) {
  const utilities = backendRequire(entrypoint)
  test(`${entrypoint}: overflow merge, combine and shift keep exact numeric keys`, () => {
    for (const plainObjects of [false, true]) {
      for (const index of [
        '0',
        '4294967294',
        '9007199254740991',
        '9007199254740992',
        '9007199254740993',
        '999999999999999999999999999999',
      ]) {
        const next = String(BigInt(index) + 1n)
        const last = String(BigInt(index) + 3n)
        const original = { [index]: 'first' }
        if (plainObjects)
          Object.setPrototypeOf(original, null)
        utilities.markOverflow(original, index)
        utilities.combine(original, ['second', 'third'], 1, plainObjects, false)
        const appended = utilities.merge(original, 'fourth', { plainObjects })
        assert.equal(appended[index], 'first')
        assert.equal(appended[next], 'second')
        assert.equal(appended[last], 'fourth')
        assert.equal(Object.keys(appended).length, 4)
        assert.equal(Object.getPrototypeOf(appended), plainObjects ? null : Object.prototype)

        const mixed = JSON.parse(`{"${index}":"indexed","label":"named","01":"leading-zero","__proto__":{"injected":true}}`)
        utilities.markOverflow(mixed, index)
        const shifted = utilities.merge('prefix', mixed, { plainObjects })
        assert.equal(shifted[0], 'prefix')
        assert.equal(shifted[next], 'indexed')
        assert.equal(shifted.label, 'named')
        assert.equal(shifted['01'], 'leading-zero')
        assert.equal(Object.hasOwn(shifted, '__proto__'), true)
        assert.equal(shifted.injected, undefined)
        assert.equal(Object.getPrototypeOf(shifted), plainObjects ? null : Object.prototype)
      }
      const empty = utilities.markOverflow(plainObjects
        ? Object.create(null)
        : {}, -1)
      assert.equal(utilities.combine(empty, 'first', 0, plainObjects, false)[0], 'first')
    }
  })

  test(`${entrypoint}: strict conflict appends preserve indexes and limit errors`, () => {
    for (const plainObjects of [false, true]) {
      const options = { strictMerge: true, plainObjects, arrayLimit: Infinity }
      let conflict = utilities.merge({ label: 'first' }, 'second', options)
      conflict = utilities.merge(conflict, { 9007199254740992: 'third' }, options)
      conflict = utilities.merge(conflict, 'fourth', options)
      assert.equal(conflict[0].label, 'first')
      assert.equal(conflict[1], 'second')
      assert.equal(conflict['9007199254740992'], 'third')
      assert.equal(conflict['9007199254740993'], 'fourth')
      assert.throws(() => utilities.merge(conflict, 'fifth', {
        ...options,
        arrayLimit: 20,
        throwOnLimitExceeded: true,
      }), { name: 'RangeError' })
      assert.equal(Object.keys(conflict).length, 4)
      const overflow = utilities.markOverflow({}, 1)
      assert.throws(() => utilities.combine(overflow, 'blocked', 1, plainObjects, true), { name: 'RangeError' })
      assert.equal(Object.keys(overflow).length, 0)
    }
  })
}

test('browser coercion retains single index observations without Symbol support', () => {
  const context = vm.createContext({ Symbol: undefined })
  vm.runInContext(browser, context)
  const nested = vm.runInContext(`(() => {
    let reads = 0;
    return Object.defineProperty([], 0, {
      get() { return ++reads === 1 ? 1 : { toString: 'blocked' }; }
    });
  })()`, context)
  assert.equal(context.Qs.stringify({
    items: [nested],
  }, { arrayFormat: 'comma' }), 'items=1')
})

test('the installed qs runtime is byte-bound to the reviewed source', async () => {
  for (const relative of [
    'package.json',
    'LICENSE.md',
    'lib/index.js',
    'lib/formats.js',
    'lib/parse.js',
    'lib/stringify.js',
    'lib/utils.js',
    'dist/qs.js',
    'dist/qs.js.LICENSES.txt',
  ]) {
    const installed = backendRequire.resolve(`qs/${relative}`)
    assert.ok((await readFile(installed)).equals(await readFile(new URL(`../vendor/qs/${relative}`, import.meta.url))), `${relative} must match the reviewed source`)
  }
})
