import type { Handler, HandlerResponse } from '@netlify/functions'
import serverless from 'serverless-http'

import { createApp } from '../../back-end/src/app.js'

const expressHandler = serverless(createApp({ trustProxyHops: 1 }))

export const handler: Handler = async (event, context) => {
  return await expressHandler(event, context) as HandlerResponse
}
