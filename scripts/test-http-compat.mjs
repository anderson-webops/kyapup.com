import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { PassThrough, Readable } from 'node:stream'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(path.join(root, 'back-end/package.json'))
const express = require('express')

const expressRequire = createRequire(require.resolve('express'))
const bodyParserRequire = createRequire(expressRequire.resolve('body-parser'))
const request = require('supertest')

const cookie = expressRequire('cookie')
const encodeUrl = expressRequire('encodeurl')
const getRawBody = bodyParserRequire('raw-body')
const typeIs = expressRequire('type-is')
const iconv = createRequire(bodyParserRequire.resolve('raw-body'))('iconv-lite')
const inputs = JSON.parse(await readFile(path.join(root, 'vendor/http-compat/UPSTREAM.json'), 'utf8'))

async function withApp(setup, verify) {
  const app = express()
  setup(app)
  const server = createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    await verify(request(server), `http://127.0.0.1:${server.address().port}`)
  }
  finally {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error
      ? reject(error)
      : resolve()))
  }
}

function bounded(operation) {
  return operation.timeout({ response: 2000, deadline: 5000 })
}

test('both package graphs select seven modern HTTP libraries and retire the unused media parser', async () => {
  const libraryVersions = {
    'content-disposition': '3.0.0',
    'content-type': '3.1.1',
    'cookie': '2.0.2-webops.1',
    'encodeurl': '3.0.0-webops.1',
    'path-to-regexp': '9.0.0',
    'raw-body': '4.0.0-webops.1',
    'type-is': '3.0.0-webops.1',
  }
  for (const filename of ['package-lock.json', 'back-end/package-lock.json']) {
    const lock = JSON.parse(await readFile(path.join(root, filename), 'utf8'))
    for (const [name, version] of Object.entries(libraryVersions))
      assert.equal(lock.packages[`node_modules/${name}`].version, version, `${filename}: ${name}`)
    assert.equal(Object.keys(lock.packages).some(filename => filename.endsWith('/node_modules/media-typer') || filename === 'node_modules/media-typer'), false)
  }
  for (const name of [
    'express',
    'finalhandler',
    'send',
    'serve-static',
  ]) {
    const consumer = createRequire(expressRequire.resolve(name))
    assert.equal(consumer('encodeurl'), encodeUrl)
  }
  assert.equal(bodyParserRequire('type-is'), typeIs)
})

test('ESM imports retain the unchanged modern implementations and original licenses', async () => {
  for (const input of inputs.packages) {
    const directory = path.dirname(expressRequire.resolve(input.name))
    const metadata = JSON.parse(await readFile(path.join(directory, 'UPSTREAM-PACKAGE.json'), 'utf8'))
    assert.equal(metadata.name, input.name)
    assert.equal(metadata.version, input.version)
    assert.ok((await readFile(path.join(directory, 'LICENSE'), 'utf8')).includes('MIT'))
    const originalArchive = path.join(root, 'vendor/http-compat/upstream', `${input.name}-${input.version}.tgz`)
    const original = spawnSync('tar', ['-xOf', originalArchive, 'package/dist/index.js'])
    assert.equal(original.status, 0)
    assert.deepEqual(await readFile(path.join(directory, 'dist/index.js')), original.stdout)
    const modern = await import(pathToFileURL(path.join(directory, 'dist/index.js')))
    if (input.name === 'cookie')
      assert.equal(typeof modern.stringifySetCookie, 'function')
    else if (input.name === 'encodeurl')
      assert.equal(modern.encodeUrl, encodeUrl)
    else if (input.name === 'raw-body')
      assert.equal(modern.getRawBody, getRawBody.getRawBody)
    else
      assert.equal(modern.TypeIs, typeIs.TypeIs)
  }
})

