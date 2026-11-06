import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolveOptionalBinding } from './lockfile-native-bindings.mjs'

export const imageBindingNames = [
  '@img/sharp-linux-arm64',
  '@img/sharp-linuxmusl-arm64',
  '@img/sharp-libvips-linux-arm64',
  '@img/sharp-libvips-linuxmusl-arm64',
]

export function validateImageBindings(workspaceLock, runtimeLock) {
  const workspace = workspaceLock.packages
  const runtime = runtimeLock.packages
  const workspaceSharp = resolveOptionalBinding(workspace, 'back-end', 'sharp')
  const runtimeSharp = resolveOptionalBinding(runtime, '', 'sharp')
  assert.ok(workspaceSharp && runtimeSharp, 'Both dependency graphs must retain Sharp')
  assert.equal(workspaceSharp.packageRecord.version, runtimeSharp.packageRecord.version, 'Sharp version must agree between dependency graphs')
  return imageBindingNames.map((name) => {
    const selected = resolveOptionalBinding(workspace, workspaceSharp.packagePath, name)
    const deployed = resolveOptionalBinding(runtime, runtimeSharp.packagePath, name)
    assert.ok(selected && deployed, `Both dependency graphs must retain ${name}`)
    const expectedLibc = name.includes('linuxmusl')
      ? 'musl'
      : 'glibc'
    for (const [binding, sharp] of [
      [selected, workspaceSharp],
      [deployed, runtimeSharp],
    ]) {
      const metadata = binding.packageRecord
      assert.equal(metadata.version, sharp.packageRecord.optionalDependencies[name], `${name} must match Sharp's pinned native dependency`)
      assert.equal(metadata.optional, true, `${name} must remain optional`)
      assert.ok(metadata.cpu?.includes('arm64') && metadata.os?.includes('linux'), `${name} must target Linux ARM64`)
      assert.ok(metadata.libc?.includes(expectedLibc), `${name} must retain its libc boundary`)
      assert.match(metadata.integrity, /^sha512-/u, `${name} must retain registry integrity`)
    }
    assert.equal(selected.packageRecord.integrity, deployed.packageRecord.integrity, `${name} integrity must agree between dependency graphs`)
    return { name, workspacePath: selected.packagePath, runtimePath: deployed.packagePath }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(import.meta.dirname, '..')
  const bindings = validateImageBindings(
    JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')),
    JSON.parse(readFileSync(path.join(root, 'back-end/package-lock.json'), 'utf8')),
  )
  if (process.platform === 'linux' && process.arch === 'arm64') {
    const musl = !process.report.getReport().header.glibcVersionRuntime
    for (const binding of bindings.filter(entry => entry.name.includes('linuxmusl') === musl))
      assert.ok(existsSync(path.join(root, binding.workspacePath, 'package.json')), `Required native image package must be installed: ${binding.name}`)
  }
  process.stdout.write(`All ${bindings.length} native image bindings agree across independent locks.\n`)
}
