# Dependency acceptance

Builds use npm 12.2.2 with Node 26.13.0. Its bundled Undici 6.29.1 replaces
the affected 6.29.0 copy in npm 12.2.1, covering
https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx and
https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm.
Application dependency overrides do not update npm's private dependency tree.
Toolchain regressions inspect the actual selected npm and child commands
and exercise preservation of function-valued TLS policy before any connection.
Both production artifact profiles continue excluding npm and other build tools.

Release qualification includes the selected npm dependency graph, not just the
application lockfiles. The original npm 12.2.2 distribution still bundles Glob
13.0.6 and Minimatch 10.2.5, affected by GHSA-3g3m-2fjr-6pw4 and
GHSA-g3hv-75wg-m249. `build-toolchain/` retains the original CLI code, license
and documentation while removing prebundled dependencies and their packaging
declarations. A separate locked graph selects Glob 14.0.4, Minimatch 11.0.5 and
the supported registry-resolved dependencies. This is a maintained local
distribution profile, not a claim that the original upstream bundle is clean.

`scripts/package-npm-toolchain.py` verifies the original registry SHA-512 and
reproduces the archive and all original-file digests. An explicit compression
level preserves identical archive bytes across Python versions with different
gzip defaults. Bootstrap installs the
graph before application dependencies, verifies the CLI contents and lock,
runs full/production audits and registry verification, and pairs the selected
Node with the exact npm/npx CLI entrypoints outside application `node_modules`.
Normal audits include that graph. Integrity, cancellation, bounded pattern
expansion, offline pack/install/executable delivery and source-only cold
bootstrap are required regressions. Seed-only ignored-script settings do not
leak into application installation. No global tool or security setting changes.
The bootstrap-only manifest accepts Node 26.13.0's bundled npm 11.20.0. Its role
is a script-free locked installation of the reviewed profile, not application
installation or release qualification. The application engine and selected
build-profile checks remain pinned to the repaired npm 12.2.2 distribution.
Offline executable fixtures use their own packed package, cache and empty global
prefix. Both npm exec and npx must preserve the audited CLI and paired Node
identity without resolving a separate global or cached Node package.
Input verification compares exact bytes with bounded failure messages rather
than constructing binary assertion diffs. Changed lock and archive regressions
must reject in a separate process with a 128 MiB heap and a ten-second deadline.

Netlify's existing automatic installation is scoped to `build-toolchain` through
its supported npm flags; the build command then performs a clean application
installation using the repaired profile. StackBlitz automatic installation is
disabled in favor of the same explicit bootstrap. Hosted runtime acceptance
remains distinct from these source-side contracts. Direct preparation keeps
the private toolchain cache outside its prepared runtime and removes the
toolchain source inputs before runtime acceptance. Exact archive receipts bind
the profile and lock digest, and the runtime verifier's allowlist is unchanged.

Nuxt DevTools 4.1.0 uses the tested Vite DevTools 0.8.2 host and kit. The
frontend declares that current pair directly. The original Vue plugin's
9.0.0-rc.2 distribution and Unhead 3 retain their supported 0.7 API consumers.
The root compatibility kit and explicit hoisted npm layout preserve those
original peer contracts while the frontend uses 0.8.2. A layout with an
incompatible kit at either consumer must fail the complete installed graph.
The former metadata-only peer patch and local archive are retired. The original
registry metadata, integrity and all 38 payload hashes remain checked against
`vendor/vite-plugin-vue-devtools/UPSTREAM.json`. The complete installed graph
must pass `npm ls --all` without forced or ignored peer ranges.

The actual Nuxt-selected Vite DevTools 0.8 integration initializes the plugin, serves its
exact UI and dock bytes, and transforms its actual injected HMR client over
loopback. That integration remains part of `npm test`; full Nuxt types, site
checks and artifact acceptance remain required. No provider version is forced
outside its declared range, and neither dependency warnings nor checks are
suppressed. The host test selects 0.8 explicitly through its public integration
API rather than silently accepting the root's compatible 0.7 provider.

The private qs 6.17.2-webops.4 patch is based on current upstream 6.17.1.
It retains that release's input-copy prototype protection and fixes native
comma-array coercion across realms. The source, license and compatibility
boundary are in `vendor/qs/UPSTREAM.md`. The installed CommonJS files and all
three browser interfaces pass the same security and ordinary-input fixtures.
The locked build reproduces both the browser distribution and local npm archive.
Exact decimal overflow/conflict counters preserve every existing value when
indexes exceed the safe integer range, including merges and shifted containers.
Named properties and own data properties retain their keys and prototypes;
strict limit errors remain unchanged. This fixes a separately reproduced data
loss defect, not a demonstrated prototype-pollution exploit. Both workspace and
independent API locks and the exact unpacked runtime use the same reviewed bytes.
An independently reviewed large-limit case also retains non-array indexes as
objects when `arrayLimit` exceeds JavaScript's array-index range or is infinite.
Both sparse modes, ordinary/null objects, prepend/append and strict/non-strict
limit settings have regressions; ordinary small arrays remain arrays.

