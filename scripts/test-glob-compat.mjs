import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = fileURLToPath(new URL('./', import.meta.url))
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const lockPackages = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')).packages
const backendPackageJson = JSON.parse(readFileSync(new URL('../back-end/package.json', import.meta.url), 'utf8'))
const backendLockPackages = JSON.parse(readFileSync(new URL('../back-end/package-lock.json', import.meta.url), 'utf8')).packages
const requireFromNitro = createRequire(new URL('../node_modules/nitropack/package.json', import.meta.url))
const requireFromNft = createRequire(requireFromNitro.resolve('@vercel/nft'))
const requireFromModern = createRequire(requireFromNitro.resolve('archiver'))
const requireFromReaddir = createRequire(requireFromModern.resolve('readdir-glob'))
const { globSync } = (await import(requireFromNft.resolve('glob'))).default
const readdirGlob = (await import(requireFromModern.resolve('readdir-glob'))).default
const { Minimatch, minimatch } = (await import(requireFromReaddir.resolve('minimatch'))).default

test('all locked glob and minimatch packages use reviewed patched majors', () => {
  for (const [path, entry] of Object.entries(lockPackages)) {
    if (path.endsWith('/glob'))
      assert.equal(entry.version, packageJson.overrides.glob)
    if (path.endsWith('/minimatch'))
      assert.equal(entry.version, packageJson.overrides.minimatch)
  }

  assert.equal(backendPackageJson.overrides.minimatch, packageJson.overrides.minimatch)
  for (const [path, entry] of Object.entries(backendLockPackages)) {
    if (path.endsWith('/minimatch'))
      assert.equal(entry.version, backendPackageJson.overrides.minimatch)
  }
})

test('major upgrades preserve direct glob and minimatch matching', () => {
  assert.ok(globSync('*.mjs', { cwd: scriptsDirectory }).includes('test-glob-compat.mjs'))
  assert.equal(minimatch('test-glob-compat.mjs', '*.mjs'), true)
  assert.equal(new Minimatch('*.mjs').match('test-glob-compat.mjs'), true)
  assert.equal(minimatch('test-glob-compat.ts', '*.mjs'), false)
})

test('archiver stream matcher preserves normal file selection', { timeout: 5000 }, async () => {
  const matches = await new Promise((resolve, reject) => {
    const selected = []
    const stream = readdirGlob(scriptsDirectory, { pattern: '*.mjs' })
    stream.on('match', match => selected.push(match.relative))
    stream.on('error', reject)
    stream.on('end', () => resolve(selected))
  })
  assert.ok(matches.includes('test-glob-compat.mjs'))
  assert.ok(!matches.includes('test-glob-compat.ts'))
})