test('cookie compatibility preserves positional arguments, URI encoding and security attributes', () => {
  assert.equal(cookie.serialize('session', 'signed:value /雪', {
    name: 'overridden',
    value: 'discarded',
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    partitioned: true,
    priority: 'high',
    maxAge: 60,
  }), 'session=signed%3Avalue%20%2F%E9%9B%AA; Max-Age=60; Path=/; HttpOnly; Secure; Partitioned; Priority=High; SameSite=Strict')
  assert.equal(cookie.serialize('encoded', 'safe-value', {
    encode: value => value,
  }), 'encoded=safe-value')
  for (const options of [
    { path: '/\r\nInjected: yes' },
    { domain: 'example.test\r\nInjected: yes' },
    {
      encode: () => 'bad\r\nvalue',
    },
  ])
    assert.throws(() => cookie.serialize('name', 'value', options), TypeError)
  assert.throws(() => cookie.serialize('bad\r\nname', 'value'), TypeError)
  const parsed = cookie.parse('name=first; name=second; __proto__=safe; escaped=%E9%9B%AA')
  assert.equal(parsed.name, 'first')
  assert.equal(parsed.escaped, '雪')
  assert.equal(Object.hasOwn(parsed, '__proto__'), true)
  assert.equal(Reflect.apply(Object.prototype.isPrototypeOf, Object.prototype, [parsed]), false)
  assert.equal(cookie.parse('quoted="value%20one"').quoted, 'value one')
  assert.equal(cookie.parse('malformed=%ZZ').malformed, '%ZZ')
  assert.equal(cookie.parse('custom=value', {
    decode() { throw new Error('synthetic decoder failure') },
  }).custom, 'value')
})

test('real Express cookies preserve signed and JSON values, expiry and clearing', { timeout: 10000 }, async () => {
  const secret = randomBytes(32).toString('hex')
  await withApp((app) => {
    app.get('/cookies', (req, res) => {
      req.secret = secret
      res.cookie('json', { locale: '雪' }, { httpOnly: true, sameSite: 'lax' })
      res.cookie('signed', 'value', { signed: true, secure: true, maxAge: 60000 })
      res.clearCookie('expired', { httpOnly: true, sameSite: 'strict' })
      res.end()
    })
  }, async (client) => {
    const response = await bounded(client.get('/cookies')).expect(200)
    const cookies = response.headers['set-cookie']
    assert.match(cookies[0], /^json=j%3A%7B%22locale%22%3A%22%E9%9B%AA%22%7D; Path=\/; HttpOnly; SameSite=Lax$/)
    assert.match(cookies[1], /^signed=s%3Avalue\./)
    assert.match(cookies[1], /; Max-Age=60; Path=\/; Expires=.*; Secure$/)
    assert.match(cookies[2], /^expired=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict$/)
  })
})

test('modern encoder preserves escaping, existing sequences and malformed surrogate safety', () => {
  for (const [value, expected] of [
    ['/雪?q=a b', '/%E9%9B%AA?q=a%20b'],
    ['/already%20encoded', '/already%20encoded'],
    ['/broken%zz', '/broken%25zz'],
    ['/\uD800', '/%EF%BF%BD'],
    ['/\r\nInjected: yes', '/%0D%0AInjected:%20yes'],
  ])
    assert.equal(encodeUrl(value), expected)
})

test('Express redirects and finalhandler execute the modern encoder without header injection', { timeout: 10000 }, async () => {
  await withApp((app) => {
    app.get('/redirect', (_req, res) => res.redirect('/雪\r\nInjected: yes'))
  }, async (client) => {
    const redirect = await bounded(client.get('/redirect')).expect(302)
    assert.equal(redirect.headers.location, '/%E9%9B%AA%0D%0AInjected:%20yes')
    assert.equal(redirect.headers.injected, undefined)
    await bounded(client.get('/missing%20path')).expect(404)
  })
})

test('serve-static directory redirects and send attachment headers retain Unicode handling', { timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(root, '.ai-work/runs/http-static-test-'))
  await mkdir(path.join(directory, 'docs 雪'))
  await writeFile(path.join(directory, 'docs 雪/file.txt'), 'static')
  try {
    await withApp((app) => {
      app.use('/assets', express.static(directory))
      app.get('/attachment', (_req, res) => res.attachment('雪.txt').send('content'))
    }, async (client) => {
      const redirect = await bounded(client.get('/assets/docs%20%E9%9B%AA')).expect(301)
      assert.equal(redirect.headers.location, '/assets/docs%20%E9%9B%AA/')
      await bounded(client.get('/assets/docs%20%E9%9B%AA/file.txt')).expect(200, 'static')
      const head = await bounded(client.head('/assets/docs%20%E9%9B%AA/file.txt')).expect(200)
      assert.equal(head.headers['content-length'], '6')
      const attachment = await bounded(client.get('/attachment')).expect(200, 'content')
      assert.ok(attachment.headers['content-disposition'].includes('filename*=UTF-8\'\'%E9%9B%AA.txt'))
    })
  }
  finally {
    await rm(directory, { recursive: true })
  }
})

