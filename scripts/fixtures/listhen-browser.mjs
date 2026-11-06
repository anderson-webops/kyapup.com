import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import { access, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const packageDirectory = dirname(require.resolve('listhen'))
const bundledScript = require(join(packageDirectory, 'chunks/xdg-open.cjs')).xdgOpenScript()
const help = childProcess.spawnSync('/bin/sh', [
  '-c',
  bundledScript,
  'xdg-open',
  '--help',
], {
  env: { PATH: '/usr/bin:/bin', HOME: process.env.TMPDIR },
  encoding: 'utf8',
  timeout: 5000,
})
assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /xdg-open/u)
const helperPath = join(process.env.TMPDIR, 'xdg-open')
const helperContents = '#!/bin/sh\nexit 99\n'
await writeFile(helperPath, helperContents, { mode: 0o755 })
Object.defineProperty(process, 'platform', { value: 'linux' })
const launches = []
childProcess.spawn = (command, args, options) => {
  launches.push({ command, args, options })
  const child = new EventEmitter()
  child.unref = () => child
  return child
}

const entrypoint = process.argv[2] === 'commonjs'
  ? require('listhen')
  : await import('listhen')

const listener = await entrypoint.listen((_request, response) => response.end('ok'), {
  hostname: '127.0.0.1',
  port: 0,
  autoClose: false,
  isTest: true,
})
try {
  await listener.open()
  assert.equal(launches.length, 1)
  assert.equal(launches[0].command, '/bin/sh')
  assert.deepEqual(launches[0].args, [
    '-c',
    bundledScript,
    'xdg-open',
    listener.url,
  ])
  assert.equal(launches[0].options.detached, true)
  assert.equal(await readFile(helperPath, 'utf8'), helperContents)
  await access(helperPath)
  process.stdout.write('Trusted browser launcher selected; shared temporary helper left untouched.\n')
}
finally {
  await listener.close()
}
