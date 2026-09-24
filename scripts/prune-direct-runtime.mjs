#!/usr/bin/env node
import { rm } from 'node:fs/promises'

const generatedPaths = [
  '../node_modules',
  '../front-end/node_modules',
  '../front-end/.nuxt',
  '../.netlify',
]

for (const relativePath of generatedPaths)
  await rm(new URL(relativePath, import.meta.url), { force: true, recursive: true })

console.log('Removed build-time dependency trees and transient framework output from the direct runtime')