Intrinsic-array coercion reads each index once and converts it before reading
the next index. This prevents changing getters from bypassing normalization and
preserves conversion-driven mutations, fixed initial lengths, sparse separators,
cycles, repeated aliases, custom hooks and original exceptions. The regressions
cover both comma serialization and custom encoders delegating to the default
encoder, across the installed CommonJS and three browser distributions.

Packing normalizes only its disposable public-library copy to 0644 files and
0755 directories, so private source checkouts keep their original permissions
without changing archive bytes. Archive and installed-file comparisons use
bounded equality checks rather than formatting binary diffs. Regressions cover
a 0600 checkout, a 0077 builder umask and rejection under a 256 MiB Node heap.

The local archive is a source installation input. Independent API fixtures and
the artifact producer supply it during locked installation. The final immutable
runtime retains the installed library and its verified inventory, rather than
its package-manager input archive. The existing artifact layout and retained
release verification remain unchanged.

The backend build, watch and type checks use TypeScript 7.0.2 through the explicit
`typescript-native` package alias and its published CLI. Vue and typescript-eslint
retain their independently required TypeScript 6.0.3 compiler API. The current
`vue-tsc@3.3.14` requires `typescript/lib/tsc`, which TypeScript 7 no longer
exports; typescript-eslint also declares support below 6.1. The alias preserves
these genuine API boundaries without widening metadata or choosing an ambiguous
`tsc` executable. Compiler regressions exercise the real TypeScript 7 CLI and
both legacy API consumers. Full production installation and runtime inventory
checks reject both compiler packages; Linux ARM64 binding and artifact checks
remain required.

Nuxt 4.6.4 requires `unimport ^7.0.2`. Its locked and installed provider must
satisfy that original API contract. Version 7.0.2's advertised npm attestation
endpoint currently returns404, holding release provenance qualification until
the publisher repairs the endpoint or a compatible successor verifies.
Full registry-signature and provenance checks remain mandatory. Consumers with
different declared ranges keep their own compatible providers. Clean installs,
Nuxt auto-import/type checking, application tests and generated-site checks
remain required alongside provenance.

The frontend's c12 dependency remains on the stable 3.3 API required by its Nitro 2 dependency.
The newer 4.0.0-rc.4 distribution is a prerelease outside that parent range;
evaluate it with a compatible framework update rather than forcing its API.

The local deepmerge fork preserves both published entrypoints while defining
destination keys as own data properties. Its package provenance and compatibility
boundary are recorded in `vendor/deepmerge/UPSTREAM.md`; the security regressions
and complete consumer-lock assertions remain part of `npm test`.

Glob 14.0.4 and Minimatch 11.0.5 replace vulnerable older transitive majors.
The Minimatch regression requires oversized globstar-parent expansion to throw,
preserving complete matching below the expansion limit rather than accepting
silently truncated patterns. Both application and independent build graphs use
the same reviewed patch.
The real DevTools host fixture decodes HTML-escaped proxy URLs before fetching
them, matching browser attribute handling after Vite 8.3.6's escaping fix. It
still requires successful module responses, the original client hashes and HMR
injection.
The complete build-toolchain suite runs in a dedicated test process before the
other Node compatibility suites. Its cold installation, executable identity,
tampering and cancellation cases remain required, with phase diagnostics for
Linux failures rather than interleaved cold-install and compatibility output.
Nitro 2.13.6 imports the named `ZipArchive` API directly, so the obsolete local
factory bridge is retired. Both root and actual Nitro consumers use the original
Archiver 8 package and produce real ZIP/TAR streams in regression tests. Full
graph, file-matching, Nuxt build and exact-artifact checks remain required.
The standalone backend lock pins the same patched Minimatch major, and both
full and production backend audits are required before artifact packaging.

Native optional bindings follow actual Node lookup from each declaring package,
including nested aliases, hoisted workspace packages and scoped parents. An
unrelated workspace or a matching version hidden behind an incompatible nearer
package cannot satisfy the declaration. The complete platform, libc, version,
integrity and installed Linux ARM64 checks remain strict, including the real
TypeScript 7 compiler. Negative and positive resolver fixtures run in normal CI.

The HTTPS fixture client trusts only its explicitly supplied certificate and
retains hostname authentication. Missing or unrelated trust and an incorrect
hostname reject; generated certificates, inline PEM, PEM files and PFX remain
supported. The trust is request-local, with bounded transport failure and cleanup.
