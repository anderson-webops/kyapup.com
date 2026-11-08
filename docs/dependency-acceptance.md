# Dependency acceptance

Nuxt-security's removal plugin uses the maintained Unplugin-remove
1.0.3-webops.1 distribution with Babel 8, Magic-string 1 and Unplugin 3.7.
Its official input bundles Babel-types 7.25.2 into eight compiled payloads.
The replacement source externalizes the modern compiler dependencies; normal
full/production audits also cover the original package and that exact formerly
bundled version through an independent lock. Original license, options and root
declarations are retained. Native adapter declarations resolve only their own
framework, preserving strict Vite use without requiring unrelated optional
framework types. All six original ESM/CommonJS adapter paths remain available.
The universal root declaration retains upstream Unplugin's aggregate interface;
strict aggregate consumers require its optional framework type peers. Native
adapter imports keep that requirement scoped to the selected framework.

Debugger removal now uses syntax nodes, preserving string/regex/identifier text.
Configured global console statements are removed with scope-aware traversal;
local bindings and value-position calls retain their behavior. Statement edits
preserve valid control-flow bodies and produce maps against the original source.
`npm run check:remove-package` reproduces the archive and verifies its consuming
locks. `npm run test:remove` exercises semantics, maps, filters, module formats,
and strict consumer types. `npm run test:remove-host` checks actual Nuxt-security
selection, Rollup/Rolldown/Esbuild and available Webpack builds, plus real Vite
development/production browsers. Rspack's adapter descriptors load in both module
formats; its optional compiler is outside this Vite site's build qualification.

Vue Router 5's macro and scope-walker paths now both consume Ast-kit 3.0.1.
The maintained `@vue-macros/common` 3.1.4-webops.1 distribution integrates
Magic-string-ast 2 and Magic-string 1, declares its Babel 8 types explicitly,
and removes the obsolete import-assertions parser option. Standard `with`
attributes remain supported; legacy `assert` syntax produces a parser error.
Its original declarations and license stay unchanged. The official archive,
reproducible producer and independently locked original-version audit retain
the upstream identity and its older dependency graph for advisory checks.

`npm run test:router-compiler` covers modern AST nodes, setup-scope rejection,
shadowing, source offsets, macro removal, maps and strict public type contracts.
`npm run test:router-browser` uses the actual file-router plugin to generate
typed routes, render SSR, navigate dynamic routes and browser history, update
route metadata without losing application state, and build and execute split
production routes. A stale nested Ast-kit 3.0.0 lock entry was removed before
normal lock normalization and frozen installation; no cross-major override
changes an upstream caller's accepted range.

The Vue JSX adapter uses Babel 8.1 and Vue Babel JSX/resolve-type 3 through
`vendor/plugin-vue-jsx-5.1.6-webops.1.tgz`. Its upstream provider still requires
Babel 7. The maintained distribution uses Babel 8's explicit synchronous
configuration API and attaches production purity comments to the call AST,
preserving valid identifier nodes. Original declarations, license and remaining
modules stay unchanged. The Node, Vue and Vite ranges reflect the qualified
runtime. `npm run check:vue-jsx-package` reproduces the archive from its official
integrity-pinned input and verifies every consuming lock. Full and production
audits also cover the independently locked original-version distribution.

`npm run test:vue-jsx` exercises actual Nuxt resolution, type erasure, class
fields, fragments, v-model, slots, sourcemaps, syntax failures, built-in TypeScript,
SSR and client HMR transforms. `npm run test:jsx-browser` additionally renders
through Vue SSR and a real browser, changes a TSX module to exercise hot reload,
and tests events and bindings in both production transform modes. The Babel 8
syntax plugins are also selected through Nuxt's supported optional peers.
Other Babel 7 callers, including Vue's SFC parser, Magicast
and Vite-plugin-checker, retain distinct migration work. This integration
does not establish that those different compiler APIs have been upgraded.

