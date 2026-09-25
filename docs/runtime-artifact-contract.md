# Direct runtime artifact contract

The direct adapter runs a static Nuxt tree and one compiled Express service.
`deploy/runtime-artifact.json` independently specifies required paths, entrypoints,
static assets and the runtime. Kya requires Node's built-in SQLite and the exact Sharp ARM64 glibc binding and
libvips shared library listed in the contract. Image derivatives are generated at
runtime. Required paths include the compiled photo-store, authentication and API
modules, including `secondary-auth.js` and `secondary-state.js`. No database file
or uploaded photograph belongs in an archive. Logs stay
in the service journal.

Keep protected configuration and any downstream database, email spool, cache or
uploads outside immutable releases. Preserve durable state on both promotion and
rollback. Preserve the exact installed service users, paths and loopback ports;
the `/srv/kyapup` and `/opt/node-24.18.1/bin/node` source adapter defaults are
examples for a separately reviewed installation, not instructions to overwrite a
working host. Never change DNS, IPv4/IPv6, certificates or edge configuration to
make artifact acceptance pass.

## Build and accept away from production

Use an unprivileged disposable Linux ARM64 builder with Node 24.18.1, npm 12.0.2,
Python 3.11 or newer and Bubblewrap with user namespaces available. Start from a
clean, exact source commit. Record that commit. Run the repository's clean install,
full/production audits, signatures, lint, types, tests, build, native declarations
and deployment-output gates. Accessibility can run on the same source in a
supported Chrome environment. Do not load real environment files or provider data.

Resolve the owning checkout, locally exclude `/.ai-work/` in `.git/info/exclude`,
verify the ignore rule, and record the temporary builder directory in
`.ai-work/INDEX.md`. Create an empty `.ai-work/runs/<run>/artifact` directory, then:

```sh
bash scripts/package-runtime.sh .ai-work/runs/<run>/artifact
```

The packager copies only explicit compiled/static inputs and public source
manifests. It installs the independent `back-end/package-lock.json` production
graph, runs full/production backend audits and registry signature checks, and
rejects development or unrelated packages. The root workspace lock is retained
as source provenance, not installed in production. The only removed executable
links are the reviewed dependency graph's unused `.bin` entries; all other symlinks
are rejected. There is no dependency-install fallback.

The archive contains a required-path and SHA-256 inventory with its exact source
commit. Its verifier rejects private paths, undeclared native code, version drift,
unsafe archive members, symlinks and missing production dependencies. Independently
required paths prevent an incomplete archive from passing merely because its own
inventory omits a module. Unit regressions include tampering and copier omissions.

The exact archive is unpacked with an externally supplied hash and commit. A
read-only `/app` is tested in a private process/network/mount namespace without
the source checkout, development dependencies or real providers. Tests exercise
the compiled entrypoint, minimal GET/HEAD probes, failing/recovering readiness,
probe method restrictions, anonymous archive denial, an authenticated synthetic
photo upload, image conversion, publication, featured settings, archiving,
scoped machine import, duplicate preservation, import identities across restart,
repeated signals during a held HTTP connection and clean exit. Secondary-login
fixtures must use a separate temporary writable SQLite directory and synthetic
passwords and HMAC keys. They must cover disabled and malformed configuration,
the activation boundary without changing the host clock, persistent failure and
lockout state across process restart, normalized IPv4/IPv6 identities, bounded
state, unavailable storage, and primary-login independence from secondary lockout.
The archive must start with `/app` read-only; neither authentication database nor
real configuration may be copied into it. The complete copied tree is checked again against the trusted archive;
a deliberately missing compiled rate-store module must fail both verification
and actual startup. No production service is started or stopped.

Publish the archive, `SHA256SUMS`, `runtime-manifest.json` and `acceptance.json`
with the meaningful annotated release. The acceptance receipt records harness
hashes and completed artifact checks. Full source-gate logs remain separate
evidence. Download and compare published files before claiming delivery.

## Operator acceptance and rollback

After any deployment copier, use the root-installed verifier and independently
reviewed archive hash/commit. Never execute a verifier from a build-owned tree:

```sh
/usr/bin/python3 -I /usr/local/libexec/kyapup-release/<version>/scripts/runtime-artifact.py verify /reviewed/staged/runtime \
  --archive /trusted/release.tar.gz --sha256 <published-sha256> \
  --commit <published-full-source-commit>
```

Use the original archive hash and release commit, not a newly generated inventory
of the copied tree. A successful local test does not authorize activation. Only
the operator's existing reviewed promotion mechanism may switch releases; retain
the exact previous release and state, and verify health, readiness and identity
before claiming success. `release.json.deployedAt` is the existing preparation
timestamp field, not proof that production activated that build.

## Persistent state and adapter boundary

Production photo state uses `/var/lib/kyapup` (or the installed, reviewed
`PHOTO_DATA_DIR`) outside every immutable release. Secondary authentication uses
`/var/lib/kyapup-auth/login-state.sqlite`, with its parent owned by the installed
`kyapup-site` account and mode `0700`. Limit service write access to the required
state directories. Preserve both databases, their WAL/SHM files, and the whole
photo tree across restart, promotion, and code rollback. Stop the API for a
consistent backup of these directories together with the protected configuration;
do not erase login counters or replace a newer photo library during rollback.
The authentication database pins the identity-key and policy fingerprint. Changes
require a reviewed migration that preserves active lockouts, not a silent reset.

The installed active configuration is `/etc/kyapup.com/app.env`, root-owned and
mode `0600`. The generic first-install adapter's `/etc/kyapup/api.env` is not a
replacement for that installed path. The separate root-owned mode `0600`
`/etc/kyapup.com/pending-admin/secondary-admin.env` stays unloaded while staged.
Only complete, validated secondary configuration loaded by the new runtime arms
the future activation time. No configuration or database belongs in a release.
See the [secondary administrator runbook](secondary-admin-deployment.md) for the
scheduled configuration, isolated checks and rollback, and the administrative
runbook for first installation.

The inherited Netlify source adapter is not a supported production path for this
stateful application. Ephemeral function storage cannot preserve the photo library.
A future alternative adapter must provide durable storage and its own acceptance
fixtures; a frontend build alone is not evidence that uploads will persist.

Changes to authentication, readiness, native packages, data schema, or writable
paths must update this contract and the isolated acceptance fixtures. Keep client
services isolated. Do not replace production users, ports, databases, or other
applications to make a test pass.

The [administrative runbook](../deploy/README.md) defines protected bootstrap,
archive/candidate ownership, exact identity, interruption recovery and the
separate unprivileged build account. Run `npm run test:promotion` for changes to
that boundary; source-string checks are not a substitute for the fault tests.
The [2026-09-20 review](protected-promotion-review-2026-09-20.md) records the
confirmed pre-fix path, reproductions, correction, validation, and limits.

The additional `scripts/test-bootstrap-in-vm.py --disposable-vm` regression is
for an explicitly staged fresh disposable Linux VM only. Its root-owned marker
and absent-installation gates refuse a normal host. It exercises real installer
permissions, immutable helpers, preserved units, a hostile cache symlink and
mutable-adjacent-unit rejection without starting the service. Never stage its
marker on production; the ordinary namespace tests remain unprivileged.
