# Signed-source auto-import compiler

The maintained `unimport-7.0.2-webops.2.tgz` is compiled from upstream's complete
signed v7.0.2 source tree. Its package version `7.0.2+webops.2` preserves the
upstream API version and identifies this independently built derivative.
The original npm package's advertised attestation returns HTTP 404. That failed
registry-provenance result remains recorded in `UPSTREAM.json`.

`check-unimport-source.py` checks both original Git object identities, verifies
the tag and commit with a pinned public signer, and reconstructs the entire
224-file Git tree from `source.tgz`. It uses an isolated public-only keyring;
GnuPG's `gpgv` is required. No private signing material is involved.
`commit.git` and `tag.git` use Git's compressed loose-object format so their
signed original bytes, including mandatory signature-header whitespace, remain
intact across checkout and ordinary source whitespace checks.

The independent `build/` lock selects Node 26, TypeScript 6 and tsdown 0.23.7.
Unbuild 3.6.1's TypeScript peer range excludes TypeScript 6, so this build uses
tsdown's supported TypeScript 6 declaration generator instead of overriding
that incompatible peer. Original source, tests, declarations and license inputs
remain available in the verified archive. H3 1.15.11 is the original upstream
test fixture, matching the signed lock, rather than an application runtime.

The reviewed source patch anchors implicit package export scanning to the
working project's package URL. Upstream's implicit resolution can otherwise
select a parent's dependency before the project's own package. Explicit caller
URLs retain their original meaning. Local-pkg 2 and Magic-string 1 are exercised
by the complete upstream suite and compiled consumer fixtures.
Acorn availability and loading use the compiler module's actual resolution
context. VueUse metadata uses the working project's explicit package URL.
Both retain their legitimate installed providers when parent directories are
unreadable or contain a different version.

`build-unimport-source.py` runs all 254 upstream tests, native type and lint
checks, and produces byte-identical archives from two fresh source directories.
The archive records the signed source identity, applied source patch, compiler
configuration, independent build lock and every output hash. `--check --installed`
also verifies each actual unscoped consumer's locked and installed bytes.
Registry signature and full/production vulnerability audits remain required
for both the application and all independent tooling graphs.

The independent `runtime/` lock installs only declared production dependencies
and the optional Acorn peer. The copied compiled artifact runs under Node's
read restrictions with the source checkout and development tools denied. A
required runtime-module deletion must fail; restoring that exact module must
recover in a fresh process. The earlier `.1` archive remains a historical
comparison artifact and is absent from the current consuming locks.

Compiled core and addon declarations receive strict NodeNext consumer checks
with `skipLibCheck: false`. The unplugin entrypoint retains its upstream
cross-framework type contract and receives upstream and native Nuxt project
checks. Standalone strict checking of that cross-framework entrypoint still
requires its optional framework declarations. Complete all-framework type
qualification remains separate outstanding work; it is not established by the
core consumer fixture.

CI and both direct-release preparation paths verify the signed source rebuild
before loading the application, then install the complete independent compiler
fixtures before project validation. Source qualification, native artifact
acceptance, publication and protected activation remain separate gates.
