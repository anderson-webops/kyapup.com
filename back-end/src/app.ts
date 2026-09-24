import type { NextFunction, Request, Response } from 'express'
import { basename, dirname } from 'node:path'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { Sessions, verifyImportToken, verifyPassword } from './auth.js'
import { BoundedRateStore } from './boundedRateStore.js'
import { GalleryError, maxUploadBytes, PhotoStore, readImportIdentity } from './photo-store.js'

const allowedMethods = ['GET', 'HEAD', 'OPTIONS'] as const
const allowHeader = allowedMethods.join(', ')
const sessionCookie = 'kya_session'
const sessionLifetime = 12 * 60 * 60 * 1000

export interface AppOptions {
  trustProxyHops?: number
  isReady?: () => boolean
  isStopping?: () => boolean
  store?: PhotoStore
  passwordHash?: string
  importTokenHash?: string
  allowedOrigins?: string[]
  secureCookies?: boolean
}

function validateTrustProxyHops(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2)
    throw new RangeError('trustProxyHops must be an integer between 0 and 2')
}

function sessionId(request: Request) {
  const match = /(?:^|;\s*)kya_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie ?? '')
  return match?.[1]
}

export function createApp(options: AppOptions = {}) {
  const trustProxyHops = options.trustProxyHops ?? 0
  validateTrustProxyHops(trustProxyHops)
  const sessions = new Sessions(sessionLifetime)
  const origins = new Set(options.allowedOrigins ?? [])
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: options.secureCookies ?? process.env.NODE_ENV === 'production',
    path: '/api',
  }
  const app = express()
  app.disable('etag')
  app.disable('x-powered-by')
  app.set('query parser', 'simple')
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops)

  app.use(helmet({
    contentSecurityPolicy: {
      directives: { baseUri: ["'none'"], defaultSrc: ["'none'"], formAction: ["'none'"], frameAncestors: ["'none'"] },
      useDefaults: false,
    },
    strictTransportSecurity: { includeSubDomains: false, maxAge: 31_536_000, preload: false },
    xFrameOptions: { action: 'deny' },
  }))
  app.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store')
    next()
  })

  const stopping = options.isStopping ?? (() => false)
  const ready = options.isReady ?? (() => options.store?.isReady() ?? false)
  const probe = (healthy: boolean): express.RequestHandler => (request, response) => {
    let ok = healthy
    if (!healthy) {
      try { ok = !stopping() && ready() }
      catch { ok = false }
    }
    response.status(ok ? 200 : 503)
    return request.method === 'HEAD' ? response.end() : response.json({ ok })
  }
  for (const route of ['/healthz', '/api/healthz', '/api/health']) {
    app.head(route, probe(true))
    app.get(route, probe(true))
  }
  for (const route of ['/readyz', '/api/readyz']) {
    app.head(route, probe(false))
    app.get(route, probe(false))
  }
  app.use((_request, response, next) => {
    if (stopping()) {
      response.set('Retry-After', '5').status(503).json({ error: 'service_stopping' })
      return
    }
    next()
  })
  app.use('/api', (request, response, next) => {
    if (request.method === 'OPTIONS') {
      const methods = request.path.startsWith('/admin/') ? 'GET, HEAD, POST, PATCH, OPTIONS'
        : request.path === '/import/photos' ? 'POST, OPTIONS' : allowHeader
      response.set('Allow', methods).status(204).end()
      return
    }
    next()
  })
  app.use('/api', rateLimit({
    store: new BoundedRateStore(), legacyHeaders: false, limit: 300, passOnStoreError: false,
    standardHeaders: 'draft-8', windowMs: 60_000, message: { error: 'too_many_requests' },
  }))

  const requireOrigin = (request: Request, _response: Response, next: NextFunction) => {
    if (!origins.has(request.get('Origin') ?? '')) throw new GalleryError(403, 'origin_not_allowed')
    next()
  }
  const clearStaleCookie = (request: Request, response: Response) => {
    if (/(?:^|;\s*)kya_session=/.test(request.headers.cookie ?? ''))
      response.clearCookie(sessionCookie, cookieOptions)
  }
  const requireSession = (request: Request, response: Response, next: NextFunction) => {
    if (!sessions.get(sessionId(request))) {
      clearStaleCookie(request, response)
      throw new GalleryError(401, 'authentication_required')
    }
    next()
  }
  const requireCsrf = (request: Request, _response: Response, next: NextFunction) => {
    const session = sessions.get(sessionId(request))
    if (!session || request.get('X-CSRF-Token') !== session.csrfToken) throw new GalleryError(403, 'invalid_csrf_token')
    next()
  }
  const requireImportToken = (request: Request, response: Response, next: NextFunction) => {
    if (!options.importTokenHash) throw new GalleryError(503, 'import_not_configured')
    if (!verifyImportToken(request.get('Authorization'), options.importTokenHash)) {
      response.set('WWW-Authenticate', 'Bearer')
      throw new GalleryError(401, 'import_authentication_required')
    }
    next()
  }
  const store = () => {
    if (!options.store || !options.store.isReady()) throw new GalleryError(503, 'gallery_unavailable')
    return options.store
  }
  const json = express.json({ limit: '8kb', strict: true, inflate: false })

  app.get('/api/gallery', (_request, response) => {
    const library = store()
    response.json({ photos: library.list(true), settings: library.settings() })
  })
  app.get('/api/admin/session', (request, response) => {
    const session = sessions.get(sessionId(request))
    if (!session) clearStaleCookie(request, response)
    response.json(session ? { authenticated: true, csrfToken: session.csrfToken } : { authenticated: false })
  })
  app.post('/api/admin/login', requireOrigin, rateLimit({
    store: new BoundedRateStore(), legacyHeaders: false, limit: 10, windowMs: 15 * 60_000,
    standardHeaders: 'draft-8', passOnStoreError: false, message: { error: 'too_many_login_attempts' },
  }), json, async (request, response) => {
    if (!options.passwordHash) throw new GalleryError(503, 'admin_not_configured')
    const password: unknown = request.body?.password
    if (typeof password !== 'string' || !password.length || password.length > 1024)
      throw new GalleryError(400, 'invalid_password')
    if (!await verifyPassword(password, options.passwordHash)) throw new GalleryError(401, 'incorrect_password')
    sessions.remove(sessionId(request))
    const session = sessions.create()
    response.cookie(sessionCookie, session.id, { ...cookieOptions, maxAge: sessionLifetime })
    response.json({ authenticated: true, csrfToken: session.csrfToken })
  })
  app.post('/api/admin/logout', requireSession, requireOrigin, requireCsrf, (request, response) => {
    sessions.remove(sessionId(request))
    response.clearCookie(sessionCookie, cookieOptions)
    response.json({ authenticated: false })
  })
  app.get('/api/admin/library', requireSession, (_request, response) => {
    const library = store()
    response.json({ photos: library.list(), settings: library.settings() })
  })
  app.get('/api/import/status', requireImportToken, (request, response) => {
    const photo = store().findImport(readImportIdentity(request.query))
    response.json(photo ? { exists: true, photo } : { exists: false })
  })

  let uploadsInFlight = 0
  const uploadBody = express.raw({ type: 'application/octet-stream', limit: maxUploadBytes, inflate: false })
  const receivePhoto = (
    save: (request: Request, bytes: Buffer) => Promise<{ status: number, body: unknown }>,
  ): express.RequestHandler => (request, response, next) => {
    if (!request.is('application/octet-stream')) throw new GalleryError(415, 'upload_requires_octet_stream')
    if (uploadsInFlight >= 2) throw new GalleryError(503, 'upload_busy')
    uploadsInFlight++
    let processing = false
    let released = false
    const release = () => {
      if (released) return
      released = true
      uploadsInFlight--
    }
    response.once('close', () => { if (!processing) release() })
    uploadBody(request, response, (error: unknown) => {
      if (error) { release(); next(error); return }
      if (response.destroyed) { release(); return }
      processing = true
      void (async () => {
        try {
          if (!Buffer.isBuffer(request.body)) throw new GalleryError(400, 'empty_photo')
          const result = await save(request, request.body)
          response.status(result.status).json(result.body)
        }
        catch (error) { next(error) }
        finally { release() }
      })()
    })
  }
  app.post('/api/admin/photos', requireSession, requireOrigin, requireCsrf,
    receivePhoto(async (_request, bytes) => ({ status: 201, body: await store().upload(bytes) })))
  app.post('/api/import/photos', requireImportToken, (request, _response, next) => {
    readImportIdentity(request.query)
    next()
  }, receivePhoto(async (request, bytes) => {
    const result = await store().importPhoto(readImportIdentity(request.query), bytes)
    return { status: result.created ? 201 : 200, body: result }
  }))
  app.patch('/api/admin/photos/:id', requireSession, requireOrigin, requireCsrf, json, (request, response) => {
    response.json(store().updatePhoto(String(request.params.id), request.body))
  })
  app.patch('/api/admin/settings', requireSession, requireOrigin, requireCsrf, json, (request, response) => {
    response.json(store().updateSettings(request.body))
  })
  app.get('/api/media/:id/:variant', (request, response, next) => {
    const library = store()
    const photo = library.getPhoto(String(request.params.id))
    // Unknown and private photos have the same public response.
    if (!photo || (!photo.visible && !sessions.get(sessionId(request)))) throw new GalleryError(404, 'photo_not_found')
    const path = library.mediaPath(photo, String(request.params.variant))
    response.type('image/webp')
    response.set('Content-Disposition', 'inline')
    response.sendFile(basename(path), { root: dirname(path), cacheControl: false, lastModified: false, dotfiles: 'deny' }, (error) => {
      if (error) next(error)
    })
  })

  app.use('/api', (request, response, next) => {
    if (!allowedMethods.includes(request.method as typeof allowedMethods[number])) {
      response.set('Allow', allowHeader).status(405).json({ error: 'method_not_allowed' })
      return
    }
    next()
  })
  app.use((_request, response) => response.status(404).json({ error: 'not_found' }))
  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) { next(error); return }
    if (error instanceof GalleryError) { response.status(error.status).json({ error: error.code }); return }
    const bodyError = error as { type?: string }
    if (bodyError?.type === 'entity.too.large') { response.status(413).json({ error: 'request_too_large' }); return }
    if (bodyError?.type === 'entity.parse.failed') { response.status(400).json({ error: 'invalid_json' }); return }
    if (bodyError?.type === 'encoding.unsupported' || bodyError?.type === 'charset.unsupported') { response.status(415).json({ error: 'unsupported_encoding' }); return }
    response.status(500).json({ error: 'internal_server_error' })
  })
  return app
}
