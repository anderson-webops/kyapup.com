import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
test('the unconditional configuration type peer is declared and resolves inside this locked application', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'))
  assert.equal(manifest.devDependencies.giget, '3.3.1')
  const local = path.join(root, 'node_modules/giget')
  const metadata = JSON.parse(await readFile(path.join(local, 'package.json'), 'utf8'))
  assert.equal(metadata.version, '3.3.1')
  assert.equal(lock.packages['node_modules/giget'].version, metadata.version)
  const resolution = path.relative(local, require.resolve('giget'))
  assert.ok(resolution && !resolution.startsWith('..') && !path.isAbsolute(resolution), 'Ancestor installations cannot satisfy the application peer')
  const configuration = createRequire(require.resolve('c12'))
  assert.equal(configuration.resolve('giget'), require.resolve('giget'))
})

const positive = `
import {defineConfig,type UserConfig} from 'vite';
import {rolldown,type InputOptions} from 'rolldown';
import {loadConfig,watchConfig,loadDotenv,type WatchConfigOptions} from 'c12';
const bundler:InputOptions={input:'fixture.mts',plugins:[{name:'fixture',transform:{filter:{id:/\\.mts$/},handler(code){return {code,map:null}}}}]};
const vite:UserConfig=defineConfig({build:{rolldownOptions:bundler}});
const watching:WatchConfigOptions<{value:number}>={name:'fixture',debounce:20,async onWatch(event){event.type satisfies 'created'|'updated'|'removed';},async onUpdate({newConfig}){newConfig.config.value.toFixed();}};
const current=await loadConfig<{value:number}>({envName:['production','reviewed'],schema:{'~standard':{version:1,vendor:'fixture',validate:()=>({value:{value:42}})}}});
const watcher=await watchConfig(watching);await watcher.unwatch();
const environment=await loadDotenv({env:{},expandFileReferences:false});
const output=await rolldown(bundler);await output.close();
`
const negative = [
  `import {loadConfig} from 'c12';loadConfig({cwd:42});`,
  `import {watchConfig} from 'c12';watchConfig({onWatch(event){const impossible:number=event.type;}});`,
  `import type {InputOptions} from 'rolldown';const options:InputOptions={input:42};`,
]

function compileProject(compiler, configuration) {
  return spawnSync(process.execPath, [compiler, '--project', configuration], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 256 * 1024,
  })
}

for (const [name, compiler] of [
  [
    'TypeScript 6',
    require.resolve('typescript/bin/tsc'),
  ],
  [
    'TypeScript 7',
    path.join(root, 'back-end/scripts/run-typescript.mjs'),
  ],
]) {
  test(`${name} checks real bundler and current-major configuration public types without skipped libraries`, { timeout: 120000 }, async () => {
    const base = path.join(root, '.ai-work/runs')
    await mkdir(base, { recursive: true })
    const directory = await mkdtemp(path.join(base, 'framework-parent-types-'))
    const filename = path.join(directory, 'consumer.mts')
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
    try {
      await writeFile(filename, positive)
      const result = compileProject(compiler, configuration)
      assert.equal(result.signal, null)
      assert.equal(result.status, 0, result.stdout || result.stderr)
      for (const source of negative) {
        await writeFile(filename, source)
        const rejected = compileProject(compiler, configuration)
        assert.equal(rejected.signal, null)
        assert.notEqual(rejected.status, 0)
        assert.match(rejected.stdout || rejected.stderr, /TS(?:2322|2345|2353|2769)/)
      }
    }
    finally {
      await rm(directory, { recursive: true })
    }
  })

  test(`${name} checks Nuxt configuration in its real generated project context`, { timeout: 120000 }, async () => {
    const generated = path.join(root, 'front-end/.nuxt/tsconfig.node.json')
    const project = JSON.parse(await readFile(generated, 'utf8'))
    assert.ok(project.compilerOptions.paths['nuxt/schema'], 'Use actual generated framework aliases')
    const base = path.join(root, '.ai-work/runs')
    const directory = await mkdtemp(path.join(base, 'framework-nuxt-types-'))
    const filename = path.join(directory, 'consumer.mts')
    const configuration = path.join(directory, 'tsconfig.json')
    await writeFile(configuration, JSON.stringify({
      extends: generated,
      compilerOptions: { noEmit: true },
      files: [filename],
      include: [],
      exclude: [],
    }))
    try {
      await writeFile(filename, `import {defineNuxtConfig} from 'nuxt/config';defineNuxtConfig({ssr:true,vite:{build:{rolldownOptions:{input:'fixture.mts'}}}});`)
      const result = compileProject(compiler, configuration)
      assert.equal(result.signal, null)
      assert.equal(result.status, 0, result.stdout || result.stderr)
      for (const source of [
        `import {defineNuxtConfig} from 'nuxt/config';defineNuxtConfig({ssr:'invalid'});`,
        `import {defineNuxtConfig} from 'nuxt/config';defineNuxtConfig({vite:{build:{rolldownOptions:{input:42}}}});`,
      ]) {
        await writeFile(filename, source)
        const rejected = compileProject(compiler, configuration)
        assert.equal(rejected.signal, null)
        assert.notEqual(rejected.status, 0)
        assert.match(rejected.stdout || rejected.stderr, /TS(?:2322|2345|2353|2769)/)
      }
    }
    finally {
      await rm(directory, { recursive: true })
    }
  })
}