Express 5's legacy CommonJS calls use Cookie 2, Encodeurl 3, Raw-body 4 and
Type-is 3 through the reviewed bridges in `vendor/http-compat/`. The upstream
ESM modules, licenses and original metadata remain byte-identical to their
SHA-512-pinned official archives. Only the CommonJS entrypoints and declared
decoder/MIME dependencies are adapted. `npm run check:http-compat` reproduces
all four package payloads and verifies both consuming lock integrities. Their
full dependency graphs remain included in audits. Runtime acceptance requires
the bridge and upstream modules independently of the generated inventory and
exercises cookie serialization, URL encoding, MIME matching, UTF-32 reading
and body limits without source or development dependencies.

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

The independent graph also integrates Query6, Balanced-match5, Chalk6,
Content-type3, Diff9, Env-paths4, Minipass7, Flush2, Pipeline3, Proggy5,
SPDX-expression-parse5, Supports-color11 and Yallist5. Existing npm consumers
retain callable Env-paths, Flush's function shorthand and Pipeline's stream-first
constructor through three private adapters in `build-toolchain/compat/`.
Original modern modules, declaration files, licenses and export conditions stay
available. `npm run check:npm-compat` reproduces each official-input-bound archive
and checks the independent lock integrity. Bootstrap copies and verifies every
declared local tool archive before accepting its complete payload inventory.
The original417 npm CLI files and original thin npm archive remain unchanged.
Full and production audits also cover the separate original-version lock in
`build-toolchain/compat/`, so private adapter versions cannot hide an upstream
advisory. Its manifest and lock are part of the verified cached source inputs.

Actual parent regressions exercise Node-gyp, Arborist query and progress,
npm patch generation and CycloneDX, cache content/index/stream integrity,
offline retained HTTP responses, callback/promise completion, pipeline errors,
color and brace APIs. Strict TypeScript6/7 fixtures cover both modern imports
and callable CommonJS adapters, rejecting invalid calls. Disposable profile
copies verify that changed local archives and installed bridge bytes fail
before reuse; the accepted shared profiles remain unchanged.

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
frontend declares that current pair directly, and the root now requests the
same 0.8.2 kit. The maintained Unhead 3.4.3-webops.1 distribution qualifies
that modern kit for its unchanged RPC, frame and client modules. Its original
3.4.3 peer metadata requested 0.7; merely changing the root kit left that
optional peer unresolved, and ordinary lock refreshes retained the invalid
placement. The private distribution updates the supported peer contract only
after real host initialization, RPC setup, original UI and bridge injection
regressions pass. All original module, type and license bytes are preserved;
`check:unhead-package` reproduces the archive, and an independent original-version
lock remains included in full and production audits.

The original Vue plugin's 9.0.0-rc.2 distribution and legacy provider retain their
declared 0.7 consumers through local copies. Regressions
resolve the actual root, Nuxt, Unhead, Vue plugin and legacy provider paths,
require matching modern declarations, and reject incompatible legacy resolution.
A layout with an incompatible kit must fail the complete installed graph.
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
API rather than falling back to a legacy peer provider.

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

## Configuration editor on Babel 8

Nuxt DevTools, its wizard and Nitro use the maintained Magicast
`0.5.5-webops.1` distribution. `vendor/magicast/UPSTREAM.json` binds the
original registry archive and the reviewed dependency identities;
`scripts/package-magicast-compat.py` reproduces the maintained archive and
checks every consuming lock entry. The original declarations, license,
entrypoints and custom Recast/ast-types implementation remain. Changes to
the official integration anchors require a fresh review.

The bridge extends the custom AST schema for native Babel 8 values and fields,
including bigint, dynamic imports, generic arguments, signatures, mapped
types, enums, qualified namespaces and template literal types. Current Babel
printing handles changed syntax while Recast retains its source reuse and
source-map behavior. The dynamic-import proxy retains `$callee` and mutable
`$args` on an actual `ImportExpression`; no legacy parser mode is used.
Proxy literal writes use current Babel builders, so fresh printing also works
after composing dynamic-import arguments and nested configuration objects.
Configuration helpers attach parsed expression nodes when updating a
variable or `satisfies` initializer, rather than inserting a string into the AST.

Removed decimal/record-tuple/import-assertion syntax and the obsolete minimal
pipeline proposal are no longer enabled by default. Standard import attributes
remain supported. A caller needing another current proposal can supply its
own supported parser explicitly. Unsupported syntax produces a parsing error.

