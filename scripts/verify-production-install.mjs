#!/usr/bin/env node
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const backendModules = path.join(repositoryRoot, 'back-end/node_modules')

for (const packageName of ['dotenv', 'express', 'express-rate-limit', 'helmet'])
  await access(path.join(backendModules, packageName, 'package.json'))

for (const packageName of ['@types', 'supertest', 'tsx', 'typescript-eslint', 'vitest'])
  await assert.rejects(access(path.join(backendModules, packageName)), undefined, `${packageName} must be absent from production`)

for (const removedPath of ['node_modules', 'front-end/node_modules', 'front-end/.nuxt'])
  await assert.rejects(access(path.join(repositoryRoot, removedPath)), undefined, `${removedPath} must be absent from production`)

for (const requiredPath of [
  'back-end/dist/server.js',
  'front-end/.output/public/index.html',
  'front-end/.output/public/release.json',
  '.vitesse-release-prepared.json',
]) {
  await access(path.join(repositoryRoot, requiredPath))
}

const [privateMarker, publicMarker] = await Promise.all([
  readFile(path.join(repositoryRoot, '.vitesse-release-prepared.json'), 'utf8'),
  readFile(path.join(repositoryRoot, 'front-end/.output/public/release.json'), 'utf8'),
])
assert.equal(publicMarker, privateMarker)

console.log('Direct production install contains only the compiled API, static frontend, and backend runtime dependencies')
