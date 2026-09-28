import { createHash, randomUUID } from 'node:crypto'
import * as files from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import request from 'supertest'
import sharp from 'sharp'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { hashPassword } from '../src/auth.js'
import { PhotoStore } from '../src/photo-store.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rm: vi.fn(actual.rm) }
})

const origin = 'https://kyapup-delete.example'
const password = 'Synthetic deletion fixture password'
const token = 'synthetic_delete_import_credential_0123456789'
const importTokenHash = createHash('sha256').update(token).digest('hex')
const authorization = `Bearer ${token}`
const identity = { source: 'apple-photos' as const, externalId: 'SYNTHETIC-DELETE-ASSET/L0/001' }
const stores: PhotoStore[] = []
const directories: string[] = []
let passwordHash: string
let image: Buffer
let originalRemove: typeof files.rm

beforeAll(async () => {
  originalRemove = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rm
  passwordHash = await hashPassword(password)
  image = await sharp({ create: { width: 18, height: 12, channels: 3, background: '#9d7657' } }).png().toBuffer()
})

afterEach(async () => {
  vi.mocked(files.rm).mockReset().mockImplementation(originalRemove)
  stores.splice(0).forEach(store => store.close())
  await Promise.all(directories.splice(0).map(directory => originalRemove(directory, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await files.mkdtemp(join(tmpdir(), 'kya-delete-fixture-'))
  directories.push(directory)
  const store = new PhotoStore(directory)
  stores.push(store)
  const app = createApp({ store, passwordHash, importTokenHash, allowedOrigins: [origin], secureCookies: false })
  const owner = request.agent(app)
  const login = await owner.post('/api/admin/login').set('Origin', origin).send({ password }).expect(200)
  const csrf = String(login.body.csrfToken)
  const remove = (id: string) => owner.delete(`/api/admin/photos/${id}`)
    .set('Origin', origin).set('X-CSRF-Token', csrf)
  const importPhoto = () => request(app).post('/api/import/photos').query(identity).set('Authorization', authorization)
    .set('Content-Type', 'application/octet-stream').send(image)
  return { directory, store, app, owner, csrf, remove, importPhoto }
}

function inspect<T>(directory: string, read: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(join(directory, 'library.sqlite'))
  try { return read(database) }
  finally { database.close() }
}

function queuedIds(directory: string) {
  return inspect(directory, database => database.prepare('SELECT id FROM photo_deletions ORDER BY id').all().map(row => row.id))
}

describe('Permanent photo removal', () => {
  it('removes all stored variants, clears the selected hero, and preserves other photos, settings, and the session', async () => {
    const f = await fixture()
    const target = await f.store.upload(image)
    const other = await f.store.upload(image)
    f.store.updatePhoto(target.id, { visible: true, featured: true })
    const retained = f.store.updatePhoto(other.id, { visible: true, alt: 'Retained synthetic photo', position: 7 })
    f.store.updateSettings({ mode: 'cycle', intervalSeconds: 37, heroPhotoId: target.id })
    const otherFull = await files.readFile(join(f.directory, 'photos', other.id, 'full.webp'))

    await request(f.app).get(target.url).expect(200)
    const response = await f.remove(target.id).expect(204).expect('Cache-Control', 'no-store')
    expect(response.text).toBe('')
    expect(await files.readdir(join(f.directory, 'photos'))).toEqual([other.id])
    expect(f.store.getPhoto(target.id)).toBeNull()
    expect(queuedIds(f.directory)).toEqual([])
    for (const url of [target.url, target.thumbnailUrl, `/api/media/${target.id}/original`]) {
      await request(f.app).get(url).expect(404, { error: 'photo_not_found' })
      await f.owner.get(url).expect(404, { error: 'photo_not_found' })
    }
    const settings = { mode: 'cycle', intervalSeconds: 37, heroPhotoId: null }
    await request(f.app).get('/api/gallery').expect(200, { photos: [retained], settings })
    await f.owner.get('/api/admin/library').expect(200, { photos: [retained], settings })
    await f.owner.get('/api/admin/session').expect(200, { authenticated: true, csrfToken: f.csrf })
    expect(await files.readFile(join(f.directory, 'photos', other.id, 'original'))).toEqual(image)
    expect(await files.readFile(join(f.directory, 'photos', other.id, 'full.webp'))).toEqual(otherFull)
    await f.owner.patch('/api/admin/settings').set('Origin', origin).set('X-CSRF-Token', f.csrf)
      .send({ intervalSeconds: 41 }).expect(200)
  })

  it('removes private photos without exposing them before or after deletion', async () => {
    const f = await fixture()
    const photo = await f.store.upload(image)
    await request(f.app).get(photo.url).expect(404, { error: 'photo_not_found' })
    await f.owner.get(photo.url).expect(200)
    await f.remove(photo.id).expect(204)
    await request(f.app).get(photo.url).expect(404, { error: 'photo_not_found' })
    await f.owner.get(photo.url).expect(404, { error: 'photo_not_found' })
    expect(f.store.list()).toEqual([])
    expect(await files.readdir(join(f.directory, 'photos'))).toEqual([])
  })

  it('requires a browser session, an allowed Origin, and its CSRF token; import credentials cannot delete', async () => {
    const f = await fixture()
    const photo = await f.store.upload(image)
    const url = `/api/admin/photos/${photo.id}`
    await request(f.app).delete(url).set('Origin', origin).set('X-CSRF-Token', f.csrf)
      .expect(401, { error: 'authentication_required' })
    await request(f.app).delete(url).set('Authorization', authorization).set('Origin', origin).set('X-CSRF-Token', f.csrf)
      .expect(401, { error: 'authentication_required' })
    await f.owner.delete(url).set('X-CSRF-Token', f.csrf).expect(403, { error: 'origin_not_allowed' })
    await f.owner.delete(url).set('Origin', 'https://unlisted.example').set('X-CSRF-Token', f.csrf)
      .expect(403, { error: 'origin_not_allowed' })
    await f.owner.delete(url).set('Origin', origin).expect(403, { error: 'invalid_csrf_token' })
    await f.owner.delete(url).set('Origin', origin).set('X-CSRF-Token', 'incorrect synthetic token')
      .expect(403, { error: 'invalid_csrf_token' })
    expect(f.store.getPhoto(photo.id)).toEqual(photo)
    expect(queuedIds(f.directory)).toEqual([])
    expect(await files.readFile(join(f.directory, 'photos', photo.id, 'original'))).toEqual(image)
    await f.owner.get(photo.url).expect(200)
  })

  it('treats missing UUIDs as idempotent and never deletes untracked directories or follows invalid IDs', async () => {
    const f = await fixture()
    const missing = randomUUID()
    const untracked = join(f.directory, 'photos', missing)
    await files.mkdir(untracked)
    await files.writeFile(join(untracked, 'sentinel'), 'synthetic untracked file')
    await f.remove(missing).expect(204)
    await f.remove(missing).expect(204)
    for (const invalid of ['not-a-uuid', '%2E%2E%2Flibrary.sqlite', '00000000-0000-0000-0000-00000000000z'])
      await f.remove(invalid).expect(404, { error: 'photo_not_found' })
    expect(await files.readFile(join(untracked, 'sentinel'), 'utf8')).toBe('synthetic untracked file')
    expect(queuedIds(f.directory)).toEqual([])
    expect(f.store.isReady()).toBe(true)
  })

  it('clears an imported identity and permits an explicit reimport as a new private photo', async () => {
    const f = await fixture()
    const first = (await f.importPhoto().expect(201)).body.photo
    const retainedIdentity = { ...identity, externalId: 'SYNTHETIC-RETAINED-ASSET/L0/001' }
    const retained = (await f.store.importPhoto(retainedIdentity, image)).photo
    await f.remove(first.id).expect(204)
    await request(f.app).get('/api/import/status').query(identity).set('Authorization', authorization)
      .expect(200, { exists: false })
    expect(f.store.findImport(retainedIdentity)).toEqual(retained)
    const result = (await f.importPhoto().expect(201)).body
    expect(result).toMatchObject({ created: true, photo: { visible: false, featured: false } })
    expect(result.photo.id).not.toBe(first.id)
    expect(f.store.findImport(identity)?.id).toBe(result.photo.id)
    expect(f.store.list()).toHaveLength(2)
    expect(await files.readdir(join(f.directory, 'photos'))).not.toContain(first.id)
    await request(f.app).get(result.photo.url).expect(404)
    await f.owner.get(first.url).expect(404)
  })

  it('allows concurrent removal of the same photo and keeps the deletion after restart', async () => {
    const f = await fixture()
    const photo = await f.store.upload(image)
    f.store.updateSettings({ mode: 'cycle', intervalSeconds: 23 })
    const responses = await Promise.all([f.remove(photo.id), f.remove(photo.id)])
    expect(responses.map(response => response.status)).toEqual([204, 204])
    f.store.close()
    const reopened = new PhotoStore(f.directory)
    stores.push(reopened)
    expect(reopened.list()).toEqual([])
    expect(reopened.settings()).toEqual({ mode: 'cycle', intervalSeconds: 23, heroPhotoId: null })
    expect(queuedIds(f.directory)).toEqual([])
    expect(await files.readdir(join(f.directory, 'photos'))).toEqual([])
    await request(createApp({ store: reopened })).get(photo.url).expect(404)
  })

  it('bounds simultaneous cleanup work and leaves excess deletion requests unchanged', async () => {
    const f = await fixture()
    const photos = await Promise.all([f.store.upload(image), f.store.upload(image), f.store.upload(image)])
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const cleanup = vi.mocked(files.rm).mockImplementation(async (...args) => {
      await gate
      return originalRemove(...args)
    })
    const first = f.remove(photos[0]!.id).then(response => response.status)
    const second = f.remove(photos[1]!.id).then(response => response.status)
    try {
      await expect.poll(() => cleanup.mock.calls.length).toBe(2)
      await f.remove(photos[2]!.id).expect(503, { error: 'delete_busy' })
      expect(f.store.getPhoto(photos[2]!.id)).toEqual(photos[2])
    }
    finally {
      release()
      expect(await Promise.all([first, second])).toEqual([204, 204])
    }
    expect(queuedIds(f.directory)).toEqual([])
    expect(await files.readdir(join(f.directory, 'photos'))).toEqual([photos[2]!.id])
  })

  it('revokes access before failed cleanup and durably retries the pending files after restart', async () => {
    const f = await fixture()
    const photo = (await f.store.importPhoto(identity, image)).photo
    const other = await f.store.upload(image)
    f.store.updatePhoto(photo.id, { visible: true, featured: true })
    f.store.updateSettings({ heroPhotoId: photo.id, mode: 'cycle', intervalSeconds: 29 })
    const cleanup = vi.mocked(files.rm).mockRejectedValueOnce(new Error('Synthetic cleanup failure'))
    await f.remove(photo.id).expect(503, { error: 'photo_delete_incomplete' })
    expect(f.store.getPhoto(photo.id)).toBeNull()
    expect(f.store.findImport(identity)).toBeNull()
    expect(f.store.settings()).toEqual({ heroPhotoId: null, mode: 'cycle', intervalSeconds: 29 })
    expect(queuedIds(f.directory)).toEqual([photo.id])
    expect(await files.readFile(join(f.directory, 'photos', photo.id, 'original'))).toEqual(image)
    for (const url of [photo.url, photo.thumbnailUrl]) {
      await request(f.app).get(url).expect(404, { error: 'photo_not_found' })
      await f.owner.get(url).expect(404, { error: 'photo_not_found' })
    }
    const library = (await f.owner.get('/api/admin/library').expect(200)).body
    expect(library.photos).toEqual([other])
    f.store.close()
    cleanup.mockReset().mockImplementation(originalRemove)

    const reopened = new PhotoStore(f.directory)
    stores.push(reopened)
    await expect.poll(() => queuedIds(f.directory)).toEqual([])
    expect(await files.readdir(join(f.directory, 'photos'))).toEqual([other.id])
    expect(reopened.getPhoto(other.id)).toEqual(other)
    expect(reopened.findImport(identity)).toBeNull()
    expect(reopened.settings()).toEqual({ heroPhotoId: null, mode: 'cycle', intervalSeconds: 29 })
  })

  it('retries a failed cleanup through the same idempotent delete endpoint', async () => {
    const f = await fixture()
    const photo = await f.store.upload(image)
    vi.mocked(files.rm).mockRejectedValueOnce(new Error('Synthetic cleanup failure'))
    await f.remove(photo.id).expect(503, { error: 'photo_delete_incomplete' })
    expect(queuedIds(f.directory)).toEqual([photo.id])
    await f.remove(photo.id).expect(204)
    await f.remove(photo.id).expect(204)
    expect(queuedIds(f.directory)).toEqual([])
    expect(await files.readdir(join(f.directory, 'photos'))).toEqual([])
  })

  it('preserves the photo and files if the durable deletion transaction cannot commit', async () => {
    const f = await fixture()
    const photo = (await f.store.importPhoto(identity, image)).photo
    f.store.updatePhoto(photo.id, { visible: true, featured: true })
    f.store.updateSettings({ heroPhotoId: photo.id })
    inspect(f.directory, database => database.exec(`CREATE TRIGGER synthetic_delete_failure BEFORE DELETE ON photos
      BEGIN SELECT RAISE(ABORT, 'synthetic delete transaction failure'); END;`))
    await f.remove(photo.id).expect(500, { error: 'internal_server_error' })
    expect(f.store.getPhoto(photo.id)).toMatchObject({ id: photo.id, visible: true, featured: true })
    expect(f.store.findImport(identity)?.id).toBe(photo.id)
    expect(f.store.settings().heroPhotoId).toBe(photo.id)
    expect(queuedIds(f.directory)).toEqual([])
    expect(await files.readFile(join(f.directory, 'photos', photo.id, 'original'))).toEqual(image)
    inspect(f.directory, database => database.exec('DROP TRIGGER synthetic_delete_failure'))
    await f.remove(photo.id).expect(204)
  })

  it('adds the deletion queue to an existing version-two library without changing its photos or settings', async () => {
    const f = await fixture()
    const photo = (await f.store.importPhoto(identity, image)).photo
    const retained = f.store.updatePhoto(photo.id, { visible: true, featured: true, alt: 'Previously curated' })
    f.store.updateSettings({ heroPhotoId: photo.id, mode: 'cycle', intervalSeconds: 19 })
    const settings = f.store.settings()
    f.store.close()
    inspect(f.directory, database => database.exec('DROP TABLE photo_deletions; PRAGMA user_version = 2;'))
    const reopened = new PhotoStore(f.directory)
    stores.push(reopened)
    expect(reopened.list()).toEqual([retained])
    expect(reopened.findImport(identity)).toEqual(retained)
    expect(reopened.settings()).toEqual(settings)
    expect(queuedIds(f.directory)).toEqual([])
    expect(inspect(f.directory, database => database.prepare('PRAGMA user_version').get()?.user_version)).toBe(2)
    expect(await files.readFile(join(f.directory, 'photos', photo.id, 'original'))).toEqual(image)
  })
})
