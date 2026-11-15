# PL01, bounded fixture producer lifecycle

2026-11-15. Source baseline `67495775edcdd3b122dac96d1b599f24710988c1`; branch `task/producer-lifecycle-v1`. Test-first plan, no guard/schema changes.

## Named tests, before implementation

- PL01: three fixture assets, two actual loopback HTTP readers, at least 8,000 ms physical activity; successful producer heartbeats spaced at most 1,000 ms. Twenty checkpoints converge exactly, at most 50 revisions. After heartbeat stop, existing bridge timer freezes in at most 6,000 ms; ten late heartbeats reject, zero revivals. Zero provider calls, no UI/VM.
- PL02: ten independent approval → observation → acceptance interleaves. Ten initial checks succeed; ten post-observation checks reject `STALE_VERSION`, pending lists empty 10/10, zero accepted/completed receipts.
- PL03: 10,000 pure tick-budget samples. Three drones at 1 Hz for 600 seconds require exactly 1,800 observation revisions, exceeding 999 ordinary commits (revision 1,000 reserved for freeze). Existing60 mutation attempts/session/min also includes heartbeats. Proposed2-second heartbeat plus10-second per-asset telemetry uses48 attempts/min and180 observation revisions/600s; arithmetic only, not a measured ten-minute run or approved cadence change.

## Implementation plan

1. Call actual seed, authority, HTTP bridge and core guard exports. Use test-driver heartbeats and explicitly unknown fixture telemetry, not a Marco executor.
2. Keep heartbeat scheduling sequential and bounded; capture real elapsed durations. Close bridge listeners/timers in every finally block.
3. Run focused native/compiled tests and typecheck. Record actual receipts below. Publish source-pinned handoff questions, no frontend edits.

## Non-goals

No 600-second real-client test, Marco Runtime/executor, provider/media calls, frontend/UI, VM, core/config/schema changes, revision-ceiling relaxation, coordinate origin invention, Git delivery or outward messages. Ten-minute real-client acceptance remains deferred and unrun. Eight physical seconds do not prove 600 seconds of readiness.

## Results

2026-11-15, macOS27.0.1, Node26.11.1, npm11.20.0, pinned TypeScript5.9.3. Focused native3/3; complete existing check runner native223/223 and compiled223/223, zero failures/skips, exit0. `npm ci --ignore-scripts` exit0/audit0 vulnerabilities; typecheck/compiler/diff-check exit0. Initial typecheck failed because local compiler was absent; pinned existing dependency installation resolved it, no package/lock change.

Focused measured PL01: 8,030.392ms physical activity, maximum heartbeat gap402.646ms, producer stop→freeze5,026.937ms, twenty reader checkpoints20/20 equal, twenty successful observation commits across three assets, twenty-one successful heartbeats (zero heartbeat revisions), final21 revisions including freeze, ten late heartbeat rejections10/10, zero revival. Actual92 loopback HTTP requests. No command/receipt, frame/media or provider call generated. Unknown capture times/positions stayed null for3/3 latest asset rows.

PL02: ten independent actual HTTP runs, ten positive pre-observation acceptance checks, ten post-observation `STALE_VERSION` rejections, ten empty pending-command lists, zero accepted/completed receipts. PL03: 10,000 pure budget samples, exactly1,800 observation revisions at600s/3assets/1Hz; proposed2s heartbeat/10s per-asset telemetry calculates48 mutation attempts/min and180 observations/600s. No batching/cadence/core change implemented or approved.

Every test-owned bridge closed in finally; HTTP driver uses non-pooled requests. Existing checker removed its unique generated compiled directory; no persistent listeners or heartbeat drivers left running. Coordinator TypeScript review/Git delivery and new hosted Node24/26 CI remain pending. No genuine provider, frontend, VM or deployment work performed.

Ten-minute real-client/Marco-producer acceptance remains **deferred, unrun**. This is8 physical seconds of synthetic fixture activity plus5 seconds of producer-loss proof, not600 seconds, no integrated three-drone mission execution, no production authentication/distributed authority proof. [Producer handoff](../contracts/producer-handoff.v1.md) records unknown mappings and exact owner questions.
# Consolidated follow-up verification

Root complete native and TypeScript-compiled checks on source `cbcae6a`,
2026-11-15, Node26.11.1: 242/242 native and 242/242 compiled, zero failures/skips,
typecheck/check-runner exit0. Compiled duration13640.896167ms. Includes Gemma
queue, corrected cached-result deadline, safe provider preflight and this
fixture producer harness. No provider account check, inference, frontend or VM
startup occurred in these tests. Hosted Node24/26 follow-up CI pending.

