# Docker-free production rollout

The template serves static Nuxt output through Nginx and a minimal Express API
through systemd. Netlify remains a separate supported adapter. Its example
`vitesse-nuxt-template-api.service`, account `vitesse-template`,
`/srv/vitesse-nuxt-template/current` and `127.0.0.1:3006` are for a separately
reviewed installation. They do not authorize replacing any downstream host's
users, paths, ports, state, Nginx policy or IPv4/IPv6 listeners.

## Administrative boundary

Never run a privileged installer, promotion helper or verifier from a build-owned
checkout. Package scripts can modify that checkout even if it started clean.
Bootstrap from a fresh, independently reviewed, root-created checkout of the
published tag under protected ancestors. Do not merely change ownership of a
previously writable build tree and execute it; a process may retain writable file
descriptors. Review `deploy/systemd/install-service.sh` there before invocation.

The installer checks its helper, adjacent unit, verifier, contract and runtime
paths. It installs immutable versioned helpers beneath
`/usr/local/libexec/vitesse-release/<version>/`, preserves an existing unit, and
keeps the deployment parent and releases root-controlled. Separate `builds/` and
`shared/` directories are writable by the build account. The unprivileged prepare
step creates its npm cache; root never creates or changes paths inside `shared/`.
Existing symlinked build/shared directories are rejected for operator review.
Existing directories with different ownership or modes are likewise left
unchanged and rejected rather than silently normalized.
The installer does not start or restart a service.

Use Node 24.18.1 from the approved protected location, normally
`/opt/node-24.18.1/bin`, and npm 12.0.2 for builds. `NODE_BIN_DIR` can select an
approved alternative for the helpers; an alternate service ExecStart needs its
own review. Do not replace the host-wide `/usr/bin/node`. Existing installations
created with build-owned deployment parents require a separate ownership and
content review before adopting the new helper. Preserve the serving release,
retained rollback and all state; no automatic recursive ownership migration occurs.

## Prepare and accept

As the unprivileged build account, use a clean checkout beneath `builds/`, its
annotated version tag and the exact fetched canonical `origin/main`. Run:

```bash
NODE_BIN_DIR=/opt/node-24.18.1/bin \
  deploy/systemd/prepare-release.sh /srv/vitesse-nuxt-template/builds/<release>
```

Preparation retains full/production audits, signatures, native-lock validation,
lint, types, tests, build, accessibility and minimal runtime checks. It rejects
source-local environment files. `BUILD_ROOT`, legacy `RELEASE_ROOT`, and the
explicit cache/runtime overrides remain available for isolated CI builders.
Preparation metadata alone is not evidence of a successful packaged release.

Follow [the artifact contract](../docs/runtime-artifact-contract.md) to build and
accept the exact Linux ARM64 production archive without source/dev dependencies.
Run `npm run test:promotion` in the isolated Linux fixture as well. Publish the
archive, manifest, checksum and acceptance receipt only after the exact source
passes its release gates. No archive contains credentials or writable state.

## Finalize and promote

The operator downloads the reviewed archive into protected root-created storage,
independently verifies its release, commit and digest, and creates a fresh empty
root-owned release directory. Extract with the protected installed verifier:

```bash
/usr/bin/python3 -I /usr/local/libexec/vitesse-release/<version>/scripts/runtime-artifact.py \
  unpack /srv/vitesse-nuxt-template/releases/<new-release> \
  --archive <protected-archive> --sha256 <reviewed-sha256> --commit <reviewed-commit>
```

Preserve the installed service and Nginx read access. Keep the archive, candidate
and every ancestor root-controlled and non-writable to other accounts. Use fresh
extracted files, not a build tree changed to root ownership. The promoter verifies
that protected staged tree against the original protected archive again:

```bash
PUBLIC_HOST=site.example NODE_BIN_DIR=/opt/node-24.18.1/bin \
  /usr/local/libexec/vitesse-release/<version>/deploy/systemd/promote-release.sh \
  /srv/vitesse-nuxt-template/releases/<new-release> \
  <protected-archive> <reviewed-sha256> <reviewed-commit>
```

Promotion treats candidate files only as data; it never invokes candidate helpers
as root. An exclusive lock protects the transaction. The helper checks rollback
containment and identity, atomically changes `current`, restarts only the reviewed
API and checks health, readiness, exact metadata and denied API operations through
both IPv4 and IPv6 with TLS verification. New manifests require readiness; older
pre-manifest releases retain their existing health gate.

Unsuccessful exits and HUP/INT/TERM restore the prior pointer and verify it.
First-deployment failure removes only the new pointer and stops the new service.
Rollback continues after individual recovery errors; failure retains a mode0600
record under the protected mode0700 `.deployment-recovery/` directory. Preserve
that evidence, the old release and its state for operator recovery. A release
parent, missing target, writable tree or malformed marker is not a rollback target.

The template has no application database, queue, provider credentials or durable
writable files; logs stay in the journal. Downstreams must declare their own state,
readiness dependencies, migration compatibility and rollback rules. Keep client
services isolated. No source operation here changes production, DNS, certificates,
routing or firewall policy. Preserve every A/AAAA record. `deployedAt` is the
legacy preparation timestamp, not proof of live activation.

Administrative path operands must be absolute without `.` or `..` components;
the guard rejects those representations before executing the selected runtime.
For a reviewed alternate service, set `SERVICE_NAME` and `HEALTH_URL`. Readiness
keeps that URL's origin and port and changes `/health` or `/healthz` to `/readyz`
under the same prefix. A custom health path requires an explicit `READINESS_URL`
on the same origin. This prevents another service's readiness from accepting or
blocking the selected application's promotion and rollback.
