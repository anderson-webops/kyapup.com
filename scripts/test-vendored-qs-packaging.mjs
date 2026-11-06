import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const tools = path.dirname(path.dirname(require.resolve('esbuild/package.json')))
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const specification = metadata.dependencies?.qs || metadata.devDependencies?.qs
assert.ok(specification?.startsWith('file:'))
const archivePath = specification.slice(5)
assert.ok(!path.isAbsolute(archivePath) && !archivePath.split('/').includes('..'))
assert.ok(process.env.npm_execpath, 'Run through the selected npm executable')

async function privateModes(directory) {
  await chmod(directory, 0o700)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory())
      await privateModes(filename)
    else
      await chmod(filename, 0o600)
  }
}

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'qs-package-regression-'))
  await mkdir(path.join(directory, 'scripts'))
  await mkdir(path.dirname(path.join(directory, archivePath)), { recursive: true })
  await cp(path.join(root, 'vendor/qs'), path.join(directory, 'vendor/qs'), {
    recursive: true,
    filter: filename => path.basename(filename) !== 'node_modules',
  })
  await cp(path.join(root, 'scripts/package-vendored-qs.mjs'), path.join(directory, 'scripts/package-vendored-qs.mjs'))
  await cp(path.join(root, archivePath), path.join(directory, archivePath))
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({
    name: 'qs-package-regression',
    private: true,
    type: 'module',
    scripts: { 'check:qs-package': 'node scripts/package-vendored-qs.mjs --check' },
  }))
  await privateModes(directory)
  return directory
}

function check(directory) {
  const previous = process.umask(0o077)
  try {
    return spawnSync(process.execPath, [
      process.env.npm_execpath,
      'run',
      'check:qs-package',
      '--workspaces=false',
    ], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_PATH: tools,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --max-old-space-size=256`.trim(),
      },
      maxBuffer: 256 * 1024,
      timeout: 90000,
    })
  }
  finally {
    process.umask(previous)
  }
}

test('private checkout modes reproduce the canonical archive without changing source permissions', async () => {
  const directory = await fixture()
  try {
    const before = await readFile(path.join(directory, archivePath))
    const result = check(directory)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Vendored qs distribution and archive verified/)
    assert.equal((await stat(path.join(directory, 'vendor/qs/lib/utils.js'))).mode & 0o777, 0o600)
    assert.ok(before.equals(await readFile(path.join(directory, archivePath))))
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a mismatched archive fails with a bounded diagnostic instead of a binary diff', async () => {
  const directory = await fixture()
  try {
    const archive = await readFile(path.join(directory, archivePath))
    await writeFile(path.join(directory, archivePath), archive.map(value => value ^ 0x55))
    const result = check(directory)
    assert.equal(result.status, 1, result.stderr)
    assert.equal(result.signal, null)
    assert.match(result.stderr, /Vendored qs archive must match reviewed source/)
    assert.doesNotMatch(result.stderr, /FATAL ERROR|heap out of memory/)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