test('body-parser retains UTF-8, UTF-16 and UTF-32 JSON through the modern reader', { timeout: 10000 }, async () => {
  await withApp((app) => {
    app.use(express.json({ limit: 1024 }))
    app.post('/json', (req, res) => res.json(req.body))
  }, async (_client, origin) => {
    for (const encoding of [
      'utf-8',
      'utf-16le',
      'utf-16be',
      'utf-32le',
      'utf-32be',
    ]) {
      const body = iconv.encode(JSON.stringify({ text: '雪😀' }), encoding)
      const response = await fetch(`${origin}/json`, {
        method: 'POST',
        body,
        headers: { 'content-type': `application/json; charset=${encoding}` },
        signal: AbortSignal.timeout(5000),
      })
      assert.equal(response.status, 200, `${encoding} must retain real binary request decoding`)
      assert.deepEqual(await response.json(), { text: '雪😀' })
    }
  })
})

test('body-parser retains decompression limits and safe malformed/unsupported input errors', { timeout: 10000 }, async () => {
  await withApp((app) => {
    app.use(express.json({ limit: 64 }))
    app.post('/json', (req, res) => res.json(req.body))
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ type: error.type }))
  }, async (client, origin) => {
    for (const [value, status, expected] of [
      [
        { ok: true },
        200,
        { ok: true },
      ],
      [
        {
          text: 'x'.repeat(1000),
        },
        413,
        { type: 'entity.too.large' },
      ],
    ]) {
      const response = await fetch(`${origin}/json`, {
        method: 'POST',
        body: gzipSync(Buffer.from(JSON.stringify(value))),
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        signal: AbortSignal.timeout(5000),
      })
      assert.equal(response.status, status)
      assert.deepEqual(await response.json(), expected)
    }
    await bounded(client.post('/json').set('Content-Type', 'application/json').send('{broken')).expect(400, { type: 'entity.parse.failed' })
    await bounded(client.post('/json').set('Content-Type', 'application/json; charset=made-up').send('{}')).expect(415, { type: 'charset.unsupported' })
  })
})

test('raw-body preserves buffers, callback/promise forms and asynchronous context', async () => {
  assert.deepEqual(await getRawBody(Readable.from([
    Buffer.from('raw'),
  ])), Buffer.from('raw'))
  assert.equal(await getRawBody(Readable.from([
    Buffer.from('text'),
  ]), true), 'text')
  const context = new AsyncLocalStorage()
  await context.run({ request: 'synthetic' }, () => new Promise((resolve, reject) => {
    getRawBody(Readable.from([
      Buffer.from('value'),
    ]), 'utf-8', (error, value) => {
      try {
        assert.ifError(error)
        assert.equal(value, 'value')
        assert.equal(context.getStore().request, 'synthetic')
        resolve()
      }
      catch (failure) {
        reject(failure)
      }
    })
  }))
  assert.equal(await getRawBody(Readable.from([
    Buffer.from('x'),
  ]), {
    encoding: 'custom',
    decoder: () => ({
      write: () => 'custom',
      end: () => '',
    }),
  }), 'custom')
})

test('raw-body retains limits, length mismatch and aborted-stream errors', async () => {
  await assert.rejects(getRawBody(Readable.from([
    Buffer.alloc(4),
  ]), { limit: 2 }), { status: 413, type: 'entity.too.large' })
  await assert.rejects(getRawBody(Readable.from([
    Buffer.alloc(4),
  ]), { length: 5 }), { status: 400, type: 'request.size.invalid' })
  const stream = new PassThrough()
  const result = getRawBody(stream, { encoding: 'utf-8' })
  stream.emit('aborted')
  await assert.rejects(result, { status: 400, type: 'request.aborted' })
  stream.destroy()
})

test('type-is preserves MIME aliases, flattened arguments, wildcard results and no-body distinctions', () => {
  const body = {
    headers: { 'content-type': 'Application/Problem+JSON; charset=utf-8', 'content-length': '0' },
  }
  assert.equal(typeIs(body, 'html', '+json'), 'application/problem+json')
  assert.equal(typeIs(body, ['application/*']), 'application/problem+json')
  assert.equal(typeIs.is('text/html', ['html']), 'html')
  assert.equal(typeIs.is('text/plain', ['txt']), 'txt')
  assert.equal(typeIs.is('text/plain'), 'text/plain')
  assert.equal(typeIs({ headers: {} }, 'json'), null)
  assert.equal(typeIs({
    headers: { 'content-length': '1' },
  }, 'json'), false)
  assert.equal(typeIs.is('application/json', ['html']), false)
  assert.equal(typeIs.is('application/json', [false, 'unknown-extension']), false)
  assert.equal(typeIs.is('invalid header', ['*/*']), false)
  assert.equal(typeIs.match('*/*+json', 'application/problem+json'), true)
  assert.equal(typeIs.match('*/*+json', 'application/json'), false)
  assert.equal(typeIs.normalize('urlencoded'), 'application/x-www-form-urlencoded')
  assert.equal(typeIs.normalize('multipart'), 'multipart/*')
})

