import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import { BoundedRateStore } from './boundedRateStore.js'

const allowedMethods = ['GET', 'HEAD', 'OPTIONS'] as const
const allowHeader = allowedMethods.join(', ')

export interface AppOptions {
  trustProxyHops?: number
  isReady?: () => boolean
  isStopping?: () => boolean
}

function validateTrustProxyHops(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2)
    throw new RangeError('trustProxyHops must be an integer between 0 and 2')
}

export function createApp(options: AppOptions = {}) {
  const trustProxyHops = options.trustProxyHops ?? 0
  validateTrustProxyHops(trustProxyHops)

  const app = express()

  app.disable('etag')
  app.disable('x-powered-by')
  app.set('query parser', 'simple')
  if (trustProxyHops > 0)
    app.set('trust proxy', trustProxyHops)

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        baseUri: ["'none'"],
        defaultSrc: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
      useDefaults: false,
    },
    strictTransportSecurity: {
      includeSubDomains: false,
      maxAge: 31_536_000,
      preload: false,
    },
    xFrameOptions: { action: 'deny' },
  }))

  app.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store')
    next()
  })

  const stopping = options.isStopping ?? (() => false)
  const ready = options.isReady ?? (() => true)
  const probe = (healthy: boolean): express.RequestHandler => (request, response) => {
    let ok = healthy
    if (!healthy) {
      try {
        ok = !stopping() && ready()
      }
      catch {
        ok = false
      }
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
      response.set('Allow', allowHeader).status(204).end()
      return
    }

    if (!allowedMethods.includes(request.method as typeof allowedMethods[number])) {
      response.set('Allow', allowHeader).status(405).json({ error: 'method_not_allowed' })
      return
    }

    next()
  })

  app.use('/api', rateLimit({
    store: new BoundedRateStore(),
    legacyHeaders: false,
    limit: 300,
    passOnStoreError: false,
    skip: request => request.path === '/health',
    standardHeaders: 'draft-8',
    windowMs: 60_000,
  }))

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'not_found' })
  })

  app.use((_request, response) => {
    response.status(404).json({ error: 'not_found' })
  })

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) {
      next(error)
      return
    }

    response.status(500).json({ error: 'internal_server_error' })
  })

  return app
}
