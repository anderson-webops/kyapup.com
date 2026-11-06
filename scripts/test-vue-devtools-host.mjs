import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertDevtoolsProviderVersions } from './devtools-provider.mjs'

const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))
const { createServer } = await import(pathToFileURL(require.resolve('vite')))
const { vueDevtools } = await import(pathToFileURL(require.resolve('vite-plugin-vue-devtools')))
const frontend = createRequire(path.join(root, 'front-end/package.json'))
const providerRequire = createRequire(frontend.resolve('@nuxt/devtools'))
const provider = JSON.parse(await readFile(providerRequire.resolve('@vitejs/devtools/package.json'), 'utf8'))
const kit = JSON.parse(await readFile(providerRequire.resolve('@vitejs/devtools-kit/package.json'), 'utf8'))
assertDevtoolsProviderVersions(provider, kit)
const { DevToolsIntegration } = await import(pathToFileURL(providerRequire.resolve('@vitejs/devtools/integration')))
const installedPlugin = path.dirname(require.resolve('vite-plugin-vue-devtools/package.json'))
const scratchRoot = path.join(root, '.ai-work/runs')
await mkdir(scratchRoot, { recursive: true })
const scratch = await mkdtemp(path.join(scratchRoot, 'vue-devtools-host-'))
let server
let initialized = false
try {
  await writeFile(path.join(scratch, 'index.html'), '<!doctype html><html><head><title>Vue integration fixture</title></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>')
  await writeFile(path.join(scratch, 'main.js'), 'import {createApp, h, ref} from "vue"; createApp({setup(){const count=ref(0);return()=>h("button",{onClick:()=>count.value++},String(count.value))}}).mount("#app");')
  const plugins = vueDevtools()
  const dock = plugins.find(plugin => plugin.name === 'vue-devtools:dock-registration')
  assert.ok(dock?.devtools?.setup)
  const setup = dock.devtools.setup
  dock.devtools.setup = async (context) => {
    await setup(context)
    initialized = true
  }
  server = await createServer({
    configFile: false,
    root: scratch,
    cacheDir: path.join(scratch, 'cache'),
    plugins: [
      ...await DevToolsIntegration({
        command: 'serve',
        root: scratch,
        devtools: {
          host: '127.0.0.1',
          options: {
            enabled: true,
            apply: 'serve',
            mcp: false,
            clientAuth: true,
            banner: () => {},
          },
        },
      }),
      ...plugins,
    ],
    resolve: {
      alias: {
        vue: require.resolve('vue/dist/vue.esm-bundler.js', {
          paths: [
            path.join(root, 'front-end'),
          ],
        }),
      },
    },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, open: false },
    devtools: false,
  })
  await server.listen()
  assert.ok(initialized, 'The actual Vite DevTools 0.8 host must initialize the Vue dock')
  const address = server.httpServer.address()
  assert.equal(typeof address, 'object')
  const origin = `http://127.0.0.1:${address.port}`
  const page = await fetch(origin)
  assert.equal(page.status, 200)
  const html = await page.text()
  const proxies = [
    ...html.matchAll(/src="([^"]+html-proxy[^"]+)"/g),
  ]
  assert.ok(proxies.length > 0, 'Vite must emit the injected module proxies')
  const injected = await Promise.all(proxies.map(async ([, url]) => {
    const response = await fetch(new URL(url.replaceAll('&amp;', '&'), origin))
    assert.equal(response.status, 200)
    return response.text()
  }))
  assert.match(injected.join('\n'), /virtual:vue-devtools-client/)
  for (const filename of ['index.html', 'dock-client.js']) {
    const response = await fetch(`${origin}/__devtools__/${filename}`)
    assert.equal(response.status, 200, filename)
    const actual = Buffer.from(await response.arrayBuffer())
    const expected = await readFile(path.join(installedPlugin, 'client', filename))
    assert.equal(createHash('sha256').update(actual).digest('hex'), createHash('sha256').update(expected).digest('hex'), filename)
  }
  const clientUrl = injected.join('\n').match(/["']([^"']*virtual:vue-devtools-client[^"']*)["']/)?.[1]
  assert.ok(clientUrl, 'The injected proxy must import the Vue installation module')
  const client = await fetch(new URL(clientUrl, origin))
  assert.equal(client.status, 200)
  assert.match(await client.text(), /installVueDevTools/)
  console.log('Real Vite DevTools 0.8 initialized the unchanged Vue plugin, exact client UI, dock script and HMR injection')
}
finally {
  await server?.close()
  await rm(scratch, { recursive: true, force: true })
}
