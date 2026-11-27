#!/usr/bin/env bash
set -euo pipefail
umask 022
case "$(uname -sm)" in
  "Linux x86_64") arch=x64; digest=5c063e46bab0fbc1c17cc445d7ff129cbdcd0471be6ed83b6ab864f8143bc864 ;;
  "Linux aarch64") arch=arm64; digest=89e1853138db51e8b82d3e98ba9c0d3f2956a28e5e55ea1b7e12d25aae92d5dd ;;
  *) echo 'Expected a supported Linux build runner' >&2; exit 1 ;;
esac
version="$(cat .node-version)"
stage="$(mktemp -d "${RUNNER_TEMP:?}/vitesse-node.XXXXXX")"
dist="node-v${version#v}-linux-$arch"
archive="$stage/$dist.tar.xz"
curl --fail --silent --show-error --location --proto '=https' --retry 3 --max-time 90 \
  --output "$archive" "https://nodejs.org/dist/v${version#v}/$dist.tar.xz"
printf '%s  %s\n' "$digest" "$archive" | sha256sum --check --strict
tar -xJf "$archive" -C "$stage" --no-same-owner --no-same-permissions
printf '%s\n' "$stage/$dist/bin" >> "${GITHUB_PATH:?}"
