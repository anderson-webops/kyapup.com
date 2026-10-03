# Guarded build dependencies

Kyapup adopts the reviewed Vitesse template `v2.1.4` fixes for two unpatched transitive build-tool advisories. Root npm overrides resolve `listhen` and `braces` to local, MIT-licensed forks under `vendor/`.

- `vendor/listhen` replaces `node-forge` with `selfsigned` for temporary development TLS certificates while preserving HTTP, PEM, PFX, ESM, CommonJS, and CLI behavior. This removes the affected path for [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
- `vendor/braces` bounds parser and AST-walker nesting while preserving ordinary patterns. This addresses [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

The root test command checks fork behavior and lockfile resolution. Retain these forks until reviewed upstream fixes pass the same tests, full/production/API audits, and exact runtime-artifact acceptance. This change does not relax protected gallery, upload, authentication, or host promotion boundaries.

The refreshed lock also carries Sharp `0.35.5` and its Linux ARM64 libvips package `1.3.4`. The runtime contract names their verified native filenames exactly, so the artifact gate rejects mismatched or missing bindings.
