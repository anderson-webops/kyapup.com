import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const compilers = [
  [
    'TypeScript 6',
    require.resolve('typescript/bin/tsc'),
  ],
  [
    'TypeScript 7',
    path.join(root, 'back-end/scripts/run-typescript.mjs'),
  ],
]
const valid = `
import type { PluginOption } from 'vite';
import type { DevToolsIntegrationOptions } from '@vitejs/devtools/integration';
import { DevToolsIntegration } from '@vitejs/devtools/integration';
import { vueDevtools } from 'vite-plugin-vue-devtools';
import type { VitePluginVueDevToolsOptions } from 'vite-plugin-vue-devtools';
const options: VitePluginVueDevToolsOptions = { enabled: true, appendTo: ['entry.ts', /entry\\.ts$/] };
const plugins: PluginOption[] = vueDevtools(options);
const host: DevToolsIntegrationOptions = { command: 'serve', root: process.cwd(), devtools: { host: '127.0.0.1', options: { enabled: true, apply: 'serve', mcp: false, clientAuth: true } } };
const integrated: Promise<{ name: string }[]> = DevToolsIntegration(host);
`
const invalid = [
  `import { vueDevtools } from 'vite-plugin-vue-devtools'; vueDevtools({ appendTo: 42 });`,
  `import { vueDevtools } from 'vite-plugin-vue-devtools'; vueDevtools({ enabled: 'yes' });`,
  `import { DevToolsIntegration } from '@vitejs/devtools/integration'; DevToolsIntegration({ command: 'invalid', devtools: { options: false } });`,
]

async function compile(compiler, directory, source) {
  const filename = path.join(directory, 'consumer.mts')
  await writeFile(filename, source)
  const configuration = path.join(directory, 'tsconfig.json')
  await writeFile(configuration, JSON.stringify({
    compilerOptions: {
      noEmit: true,
      strict: true,
      skipLibCheck: false,
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2023',
      types: ['node'],
    },
    files: [filename],
  }))
  return spawnSync(process.execPath, [compiler, '--project', configuration], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 256 * 1024,
  })
}

for (const [name, compiler] of compilers) {
  test(`${name} checks the actual current host and Vue plugin with strict positive and negative declarations`, { timeout: 120000 }, async () => {
    const base = path.join(root, '.ai-work/runs')
    await mkdir(base, { recursive: true })
    const directory = await mkdtemp(path.join(base, 'vue-devtools-types-'))
    try {
      const accepted = await compile(compiler, directory, valid)
      assert.equal(accepted.status, 0, accepted.stdout || accepted.stderr)
      assert.equal(accepted.signal, null)
      for (const source of invalid) {
        const rejected = await compile(compiler, directory, source)
        assert.notEqual(rejected.status, 0, 'Invalid public API usage must be rejected')
        assert.equal(rejected.signal, null)
        assert.match(rejected.stdout || rejected.stderr, /TS(?:2322|2345|2353|2559)/)
      }
    }
    finally {
      await rm(directory, { recursive: true })
    }
  })
}
