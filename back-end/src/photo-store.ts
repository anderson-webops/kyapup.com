import { randomUUID } from 'node:crypto'
import { accessSync, constants, mkdirSync, statSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'

export interface Photo {
  id: string
  alt: string
  width: number
  height: number
  visible: boolean
  featured: boolean
  position: number
  createdAt: string
  thumbnailUrl: string
  url: string
}

export interface Settings {
  mode: 'static' | 'cycle'
  intervalSeconds: number
  heroPhotoId: string | null
}

export class GalleryError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

type PhotoRow = Omit<Photo, 'visible' | 'featured' | 'url' | 'thumbnailUrl'> & { visible: number, featured: number }
const maxPixels = 60_000_000
const maxDimension = 20_000
export const maxUploadBytes = 25 * 1024 * 1024

function photoFromRow(row: PhotoRow): Photo {
  return {
    ...row,
    visible: row.visible === 1,
    featured: row.featured === 1,
    thumbnailUrl: `/api/media/${row.id}/thumb.webp`,
    url: `/api/media/${row.id}/full.webp`,
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GalleryError(400, 'invalid_request')
  return value as Record<string, unknown>
}

export class PhotoStore {
  private readonly database: DatabaseSync
  private readonly photosDirectory: string
  private closed = false

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.photosDirectory = resolve(directory, 'photos')
    mkdirSync(this.photosDirectory, { recursive: true, mode: 0o700 })
    this.database = new DatabaseSync(resolve(directory, 'library.sqlite'))
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY,
        alt TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        visible INTEGER NOT NULL DEFAULT 0 CHECK (visible IN (0, 1)),
        featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
        position INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        CHECK (featured = 0 OR visible = 1)
      );
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        mode TEXT NOT NULL CHECK (mode IN ('static', 'cycle')),
        intervalSeconds INTEGER NOT NULL CHECK (intervalSeconds BETWEEN 3 AND 3600),
        heroPhotoId TEXT REFERENCES photos(id)
      );
      INSERT OR IGNORE INTO settings VALUES (1, 'static', 8, NULL);
      PRAGMA user_version = 1;
    `)
  }

  isReady() {
    if (this.closed) return false
    try {
      accessSync(this.directory, constants.R_OK | constants.W_OK)
      accessSync(this.photosDirectory, constants.R_OK | constants.W_OK)
      this.database.prepare('SELECT id FROM settings WHERE id = 1').get()
      return true
    }
    catch {
      return false
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  getPhoto(id: string) {
    const row = this.database.prepare('SELECT * FROM photos WHERE id = ?').get(id) as PhotoRow | undefined
    return row ? photoFromRow(row) : null
  }

  list(publicOnly = false) {
    const rows = this.database.prepare(`SELECT * FROM photos ${publicOnly ? 'WHERE visible = 1' : ''} ORDER BY position ASC, createdAt DESC, id ASC`).all() as PhotoRow[]
    return rows.map(photoFromRow)
  }

  settings(): Settings {
    return this.database.prepare('SELECT mode, intervalSeconds, heroPhotoId FROM settings WHERE id = 1').get() as unknown as Settings
  }

  async upload(bytes: Buffer): Promise<Photo> {
    if (!bytes.length || bytes.length > maxUploadBytes)
      throw new GalleryError(bytes.length ? 413 : 400, bytes.length ? 'photo_too_large' : 'empty_photo')

    // Recognize common HEIC brands even on hosts without an HEVC decoder.
    if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp'
      && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(bytes.toString('ascii', 8, 12)))
      throw new GalleryError(415, 'unsupported_photo_type')

    const decoder = sharp(bytes, { limitInputPixels: maxPixels, failOn: 'error', animated: false })
    let full: Buffer
    let thumbnail: Buffer
    let width: number
    let height: number
    try {
      const metadata = await decoder.metadata()
      const allowed = ['jpeg', 'png', 'webp'].includes(metadata.format ?? '')
        || (metadata.format === 'heif' && metadata.compression === 'av1')
      if (!allowed) throw new GalleryError(415, 'unsupported_photo_type')
      if (!metadata.width || !metadata.height || metadata.width > maxDimension || metadata.height > maxDimension
        || metadata.width * metadata.height > maxPixels || (metadata.pages ?? 1) > 1)
        throw new GalleryError(400, 'unsupported_photo_dimensions')

      const processed = await decoder.rotate().resize({ width: 2600, height: 2600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 86, effort: 4 }).timeout({ seconds: 20 }).toBuffer({ resolveWithObject: true })
      full = processed.data
      width = processed.info.width
      height = processed.info.height
      thumbnail = await sharp(full).resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78, effort: 3 }).timeout({ seconds: 10 }).toBuffer()
    }
    catch (error) {
      if (error instanceof GalleryError) throw error
      if (error instanceof Error && error.message.includes('Input image exceeds pixel limit'))
        throw new GalleryError(400, 'unsupported_photo_dimensions')
      throw new GalleryError(400, 'invalid_photo')
    }

    const id = randomUUID()
    const photoDirectory = resolve(this.photosDirectory, id)
    await mkdir(photoDirectory, { mode: 0o700 })
    try {
      await writeFile(resolve(photoDirectory, 'original'), bytes, { mode: 0o600, flag: 'wx' })
      await writeFile(resolve(photoDirectory, 'full.webp'), full, { mode: 0o600, flag: 'wx' })
      await writeFile(resolve(photoDirectory, 'thumb.webp'), thumbnail, { mode: 0o600, flag: 'wx' })
      this.database.prepare(`INSERT INTO photos (id, alt, width, height, position, createdAt)
        VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM photos), ?)`) 
        .run(id, 'Kya', width, height, new Date().toISOString())
    }
    catch (error) {
      await rm(photoDirectory, { recursive: true, force: true })
      throw error
    }
    return this.getPhoto(id)!
  }

  updatePhoto(id: string, input: unknown): Photo {
    const current = this.getPhoto(id)
    if (!current) throw new GalleryError(404, 'photo_not_found')
    const patch = record(input)
    if (!Object.keys(patch).length || Object.keys(patch).some(key => !['alt', 'visible', 'featured', 'position'].includes(key)))
      throw new GalleryError(400, 'invalid_photo_update')
    if ('alt' in patch && (typeof patch.alt !== 'string' || patch.alt.length > 300 || /[\u0000-\u001F\u007F]/.test(patch.alt)))
      throw new GalleryError(400, 'invalid_alt')
    for (const key of ['visible', 'featured']) {
      if (key in patch && typeof patch[key] !== 'boolean') throw new GalleryError(400, 'invalid_photo_update')
    }
    if ('position' in patch && (!Number.isSafeInteger(patch.position) || Number(patch.position) < 0 || Number(patch.position) > 1_000_000))
      throw new GalleryError(400, 'invalid_position')
    const next = { ...current, ...patch } as Photo
    if (patch.visible === false) next.featured = false
    if (next.featured && !next.visible) throw new GalleryError(400, 'featured_photo_must_be_visible')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE photos SET alt = ?, visible = ?, featured = ?, position = ? WHERE id = ?')
        .run(next.alt.trim(), Number(next.visible), Number(next.featured), next.position, id)
      if (!next.visible || !next.featured)
        this.database.prepare('UPDATE settings SET heroPhotoId = NULL WHERE heroPhotoId = ?').run(id)
      this.database.exec('COMMIT')
    }
    catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getPhoto(id)!
  }

  updateSettings(input: unknown): Settings {
    const patch = record(input)
    if (!Object.keys(patch).length || Object.keys(patch).some(key => !['mode', 'intervalSeconds', 'heroPhotoId'].includes(key)))
      throw new GalleryError(400, 'invalid_settings')
    if ('mode' in patch && patch.mode !== 'static' && patch.mode !== 'cycle') throw new GalleryError(400, 'invalid_mode')
    if ('intervalSeconds' in patch && (!Number.isSafeInteger(patch.intervalSeconds) || Number(patch.intervalSeconds) < 3 || Number(patch.intervalSeconds) > 3600))
      throw new GalleryError(400, 'invalid_interval')
    if ('heroPhotoId' in patch && patch.heroPhotoId !== null) {
      if (typeof patch.heroPhotoId !== 'string') throw new GalleryError(400, 'invalid_hero_photo')
      const photo = this.getPhoto(patch.heroPhotoId)
      if (!photo || !photo.visible || !photo.featured) throw new GalleryError(400, 'hero_photo_must_be_featured')
    }
    const next = { ...this.settings(), ...patch } as Settings
    this.database.prepare('UPDATE settings SET mode = ?, intervalSeconds = ?, heroPhotoId = ? WHERE id = 1')
      .run(next.mode, next.intervalSeconds, next.heroPhotoId)
    return this.settings()
  }

  mediaPath(photo: Photo, variant: string) {
    if (variant !== 'thumb.webp' && variant !== 'full.webp') throw new GalleryError(404, 'photo_not_found')
    const path = resolve(this.photosDirectory, photo.id, variant)
    try {
      if (!statSync(path).isFile()) throw new Error('missing')
    }
    catch {
      throw new GalleryError(404, 'photo_not_found')
    }
    return path
  }
}
