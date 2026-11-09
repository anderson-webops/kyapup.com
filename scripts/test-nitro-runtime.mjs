import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { build, createNitro } from 'nitropack'
import { addBytes, root } from './fixtures/nitro-tools.mjs'

async function inventory(directory, prefix = '') {
  const result = {}
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false)
    const name = path.join(prefix, entry.name)
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory())
      Object.assign(result, await inventory(filename, name))
    else
      result[name] = createHash('sha256').update(await readFile(filename)).digest('hex')
  }
  return result
}

async function reservePort() {
  const server = net.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.equal(typeof address, 'object')
  await new Promise(resolve => server.close(resolve))
  return address.port
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null)
    return
  child.kill('SIGTERM')
  const outcome = await Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    delay(4000).then(() => false),
  ])
  if (!outcome) {
    child.kill('SIGKILL')
    await new Promise(resolve => child.once('exit', resolve))
    assert.fail('The isolated Nitro runtime failed graceful shutdown')
  }
  assert.ok(child.exitCode === 0 || child.signalCode === 'SIGTERM')
}

test('exact copied Nitro runtime preserves concurrent request contexts, WASM, failure recovery and restart', { timeout: 90_000 }, async () => {
  const parent = path.join(root, '.ai-work/runs')
  await mkdir(parent, { recursive: true })
  const scratch = await mkdtemp(path.join(parent, 'nitro-server-'))
  const source = path.join(scratch, 'source')
  const output = path.join(source, '.output')
  const runtime = path.join(scratch, 'copied-runtime')
  const proof = path.join(scratch, 'runtime-proof.mjs')
  let nitro
  let child
  try {
    const nitroParent = createRequire(import.meta.resolve('nitropack'))
    const h3Metadata = JSON.parse(await readFile(nitroParent.resolve('h3/package.json'), 'utf8'))
    assert.equal(h3Metadata.version, '1.15.11')
    const h3Entry = path.join(path.dirname(nitroParent.resolve('h3')), 'index.mjs')
    await mkdir(path.join(source, 'routes'), { recursive: true })
    await writeFile(path.join(source, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    await writeFile(path.join(source, 'fixture.wasm'), addBytes)
    await writeFile(path.join(source, 'routes/health.get.ts'), 'import {defineEventHandler,setHeader} from "h3";export default defineEventHandler(event=>{setHeader(event,"cache-control","no-store");return {ok:true}})')
    await writeFile(path.join(source, 'routes/compute.get.ts'), 'import {defineEventHandler,getQuery,createError} from "h3";import {useEvent} from "nitropack/runtime";import {add} from "../fixture.wasm";export default defineEventHandler(async event=>{const id=String(getQuery(event).id);event.context.id=id;const initial=useEvent();await new Promise(resolve=>setTimeout(resolve,id.length%5+1));if(id==="failure")throw createError({statusCode:409,statusMessage:"Fixture failure"});return {before:initial.context.id,after:useEvent().context.id,same:initial===event&&useEvent()===event,answer:await add(40,2)}})')
    nitro = await createNitro({
      rootDir: source,
      srcDir: source,
      scanDirs: [source],
      buildDir: path.join(source, '.nitro'),
      output: { dir: output },
      preset: 'node-server',
      alias: { h3: h3Entry },
      compatibilityDate: '2026-11-08',
      dev: false,
      dotenv: false,
      logLevel: 0,
      noExternals: true,
      experimental: { asyncContext: true, wasm: true },
      wasm: {},
    })
    await build(nitro)
    await nitro.close()
    nitro = undefined
    const original = await inventory(output)
    assert.ok(original['server/index.mjs'])
    await cp(output, runtime, { recursive: true, verbatimSymlinks: true })
    assert.deepEqual(await inventory(runtime), original)
    await rm(source, { recursive: true })
    await writeFile(proof, `import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';for(const filename of ${JSON.stringify([
      path.join(root, 'package.json'),
      path.join(root, 'node_modules/unctx/package.json'),
    ])})assert.throws(()=>readFileSync(filename),{code:'ERR_ACCESS_DENIED'});console.log('runtime-source-and-dependency-reads-denied');`)
    for (const round of [0, 1]) {
      const port = await reservePort()
      const origin = `http://127.0.0.1:${port}`
      let diagnostics = ''
      child = spawn(process.execPath, [
        '--permission',
        `--allow-fs-read=${runtime}`,
        `--allow-fs-read=${proof}`,
        '--allow-net',
        '--import',
        pathToFileURL(proof).href,
        path.join(runtime, 'server/index.mjs'),
      ], {
        cwd: runtime,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'production',
          NITRO_HOST: '127.0.0.1',
          NITRO_PORT: String(port),
          NITRO_SHUTDOWN_TIMEOUT: '2000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', chunk => diagnostics = `${diagnostics}${chunk}`.slice(-12_000))
      const deadline = Date.now() + 12_000
      let healthy = false
      while (Date.now() < deadline) {
        assert.ok(child.exitCode === null && child.signalCode === null, diagnostics)
        try {
          const response = await fetch(`${origin}/health`, {
            signal: AbortSignal.timeout(1000),
          })
          if (response.status === 200) {
            assert.deepEqual(await response.json(), { ok: true })
            healthy = true
            break
          }
        }
        catch {}
        await delay(40)
      }
      assert.ok(healthy, diagnostics)
      assert.match(diagnostics, /runtime-source-and-dependency-reads-denied/)
      await Promise.all(Array.from({ length: 64 }, async (_unused, index) => {
        const id = `fixture-${round}-${index}`
        const response = await fetch(`${origin}/compute?id=${id}`, {
          signal: AbortSignal.timeout(5000),
        })
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), {
          before: id,
          after: id,
          same: true,
          answer: 42,
        })
      }))
      const failed = await fetch(`${origin}/compute?id=failure`, {
        signal: AbortSignal.timeout(5000),
      })
      assert.equal(failed.status, 409)
      await failed.arrayBuffer()
      const recovered = await fetch(`${origin}/compute?id=recovered-${round}`, {
        signal: AbortSignal.timeout(5000),
      })
      assert.deepEqual(await recovered.json(), {
        before: `recovered-${round}`,
        after: `recovered-${round}`,
        same: true,
        answer: 42,
      })
      await stop(child)
      child = undefined
      assert.deepEqual(await inventory(runtime), original)
    }
  }
  finally {
    await stop(child)
    await nitro?.close()
    await rm(scratch, { recursive: true, force: true })
  }
})
