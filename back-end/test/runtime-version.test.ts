import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertSupportedRuntime, minimumRuntime } from '../src/runtime-version.js'

describe('secured Node runtime', () => {
  it.each(['v26.13.1', 'v26.13.2', 'v26.14.0'])('accepts supported secured releases: %s', (version) => {
    expect(() => assertSupportedRuntime(version)).not.toThrow()
  })

  it.each([
    'v26.13.0',
    'v26.12.99',
    'v24.99.99',
    'v27.0.0',
    'v28.0.0',
    'v26.13.1-rc.1',
    'v26.13.01',
    'v26.9007199254740992.1',
    'v26.13.1\n',
    'unverified',
  ])('rejects unsupported releases before application startup: %s', (version) => {
    expect(() => assertSupportedRuntime(version)).toThrow('requires Node.js 26.13.1')
  })

  it('uses the admitted runtime and the same minimum as the API manifest and artifact contract', () => {
    expect(() => assertSupportedRuntime()).not.toThrow()
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
    const contract = JSON.parse(readFileSync(fileURLToPath(new URL('../../deploy/runtime-artifact.json', import.meta.url)), 'utf8'))
    expect(manifest.engines.node).toBe(`>=${minimumRuntime} <27`)
    expect(contract.runtime.node).toBe(minimumRuntime)
    expect(contract.required).toContain('back-end/dist/runtime-version.js')
  })

  it('rejects application construction under an unsupported reported runtime', () => {
    const entry = new URL('../src/app.ts', import.meta.url).href
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      Object.defineProperty(process, 'version', { value: 'v26.13.0' })
      const { createApp } = await import(${JSON.stringify(entry)})
      assert.throws(() => createApp(), /requires Node.js 26.13.1/)
      process.stdout.write('unsupported runtime rejected before application construction')
    `], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      encoding: 'utf8',
      timeout: 10000,
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('unsupported runtime rejected before application construction')
  })
})
