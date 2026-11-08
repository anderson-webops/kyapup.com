import { defineConfig } from 'taze'
import { npmOverridesManifest } from './scripts/npm-overrides-manifest.mjs'

export default defineConfig({
  manifests: [npmOverridesManifest],
})
