#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$root"
python3 -B scripts/check-unimport-source.py
npm ci --prefix vendor/unimport/build --workspaces=false --include=optional --strict-allow-scripts
npm audit --prefix vendor/unimport/build --workspaces=false --audit-level=low
npm audit --prefix vendor/unimport/build --workspaces=false --omit=dev --audit-level=low
npm audit signatures --prefix vendor/unimport/build --workspaces=false
python3 -B scripts/build-unimport-source.py --check
