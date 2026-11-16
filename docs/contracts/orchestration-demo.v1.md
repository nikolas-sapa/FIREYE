# Orchestration demo v1

EXERCISE only. Local received-metadata orchestration, no operational forecasts.

## Test plan (before implementation)

| Test | Numeric pass criterion |
|---|---|
| OR01 invalid finite choices/currentness | 20 unknown/stale/currentness inputs, 0 accepted review commits |
| OR02 duplicate assessment | 20 concurrent identical objectives/snapshots, exactly 1 assessment job |
| OR03 superseded knowledge | 20 changed received snapshots invalidate 20 older reviews; 0 old commits |
| OR04 exported-module loop | 1 objective → actual planner → exact pre-registered course → actual Chief/core approval → checked command → producer fixture receipts/frame → reassessment, 0 provider transport calls |
| OR05 late sponsor reply | 1 pending ranking superseded by received frame, 0 stale reviews/commands |
| OR06 mapping and authority | 1 mismatched reviewed course and 1 non-Chief actor, 0 commands |
| OR07 malformed ranking | 20 unknown/nonfinite outputs select 0 unknown IDs |
| OR08 objective revision | 1 changed objective supersedes 1 proposed review, 0 stale approvals |
| OR09 hostile objective | 3 malformed/accessor/proxy inputs, 0 getter/trap executions |
| OR10 fixture ranking | 1 validated fixture ranking, 0 approvals or commands |
| OR11 real Iris composition | 1 actual exported Iris client using projected metadata, exactly 1 fixture transport/reservation, 0 provider calls, preserved fixture receipt |
| OR12 retained job bound | 64 jobs accepted, 65th rejected; superseded pending work drains to 0 |
| OR13 receipt boundary | 20 hostile receipts/failure codes, 0 sentinels leaked and 0 getters/traps invoked |
| OR14 cached currentness | 20 authority changes between cached request/resolution, 0 stale successes |
| OR15 advancing clock | Tick1 assessment → tick2 proposal/Chief/checked command/sent receipt succeeds; tick7 snapshot expiry rejects |
| OR16 first-result currentness | 20 received-frame microtasks between first assessment creation/resolution, 0 stale successes or proposals |

## Implementation plan

1. Claim exact files. Inspect bridge, planner, sponsor and core exports.
2. Define closed objective, received-only snapshot projection, explicitly declared toy policy and immutable review DTO.
3. Add bounded local assessment/dedupe state, actual planner and disabled Iris client composition, validated finite ranking/fallback.
4. Match single-assignment course against reviewed fingerprint and immutable seed registration. Commit only that finite proposal. Delegate Chief approval, pending/check and factual receipt ingestion to actual bridge/core.
5. Run RED then focused/combined GREEN/typecheck. Record limitations and root-owned delivery.

## Non-goals

No core/schema changes, dynamic registration, login, auth implementation, Convex, media ingestion/pixels, provider enablement, provisioning, deployment, UI, generic agents, automatic approval, rotor/power controls or real field orders.

## Seam contract

`createExerciseCoordinator(authority, config)` uses a trusted local authority and fixed analyst fixture actor. `assess(objective)` consumes a closed `refresh_coverage` objective, projects only received telemetry/frame metadata plus explicitly declared toy region/home/reserve/link/policy. Config is trusted server-owned exercise configuration, never model or wire output. No battery-to-energy conversion or invented geography. Missing received position/evidence cannot produce a movement review.

`read()` exposes bounded assessment state, not canonical core state. `commitReview(assessment_id, option_id)` requires exact current versions, selected option and one verified registered assignment. `approve(assessment_id, approval_id, actor)` delegates actual Chief checks to bridge/core. Models never call approval or receipt APIs.

Raw planner options retain `executable:false` and `proposed_awaiting_reviewed_registration`. A trusted exercise manifest binds `option_id`, full course SHA-256 fingerprint and seed `candidate_id`; coordinator independently checks candidate/action/asset/mission/version/route/plan/feasibility snapshot/expiry. Only one-assignment courses supported in this walking slice. Manifest is reviewed configuration, not a registration mutation or general safety proof.

Changed input revision invalidates old review and forces reassessment. Since planner identities include received snapshot/context, new course IDs normally lack immutable seed registrations. They stay review-only until a separately approved registration design exists. This is an explicit product seam, not an executable dynamic mission claim.

Assessment IDs bind incident/run/authority/input/plan/reservation/Chief versions, received snapshot, objective and declared toy config. At most 64 retained jobs, at most 2 in-flight assessments, no queue/retry/tick loop. Identical identity returns same promise/job. New objective or received knowledge triggers explicit `assess`; `refresh()` invalidates obsolete reviews. Terminal/factual receipts stay in actual authority. Core strict input equality may invalidate pending command on new observation; coordinator never bypasses it.

Open integration boundary: call coordinator approval methods for this slice. A caller with raw authority can bypass coordinator objective-specific supersession; core still validates canonical input/plan/Chief versions, but core has no objective-revision field. No claim that coordinator state protects independently submitted bridge approvals. Configured clients must enforce their own physical deadlines; coordinator does not free an in-flight slot while an upstream promise remains unresolved.

Iris client defaults disabled. Optional injected actual client remains a trusted deployment seam subject to separate spend authorization. Ranking must include exactly the currently eligible registered candidate IDs, finite [0,1] scores summing to 1, exact scale and current snapshot. Invalid/disabled/failed ranking uses deterministic planner order, explicitly labelled fallback. No sponsor receipt invented, no pixels supplied. Sponsor snapshot evidence includes only config-provided rights-manifest identifiers and valid existing frame hashes/clocks; unknown/invalid fields omit optional ranking, never fabricate metadata.

