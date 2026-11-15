# Precision and presentation follow-up receipt

Run: 2026-11-15, macOS 25.2, Apple silicon, 10 CPUs / 16 GB RAM.
Production/test source: [`c2ff541578a9deceaed2dcfdc6cbd92b3b6f65b2`](https://github.com/nikolas-sapa/fire-command-center/commit/c2ff541578a9deceaed2dcfdc6cbd92b3b6f65b2).
Later delivery commits change documentation only.
Base: draft [PR #2](https://github.com/nikolas-sapa/fire-command-center/pull/2), `c2682d4e855b8daf76e297315a63b86e58ce43ff`.

## Verified fixes

- **FP01:** the permanent test compiled the pinned original solver and failed as expected, `2 !== 20`. Current compiled `runSpread` reaches **20/20** cells on all ten runs; complete arrival arrays are identical. Last arrival **9.500218391418457 min**, within 0.0001 min of the issue's independent control **9.50021869**.
- **FP02:** independent O(V²) scan-priority shortest paths, without the production Heap or Float32 accumulation, exercises **38 improved queued routes / 42 reachable cells**. Worst absolute error **0.000010538332730902766 min**, below 0.0001. The original `tc > T[i]` guard remains; heap keys equal stored distances, without epsilon or coefficient tuning.
- **FP03:** blocked corridor, no seeds, short horizon and a deliberately upward-rounding Float32 horizon boundary pass. Explicit fractional seeds expand; seeds beyond the horizon remain unreachable.
- **FP04:** both 190-second tours at 10 Hz pass, max Z0 **1**, zero automatic high-risk approvals, all six beat jumps, one-click approval isolation, future-fire independence and hold/apply checks. Final worst Node tick: Mati **73.1 ms**, Caldor **28.8 ms**. These are not browser FPS or a per-tick latency acceptance claim.
- **Paid default:** no automatic regeneration, exactly **four sequential 1K submissions** in the default mocked run, including rejected palette outputs. Higher retry budgets require a separate explicit UI selection and matching billing consent. Stitching never submits a generation. Existing ambiguous-failure reservations and same-request recovery remain.
- **Terrain decoding:** reject non-256×256 source tiles before decompression; cap inflation at exact scanline bytes; reject excess output and invalid PNG filters. Real decoder and malformed fixtures execute in the non-billable suite.

## Reproduce

From `proposal/fcc`:

```bash
node scripts/check-spread-precision.mjs --baseline  # expected exit 1, 2 !== 20
npm run test:spread-precision
npm run typecheck
npm test
npm run test:monitoring
npm run test:image-lab
VITE_CESIUM_ION_TOKEN='' VITE_GOOGLE_MAPS_KEY='' npm run build
npm run test:pwa
node scripts/check-mati.mjs
git diff --check
```

All positive checks pass. The no-key production build transforms **216 modules**. PWA **9fb3e6efd0c25093**, **436 local files / 40.4 MiB**, passes provider/API-cache exclusion and pinned-shell checks. Monitoring covers parsers, real bundled fixtures, simulator isolation, failure/stale/saved states, size limits, cancellation, six camera paths, pause clocks and worker pixel equivalence. HTTP adapter tests use genuine loopback servers with mocked provider responses, not paid calls. Dependencies and frozen REV A/B/C bytes remain unchanged.

The earlier checkout's rate-limit failure was real for that earlier mutable state. The frozen candidate has matching **20/minute** code, documentation and tests; its full suite passes. This review did not weaken a failing numeric gate.

## Prediction failures retained

Fresh `npm test` tour output, not observed fire truth:

| Check | IoU against reconstruction/replay | Predicted / replay ha | Documented-checkpoint error |
|---|---|---|---|
| Mati initial +30 min | 0.30 | 73 / 56 | none in window |
| Mati initial +60 min | 0.40 | 177 / 289 | west Neos Voutzas −33 min |
| Mati initial to coast | 0.37 | 476 / 1,248 | west NV −33, NV −30, Marathonos +19, coast +23 min |
| Mati later +30 min | 0.71 | 811 / 1,061 | Marathonos +3 min |
| Caldor initial +30 min | 0.78 | 2,558 / 2,022 | none in window |
| Caldor initial +60 min | 0.61 | 3,426 / 2,128 | none in window |

Mati still under-predicts reconstructed area and is late to the coast. Caldor over-predicts area and its initial overlap worsens versus the old solver. Fitted reconstruction agreement is not independent predictive skill. No coefficients were tuned. The old 178-minute coast miss remains historical pre-fix evidence, not this source's current result. Auxiliary sweeps, prior browser timings and private AI-screening results were not remeasured here.

## Publication and integration limits

- Final exact scope: **108 paths** in `REVIEW_SCOPE.md`, including 101 of the 107 frozen snapshot paths. Original dirty checkout is untouched. No backend/shared schema/CI/lock changes.
- Exclude all **249 experiment outputs and six study CLIs**, credentials, browser/auth state, dependencies, generated builds and scratch. Study tools depend on unpublished research inputs and need a separate paid-ledger concurrency review. Original local copies remain untouched; none was executed.
- Known local credential and private-key/provider-token scan found zero matches in candidate paths, without logging values. This is not a comprehensive security certification.
- This is a scoped correctness/publication review and source-wide build/test run, **not an exhaustive independent audit of the repository or every presentation-rendering path**. Prior UI/browser receipts are historical, not refreshed source-pinned proof. A fresh browser smoke/performance run and independent broad-diff review remain before promoting this draft.
- Read `producer-handoff.v1.md` at backend source `d1213b03edaaf439f0533caa6c37065929b7f08c`. All three d1–3/t1–3 mappings remain **unsupported/unapproved**, not inferred from names. No reviewed CRS/origin/axes/altitude datum or sim-tick→UTC relation is adopted. Unknown capture clock stays unknown; receipt time is not substituted.
- Legacy replay still has a per-page Runtime. Monitoring isolation is not a producer/crew bridge. Zero-Runtime crew readers, designated producer capability, factual receipts, bounded cadence and explicit >5-second-loss recovery are **not implemented or accepted** here. [Issues #8](https://github.com/nikolas-sapa/fire-command-center/issues/8) and [#9](https://github.com/nikolas-sapa/fire-command-center/issues/9) remain separate.
- No fresh frontend/backend launch, two-client ten-minute acceptance, provider request, VM, deployment or merge was performed. Parent PR stays draft/unmerged. Coordinator/root review and explicit launch permission remain required.
