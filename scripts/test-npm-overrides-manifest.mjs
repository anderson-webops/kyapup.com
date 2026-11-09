import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { loadPackage, parseDependencies, writePackage } from 'taze'
import configuration from '../taze.config.mjs'
import { npmOverridesManifest, overrideDependencies } from './npm-overrides-manifest.mjs'

const raw = {
  name: 'synthetic-npm-overrides',
  private: true,
  devDependencies: { vite: '^8.3.6', nitropack: 'file:vendor/nitro.tgz' },
  overrides: {
    'vite': { '.': '$vite', 'esbuild': '^0.28.1' },
    'nitropack@^2': { '.': '$nitropack', 'esbuild': '^0.27.0' },
    '@scope/parent@^3': { '.': '^3.0.0', '@scope/child@^1': '^1.0.0' },
    'simple': 'npm:replacement@^1.0.0',
  },
}

test('all nested occurrences and self selectors retain their real package names', () => {
  const original = parseDependencies(raw, 'overrides', () => true)
  const actual = overrideDependencies(raw, () => true)
  assert.equal(original.filter(dependency => dependency.name === 'esbuild').length, 1)
  assert.equal(actual.length, 7)
  assert.equal(actual.filter(dependency => dependency.name === 'esbuild').length, 2)
  assert.deepEqual(actual.map(dependency => dependency.name), [
    'vite',
    'esbuild',
    'nitropack',
    'esbuild',
    '@scope/parent',
    '@scope/child',
    'simple',
  ])
  assert.equal(actual[0].currentVersion, '^8.3.6')
  assert.equal(actual[2].currentVersion, 'file:vendor/nitro.tgz')
  assert.ok(actual.every(dependency => dependency.update))
})

test('filters apply to real package names and invalid references fail closed', () => {
  assert.equal(overrideDependencies(raw, name => name !== 'esbuild').filter(dependency => !dependency.update).length, 2)
  assert.throws(() => overrideDependencies({
    overrides: { vite: '$missing' },
  }, () => true), /Unresolved npm override reference/)
  assert.throws(() => overrideDependencies({
    overrides: { '.': '^1' },
  }, () => true), /requires a parent/)
  assert.throws(() => overrideDependencies({
    overrides: { vite: null },
  }, () => true), /Invalid npm override/)
  assert.deepEqual(overrideDependencies({}, () => true), [])
})

async function fixture(context) {
  const area = path.resolve(import.meta.dirname, '../.ai-work/runs')
  await mkdir(area, { recursive: true })
  const cwd = await mkdtemp(path.join(area, 'npm-override-manifest-'))
  context.after(() => rm(cwd, { recursive: true, force: true }))
  const filename = path.join(cwd, 'package.json')
  const content = `${JSON.stringify(raw, null, 2)}\n`
  await writeFile(filename, content)
  const options = {
    ...configuration,
    cwd,
    githubActions: false,
    nodeVersion: false,
  }
  const [candidate] = await loadPackage('package.json', options, () => true)
  return {
    filename,
    content,
    options,
    candidate,
  }
}

test('the supported manifest API reads without changing files or disabling ordinary fields', async (context) => {
  const { filename, content, candidate } = await fixture(context)
  assert.equal(await readFile(filename, 'utf8'), content)
  assert.equal(candidate.deps.filter(dependency => dependency.source === 'devDependencies').length, 2)
  assert.equal(candidate.deps.filter(dependency => dependency.source === 'overrides').length, 7)
  assert.equal(configuration.manifests[0], npmOverridesManifest)
})

test('writes retain selectors, references, aliases and distinct nested version ranges', async (context) => {
  const { filename, options, candidate } = await fixture(context)
  candidate.resolved = candidate.deps.map(dependency => ({
    ...dependency,
    update: true,
    targetVersion: dependency.name === 'esbuild'
      ? '^0.28.2'
      : dependency.currentVersion,
  }))
  const alias = candidate.resolved.find(dependency => dependency.npmOverrideKey === 'simple')
  Object.assign(alias, {
    name: 'replacement',
    aliasName: 'simple',
    protocol: 'npm',
    currentVersion: '^1.0.0',
    targetVersion: '^2.0.0',
  })
  await writePackage(candidate, options)
  const written = JSON.parse(await readFile(filename, 'utf8'))
  const expected = structuredClone(raw)
  expected.overrides.vite.esbuild = '^0.28.2'
  expected.overrides['nitropack@^2'].esbuild = '^0.28.2'
  expected.overrides.simple = 'npm:replacement@^2.0.0'
  assert.deepEqual(written, expected)
  const [reloaded] = await loadPackage('package.json', options, () => true)
  assert.equal(reloaded.deps.filter(dependency => dependency.source === 'overrides').length, 7)
})

test('an unresolved dependency prevents writing any candidate updates', async (context) => {
  const { filename, content, options, candidate } = await fixture(context)
  candidate.resolved = candidate.deps.map(dependency => ({ ...dependency, resolveError: 'synthetic metadata failure' }))
  await assert.rejects(writePackage(candidate, options), /metadata failures/)
  assert.equal(await readFile(filename, 'utf8'), content)
})
