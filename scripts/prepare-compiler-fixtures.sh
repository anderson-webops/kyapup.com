#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$root"
for graph in \
  vendor/schema-parents/tools \
  vendor/schema-parents/upstream \
  vendor/framework-parents/upstream \
  vendor/native-providers/upstream \
  vendor/vite-plugin-vue-devtools/upstream \
  vendor/vue-compiler/browser-tools \
  vendor/vue-compiler/upstream \
  vendor/vite-plugin-checker/upstream \
  vendor/rollup-plugins/tools \
  vendor/rollup-plugins/upstream \
  vendor/nitro-tools/upstream \
  vendor/nitro-tools/current \
  vendor/nft/upstream \
  vendor/watchers/upstream; do
  npm ci --prefix "$graph" --workspaces=false --include=optional --strict-allow-scripts
done