The historical input archive embeds source-map-js 1.2.1, affected by
GHSA-68fv-2mgg-jv7q. Its original bytes remain evidence, not a clean runtime.
The maintained archive removes that embedded implementation and uses patched
source-map-js 1.2.2. A bounded subprocess regression sends invalid and excessive
indexed offsets through Magicast's actual map-composition path. The independent
original-version audit graph preserves Magicast 0.5.5, Recast 0.24.0 and
ast-types 0.16.3, with the supported external source-map-js 1.2.2 dependency;
it does not conceal or certify the historical embedded implementation.

`npm run test:magicast` covers configuration edits, native AST mutations,
fresh-tree printing, strict positive/negative public type contracts, files,
source maps and deterministic packaging. `npm run test:magicast-browser`
executes `magicast/core` and helpers in real Chrome using both normal and
minified browser bundles. Full project checks, the independent full/production
audits, and exact artifact acceptance remain release requirements.

## Vue compiler dependency integration

The maintained `@vue/compiler-core` and `@vue/compiler-sfc`
`3.5.45-webops.1` distributions preserve the Vue 3.5 runtime interface and
official entrypoints, declarations and licenses. Their actual parser and
walker graphs use Babel 8.1 and Estree-walker 3; SFC editing uses Magic-string 1.
The SFC resolver consumes native argument, identifier, signature, mapped-type,
enum, import-type and template-literal fields. Qualified namespaces are expanded
only in the internal type scope, preserving the public native script AST.

The parser, walker and text editor embedded in the original browser build
are removed as complete, integrity-bound sections. The maintained standalone
browser build is reproduced using the independent locked
`vendor/vue-compiler/browser-tools` graph and the pinned bundler, with no external
imports. Its entry and dependency paths are bounded to that graph; redistribution
licenses are retained for every newly bundled package. Node's synchronous
compiler entrypoints share one deterministic CJS build of the current public
dependency entrypoints from the maintained core package. This supports Walker
3's import-only contract and avoids Node's concurrent import/require loading
race. The SFC distribution requires that exact maintained core version, keeping
the parser and text-editor instances coherent within the synchronous compiler.
Bundled dependency metadata pins the same versions as the independent graph.

`npm run test:vue-compiler` compares actual emitted runtime options with the
original compiler in development and production, and verifies native ASTs,
explicit rejection boundaries, imported types, maps, production entrypoints,
strict public declarations and packaging. `npm run test:vue-compiler-browser`
compiles the same supported cases in real Chrome, checks standalone/Node parity,
native ASTs, scoped styles and the browser filesystem boundary, then mounts
browser-compiled reactive code and verifies its rendered state and events.
Existing unsupported macro forms remain explicit errors.

Install both independent graphs with their committed locks before checking or
reproducing the archives. The full and production audit commands include those
graphs with original registry identities. The original upstream byte archives
remain evidence, while the producer rejects changed patch anchors, unreviewed
toolchain versions, unsafe tar members and mismatched consuming locks. This
source qualification remains separate from release, native artifact and
protected production acceptance.

## Stable Nitro provider qualification

Nitro2.13.6 keeps its original implementation, public exports, types, license and
archive identity. Exact scoped overrides qualify Magic-string1.4.5, unctx3.0.1
and the maintained current unwasm0.6.3 provider. Application text-editor consumers
now share major1; original-version fixtures retain their separate dependency
graphs. Registry stable Nuxt/Nitro remain the selected framework contracts.
The separate Nitro3 line is a release candidate at this review. Nitro2's H3v1
request-object boundary remains distinct from H3v2 consumers, with the real
server fixture using Nitro's own provider rather than mixing event models.

Unctx3 preserves the actual Nitro context API, including native asynchronous
request isolation. The maintained unwasm0.6.3-webops.1 distribution repairs two
reproduced stock failures: query-suffixed WASM paths resolve their underlying
file before restoring the suffix; unresolved import modules retain explicit
caller provisioning instead of losing their named bindings. The native engine
continues rejecting absent/invalid imports and malformed binaries. Original
unwasm0.5.3 and stock0.6.3 reproductions remain explicit negative controls.
Public WASM declarations, entrypoints, dependencies, licenses and unrelated
implementation bytes remain unchanged.

