import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { build } = require('esbuild')

const root = fileURLToPath(new URL('..', import.meta.url))
const source = path.join(root, 'vendor/qs')
const destination = path.join(root, 'back-end/vendor')
const archiveName = 'qs-6.17.2-webops.4.tgz'
const check = process.argv.length === 3 && process.argv[2] === '--check'
assert.ok(process.argv.length === 2 || check, 'Only --check is supported')
assert.ok(process.env.npm_execpath, 'Run through the selected npm executable')

async function readLicense(directory) {
  for (const name of [
    'LICENSE',
    'LICENSE.md',
    'LICENSE.txt',
    'license',
    'license.md',
    'license.txt',
  ]) {
    try {
      return await readFile(path.join(directory, name), 'utf8')
    }
    catch (error) {
      if (error.code !== 'ENOENT')
        throw error
    }
  }
  throw new Error('Every bundled dependency must retain its license')
}

async function packageDirectory(filename) {
  let directory = path.dirname(filename)
  for (;;) {
    try {
      await readFile(path.join(directory, 'package.json'))
      return directory
    }
    catch (error) {
      if (error.code !== 'ENOENT')
        throw error
    }
    const parent = path.dirname(directory)
    assert.notEqual(parent, directory, 'Every bundle input must have package metadata')
    directory = parent
  }
}

async function bundleLicenses(inputs, directory) {
  const packages = new Map()
  for (const filename of Object.keys(inputs)) {
    if (filename.startsWith('(disabled):'))
      continue
    const packageRoot = await packageDirectory(path.resolve(directory, filename))
    const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))
    const identity = `${metadata.name}@${metadata.version}`
    if (!packages.has(identity))
      packages.set(identity, await readLicense(packageRoot))
  }
  return `${[...packages].sort(([left], [right]) => left.localeCompare(right, 'en')).map(([identity, license]) => `${identity}\n${license.trimEnd()}`).join('\n\n')}\n`
}

async function normalizePackageModes(directory) {
  await chmod(directory, 0o755)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await normalizePackageModes(filename)
    }
    else {
      assert.ok(entry.isFile(), 'The packaged library must contain only regular files and directories')
      await chmod(filename, 0o644)
    }
  }
}

const temporary = await mkdtemp(path.join(tmpdir(), 'vitesse-vendored-qs-'))
try {
  const buildRoot = path.join(temporary, 'build')
  await mkdir(buildRoot)
  for (const filename of ['package.json', 'package-lock.json'])
    await cp(path.join(source, filename), path.join(buildRoot, filename))
  const install = spawnSync(process.execPath, [
    process.env.npm_execpath,
    'ci',
    '--ignore-scripts',
    '--workspaces=false',
    '--no-fund',
    '--no-audit',
  ], { encoding: 'utf8', cwd: buildRoot })
  assert.equal(install.status, 0, 'The isolated locked qs build dependencies must install')
  const buildSource = path.join(buildRoot, 'qs')
  await cp(source, buildSource, {
    recursive: true,
    filter: filename => path.basename(filename) !== 'node_modules',
  })
  const bundled = await build({
    absWorkingDir: buildRoot,
    entryPoints: [
      path.join(buildSource, 'lib/index.js'),
    ],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es5',
    minify: true,
    legalComments: 'none',
    metafile: true,
  })
  const wrapper = `(function(factory){if(typeof exports==='object'&&typeof module!=='undefined'){module.exports=factory()}else if(typeof define==='function'&&define.amd){define([],factory)}else{var scope=typeof window!=='undefined'?window:typeof global!=='undefined'?global:typeof self!=='undefined'?self:this;scope.Qs=factory()}})(function(){var module={exports:{}};${bundled.outputFiles[0].text}return module.exports});\n`
  const licenses = await bundleLicenses(bundled.metafile.inputs, buildRoot)
  for (const [relative, contents] of [
    ['dist/qs.js', wrapper],
    ['dist/qs.js.LICENSES.txt', licenses],
  ]) {
    const filename = path.join(source, relative)
    if (check) {
      const current = await readFile(filename, 'utf8')
      assert.ok(current === contents, `${relative} must match reviewed source`)
    }
    else {
      await mkdir(path.dirname(filename), { recursive: true })
      await writeFile(filename, contents)
    }
  }
  const packedSource = path.join(temporary, 'qs')
  await cp(source, packedSource, {
    recursive: true,
    filter: filename => path.basename(filename) !== 'node_modules',
  })
  await normalizePackageModes(packedSource)
  const result = spawnSync(process.execPath, [
    process.env.npm_execpath,
    'pack',
    packedSource,
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    temporary,
  ], { encoding: 'utf8', cwd: root })
  assert.equal(result.status, 0, 'Vendored qs packing must succeed')
  const packages = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(packages), ['qs'])
  const metadata = packages.qs
  assert.equal(metadata.filename, archiveName)
  const archive = await readFile(path.join(temporary, archiveName))
  const filename = path.join(destination, archiveName)
  if (check) {
    assert.ok((await readFile(filename)).equals(archive), 'Vendored qs archive must match reviewed source')
  }
  else {
    await mkdir(destination, { recursive: true })
    await writeFile(filename, archive)
  }
}
finally {
  await rm(temporary, { recursive: true, force: true })
}

console.log(check ? 'Vendored qs distribution and archive verified.' : 'Vendored qs distribution and archive generated.')
