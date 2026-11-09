import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { nodeIdentity, verifyReusableToolchain } from './build-toolchain-cache.mjs'
import { selectedNpmCli } from './build-toolchain-state.mjs'

const argumentsList = process.argv.slice(2)
assert.ok(argumentsList.every(argument => argument === '--omit=dev'), 'Unsupported toolchain audit option')
const cli = selectedNpmCli()
const prefix = path.resolve(path.dirname(cli), '../../..')
verifyReusableToolchain(prefix, nodeIdentity())
for (const directory of [
  prefix,
  path.join(prefix, 'compat'),
]) {
  const result = spawnSync(process.execPath, [
    cli,
    'audit',
    '--prefix',
    directory,
    '--workspaces=false',
    '--audit-level=low',
    ...argumentsList,
  ], {
    stdio: 'inherit',
    timeout: 300_000,
  })
  if (result.error)
    throw result.error
  assert.equal(result.status, 0, 'The selected build toolchain and unmodified upstream libraries must have complete zero-finding audits')
}
