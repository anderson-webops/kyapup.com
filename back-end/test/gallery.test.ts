import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import request from 'supertest'
import sharp from 'sharp'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { hashPassword, Sessions, validPasswordHash, verifyPassword } from '../src/auth.js'
import { readGalleryConfig } from '../src/gallery-config.js'
import { PhotoStore } from '../src/photo-store.js'

const origin = 'https://kyapup.example'
const password = 'Synthetic test password only'
let passwordHash: string
let image: Buffer
const opened: PhotoStore[] = []
const directories: string[] = []

beforeAll(async () => {
  passwordHash = await hashPassword(password)
  image = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#ca8e61' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer()
})
afterEach(async () => {
  opened.splice(0).forEach(store => store.close())
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function fixture(prefix = 'kya-test-') {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  directories.push(directory)
  const store = new PhotoStore(directory)
  opened.push(store)
  const app = createApp({ store, passwordHash, allowedOrigins: [origin, 'https://kyagirl.example'], secureCookies: false })
  const client = request.agent(app)
  const login = await client.post('/api/admin/login').set('Origin', origin).send({ password }).expect(200)
  const csrf = String(login.body.csrfToken)
  const upload = () => client.post('/api/admin/photos').set('Origin', origin).set('X-CSRF-Token', csrf)
    .set('Content-Type', 'application/octet-stream').send(image)
  const patchPhoto = (id: string, patch: object) => client.patch(`/api/admin/photos/${id}`)
    .set('Origin', origin).set('X-CSRF-Token', csrf).send(patch)
  const settings = (patch: object) => client.patch('/api/admin/settings')
    .set('Origin', origin).set('X-CSRF-Token', csrf).send(patch)
  return { directory, store, app, client, csrf, upload, patchPhoto, settings }
}

describe('Puppy gallery lifecycle', () => {
  it('keeps uploads in the private library until published, then archives them again', async () => {
    const f = await fixture()
    await request(f.app).get('/api/gallery').expect(200, { photos: [], settings: { mode: 'static', intervalSeconds: 8, heroPhotoId: null } })
    const uploaded = await f.upload().expect(201)
    const photo = uploaded.body
    expect(photo).toMatchObject({ visible: false, featured: false, alt: 'Kya', width: 32, height: 48 })
    expect(await readFile(join(f.directory, 'photos', photo.id, 'original'))).toEqual(image)
    expect((await request(f.app).get('/api/gallery')).body.photos).toEqual([])
    await request(f.app).get(photo.url).expect(404, { error: 'photo_not_found' })
    await f.client.get(photo.url).expect(200).expect('Cache-Control', 'no-store')
    await f.client.get(`/api/media/${photo.id}/original`).expect(404)
    await request(f.app).get(`/photos/${photo.id}/original`).expect(404)
    const metadata = await sharp(await readFile(join(f.directory, 'photos', photo.id, 'full.webp'))).metadata()
    expect(metadata.exif).toBeUndefined()
    expect(metadata.orientation).toBeUndefined()
    expect(metadata.format).toBe('webp')
    await f.patchPhoto(photo.id, { visible: true, featured: true, alt: 'Kya enjoying the sunshine', position: 2 }).expect(200)
    await f.settings({ mode: 'cycle', intervalSeconds: 12, heroPhotoId: photo.id }).expect(200)
    const publicGallery = await request(f.app).get('/api/gallery').expect(200)
    expect(publicGallery.body.photos).toHaveLength(1)
    expect(publicGallery.body.photos[0]).toMatchObject({ id: photo.id, alt: 'Kya enjoying the sunshine', visible: true, featured: true })
    expect(publicGallery.body.settings).toEqual({ mode: 'cycle', intervalSeconds: 12, heroPhotoId: photo.id })
    await request(f.app).get(photo.thumbnailUrl).expect(200).expect('Content-Type', /image\/webp/).expect('Cache-Control', 'no-store')
    await f.patchPhoto(photo.id, { visible: false }).expect(200)
    const library = await f.client.get('/api/admin/library').expect(200)
    expect(library.body.photos[0]).toMatchObject({ visible: false, featured: false })
    expect(library.body.settings.heroPhotoId).toBeNull()
    await request(f.app).get(photo.url).expect(404)
    await f.client.get(photo.url).expect(200)
  })

  it('serves allowed photo variants from a store with a dot-prefixed ancestor', async () => {
    const f = await fixture('.kya-test-')
    const photo = (await f.upload().expect(201)).body
    for (const url of [photo.url, photo.thumbnailUrl]) {
      await request(f.app).get(url).expect(404)
      await f.client.get(url).expect(200).expect('Content-Type', /image\/webp/)
    }
    await f.patchPhoto(photo.id, { visible: true }).expect(200)
    for (const url of [photo.url, photo.thumbnailUrl])
      await request(f.app).get(url).expect(200).expect('Cache-Control', 'no-store')
    await f.client.get(`/api/media/${photo.id}/original`).expect(404)
  })

  it('persists photos, order, and display settings across store restarts', async () => {
    const f = await fixture()
    const first = (await f.upload().expect(201)).body
    const second = (await f.upload().expect(201)).body
    await f.patchPhoto(first.id, { visible: true, featured: true, position: 9 }).expect(200)
    await f.patchPhoto(second.id, { visible: true, position: 0 }).expect(200)
    await f.settings({ heroPhotoId: first.id, mode: 'static', intervalSeconds: 35 }).expect(200)
    f.store.close()
    const reopened = new PhotoStore(f.directory)
    opened.push(reopened)
    const app = createApp({ store: reopened })
    const response = await request(app).get('/api/gallery').expect(200)
    expect(response.body.photos.map((photo: { id: string }) => photo.id)).toEqual([second.id, first.id])
    expect(response.body.settings).toEqual({ heroPhotoId: first.id, mode: 'static', intervalSeconds: 35 })
    await request(app).get(first.url).expect(200)
    await request(app).get('/api/admin/session').expect(200, { authenticated: false })
  })

  it('bounds derivative dimensions and preserves the exact original', async () => {
    const f = await fixture()
    const source = await sharp({ create: { width: 3100, height: 900, channels: 3, background: '#b09862' } }).png().toBuffer()
    const photo = await f.store.upload(source)
    const full = await sharp(await readFile(join(f.directory, 'photos', photo.id, 'full.webp'))).metadata()
    const thumb = await sharp(await readFile(join(f.directory, 'photos', photo.id, 'thumb.webp'))).metadata()
    expect(full.width).toBe(2600)
    expect(thumb.width).toBe(600)
    expect(await readFile(join(f.directory, 'photos', photo.id, 'original'))).toEqual(source)
  })

  it('accepts still PNG, WebP, and AVIF files and rejects oversized bodies', async () => {
    const f = await fixture()
    for (const format of ['png', 'webp', 'avif'] as const) {
      const source = await sharp({ create: { width: 12, height: 10, channels: 3, background: '#779966' } }).toFormat(format).toBuffer()
      const response = await f.client.post('/api/admin/photos').set('Origin', origin).set('X-CSRF-Token', f.csrf)
        .set('Content-Type', 'application/octet-stream').set('X-Filename', 'arbitrary-name.txt').send(source).expect(201)
      expect(response.body).toMatchObject({ visible: false, width: 12, height: 10 })
    }
    await f.client.post('/api/admin/photos').set('Origin', origin).set('X-CSRF-Token', f.csrf)
      .set('Content-Type', 'application/octet-stream').send(Buffer.alloc(25 * 1024 * 1024 + 1)).expect(413)
    expect(f.store.list()).toHaveLength(3)
  })

  it('cleans partial files after a failed database write and accepts a retry', async () => {
    const f = await fixture()
    const database = new DatabaseSync(join(f.directory, 'library.sqlite'))
    try {
      database.exec(`CREATE TRIGGER fixture_unavailable BEFORE INSERT ON photos BEGIN SELECT RAISE(ABORT, 'synthetic write failure'); END;`)
      await f.upload().expect(500, { error: 'internal_server_error' })
      expect(await readdir(join(f.directory, 'photos'))).toEqual([])
      expect(f.store.list()).toEqual([])
      database.exec('DROP TRIGGER fixture_unavailable')
      await f.upload().expect(201)
      expect(f.store.list()).toHaveLength(1)
    }
    finally { database.close() }
  })

  it('validates the display state and accepts only supported image content', async () => {
    const f = await fixture()
    const photo = (await f.upload().expect(201)).body
    await f.patchPhoto(photo.id, { featured: true }).expect(400, { error: 'featured_photo_must_be_visible' })
    await f.settings({ heroPhotoId: photo.id }).expect(400, { error: 'hero_photo_must_be_featured' })
    await f.settings({ intervalSeconds: 2 }).expect(400)
    await f.settings({ intervalSeconds: 3601 }).expect(400)
    await f.settings({ mode: 'other' }).expect(400)
    await f.patchPhoto(photo.id, { position: -1 }).expect(400)
    await f.patchPhoto(photo.id, { visible: 'true' }).expect(400)
    await f.patchPhoto(photo.id, { alt: 'a'.repeat(301) }).expect(400)
    await f.patchPhoto(photo.id, { unknown: true }).expect(400)
    await f.client.post('/api/admin/photos').set('Origin', origin).set('X-CSRF-Token', f.csrf)
      .set('Content-Type', 'application/octet-stream').send(Buffer.from('not a photo')).expect(400, { error: 'invalid_photo' })
    const heicHeader = Buffer.from('00000018667479706865696300000000686569636d696631', 'hex')
    await f.client.post('/api/admin/photos').set('Origin', origin).set('X-CSRF-Token', f.csrf)
      .set('Content-Type', 'application/octet-stream').send(heicHeader).expect(415, { error: 'unsupported_photo_type' })
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#999999' } }).gif().toBuffer()
    await f.client.post('/api/admin/photos').set('Origin', origin).set('X-CSRF-Token', f.csrf)
      .set('Content-Type', 'application/octet-stream').send(gif).expect(415, { error: 'unsupported_photo_type' })
    await f.client.post('/api/admin/photos').set('Origin', origin).set('X-CSRF-Token', f.csrf)
      .set('Content-Type', 'image/jpeg').send(image).expect(415, { error: 'upload_requires_octet_stream' })
    expect(f.store.list()).toHaveLength(1)
  })
})

describe('Admin authentication boundaries', () => {
  it('requires authentication, exact origins, and a per-session CSRF token', async () => {
    const f = await fixture()
    await request(f.app).get('/api/admin/library').expect(401)
    await request(f.app).post('/api/admin/photos').set('Content-Type', 'application/octet-stream').send(image).expect(401)
    await f.client.patch('/api/admin/settings').set('Origin', origin).send({ mode: 'cycle' }).expect(403, { error: 'invalid_csrf_token' })
    await f.client.patch('/api/admin/settings').set('Origin', 'https://unlisted.example').set('X-CSRF-Token', f.csrf)
      .send({ mode: 'cycle' }).expect(403, { error: 'origin_not_allowed' })
    await request(f.app).post('/api/admin/login').send({ password }).expect(403)
    await request(f.app).post('/api/admin/login').set('Origin', origin).send({ password: 'incorrect' }).expect(401)
    await request(f.app).post('/api/admin/login').set('Origin', 'https://kyagirl.example').send({ password }).expect(200)
    await f.client.get('/api/admin/session').expect(200, { authenticated: true, csrfToken: f.csrf })
    await f.client.post('/api/admin/logout').set('Origin', origin).set('X-CSRF-Token', f.csrf).expect(200, { authenticated: false })
    await f.client.get('/api/admin/library').expect(401)
    await f.client.get('/api/admin/session').expect(200, { authenticated: false })
  })

  it('rotates login sessions and scopes production cookies securely', async () => {
    const app = createApp({ passwordHash, allowedOrigins: [origin], secureCookies: true })
    const login = await request(app).post('/api/admin/login').set('Origin', origin).send({ password }).expect(200)
    const cookie = login.headers['set-cookie'][0]
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/api')
    const oldCookie = cookie.split(';')[0]
    const relogin = await request(app).post('/api/admin/login').set('Origin', origin).set('Cookie', oldCookie).send({ password }).expect(200)
    expect(relogin.body.csrfToken).not.toBe(login.body.csrfToken)
    await request(app).get('/api/admin/session').set('Cookie', oldCookie).expect(200, { authenticated: false })
  })

  it('clears stale and malformed admin cookies after expiry or a restart', async () => {
    const app = createApp()
    for (const cookie of ['kya_session=not-a-session', `kya_session=${'0'.repeat(64)}`]) {
      const response = await request(app).get('/api/admin/session').set('Cookie', cookie).expect(200, { authenticated: false })
      expect(response.headers['set-cookie'][0]).toContain('kya_session=;')
      expect(response.headers['set-cookie'][0]).toContain('Expires=Thu, 01 Jan 1970')
      const denied = await request(app).get('/api/admin/library').set('Cookie', cookie).expect(401)
      expect(denied.headers['set-cookie'][0]).toContain('kya_session=;')
    }
    const health = await request(app).get('/healthz').set('Cookie', 'kya_session=old').expect(200)
    expect(health.headers['set-cookie']).toBeUndefined()
  })

  it('rate-limits login attempts and leaves probes independent', async () => {
    const app = createApp({ passwordHash, allowedOrigins: [origin] })
    for (let attempt = 0; attempt < 10; attempt++)
      await request(app).post('/api/admin/login').set('Origin', origin).send({ password: '' }).expect(400)
    await request(app).post('/api/admin/login').set('Origin', origin).send({ password }).expect(429, { error: 'too_many_login_attempts' })
    await request(app).get('/api/health').expect(200, { ok: true })
  })

  it('fails readiness when the photo store is closed without changing liveness', async () => {
    const f = await fixture()
    await request(f.app).get('/readyz').expect(200, { ok: true })
    f.store.close()
    await request(f.app).get('/readyz').expect(503, { ok: false })
    await request(f.app).get('/api/gallery').expect(503, { error: 'gallery_unavailable' })
    await request(f.app).get('/healthz').expect(200, { ok: true })
  })

  it('has no default admin password and validates production configuration', async () => {
    const app = createApp({ allowedOrigins: [origin] })
    await request(app).post('/api/admin/login').set('Origin', origin).send({ password }).expect(503, { error: 'admin_not_configured' })
    expect(() => readGalleryConfig({ NODE_ENV: 'production' })).toThrow('ADMIN_PASSWORD_HASH')
    expect(() => readGalleryConfig({ NODE_ENV: 'production', ADMIN_PASSWORD_HASH: passwordHash })).toThrow('PHOTO_DATA_DIR')
    expect(() => readGalleryConfig({ NODE_ENV: 'production', ADMIN_PASSWORD_HASH: passwordHash, PHOTO_DATA_DIR: '/var/lib/kya' })).toThrow('ALLOWED_ORIGINS')
    expect(() => readGalleryConfig({ NODE_ENV: 'production', ADMIN_PASSWORD_HASH: passwordHash, PHOTO_DATA_DIR: '/var/lib/kya', ALLOWED_ORIGINS: 'http://kyapup.example' })).toThrow('HTTPS')
    expect(readGalleryConfig({ NODE_ENV: 'production', ADMIN_PASSWORD_HASH: passwordHash, PHOTO_DATA_DIR: '/var/lib/kya', ALLOWED_ORIGINS: `${origin},https://kyagirl.example` }).secureCookies).toBe(true)
    expect(validPasswordHash(passwordHash)).toBe(true)
    expect(await verifyPassword(password, passwordHash)).toBe(true)
    expect(await verifyPassword('different password', passwordHash)).toBe(false)
    const sessions = new Sessions(-1)
    expect(sessions.get(sessions.create().id)).toBeUndefined()
  })
})
