#!/usr/bin/env node
import { Buffer } from 'node:buffer'
import { open, readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as wait } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const maxBytes = 25 * 1024 * 1024
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const supportedExtensions = /\.(?:jpe?g|png|webp|avif)$/i

function safeMessage(error) {
  if (error instanceof SyntaxError)
    return 'The manifest is not valid JSON.'
  if (error && typeof error === 'object' && 'code' in error)
    return 'An exported file or manifest could not be read. Check that it exists and is accessible.'
  return error instanceof Error ? error.message : 'Import failed.'
}

function imageHeader(bytes) {
  return (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)
    || bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
    || (bytes.toString('ascii', 4, 8) === 'ftyp' && bytes.toString('ascii', 8, 64).includes('avif'))
}

/** Read only an explicitly prepared export manifest, never the Photos database. */
export async function readManifest(manifestPath) {
  const path = resolve(manifestPath)
  if ((await stat(path)).size > 5 * 1024 * 1024)
    throw new Error('The manifest is too large.')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (manifest.version !== 1 || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(manifest.libraryId || '')
    || !Array.isArray(manifest.photos) || manifest.photos.length > 10_000) {
    throw new Error('Use a version 1 manifest with a stable libraryId and a photos array (up to 10,000 items).')
  }
  const seen = new Set()
  const photos = []
  for (const [index, item] of manifest.photos.entries()) {
    if (!item || !uuidPattern.test(item.uuid || '') || typeof item.file !== 'string' || !supportedExtensions.test(item.file))
      throw new Error(`Photo ${index + 1}: provide its Photos UUID and an exported JPG, PNG, WebP or AVIF file.`)
    const externalId = `${manifest.libraryId}/${item.uuid.toLowerCase()}`
    if (seen.has(externalId))
      throw new Error(`Photo ${index + 1}: the same Photos UUID appears twice in this manifest.`)
    seen.add(externalId)
    const file = resolve(dirname(path), item.file)
    const metadata = await stat(file)
    if (!metadata.isFile() || metadata.size < 12 || metadata.size > maxBytes)
      throw new Error(`Photo ${index + 1}: choose a nonempty image no larger than 25 MiB.`)
    const handle = await open(file, 'r')
    try {
      const header = Buffer.alloc(64)
      await handle.read(header, 0, header.length, 0)
      if (!imageHeader(header))
        throw new Error(`Photo ${index + 1}: the exported file is not a supported image. Convert HEIC to JPG first.`)
    }
    finally { await handle.close() }
    photos.push({ file, externalId, bytes: metadata.size })
  }
  return photos
}

export function siteOrigin(value) {
  const url = new URL(value)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || (!local && (!['kyapup.com', 'kyagirl.com'].includes(url.hostname) || url.protocol !== 'https:'))
    || (local && !['http:', 'https:'].includes(url.protocol))) {
    throw new Error('Use https://kyapup.com, https://kyagirl.com, or a loopback test server. Do not include a path or credentials.')
  }
  return url.origin
}

function apiMessage(status, code) {
  if (status === 401)
    return 'The import token was not accepted.'
  if (status === 503 && code === 'import_not_configured')
    return 'The server’s import API is not configured yet.'
  if (status === 413)
    return 'The image is larger than the server allows.'
  if (status === 429)
    return 'The server is busy. Wait a minute before trying again.'
  return `The server could not import this photo (HTTP ${status}).`
}

export async function runImport(photos, { site, token, log = console.log }) {
  const origin = siteOrigin(site)
  if (!/^[\w-]{43,128}$/.test(token || ''))
    throw new Error('Set KYA_IMPORT_TOKEN to the import credential from your secure credential store.')
  const result = { imported: 0, skipped: 0, failed: 0 }
  async function api(route, photo, method = 'GET', body) {
    const url = new URL(`/api/import/${route}`, origin)
    url.searchParams.set('source', 'apple-photos')
    url.searchParams.set('externalId', photo.externalId)
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/octet-stream' } : {}) },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
      })
      let payload
      try {
        payload = await response.json()
      }
      catch {
        throw new Error(`The server returned an unexpected response (HTTP ${response.status}).`)
      }
      if (response.status === 429 && attempt < 3) {
        const requested = Number(response.headers.get('Retry-After') ?? 60)
        const seconds = Number.isFinite(requested) ? Math.min(120, Math.max(1, requested)) : 60
        log('The server is busy; pausing before retrying this photo.')
        await wait(seconds * 1000 + 250)
        continue
      }
      if (!response.ok)
        throw new Error(apiMessage(response.status, payload?.error))
      return payload
    }
  }
  for (const [index, photo] of photos.entries()) {
    try {
      const status = await api('status', photo)
      if (typeof status.exists !== 'boolean')
        throw new Error('The server returned an unexpected import status.')
      if (status.exists) {
        result.skipped++
        log(`Photo ${index + 1}/${photos.length}: already saved; unchanged.`)
        continue
      }
      const bytes = await readFile(photo.file)
      if (bytes.length > maxBytes || !imageHeader(bytes.subarray(0, 64)))
        throw new Error('The exported file changed since validation. Check the manifest and try again.')
      const response = await api('photos', photo, 'POST', bytes)
      if (typeof response.created !== 'boolean' || !response.photo?.id)
        throw new Error('The server returned an unexpected import result. Rerun to check its saved status.')
      result[response.created ? 'imported' : 'skipped']++
      log(`Photo ${index + 1}/${photos.length}: ${response.created ? 'saved for later' : 'already saved; unchanged'}.`)
    }
    catch (error) {
      result.failed++
      log(`Photo ${index + 1}/${photos.length}: ${safeMessage(error)}`)
      // Stop at the first failure. A later run checks identities before uploading,
      // so a dropped response or interrupted batch does not duplicate photos.
      break
    }
  }
  return { ...result, remaining: photos.length - result.imported - result.skipped - result.failed }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const positional = args.filter(arg => arg !== '--apply')
  if (positional.length !== 1 || positional[0].startsWith('--'))
    throw new Error('Usage: node scripts/import-photos.mjs /path/to/manifest.json [--apply]')
  const photos = await readManifest(positional[0])
  if (!apply) {
    console.log(`Ready: ${photos.length} photos, ${(photos.reduce((total, photo) => total + photo.bytes, 0) / 1024 / 1024).toFixed(1)} MiB. Dry run only; nothing was uploaded.`)
    return
  }
  const result = await runImport(photos, { site: process.env.KYA_SITE_URL || 'https://kyapup.com', token: process.env.KYA_IMPORT_TOKEN })
  console.log(`${result.imported} added to Saved for later; ${result.skipped} already present; ${result.failed} failed; ${result.remaining} remaining.`)
  if (result.failed)
    process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(safeMessage(error))
    process.exitCode = 1
  })
}
