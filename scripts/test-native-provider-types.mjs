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
import plugin from 'eslint-plugin-format';
import type { Linter } from 'eslint';
import { format } from 'oxfmt';
import type { FormatConfig, FormatOptions } from 'oxfmt';
import { parseSync } from 'oxc-parser';
import transformer from '@unocss/transformer-attributify-jsx';
import type { SourceCodeTransformer } from '@unocss/core';
import { createConfigLoader } from 'unconfig';
import UnoCSS from 'unocss/vite';
import type { PluginOption } from 'vite';
const options: FormatConfig = { semi: false, printWidth: 80, singleQuote: true, endOfLine: 'crlf' };
const compatibility: FormatOptions = { ...options, experimentalSortImports: { partitionByComment: true } };
const result = format('fixture.ts', 'const value:number=1', options);
const ast = parseSync('fixture.tsx', 'const view = <div flex />', { sourceType: 'module' });
const adapter: SourceCodeTransformer = transformer({ include: [{ pattern: /\\.tsx$/, resolver: 'oxc' }], blocklist: ['raw', /^data-/] });
const config: Linter.Config = { plugins: { format: plugin }, rules: { 'format/oxfmt': ['error', compatibility] } };
const loader = createConfigLoader<{ value: number }>({ sources: [{ files: 'fixture.config', extensions: ['json'] }] });
const asynchronous: Promise<{ config: { value: number } }> = loader.load.async(true);
const synchronous: { config: { value: number } } = loader.load.sync(false);
const plugins: PluginOption[] = UnoCSS({ transformers: [adapter] });
`
const invalid = [
  `import type { FormatConfig } from 'oxfmt'; const options: FormatConfig = { semi: 'invalid' };`,
  `import transformer from '@unocss/transformer-attributify-jsx'; transformer({ include: [{ pattern: /x/, resolver: 'invalid' }] });`,
  `import { parseSync } from 'oxc-parser'; parseSync(42, 'const value = 1');`,
  `import { createConfigLoader } from 'unconfig'; createConfigLoader({}).load.async('invalid');`,
]

async function compile(compiler, directory, source) {
  const filename = path.join(directory, 'consumer.mts')
  const configuration = path.join(directory, 'tsconfig.json')
  await writeFile(filename, source)
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
  test(`${name} validates actual current native-provider and parent public declarations`, { timeout: 120000 }, async () => {
    const base = path.join(root, '.ai-work/runs')
    await mkdir(base, { recursive: true })
    const directory = await mkdtemp(path.join(base, 'native-provider-types-'))
    try {
      const positive = await compile(compiler, directory, valid)
      assert.equal(positive.status, 0, positive.stdout || positive.stderr)
      assert.equal(positive.signal, null)
      for (const source of invalid) {
        const negative = await compile(compiler, directory, source)
        assert.notEqual(negative.status, 0, 'Invalid public API use must fail type checking')
        assert.equal(negative.signal, null)
        assert.match(negative.stdout || negative.stderr, /TS(?:2322|2345|2353|2769)/)
      }
    }
    finally {
      await rm(directory, { recursive: true })
    }
  })
}
