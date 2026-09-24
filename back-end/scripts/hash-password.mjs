#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { randomBytes, scryptSync } from 'node:crypto'

if (process.stdin.isTTY) {
  console.error('Pipe the password to this helper through standard input. Never put it in a command argument.')
  process.exit(1)
}
const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '')
if (password.length < 12 || password.length > 1024) {
  console.error('Use a password between 12 and 1024 characters.')
  process.exit(1)
}
const salt = randomBytes(16)
const key = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
console.log(`scrypt$32768$8$1$${salt.toString('hex')}$${key.toString('hex')}`)
