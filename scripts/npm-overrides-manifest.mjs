import { builtinManifests, dumpDependencies } from 'taze'

const packageJSON = builtinManifests.find(manifest => manifest.name === 'package.json')
if (!packageJSON)
  throw new Error('Taze package.json manifest is unavailable')

function packageName(selector) {
  const separator = selector.lastIndexOf('@')
  return separator > 0
    ? selector.slice(0, separator)
    : selector
}

function overrideDependency(raw, key, value, parents, shouldUpdate) {
  if (typeof value !== 'string')
    throw new TypeError(`Invalid npm override at ${[...parents, key].join('/')}`)
  const name = packageName(key === '.'
    ? parents.at(-1) ?? ''
    : key)
  if (!name)
    throw new Error('An npm self override requires a parent package')
  let currentVersion = value
  if (value.startsWith('$')) {
    const reference = value.slice(1)
    currentVersion = raw.dependencies?.[reference] ?? raw.devDependencies?.[reference] ?? raw.optionalDependencies?.[reference]
    if (typeof currentVersion !== 'string' || currentVersion.startsWith('$'))
      throw new Error(`Unresolved npm override reference ${value}`)
  }
  return {
    name,
    currentVersion,
    parents,
    source: 'overrides',
    packageType: 'npm',
    update: shouldUpdate(name),
    npmOverrideKey: key,
    npmOverrideReference: value.startsWith('$')
      ? value
      : undefined,
  }
}

export function overrideDependencies(raw, shouldUpdate) {
  const dependencies = []
  function visit(branch, parents = []) {
    if (!branch || typeof branch !== 'object' || Array.isArray(branch))
      throw new Error('npm overrides must contain dependency declarations')
    for (const [key, value] of Object.entries(branch)) {
      if (typeof value === 'object' && value !== null)
        visit(value, [...parents, key])
      else
        dependencies.push(overrideDependency(raw, key, value, parents, shouldUpdate))
    }
  }
  if (raw.overrides !== undefined)
    visit(raw.overrides)
  return dependencies
}

function preserveOverrideDeclaration(dependency) {
  if (dependency.source !== 'overrides')
    return dependency
  if (!dependency.npmOverrideKey)
    throw new Error('Untracked npm override declaration')
  const dumped = dumpDependencies([dependency], 'overrides')
  let leaf = dumped
  for (const parent of dependency.parents)
    leaf = leaf[parent]
  const version = dependency.npmOverrideReference ?? leaf[dependency.aliasName ?? dependency.name]
  if (typeof version !== 'string')
    throw new TypeError('Resolved npm override has no version')
  return {
    name: dependency.npmOverrideKey,
    currentVersion: version,
    targetVersion: version,
    source: 'overrides',
    parents: dependency.parents,
    update: false,
  }
}

export const npmOverridesManifest = {
  ...packageJSON,
  name: 'npm-overrides-aware-package-json',
  async load(relative, options, shouldUpdate) {
    const packages = await packageJSON.load(relative, options, shouldUpdate)
    for (const candidate of packages) {
      if (candidate.type === 'package.json' && options.depFields?.overrides !== false) {
        candidate.deps = [
          ...candidate.deps.filter(dependency => dependency.source !== 'overrides'),
          ...overrideDependencies(candidate.raw, shouldUpdate),
        ]
      }
    }
    return packages
  },
  async write(candidate, options) {
    if (candidate.resolved.some(dependency => dependency.resolveError))
      throw new Error('Resolve dependency metadata failures before writing updates')
    await packageJSON.write({
      ...candidate,
      resolved: candidate.resolved.map(preserveOverrideDeclaration),
    }, options)
  },
}
