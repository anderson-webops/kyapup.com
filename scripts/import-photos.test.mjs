import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readManifest, runImport, siteOrigin } from './import-photos.mjs'

const fixtureUuid = '11111111-2222-3333-4444-555555555555'
const fixtureJpegHeader = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 0, 0, 0, 0])

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'kya-client-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(join(directory, 'photo.jpg'), fixtureJpegHeader)
  const manifest = join(directory, 'manifest.json')
  await writeFile(manifest, JSON.stringify({ version: 1, libraryId: 'photos-main', photos: [{ uuid: fixtureUuid.toUpperCase(), file: 'photo.jpg' }] }))
  return { directory, manifest, photos: await readManifest(manifest) }
}

async function server(t, handler) {
  const http = createServer(handler)
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => http.close(resolve)))
  return `http://127.0.0.1:${http.address().port}`
}

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(data))
}

test('manifest produces a stable namespaced identity and rejects repeated UUIDs', async (t) => {
  const { photos, manifest } = await fixture(t)
  assert.equal(photos[0].externalId, `photos-main/${fixtureUuid}`)
  const item = { uuid: fixtureUuid, file: 'photo.jpg' }
  await writeFile(manifest, JSON.stringify({ version: 1, libraryId: 'photos-main', photos: [item, item] }))
  await assert.rejects(readManifest(manifest), /appears twice/)
})

test('an exported file must contain a supported image header', async (t) => {
  const { directory, manifest } = await fixture(t)
  await writeFile(join(directory, 'photo.jpg'), 'This is a plain text test fixture, not an image.')
  await assert.rejects(readManifest(manifest), /not a supported image/)
})

test('destination stays on the named HTTPS sites or loopback testing', () => {
  assert.equal(siteOrigin('https://kyapup.com'), 'https://kyapup.com')
  assert.equal(siteOrigin('https://kyagirl.com/'), 'https://kyagirl.com')
  assert.equal(siteOrigin('http://127.0.0.1:3848'), 'http://127.0.0.1:3848')
  for (const invalid of ['http://kyapup.com', 'https://example.com', 'https://kyapup.com/path', 'https://kyapup.com?token=test'])
    assert.throws(() => siteOrigin(invalid))
})

test('imports once, then skips the already saved identity without uploading again', async (t) => {
  const { photos } = await fixture(t)
  const token = randomBytes(32).toString('base64url')
  let saved = false
  let uploads = 0
  const site = await server(t, async (request, response) => {
    assert.equal(request.headers.authorization, `Bearer ${token}`)
    const url = new URL(request.url, 'http://127.0.0.1')
    assert.equal(url.searchParams.get('externalId'), photos[0].externalId)
    assert.equal(url.searchParams.get('source'), 'apple-photos')
    if (url.pathname.endsWith('/status')) {
      reply(response, 200, { exists: saved })
      return
    }
    assert.equal(request.method, 'POST')
    assert.equal(request.headers['content-type'], 'application/octet-stream')
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    assert.deepEqual(Buffer.concat(chunks), fixtureJpegHeader)
    uploads++
    saved = true
    reply(response, 201, { created: true, photo: { id: 'fixture-photo' } })
  })
  const log = () => {}
  assert.deepEqual(await runImport(photos, { site, token, log }), { imported: 1, skipped: 0, failed: 0, remaining: 0 })
  assert.deepEqual(await runImport(photos, { site, token, log }), { imported: 0, skipped: 1, failed: 0, remaining: 0 })
  assert.equal(uploads, 1)
})

test('stops a failed batch without printing a credential', async (t) => {
  const { photos } = await fixture(t)
  const token = randomBytes(32).toString('base64url')
  const site = await server(t, (_request, response) => reply(response, 401, { error: 'import_authentication_required' }))
  const lines = []
  const result = await runImport([...photos, ...photos], { site, token, log: line => lines.push(line) })
  assert.deepEqual(result, { imported: 0, skipped: 0, failed: 1, remaining: 1 })
  assert.match(lines.join('\n'), /not accepted/)
  assert.ok(!lines.join('\n').includes(token))
})

test('a rate-limited batch resumes the same photo instead of restarting the manifest', async (t) => {
  const { photos } = await fixture(t)
  let requests = 0
  const site = await server(t, (_request, response) => {
    requests++
    if (requests === 1) {
      response.setHeader('Retry-After', '0')
      reply(response, 429, { error: 'too_many_requests' })
      return
    }
    reply(response, 200, { exists: true })
  })
  const result = await runImport(photos, { site, token: randomBytes(32).toString('base64url'), log: () => {} })
  assert.deepEqual(result, { imported: 0, skipped: 1, failed: 0, remaining: 0 })
  assert.equal(requests, 2)
})

test('unreadable upload copies produce a message without paths or source IDs', async (t) => {
  const { photos } = await fixture(t)
  await rm(photos[0].file)
  const site = await server(t, (_request, response) => reply(response, 200, { exists: false }))
  const lines = []
  const result = await runImport(photos, { site, token: randomBytes(32).toString('base64url'), log: line => lines.push(line) })
  assert.equal(result.failed, 1)
  assert.match(lines.join('\n'), /could not be read/)
  assert.ok(!lines.join('\n').includes(photos[0].file))
  assert.ok(!lines.join('\n').includes(fixtureUuid))
})
