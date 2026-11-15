import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const positive = `
import {Worker,type WorkerFarmOptions} from 'jest-worker';
import {globsToMatcher,initializeGarbageCollectionUtils,type DeletionMode} from 'jest-util';
import type {Config} from '@jest/types';
import chalk,{Chalk,type ForegroundColor,type ChalkInstance} from 'chalk';
import supportsColor,{createSupportsColor} from 'supports-color';
import is from '@sindresorhus/is';
import {balanced,range} from 'balanced-match';
import {expand} from 'brace-expansion';
import {dump as consoleDump} from '@poppinss/dumper/console';
import {dump as htmlDump,createScript,createStyleSheet} from '@poppinss/dumper/html';
const options:WorkerFarmOptions={numWorkers:2,enableWorkerThreads:true,maxRetries:1};
const worker=new Worker(new URL('./worker.cjs',import.meta.url),options);
const start:Promise<void>=worker.start();
const ended:Promise<{forceExited:boolean}>=worker.end();
const color:ForegroundColor='green';
const coloring:ChalkInstance=new Chalk({level:1});
const styled:string=coloring[color](chalk.bold('fixture'));
const terminal=createSupportsColor(process.stdout);
const enabled:boolean|false=supportsColor.stdout&&supportsColor.stdout.hasBasic;
const mode:DeletionMode=initializeGarbageCollectionUtils(globalThis,'soft');
const display:Config.DisplayName={name:'fixture',color};
const matcher:(value:string)=>boolean=globsToMatcher(['**/*.js']);
const result=balanced('{','}','{value}');
const indices:[number,number]|undefined=range('{','}','{value}');
const values:string[]=expand('{one,two}');
const unknownValue:unknown={answer:42};if(is.plainObject(unknownValue)){Object.keys(unknownValue);}
const consoleOutput:string=consoleDump(unknownValue,{depth:2,maxArrayLength:3});
const htmlOutput:string=htmlDump(unknownValue,{depth:2,cspNonce:'synthetic',expand:'all'});
const script:string=createScript();const stylesheet:string=createStyleSheet();
`
const negatives = [
  `import {Worker} from 'jest-worker';new Worker('worker.cjs',{numWorkers:'two'});`,
  `import {initializeGarbageCollectionUtils} from 'jest-util';initializeGarbageCollectionUtils(globalThis,'invalid');`,
  `import type {Config} from '@jest/types';const value:Config.DisplayName={name:'fixture',color:'invalid-color'};`,
  `import {Chalk} from 'chalk';new Chalk({level:8});`,
  `import {balanced} from 'balanced-match';balanced(42,'}','{value}');`,
  `import {dump} from '@poppinss/dumper/html';dump({}, {expand:'invalid'});`,
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
  test(`${name} validates actual terminal parent and current provider declarations`, { timeout: 180000 }, async () => {
    const parent = path.join(root, '.ai-work/runs')
    await mkdir(parent, { recursive: true })
    const directory = await mkdtemp(path.join(parent, 'terminal-parent-types-'))
    const filename = path.join(directory, 'consumer.mts')
    const configuration = path.join(directory, 'tsconfig.json')
    const compile = () => spawnSync(process.execPath, [compiler, '--project', configuration], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 256 * 1024,
    })
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
      const result = compile()
      assert.ifError(result.error)
      assert.equal(result.signal, null)
      assert.equal(result.status, 0, result.stdout || result.stderr)
      for (const source of negatives) {
        await writeFile(filename, source)
        const rejected = compile()
        assert.ifError(rejected.error)
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
