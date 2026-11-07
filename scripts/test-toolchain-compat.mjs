import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

function npmPackage() {
  const entrypoint = realpathSync(process.env.npm_execpath || path.join(path.dirname(process.execPath), 'npm'))
  return {
    entrypoint,
    require: createRequire(path.resolve(path.dirname(entrypoint), '../package.json')),
  }
}

function codeqlVersion(workflow) {
  const actions = Object.values(workflow.jobs).flatMap(job => job.steps).filter(step => step.uses?.startsWith('github/codeql-action/'))
  assert.ok(actions.length >= 2)
  const versions = actions.map((step) => {
    const version = step.uses.split('@')[1]
    assert.match(version, /^[a-f0-9]{40}$/, 'CodeQL actions require immutable commit pins')
    return version
  })
  assert.equal(new Set(versions).size, 1, 'Every CodeQL action requires the same version')
  return versions[0]
}

test('CodeQL actions share one immutable version and one dependency-update group', () => {
  const yaml = npmPackage().require('yaml')
  const workflow = yaml.parse(readFileSync(path.join(root, '.github/workflows/codeql.yml'), 'utf8'))
  codeqlVersion(workflow)
  const configuration = yaml.parse(readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8'))
  const updates = configuration.updates.find(update => update['package-ecosystem'] === 'github-actions')
  assert.deepEqual(updates.groups['codeql-actions'].patterns, ['github/codeql-action/*'])
})

test('CodeQL version checks reject split versions and floating action references', () => {
  const yaml = npmPackage().require('yaml')
  const workflow = yaml.parse(readFileSync(path.join(root, '.github/workflows/codeql.yml'), 'utf8'))
  const analyze = workflow.jobs.analyze.steps.find(step => step.uses?.startsWith('github/codeql-action/analyze@'))
  const current = codeqlVersion(workflow)
  const different = current === 'a'.repeat(40)
    ? 'b'.repeat(40)
    : 'a'.repeat(40)
  analyze.uses = `github/codeql-action/analyze@${different}`
  assert.throws(() => codeqlVersion(workflow), /same version/)
  analyze.uses = 'github/codeql-action/analyze@v4'
  assert.throws(() => codeqlVersion(workflow), /immutable commit pins/)
})

test('the locked Nuxt provider satisfies its original unimport API floor', () => {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const nuxt = lock.packages['node_modules/nuxt']
  const provider = lock.packages['node_modules/nuxt/node_modules/unimport'] || lock.packages['node_modules/unimport']
  const semver = npmPackage().require('semver')
  assert.ok(semver.satisfies(provider.version, nuxt.dependencies.unimport), `Nuxt requires ${nuxt.dependencies.unimport}, locked ${provider.version}`)
  assert.equal(semver.satisfies('7.0.1', '^7.0.2'), false)
})

test('the installed Nuxt provider preserves the original unimport dependency contract', () => {
  const frontend = createRequire(path.join(root, 'front-end/package.json'))
  const nuxt = createRequire(frontend.resolve('nuxt/package.json'))
  const metadata = nuxt('./package.json')
  const provider = JSON.parse(readFileSync(path.resolve(path.dirname(nuxt.resolve('unimport')), '../package.json'), 'utf8'))
  assert.ok(npmPackage().require('semver').satisfies(provider.version, metadata.dependencies.unimport), `Nuxt requires ${metadata.dependencies.unimport}, resolved ${provider.version}`)
})

test('the selected npm and child commands use the patched build-only toolchain', () => {
  const selected = npmPackage()
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.packageManager, 'npm@12.2.2')
  assert.equal(selected.require('./package.json').version, '12.2.2')
  assert.equal(execFileSync(process.execPath, [selected.entrypoint, '--version'], { encoding: 'utf8', timeout: 10_000 }).trim(), '12.2.2')
  const childCommand = process.platform === 'win32'
    ? 'npm.cmd'
    : 'npm'
  assert.equal(execFileSync(childCommand, ['--version'], { encoding: 'utf8', timeout: 10_000 }).trim(), '12.2.2')
  assert.ok(selected.require('semver').satisfies(selected.require('undici/package.json').version, '^6.29.1 || ^7.30.1 || ^8.12.2'))
})

test('the npm-bundled Agent preserves function-valued TLS validation without a network request', async () => {
  const { Agent } = npmPackage().require('undici')
  const checkServerIdentity = () => new Error('synthetic certificate rejection')
  const captured = new Error('synthetic transport stopped before connection')
  const failures = []
  const agent = new Agent({
    tls: { checkServerIdentity },
    factory(_origin, options) {
      assert.equal(options.tls?.checkServerIdentity, checkServerIdentity)
      throw captured
    },
  })
  try {
    try {
      agent.dispatch({ origin: 'https://registry.invalid', path: '/', method: 'GET' }, {
        onError(error) { failures.push(error) },
      })
    }
    catch (error) {
      failures.push(error)
    }
    assert.deepEqual(failures, [captured])
  }
  finally {
    await agent.close()
  }
})

test('the backend compiler CLI runs TypeScript 7 independently from Vue and ESLint compiler APIs', () => {
  const frontend = createRequire(path.join(root, 'front-end/package.json'))
  const backend = createRequire(path.join(root, 'back-end/package.json'))
  assert.equal(typeof frontend('typescript').createProgram, 'function')
  assert.equal(typeof backend('typescript').createSourceFile, 'function')
  assert.match(backend('typescript-native').version, /^7\./u)
  const version = execFileSync(process.execPath, [
    path.join(root, 'back-end/scripts/run-typescript.mjs'),
    '--version',
  ], { encoding: 'utf8', timeout: 30_000 })
  assert.match(version, /Version 7\./u)
})

test('the actual Node lint plugin reads its supported JS-YAML 5 workspace format', async (context) => {
  const config = createRequire(require.resolve('@antfu/eslint-config'))
  const pluginEntry = config.resolve('eslint-plugin-n')
  const plugin = createRequire(pluginEntry)
  assert.match(plugin('js-yaml/package.json').version, /^5\./u)
  const yaml = plugin('js-yaml')
  assert.throws(() => yaml.load('value: 1\nvalue: 2\n'))
  assert.throws(() => yaml.load('value: !!js/function "function () {}"'))
  const scratchRoot = path.join(root, '.ai-work/runs')
  await mkdir(scratchRoot, { recursive: true })
  const directory = await mkdtemp(path.join(scratchRoot, 'yaml-consumer-'))
  context.after(() => rm(directory, { recursive: true }))
  await writeFile(path.join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - front-end\n  - back-end\n')
  const helper = await import(pathToFileURL(path.join(path.dirname(pluginEntry), 'util/get-pnpm-workspace-yaml.js')))
  assert.deepEqual(helper.getPnpmWorkspacePatterns(directory), ['front-end', 'back-end'])
})
