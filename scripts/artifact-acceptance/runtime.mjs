import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import process from 'node:process'
import { Readable } from 'node:stream'

assert.equal(process.platform, 'linux')
assert.equal(process.arch, 'arm64')
assert.equal(process.version, 'v26.13.0')
assert.equal(process.cwd(), '/app')
for (const absent of [
  '/home/builder',
  '/mnt/input',
  '/app/node_modules',
  '/app/back-end/src',
  '/app/.git',
])
  await assert.rejects(access(absent))

if (process.argv[2] === 'missing-module') {
  const result = spawnSync(process.execPath, ['/app/back-end/dist/server.js'], {
    timeout: 5000,
    env: {
      NODE_ENV: 'production',
      DOTENV_CONFIG_PATH: '/absent',
      HOST: '127.0.0.1',
      PORT: '18767',
    },
    encoding: 'utf8',
  })
  assert.equal(result.signal, null)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/)
  assert.match(result.stderr, /boundedRateStore/)
  console.log(JSON.stringify({ missingRuntimeModule: 'rejected by compiled entrypoint' }))
}
else {
  const metadata = JSON.parse(await readFile('/app/front-end/.output/public/release.json', 'utf8'))
  const manifest = JSON.parse(await readFile('/app/runtime-manifest.json', 'utf8'))
  assert.equal(metadata.commitSha, manifest.commit)
  const runtimeRequire = createRequire('/app/back-end/package.json')
  const expressRequire = createRequire(runtimeRequire.resolve('express'))
  const bodyParserRequire = createRequire(expressRequire.resolve('body-parser'))
  const cookie = expressRequire('cookie')
  const encodeUrl = expressRequire('encodeurl')
  const getRawBody = bodyParserRequire('raw-body')
  const typeIs = bodyParserRequire('type-is')
  assert.equal(cookie.serialize('runtime', 'value /', { httpOnly: true, sameSite: 'strict' }), 'runtime=value%20%2F; HttpOnly; SameSite=Strict')
  assert.equal(encodeUrl('/runtime path'), '/runtime%20path')
  assert.equal(typeIs({
    headers: { 'content-type': 'application/problem+json', 'content-length': '1' },
  }, '+json'), 'application/problem+json')
  assert.equal(await getRawBody(Readable.from([
    Buffer.from([118, 0, 0, 0]),
  ]), { encoding: 'utf-32le' }), 'v')
  await assert.rejects(getRawBody(Readable.from([
    Buffer.alloc(3),
  ]), { limit: 2 }), { status: 413, type: 'entity.too.large' })
  // Dependencies added by a downstream must feed this bounded readiness state.
  // The baseline API itself has no external database or provider.
  const { createApp } = await import('/app/back-end/dist/app.js')
  let ready = false
  const server = createServer(createApp({
    isReady: () => ready,
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    for (const value of [false, true, false, true]) {
      ready = value
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${origin}/readyz`, {
          method,
          signal: AbortSignal.timeout(2000),
        })
        assert.equal(response.status, value ? 200 : 503)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.equal(response.headers.get('set-cookie'), null)
        assert.equal(response.headers.get('location'), null)
        assert.equal(await response.text(), method === 'HEAD'
          ? ''
          : JSON.stringify({ ok: value }))
      }
    }
  }
  finally {
    await new Promise((resolve, reject) => server.close(error => error
      ? reject(error)
      : resolve()))
  }
  for (let run = 0; run < 2; run++) {
    const result = spawnSync(process.execPath, ['/harness/direct-runtime-smoke.mjs', '/app'], {
      env: { PATH: '/runtime:/usr/bin:/bin' },
      stdio: 'inherit',
      timeout: 30000,
    })
    assert.equal(result.signal, null)
    assert.equal(result.status, 0)
  }
  console.log(JSON.stringify({
    sterileArtifact: 'passed',
    commit: manifest.commit,
    readinessRecovery: true,
    restart: true,
    modernHttpCompatibility: true,
  }))
}