`vendor/nitro-tools` retains integrity-bound distributions and independently
locked original/current-stock provider graphs for complete audits. Nitro's
archive is a byte reference for the actual fully audited installed parent,
rather than a second executable Nitro graph. Archived original inlined code is
retained as evidence, with no claim that dependency audits certify every old
inlined implementation. `npm run check:nitro-tool-inputs` verifies exact archive,
installed-byte and consuming-lock identities plus deterministic maintained WASM
packaging. Root lock normalization removes only the proven stale nested unctx2
provider before a normal frozen install and complete graph check.

`npm run test:nitro-tools` checks real context concurrency, cleanup and error
recovery, native/parser agreement, Rollup bindings and emitted asset bytes/maps,
legacy Deno editing hooks, strict positive/negative types and package safety.
The actual built Nitro server is copied and hash-verified, its fixture sources
removed, and its Node file permissions restricted to runtime files and an exact
test prelude. Explicit reads of checkout/development inputs are denied. It runs
two rounds of64 concurrent HTTP requests, deliberate request failure/recovery,
WASM execution and retained restart with unchanged runtime hashes and graceful
shutdown. Its listener and requests use loopback; this is local source acceptance.
`npm run test:nitro-tools-browser` executes six real browser binding cases.
Emitted-WASM asset checks establish bytes, relative paths and maps, with target
loader acceptance remaining distinct from those source checks. Published release,
native artifact and protected deployment acceptance remain separate gates.

## Rollup text editing, traversal and reference classification

The maintained utility/CommonJS/inject/replace cohort uses Magic-string1.4.5,
Walker3.0.3 and current reference classification3.0.3. Native ESM entrypoints use
the current public dependencies. Synchronous CJS entrypoints share a deterministic
tools build in the exact maintained utility version, avoiding import-only
resolution failures and concurrent ESM loading races. Inject's older inlined
reference helper is replaced by the current public provider, including correct
class-field classification. CommonJS's stale embedded version string now matches
the maintained package identity. Original public declaration bytes remain intact;
an identical `.d.mts` copy provides the correct native ESM type boundary alongside
the CJS declarations and unchanged runtime entrypoints.

`vendor/rollup-plugins` retains original registry archives, an independently
locked original graph and the separately locked tools graph. Two original
archives contain one reviewed, byte-identical dot-path duplicate apiece. Original
integrity and exact member digests bind their explicit normalization; conflicting,
missing or unreviewed aliases fail. Maintained archives remain strictly canonical.
Inject's README links the omitted repository-root MIT license, supplied verbatim
from its exact recorded commit. All newly bundled licenses are retained;
is-reference's publisher supplies its MIT declaration in the manifest and README,
both preserved verbatim rather than replaced by an invented notice.

`npm run check:rollup-package` checks deterministic archives, all consuming locks
and installed bytes. `npm run test:rollup-compat` exercises actual Rollup builds
with both ESM/CJS plugin factories and outputs, original-provider comparisons,
cycles, live state, bounded dynamic require, mixed modules, builtins, injection,
replacement, lexical scopes, class fields, maps, concurrent loading and strict
positive/negative ESM/CJS types. Dynamic target patterns follow the public
working-directory-relative contract. `npm run test:rollup-browser` executes both
cohorts' generated browser bundles and verifies rendered state, events, injection,
field keys and build flags. Full/production audits include both independent graphs.
Nitro/unctx/unwasm and file-tracer consumers have separate qualification below;
compatible active-fleet adoption remains unfinished.

## Native watcher and configuration-reload cohort

The frontend already selected Nuxt DevTools 4.1.0. The remaining Nuxt and
ESLint kit consumers now select that same native major, and all application
Chokidar consumers select 6.0.0 rather than retaining nested major-5 copies.
Original package implementation, declarations and licenses remain unchanged.
`vendor/watchers` retains integrity-bound current and original comparison inputs,
with an independently locked and audited Chokidar 5/Jiti graph.

