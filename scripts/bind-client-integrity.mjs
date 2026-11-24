import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, gzipSync } from 'node:zlib'

const root = '.output/public'
const hash = (algorithm, bytes) => `${algorithm}-${createHash(algorithm).update(bytes).digest('base64')}`
const bundles = readdirSync(join(root, '_nuxt'), { withFileTypes: true })
  .filter(entry => entry.isFile() && /^[\w-]+\.js$/u.test(entry.name))
  .map(entry => [
    `/_nuxt/${entry.name}`,
    hash('sha384', readFileSync(join(root, '_nuxt', entry.name))),
  ])
assert.ok(bundles.length)
const integrity = Object.fromEntries(bundles)
for (const file of readdirSync(root, { recursive: true }).filter(name => name.endsWith('.html'))) {
  const path = join(root, file)
  const original = readFileSync(path, 'utf8')
  const maps = [
    ...original.matchAll(/<script type="importmap">([^<]+)<\/script>/gu),
  ]
  assert.equal(maps.length, 1, file)
  const previous = maps[0][1]
  const parsed = JSON.parse(previous)
  assert.ok(Object.hasOwn(integrity, parsed.imports['#entry']))
  const updated = JSON.stringify({
    ...parsed,
    integrity: {
      ...parsed.integrity,
      ...integrity,
    },
  })
  const oldHash = `'${hash('sha256', previous)}'`
  const newHash = `'${hash('sha256', updated)}'`
  const policies = [
    ...original.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/gu),
  ]
  assert.equal(policies.length, 1, file)
  const policy = policies[0][1]
  const directives = policy.split(';').map(value => value.trim())
  const scriptIndex = directives.findIndex(value => value.startsWith('script-src '))
  assert.ok(scriptIndex >= 0)
  const tokens = new Set(directives[scriptIndex].split(/\s+/u))
  assert.ok(tokens.has('\'strict-dynamic\'') && tokens.delete(oldHash))
  tokens.add(newHash)
  for (const digest of Object.values(integrity))
    tokens.add(`'${digest}'`)
  directives[scriptIndex] = [...tokens].join(' ')
  const html = original.replace(maps[0][0], () => `<script type="importmap">${updated}</script>`)
    .replace(policies[0][0], () => `<meta http-equiv="Content-Security-Policy" content="${directives.join('; ')}">`)
  writeFileSync(path, html)
  for (const [suffix, compress] of [
    ['.br', brotliCompressSync],
    ['.gz', gzipSync],
  ]) {
    if (existsSync(path + suffix))
      writeFileSync(path + suffix, compress(html))
  }
}
