#!/usr/bin/env bash
set -euo pipefail
artifact=$(realpath "${1:?Pass exact unpacked artifact}")
case_name=${2:-complete}
[[ "$case_name" == complete || "$case_name" == missing-module ]]
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
node=$(realpath "$(command -v node)")
test "$(id -u)" -ne 0
test "$(uname -s)" = Linux
test "$(uname -m)" = aarch64
test "$(node --version)" = v24.18.1
if [[ "$case_name" == complete ]]; then
  python3 -B "$script_dir/runtime-artifact.py" verify "$artifact"
fi
timeout -k 5 90 bwrap --unshare-all --die-with-parent --new-session \
  --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib \
  --ro-bind "$node" /runtime/node --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind "$artifact" /app \
  --ro-bind "$script_dir/artifact-acceptance/runtime.mjs" /harness/runtime.mjs \
  --ro-bind "$script_dir/direct-runtime-smoke.mjs" /harness/direct-runtime-smoke.mjs \
  --clearenv --setenv PATH /runtime:/usr/bin:/bin --setenv HOME /tmp \
  --chdir /app /runtime/node /harness/runtime.mjs "$case_name"
if [[ "$case_name" == complete ]]; then
  python3 -B "$script_dir/runtime-artifact.py" verify "$artifact"
fi
