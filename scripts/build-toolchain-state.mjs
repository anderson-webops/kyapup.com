import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const toolchainSource = fileURLToPath(new URL('../build-toolchain/', import.meta.url))
export const toolchainMetadata = JSON.parse(readFileSync(path.join(toolchainSource, 'UPSTREAM.json'), 'utf8'))
const toolchainManifest = JSON.parse(readFileSync(path.join(toolchainSource, 'package.json'), 'utf8'))

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function selectedNpmCli() {
  if (process.env.npm_execpath)
    return realpathSync(process.env.npm_execpath)
  const directory = path.dirname(process.execPath)
  if (process.platform === 'win32')
    return realpathSync(path.join(directory, '../node_modules/npm/bin/npm-cli.js'))
  return realpathSync(path.join(directory, 'npm'))
}

export function verifyBuildToolchain(cli = selectedNpmCli()) {
  assert.equal(process.version, `v${toolchainMetadata.node}`, 'Select the pinned Node before preparing the build toolchain')
  const npmRoot = path.resolve(path.dirname(realpathSync(cli)), '..')
  const prefix = path.resolve(npmRoot, '../..')
  for (const name of [
    'package.json',
    'package-lock.json',
    '.npmrc',
    'UPSTREAM.json',
    toolchainMetadata.archive,
  ]) {
    const installed = path.join(prefix, name)
    const state = lstatSync(installed)
    assert.ok(state.isFile() && !state.isSymbolicLink(), `Toolchain input must be a regular file: ${name}`)
    assert.ok(readFileSync(installed).equals(readFileSync(path.join(toolchainSource, name))), `Toolchain input differs: ${name}`)
  }
  assert.equal(sha256(readFileSync(path.join(prefix, 'package-lock.json'))), toolchainMetadata.lockSha256)
  assert.equal(sha256(readFileSync(path.join(prefix, toolchainMetadata.archive))), toolchainMetadata.archiveSha256)
  for (const entry of toolchainMetadata.files) {
    const relative = entry.path.slice('package/'.length)
    assert.ok(entry.path.startsWith('package/') && !relative.split('/').includes('..'))
    const filename = path.join(npmRoot, relative)
    const state = lstatSync(filename)
    assert.ok(state.isFile() && !state.isSymbolicLink(), `npm CLI file must be regular: ${relative}`)
    assert.equal(sha256(readFileSync(filename)), entry.sha256, `npm CLI file differs: ${relative}`)
  }
  const require = createRequire(path.join(npmRoot, 'package.json'))
  const lock = JSON.parse(readFileSync(path.join(prefix, 'package-lock.json'), 'utf8'))
  const versions = {}
  for (const name of ['npm', 'glob', 'minimatch', 'undici']) {
    const manifest = name === 'npm'
      ? path.join(npmRoot, 'package.json')
      : require.resolve(`${name}/package.json`)
    const actual = JSON.parse(readFileSync(manifest, 'utf8')).version
    const location = path.relative(prefix, path.dirname(manifest)).split(path.sep).join('/')
    assert.equal(actual, lock.packages[location]?.version, `Selected ${name} must match its independent lock`)
    versions[name] = actual
  }
  assert.equal(versions.npm, toolchainMetadata.npm)
  assert.equal(versions.glob, toolchainManifest.overrides.glob)
  assert.equal(versions.minimatch, toolchainManifest.overrides.minimatch)
  assert.ok(require('semver').satisfies(versions.glob, '>=14.0.2'))
  assert.ok(require('semver').satisfies(versions.minimatch, '>=11.0.1'))
  assert.ok(require('semver').satisfies(versions.undici, '^6.29.1 || ^7.30.1 || ^8.12.2'))
  return {
    profile: toolchainMetadata.profile,
    lockSha256: toolchainMetadata.lockSha256,
    node: process.versions.node,
    versions,
  }
}
