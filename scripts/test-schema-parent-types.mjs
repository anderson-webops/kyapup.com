import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const valid = `
import {Ajv,type Options} from 'ajv';
import postcss, {type Plugin} from 'postcss';
import {nanoid} from 'nanoid';
import {nanoid as nonsecure} from 'nanoid/non-secure';
import {parse,resolve,serialize} from 'fast-uri';
import {ESLint} from 'eslint';
const settings:Options={allowNullable:false};
const validator=new Ajv(settings).compile<{value:string}>({type:'object'});
const plugin:Plugin={postcssPlugin:'synthetic',Declaration(declaration){declaration.value='green';}};
const transformed=await postcss([plugin]).process('a{color:red}',{from:'input.css'});
const identity:string=nanoid(12)+nonsecure(6);
const resolved:string=resolve('https://example.invalid/','path');
const encoded:string=serialize(parse(resolved));
const engine=new ESLint({overrideConfigFile:true});
`
const invalid = [
  `import type {Options} from 'ajv';const options:Options={allowNullable:'invalid'};`,
  `import {nanoid} from 'nanoid';nanoid('invalid');`,
  `import {parse} from 'fast-uri';parse(42);`,
  `import postcss from 'postcss';postcss().process('a{}',{from:42});`,
]

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
  test(`${name} checks actual schema/identifier public types with strict library checks`, { timeout: 120000 }, async () => {
    const base = path.join(root, '.ai-work/runs')
    await mkdir(base, { recursive: true })
    const directory = await mkdtemp(path.join(base, 'schema-parent-types-'))
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
    const compile = (source) => {
      return writeFile(filename, source).then(() => spawnSync(process.execPath, [compiler, '--project', configuration], {
        cwd: root,
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 256 * 1024,
      }))
    }
    try {
      const accepted = await compile(valid)
      assert.equal(accepted.signal, null)
      assert.equal(accepted.status, 0, accepted.stdout || accepted.stderr)
      for (const source of invalid) {
        const rejected = await compile(source)
        assert.equal(rejected.signal, null)
        assert.notEqual(rejected.status, 0, source)
        assert.match(rejected.stdout || rejected.stderr, /TS(?:2322|2345|2353|2769)/)
      }
    }
    finally {
      await rm(directory, { recursive: true })
    }
  })
}
