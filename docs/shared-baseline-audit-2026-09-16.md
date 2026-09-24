# Shared baseline review

Baseline source: `3011ca8663c6a551d0fd31406af7ffb13f7e2663`.
Candidate: 2.1.1. This report covers source changes and finite local measurements;
production activation is separate.

Both the root workspace graph and independent direct backend lock contained known
advisories. Targeted compatible lock updates resolve brace-expansion, fast-uri,
js-yaml, nanoid, qs and svgo; Vitest is aligned to the patched 4.1.11 graph.
Clean root installation and both full dependency audits now report zero findings.
No audit exclusions, force upgrades or package-manager fallback were introduced.

The default rate store retained one counter per new identity. The replacement
retains at most 10,000 active identity counters plus one conservative overflow
counter. Existing windows are preserved; churn cannot evict a caller's quota or
refund overflow. At capacity, new identities share the remaining overflow quota,
which can reject legitimate new callers during extreme churn. Existing counters
remain independently enforced. Expired windows recover space without an interval.

Three paired runs used the same locked express-rate-limit 8.6.1 baseline, 2,000
normal identities with ten requests each, then 100,000 distinct synthetic
identities. Median peak RSS fell from 103.02 to 73.11 MiB (29.0%), heap from 34.43
to 13.42 MiB (61.0%), and processing from 45.67 to 22.99 ms (49.7%). Baseline held
102,000 identities; candidate held 10,000 plus overflow. A normal caller's next
counter was 11 in both. No forced GC was used. These are store-level churn
measurements, not ordinary full-site or production memory claims. Raw inputs,
samples and compiled/module hashes are in
`measurements/rate-storage-2026-09-16.json`; the reproducible harness is
`scripts/measure-rate-storage.mjs`.

The direct server now limits accepted sockets to 256, within existing request,
header and keepalive deadlines. Repeated SIGTERM/SIGINT remains idempotent while
accepted HTTP connections drain; a real partial-request regression confirms the
second signal does not abort the drain. Closing that connection produces a clean
exit before the existing ten-second force deadline. Necessary behavior and the
twenty-second source service shutdown budget are retained.

Minimal liveness and readiness aliases preserve `/api/health`; unavailable
readiness fails closed and recovers, probes reveal no diagnostics, and stopping
rejects new application work. The starter has no database, auth/session/role
workflows, code execution, mail or background jobs. It remains a static frontend
with a small independent API. Downstreams adding such features need their own
authorization, dependency health and cleanup review.

Local validation passed clean installation, full lint/types, eleven API/Netlify
tests, static generation and backend compilation, deployment-output checks,
twenty Linux ARM64 lock declarations, direct runtime/drain checks, and four
accessibility route/theme cases. Registry verification covered 3,016 packages
and 990 attestations. Lock declarations are not native artifact acceptance;
the exact Linux ARM64 archive gates in `runtime-artifact-contract.md` must pass
before publication. Raw logs remain with the owning local run.

The reusable artifact verifier and namespace tests cover the independent backend
production graph, all required compiled modules, static output, copied-tree
hashes, readiness recovery, restart and missing-module rejection. Preserve the
separate Netlify adapter and review its platform output separately when deployed.
Do not infer that these shared improvements have already been applied to every
downstream website.
