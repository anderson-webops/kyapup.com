#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const sourceModules = resolve(projectRoot, 'back-end/node_modules')
const originalModules = await stat(sourceModules).catch((error) => {
  if (error.code !== 'ENOENT')
    throw error
  return null
})
const scratchRoot = resolve(projectRoot, '.ai-work/runs')
await mkdir(scratchRoot, { recursive: true })
const fixture = await mkdtemp(resolve(scratchRoot, 'api-install-'))
const backendModules = resolve(fixture, 'node_modules')

try {
  for (const filename of ['package.json', 'package-lock.json'])
    await copyFile(resolve(projectRoot, 'back-end', filename), resolve(fixture, filename))
  await mkdir(resolve(fixture, 'vendor'))
  const metadata = JSON.parse(await readFile(resolve(projectRoot, 'back-end/package.json'), 'utf8'))
  for (const specification of Object.values(metadata.dependencies).filter(value => value.startsWith('file:'))) {
    const relative = specification.slice(5)
    assert.match(relative, /^vendor\/[a-z0-9.-]+\.tgz$/)
    await copyFile(resolve(projectRoot, 'back-end', relative), resolve(fixture, relative))
  }
  const install = spawnSync('npm', [
    'ci',
    '--omit=dev',
    '--workspaces=false',
    '--ignore-scripts',
    '--no-fund',
    '--no-audit',
  ], { cwd: fixture, stdio: 'inherit' })
  if (install.error)
    throw install.error
  assert.equal(install.status, 0, 'Disposable production API installation must succeed')

  for (const packageName of [
    'dotenv',
    'express',
    'express-rate-limit',
    'helmet',
    'qs',
    'cookie',
    'encodeurl',
    'raw-body',
    'type-is',
  ])
    await access(resolve(backendModules, packageName, 'package.json'))

  for (const relative of [
    'package.json',
    'lib/index.js',
    'lib/formats.js',
    'lib/parse.js',
    'lib/stringify.js',
    'lib/utils.js',
  ]) {
    assert.deepEqual(
      await readFile(resolve(backendModules, 'qs', relative)),
      await readFile(resolve(projectRoot, 'vendor/qs', relative)),
      `Production qs ${relative} must match the reviewed library`,
    )
  }

  for (const packageName of [
    'cookie',
    'encodeurl',
    'raw-body',
    'type-is',
  ]) {
    for (const relative of [
      'compat.cjs',
      'compat.d.cts',
      'dist/index.js',
      'UPSTREAM.json',
      'UPSTREAM-PACKAGE.json',
      'LICENSE',
    ])
      await access(resolve(backendModules, packageName, relative))
  }

  for (const packageName of [
    '@types',
    'globals',
    'supertest',
    'tsx',
    'typescript',
    'typescript-native',
    'typescript-eslint',
    'vitest',
  ]) {
    await assert.rejects(access(resolve(backendModules, packageName)), { code: 'ENOENT' }, `${packageName} must be absent from production`)
  }
}
finally {
  await rm(fixture, { recursive: true })
}

if (originalModules) {
  const currentModules = await stat(sourceModules)
  assert.equal(currentModules.dev, originalModules.dev)
  assert.equal(currentModules.ino, originalModules.ino)
}
else {
  await assert.rejects(stat(sourceModules), { code: 'ENOENT' })
}

console.log('Production-only API install contains runtime dependencies and no backend test or build tools.')
