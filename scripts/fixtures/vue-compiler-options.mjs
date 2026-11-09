import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { transformSync } from 'esbuild'

const root = fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(new URL('../../package.json', import.meta.url))

export function normalized(value) {
  if (Array.isArray(value))
    return Array.from(value, normalized)
  if (typeof value === 'function')
    return value.name
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(name => [
      name,
      normalized(value[name]),
    ]))
  }
  return value
}

export function optionsFrom(content) {
  const javascript = transformSync(content, { loader: 'ts', format: 'cjs', target: 'node26' }).code
  const module = { exports: {} }
  runInNewContext(javascript, {
    require(name) {
      assert.equal(name, 'vue', 'Synthetic compiler fixtures import only the local Vue runtime')
      return require(name)
    },
    module,
    exports: module.exports,
  }, { timeout: 2000, filename: `${root}/synthetic-compiler-output.cjs` })
  const component = module.exports.default
  return {
    props: normalized(component.props || {}),
    emits: normalized(component.emits || []),
  }
}
