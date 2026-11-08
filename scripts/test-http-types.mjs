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

const commonjs = `
import { Readable } from 'node:stream';
import cookie = require('cookie');
import encode = require('encodeurl');
import body = require('raw-body');
import typeIs = require('type-is');
const header: string = cookie.serialize('session', 'value', { httpOnly: true, sameSite: 'strict' });
const parsed: Record<string, string | undefined> = cookie.parse('session=value');
const url: string = encode('/path with spaces');
const namedUrl: string = encode.encodeUrl(url);
const bytes: Promise<Buffer> = body(Readable.from([Buffer.from('value')]));
const text: Promise<string> = body(Readable.from([Buffer.from('value')]), 'utf-8');
body(Readable.from([Buffer.from('value')]), 'utf-8', (error, value) => {
  const result: string = value;
  const failure: Error | null = error;
});
const directText: Promise<string> = body.default(Readable.from([Buffer.from('value')]), true);
const result: string | false | null = typeIs({ headers: { 'content-type': 'application/json', 'content-length': '1' } }, 'json');
const match: boolean = typeIs.match('*/*+json', 'application/problem+json');
const normalized: string | false = typeIs.normalize('json');
const modern = new typeIs.TypeIs(['application/*+json']);
const modernResult: string | undefined = modern.is('application/problem+json');
`

const esm = `
import { Readable } from 'node:stream';
import { stringifySetCookie } from 'cookie';
import { encodeUrl } from 'encodeurl';
import { getRawBody } from 'raw-body';
import { TypeIs } from 'type-is';
const header: string = stringifySetCookie({ name: 'session', value: 'value', httpOnly: true });
const url: string = encodeUrl('/path with spaces');
const body: Promise<string> = getRawBody(Readable.from([Buffer.from('value')]), { encoding: 'utf-8' });
const result: string | undefined = new TypeIs(['application/json']).is('application/json');
`

const invalid = {
  'cookie': 'import cookie = require(\'cookie\'); cookie.serialize(42, \'value\');',
  'cookieMissing': 'import cookie = require(\'cookie\'); const value: string = cookie.parse(\'session=value\').missing;',
  'encodeurl': 'import encode = require(\'encodeurl\'); const value: number = encode(\'/path\');',
  'raw-body': 'import body = require(\'raw-body\'); body(42);',
  'type-is': 'import typeIs = require(\'type-is\'); typeIs.match(\'*/*\', 42);',
}

async function compile(compiler, filenames) {
  const configuration = path.join(path.dirname(filenames[0]), 'tsconfig.json')
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
    files: filenames,
  }))
  return spawnSync(process.execPath, [
    compiler,
    '--project',
    configuration,
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 128 * 1024,
  })
}

for (const [name, compiler] of compilers) {
  test(`${name} validates original ESM and adapted CommonJS HTTP interfaces with strict declarations`, { timeout: 120000 }, async () => {
    const base = path.join(root, '.ai-work/runs')
    await mkdir(base, { recursive: true })
    const directory = await mkdtemp(path.join(base, 'http-types-'))
    try {
      const filenames = [
        path.join(directory, 'valid.cts'),
        path.join(directory, 'valid.mts'),
      ]
      await writeFile(filenames[0], commonjs)
      await writeFile(filenames[1], esm)
      const result = await compile(compiler, filenames)
      assert.equal(result.status, 0, result.stdout || result.stderr)
      assert.equal(result.signal, null)
      for (const [library, source] of Object.entries(invalid)) {
        const filename = path.join(directory, `invalid-${library}.cts`)
        await writeFile(filename, source)
        const rejected = await compile(compiler, [filename])
        assert.notEqual(rejected.status, 0, `${library} must reject invalid calls`)
        assert.equal(rejected.signal, null)
        assert.match(rejected.stdout || rejected.stderr, /error TS\d+/)
        assert.doesNotMatch(rejected.stdout || rejected.stderr, /TS7016|TS2307|Cannot find/)
      }
    }
    finally {
      await rm(directory, { recursive: true })
    }
  })
}
