# Kya server setup and releases

Kya uses Nginx for its static page and one independent, loopback-only Express API under systemd. The site-specific defaults are `kyapup-api.service`, unprivileged account `kyapup`, `/srv/kyapup/current`, port `3006`, and persistent state under `/var/lib/kyapup`. Review those defaults against the host before first installation. Preserve existing applications, service accounts, ports, IPv4/IPv6 listeners, and edge policies.

## Protected administrative installation

Never run an installer, promotion helper, or verifier from a build-owned checkout as root. Bootstrap from a fresh, independently reviewed, root-created checkout of the published tag under protected ancestors. Review `deploy/systemd/install-service.sh` there. Changing ownership of a previously writable build tree is not a substitute because another process can retain writable file descriptors.

The installer preserves existing service units, creates root-controlled deployment/release parents, creates `/etc/kyapup` with mode `0700`, and installs immutable versioned helpers under `/usr/local/libexec/kyapup-release/<version>/`. Only `builds/` and `shared/` are writable by the build account. The unprivileged preparation step creates its own npm cache; root never changes paths inside `shared/`. Unexpected ownership, modes, and symlinked directories are rejected for operator review. The installer does not start or restart the service.

Use Node 24.18.1 from the approved protected location, normally `/opt/node-24.18.1/bin`, and npm 12.0.2 for builds. Do not replace a host-wide runtime. `NODE_BIN_DIR` can select a reviewed alternative for the helpers; changing service `ExecStart` requires its own review.

## First administrator setup

Generate a password hash in an unprivileged, reviewed source checkout. The password must be 12–1024 characters. The helper reads stdin, so a password need not enter shell history or process arguments:

```bash
read -r -s -p 'Admin password: ' kya_password
printf '\n'
printf '%s' "$kya_password" | /opt/node-24.18.1/bin/node back-end/scripts/hash-password.mjs
unset kya_password
```

Use a protected editor to create `/etc/kyapup/api.env`, owned by root with mode `0600`:

```ini
ADMIN_PASSWORD_HASH='scrypt$32768$8$1$<salt-hex>$<key-hex>'
ALLOWED_ORIGINS=https://kyapup.com,https://kyagirl.com
```

Replace the complete sample hash with the helper output. Systemd reads this file before starting the unprivileged process; the service account does not need permission to read the configuration file directly. The unit supplies `NODE_ENV=production`, `PHOTO_DATA_DIR=/var/lib/kyapup`, `HOST=127.0.0.1`, `PORT=3006`, and `TRUST_PROXY_HOPS=1`. Production rejects missing or invalid configuration. Never put a real environment file, password hash, photo, or database in the checkout or release archive.

Systemd creates the mode `0700` state directory and makes it writable while the application release and the rest of the system remain read-only to the service. Nginx must never serve this directory directly. The API checks every image's publication state before responding; original files are never available through a media route.

Include `deploy/nginx/kyapup.server.conf` in the existing certificate-covered TLS server. Set its `server_name` to `kyapup.com kyagirl.com` and retain both IPv4 and IPv6 listeners. Both hostnames use the same frontend, API and photo library. Their admin sessions are host-specific, so sign in separately when changing hostnames. The proxy accepts uploads up to 25 MiB and replaces forwarded headers. Use HTTPS for production login because the cookie is Secure.

## Prepare and accept a release

As the unprivileged build account, use a clean checkout beneath `builds/`, an annotated version tag, and the exact fetched `anderson-webops/kyapup.com` `origin/main` revision:

```sh
NODE_BIN_DIR=/opt/node-24.18.1/bin \
  deploy/systemd/prepare-release.sh /srv/kyapup/builds/<release>
```

Preparation runs clean development and production installs, dependency audits and signatures, native-lock checks, lint, types, tests, builds, accessibility and a synthetic runtime test. It rejects source-local environment files. `BUILD_ROOT`, legacy `RELEASE_ROOT`, and explicit cache/runtime overrides remain available for isolated builders. Preparation metadata alone is not archive acceptance.

