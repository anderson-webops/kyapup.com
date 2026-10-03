import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:https'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { after, test } from 'node:test'

const require = createRequire(import.meta.url)
const projectRoot = resolve(import.meta.dirname, '..')
const scratchRoot = join(projectRoot, '.ai-work', 'runs')
const scratchDirectories = []

after(async () => {
  await Promise.all(scratchDirectories.map(directory => rm(directory, { force: true, recursive: true })))
})

function getSecureResponse(url) {
  return new Promise((resolveResponse, rejectResponse) => {
    const client = request(url, { rejectUnauthorized: false }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => resolveResponse({ status: response.statusCode, body }))
    })
    client.on('error', rejectResponse)
    client.end()
  })
}

async function withListener(listen, https, callback) {
  const listener = await listen((_request, response) => response.end('ok'), {
    hostname: '127.0.0.1',
    port: 0,
    https,
    autoClose: false,
    isTest: true,
  })
  try {
    await callback(listener)
  }
  finally {
    await listener.close()
  }
}

test('local listhen fork preserves HTTP and certificate modes without node-forge', async () => {
  const esm = await import('listhen')
  const commonjs = require('listhen')
  assert.equal(typeof esm.listen, 'function')
  assert.equal(typeof commonjs.listen, 'function')
  assert.equal(typeof (await import('listhen/cli')).runMain, 'function')
  assert.equal(typeof require('listhen/cli').runMain, 'function')

  const rootPackage = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'))
  const forkPackage = JSON.parse(await readFile(join(projectRoot, 'vendor/listhen/package.json'), 'utf8'))
  const lockfile = JSON.parse(await readFile(join(projectRoot, 'package-lock.json'), 'utf8'))
  assert.equal(rootPackage.devDependencies.listhen, 'file:vendor/listhen')
  assert.equal(rootPackage.overrides.listhen, '$listhen')
  assert.equal(forkPackage.dependencies['node-forge'], undefined)
  assert.equal(forkPackage.dependencies.selfsigned, '5.5.0')
  assert.ok(Object.entries(lockfile.packages).every(([path, entry]) =>
    !/(?:^|\/)node_modules\/node-forge$/u.test(path) && !entry.dependencies?.['node-forge']))

  const cli = spawnSync(process.execPath, [join(projectRoot, 'vendor/listhen/bin/listhen.mjs'), '--help'], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(`${cli.stdout}\n${cli.stderr}`, /listhen|Usage/iu)

  await withListener(esm.listen, false, async (listener) => {
    const response = await fetch(listener.url)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'ok')
  })

  await mkdir(scratchRoot, { recursive: true })
  const directory = await mkdtemp(join(scratchRoot, 'listhen-compat-'))
  scratchDirectories.push(directory)
  let certificate
  await withListener(esm.listen, { domains: ['localhost', '127.0.0.1', '::1'], validityDays: 1 }, async (listener) => {
    assert.deepEqual(await getSecureResponse(listener.url), { status: 200, body: 'ok' })
    const issued = new X509Certificate(listener.https.cert)
    assert.equal(issued.checkHost('localhost'), 'localhost')
    assert.equal(issued.checkIP('127.0.0.1'), '127.0.0.1')
    assert.equal(issued.checkIP('::1'), '::1')
    assert.ok(Date.parse(issued.validFrom) <= Date.now())
    assert.ok(Date.parse(issued.validTo) > Date.now() + 20 * 60 * 60 * 1000)
    assert.ok(Date.parse(issued.validTo) < Date.now() + 25 * 60 * 60 * 1000)
    certificate = listener.https
  })

  await withListener(commonjs.listen, { key: certificate.key, cert: certificate.cert }, async (listener) => {
    assert.deepEqual(await getSecureResponse(listener.url), { status: 200, body: 'ok' })
  })

  const keyPath = join(directory, 'key.pem')
  const certPath = join(directory, 'cert.pem')
  const pfxPath = join(directory, 'cert.pfx')
  const badPfxPath = join(directory, 'bad.pfx')
  await writeFile(keyPath, certificate.key, { mode: 0o600 })
  await writeFile(certPath, certificate.cert, { mode: 0o600 })
  await writeFile(badPfxPath, 'not-a-pfx', { mode: 0o600 })

  await withListener(esm.listen, { key: keyPath, cert: certPath }, async (listener) => {
    assert.deepEqual(await getSecureResponse(listener.url), { status: 200, body: 'ok' })
  })

  const pfxExport = spawnSync('openssl', [
    'pkcs12',
    '-export',
    '-inkey',
    keyPath,
    '-in',
    certPath,
    '-out',
    pfxPath,
    '-passout',
    'pass:synthetic-test-only',
  ], { encoding: 'utf8' })
  assert.equal(pfxExport.status, 0, pfxExport.stderr)

  await withListener(esm.listen, { pfx: pfxPath, passphrase: 'synthetic-test-only' }, async (listener) => {
    assert.deepEqual(await getSecureResponse(listener.url), { status: 200, body: 'ok' })
  })

  await assert.rejects(() => esm.listen((_request, response) => response.end('ok'), {
    hostname: '127.0.0.1',
    port: 0,
    https: { pfx: badPfxPath },
    autoClose: false,
    isTest: true,
  }))
})
