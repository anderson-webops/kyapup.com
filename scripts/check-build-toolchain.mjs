import process from 'node:process'
import { verifyBuildToolchain } from './build-toolchain-state.mjs'

const receipt = verifyBuildToolchain()
process.stdout.write(`${JSON.stringify(receipt)}\n`)
