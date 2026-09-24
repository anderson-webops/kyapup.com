import process from 'node:process'
import { appDescription } from './src/constants/index'

const devApiOrigin = process.env.DEV_API_ORIGIN || 'http://127.0.0.1:3006'

export default defineNuxtConfig({
  modules: [
    'nuxt-security',
    '@vueuse/nuxt',
    '@unocss/nuxt',
    '@pinia/nuxt',
    '@nuxtjs/color-mode',
    '@nuxt/eslint',
  ],

  devtools: {
    enabled: process.env.NODE_ENV !== 'production'
      && process.env.CI !== 'true'
      && process.env.NUXT_A11Y_SCAN !== 'true',
  },

  app: {
    head: {
      viewport: 'width=device-width,initial-scale=1',
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: 'any' },
        { rel: 'icon', type: 'image/svg+xml', href: '/nuxt.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      ],
      meta: [
        { name: 'description', content: appDescription },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'theme-color', media: '(prefers-color-scheme: light)', content: 'white' },
        { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: '#222222' },
      ],
    },
  },

  colorMode: {
    classSuffix: '',
  },

  runtimeConfig: {
    public: {
      apiBaseUrl: '/api',
    },
  },

  srcDir: 'src',

  routeRules: {
    '/**': {
      headers: {
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'origin-agent-cluster': '?1',
        'permissions-policy': 'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), web-share=(), xr-spatial-tracking=()',
      },
    },
    '/_nuxt/**': {
      headers: {
        'cache-control': 'public, max-age=31536000, immutable',
      },
    },
    '/healthz': {
      headers: {
        'cache-control': 'no-store',
      },
    },
  },

  sourcemap: {
    client: false,
    server: false,
  },

  future: {
    compatibilityVersion: 4,
  },

  experimental: {
    payloadExtraction: true,
    renderJsonPayloads: true,
    typedPages: true,
  },

  compatibilityDate: '2026-07-24',

  nitro: {
    compressPublicAssets: true,
    prerender: {
      crawlLinks: false,
      routes: ['/'],
      ignore: ['/hi'],
    },
  },

  vite: {
    server: {
      proxy: {
        '/api': {
          changeOrigin: false,
          target: devApiOrigin,
        },
      },
    },
  },

  eslint: {
    config: {
      standalone: false,
      nuxt: {
        sortConfigKeys: true,
      },
    },
  },

  security: {
    strict: true,
    allowedMethodsRestricter: {
      methods: ['GET', 'HEAD', 'OPTIONS'],
      throwError: true,
    },
    corsHandler: false,
    csrf: false,
    headers: {
      contentSecurityPolicy: {
        'base-uri': ['\'none\''],
        'connect-src': ['\'self\''],
        'default-src': ['\'none\''],
        'font-src': ['\'self\'', 'data:'],
        'form-action': ['\'self\''],
        'frame-ancestors': ['\'none\''],
        'frame-src': ['\'none\''],
        'img-src': ['\'self\'', 'data:'],
        'manifest-src': ['\'self\''],
        'media-src': ['\'self\''],
        'object-src': ['\'none\''],
        'script-src': ['\'self\'', '\'strict-dynamic\'', '\'nonce-{{nonce}}\''],
        'script-src-attr': ['\'none\''],
        'style-src': ['\'self\'', '\'nonce-{{nonce}}\''],
        'upgrade-insecure-requests': true,
        'worker-src': ['\'self\''],
      },
      crossOriginEmbedderPolicy: 'require-corp',
      crossOriginOpenerPolicy: 'same-origin',
      crossOriginResourcePolicy: 'same-origin',
      permissionsPolicy: {
        'accelerometer': [],
        'autoplay': [],
        'camera': [],
        'display-capture': [],
        'encrypted-media': [],
        'fullscreen': [],
        'geolocation': [],
        'gyroscope': [],
        'magnetometer': [],
        'microphone': [],
        'midi': [],
        'payment': [],
        'picture-in-picture': [],
        'publickey-credentials-get': [],
        'screen-wake-lock': [],
        'usb': [],
        'web-share': [],
        'xr-spatial-tracking': [],
      },
      referrerPolicy: 'strict-origin-when-cross-origin',
      strictTransportSecurity: {
        includeSubdomains: false,
        maxAge: 31_536_000,
        preload: false,
      },
      xContentTypeOptions: 'nosniff',
      xFrameOptions: 'DENY',
    },
    hidePoweredBy: true,
    nonce: true,
    rateLimiter: false,
    removeLoggers: false,
    requestSizeLimiter: false,
    sri: true,
    xssValidator: {
      throwError: true,
    },
  },
})
