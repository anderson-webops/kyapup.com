#!/usr/bin/env bash
set -euo pipefail
root=$(cd -- "$(dirname -- "$0")/.." && pwd)
output=$(realpath "${1:?Pass the current artifact qualification directory}")
case "$output/" in "$root/.ai-work/runs/"*) ;; *) echo 'Retained runtime evidence must remain in owning repository scratch.' >&2; exit 1;; esac
test "$(id -u)" -ne 0
test "$(uname -s)" = Linux
test "$(uname -m)" = aarch64
node=$(realpath "$(command -v node)")
test "$("$node" --version)" = v26.13.1
commit=b3bc70a5865ed913b490750602e56206114a6da1
sha=a4f1734e159233d824d393d05091ac07c8b16968c2a46dddfe3231227f14cf93
archive_name=kyapup-v1.2.4-b3bc70a5865e-linux-arm64.tar.gz
prior="$output/retained-v1.2.4"
mkdir -m 700 "$prior" "$prior/source" "$prior/runtime"
git -C "$root" archive "$commit" scripts/runtime-artifact.py deploy/runtime-artifact.json | tar -x -C "$prior/source"
printf '%s  %s\n' \
  62be9542bff68d1bcd1467bb255fe9bc1a4d12d9c036682af80d29254465efe4 "$prior/source/scripts/runtime-artifact.py" \
  bdb739402d098074951c9e0e825b3c5ab469ab7276ede7cf8e6859bf01045e85 "$prior/source/deploy/runtime-artifact.json" | sha256sum --check
curl --fail --location --proto '=https' --proto-redir '=https' \
  --retry 2 --connect-timeout 15 --max-time 120 \
  "https://github.com/anderson-webops/kyapup.com/releases/download/v1.2.4/$archive_name" \
  --output "$prior/$archive_name"
python3 -B "$prior/source/scripts/runtime-artifact.py" unpack "$prior/runtime" \
  --archive "$prior/$archive_name" --sha256 "$sha" --commit "$commit"
loader_mounts=()
if test -d /usr/lib64; then
  loader_mounts=(--symlink usr/lib64 /lib64)
fi
timeout -k 5 90 bwrap --unshare-all --die-with-parent --new-session \
  --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib "${loader_mounts[@]}" \
  --ro-bind "$node" /runtime/node --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind "$prior/runtime" /app \
  --ro-bind "$root/scripts/artifact-acceptance/runtime.mjs" /harness/runtime.mjs \
  --ro-bind "$root/scripts/direct-runtime-smoke.mjs" /harness/direct-runtime-smoke.mjs \
  --clearenv --setenv PATH /runtime:/usr/bin:/bin --setenv HOME /tmp \
  --chdir /app /runtime/node /harness/runtime.mjs retained-v1.2.4
python3 -B "$prior/source/scripts/runtime-artifact.py" verify "$prior/runtime" \
  --archive "$prior/$archive_name" --sha256 "$sha" --commit "$commit"
