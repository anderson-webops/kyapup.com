import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { createUnimport, version } from 'unimport'
import { vueTemplateAddon } from 'unimport/addons'
import plugin from 'unimport/unplugin'

assert.equal(version, '7.0.2')
const instance = createUnimport({
  parser: 'acorn',
  imports: [
    { name: 'selected', from: 'synthetic-only' },
  ],
  addons: [
    vueTemplateAddon(),
  ],
})
const transformed = await instance.injectImports('export const value = selected()', 'entry.mjs')
assert.match(transformed.code.toString(), /import \{ selected \} from 'synthetic-only'/)
const raw = plugin.raw({
  imports: [
    { name: 'selected', from: 'synthetic-only' },
  ],
}, { framework: 'vite', versions: {} })
const handler = typeof raw.transform === 'function'
  ? raw.transform
  : raw.transform.handler
const result = await handler.call({}, 'export const value = selected()', 'entry.mjs')
assert.match(result.code, /import \{ selected \} from 'synthetic-only'/)
assert.throws(() => readFileSync(process.argv[2]), { code: 'ERR_ACCESS_DENIED' })
console.log('Compiled core, addons and raw plugin passed with source and development dependencies denied')
