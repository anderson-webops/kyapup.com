#!/usr/bin/env node
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { scryptSync } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const repositoryRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dirname, '..')

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null
}

async function waitForExit(child, timeoutMs) {
  if (!isRunning(child))
    return true
  return new Promise((resolveExit) => {
    let timer
    const exited = () => {
      clearTimeout(timer)
      resolveExit(true)
    }
    timer = setTimeout(() => {
      child.off('exit', exited)
      resolveExit(false)
    }, timeoutMs)
    child.once('exit', exited)
  })
}

async function stopProcessTree(child) {
  if (!child.pid || !isRunning(child))
    return
  const target = process.platform === 'win32' ? child.pid : -child.pid
  try {
    process.kill(target, 'SIGTERM')
  }
  catch (error) {
    if (error?.code !== 'ESRCH')
      throw error
    return
  }
  if (!await waitForExit(child, 5_000)) {
    process.kill(target, 'SIGKILL')
    assert.ok(await waitForExit(child, 2_000), 'Fixture process must be reaped')
  }
}

async function waitForHealth(baseUrl, child, diagnostics) {
  const deadline = Date.now() + 20_000
  let lastError
  while (Date.now() < deadline) {
    if (!isRunning(child))
      throw new Error(`Direct API exited before health: ${diagnostics()}`)
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) })
      await response.arrayBuffer()
      if (response.ok)
        return
      lastError = new Error(`/api/health returned ${response.status}`)
    }
    catch (error) {
      lastError = error
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error(`Direct API did not become healthy: ${lastError?.message || 'unknown error'}; ${diagnostics()}`)
}

const port = await reservePort()
const baseUrl = `http://127.0.0.1:${port}`
const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'kyapup-runtime-'))
const password = 'Synthetic-gallery-password-only'
const salt = Buffer.alloc(16, 7)
const passwordHash = `scrypt$32768$8$1$${salt.toString('hex')}$${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')}`
const allowedOrigin = 'https://kyapup.fixture'
let diagnosticOutput = ''
function startRuntime() {
  diagnosticOutput = ''
  const child = spawn(process.execPath, ['back-end/dist/server.js'], {
    cwd: repositoryRoot,
    detached: process.platform !== 'win32',
    env: {
      PATH: process.env.PATH,
      DOTENV_CONFIG_PATH: path.join(dataDirectory, 'absent-environment'),
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      PORT: String(port),
      TRUST_PROXY_HOPS: '1',
      PHOTO_DATA_DIR: dataDirectory,
      ADMIN_PASSWORD_HASH: passwordHash,
      ALLOWED_ORIGINS: allowedOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (data) => {
      diagnosticOutput = `${diagnosticOutput}${data.toString()}`.slice(-4_000)
    })
  }
  return child
}
let child = startRuntime()
let cookie
let csrfToken
async function signIn() {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': allowedOrigin },
    body: JSON.stringify({ password }),
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.status, 200)
  const session = await response.json()
  assert.equal(session.authenticated, true)
  assert.equal(typeof session.csrfToken, 'string')
  csrfToken = session.csrfToken
  const sessionCookie = response.headers.get('set-cookie')
  assert.ok(sessionCookie?.includes('HttpOnly'))
  assert.ok(sessionCookie?.includes('Secure'))
  assert.ok(sessionCookie?.includes('SameSite=Strict'))
  cookie = sessionCookie.split(';')[0]
}
async function change(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'origin': allowedOrigin, cookie, 'x-csrf-token': csrfToken },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.status, 200)
  return response.json()
}

