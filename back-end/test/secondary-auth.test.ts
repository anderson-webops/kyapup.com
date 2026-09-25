import { createHash, createHmac, scryptSync } from 'node:crypto'
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import sharp from 'sharp'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import * as auth from '../src/auth.js'
import { readGalleryConfig } from '../src/gallery-config.js'
import { PhotoStore } from '../src/photo-store.js'
import { readSecondaryConfig, SecondaryAuthenticator, secondaryNetworkIdentity } from '../src/secondary-auth.js'
import type { SecondaryConfiguration, SecondaryEnvironment } from '../src/secondary-auth.js'

const origin = 'https://kyapup.example'
const primaryPassword = 'Synthetic primary password only'
const secondaryPassword = 'kya-fixture'
const address = '198.51.100.34'
const activation = Date.parse('2026-12-24T10:00:00.000Z')
const identityKey = Buffer.alloc(32, 7)
const importToken = 'synthetic-import-fixture-'.padEnd(43, 'x')
const importTokenHash = createHash('sha256').update(importToken).digest('hex')
let primaryHash: string
let secondaryHash: string
let image: Buffer
const directories: string[] = []
const authenticators: SecondaryAuthenticator[] = []
const stores: PhotoStore[] = []

beforeAll(async () => {
  primaryHash = await auth.hashPassword(primaryPassword)
  // The primary password helper intentionally retains its 12-character minimum.
  const salt = Buffer.alloc(16, 9)
  const key = scryptSync(secondaryPassword, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  secondaryHash = `scrypt$32768$8$1$${salt.toString('hex')}$${key.toString('hex')}`
  image = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#ca8e61' } }).png().toBuffer()
})

afterEach(async () => {
  vi.restoreAllMocks()
  authenticators.splice(0).forEach(authenticator => authenticator.close())
  stores.splice(0).forEach(store => store.close())
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function environment(): SecondaryEnvironment {
  return {
    ADMIN_SECONDARY_PASSWORD_HASH: secondaryHash,
    ADMIN_SECONDARY_NOT_BEFORE: new Date(activation).toISOString(),
    ADMIN_SECONDARY_FAILURE_LIMIT: '3',
    ADMIN_SECONDARY_FAILURE_WINDOW_SECONDS: '172800',
    ADMIN_SECONDARY_LOCKOUT_SECONDS: '172800',
    ADMIN_SECONDARY_STATE_MAX_ENTRIES: '10000',
    ADMIN_SECONDARY_STATE_PATH: '/var/lib/kyapup/secondary.sqlite',
    ADMIN_SECONDARY_ID_HMAC_KEY: identityKey.toString('hex'),
  }
}

async function fixture(options: {
  trustProxyHops?: number
  config?: SecondaryConfiguration
  maxEntries?: number
  clock?: () => number
  missingParent?: boolean
} = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'kya-secondary-auth-')))
  directories.push(directory)
  await chmod(directory, 0o700)
  const config: SecondaryConfiguration = options.config ?? {
    mode: 'enabled', passwordHash: secondaryHash, notBefore: activation,
    failureLimit: 3, failureWindowMs: 172_800_000, lockoutMs: 172_800_000,
    maxEntries: options.maxEntries ?? 10_000, identityKey,
    statePath: join(directory, ...(options.missingParent ? ['missing'] : []), 'secondary.sqlite'),
  }
  const secondary = new SecondaryAuthenticator(config, options.clock ?? (() => activation))
  authenticators.push(secondary)
  const store = new PhotoStore(join(directory, 'gallery'))
  stores.push(store)
  const app = createApp({
    store, passwordHash: primaryHash, secondaryAuth: secondary,
    allowedOrigins: [origin], trustProxyHops: options.trustProxyHops ?? 1,
    secureCookies: true, importTokenHash,
  })
  return { app, secondary, store }
}