Receipt provenance requires actual `serverReceipt` brand plus exact Iris adapter/endpoint/model/status, snapshot, request input hash and ordered evidence binding. Untrusted receipt discarded without property traversal. Unbranded custom ranking stays fixture-labelled, never provider evidence. Failure codes finite allowlist; cache resolution repeats currentness/expiry checks. Planner identity excludes current tick only, eligibility/lease/freshness/expiry still checked against real current tick.

## Bounded queued sponsor composition (issue #15 follow-up)

Owner-authorized scope: `backend/orchestration/**`, the new
`backend/tests/orchestration-sponsor-composition.test.ts`, and the two orchestration
contract/proof documents. Demo service and stale-command handling remain untouched.

Tests specified before this slice:

| Test | Numeric pass criterion |
|---|---|
| OR03-S01 | 600 independent disabled ticks, 0 sponsor jobs/readers/transports/reservations |
| OR03-S02 | 20 identical received snapshots, 1 Iris and 1 Gemini invocation/reservation, actual issued fixture receipts |
| OR02-S03 | 20 late stale/wrong-run/frozen results and replay/offline attempts, 0 extra jobs or canonical effects |
| OR03-S04 | Shared Iris/Gemini queue holds exactly 2 in flight/8 queued, eleventh rejected; 10 accepted jobs invoke/reserve exactly 10 times |
| OR04-S05 | 20 actual model-input checks, 0 simulator-truth/future keys, 0 model approvals |
| OR03-S06 | Unknown evidence/clocks, invalid bytes and extra body fields invoke 0 transports |

The coordinator now constructs actual `SponsorJobs`, `createQueuedIrisClient` and
`createQueuedGeminiClient` by default. All share one scheduler. Without explicit
trusted `sponsors.enabled: true`, both are disabled; no job is submitted and no
evidence reader/transport is invoked. Existing deterministic assessment fallback
is unchanged. An explicitly supplied legacy `iris` client still takes precedence;
it is outside the new shared queue's guarantee and remains the caller's bounded
trusted seam. Do not mix it in when claiming shared Iris/Gemini queue composition.

Trusted `ExerciseSponsorConfig` supplies an authorization ID, `SponsorBudget`,
positive per-call cap/deadline (maximum 10 seconds), and optional per-adapter model,
injected transport and `fixture`/`local-http` provenance. No environment lookup,
credential configuration, default fetch or live-provider route is added. Model
names/endpoints still pass the existing actual clients' allowlists. The queued
factories accept an optional shared `SponsorJobs` instance; composition code must
use the same budget, caps, clock and currentness policy for queue and clients.
Omitting that argument retains each standalone client's previous behavior.

`assess` uses queued Iris only for exact reviewed seed candidates and valid
received sponsor metadata. New explicit `analyzeEvidence({ objective, evidence_id })`
uses the same received planner projection and resolves only a cited received EO
frame through trusted synchronous `read_evidence(evidence_id, media_ref)`. The
reader returns only `{ png_base64 }`; it is a local content lookup, not permission
to fetch media. The request cannot supply snapshots, pixels, configuration,
reviewer identity, replay/offline mode, truth labels or arbitrary geometry. The
actual Gemini client checks PNG bytes, hash, dimensions and EO modality against
received frame metadata. Unknown rights/clocks, non-EO or absent evidence cannot
yield model analysis. No general media ingestion, thermal inference or runtime
camera integration is provided.

The route returns the actual sponsor result and server-issued fixture/local-HTTP
receipt. Analysis remains `verification_status: unverified`; hypotheses are not
facts, actions or approvals. It neither feeds an approval path nor changes the
planner/core state. Gemini analysis is explicitly requested, not automatically
run for every assessment/tick. `sponsorCounts()` exposes shared queue diagnostics.

The coordinator derives clock/currentness from bridge authority, pins original
incident/run and binds sponsor snapshots to current authority/input/plan/
reservation/Chief versions. Analysis caches at most 256 received identities,
independent of clock-only advancement, and rechecks currentness, sponsor expiry
and planner freshness/intent expiry at every read, including cached promise reads.
Queued clients enforce original deadlines, one budget prepayment and one actual
transport invocation per admitted job, with no retries. Both providers share the
2 physical/8 queued limits, including body-settlement slot retention. State and
queue are local to one coordinator instance, not durable/distributed coordination.

### Remaining issue acceptance boundaries

- OR01: fixed reviewed single-assignment loop exists; dynamic core registration,
  arbitrary/multi-asset missions and real simulator execution remain unimplemented.
- OR02: local currentness/dedupe and strict core guards are covered; no distributed
  queue, durable dedupe, or protection for raw bridge callers bypassing coordinator
  objective supersession is claimed.
- OR03: actual keyless queued Iris/Gemini coordinator seams are composed, but
  `backend/demo/**` default service/HTTP wiring is unchanged. Telemetry-only demo
  fixtures still provide no eligible EO bytes; genuine inference/credentials,
  provider enablement and measured live cost/latency remain unverified/unapproved.
- OR04: existing Chief-race/bridge/planner tests and the new received-only model
  projections are local fixtures. No genuine provider receipt, real identity,
  frontend/Marco runtime acceptance or operational execution proof is claimed.
