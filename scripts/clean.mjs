#!/usr/bin/env node
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const targets = [
  'node_modules',
  'front-end/node_modules',
  'front-end/.nuxt',
  'front-end/.output',
  'back-end/node_modules',
  'back-end/dist',
]

for (const target of targets)
  await rm(resolve(projectRoot, target), { force: true, recursive: true })

console.log('Removed generated dependencies and build output; package-lock.json was preserved.')
