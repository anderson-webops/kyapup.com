import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { babelParse, babelParseExpression, checkInvalidScopeReference, generateTransform, MagicStringAST, parseSFC, removeMacroImport, resolveObjectExpression } from '@vue-macros/common'
import { walkAST } from 'ast-walker-scope'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(path.join(root, 'package.json'))

test('the real router and scope walker consume current Ast-kit3 and Magic-string-ast2', async () => {
  const router = createRequire(require.resolve('vue-router/vite'))
  const common = createRequire(router.resolve('@vue-macros/common'))
  const walker = createRequire(router.resolve('ast-walker-scope'))
  assert.equal(router.resolve('@vue-macros/common'), require.resolve('@vue-macros/common'))
  for (const parent of [common, walker]) {
    const metadata = JSON.parse(await readFile(parent.resolve('ast-kit/package.json'), 'utf8'))
    assert.equal(metadata.version, '3.0.1')
  }
  assert.equal(JSON.parse(await readFile(common.resolve('magic-string-ast/package.json'), 'utf8')).version, '2.1.1')
  assert.ok(JSON.parse(await readFile(common.resolve('magic-string/package.json'), 'utf8')).version.startsWith('1.'))
})

test('SFC setup and normal scripts produce native Babel8 dynamic-import and bigint nodes', () => {
  const source = '<script lang="ts">export const count:bigint=1n</script><script setup lang="ts">const loader=()=>import("./view.vue");const value=2n</script><template><p>ok</p></template>'
  const sfc = parseSFC(source, '/fixture.vue')
  const normal = sfc.getScriptAst()
  const setup = sfc.getSetupAst()
  assert.equal(normal.body[0].declaration.declarations[0].init.value, 1n)
  assert.equal(setup.body[0].declarations[0].init.body.type, 'ImportExpression')
  assert.equal(setup.body[1].declarations[0].init.value, 2n)
  assert.equal(sfc.getSetupAst().body, setup.body)
  assert.equal(sfc.offset, source.indexOf('const loader'))
})

test('setup hoisting rejects runtime captures and respects shadowing and type-only references', () => {
  assert.throws(() => checkInvalidScopeReference(babelParseExpression('() => hidden.value', 'ts'), 'definePage', ['hidden']), /cannot reference locally declared variables/)
  assert.throws(() => checkInvalidScopeReference(babelParseExpression('() => import(hidden)', 'ts'), 'definePage', ['hidden']), /hidden/)
  assert.doesNotThrow(() => checkInvalidScopeReference(babelParseExpression('(hidden) => hidden.value', 'ts'), 'definePage', ['hidden']))
  assert.doesNotThrow(() => checkInvalidScopeReference(babelParseExpression('(value: Hidden) => value', 'ts'), 'definePage', ['Hidden']))
})

test('the Babel8 scope walker sees only in-scope bindings in parsed SFC programs', () => {
  const program = babelParse('const outer = 1; function reader(input: number) { const inner = input; return outer + inner }', 'ts')
  let checked = false
  walkAST(program, {
    enter(node) {
      if (node.type === 'ReturnStatement') {
        assert.ok(this.scope.outer)
        assert.ok(this.scope.input)
        assert.ok(this.scope.inner)
        checked = true
      }
    },
  })
  assert.ok(checked)
  const resolved = resolveObjectExpression(babelParseExpression('({alpha:1,["beta"]:2,...{gamma:3}})', 'ts'))
  assert.deepEqual(Object.keys(resolved), ['alpha', 'beta', 'gamma'])
  assert.equal(Object.getPrototypeOf(resolved), null)
})

test('macro imports with standard attributes are removed at exact SFC offsets with source maps', () => {
  const source = '<script setup lang="ts">import {macro} from "fixture" with {type:"macro"};const value=1</script><template><p>ok</p></template>'
  const sfc = parseSFC(source, '/fixture.vue')
  const editor = new MagicStringAST(source)
  const node = sfc.getSetupAst().body[0]
  assert.equal(removeMacroImport(node, editor, sfc.offset), true)
  const transformed = generateTransform(editor, '/fixture.vue')
  assert.doesNotMatch(transformed.code, /import \{macro\}/)
  assert.match(transformed.code, /const value=1/)
  assert.deepEqual(transformed.map.sourcesContent, [source])
  assert.deepEqual(transformed.map.sources, ['/fixture.vue'])
})

test('modern string edits preserve clone independence and original-node slicing', () => {
  const editor = new MagicStringAST('const value = 1;')
  const node = babelParse(editor.toString(), 'js').body[0].declarations[0].init
  assert.equal(editor.sliceNode(node), '1')
  const copy = editor.clone()
  copy.overwriteNode(node, '2')
  assert.equal(copy.toString(), 'const value = 2;')
  assert.equal(editor.toString(), 'const value = 1;')
  assert.equal(editor.snipNode(node).toString(), '1')
})

test('invalid source and mismatched SFC languages remain explicit failures', () => {
  assert.throws(() => parseSFC('<script lang="js">export const count=1</script><script setup lang="ts">const value=1</script>', '/bad.vue'), /same language type/)
  assert.throws(() => parseSFC('<script setup lang="ts">const value: = 1</script>', '/bad.vue').getSetupAst(), error => error.code === 'BABEL_PARSER_SYNTAX_ERROR' && error.loc.line === 1)
  assert.throws(() => parseSFC('<script setup>import data from "./data.json" assert {type:"json"}</script>', '/old.vue').getSetupAst(), error => error.code === 'BABEL_PARSER_SYNTAX_ERROR' && error.loc.line === 1)
})

test('strict TypeScript accepts the coherent public compiler APIs and rejects invalid node positions', async () => {
  const scratchRoot = path.join(root, '.ai-work/runs')
  await mkdir(scratchRoot, { recursive: true })
  const scratch = await mkdtemp(path.join(scratchRoot, 'vue-macros-types-'))
  const filename = path.join(scratch, 'fixture.mts')
  const source = 'import {babelParse,MagicStringAST,parseSFC,checkInvalidScopeReference} from "@vue-macros/common";import {walkAST} from "ast-walker-scope";import type {Program} from "@babel/types";const ast:Program=babelParse("const value:number=1","ts");walkAST(ast,{enter(node){if(node.type==="Identifier")node.name.toUpperCase()}});const setup:Program|undefined=parseSFC("<script setup>const value=1</script>","/fixture.vue").getSetupAst();const editor=new MagicStringAST("value");editor.overwriteNode({start:0,end:5},"next");const copied:string=editor.clone().toString();checkInvalidScopeReference(ast,"definePage",["hidden"]);void setup;void copied;'
  const config = path.join(scratch, 'tsconfig.json')
  const argumentsFor = ['--project', config]
  try {
    await writeFile(filename, source)
    await writeFile(config, JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
        strict: true,
        skipLibCheck: false,
        types: ['node'],
        lib: ['ES2022', 'DOM'],
        noEmit: true,
      },
      files: ['fixture.mts'],
    }))
    const compiler = require.resolve('typescript/bin/tsc')
    const valid = spawnSync(process.execPath, [compiler, ...argumentsFor], { cwd: root, encoding: 'utf8' })
    assert.equal(valid.status, 0, valid.stdout + valid.stderr)
    await writeFile(filename, source.replace('start:0', 'start:"zero"'))
    const invalid = spawnSync(process.execPath, [compiler, ...argumentsFor], { cwd: root, encoding: 'utf8' })
    assert.notEqual(invalid.status, 0)
    assert.match(invalid.stdout + invalid.stderr, /TS2322/)
  }
  finally {
    await rm(scratch, { recursive: true, force: true })
  }
})
