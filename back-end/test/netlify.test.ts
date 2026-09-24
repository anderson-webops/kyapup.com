import type { HandlerContext, HandlerEvent, HandlerResponse } from '@netlify/functions'
import { describe, expect, it } from 'vitest'

import { handler } from '../../netlify/functions/api.js'

describe('Netlify API adapter', () => {
  it('runs the same Express health route through the function boundary', async () => {
    const event = {
      body: null,
      headers: { host: 'template.example' },
      httpMethod: 'GET',
      isBase64Encoded: false,
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
      path: '/api/health',
      queryStringParameters: null,
      rawQuery: '',
      rawUrl: 'https://template.example/api/health',
      requestContext: {
        identity: { sourceIp: '127.0.0.1' },
      },
    } as unknown as HandlerEvent

    const response = await handler(event, {} as HandlerContext) as HandlerResponse

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body || '{}')).toEqual({ ok: true })
    expect(response.headers?.['access-control-allow-origin']).toBeUndefined()
  })
})
