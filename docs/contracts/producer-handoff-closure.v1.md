# Issue #7 producer handoff closure, v1

2026-11-15. Backend proof pinned to [`db15588f40e2c7bb26de3322d06d99f51235b32d`](https://github.com/nikolas-sapa/fire-command-center/tree/db15588f40e2c7bb26de3322d06d99f51235b32d), branch `task/swarm-20261115-issue-07`. Closure preparation only, not a wire/schema revision. [Current issue #7](https://github.com/nikolas-sapa/fire-command-center/issues/7) records B01-B07 backend implementation merged and leaves cross-owner agreement open. [Bridge contract](backend-bridge.v1.md) and [producer handoff](producer-handoff.v1.md) remain authoritative.

Another session merged PR #2/#38 during reconciliation, per coordinator report. This pinned checkout predates those merges. No claim that current main lacks frontend; merge status proves neither Marco mapping nor producer/crew runtime acceptance. No frontend launched or edited here.

## Test plan before document

- SW07-01: all 7 B01-B07 groups traced to actual exports/tests, 0 backend fixture receipts labelled Marco integration.
- SW07-02: 3 asset/feed declarations reconciled, 100% unanswered mappings/clocks/Geo/Runtime/cadence/loss questions remain unaccepted, unknown values remain null.
- SW07-03: existing non-mocked localhost bridge tests, full native/compiled checker and typecheck, 0 failures/skips; record actual source/date/runtime/counts.
- SW07-04: local file links resolve with 0 missing targets; 0 backend/schema/package/CI/frontend/secret deltas.

Implementation: inspect current issue and pinned seam, rerun existing tests, publish factual closure gates, freeze for independent verification. No duplicate bridge implementation.

Non-goals: source/test/contract-signature changes, invented owner agreement or human identity, frontend launch/adoption, media/source activation, provider/account/credential changes, Convex/auth/cloud/deploy, real aircraft/crew orders or public alerts. Issue remains open.

## Actual local seam and numeric checks

| Group | Acceptance target | Existing check on pinned source |
|---|---|---|
| B01 | 2 HTTP clients, 20 identical received rounds; 10 local changes, 0 writes | [HTTP test](../../backend/tests/integration-http.test.ts) uses two native HTTP Agents, compares full DTOs 20/20. Ten test-local pin/camera changes add 0 revisions, not a browser UI test. |
| B02 | 20 races, 1 winner each, 0 duplicate commands | HTTP test runs 20 trials x 20 concurrent approvals: 1 success/19 conflicts/1 command each; 10 winning retries/trial add 0 revisions. |
| B03 | 20 forged/expired/wrong-role rejects, 0 commits | HTTP test rejects 100 malformed/foreign/body-role events plus 20 missing/expired/wrong-role approvals, 0 commits. Host/Origin, 64 KiB body, 60 mutation attempts/min, 16 polls, 10 s wait and 30 min capability TTL checks pass. |
| B04 | 24 obsolete proposals, 0 executable outputs; 10 observation interleaves, 10 rejects | [Session test](../../backend/tests/integration-session.test.ts) rejects 24 stale proposals and 10 telemetry/frame acceptance interleaves, 0 invented acceptance. [Lifecycle test](../../backend/tests/producer-lifecycle.test.ts) additionally proves 10 valid-before/10 STALE_VERSION-after HTTP checks. Tick121 exposes 0 live options; historical tick1 retains 1. |
| B05 | 10 rejoins, 0 duplicates/regressions; >5 s heartbeat loss freezes by 6 s; 10 old reconnects, 0 execution | HTTP test performs 10 rejoin snapshot reads, canonical freeze and 10 blocked producer command reads. Session test rejects 10 late heartbeats/checks and freezes once. These are fixture rejoin reads, not full physical-link/Marco recovery acceptance. |
| B06 | Preserve 20 frames including 10 unknowns; 10 duplicate frames, 0 revisions; 10 aged critical hypotheses retained | [Received-view test](../../backend/tests/received-view.test.ts) preserves exact payloads across 20 latest-per-feed views, 10 unknown capture cases, null geometry/calibration and 10 no-op duplicates. Ten unresolved critical hypotheses survive aging; corrupt suffix rejects even historical cutoff. Not 20 stored media objects or verified thermal pixels. |
| B07 | 1 actual localhost proposal/Chief approval/read/check/receipt/frame/two-snapshot loop; 0 provider calls/fabricated completion | HTTP fixture loop records enqueued, supplied sent/delivered receipts, instantaneous check, supplied accepted receipt and frame1. Two DTOs match at revision6; command remains accepted, never completed. These are test-driver facts, not Marco executor facts. |

Real exports: [`createBridgeAuthority`](../../backend/integration/session.ts) wraps existing core synchronously, trusted `ActorContext` separate from wire body; [`createReceivedView`](../../backend/integration/received-view.ts) validates canonical history and projects receipt cutoff; [`startLocalBridge`](../../backend/integration/local-http.ts) binds `127.0.0.1` with exact Host/Origin and server-owned expiring fixture capabilities. Received DTO strips seed/private actor/session/trace/world. `coordinate_frame=null`, `media_verified=false`; acquisition clock never becomes receipt clock. Crew reads instantiate 0 Runtime instances in backend, but frontend behavior remains unverified. Local capabilities are not production authentication.

## Fresh verification receipt

2026-11-15, macOS27.0.1 build26A434, Node26.11.1, npm11.20.0, locked TypeScript5.9.3 / @types/node24.10.1. Deterministic bridge fixture `seed()` uses incident i1/run r1 and tick1; lifecycle test uses a fresh disposable three-asset exercise run. No viewport/browser acceptance.

| Command | Actual result |
|---|---|
| `npm ci --ignore-scripts` (backend) | Exit0, 3 existing locked dev packages, audit0 vulnerabilities, no package/lock changes. |
| `node --test tests/integration-session.test.ts tests/received-view.test.ts tests/integration-http.test.ts` (backend) | 23/23, failures/skips/cancels0, 6201.735083ms. |
| `node backend/scripts/check-backend.mjs` (repo root) | 2026-11-15T06:34:47.659Z–06:35:18.279Z: exit0, typecheck/compiler0, native260/260 (13822.027167ms), compiled260/260 (13585.564375ms), failures/skips/cancels0, stderr empty. |

[Checker](../../backend/scripts/check-backend.mjs) invokes pinned TypeScript typecheck, actual native exports and rewritten compiled JS tests; creates/removes disposable output under ignored backend/.scratch. Fresh native/compiled lifecycle receipts: 8026.623/8027.854ms activity, max402.668/404.412ms heartbeat gap, 5046.078/5030.380ms freeze, 20/20 checkpoints, 92 localhost requests/run, 21 final revisions, 10/10 late-heartbeat rejections, 0 revival/provider calls. Eight seconds is not ten-minute acceptance. No genuine providers or frontend started. Hosted Node24/26 CI not rerun in this pass; historical hosted receipts do not verify these document additions or later frontend main.

## Cross-owner closure still pending

| Backend declaration | Marco mapping status |
|---|---|
| d1 / t1 / exercise-source:d1 / c1 / inspect / m1 v1 / declared-route1 | Unknown, unaccepted. |
| d2 / t2 / exercise-source:d2 / c2 / inspect / m2 v1 / declared-route2 | Unknown, unaccepted. |
| d3 / t3 / exercise-source:d3 / c3 / inspect / m3 v1 / declared-route3 | Unknown, unaccepted. |

[Generic seed](../../backend/config/local-demo.ts) declares 3 thermal/synthetic/non-radiometric feeds, not physical/rendered cameras. [`--demo` scenario](../../backend/demo/scenario.ts) deliberately selects d1/t1 and registers one planner-generated single-assignment course, not generic c1-c3 or three-drone execution. #17 owns launcher/mapping; #19 dynamic registry changes need separate fixed-demo/current-human-review approval. This document changes neither.

Closure requires Marco/Nikolas agreement and later authorized actual clients, not renamed backend tests:

1. Exact 3/3 Unit/feed/candidate/action/mission/version/route mappings, plus separate optional EO feeds. Mark unsupported explicitly; no inferred display-name/palette mapping.
2. One designated producer Runtime/run/capture epoch. Two crew readers must start 0 Runtime instances and receive 0 producer/Chief write capabilities.
3. Reviewed CRS/origin/axes/units/altitude datum and georegistration/uncertainty, plus source sim-tick/scenario UTC relation. Unknown captured_at/source_position/geography/calibration/model_score remains null; no guessed WGS84/(0,0)/AGL/Celsius/confidence.
4. Exact frame/evidence/source-snapshot IDs/source_revision and permitted pixel/rights/calibration manifest. Opaque media_ref is not upload/decoding/hash/permission proof; media integration deferred.
5. Recheck current incident/input/plan/reservation/Chief/authority/capture bindings immediately before simulated acceptance. Any observation advancing input_revision still invalidates old intent. Report only actual sent/delivered/accepted/running/terminal stages, never treat checked command as durable permission or ACK.
6. Agreed bounded heartbeat/telemetry/check/receipt/retry cadence. Existing caps remain 60 attempts/session/min and 999 ordinary commits plus freeze revision1000. Three assets x1Hz x600s =1800 observations, over cap. Proposed 2 s heartbeat/10 s telemetry gives48 attempts/min and180 observations/600s, arithmetic only, not accepted scheduling or a measured ten-minute run.
7. Explicit reconciled new-run/takeover after >5 s loss/freeze, discard stale pending intent, 10 late heartbeats must revive 0 times. No bridge takeover endpoint or automatic reader election.

Closure state: local backend seam verified; cross-owner mapping/clock/Geo/runtime agreement and ten-minute actual teammate/browser acceptance unrun. Genuine provider calls0, frontend launches0, source edits0. Independent verifier/root review and coordinator Git delivery pending; no issue closure implied.
