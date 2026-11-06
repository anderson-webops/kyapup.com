import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolveOptionalBinding } from './lockfile-native-bindings.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lockfile = JSON.parse(readFileSync(resolve(repoRoot, 'package-lock.json'), 'utf8'))
const packages = lockfile.packages || {}
const npmConfig = readFileSync(resolve(repoRoot, '.npmrc'), 'utf8')
if (lockfile.lockfileVersion !== 3)
  throw new Error('package-lock.json must use lockfile v3')
for (const requirement of ['include=optional', 'engine-strict=true', 'strict-allow-scripts=true']) {
  if (!npmConfig.split(/\r?\n/u).includes(requirement))
    throw new Error(`.npmrc must retain ${requirement}`)
}
const requiredBindingNames = [
  '@typescript/typescript-linux-arm64',
  '@esbuild/linux-arm64',
  '@oxc-parser/binding-linux-arm64-gnu',
  '@oxc-parser/binding-linux-arm64-musl',
  '@oxfmt/binding-linux-arm64-gnu',
  '@oxfmt/binding-linux-arm64-musl',
  '@rolldown/binding-linux-arm64-gnu',
  '@rolldown/binding-linux-arm64-musl',
  '@rollup/rollup-linux-arm64-gnu',
  '@rollup/rollup-linux-arm64-musl',
  '@unrs/resolver-binding-linux-arm64-gnu',
  '@unrs/resolver-binding-linux-arm64-musl',
  'lightningcss-linux-arm64-gnu',
  'lightningcss-linux-arm64-musl',
]

const expectedBindings = Object.entries(packages).flatMap(([packagePath, packageRecord]) => {
  const optionalDependencies = packageRecord.optionalDependencies || {}
  return Object.entries(optionalDependencies)
    .filter(([dependencyName]) => dependencyName.includes('linux-arm64'))
    .map(([dependencyName, declaredVersion]) => ({
      declaredVersion,
      dependencyName,
      packagePath: resolveOptionalBinding(packages, packagePath, dependencyName)?.packagePath
        || `${packagePath}/node_modules/${dependencyName}`,
      parentPath: packagePath,
    }))
})

if (!expectedBindings.length)
  throw new Error('No Linux ARM64 native optional dependencies were discovered in package-lock.json')

const discoveredBindingNames = new Set(expectedBindings.map(binding => binding.dependencyName))
for (const dependencyName of requiredBindingNames) {
  if (!discoveredBindingNames.has(dependencyName))
    throw new Error(`Required Linux ARM64 binding family is no longer declared: ${dependencyName}`)
}

for (const expected of expectedBindings) {
  if (expected.dependencyName === '@typescript/typescript-linux-arm64'
    && expected.declaredVersion !== packages[expected.parentPath].version) {
    throw new Error('The native compiler must pin its matching Linux ARM64 executable')
  }
  const packageRecord = packages[expected.packagePath]
  if (!packageRecord)
    throw new Error(`Missing ${expected.packagePath}, required by ${expected.parentPath}`)
  if (packageRecord.optional !== true)
    throw new Error(`${expected.packagePath} must remain optional`)
  if (!packageRecord.cpu?.includes('arm64'))
    throw new Error(`${expected.packagePath} must target arm64`)
  if (!packageRecord.os?.includes('linux'))
    throw new Error(`${expected.packagePath} must target Linux`)
  if (!packageRecord.integrity?.startsWith('sha512-'))
    throw new Error(`${expected.packagePath} must retain registry integrity metadata`)
  if (/^\d+\.\d+\.\d+(?:[-+].+)?$/u.test(expected.declaredVersion) && packageRecord.version !== expected.declaredVersion) {
    throw new Error(
      `${expected.packagePath} resolved ${packageRecord.version}, but ${expected.parentPath} declares ${expected.declaredVersion}`,
    )
  }
  if (expected.dependencyName.endsWith('-gnu') && !packageRecord.libc?.includes('glibc'))
    throw new Error(`${expected.packagePath} must target glibc`)
  if (expected.dependencyName.endsWith('-musl') && !packageRecord.libc?.includes('musl'))
    throw new Error(`${expected.packagePath} must target musl`)
}

if (process.platform === 'linux' && process.arch === 'arm64') {
  const runtimeVariant = process.report.getReport().header.glibcVersionRuntime
    ? 'gnu'
    : 'musl'
  const expectedInstalledBindings = expectedBindings.filter(({ dependencyName }) =>
    !dependencyName.endsWith('-gnu') && !dependencyName.endsWith('-musl')
      ? true
      : dependencyName.endsWith(`-${runtimeVariant}`),
  )

  for (const expected of expectedInstalledBindings) {
    if (!existsSync(resolve(repoRoot, expected.packagePath, 'package.json'))) {
      throw new Error(
        `Linux ARM64 ${runtimeVariant} package was not installed: ${expected.packagePath}`,
      )
    }
  }
}

console.log(
  `Linux ARM64 native binding lockfile and installation checks passed for ${expectedBindings.length} entries.`,
)
