import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import request from 'supertest'
import sharp from 'sharp'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { hashPassword, verifyImportToken } from '../src/auth.js'
import { readGalleryConfig } from '../src/gallery-config.js'
import { PhotoStore } from '../src/photo-store.js'

// Deliberately synthetic credentials, used only with temporary test data.
const token = 'synthetic_import_fixture_credential_0123456789'
const tokenHash = createHash('sha256').update(token).digest('hex')
const authorization = `Bearer ${token}`
const identity = { source: 'apple-photos', externalId: 'A5E971CB-0421-42E0-A5B6-048CB92BB510/L0/001' }
const origin = 'https://kyapup.fixture'
const password = 'Synthetic owner fixture password'
let passwordHash: string
let image: Buffer
let editedImage: Buffer
const stores: PhotoStore[] = []
const directories: string[] = []

beforeAll(async () => {
  passwordHash = await hashPassword(password)
  image = await sharp({ create: { width: 15, height: 10, channels: 3, background: '#aa8866' } }).png().toBuffer()
  editedImage = await sharp({ create: { width: 12, height: 16, channels: 3, background: '#66aa88' } }).png().toBuffer()
})
afterEach(async () => {
  stores.splice(0).forEach(store => store.close())
  await Promise.all(directories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'kya-import-fixture-'))
  directories.push(directory)
  const store = new PhotoStore(directory)
  stores.push(store)
  const app = createApp({ store, importTokenHash: tokenHash, passwordHash, allowedOrigins: [origin], secureCookies: false })
  const upload = (bytes = image, externalId = identity.externalId) => request(app).post('/api/import/photos')
    .query({ source: identity.source, externalId }).set('Authorization', authorization)
    .set('Content-Type', 'application/octet-stream').send(bytes)
  return { directory, store, app, upload }
}

