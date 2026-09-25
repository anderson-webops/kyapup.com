import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { scryptSync } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

assert.equal(process.platform, 'linux')
assert.equal(process.arch, 'arm64')
assert.equal(process.version, 'v24.18.1')
assert.equal(process.cwd(), '/app')
for (const absent of ['/home/builder', '/mnt/input', '/app/node_modules', '/app/back-end/src', '/app/.git'])
  await assert.rejects(access(absent))

if (process.argv[2] === 'missing-module') {
  const result = spawnSync(process.execPath, ['/app/back-end/dist/server.js'], {
    timeout: 5000,
    env: { NODE_ENV: 'production', DOTENV_CONFIG_PATH: '/absent', HOST: '127.0.0.1', PORT: '18767' },
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
  // Exercise dependency readiness independently, using only a temporary library.
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'kyapup-readiness-'))
  const { PhotoStore } = await import('/app/back-end/dist/photo-store.js')
  const store = new PhotoStore(dataDirectory)
  const salt = Buffer.alloc(16, 9)
  const key = scryptSync('Synthetic-readiness-password', salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const passwordHash = `scrypt$32768$8$1$${salt.toString('hex')}$${key.toString('hex')}`
  const { createApp } = await import('/app/back-end/dist/app.js')
  let ready = false
  const server = createServer(createApp({ store, passwordHash, allowedOrigins: ['https://kyapup.fixture'], secureCookies: true, isReady: () => ready }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    for (const value of [false, true, false, true]) {
      ready = value
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(`${origin}/readyz`, { method, signal: AbortSignal.timeout(2000) })
        assert.equal(response.status, value ? 200 : 503)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.equal(response.headers.get('set-cookie'), null)
        assert.equal(response.headers.get('location'), null)
        assert.equal(await response.text(), method === 'HEAD' ? '' : JSON.stringify({ ok: value }))
      }
    }
  }
  finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    store.close()
    await rm(dataDirectory, { recursive: true, force: true })
  }
  // Synthetic clock injection is a constructor-only test seam, never an HTTP or
  // production environment clock override. Exercise the exact compiled modules.
  const { SecondaryAuthenticator, readSecondaryConfig } = await import('/app/back-end/dist/secondary-auth.js')
  const authDirectory = await mkdtemp(path.join(os.tmpdir(), 'kyapup-auth-boundary-'))
  const activation = Date.parse('2026-12-24T10:00:00Z')
  const secondaryPassword = 'toy'
  const secondarySalt = Buffer.alloc(16, 23)
  const secondaryHash = `scrypt$32768$8$1$${secondarySalt.toString('hex')}$${scryptSync(secondaryPassword, secondarySalt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')}`
  const config = readSecondaryConfig({
    ADMIN_SECONDARY_PASSWORD_HASH: secondaryHash,
    ADMIN_SECONDARY_NOT_BEFORE: '2026-12-24T10:00:00Z',
    ADMIN_SECONDARY_FAILURE_LIMIT: '3',
    ADMIN_SECONDARY_FAILURE_WINDOW_SECONDS: '172800',
    ADMIN_SECONDARY_LOCKOUT_SECONDS: '172800',
    ADMIN_SECONDARY_STATE_MAX_ENTRIES: '10000',
    ADMIN_SECONDARY_STATE_PATH: path.join(authDirectory, 'login-state.sqlite'),
    ADMIN_SECONDARY_ID_HMAC_KEY: Buffer.alloc(32, 29).toString('hex'),
  })
  assert.equal(config.mode, 'enabled')
  let now = activation - 1
  let auth = new SecondaryAuthenticator(config, () => now)
  try {
    assert.equal((await auth.authenticate(secondaryPassword, '192.0.2.10')).status, 'incorrect')
    now = activation
    assert.equal((await auth.authenticate(secondaryPassword, '192.0.2.10')).status, 'authenticated')
    now++
    assert.equal((await auth.authenticate(secondaryPassword, '192.0.2.10')).status, 'authenticated')
    const concurrent = await Promise.all(Array.from({ length: 3 }, () => auth.authenticate('synthetic wrong', '192.0.2.20')))
    assert.deepEqual(concurrent.map(result => result.status).sort(), ['incorrect', 'incorrect', 'locked'])
    assert.equal((await auth.authenticate(secondaryPassword, '::ffff:192.0.2.20')).status, 'locked')
    assert.equal((await auth.authenticate('synthetic wrong', '2001:db8:1:2::10')).status, 'incorrect')
    assert.equal((await auth.authenticate('synthetic wrong', '2001:db8:1:2::11')).status, 'incorrect')
    assert.equal((await auth.authenticate('synthetic wrong', '2001:db8:1:2::12')).status, 'locked')
    auth.close()
    auth = new SecondaryAuthenticator(config, () => now)
    now = activation + 172_800_000
    assert.equal((await auth.authenticate(secondaryPassword, '2001:db8:1:2::99')).status, 'locked')
    now++
    assert.equal((await auth.authenticate(secondaryPassword, '2001:db8:1:2::99')).status, 'authenticated')
  }
  finally {
    auth.close()
    await rm(authDirectory, { recursive: true, force: true })
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
  console.log(JSON.stringify({ sterileArtifact: 'passed', commit: manifest.commit, readinessRecovery: true, photoProcessing: true, archiveAuthentication: true, scopedMachineImports: true, persistentImportIdentity: true, secondaryActivationBoundary: true, concurrentSecondaryFailures: true, secondaryLockoutExpiryAndRestart: true, persistence: true, restart: true }))
}
