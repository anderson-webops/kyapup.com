#!/usr/bin/env bash
set -euo pipefail

PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH
unset NODE_OPTIONS NODE_PATH PYTHONPATH PYTHONHOME
umask 077

release_root="${RELEASE_ROOT:-/srv/kyapup/releases}"
current_link="${CURRENT_LINK:-/srv/kyapup/current}"
service_name="${SERVICE_NAME:-kyapup-api.service}"
health_url="${HEALTH_URL:-http://127.0.0.1:3006/api/health}"
public_host="${PUBLIC_HOST:-}"

if [[ $# -ne 4 ]]; then
	echo "Usage: PUBLIC_HOST=kyapup promote-release.sh <protected-release> <protected-archive> <sha256> <commit>" >&2
	exit 2
fi
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
	echo "Run promotion with root privileges." >&2
	exit 1
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
helper_root="$(cd -- "$script_dir/../.." && pwd -P)"
node_bin_dir="${NODE_BIN_DIR:-/opt/node-24.18.1/bin}"
node="$node_bin_dir/node"
archive="$2"
archive_sha="$3"
commit="$4"
if [[ ! "$archive_sha" =~ ^[0-9a-f]{64}$ || ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Pass the independently reviewed release archive digest and exact source commit.' >&2; exit 1
fi
# These checks supplement the trusted bootstrap; never run this helper from a
# build-owned checkout in the first place, since such a file can replace its guard.
/usr/bin/python3 -I "$script_dir/trusted-paths.py" \
  "$script_dir/promote-release.sh" "$script_dir/trusted-paths.py" \
  "$helper_root/scripts/runtime-artifact.py" "$helper_root/deploy/runtime-artifact.json" \
  "$node" "$archive" "$release_root" "$(dirname -- "$current_link")" --tree "$1"
if [[ ! -x "$node" || "$("$node" --version)" != v24.18.1 ]]; then
  echo 'NODE_BIN_DIR must select the approved Node24.18.1 runtime.' >&2; exit 1
fi
if [[ -z "$public_host" || ! "$public_host" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]]; then
	echo "PUBLIC_HOST must be the certificate-covered production hostname." >&2
	exit 1
fi

# Select readiness on the same service, preserving its configured port and prefix.
# shellcheck disable=SC2016 # JavaScript template syntax belongs to the Node subprocess.
readiness_url="$("$node" -e '
const health = new URL(process.argv[1])
const configured = process.argv[2]
const match = health.pathname.match(/^(.*)\/healthz?\/?$/)
if (!configured && !match) throw new Error("Set READINESS_URL for a custom health path")
const ready = new URL(configured || `${match[1]}/readyz`, health)
if (!["http:", "https:"].includes(health.protocol) || ready.origin !== health.origin
    || health.username || health.password || ready.username || ready.password
    || health.hash || ready.hash) throw new Error("Health and readiness must use the same service without credentials or fragments")
process.stdout.write(ready.href)
' "$health_url" "${READINESS_URL:-}")"

public_origin="${PUBLIC_ORIGIN:-https://$public_host}"
resolve_ipv4="${VITESSE_RESOLVE_IPV4:-$public_host:443:127.0.0.1}"
resolve_ipv6="${VITESSE_RESOLVE_IPV6:-$public_host:443:[::1]}"
release_root_real="$(cd -- "$release_root" && pwd -P)"
candidate="$(cd -- "$1" && pwd -P)"
case "$candidate/" in
	"$release_root_real/"*) ;;
	*) echo "Candidate must resolve beneath $release_root_real: $candidate" >&2; exit 1 ;;
esac
if [[ "$candidate" == "$release_root_real" ]]; then
	echo "Candidate must be a prepared release beneath, not equal to, $release_root_real." >&2
	exit 1
fi

for required_path in \
	.vitesse-release-prepared.json \
	back-end/dist/server.js \
	back-end/node_modules/express/package.json \
	front-end/.output/public/index.html \
	front-end/.output/public/release.json; do
	if [[ ! -e "$candidate/$required_path" ]]; then
		echo "Prepared release is missing $required_path." >&2
		exit 1
	fi
done
/usr/bin/python3 -I "$helper_root/scripts/runtime-artifact.py" verify "$candidate" \
  --archive "$archive" --sha256 "$archive_sha" --commit "$commit"
if [[ -e "$current_link" && ! -L "$current_link" ]]; then
	echo "Refusing to replace non-symlink deployment path: $current_link" >&2
	exit 1
fi
recovery_root="$(dirname -- "$current_link")/.deployment-recovery"
if [[ ! -e "$recovery_root" ]]; then mkdir -m 0700 -- "$recovery_root"; fi
/usr/bin/python3 -I "$script_dir/trusted-paths.py" "$recovery_root"
if [[ "$(stat -c '%a' "$recovery_root")" != 700 ]]; then
  echo 'Recovery directory must have mode0700.' >&2; exit 1
fi
exec 9>"$recovery_root/promotion.lock"
if ! flock -n 9; then echo 'Another Kya promotion is active.' >&2; exit 1; fi
if ! nginx -t; then
	echo "Nginx configuration must pass before promotion." >&2
	exit 1
fi

previous_target=""
if [[ -L "$current_link" ]]; then
	previous_target="$(readlink -f -- "$current_link" 2>/dev/null || true)"
	if [[ -z "$previous_target" ]]; then
		echo "Existing deployment symlink does not resolve: $current_link" >&2
		exit 1
	fi
	case "$previous_target/" in
		"$release_root_real/"*) ;;
		*) echo "Existing deployment target is outside $release_root_real: $previous_target" >&2; exit 1 ;;
	esac
	if [[ "$previous_target" == "$release_root_real" ]]; then
    echo 'The release parent cannot be a rollback target.' >&2; exit 1
  fi
	/usr/bin/python3 -I "$script_dir/trusted-paths.py" --tree "$previous_target"
  if [[ ! -f "$previous_target/.vitesse-release-prepared.json" ]]; then
		echo "Existing direct release is missing its rollback identity." >&2
		exit 1
	fi
