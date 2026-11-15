# Terminal and build parent compatibility

The original registry archives and their complete licensed inventories are bound
by `UPSTREAM.json`. Deterministic maintained distributions admit current providers
through the actual Brace-expansion, Dumper, Jest-worker, Minimizer, Jest-util and
Jest-types parents. Node26.13.1 is the supported application target.

Brace-expansion uses Balanced-match5. Dumper uses Supports-color11 and Is8.
Jest-worker30 uses Supports-color11 through its native ESM default export, and
Minimizer admits that worker major. Jest-util and Jest-types use Chalk6 while
retaining their existing public functions, types and entrypoints.
The maintained Jest-types declaration uses Chalk's current color-name type.
Jest-util declares the Picomatch types that its public declaration imports.

`python3 -B scripts/package-terminal-parents.py` reproduces the maintained
archives. Its `--check --source-only` mode verifies original and maintained bytes
and application references; full `--check` additionally verifies every locked and
installed application parent/provider and the independent original comparison
graph. All original implementation bytes, metadata, file modes and licenses
remain preserved except the explicitly reviewed worker export and color-type
adaptations.

Source, strict types, formatter/color, worker lifecycle and actual Webpack
minification regressions, clean installations, full/production audits and
registry signatures are required for qualification. Original comparison graphs
remain separate from the application graph. These build/development packages do
not extend the independent production API or its artifact contract.
