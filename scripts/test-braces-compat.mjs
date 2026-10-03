import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import braces from '../vendor/braces/index.js'

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))

test('every locked braces dependency resolves to the guarded fork', () => {
  const entries = Object.entries(lock.packages)
    .filter(([name]) => name.endsWith('node_modules/braces'))

  assert.ok(entries.length > 0)
  for (const [, entry] of entries) {
    assert.equal(entry.resolved, 'vendor/braces')
  }
  assert.equal(lock.packages['vendor/braces'].version, '3.0.4-webops.1')
})

test('ordinary brace patterns keep their compile, expand, and stringify behavior', () => {
  assert.deepEqual(braces('a/{b,c}/d'), ['a/(b|c)/d'])
  assert.deepEqual(braces.expand('a/{b,c}/d'), ['a/b/d', 'a/c/d'])
  assert.deepEqual(braces.expand('item-{1..3}'), ['item-1', 'item-2', 'item-3'])
  assert.equal(braces.stringify('a/{b,c}/d'), 'a/{b,c}/d')
  assert.equal(braces.stringify(String.raw`a/\{b,c\}/d`), 'a/{b,c}/d')
  assert.ok(braces.parse(`${'{'.repeat(256)}x${'}'.repeat(256)}`))
  assert.ok(braces.parse(`${'('.repeat(101)}x${')'.repeat(101)}`))
})

test('deep strings are rejected before recursive walkers exhaust the stack', () => {
  const nestedBraces = `${'{'.repeat(4000)}x${'}'.repeat(4000)}`
  const nestedParentheses = `${'('.repeat(4000)}x${')'.repeat(4000)}`

  for (const input of [nestedBraces, nestedParentheses]) {
    for (const operation of [braces.parse, braces.compile, braces.expand, braces.stringify, braces]) {
      assert.throws(() => operation(input), {
        name: 'SyntaxError',
        message: 'Brace pattern exceeds maximum nesting depth (256)',
      })
    }
  }
})

test('directly supplied ASTs cannot bypass the depth limit', () => {
  for (const operation of [braces.compile, braces.expand, braces.stringify]) {
    const ast = { type: 'root', nodes: [] }
    let current = ast

    for (let depth = 0; depth < 257; depth++) {
      const child = { type: 'brace', nodes: [], parent: current }
      current.nodes.push(child)
      current = child
    }
    current.nodes.push({ type: 'text', value: 'x', parent: current })

    assert.throws(() => operation(ast), {
      name: 'SyntaxError',
      message: 'Brace pattern exceeds maximum nesting depth (256)',
    })
  }
})

test('iterable AST nodes cannot bypass recursive walker guards', () => {
  const ast = { type: 'root', nodes: new Set() }
  let current = ast

  for (let depth = 0; depth < 257; depth++) {
    const child = { type: 'brace', nodes: new Set(), parent: current }
    current.nodes.add(child)
    current = child
  }
  current.nodes.add({ type: 'text', value: 'x', parent: current })

  for (const operation of [braces.compile, braces.stringify]) {
    assert.throws(() => operation(ast), {
      name: 'SyntaxError',
      message: 'Brace pattern exceeds maximum nesting depth (256)',
    })
  }
})
