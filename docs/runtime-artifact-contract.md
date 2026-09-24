# Direct runtime artifact contract

The direct adapter runs a static Nuxt tree and one compiled Express service.
`deploy/runtime-artifact.json` independently specifies required paths, entrypoints,
static assets and the runtime. The current template has no outside-dist modules,
generated clients, native runtime bindings, database, provider queue or durable
application files. Those empty declarations require review when a downstream
adds features. Logs stay in the existing service journal. No migrations are needed.

Keep protected configuration and any downstream database, email spool, cache or
uploads outside immutable releases. Preserve durable state on both promotion and
rollback. Preserve the exact installed service users, paths and loopback ports;
the `/srv/vitesse-nuxt-template` and `/opt/node-24.18.1/bin/node` source adapter defaults are
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
links are the reviewed JS-only graph's unused `.bin` entries; all other symlinks
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
mutation denial, repeated signals during a held HTTP connection, clean exit and
restart. The complete copied tree is checked again against the trusted archive;
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
/usr/bin/python3 -I /usr/local/libexec/vitesse-release/<version>/scripts/runtime-artifact.py verify /reviewed/staged/runtime \
  --archive /trusted/release.tar.gz --sha256 <published-sha256> \
  --commit <published-full-source-commit>
```

Use the original archive hash and release commit, not a newly generated inventory
of the copied tree. A successful local test does not authorize activation. Only
the operator's existing reviewed promotion mechanism may switch releases; retain
the exact previous release and state, and verify health, readiness and identity
before claiming success. `release.json.deployedAt` is the existing preparation
timestamp field, not proof that production activated that build.

## Netlify and downstream adoption

Netlify remains a separate adapter, building static Nuxt and bundling
`netlify/functions/api.ts`. The API's Lambda-event tests and frontend/source-output
checks remain required. This direct-host archive is not a Netlify deployment
package, and local adapter tests do not establish a live Netlify deployment.

Merge or adapt the bounded store, signal handling and artifact principles only
after reviewing downstream differences. Keep each site's authentication, role
changes, readiness dependencies, error semantics, writable state and topology.
Static or redirect-only descendants need no artificial API service. Compare both
their workspace and independent deployment locks, and validate their own exact
artifacts. Reuse this implementation without replacing client isolation.

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