function login(app: ReturnType<typeof createApp>, password = secondaryPassword, forwarded: string | null = address) {
  const call = request(app).post('/api/admin/login').set('Origin', origin)
  if (forwarded !== null) call.set('X-Forwarded-For', forwarded)
  return call.send({ password })
}

function cookie(response: { headers: Record<string, unknown> }) {
  return (response.headers['set-cookie'] as string[])[0].split(';')[0]
}

describe('Secondary authentication configuration and identities', () => {
  it('is disabled only when all settings are absent and requires every configured setting', () => {
    expect(readSecondaryConfig({})).toEqual({ mode: 'disabled' })
    expect(readSecondaryConfig({ ADMIN_SECONDARY_PASSWORD_HASH: '' })).toEqual({ mode: 'disabled' })
    expect(readSecondaryConfig(environment())).toMatchObject({
      mode: 'enabled', notBefore: activation, failureLimit: 3, failureWindowMs: 172_800_000,
      lockoutMs: 172_800_000, maxEntries: 10_000, identityKey,
    })
    for (const key of Object.keys(environment()) as Array<keyof SecondaryEnvironment>) {
      const partial = environment()
      delete partial[key]
      expect(readSecondaryConfig(partial), key).toEqual({ mode: 'unavailable' })
    }
    expect(readGalleryConfig({ ADMIN_PASSWORD_HASH: primaryHash, ADMIN_SECONDARY_FAILURE_LIMIT: '3' }))
      .toMatchObject({ passwordHash: primaryHash, secondaryConfig: { mode: 'unavailable' } })
    expect(readGalleryConfig({ ...environment(), ADMIN_PASSWORD_HASH: primaryHash,
      PHOTO_DATA_DIR: '/var/lib/kyapup', ADMIN_SECONDARY_STATE_PATH: '/var/lib/kyapup/auth/login-state.sqlite' }))
      .toMatchObject({ passwordHash: primaryHash, secondaryConfig: { mode: 'unavailable' } })
    expect(readGalleryConfig({ ...environment(), ADMIN_PASSWORD_HASH: primaryHash,
      PHOTO_DATA_DIR: '/var/lib/kyapup', ADMIN_SECONDARY_STATE_PATH: '/var/lib/kyapup-auth/login-state.sqlite' }))
      .toMatchObject({ passwordHash: primaryHash, secondaryConfig: { mode: 'enabled' } })
  })

  it('rejects malformed configuration without weakening primary password creation', async () => {
    const invalid: Partial<SecondaryEnvironment>[] = [
      { ADMIN_SECONDARY_PASSWORD_HASH: 'not-a-hash' },
      { ADMIN_SECONDARY_NOT_BEFORE: '2026-12-24T10:00:00+00:00' },
      { ADMIN_SECONDARY_NOT_BEFORE: '2026-02-30T12:00:00Z' },
      { ADMIN_SECONDARY_FAILURE_LIMIT: '4' },
      { ADMIN_SECONDARY_FAILURE_WINDOW_SECONDS: '172799' },
      { ADMIN_SECONDARY_LOCKOUT_SECONDS: '172801' },
      { ADMIN_SECONDARY_STATE_MAX_ENTRIES: '10001' },
      { ADMIN_SECONDARY_STATE_MAX_ENTRIES: '0' },
      { ADMIN_SECONDARY_STATE_MAX_ENTRIES: '01' },
      { ADMIN_SECONDARY_STATE_PATH: 'relative/state.sqlite' },
      { ADMIN_SECONDARY_STATE_PATH: '/var/lib/kyapup/../state.sqlite' },
      { ADMIN_SECONDARY_ID_HMAC_KEY: 'too-short' },
    ]
    for (const patch of invalid)
      expect(readSecondaryConfig({ ...environment(), ...patch })).toEqual({ mode: 'unavailable' })
    expect(readSecondaryConfig({ ...environment(), ADMIN_SECONDARY_NOT_BEFORE: '2026-12-24T10:00:00Z',
      ADMIN_SECONDARY_ID_HMAC_KEY: identityKey.toString('base64url') })).toMatchObject({ mode: 'enabled', identityKey })
    await expect(auth.hashPassword(secondaryPassword)).rejects.toThrow('between 12 and 1024')
    expect(auth.validPasswordHash(secondaryHash)).toBe(true)
  })

  it('uses IPv4 /32 and IPv6 /64 identities and normalizes mapped IPv6 addresses', () => {
    const identity = (value: string | undefined) => secondaryNetworkIdentity(value, identityKey)
    const expectedV4 = createHmac('sha256', identityKey).update(`v4:${address}/32`).digest('hex')
    expect(identity(address)).toBe(expectedV4)
    expect(identity('::ffff:198.51.100.34')).toBe(expectedV4)
    expect(identity('0:0:0:0:0:FFFF:C633:6422')).toBe(expectedV4)
    expect(identity('198.51.100.35')).not.toBe(expectedV4)
    const expectedV6 = createHmac('sha256', identityKey).update('v6:20010db8abcd0012/64').digest('hex')
    expect(identity('2001:db8:abcd:12::1')).toBe(expectedV6)
    expect(identity('2001:0DB8:ABCD:0012:ffff:eeee:dddd:cccc')).toBe(expectedV6)
    expect(identity('2001:db8:abcd:13::1')).not.toBe(expectedV6)
    expect(secondaryNetworkIdentity(address, Buffer.alloc(32, 8))).not.toBe(expectedV4)
    for (const invalid of [undefined, '', 'not-an-ip', '198.51.100.34, 198.51.100.35', 'fe80::1%en0'])
      expect(identity(invalid)).toBeUndefined()
  })
})