describe('Scoped machine imports', () => {
  it('is optional, rejects absent/incorrect credentials, and validates its configured digest', async () => {
    const disabled = createApp()
    await request(disabled).get('/api/import/status').query(identity).expect(503, { error: 'import_not_configured' })
    await request(disabled).post('/api/import/photos').query(identity).set('Authorization', authorization)
      .set('Content-Type', 'application/octet-stream').send(image).expect(503, { error: 'import_not_configured' })
    const f = await fixture()
    await request(f.app).get('/api/import/status').query(identity).expect(401, { error: 'import_authentication_required' })
    await request(f.app).get('/api/import/status').query(identity).set('Authorization', `Bearer ${'b'.repeat(43)}`)
      .expect(401, { error: 'import_authentication_required' })
    await request(f.app).post('/api/import/photos').query(identity).set('Content-Type', 'application/octet-stream')
      .send(image).expect(401, { error: 'import_authentication_required' })
    expect(verifyImportToken(authorization, tokenHash)).toBe(true)
    expect(verifyImportToken(`Basic ${token}`, tokenHash)).toBe(false)
    expect(verifyImportToken(authorization, 'invalid')).toBe(false)
    expect(readGalleryConfig({ PHOTO_IMPORT_TOKEN_SHA256: tokenHash.toUpperCase() }).importTokenHash).toBe(tokenHash)
    expect(readGalleryConfig({}).importTokenHash).toBe('')
    expect(() => readGalleryConfig({ PHOTO_IMPORT_TOKEN_SHA256: 'invalid' })).toThrow('PHOTO_IMPORT_TOKEN_SHA256')
  })

  it('imports into the archive without browser credentials and limits token access to import routes', async () => {
    const f = await fixture()
    await request(f.app).get('/api/import/status').query(identity).set('Authorization', authorization)
      .expect(200, { exists: false }).expect('Cache-Control', 'no-store')
    const response = await f.upload().expect(201)
    expect(response.body).toMatchObject({ created: true, photo: { visible: false, featured: false, alt: 'Kya' } })
    expect(response.headers['set-cookie']).toBeUndefined()
    const photo = response.body.photo
    await request(f.app).get('/api/import/status').query(identity).set('Authorization', authorization)
      .expect(200, { exists: true, photo })
    await request(f.app).get('/api/admin/library').set('Authorization', authorization).expect(401)
    await request(f.app).patch('/api/admin/settings').set('Authorization', authorization).send({ mode: 'cycle' }).expect(401)
    await request(f.app).patch(`/api/admin/photos/${photo.id}`).set('Authorization', authorization).send({ visible: true }).expect(401)
    await request(f.app).post('/api/admin/photos').set('Authorization', authorization)
      .set('Content-Type', 'application/octet-stream').send(image).expect(401)
    await request(f.app).get(photo.url).set('Authorization', authorization).expect(404)
    await request(f.app).get(photo.thumbnailUrl).set('Authorization', authorization).expect(404)
    expect((await request(f.app).get('/api/gallery')).body.photos).toEqual([])
    expect(await readFile(join(f.directory, 'photos', photo.id, 'original'))).toEqual(image)
  })

  it('keeps manual curation and first original bytes when a source asset is retried or edited', async () => {
    const f = await fixture()
    const first = (await f.upload().expect(201)).body.photo
    const owner = request.agent(f.app)
    const login = await owner.post('/api/admin/login').set('Origin', origin).send({ password }).expect(200)
    await owner.patch(`/api/admin/photos/${first.id}`).set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken)
      .send({ visible: true, featured: true, alt: 'Her favorite sunny spot', position: 17 }).expect(200)
    await owner.patch('/api/admin/settings').set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken)
      .send({ heroPhotoId: first.id, mode: 'cycle', intervalSeconds: 30 }).expect(200)
    const duplicate = await f.upload(editedImage).expect(200)
    expect(duplicate.body).toMatchObject({ created: false, photo: { id: first.id, visible: true, featured: true, alt: 'Her favorite sunny spot', position: 17 } })
    expect(f.store.settings()).toEqual({ heroPhotoId: first.id, mode: 'cycle', intervalSeconds: 30 })
    expect(await readFile(join(f.directory, 'photos', first.id, 'original'))).toEqual(image)
    const gallery = (await request(f.app).get('/api/gallery').expect(200)).body
    expect(JSON.stringify(gallery)).not.toContain(identity.externalId)
    expect(gallery.photos[0]).not.toHaveProperty('source')
    expect(gallery.photos[0]).not.toHaveProperty('contentSha256')
    // Cookie authentication alone never grants access to the machine integration.
    await owner.get('/api/import/status').query(identity).expect(401)
  })

  it('atomically deduplicates concurrent retries without leftover files', async () => {
    const f = await fixture()
    const responses = await Promise.all([f.upload(), f.upload()])
    expect(responses.map(response => response.status).sort()).toEqual([200, 201])
    expect(new Set(responses.map(response => response.body.photo.id)).size).toBe(1)
    expect(f.store.list()).toHaveLength(1)
    expect(await readdir(join(f.directory, 'photos'))).toEqual([responses[0].body.photo.id])
    const database = new DatabaseSync(join(f.directory, 'library.sqlite'))
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM photo_imports').get()?.count).toBe(1)
      expect(database.prepare('SELECT contentSha256 FROM photo_imports').get()?.contentSha256)
        .toBe(createHash('sha256').update(image).digest('hex'))
    }
    finally { database.close() }
  })

  it('retains source mappings and archive decisions after a restart', async () => {
    const f = await fixture()
    const photo = (await f.upload().expect(201)).body.photo
    f.store.updatePhoto(photo.id, { alt: 'Saved for later' })
    f.store.close()
    const reopened = new PhotoStore(f.directory)
    stores.push(reopened)
    const app = createApp({ store: reopened, importTokenHash: tokenHash })
    const status = await request(app).get('/api/import/status').query(identity).set('Authorization', authorization).expect(200)
    expect(status.body).toMatchObject({ exists: true, photo: { id: photo.id, alt: 'Saved for later', visible: false } })
    const duplicate = await request(app).post('/api/import/photos').query(identity).set('Authorization', authorization)
      .set('Content-Type', 'application/octet-stream').send(editedImage).expect(200)
    expect(duplicate.body).toMatchObject({ created: false, photo: { id: photo.id, alt: 'Saved for later', visible: false } })
    expect(reopened.list()).toHaveLength(1)
  })

  it('rejects unsupported source identities and rolls back a failed source mapping write', async () => {
    const f = await fixture()
    for (const invalid of [{ source: 'other', externalId: 'asset' }, { source: 'apple-photos', externalId: '' },
      { source: 'apple-photos', externalId: 'a'.repeat(201) }, { source: 'apple-photos', externalId: 'contains spaces' }]) {
      await request(f.app).get('/api/import/status').query(invalid).set('Authorization', authorization).expect(400, { error: 'invalid_import_identity' })
      await request(f.app).post('/api/import/photos').query(invalid).set('Authorization', authorization)
        .set('Content-Type', 'application/octet-stream').send(image).expect(400, { error: 'invalid_import_identity' })
    }
    const database = new DatabaseSync(join(f.directory, 'library.sqlite'))
    try {
      database.exec(`CREATE TRIGGER fixture_unavailable BEFORE INSERT ON photo_imports BEGIN SELECT RAISE(ABORT, 'synthetic mapping failure'); END;`)
      await f.upload().expect(500, { error: 'internal_server_error' })
      expect(f.store.list()).toEqual([])
      expect(f.store.findImport({ source: 'apple-photos', externalId: identity.externalId })).toBeNull()
      expect(await readdir(join(f.directory, 'photos'))).toEqual([])
      database.exec('DROP TRIGGER fixture_unavailable')
      await f.upload().expect(201)
    }
    finally { database.close() }
  })

  it('adds import metadata to a version-one library without changing its existing photos', async () => {
    const f = await fixture()
    const existing = await f.store.upload(image)
    f.store.updatePhoto(existing.id, { visible: true, featured: true, alt: 'Already chosen' })
    f.store.updateSettings({ heroPhotoId: existing.id })
    f.store.close()
    const database = new DatabaseSync(join(f.directory, 'library.sqlite'))
    database.exec('DROP TABLE photo_imports; PRAGMA user_version = 1;')
    database.close()
    const upgraded = new PhotoStore(f.directory)
    stores.push(upgraded)
    expect(upgraded.getPhoto(existing.id)).toMatchObject({ visible: true, featured: true, alt: 'Already chosen' })
    expect(upgraded.settings().heroPhotoId).toBe(existing.id)
    expect((await upgraded.importPhoto({ source: 'apple-photos', externalId: 'NEW-ASSET/L0/001' }, image)).created).toBe(true)
    expect(upgraded.list()).toHaveLength(2)
  })
})
