import { createServer } from 'node:http'
import process from 'node:process'
import 'dotenv/config'

import { createApp } from './app.js'
import { readServerConfig } from './server-config.js'
import { readGalleryConfig } from './gallery-config.js'
import { PhotoStore } from './photo-store.js'

async function main() {
  const { host, port, trustProxyHops } = readServerConfig()
  const galleryConfig = readGalleryConfig()
  const store = new PhotoStore(galleryConfig.dataDirectory)
  let isShuttingDown = false
  const server = createServer(createApp({
    trustProxyHops, store, ...galleryConfig,
    isReady: () => store.isReady(),
    isStopping: () => isShuttingDown,
  }))

  server.headersTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 100
  server.maxRequestsPerSocket = 1_000
  server.maxConnections = 256
  server.requestTimeout = 120_000

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })

  console.log(`API listening at http://${host}:${port}`)

  const shutdown = (signal: NodeJS.Signals) => {
    if (isShuttingDown)
      return

    isShuttingDown = true
    console.log(`${signal} received; closing the API server`)

    const forceTimer = setTimeout(() => {
      console.error('Graceful shutdown timed out; closing active connections')
      server.closeAllConnections()
      process.exitCode = 1
    }, 10_000)
    forceTimer.unref()

    server.close((error) => {
      clearTimeout(forceTimer)
      store.close()
      if (error) {
        console.error('Graceful shutdown failed:', error)
        process.exitCode = 1
        return
      }

      console.log('API shutdown complete')
    })
    server.closeIdleConnections()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error) => {
  console.error('Unable to start the API:', error)
  process.exitCode = 1
})