try {
  await waitForHealth(baseUrl, child, () => diagnosticOutput.trim())

  const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5_000) })
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { ok: true })
  assert.equal(health.headers.get('cache-control'), 'no-store')
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(health.headers.get('x-frame-options'), 'DENY')
  assert.equal(health.headers.get('x-powered-by'), null)

  const mutation = await fetch(`${baseUrl}/api/health`, {
    body: '{}',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(5_000),
  })
  assert.equal(mutation.status, 405)
  assert.deepEqual(await mutation.json(), { error: 'method_not_allowed' })

  const reserved = await fetch(`${baseUrl}/admin`, { signal: AbortSignal.timeout(5_000) })
  assert.equal(reserved.status, 404)
  assert.deepEqual(await reserved.json(), { error: 'not_found' })

  for (const route of ['/healthz', '/readyz', '/api/healthz', '/api/readyz']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`${baseUrl}${route}`, { method, signal: AbortSignal.timeout(2000), redirect: 'manual' })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('set-cookie'), null)
      assert.equal(response.headers.get('location'), null)
      if (method === 'GET')
        assert.deepEqual(await response.json(), { ok: true })
      else assert.equal(await response.text(), '')
    }
  }

  const unauthorizedLibrary = await fetch(`${baseUrl}/api/admin/library`)
  assert.equal(unauthorizedLibrary.status, 401)
  await unauthorizedLibrary.arrayBuffer()
  await signIn()
  const require = createRequire(path.join(repositoryRoot, 'back-end/package.json'))
  const sharp = require('sharp')
  const fixture = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#db9e63' } }).png().toBuffer()
  const upload = await fetch(`${baseUrl}/api/admin/photos`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'origin': allowedOrigin, cookie, 'x-csrf-token': csrfToken },
    body: fixture,
    signal: AbortSignal.timeout(10000),
  })
  assert.equal(upload.status, 201)
  const photo = await upload.json()
  assert.equal(typeof photo.id, 'string')
  assert.deepEqual(await readFile(path.join(dataDirectory, 'photos', photo.id, 'original')), fixture)
  const original = await fetch(`${baseUrl}/api/media/${photo.id}/original`, { headers: { cookie } })
  assert.equal(original.status, 404, 'Original uploads must never have a serving route')
  await original.arrayBuffer()
  const mediaUrl = `${baseUrl}/api/media/${photo.id}/full.webp`
  let media = await fetch(mediaUrl)
  assert.equal(media.status, 404, 'A new upload must remain private until selected')
  await media.arrayBuffer()
  media = await fetch(mediaUrl, { headers: { cookie } })
  assert.equal(media.status, 200)
  assert.match(media.headers.get('content-type'), /^image\/webp/)
  const rendered = await sharp(Buffer.from(await media.arrayBuffer())).metadata()
  assert.equal(rendered.format, 'webp')
  assert.equal(rendered.exif, undefined)
  await change(`/api/admin/photos/${photo.id}`, { visible: true, featured: true, alt: 'Synthetic runtime photo' })
  await change('/api/admin/settings', { mode: 'cycle', intervalSeconds: 7, heroPhotoId: photo.id })
  media = await fetch(mediaUrl)
  assert.equal(media.status, 200)
  assert.equal(media.headers.get('cache-control'), 'no-store')
  await media.arrayBuffer()
  let gallery = await (await fetch(`${baseUrl}/api/gallery`)).json()
  assert.equal(gallery.photos.length, 1)
  assert.equal(gallery.photos[0].id, photo.id)
  assert.equal(gallery.settings.mode, 'cycle')
  assert.equal(gallery.settings.intervalSeconds, 7)
  child.kill('SIGTERM')
  assert.ok(await waitForExit(child, 5000), 'The first runtime must shut down before restart')
  assert.equal(child.exitCode, 0, diagnosticOutput)
  child = startRuntime()
  await waitForHealth(baseUrl, child, () => diagnosticOutput.trim())
  gallery = await (await fetch(`${baseUrl}/api/gallery`)).json()
  assert.equal(gallery.photos.length, 1, 'Published photos must survive a process restart')
  assert.equal(gallery.photos[0].id, photo.id)
  assert.equal(gallery.settings.heroPhotoId, photo.id)
  media = await fetch(mediaUrl)
  assert.equal(media.status, 200, 'Rendered images must survive a process restart')
  await media.arrayBuffer()
  const expiredSession = await (await fetch(`${baseUrl}/api/admin/session`, { headers: { cookie } })).json()
  assert.equal(expiredSession.authenticated, false, 'A restart must invalidate process-local sessions')
  await signIn()
  await change(`/api/admin/photos/${photo.id}`, { visible: false })
  gallery = await (await fetch(`${baseUrl}/api/gallery`)).json()
  assert.equal(gallery.photos.length, 0)
  media = await fetch(mediaUrl)
  assert.equal(media.status, 404, 'Archiving must immediately prevent anonymous image access')
  await media.arrayBuffer()

  const pending = net.createConnection({ host: '127.0.0.1', port })
  try {
    await new Promise((resolveConnect, reject) => {
      pending.once('connect', resolveConnect)
      pending.once('error', reject)
    })
    pending.on('error', () => {})
    pending.write('GET /api/health HTTP/1.1\r\nHost: fixture.invalid\r\n')
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
    child.kill('SIGTERM')
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
    child.kill('SIGTERM')
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
    assert.ok(isRunning(child), 'Repeated TERM must not interrupt active HTTP draining')
    pending.destroy()
    assert.ok(await waitForExit(child, 2000), 'Closing the held connection must complete shutdown')
    assert.equal(child.exitCode, 0, diagnosticOutput)
    assert.equal(child.signalCode, null)
  }
  finally {
    pending.destroy()
  }

  console.log(JSON.stringify({ directRuntime: 'passed', loopback: true, probeMutations: 'denied', gallery: 'upload, publication, archive and persistence passed', probes: 'GET/HEAD passed', repeatedSignals: 'drained' }))
}
finally {
  await stopProcessTree(child)
  await rm(dataDirectory, { recursive: true, force: true })
}
