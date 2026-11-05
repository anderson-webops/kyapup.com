import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { selectedNpmCli, toolchainMetadata, toolchainSource, verifyBuildToolchain } from './build-toolchain-state.mjs'

const npmCli = selectedNpmCli()
const npmRoot = path.resolve(path.dirname(npmCli), '..')
const profile = path.resolve(npmRoot, '../..')
const consumer = createRequire(path.join(npmRoot, 'package.json'))
const { glob } = consumer('glob')
const { Minimatch, minimatch } = consumer('minimatch')
const root = path.resolve(import.meta.dirname, '..')
const scratch = path.join(root, '.ai-work/runs/toolchain-fixtures')
mkdirSync(scratch, { recursive: true })

test('the stock Node npm seed is compatible only with bootstrap, not application qualification', () => {
  const seedManifest = JSON.parse(readFileSync(path.join(toolchainSource, 'package.json'), 'utf8'))
  const applicationManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const semver = consumer('semver')
  assert.equal(semver.satisfies('11.20.0', seedManifest.engines.npm), true)
  assert.equal(semver.satisfies('11.20.0', applicationManifest.engines.npm), false)
  assert.equal(semver.satisfies(toolchainMetadata.npm, applicationManifest.engines.npm), true)
})

test('the active npm, npx and Node sibling commands retain the reviewed independent profile', () => {
  assert.equal(verifyBuildToolchain().profile, toolchainMetadata.profile)
  const selected = execFileSync('npm', [
    'exec',
    '--offline',
    '--',
    'node',
    '-p',
    'process.env.npm_execpath',
  ], { encoding: 'utf8', timeout: 30_000 }).trim()
  assert.equal(verifyBuildToolchain(selected).lockSha256, toolchainMetadata.lockSha256)
  const npx = execFileSync('npx', [
    '--offline',
    'node',
    '-p',
    'process.env.npm_execpath',
  ], { encoding: 'utf8', timeout: 30_000 }).trim()
  assert.equal(verifyBuildToolchain(npx).lockSha256, toolchainMetadata.lockSha256)
  const sibling = path.join(path.dirname(process.execPath), process.platform === 'win32'
    ? 'npm.cmd'
    : 'npm')
  assert.equal(execFileSync(sibling, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim(), toolchainMetadata.npm)
})

test('changed locks, substituted CLI bytes and symlinked CLI files cannot qualify by version alone', () => {
  const directory = mkdtempSync(path.join(scratch, 'tamper-'))
  try {
    const copiedNpm = path.join(directory, 'node_modules/npm')
    mkdirSync(path.dirname(copiedNpm))
    const victimPath = 'package/bin/node-gyp-bin/node-gyp'
    const victimIndex = toolchainMetadata.files.findIndex(entry => entry.path === victimPath)
    assert.ok(victimIndex >= 0)
    for (const entry of [
      ...toolchainMetadata.files.slice(0, victimIndex + 1),
      { path: 'package/bin/npm-cli.js' },
    ]) {
      const relative = entry.path.slice('package/'.length)
      const destination = path.join(copiedNpm, relative)
      mkdirSync(path.dirname(destination), { recursive: true })
      copyFileSync(path.join(npmRoot, relative), destination)
    }
    mkdirSync(path.join(directory, 'vendor'))
    for (const name of [
      'package.json',
      'package-lock.json',
      '.npmrc',
      'UPSTREAM.json',
      toolchainMetadata.archive,
    ])
      copyFileSync(path.join(profile, name), path.join(directory, name))
    const copiedCli = path.join(copiedNpm, 'bin/npm-cli.js')
    writeFileSync(path.join(directory, 'package-lock.json'), '{}')
    assert.throws(() => verifyBuildToolchain(copiedCli), /input differs/u)
    copyFileSync(path.join(toolchainSource, 'package-lock.json'), path.join(directory, 'package-lock.json'))
    const victim = path.join(copiedNpm, victimPath.slice('package/'.length))
    const original = readFileSync(victim)
    writeFileSync(victim, 'process.exit(0)\n')
    assert.throws(() => verifyBuildToolchain(copiedCli), /CLI file differs/u)
    writeFileSync(victim, original)
    const retained = path.join(directory, 'retained-cli.js')
    copyFileSync(victim, retained)
    rmSync(victim)
    symlinkSync(retained, victim)
    assert.throws(() => verifyBuildToolchain(copiedCli), /must be regular/u)
    assert.ok(readFileSync(retained).length > 0)
  }
  finally {
    rmSync(directory, { recursive: true })
  }
})

test('a clean source-only bootstrap installs the application through its isolated npm without leaking seed flags', { timeout: 300_000 }, () => {
  const directory = mkdtempSync(path.join(scratch, 'bootstrap-'))
  let constructedProfile
  try {
    cpSync(toolchainSource, path.join(directory, 'build-toolchain'), {
      recursive: true,
      filter: filename => !filename.split(path.sep).includes('node_modules'),
    })
    mkdirSync(path.join(directory, 'scripts'))
    for (const name of ['build-toolchain.mjs', 'build-toolchain-state.mjs'])
      cpSync(path.join(root, 'scripts', name), path.join(directory, 'scripts', name))
    const manifest = {
      name: 'webops-bootstrap-fixture',
      version: '1.0.0',
      private: true,
      scripts: { install: 'node observe-install.cjs' },
    }
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest))
    writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      packages: {
        '': { name: manifest.name, version: manifest.version, hasInstallScript: true },
      },
    }))
    writeFileSync(path.join(directory, 'observe-install.cjs'), 'require("node:fs").writeFileSync("observed.json", JSON.stringify({cli:process.env.npm_execpath, cwd:process.cwd(), ignored:process.env.npm_config_ignore_scripts}))\n')
    const output = execFileSync(process.execPath, [
      path.join(directory, 'scripts/build-toolchain.mjs'),
      '--install',
      '--',
      'node',
      '-p',
      'JSON.stringify({cwd:process.cwd(),node:process.execPath})',
    ], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 240_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NPM_CONFIG_CACHE: process.env.NPM_CONFIG_CACHE || path.join(root, '.ai-work/runs/npm-cache') },
    })
    const selected = JSON.parse(output.trim().split('\n').at(-1))
    const observedProfile = path.resolve(path.dirname(selected.node), '..')
    const managedRoot = realpathSync(path.join(process.env.NPM_CONFIG_CACHE || path.join(root, '.ai-work/runs/npm-cache'), '_site-toolchains'))
    assert.equal(path.dirname(observedProfile), managedRoot)
    assert.ok(path.basename(observedProfile).startsWith(`${toolchainMetadata.profile}-`))
    assert.notEqual(observedProfile, profile)
    assert.equal(selected.cwd, directory)
    const observed = JSON.parse(readFileSync(path.join(directory, 'observed.json'), 'utf8'))
    assert.equal(observed.cwd, directory)
    assert.notEqual(observed.ignored, 'true')
    assert.equal(verifyBuildToolchain(observed.cli).profile, toolchainMetadata.profile)
    assert.ok(observed.cli.startsWith(`${observedProfile}${path.sep}`))
    constructedProfile = observedProfile
  }
  finally {
    if (constructedProfile)
      rmSync(constructedProfile, { recursive: true })
    rmSync(directory, { recursive: true })
  }
})

