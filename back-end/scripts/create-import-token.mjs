#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto'

// Run deliberately during operator setup. Store the token only on the importing
// machine, and put only its sha256 value in the server's protected environment.
const token = randomBytes(32).toString('base64url')
const sha256 = createHash('sha256').update(token, 'utf8').digest('hex')
console.log(JSON.stringify({ token, sha256 }, null, 2))
