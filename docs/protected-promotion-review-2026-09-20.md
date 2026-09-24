# Protected promotion review, 2026-09-20

This review covers the direct systemd/Nginx template at source revision
`319cdba2e0a12fe170c3761e39466d9d297022d6` and the v2.1.2 correction. It does
not assert that a downstream production host uses this source adapter or has the
same ownership, paths, users, ports, state, or rollback requirements.

## Confirmed boundary failure

The earlier installer made the deployment parent and `releases/` writable by the
build account. The documented workflow then prepared a checkout there and asked
an administrator to run that checkout's promotion helper as root. A compromised
build process could replace the helper or its adjacent service unit before that
later privileged invocation. This required local build-account control and an
operator action; no unauthenticated HTTP path or affected installed host was
established.

Promotion also trusted marker presence instead of the accepted archive, lacked an
exclusive transaction lock, and restored the prior release only through its
ordinary failure path. Interruption after activation could leave the candidate
selected. A rollback error could stop the remaining recovery checks.

An independent candidate review found two additional representations. A runtime
path containing a symlink followed by `..` could cause the path guard to validate
one executable while the shell resolved and ran another. Readiness was hardcoded
to port 3006 even when `HEALTH_URL` selected a different service. Disposable
Linux regressions reproduced both failures against the earlier candidate: its
privileged helper executed the untrusted runtime, and it accepted readiness from
the wrong service.

## Corrected invariant

Privileged code now comes only from an independently reviewed, root-controlled
checkout. The installer places versioned helpers, verifier, and artifact contract
under `/usr/local/libexec/vitesse-release/<version>/` and refuses to overwrite a
version. The active-pointer parent, releases, approved archive, candidate, prior
release, runtime, and every ancestor must be root-owned and non-writable by group
or others. Candidates are data: the protected verifier compares every staged
file with the independently supplied archive digest and source commit before the
pointer can change.

Administrative path operands must be absolute and contain no `.` or `..`
components. Required release identities have exact keys and validated release,
commit, and UTC timestamp formats. Readiness stays on the configured health
service's origin and port; custom health paths require an explicit same-origin
readiness URL.

Promotion is serialized. Its atomic pointer change is followed by health,
readiness, exact identity, header, method, and unknown-route checks over both
local address families. Every unsuccessful exit after mutation, including
HUP/INT/TERM, attempts full rollback. A failed recovery retains a protected
record for operator action. First-deployment failure removes the new pointer and
stops only the newly started service.

The unprivileged account owns separate `builds/` and `shared/` directories. The
installer does not descend into `shared/` to create the npm cache. A disposable
VM reproduced that the historical command followed a hostile cache symlink and
changed the target, while the corrected installer left it untouched. Existing
units are preserved, existing directory metadata is rejected without mutation
when it differs from the reviewed topology, and no service is started during
bootstrap validation.

## Verification scope

Local clean installation, lint, types, application and artifact tests, build,
native-lock and deploy-output checks, accessibility, full and production audits,
standalone-backend audit, and package signatures passed with Node 24.18.1 and
npm 12.0.2. The newly published `devalue` denial-of-service advisory is resolved
by pinning 5.9.4, newer than the 5.9.2 patched release.

The isolated Linux promotion suite covers ordinary success, health, IPv6,
restart and Nginx failures, interruption, failed rollback, contention, invalid
current state, archive and tree tampering, mutable helpers/contracts/parents,
symlinked modules, wrong digest, first deployment, malformed identities,
alternate ports, custom probe paths, mismatched origins, and ambiguous runtime
paths. A separate disposable-VM test executes the real installer as synthetic
root and confirms protected permissions, immutable helpers, existing-unit
preservation, cache-symlink resistance, mutable-unit rejection, and no service
start.

The tests use synthetic services and public build inputs. They do not read
credentials, access providers, inspect or mutate production, prove any existing
host is affected, or authorize changing a downstream topology. Each downstream
must adapt these controls to its own retained release, persistent state,
migrations, health dependencies, service account, port, Nginx policy, and
rollback contract.