describe('Secondary authentication decisions', () => {
  it('activates exactly at the configured instant and does no early hashing', async () => {
    let now = activation - 1
    const f = await fixture({ clock: () => now })
    const verify = vi.spyOn(auth, 'verifyPassword')
    expect(await f.secondary.authenticate(secondaryPassword, address)).toEqual({ status: 'incorrect' })
    expect(verify).not.toHaveBeenCalled()
    now = activation
    expect(await f.secondary.authenticate(secondaryPassword, address)).toEqual({ status: 'authenticated' })
    now++
    expect(await f.secondary.authenticate(secondaryPassword, address)).toEqual({ status: 'authenticated' })
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('rechecks activation after hashing without recording a premature decision', async () => {
    let now = activation
    const f = await fixture({ clock: () => now })
    let finish!: (matched: boolean) => void
    const verify = vi.spyOn(auth, 'verifyPassword').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = f.secondary.authenticate('wrong fixture password', address)
    expect(verify).toHaveBeenCalledOnce()
    now--
    finish(false)
    expect(await pending).toEqual({ status: 'incorrect' })
    verify.mockRestore()
    now = activation
    expect(await f.secondary.authenticate('wrong fixture password', address)).toEqual({ status: 'incorrect' })
    expect(await f.secondary.authenticate('wrong fixture password', address)).toEqual({ status: 'incorrect' })
    expect(await f.secondary.authenticate(secondaryPassword, address)).toEqual({ status: 'authenticated' })
  })

  it('clears successful unblocked counters, while the third failure starts a 48-hour lock', async () => {
    const f = await fixture()
    for (let attempt = 0; attempt < 2; attempt++)
      expect(await f.secondary.authenticate('wrong fixture password', address)).toEqual({ status: 'incorrect' })
    expect(await f.secondary.authenticate(secondaryPassword, address)).toEqual({ status: 'authenticated' })
    for (let attempt = 0; attempt < 2; attempt++)
      expect(await f.secondary.authenticate('wrong fixture password', address)).toEqual({ status: 'incorrect' })
    expect(await f.secondary.authenticate('wrong fixture password', address)).toEqual({ status: 'locked', retryAfterSeconds: 172_800 })
    const verify = vi.spyOn(auth, 'verifyPassword')
    expect(await f.secondary.authenticate(secondaryPassword, address)).toEqual({ status: 'locked', retryAfterSeconds: 172_800 })
    expect(verify).not.toHaveBeenCalled()
  })
})

describe('Secondary browser login integration', () => {
  it('checks primary first and preserves a secondary lockout during primary recovery', async () => {
    const f = await fixture()
    for (let attempt = 0; attempt < 3; attempt++) await f.secondary.authenticate('wrong fixture password', address)
    const secondaryAttempt = vi.spyOn(f.secondary, 'authenticate')
    const recovery = await login(f.app, primaryPassword).expect(200)
    expect(secondaryAttempt).not.toHaveBeenCalled()
    expect(recovery.body.authenticated).toBe(true)
    await login(f.app).expect(429, { error: 'secondary_login_locked' }).expect('Retry-After', '172800')
    await request(f.app).get('/api/admin/session').set('Cookie', cookie(recovery)).expect(200, recovery.body)
  })

  it.each([
    { name: 'missing forwarding', trustProxyHops: 1, forwarded: null },
    { name: 'multiple forwarding entries', trustProxyHops: 1, forwarded: `${address}, 127.0.0.1` },
    { name: 'no trusted proxy', trustProxyHops: 0, forwarded: address },
    { name: 'too many trusted hops', trustProxyHops: 2, forwarded: address },
  ])('rejects secondary login with $name while primary still works', async ({ trustProxyHops, forwarded }) => {
    const f = await fixture({ trustProxyHops })
    const secondaryAttempt = vi.spyOn(f.secondary, 'authenticate')
    await login(f.app, secondaryPassword, forwarded).expect(503, { error: 'secondary_login_unavailable' })
    expect(secondaryAttempt).not.toHaveBeenCalled()
    await login(f.app, primaryPassword, forwarded).expect(200)
    expect(secondaryAttempt).not.toHaveBeenCalled()
  })

  it('preserves primary login with unavailable configuration, missing storage, closed storage, or capacity exhaustion', async () => {
    for (const options of [{ config: { mode: 'unavailable' } as const }, { missingParent: true }]) {
      const f = await fixture(options)
      await login(f.app).expect(503, { error: 'secondary_login_unavailable' })
      await login(f.app, primaryPassword).expect(200)
    }
    const closed = await fixture()
    closed.secondary.close()
    await login(closed.app).expect(503, { error: 'secondary_login_unavailable' })
    await login(closed.app, primaryPassword).expect(200)
    const full = await fixture({ maxEntries: 1 })
    expect(await full.secondary.authenticate('wrong fixture password', '198.51.100.35')).toEqual({ status: 'incorrect' })
    await login(full.app).expect(503, { error: 'secondary_login_unavailable' })
    await login(full.app, primaryPassword).expect(200)
  })

  it('retains secure rotating sessions, CSRF, logout, and private-photo/import boundaries', async () => {
    const f = await fixture()
    const photo = await f.store.upload(image)
    const first = await login(f.app).expect(200)
    const setCookie = first.headers['set-cookie'][0]
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api']) expect(setCookie).toContain(attribute)
    const firstCookie = cookie(first)
    await request(f.app).get('/api/admin/library').set('Cookie', firstCookie).expect(200)
    await request(f.app).get(photo.url).expect(404)
    await request(f.app).get(photo.url).set('Cookie', firstCookie).expect(200).expect('Cache-Control', 'no-store')
    await request(f.app).patch('/api/admin/settings').set('Cookie', firstCookie).set('Origin', origin)
      .send({ mode: 'cycle' }).expect(403, { error: 'invalid_csrf_token' })
    await request(f.app).patch('/api/admin/settings').set('Cookie', firstCookie).set('Origin', 'https://unlisted.example')
      .set('X-CSRF-Token', first.body.csrfToken).send({ mode: 'cycle' }).expect(403, { error: 'origin_not_allowed' })
    await request(f.app).patch('/api/admin/settings').set('Cookie', firstCookie).set('Origin', origin)
      .set('X-CSRF-Token', first.body.csrfToken).send({ mode: 'cycle' }).expect(200)
    const second = await login(f.app).set('Cookie', firstCookie).expect(200)
    expect(second.body.csrfToken).not.toBe(first.body.csrfToken)
    expect(cookie(second)).not.toBe(firstCookie)
    await request(f.app).get('/api/admin/session').set('Cookie', firstCookie).expect(200, { authenticated: false })
    const secondCookie = cookie(second)
    await request(f.app).post('/api/admin/logout').set('Cookie', secondCookie).set('Origin', origin)
      .set('X-CSRF-Token', first.body.csrfToken).expect(403)
    await request(f.app).get('/api/import/status?source=apple-photos&externalId=synthetic-fixture')
      .set('Cookie', secondCookie).expect(401, { error: 'import_authentication_required' })
    await request(f.app).get('/api/import/status?source=apple-photos&externalId=synthetic-fixture')
      .set('Authorization', `Bearer ${importToken}`).expect(200, { exists: false })
    await request(f.app).get('/api/admin/library').set('Authorization', `Bearer ${importToken}`).expect(401)
    await request(f.app).get(photo.url).set('Authorization', `Bearer ${importToken}`).expect(404)
    await request(f.app).post('/api/admin/logout').set('Cookie', secondCookie).set('Origin', origin)
      .set('X-CSRF-Token', second.body.csrfToken).expect(200, { authenticated: false })
    await request(f.app).get('/api/admin/library').set('Cookie', secondCookie).expect(401)
    await request(f.app).get(photo.url).set('Cookie', secondCookie).expect(404)
  })

  it('rejects a wrong origin before any hash work or secondary state access', async () => {
    const f = await fixture()
    const verify = vi.spyOn(auth, 'verifyPassword')
    const secondaryAttempt = vi.spyOn(f.secondary, 'authenticate')
    await request(f.app).post('/api/admin/login').set('Origin', 'https://unlisted.example')
      .set('X-Forwarded-For', address).send({ password: secondaryPassword }).expect(403, { error: 'origin_not_allowed' })
    expect(verify).not.toHaveBeenCalled()
    expect(secondaryAttempt).not.toHaveBeenCalled()
  })

  it('admits only two simultaneous password jobs and immediately rejects excess work without a queue', async () => {
    const f = await fixture()
    const releases: Array<(matched: boolean) => void> = []
    let admitted!: () => void
    const bothHashing = new Promise<void>(resolve => { admitted = resolve })
    const verify = vi.spyOn(auth, 'verifyPassword').mockImplementation((_password, hash) => {
      if (hash === primaryHash) return Promise.resolve(false)
      return new Promise<boolean>((resolve) => {
        releases.push(resolve)
        if (releases.length === 2) admitted()
      })
    })
    const first = login(f.app, secondaryPassword, '198.51.100.34').then(response => response)
    const second = login(f.app, secondaryPassword, '198.51.100.35').then(response => response)
    try {
      await Promise.race([
        bothHashing,
        first.then(() => { throw new Error('First login completed before both hashes were admitted') }),
        second.then(() => { throw new Error('Second login completed before both hashes were admitted') }),
      ])
      expect(verify).toHaveBeenCalledTimes(4)
      await login(f.app, secondaryPassword, '198.51.100.36').expect(429, { error: 'login_busy' }).expect('Retry-After', '1')
      expect(verify).toHaveBeenCalledTimes(4)
    }
    finally { releases.forEach(resolve => resolve(true)) }
    expect((await first).status).toBe(200)
    expect((await second).status).toBe(200)
    verify.mockRestore()
    await login(f.app, primaryPassword).expect(200)
  })
})
