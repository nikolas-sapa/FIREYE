# Local orchestration proof

2026-11-15, branch `task/orchestration-demo-v1`, Node 26.11.1. Local fixture proof, not integrated frontend or live inference.

## Scope and dependency receipts

Root integrated actual dependency commits into this worktree: bridge `1bde6dc`, planner `61a0440`, sponsor adapters `feec47d`. No dependency copies, core changes or schema mutation. Root owns final independent review/delivery and later dependency review fixes. Current orchestration calls direct actual Iris client, not `SponsorJobs`.

Review follow-up dependencies integrated by root: bridge `603e49e`, sponsors `dad7fa3`, planner identity `acff252`. Planner identity now stable during valid clock advancement, all current eligibility/lease/expiry constraints retained. No orchestration workaround or core guard relaxation.

Owned delta: `backend/orchestration/types.ts`, `backend/orchestration/coordinator.ts`, `backend/tests/orchestration.test.ts`, `docs/contracts/orchestration-demo.v1.md`, this proof and ORCH-01 taskboard append.

## Observed RED/GREEN

- RED: `node --test tests/orchestration.test.ts`, exit 1, `ERR_MODULE_NOT_FOUND` for coordinator before implementation. Node 26.11.1.
- Dependency integration then revealed genuine seam failures: unsupported snapshot prefix, fixture future capture tick, latest-per-feed cache dropping cited older evidence. Corrected owned code/fixtures, never relaxed dependency/core guards.
- `npm ci --ignore-scripts`, exit 0, 3 existing pinned packages installed, 0 audit vulnerabilities. No package/lock edits.
- Focused: `node --test tests/orchestration.test.ts`, exit 0, 12/12 tests, 0 skipped (264.16125 ms).
- `npm run typecheck`, exit 0, real installed TypeScript 5.9.3.
- Combined: `node --test tests/*.test.ts`, exit 0, 141/141, 0 skipped (6363.649791 ms). Includes actual bridge HTTP and sponsor loopback HTTP tests. Performance numbers only this local test execution, no benchmark claim.
- `git diff --check`, exit 0. Root independent review and Git delivery pending, no worker commit/push.
- Follow-up RED: OR13 raw receipt retained secret sentinel, OR14 cached result returned stale success, 2/2 failed as expected. Fix: descriptor-only reply inspection, receipt brand/exact request binding, finite failure allowlist, cache-resolution refresh.
- Follow-up GREEN: 15/15 focused, 0 skipped (307.812458 ms), typecheck exit 0. OR13 20 hostile receipt trials, 0 sentinels/getters/traps; OR14 20 cache-resolution interleaves, 0 stale successes; OR15 actual tick1→tick2 proposal/approval/checked-command/receipt succeeds, tick7 expiry rejects. Previous 141 combined receipt predates these follow-up cases/dependency fixes; final root combined rerun pending.
- Final TS review RED: OR16 first-result microtask race returned stale success before consumption. Initial promise now uses same resolution-time currentness/expiry gate as duplicate path. Twenty received-frame microtasks must return 0 stale successes and 0 proposals.
- Final worker GREEN: 16/16 focused, 0 skipped (352.946167 ms), typecheck/diff-check exit 0. OR16 observed 20/20 stale rejections, 0 proposals. Root final combined/review/delivery pending.

## Genuine walking slice

OR04 constructs real bridge authority, ingests producer telemetry/frame, projects received metadata, runs exported finite planner, verifies full course fingerprint and exact immutable seed-candidate fields, commits one actual proposal, rejects analyst approval, approves through actual Chief/core, obtains producer pending/check, ingests five factual fixture receipts (`sent`, `delivered`, `accepted`, `running`, `completed`), receives second frame, supersedes old assessment and reassesses. Exactly 1 command, 5 receipts, 2 frames, 0 provider transport calls. Fixture actor represents Chief, not user-login proof. Fixture producer reports facts, not physical simulator execution/coverage proof.

OR11 separately composes actual exported `createIrisClient` using real projected sponsor snapshot metadata. Exactly 1 fixture transport and 1 budget reservation; preserved `provenance:fixture`, `fresh_provider_call:false`. No fabricated provider receipt. Default full loop calls actual disabled Iris client and reports `DISABLED` fallback. Invalid rights/hash/clocks omit optional ranking with honest metadata-unavailable reason. No pixels or media ingestion.

Only actual server-issued Iris receipts with exact adapter/endpoint/model/status/snapshot/request-input-hash/evidence binding enter assessment. Unbranded replies remain fixture-labelled, receipt null. Failure-code allowlist prevents raw custom errors reaching DTO. Proxy/accessor receipt values never traversed or frozen. Cache resolution rechecks received versions and expiry.

OR01: 20 invalid unknown/stale/currentness trials, 0 proposals/commands. OR02: 20 duplicates, 1 assessment job. OR03: 20 changed snapshots supersede 20 old reviews, 0 stale commits. OR05: late pending ranking superseded by real received frame, 0 stale reviews. OR07: 20 unknown/nonfinite rankings select 0 unknown IDs. OR08: new objective supersedes proposed review, 0 stale coordinator approvals. OR09: hostile objective shapes invoke 0 getters/traps. OR12: 64 jobs retained, 65th rejected, superseded pending work drains to 0.

## Exports and limits

Exports: `createPlanningSnapshot`, `exerciseCourseFingerprint`, `createExerciseCoordinator`. Returned coordinator methods: `assess`, `refresh`, `commitReview`, `approve`, `read`. Calls existing bridge `read/now/ingest/approve`; producer uses existing `pending/check/ingest`. No endpoint launcher, generic scheduler or UI created.

- Only exact pre-reviewed single-assignment exercise courses can be proposed for core approval. Planner DTO remains `executable:false`; waypoint geometry is not a core safety registration. Seed lacks dynamic registration, changed input/objective IDs remain review-only. No multi-asset atomic approval claim.
- Local toy home/reserve/link/sector/coverage-age configuration is explicitly declared, not measured telemetry, calibrated energy or verified safety. Received source provenance/clocks retained, no planted truth arrays.
- Coordinator state is local and bounded, not distributed CAS/database proof. Job count max64, in-flight guard max2, no tick cadence/retries. Physical timeout belongs to actual configured client; hung injected client retains slot. No upstream cancellation guarantee.
- Raw bridge callers can bypass coordinator-only objective supersession since core has no objective-revision field. Existing core input/plan/Chief/lease checks remain authoritative. Expose coordinator approval seam for this slice; broader API integration requires separate ownership/review.
- Actual observations change strict input revision and may invalidate pending command. Coordinator never relaxes core equality or revives stale approvals.
- No login/auth implementation, Convex/cloud/provisioning/deployment, live providers, media pixels, rendering, simulator adapter or frontend integration. No production/field/readiness claim.
