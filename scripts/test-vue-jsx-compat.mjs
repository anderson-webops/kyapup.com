import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseSync } from '@babel/core'
import vueJsx from '@vitejs/plugin-vue-jsx'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))

async function transform(code, filename = '/fixture.tsx', { options = {}, development = false, ssr = false } = {}) {
  const plugin = vueJsx(options)
  plugin.configResolved({
    command: development ? 'serve' : 'build',
    isProduction: !development,
    root: '/',
    build: { sourcemap: true },
  })
  return plugin.transform.handler(code, filename, { ssr })
}

test('Nuxt consumes the maintained provider and its coherent Babel8/Vue Babel3 graph', async () => {
  const frontend = createRequire(path.join(root, 'front-end/package.json'))
  const nuxt = createRequire(frontend.resolve('@nuxt/vite-builder'))
  const provider = createRequire(nuxt.resolve('@vitejs/plugin-vue-jsx'))
  assert.equal(nuxt.resolve('@vitejs/plugin-vue-jsx'), require.resolve('@vitejs/plugin-vue-jsx'))
  for (const [name, major] of [
    ['@babel/core', '8.'],
    ['@babel/plugin-syntax-typescript', '8.'],
    ['@babel/plugin-transform-typescript', '8.'],
    ['@vue/babel-plugin-jsx', '3.'],
  ]) {
    const metadata = JSON.parse(await readFile(provider.resolve(`${name}/package.json`), 'utf8'))
    assert.ok(metadata.version.startsWith(major), `${name} must resolve the reviewed major`)
  }
  const vue = createRequire(provider.resolve('@vue/babel-plugin-jsx'))
  assert.equal(vue.resolve('@babel/core'), provider.resolve('@babel/core'))
  assert.ok(JSON.parse(await readFile(nuxt.resolve('@babel/plugin-syntax-jsx/package.json'), 'utf8')).version.startsWith('8.'))
})

test('TSX erases types with synchronous Babel8 config and preserves class semantics', async () => {
  const source = 'import {defineComponent} from "vue"; interface Label {text:string}; class Item { declare missing: string; value: number; constructor(){this.value=3} }; export default defineComponent(() => () => <p>{new Item().value}</p>)'
  const result = await transform(source)
  assert.doesNotMatch(result.code, /interface Label|declare missing|: number|: string/)
  assert.match(result.code, /value;/)
  assert.match(result.code, /_createVNode\("p"/)
  assert.deepEqual(result.map.sources, ['/fixture.tsx'])
  assert.equal(result.map.sourcesContent[0], source)
  assert.equal(parseSync(result.code, { configFile: false, babelrc: false }).type, 'File')
})

test('production purity uses a valid AST annotation instead of a rewritten identifier', async () => {
  const result = await transform('import {defineComponent} from "vue"; export default defineComponent(() => () => <p>ok</p>)', '/fixture.jsx')
  const ast = parseSync(result.code, { configFile: false, babelrc: false })
  const call = ast.program.body.find(node => node.type === 'ExportDefaultDeclaration').declaration
  assert.equal(call.callee.name, 'defineComponent')
  assert.ok(call.leadingComments.some(comment => comment.value === '#__PURE__'))
})

test('Vue Babel3 preserves v-model, fragments and component slots', async () => {
  const result = await transform('import {defineComponent,ref} from "vue"; import Slot from "./Slot.vue"; export default defineComponent(() => {const value=ref("start");return () => <><input v-model={value.value}/><Slot v-slots={{default:()=><b>{value.value}</b>}}/></>})', '/fixture.tsx', {
    options: { resolveType: true },
  })
  assert.match(result.code, /vModelText/)
  assert.match(result.code, /Fragment/)
  assert.match(result.code, /onUpdate:modelValue/)
  assert.match(result.code, /default:/)
})

test('Vue type resolution reads Babel8 TypeScript nodes into runtime props', async () => {
  const result = await transform('import {defineComponent} from "vue"; export default defineComponent((props: {message:string}) => () => <p>{props.message}</p>)', '/props.tsx', {
    options: { resolveType: true },
  })
  assert.match(result.code, /props:/)
  assert.match(result.code, /message:/)
  assert.match(result.code, /type: String/)
  assert.match(result.code, /required: true/)
})

test('the built-in TS path preserves types for Vite and still compiles JSX', async () => {
  const result = await transform('const value: string = "ok"; export default () => <p>{value}</p>', '/fixture.tsx', {
    options: { tsTransform: 'built-in' },
  })
  assert.match(result.code, /value: string/)
  assert.match(result.code, /_createVNode/)
})

test('development HMR handles satisfies expressions and SSR excludes client reload code', async () => {
  const source = 'import {defineComponent} from "vue"; export default defineComponent(() => () => <p>ok</p>) satisfies object'
  const client = await transform(source, '/fixture.tsx', { development: true })
  assert.match(client.code, /import\.meta\.hot\.accept/)
  assert.match(client.code, /__VUE_HMR_RUNTIME__\.createRecord/)
  const server = await transform(source, '/fixture.tsx', { development: true, ssr: true })
  assert.match(server.code, /ssrRegisterHelper\(__default__/)
  assert.doesNotMatch(server.code, /import\.meta\.hot|__VUE_HMR_RUNTIME__/)
})

test('query-suffixed TSX retains source identity while unrelated files are untouched', async () => {
  const result = await transform('const text: string = "ok"; export default () => <p>{text}</p>', '/fixture.tsx?vue&type=script')
  assert.doesNotMatch(result.code, /text: string/)
  assert.deepEqual(result.map.sources, ['/fixture.tsx?vue&type=script'])
  assert.equal(await transform('export const value = 1', '/fixture.js'), undefined)
})

test('invalid TSX keeps actionable syntax errors instead of silently passing through', async () => {
  await assert.rejects(transform('const value: = <p/>', '/broken.tsx'), error => error.code === 'BABEL_PARSE_ERROR' && error.loc.line === 1)
  assert.equal(process.versions.node.split('.')[0], '26')
})