test('real Express request.is and optional/wildcard router paths retain their contracts', { timeout: 10000 }, async () => {
  await withApp((app) => {
    app.post('/type', (req, res) => res.json({
      result: req.is('html', '+json'),
    }))
    app.get('/users{/:id}', (req, res) => res.json(req.params))
    app.get('/files/*path', (req, res) => res.json(req.params))
  }, async (client) => {
    await bounded(client.post('/type').set('Content-Type', 'application/problem+json').send('{}')).expect(200, { result: 'application/problem+json' })
    await bounded(client.get('/USERS')).expect(200, {})
    await bounded(client.get('/users/a%2Fb')).expect(200, { id: 'a/b' })
    await bounded(client.get('/files/a/b')).expect(200, {
      path: ['a', 'b'],
    })
    await bounded(client.get('/users/%ZZ')).expect(400)
  })
})

async function packageFixture() {
  const fixture = await mkdtemp(path.join(root, '.ai-work/runs/http-package-test-'))
  await mkdir(path.join(fixture, 'scripts'))
  await mkdir(path.join(fixture, 'back-end'))
  await cp(path.join(root, 'vendor/http-compat'), path.join(fixture, 'vendor/http-compat'), { recursive: true })
  await cp(path.join(root, 'back-end/vendor'), path.join(fixture, 'back-end/vendor'), { recursive: true })
  for (const filename of ['package-lock.json', 'back-end/package-lock.json'])
    await copyFile(path.join(root, filename), path.join(fixture, filename))
  await copyFile(path.join(root, 'scripts/package-http-compat.mjs'), path.join(fixture, 'scripts/package-http-compat.mjs'))
  await writeFile(path.join(fixture, 'package.json'), JSON.stringify({ name: 'http-package-fixture', private: true, version: '1.0.0' }))
  return fixture
}

function packageCheck(fixture) {
  return spawnSync(process.execPath, [
    path.join(fixture, 'scripts/package-http-compat.mjs'),
    '--check',
  ], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 128 * 1024,
  })
}

test('private source permissions reproduce packages without modifying original inputs', { timeout: 40000 }, async () => {
  const fixture = await packageFixture()
  try {
    const filename = path.join(fixture, 'vendor/http-compat/encodeurl/compat.cjs')
    await chmod(filename, 0o600)
    const before = createHash('sha256').update(await readFile(filename)).digest('hex')
    const result = packageCheck(fixture)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(createHash('sha256').update(await readFile(filename)).digest('hex'), before)
  }
  finally {
    await rm(fixture, { recursive: true })
  }
})

for (const corruption of ['upstream', 'bridge', 'lock']) {
  test(`HTTP package reproduction rejects changed ${corruption} evidence`, { timeout: 40000 }, async () => {
    const fixture = await packageFixture()
    try {
      if (corruption === 'upstream') {
        await writeFile(path.join(fixture, 'vendor/http-compat/upstream/cookie-2.0.2.tgz'), 'not-an-official-archive')
      }
      else if (corruption === 'bridge') {
        await writeFile(path.join(fixture, 'vendor/http-compat/cookie/compat.cjs'), 'module.exports = {}\n')
      }
      else {
        const filename = path.join(fixture, 'back-end/package-lock.json')
        const lock = JSON.parse(await readFile(filename, 'utf8'))
        lock.packages['node_modules/cookie'].integrity = 'sha512-changed'
        await writeFile(filename, JSON.stringify(lock))
      }
      const result = packageCheck(fixture)
      assert.equal(result.status, 1)
      assert.equal(result.signal, null)
      assert.ok(result.stderr.length < 8000)
      assert.match(result.stderr, /reviewed official registry archive|reproduce from the original library|immutable lockfile inputs/)
    }
    finally {
      await rm(fixture, { recursive: true })
    }
  })
}