fi

if [[ -z "$previous_target" ]] && systemctl is-active --quiet "$service_name"; then
  echo 'An active service without a verified current release needs operator review.' >&2; exit 1
fi
mutation_started=false
finished=false
rollback_failed=false
recovery_record="$(mktemp "$recovery_root/promotion-XXXXXXXX")"
printf '%s\n%s\n' "$previous_target" "$candidate" > "$recovery_record"
next_link="${current_link}.next.$$"
response_health="$(mktemp)"
response_release="$(mktemp)"
headers_ipv4="$(mktemp)"
headers_ipv6="$(mktemp)"
# shellcheck disable=SC2329 # Invoked by the EXIT trap below.
cleanup() {
	if [[ -L "$next_link" ]]; then unlink -- "$next_link"; fi
	rm -f -- "$response_health" "$response_release" "$headers_ipv4" "$headers_ipv6"
}
# Catch every unsuccessful exit after mutation, including interruption.
# shellcheck disable=SC2329
on_exit() {
  local status=$?
  trap - EXIT
  trap '' HUP INT TERM
  if [[ "$mutation_started" == true && "$finished" != true ]]; then
    if ! rollback; then
      rollback_failed=true
      echo "CRITICAL: rollback needs operator recovery; protected record retained at $recovery_record" >&2
    fi
    if [[ "$status" == 0 ]]; then status=1; fi
  fi
  cleanup
  if [[ "$rollback_failed" != true ]]; then rm -f -- "$recovery_record"; fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

activate_target() {
	local target="$1"
	if [[ -L "$next_link" ]]; then unlink -- "$next_link" || return 1; fi
	ln -s -- "$target" "$next_link" || return 1
	mv -Tf -- "$next_link" "$current_link"
}

identity_matches() {
	local expected="$1"
	local actual="$2"
	"$node" -e '
const fs = require("node:fs")
const expected = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const actual = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
const valid = value => value && !Array.isArray(value)
  && Object.keys(value).sort().join(",") === "commitSha,deployedAt,release"
  && /^v\d+\.\d+\.\d+$/.test(value.release)
  && /^[0-9a-f]{40}$/.test(value.commitSha)
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.deployedAt)
  && Number.isFinite(Date.parse(value.deployedAt))
  && new Date(value.deployedAt).toISOString().slice(0, 19) === value.deployedAt.slice(0, 19)
if (!valid(expected) || !valid(actual)) process.exit(1)
if (expected.release !== actual.release || expected.commitSha !== actual.commitSha || expected.deployedAt !== actual.deployedAt) process.exit(1)
' "$expected" "$actual"
}

health_is_minimal() {
	local actual="$1"
	"$node" -e '
const fs = require("node:fs")
const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
if (JSON.stringify(body) !== JSON.stringify({ ok: true })) process.exit(1)
' "$actual"
}

