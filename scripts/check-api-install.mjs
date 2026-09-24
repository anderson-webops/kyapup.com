#!/usr/bin/env node
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const backendModules = resolve(projectRoot, 'back-end/node_modules')

for (const packageName of ['dotenv', 'express', 'express-rate-limit', 'helmet'])
  await access(resolve(backendModules, packageName, 'package.json'))

for (const packageName of ['supertest', 'tsx', 'typescript-eslint', 'vitest']) {
  try {
    await access(resolve(backendModules, packageName, 'package.json'))
    throw new Error(`Production API install unexpectedly contains ${packageName}`)
  }
  catch (error) {
    if (error?.code !== 'ENOENT')
      throw error
  }
}

console.log('Production-only API install contains runtime dependencies and no backend test or build tools.')
