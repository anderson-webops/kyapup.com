# Guarded braces fork

This local package is based on upstream `braces@3.0.3` (MIT; see `LICENSE`). It exists because upstream has not published a patched release for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

The fork limits structural nesting in the parser and checks directly supplied ASTs before the recursive compile, expand, and stringify walkers. The root npm override makes transitive `micromatch` consumers use this fork. `scripts/test-braces-compat.mjs` checks the lockfile, the reported exhaustion patterns, direct AST entry points, and ordinary expansion behavior.

The second local patch also bounds shallow expansion to 10,000 cumulative items
and 1 MiB of generated UTF-8 text, including intermediate products and ranges
whose caller disables the ordinary range limit. Existing nesting checks and
ordinary compile, stringify and expansion behavior remain covered by regressions.

Replace this fork only after upstream publishes a verified fix and the same compatibility and audit checks pass against it.