Real watcher tests cover native and polling events, exclusions, unwatch/close,
atomic/stable writes, missing paths, repeated recovery, symlinks, safe watched
metadata, Nuxt's throttle-recovery adapter and both Unstorage filesystem formats.
The actual Nuxt/DevTools application runs in both regular and granular watcher
modes with state-preserving browser HMR, route creation/removal, developer UI
and the kit's existing subprocess contract. Watcher and loader public types are
checked strictly; Nuxt types retain their required generated-project checks.
These tests preserve development-only scope and production exclusions.

The cohort exposed an independent Jiti 2.7.0 failure: a real C12 change event
reloaded stale native-ESM configuration despite `moduleCache: false`. The
maintained `jiti@2.7.0-webops.1` distribution honors that policy for ESM,
CommonJS and JSON through its existing transformation/evaluation path, including
`tryNative: true`. UTF-8 BOM handling, CommonJS exports/`this` binding and Node
filename globals remain compatible. Default caching and explicit native-module choices remain
unchanged. It uses no accumulating cache-busting module URLs. Original CLI,
types, exports, licenses and other bundled implementation remain unchanged;
embedded compiler review stays distinct from registry dependency audits.

`npm run check:watcher-inputs` verifies original bytes, locks and the reproducible
maintained loader. `npm run test:watchers` exercises configuration reloads,
relative imports, top-level await, metadata, syntax-error recovery, concurrent
evaluation, original negative controls and deterministic archive guards.
`npm run test:nuxt-watcher-browser` verifies the real framework consumers. Full
and production audits also cover the independent original comparison graph.

## File-tracer provider acceptance

The maintained `@vercel/nft@1.11.1-webops.1` distribution uses the original
native `estree-walker@3.0.3` implementation. Its existing asynchronous analysis
boundary imports the ESM walker before traversal. Its synchronous wrapper
preprocessor uses the qualified Rollup utility cohort's reproducibly built
Walker 3 CommonJS provider, retaining synchronous behavior and shared licenses.
Awaited visitors, scope handling and dependency/asset reasons remain intact.
Every other implementation module,
public declaration, CLI, export and license remains byte-identical. The original
file-tracer and modern Walker archives are integrity-bound in `vendor/nft`, and
the original parent graph is independently locked and audited. That comparison
graph retains the unchanged parent and Walker 2 while selecting the separately
qualified Glob 14/Minimatch 11 providers. The unmodified original graph's affected
Glob 13/Minimatch 10 audit is retained as failed evidence, rather than declared
clean or suppressed.

`npm run check:nft-package` reproduces the archive and checks consuming locks,
installed bytes and original inputs. `npm run test:nft` compares actual CJS/ESM,
conditional/dynamic imports, asset globs, native paths, symlinks, shadowing,
warnings, exclusions and reason chains with the original parent. It exercises
concurrent delayed I/O, repeat/cache and failure recovery, strict positive and
negative TypeScript 6/7 consumers, and actual CLI tracing/copying. The copied
synthetic application runs repeatedly with read access limited to its output.
Existing compiled Nitro and browser checks remain separate required gates.

## Vite checker and native Babel 8 code frames

The maintained `vite-plugin-checker@0.14.5-webops.1` distribution uses
`@babel/code-frame@8.0.6`, its current identifier validator and tokenizer.
Babel 8's code-frame columns are zero-based and its former `SourceLocation`
type is no longer exported. The checker retains its one-based diagnostic
locations and optional-column declarations, converting only at its code-frame
boundary. Exclusive multiline end columns follow the actual source range;
the previous renderer's extra final caret is corrected. Other checker engines,
public entrypoints, peer contracts, runtime overlay and license remain unchanged.

The integrity-bound original archive and independently locked original graph
remain under `vendor/vite-plugin-checker/upstream` for comparison and audits.
`npm run check:checker-package` verifies deterministic packaging, consuming
integrity and every installed byte. `npm run test:checker` checks source and
location preservation, original single-line output, correct multiline ranges,
native public types, real ESLint diagnostics, Stylelint adapter fixtures and
actual TypeScript worker error/recovery. `npm run test:checker-browser` checks
real overlay highlighting, reconnection, repeated repair and clean production
builds, including a deliberately rejected type-error build. The full and
production audit commands retain original package identities in that separate
graph. Application Babel providers use major 8; original-version fixtures retain
their own reviewed dependencies. Release/provenance and host acceptance remain
separate gates.
