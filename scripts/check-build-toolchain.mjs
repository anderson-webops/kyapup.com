import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { verifyBuildToolchain } from './build-toolchain-state.mjs'

const receipt = verifyBuildToolchain()
const contract = JSON.parse(readFileSync(new URL('../deploy/runtime-artifact.json', import.meta.url), 'utf8'))
assert.equal(contract.runtime.node, receipt.node)
assert.equal(contract.runtime.npmBuildOnly, receipt.versions.npm)
assert.equal(contract.runtime.npmBuildProfile, receipt.profile)
assert.equal(contract.runtime.npmBuildLockSha256, receipt.lockSha256)
process.stdout.write(`${JSON.stringify(receipt)}\n`)
