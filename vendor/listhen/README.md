# Local listhen security fork

This directory is based on the published `listhen@1.10.1` package
(`sha512-6nt/86SkqUQSLW1ofz8MxC6RhRMqOl3ONISe6qqvJ3xj09aJWQx6DhgSZpugs3PX4PXdOas/WD6A9jx6J2N19A==`).
The upstream MIT license is retained in `LICENSE`.

The first local patch removes the unpatched `node-forge` dependency
associated with GHSA-86w9-cpqp-85rv. Local certificate generation uses
`selfsigned@5.5.0`; PFX files are passed to the native Node HTTPS server.
The HTTP listener and public package entrypoints remain those of listhen.
This is a Nuxt development/build-time dependency. It is not part of the
standalone Express API runtime or the generated static front-end.

The second patch passes the existing bundled Linux opener directly to
`/bin/sh` as fixed script input, keeping the URL in a separate argument.
It preserves the bundled fallback without creating or executing a predictable
helper in shared temporary storage. Electron/Android retain the system opener;
the macOS and Windows branches remain unchanged. Isolated child-process
fixtures exercise both package entrypoints with a pre-existing temporary
helper, verify the exact command/script/URL boundary without launching a
browser, and run the bundled helper's normal help path. HTTP and TLS/certificate
modes remain covered by the existing listener fixtures.

Replace this fork with an upstream listhen release once it removes the
affected dependency and passes the repository's full listener, build,
dependency-audit, and release-artifact checks.
