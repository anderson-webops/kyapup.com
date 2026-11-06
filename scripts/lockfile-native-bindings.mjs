import { posix } from 'node:path'

export function resolveOptionalBinding(packages, parentPath, dependencyName) {
  if (posix.isAbsolute(parentPath) || parentPath.split('/').includes('..'))
    throw new Error('Native dependency parents must use relative lockfile paths')
  let directory = parentPath
  for (;;) {
    if (posix.basename(directory) !== 'node_modules') {
      const packagePath = posix.join(directory, 'node_modules', dependencyName)
      if (Object.hasOwn(packages, packagePath))
        return { packagePath, packageRecord: packages[packagePath] }
    }
    if (!directory)
      return undefined
    const parent = posix.dirname(directory)
    directory = parent === '.'
      ? ''
      : parent
  }
}
