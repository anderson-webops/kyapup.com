#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const lockfile = JSON.parse(await readFile(resolve(projectRoot, 'package-lock.json'), 'utf8'))
const npmConfig = await readFile(resolve(projectRoot, '.npmrc'), 'utf8')
const packages = lockfile.packages || {}
const nativeNamePattern = /linux-arm64-(?:gnu|musl)$/

function assert(condition, message) {
  if (!condition)
    throw new Error(message)
}

function nearestBinding(parentKey, packageName, version) {
  const lastNodeModules = parentKey.lastIndexOf('node_modules/')
  const nearestKey = `${parentKey.slice(0, lastNodeModules)}node_modules/${packageName}`
  if (packages[nearestKey]?.version === version)
    return [nearestKey, packages[nearestKey]]

  return Object.entries(packages).find(([key, metadata]) => (
    key.endsWith(`node_modules/${packageName}`) && metadata.version === version
  ))
}

assert(lockfile.lockfileVersion === 3, 'package-lock.json must use lockfile v3')
assert(/^include=optional$/m.test(npmConfig), '.npmrc must include optional dependencies')
assert(/^engine-strict=true$/m.test(npmConfig), '.npmrc must enforce runtime engines')
assert(/^strict-allow-scripts=true$/m.test(npmConfig), '.npmrc must fail on unreviewed dependency scripts')

let verifiedBindings = 0
const resolvedFamilies = new Set()

for (const [parentKey, parent] of Object.entries(packages)) {
  const optionalDependencies = parent.optionalDependencies || {}
  for (const [packageName, version] of Object.entries(optionalDependencies)) {
    if (!nativeNamePattern.test(packageName))
      continue

    const binding = nearestBinding(parentKey, packageName, version)
    assert(binding, `Missing Linux ARM64 lock entry for ${packageName}@${version} required by ${parentKey}`)

    const [bindingKey, metadata] = binding
    const expectedLibc = packageName.endsWith('-musl') ? 'musl' : 'glibc'
    assert(metadata.os?.includes('linux'), `${bindingKey} must target Linux`)
    assert(metadata.cpu?.includes('arm64'), `${bindingKey} must target arm64`)
    assert(metadata.libc?.includes(expectedLibc), `${bindingKey} must target ${expectedLibc}`)
    assert(metadata.optional === true, `${bindingKey} must remain an optional dependency`)
    assert(
      typeof metadata.integrity === 'string' && metadata.integrity.startsWith('sha512-'),
      `${bindingKey} must include registry integrity metadata`,
    )

    if (packageName.startsWith('@oxc-parser/'))
      resolvedFamilies.add('oxc-parser')
    if (packageName.startsWith('@rolldown/'))
      resolvedFamilies.add('rolldown')
    verifiedBindings += 1
  }
}

for (const family of ['oxc-parser', 'rolldown'])
  assert(resolvedFamilies.has(family), `package-lock.json must include Linux ARM64 bindings for ${family}`)

assert(verifiedBindings > 0, 'package-lock.json does not contain Linux ARM64 native optional packages')
console.log(`Native binding lockfile check passed for ${verifiedBindings} Linux ARM64 packages.`)