strict_page_headers() {
	local headers="$1"
	grep -Eiq '^Content-Security-Policy:.*frame-ancestors .none.' "$headers" \
		&& grep -Eiq '^X-Content-Type-Options:[[:space:]]*nosniff' "$headers" \
		&& grep -Eiq '^X-Frame-Options:[[:space:]]*DENY' "$headers"
}

edge_status() {
	local family="$1"
	local resolve="$2"
	local url="$3"
	shift 3
	curl --noproxy '*' "$family" --silent --show-error --max-time 5 --resolve "$resolve" \
		--output /dev/null --write-out '%{http_code}' "$@" "$url"
}

wait_for_target() {
	local target="$1"
	local marker="$target/.vitesse-release-prepared.json"
	local _attempt
	for _attempt in {1..40}; do
		if curl --noproxy '*' --fail --silent --show-error --max-time 5 "$health_url" --output "$response_health" \
			&& health_is_minimal "$response_health" \
        && readiness_matches "$target" \
			&& curl --noproxy '*' --ipv4 --fail --silent --show-error --max-time 5 --resolve "$resolve_ipv4" \
				"$public_origin/release.json" --output "$response_release" \
			&& identity_matches "$marker" "$response_release" \
			&& curl --noproxy '*' --ipv6 --fail --silent --show-error --max-time 5 --resolve "$resolve_ipv6" \
				"$public_origin/release.json" --output "$response_release" \
			&& identity_matches "$marker" "$response_release" \
			&& curl --noproxy '*' --ipv4 --fail --silent --show-error --max-time 5 --resolve "$resolve_ipv4" \
				--dump-header "$headers_ipv4" "$public_origin/" --output /dev/null \
			&& curl --noproxy '*' --ipv6 --fail --silent --show-error --max-time 5 --resolve "$resolve_ipv6" \
				--dump-header "$headers_ipv6" "$public_origin/" --output /dev/null \
			&& strict_page_headers "$headers_ipv4" \
			&& strict_page_headers "$headers_ipv6" \
			&& [[ "$(edge_status --ipv4 "$resolve_ipv4" "$public_origin/api/health" -X POST -H 'Content-Type: application/json' --data '{}')" == "405" ]] \
			&& [[ "$(edge_status --ipv6 "$resolve_ipv6" "$public_origin/api/health" -X POST -H 'Content-Type: application/json' --data '{}')" == "405" ]] \
			&& [[ "$(edge_status --ipv4 "$resolve_ipv4" "$public_origin/api/admin")" == "404" ]] \
			&& [[ "$(edge_status --ipv6 "$resolve_ipv6" "$public_origin/api/admin")" == "404" ]]; then
			return 0
		fi
		sleep 1
	done
	return 1
}

readiness_matches() {
  # Releases without an artifact manifest predate readiness; preserve that legacy gate.
  if [[ ! -f "$1/runtime-manifest.json" ]]; then return 0; fi
  curl --noproxy '*' --fail --silent --show-error --max-time 5 \
    "$readiness_url" --output "$response_health" \
    && health_is_minimal "$response_health"
}

# Invoked by the EXIT handler. Do not abandon rollback after the first failure.
# shellcheck disable=SC2329
rollback() {
  local failed=0
  if [[ -n "$previous_target" ]]; then
    activate_target "$previous_target" || failed=1
    systemctl restart "$service_name" || failed=1
    nginx -t && systemctl reload nginx || failed=1
    wait_for_target "$previous_target" || failed=1
  else
    if [[ -L "$current_link" ]]; then unlink -- "$current_link" || failed=1; fi
    systemctl stop "$service_name" || failed=1
    nginx -t && systemctl reload nginx || failed=1
  fi
  return "$failed"
}

if [[ -n "$previous_target" ]] && ! identity_matches "$previous_target/.vitesse-release-prepared.json" "$previous_target/.vitesse-release-prepared.json"; then
  echo 'The retained release has invalid rollback identity.' >&2; exit 1
fi
mutation_started=true
activate_target "$candidate"
if systemctl restart "$service_name" \
  && nginx -t \
  && systemctl reload nginx \
  && wait_for_target "$candidate"; then
  finished=true
  echo "Promoted $candidate and verified exact identity and probe method policy over local IPv4 and IPv6 TLS."
  exit 0
fi
echo 'Candidate acceptance failed; restoring the previous direct release.' >&2
exit 1
