# Local listhen security fork

This directory is based on the published `listhen@1.10.1` package
(`sha512-6nt/86SkqUQSLW1ofz8MxC6RhRMqOl3ONISe6qqvJ3xj09aJWQx6DhgSZpugs3PX4PXdOas/WD6A9jx6J2N19A==`).
The upstream MIT license is retained in `LICENSE`.

The only intended change is to remove the unpatched `node-forge` dependency
associated with GHSA-86w9-cpqp-85rv. Local certificate generation uses
`selfsigned@5.5.0`; PFX files are passed to the native Node HTTPS server.
The HTTP listener and public package entrypoints remain those of listhen.
This is a Nuxt development/build-time dependency. It is not part of the
standalone Express API runtime or the generated static front-end.

Replace this fork with an upstream listhen release once it removes the
affected dependency and passes the repository's full listener, build,
dependency-audit, and release-artifact checks.
