import type * as modern from './dist/index.js' with { 'resolution-mode': 'import' }

declare const encodeUrl: typeof modern.encodeUrl & typeof modern

export = encodeUrl
