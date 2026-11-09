# deepmerge compatibility patch

Based on the integrity-verified npm `deepmerge@4.3.1` distribution from
https://github.com/TehShrike/deepmerge. The original MIT license and public type
declarations remain included. `4.3.2-webops.1` identifies this local patch, not
an upstream release.

Both CommonJS and UMD implementations define destination keys as own enumerable,
configurable, writable data properties. This prevents `__proto__` writes from
changing a merge-created object's prototype while preserving ordinary merging,
arrays, symbol keys, clone options and custom merge callbacks.

The source tests exercise the target-copy, source-copy, recursive, array and
`all` paths in both distributions. The original 4.3.1 bundles fail the prototype
regressions. This addresses GHSA-gcqx-w48m-w2h4, for which upstream has no published
patched release. Replace this fork after a reviewed upstream release preserves
these security and compatibility invariants.
