import { isAbsolute, resolve } from 'node:path'
import { validImportTokenHash, validPasswordHash } from './auth.js'

export interface GalleryEnvironment {
  NODE_ENV?: string
  PHOTO_DATA_DIR?: string
  ADMIN_PASSWORD_HASH?: string
  PHOTO_IMPORT_TOKEN_SHA256?: string
  ALLOWED_ORIGINS?: string
}

export function readGalleryConfig(environment: GalleryEnvironment = process.env) {
  const production = environment.NODE_ENV === 'production'
  const passwordHash = environment.ADMIN_PASSWORD_HASH || ''
  const importTokenHash = environment.PHOTO_IMPORT_TOKEN_SHA256 || ''
  if (importTokenHash && !validImportTokenHash(importTokenHash))
    throw new Error('PHOTO_IMPORT_TOKEN_SHA256 must contain a 64-character SHA-256 hex digest')
  if ((production || passwordHash) && !validPasswordHash(passwordHash))
    throw new Error('ADMIN_PASSWORD_HASH must contain a supported scrypt password hash')
  if (production && (!environment.PHOTO_DATA_DIR || !isAbsolute(environment.PHOTO_DATA_DIR)))
    throw new Error('PHOTO_DATA_DIR must be an absolute persistent directory in production')
  if (production && !environment.ALLOWED_ORIGINS)
    throw new Error('ALLOWED_ORIGINS is required in production')
  const allowedOrigins = (environment.ALLOWED_ORIGINS || 'http://localhost:3333,http://127.0.0.1:3333')
    .split(',').map(value => value.trim()).filter(Boolean)
  if (!allowedOrigins.length) throw new Error('ALLOWED_ORIGINS must contain at least one origin')
  for (const origin of allowedOrigins) {
    const url = new URL(origin)
    if (url.origin !== origin || url.username || url.password || !['http:', 'https:'].includes(url.protocol)
      || (production && url.protocol !== 'https:'))
      throw new Error('ALLOWED_ORIGINS must contain exact HTTP origins (HTTPS in production)')
  }
  return {
    dataDirectory: resolve(environment.PHOTO_DATA_DIR || './data'),
    passwordHash,
    importTokenHash: importTokenHash.toLowerCase(),
    allowedOrigins,
    secureCookies: production,
  }
}