test('Glob cancellation bounds traversal while retaining ordinary file matching', { timeout: 10_000 }, async () => {
  const directory = mkdtempSync(path.join(scratch, 'glob-'))
  try {
    for (let branch = 0; branch < 4; branch += 1) {
      for (let leaf = 0; leaf < 4; leaf += 1) {
        const parent = path.join(directory, String(branch), String(leaf))
        mkdirSync(parent, { recursive: true })
        writeFileSync(path.join(parent, 'fixture.txt'), 'bounded local fixture')
      }
    }
    const filesystem = await import('node:fs')
    const controller = new AbortController()
    const reason = new Error('bounded cancellation fixture')
    let reads = 0
    const measuredFs = {
      readdir(directoryPath, options, callback) {
        reads += 1
        filesystem.readdir(directoryPath, options, (error, entries) => {
          if (!controller.signal.aborted)
            controller.abort(reason)
          callback(error, entries)
        })
      },
    }
    await assert.rejects(glob('**/*', { cwd: directory, fs: measuredFs, signal: controller.signal }), reason)
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(reads, 1)
    assert.equal((await glob('**/*.txt', { cwd: directory })).length, 16)
  }
  finally {
    rmSync(directory, { recursive: true })
  }
})

test('Minimatch bounds globstar-parent amplification and preserves ordinary matching', () => {
  const matcher = new Minimatch(`root/${'**/../alpha/beta/'.repeat(6)}file.txt`, { optimizationLevel: 2, braceExpandMax: 4 })
  assert.ok(matcher.globParts.length <= 4)
  assert.equal(minimatch('safe/item.txt', 'safe/*.txt'), true)
  assert.equal(minimatch('outside/item.txt', 'safe/*.txt'), false)
})

test('the real CLI preserves offline packing, locked installation and executable delivery', { timeout: 60_000 }, () => {
  const directory = mkdtempSync(path.join(scratch, 'cli-'))
  const packageRoot = path.join(directory, 'package')
  const application = path.join(directory, 'consumer')
  const archiveRoot = path.join(directory, 'archives')
  const run = (args, cwd) => execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      NPM_CONFIG_CACHE: path.join(directory, 'cache'),
    },
  })
  try {
    for (const destination of [packageRoot, application, archiveRoot])
      mkdirSync(destination)
    writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
      name: 'webops-toolchain-fixture',
      version: '1.0.0',
      bin: { 'webops-toolchain-fixture': 'cli.cjs' },
      files: ['cli.cjs'],
    }))
    writeFileSync(path.join(packageRoot, 'cli.cjs'), '#!/usr/bin/env node\nprocess.stdout.write("controlled local npm executable\\n")\n')
    writeFileSync(path.join(packageRoot, 'excluded.txt'), 'not part of the package')
    const packed = Object.values(JSON.parse(run([
      'pack',
      '.',
      '--ignore-scripts',
      '--offline',
      '--json',
      '--pack-destination',
      archiveRoot,
    ], packageRoot)))[0]
    assert.ok(packed.files.some(entry => entry.path === 'cli.cjs'))
    assert.ok(!packed.files.some(entry => entry.path === 'excluded.txt'))
    writeFileSync(path.join(application, 'package.json'), JSON.stringify({ name: 'webops-consumer-fixture', version: '1.0.0', private: true }))
    run([
      'install',
      path.join(archiveRoot, packed.filename),
      '--ignore-scripts',
      '--offline',
      '--no-fund',
      '--no-audit',
    ], application)
    run([
      'ci',
      '--ignore-scripts',
      '--offline',
      '--no-fund',
      '--no-audit',
    ], application)
    assert.equal(run([
      'exec',
      '--offline',
      '--',
      'webops-toolchain-fixture',
    ], application).trim(), 'controlled local npm executable')
  }
  finally {
    rmSync(directory, { recursive: true })
  }
})
