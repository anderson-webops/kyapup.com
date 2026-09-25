# Scheduled secondary administrator deployment

Target release: **v1.1.0**. Obtain the exact source commit and accepted Linux ARM64
archive digest from the [v1.1.0 release](https://github.com/anderson-webops/kyapup.com/releases/tag/v1.1.0)
and its `acceptance.json`, `runtime-manifest.json` and `SHA256SUMS` assets. Require
matching evidence and published-asset comparison before use. This runbook does
not record a deployment.

## Preserve the installed service

Use the existing host's service, `kyapup-site` account, release paths, listener
ports, Node location and promotion procedure. Keep the immutable v1.0.0 release
and its installed administrative helpers intact. The generic first-install
defaults in `deploy/README.md` are not instructions to replace this host's layout.
Any new versioned verifier and artifact contract must be independently reviewed
and installed under protected parents. Never execute candidate-owned installers,
units, verifiers or promotion helpers as root.

Keep the API on loopback with `TRUST_PROXY_HOPS=1`. The one Nginx proxy must
overwrite `X-Forwarded-For` with `$remote_addr`, not append a request-supplied
chain. Preserve both IP families, domains, certificates and existing edge rules.
Secondary login identity normalizes IPv4-mapped addresses to IPv4, uses IPv4
`/32` and IPv6 `/64`, then derives a database key with the configured HMAC secret.
Raw client addresses are not database keys. Preserve the HMAC key across restarts
so recorded failures and lockouts still apply to the same identities. The database
fingerprint pins the identity key and policy. A key or policy change requires a
reviewed state migration; do not silently rotate keys or reset active lockouts.

## Staged configuration

The active root-owned mode `0600` environment file is
`/etc/kyapup.com/app.env`. The separate staged file is
`/etc/kyapup.com/pending-admin/secondary-admin.env`, also root-owned mode `0600`,
under protected parents. Do not source it or add it as another `EnvironmentFile`.
Keep existing primary credentials, origins and import configuration unchanged.
Never print secret values in logs, command arguments or acceptance evidence.

| Setting | Required value or handling |
| --- | --- |
| `ADMIN_SECONDARY_PASSWORD_HASH` | Protected password hash, never a plaintext password |
| `ADMIN_SECONDARY_NOT_BEFORE` | `2026-12-24T10:00:00Z` |
| `ADMIN_SECONDARY_FAILURE_LIMIT` | `3` |
| `ADMIN_SECONDARY_FAILURE_WINDOW_SECONDS` | `172800` |
| `ADMIN_SECONDARY_LOCKOUT_SECONDS` | `172800` |
| `ADMIN_SECONDARY_STATE_MAX_ENTRIES` | `10000` |
| `ADMIN_SECONDARY_STATE_PATH` | `/var/lib/kyapup-auth/login-state.sqlite` |
| `ADMIN_SECONDARY_ID_HMAC_KEY` | Stable 32-byte secret encoded as canonical 64-character hex or 43-character base64url |

There is no expiration time. Absent secondary configuration disables that login;
partial or malformed configuration must fail closed for secondary login. The
primary password remains usable, subject to ordinary resource throttles, even
when the secondary credential is disabled, locked or its storage is unavailable.
Never move the real activation deadline earlier to test the credential.

These states are distinct:

- **Staged:** the protected file exists but the running API does not load it.
  The future login is not armed.
- **Armed:** v1.1.0 has loaded complete, valid secondary configuration. Before
  the stated UTC time, the secondary password still cannot sign in.
- **Active:** that time has arrived and the secondary password can sign in,
  subject to its failure limits and lockout. It does not expire automatically.

## State and acceptance before activation

Create `/var/lib/kyapup-auth` as a private mode `0700` directory owned by the
installed `kyapup-site` account, outside every release. The service must be able
to create and update the SQLite database and adjacent WAL/SHM files. If systemd's
filesystem restrictions require a change, use a narrowly reviewed drop-in granting
only this additional directory, such as `ReadWritePaths=/var/lib/kyapup-auth`.
Retain existing restrictions and photo-state access; do not grant write access
to releases, protected configuration or all of `/var/lib`.

1. Accept the exact Linux ARM64 glibc archive using the
   [runtime artifact contract](runtime-artifact-contract.md). Confirm the two new
   compiled authentication modules and record the trusted archive hash, full
   source commit, acceptance receipt and copied-runtime verification. A source
   build or a receipt for v1.0.0 does not accept this release.
2. Before changing the installed service, stop its writes and make one consistent,
   protected backup of active and staged configuration, the entire photo library
   and any existing authentication state, including SQLite WAL/SHM files. Retain
   the previous service configuration and immutable release. Resume the existing
   service if the remaining work will be performed separately. Restore the backup
   into isolated private directories as an unprivileged process and verify photo
   bytes, metadata and any existing authentication counters without writing to
   the live paths. The synthetic acceptance fixture must also demonstrate a
   secondary lockout surviving a consistent photo/authentication backup and
   restore. Keep protected configuration out of fixture logs and evidence.
3. Test the candidate as an unprivileged process with temporary private photo and
   authentication directories, an isolated listener and synthetic credentials
   only. Do this before loading the staged real configuration. Check primary
   login before and after secondary activation; rejection before the boundary;
   success after it with no expiration; three-failure lockout and its 172800-second
   window and duration; persistence across process restart; IPv4, mapped IPv4 and
   IPv6 `/64` identities; the 10000-entry bound; and disabled, malformed or
   unavailable secondary state. Primary login must remain usable during secondary
   lockout or storage failure. Use a controlled fixture clock for boundary tests,
   never change the host clock.
4. Validate the single trusted proxy hop and header replacement, and confirm the
   candidate can write only its required state paths. Synthetic acceptance must
   succeed before any real staged values enter the service environment.

## Load, verify and recover

During the authorized activation change, use the host's existing protected
promotion procedure with the accepted archive and independently trusted metadata.
Merge the reviewed secondary settings into the active environment file atomically,
preserving every existing setting and root ownership with mode `0600`. Restart
the exact installed service. Do not make the staged file an automatic input to
future service starts.

Verify release identity against the accepted commit and archive, readiness,
primary sign-in, and the installed IPv4/IPv6 serving paths. After the environment
is loaded and authentication state opens, the service startup log must include:

```text
Secondary authentication state ready; not-before=2026-12-24T10:00:00.000Z
```

Combine that message from the current service start with exact release identity,
readiness, the single-proxy checks and private-state permissions to record
**armed** before the activation time. No real secondary-password attempt is
needed before that date, and no public authentication-status endpoint is used.
An unavailable-state message is not evidence of arming. A staged file alone proves
neither loading nor arming. Synthetic future-clock success is not evidence of a
real future login.

If promotion, configuration loading or verification fails, restore the previous
active environment, required service drop-in and release through the existing
protected rollback procedure. Keep the staged file protected and unloaded.
Preserve authentication counters and current photo state; never delete the
authentication database or restore an older photo database just to obtain a green
check. Investigate state incompatibility separately, disabling only secondary
configuration when needed to preserve primary access. Recheck the previous
release identity, readiness and primary sign-in after rollback. Record exactly
which release is running and whether secondary configuration is staged, armed,
active or disabled.
