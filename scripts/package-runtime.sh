#!/usr/bin/env bash
# Package already validated, compiled exact source away from the production host.
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
cd -- "$root"
test "$(uname -s)" = Linux
test "$(uname -m)" = aarch64
test "$(node --version)" = v24.18.1
test "$(npm --version)" = 12.0.2
test -z "$(git status --porcelain)"
commit=$(git rev-parse HEAD)
output=$(realpath "${1:?Pass an empty output directory under .ai-work/runs}")
case "$output/" in "$root/.ai-work/runs/"*) ;; *) echo 'Output must be owned repository scratch' >&2; exit 1;; esac
test -z "$(find "$output" -mindepth 1 -maxdepth 1 -print -quit)"
stage="$output/stage"
mkdir -p "$stage/back-end" "$stage/front-end/.output"
export VITESSE_RELEASE
VITESSE_RELEASE="v$(node -p 'require("./package.json").version')"
export VITESSE_COMMIT_SHA="$commit"
export VITESSE_DEPLOYED_AT
VITESSE_DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
node scripts/write-release-metadata.mjs
cp package.json package-lock.json .vitesse-release-prepared.json "$stage/"
cp back-end/package.json back-end/package-lock.json "$stage/back-end/"
cp front-end/package.json "$stage/front-end/"
cp -R back-end/dist "$stage/back-end/"
cp -R front-end/.output/public "$stage/front-end/.output/"
npm ci --prefix "$stage/back-end" --omit=dev --include=optional --workspaces=false --ignore-scripts --no-fund --no-audit
npm audit --prefix "$stage/back-end" --omit=dev --audit-level=low
npm audit --prefix "$stage/back-end" --audit-level=low
npm audit signatures --prefix "$stage/back-end"
npm ls --prefix "$stage/back-end" --omit=dev --all > "$output/dependency-tree.txt"
# This reviewed JS-only runtime has no executable dependency bins. The verifier
# rejects any other symlinks; it never follows links into a source checkout.
rm -rf -- "$stage/back-end/node_modules/.bin"
archive="$output/vitesse-nuxt-template-$VITESSE_RELEASE-${commit:0:12}-linux-arm64.tar.gz"
python3 -B scripts/runtime-artifact.py pack "$stage" --archive "$archive" --commit "$commit" > "$output/pack.json"
sha=$(sha256sum "$archive" | cut -d ' ' -f 1)
printf '%s  %s\n' "$sha" "$(basename "$archive")" > "$output/SHA256SUMS"
cp "$stage/runtime-manifest.json" "$output/runtime-manifest.json"
mkdir "$output/unpacked"
python3 -B scripts/runtime-artifact.py unpack "$output/unpacked" --archive "$archive" --sha256 "$sha" --commit "$commit"
bash scripts/test-unpacked-artifact.sh "$output/unpacked"
cp -R "$output/unpacked" "$output/copied"
python3 -B scripts/runtime-artifact.py verify "$output/copied" --archive "$archive" --sha256 "$sha" --commit "$commit"
bash scripts/test-unpacked-artifact.sh "$output/copied"
rm -- "$output/copied/back-end/dist/boundedRateStore.js"
if python3 -B scripts/runtime-artifact.py verify "$output/copied" --archive "$archive" --sha256 "$sha" --commit "$commit"; then
  echo 'Missing runtime module was incorrectly accepted' >&2
  exit 1
fi
bash scripts/test-unpacked-artifact.sh "$output/copied" missing-module
python3 -B - "$output" <<'PY'
import datetime
import hashlib
import json
from pathlib import Path
import sys
output = Path(sys.argv[1])
receipt = json.loads((output / "pack.json").read_text())
receipt["acceptedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
receipt["bytes"] = (output / receipt["archive"]).stat().st_size
receipt["checks"] = ["production-only locked install", "full and production backend audits", "registry signatures", "manifest and required paths", "isolated unpacked runtime", "readiness failure and recovery", "GET and HEAD minimal probes", "repeated-signal drain", "restart", "post-copier verification", "missing-module rejection"]
receipt["harnessSha256"] = {
    name: hashlib.sha256(Path(name).read_bytes()).hexdigest()
    for name in ["deploy/runtime-artifact.json", "scripts/runtime-artifact.py", "scripts/package-runtime.sh", "scripts/test-unpacked-artifact.sh", "scripts/direct-runtime-smoke.mjs", "scripts/artifact-acceptance/runtime.mjs", "scripts/write-release-metadata.mjs", "deploy/systemd/install-service.sh", "deploy/systemd/promote-release.sh", "deploy/systemd/trusted-paths.py", "scripts/test-promotion-recovery.py", "scripts/test-promotion-recovery.sh", "scripts/test-bootstrap-in-vm.py"]
}
(output / "acceptance.json").write_text(json.dumps(receipt, indent=2) + "\n")
PY
echo "Exact unpacked production artifact accepted: $archive"