Follow [the runtime artifact contract](../docs/runtime-artifact-contract.md) to accept the exact Linux ARM64 glibc archive without the source checkout or development dependencies. Run `npm run test:promotion` in its isolated Linux fixture. The archive must include the declared Sharp ARM64 binding and libvips library; Node provides SQLite. No archive contains administrator configuration, sessions, uploaded photos, or database state.

## Finalize and promote

Download the reviewed archive into protected, root-created storage. Independently verify its release, commit, digest and acceptance receipt. Create a fresh empty root-owned release directory, then unpack using the installed verifier:

```sh
/usr/bin/python3 -I /usr/local/libexec/kyapup-release/<version>/scripts/runtime-artifact.py \
  unpack /srv/kyapup/releases/<new-release> \
  --archive <protected-archive> --sha256 <reviewed-sha256> --commit <reviewed-commit>
```

Keep the archive, candidate, and every ancestor root-controlled and non-writable to other accounts. Preserve Nginx read access through the reviewed host permissions. Use freshly extracted files, never a build tree merely changed to root ownership. Take a consistent state backup before promotion. Then:

```sh
PUBLIC_HOST=kyapup.com NODE_BIN_DIR=/opt/node-24.18.1/bin \
  /usr/local/libexec/kyapup-release/<version>/deploy/systemd/promote-release.sh \
  /srv/kyapup/releases/<new-release> \
  <protected-archive> <reviewed-sha256> <reviewed-commit>
```

The promoter treats candidate code only as data and verifies it against the original protected archive. An exclusive lock protects the transaction. It atomically changes `current`, restarts only the reviewed API, and checks health, readiness, exact release identity, page headers, probe method restrictions and unknown-route behavior through local IPv4 and IPv6 TLS paths. Manifests require readiness; legacy pre-manifest releases retain the older health gate.

After a successful promotion, verify the same page and gallery on `https://kyagirl.com`, then sign in at `/admin`, upload a harmless photo to the archive, preview it, publish it, feature it, change the timer, and return it to the archive. Check that an anonymous browser can no longer open its media URL. Keep the test photo archived afterward; do not remove individual storage files by hand. These are operator checks; source delivery does not establish that either domain is live.

## Backups, restart and rollback

Back up the **entire** `/var/lib/kyapup` directory and protected configuration to access-controlled storage. The library contains `library.sqlite`, possible SQLite WAL/SHM files, and `photos/<id>/original`, `thumb.webp`, and `full.webp`. A database-only backup loses photos; an images-only backup loses the selection and presentation settings.

For a consistent filesystem snapshot, stop `kyapup-api.service`, copy the complete state directory with ownership and permissions preserved, then restart the service promptly and check `/api/readyz`. A plain live copy of the SQLite main file is not a consistent backup. Keep a pre-upgrade backup alongside the retained release, store copies off-host, and periodically restore into a separate test directory to verify the library opens and photos display. Never test a restore by overwriting the active library.

Routine restart: `systemctl restart kyapup-api.service`. Check `systemctl status kyapup-api.service`, its journal, and `/api/readyz`. Changing the administrator password hash requires a service restart; use a new strong password and sign in again. Do not remove the state directory to reset a password.

Unsuccessful promotion, including HUP/INT/TERM, restores the previous release pointer and verifies that release. On first deployment failure, the helper removes only the newly created pointer and stops the new service. Recovery continues after individual errors; a failed rollback retains a mode `0600` record inside the protected mode `0700` `.deployment-recovery/` directory. Preserve it and the retained release for operator recovery.

Application rollback preserves `/var/lib/kyapup` and all uploads. Version 1 starts with one local schema and no destructive migration; future schema changes must declare backward compatibility before release. Do not restore an older database over newer uploads as part of ordinary code rollback. If a future migration is incompatible, stop the API and restore the complete matching state snapshot only after reviewing any uploads created since that snapshot.

Administrative path operands must be absolute without `.` or `..`. For reviewed alternate topology, use `SERVICE_NAME` and `HEALTH_URL`; readiness preserves the same origin/port and changes `/health` or `/healthz` to `/readyz`. A custom health path requires an explicit same-origin `READINESS_URL`.

No source command changes DNS, certificates, routing or firewall rules. Preserve all A/AAAA records. `release.json.deployedAt` is the preparation timestamp, not proof of activation.
