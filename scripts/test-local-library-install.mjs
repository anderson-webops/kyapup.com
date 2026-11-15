import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { selectedNpmCli } from './build-toolchain-state.mjs'

const root = path.resolve(import.meta.dirname, '..')

test('cold installation, updates and clean installs preserve archived libraries and the maintained loader', { timeout: 180000 }, async () => {
  const runs = path.join(root, '.ai-work/runs')
  await mkdir(runs, { recursive: true })
  const directory = await mkdtemp(path.join(runs, 'local-library-install-'))
  try {
    const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
    const names = [
      'braces',
      'deepmerge',
      'listhen',
      'jiti',
    ]
    const dependencies = Object.fromEntries(names.map(name => [name, metadata.devDependencies[name]]))
    const overrides = Object.fromEntries(names.map(name => [name, `$${name}`]))
    await mkdir(path.join(directory, 'vendor'))
    for (const reference of Object.values(dependencies)) {
      assert.match(reference, /^file:vendor\/[a-z0-9.-]+\.tgz$/u)
      const relative = reference.slice('file:'.length)
      await copyFile(path.join(root, relative), path.join(directory, relative))
    }
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({
      name: 'isolated-local-library-install-regression',
      private: true,
      dependencies,
      overrides,
    }))
    const commands = ['install', 'update', 'ci']
    for (const command of commands) {
      const networkOptions = []
      if (command !== 'install')
        networkOptions.push('--offline')
      const result = spawnSync(process.execPath, [
        selectedNpmCli(),
        command,
        ...networkOptions,
        '--cache',
        path.join(directory, 'download-cache'),
        '--ignore-scripts',
        '--include=optional',
        '--no-fund',
        '--no-audit',
      ], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, npm_config_workspace: '', npm_config_workspaces: 'false' },
        timeout: 50000,
        maxBuffer: 1024 * 1024,
      })
      assert.equal(result.status, 0, `${command}: ${result.stdout}\n${result.stderr}`)
      const lock = JSON.parse(await readFile(path.join(directory, 'package-lock.json'), 'utf8'))
      assert.ok(Object.keys(lock.packages).every(location => !location.startsWith('vendor/')))
      for (const name of names) {
        const records = Object.entries(lock.packages).filter(([location]) => location.endsWith(`node_modules/${name}`))
        assert.ok(records.length > 0)
        for (const [, entry] of records) {
          assert.equal(entry.resolved, dependencies[name])
          assert.equal(entry.link, undefined)
          assert.match(entry.integrity, /^sha512-/u)
        }
        const installed = JSON.parse(await readFile(path.join(directory, 'node_modules', name, 'package.json'), 'utf8'))
        assert.equal(installed.version, lock.packages[`node_modules/${name}`].version)
      }
      assert.equal(lock.packages['node_modules/jiti'].version, '2.7.0-webops.1')
    }
  }
  finally {
    await rm(directory, { recursive: true })
  }
})
