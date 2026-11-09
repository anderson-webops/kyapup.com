import assert from 'node:assert/strict'
import test from 'node:test'
import { imageBindingNames, validateImageBindings } from './check-image-bindings.mjs'

function fixture() {
  const packages = {
    '': {},
    'node_modules/sharp': { version: '0.35.5', optionalDependencies: {} },
  }
  for (const name of imageBindingNames) {
    const version = name.includes('libvips')
      ? '1.3.4'
      : '0.35.5'
    packages['node_modules/sharp'].optionalDependencies[name] = version
    packages[`node_modules/${name}`] = {
      version,
      optional: true,
      cpu: ['arm64'],
      os: ['linux'],
      libc: [
        name.includes('linuxmusl')
          ? 'musl'
          : 'glibc',
      ],
      integrity: `sha512-controlled-${name}`,
    }
  }
  return { packages }
}

test('both Linux ARM64 libc variants retain independently locked image-processing identities', () => {
  assert.equal(validateImageBindings(fixture(), fixture()).length, 4)
})

test('missing image libraries, wrong native versions and changed integrity cannot qualify', () => {
  for (const change of [
    metadata => delete metadata.packages[`node_modules/${imageBindingNames[0]}`],
    metadata => metadata.packages[`node_modules/${imageBindingNames[0]}`].version = '0.35.999',
    metadata => metadata.packages[`node_modules/${imageBindingNames[0]}`].integrity = 'sha512-unreviewed',
    metadata => metadata.packages[`node_modules/${imageBindingNames[0]}`].optional = false,
    metadata => metadata.packages[`node_modules/${imageBindingNames[0]}`].cpu = ['x64'],
    metadata => metadata.packages[`node_modules/${imageBindingNames[0]}`].libc = ['musl'],
    metadata => metadata.packages['node_modules/sharp'].version = '0.35.999',
  ]) {
    const runtime = fixture()
    change(runtime)
    assert.throws(() => validateImageBindings(fixture(), runtime))
  }
})

test('native image lookup follows dependency ancestry instead of accepting an unrelated nested binding', () => {
  const workspace = fixture()
  const key = `node_modules/${imageBindingNames[0]}`
  workspace.packages[`node_modules/unrelated/${key}`] = workspace.packages[key]
  delete workspace.packages[key]
  assert.throws(() => validateImageBindings(workspace, fixture()))
})
