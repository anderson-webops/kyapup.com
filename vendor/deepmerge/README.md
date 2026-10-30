# Kyapup deepmerge fork

This package is based on deepmerge 4.3.1 under its MIT license. It preserves the
CommonJS API and types while omitting enumerable `__proto__` keys in both object
copy loops. That prevents a crafted source or target from changing the returned
object's prototype. The change addresses
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
for which no patched upstream release is available.

The root workspace overrides all deepmerge dependencies to this fork. Keep
`scripts/test-deepmerge-compat.mjs` and both root audits passing when reviewing
an upstream replacement. Production API dependencies are locked separately in
`back-end/package-lock.json`.
