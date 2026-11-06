import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const require = createRequire(import.meta.url)
const metadataPath = require.resolve('typescript-native/package.json')
const metadata = require('typescript-native/package.json')
assert.match(metadata.version, /^7\./u)
const entrypoint = path.join(path.dirname(metadataPath), metadata.bin.tsc)
const result = spawnSync(process.execPath, [entrypoint, ...process.argv.slice(2)], { stdio: 'inherit' })
if (result.error)
  throw result.error
if (result.signal)
  throw new Error(`The native compiler terminated with ${result.signal}`)
process.exit(result.status ?? 1)
