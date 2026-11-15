# queued-iris.v1

Bounded server-side extraction of the tested SponsorJobs → actual Iris client composition. Partial issue #15 improvement, not all-model orchestration or provider activation.

## Test plan, before implementation

- QI01: 20 identical analyses produce 1 actual client transport, 1 reservation and 1 immutable receipt identity.
- QI02: 20 changed snapshot/candidate inputs produce 20 different hashes without false cached results; namespaced SHA candidate IDs remain supported.
- QI03: 20 stale reads, 20 expired cached reads and 20 superseded replies produce 0 actionable results; original deadline never renews.
- QI04: 10 blocked actual transports admit at most 2 physical calls and 8 queued jobs; eleventh rejects, all 10 settle.
- QI05: 20 disabled/malformed/unknown-candidate inputs invoke 0 transports, 20 thrown transport errors expose 0 raw strings; caller mutation changes 0 owned inputs.
- QI06: existing real coordinator composition traverses new export and loopback HTTP, 1 call/reservation, 0 genuine providers; native/compiled tests/typecheck have 0 failures.
- QI07 review regressions: 256 stale inputs consume 0 retained identities then 1 current input succeeds; 256 invalid models and 256 invalid transport modes reserve/retain 0; 256 queue-full rejections leave 10 admitted identities and 1 later retry succeeds; 20 admitted-error retries renew 0 deadlines; 256 admitted identities preserve 1 duplicate and reject 257th. These tests precede the reviewed admission fix.
- QI08 superseded review probe: 2 actual hanging transports revealed physical2/logical0, prompting the QI09 settlement hook instead of shipping conservative admission alone.
- QI09 revised lifecycle test, before shared hook implementation: 2 actual hung plus 8 queued timeout, calls/reservationsremain2, physical/logical2 until actual settlement; queued8expire0newreservations, releases endphysical/logical0. Root approves only optional trusted settled hook in receipts.ts and wrapper use, not broader scheduler changes.

## Implementation plan

1. Claim exact files, add RED tests importing missing export.
2. Add `createQueuedIrisClient(config)` with existing shared guards, fixed server-owned candidate registration, owned immutable input, SHA job identity, bounded original deadline retention and actual SponsorJobs/client callback.
3. Replace only inline adapter in existing coordinator composition test. Run focused and complete native/compiled checks.

## Interface and boundaries

Config is server-owned, never HTTP/model input. Existing `IrisConfig` fields select enabled gate, authorization, shared SponsorBudget, max_call_micro, deadline_ms (1–10,000), currentness callback, clock, model and optional fixture/local-http transport. Credentials/reservations are not accepted by this wrapper. Construction/import makes 0 calls. Default disabled; genuine Iris network remains unsupported by existing client.

Analyze accepts only existing `IrisInput`: snapshot plus a nonempty subset of the fixed registered IDs. Existing plain-JSON/snapshot/ID guards apply before hashing. Exact owned `{snapshot,candidate_ids}` JSON SHA-256 determines `job:<hash>`. Candidate order and all snapshot fields remain identity-bearing. No caller-supplied callback, job ID, deadline, model or reservation. At most 256 identities retained per instance; recreate only through explicit server lifecycle.

SponsorJobs owns queue, dedupe, currentness, deadlines, single prepayment and issued receipt/input hash binding. Actual Iris client owns model/output validation, transport ceiling and reservation consumption. Wrapper narrows scheduler's validated unknown value without casting a raw Result. Cached deadlines remain original and are rechecked after asynchronous reads; stale has priority.

Deadline retention mirrors synchronous SponsorJobs admission (retained count increase), not attempted submissions. Currentness, supported model and explicit local transport mode are checked before admission. Rejected stale/invalid/full-queue jobs cannot poison lifetime identity capacity; admitted failures still preserve original deadlines. No scheduler API change.

Counts distinguish `in_flight` (SponsorJobs callback slots, retained through actual operation settlement) from `physical_in_flight` (aggregate active actual clients on shared budget). A timeout abort is advisory, not proof of upstream cancellation. Optional trusted `on_transport_settled` in shared ClientConfig fires after actual operation releases budget; hook exceptions do not change results or budget. Wrapper owns the hook, marks actual transport start, and keeps callback pending through actual transport/body settlement even when client deadline returns early. SponsorJobs independently returns deadline failures while retaining its physical slots. Thus 2 hung calls do not drain 8 queued jobs into new prepaid failures: queued deadlines expire instead. Other client users without hook keep unchanged behavior. No response-body proxy, DTO hook, cancellation proof or automatic retry/reset.

## Non-goals

No coordinator/schema/provider-config/client/jobs changes, dependencies, SDK, keys, provider calls, network startup, frontend, deployment, Convex/persistence or distributed queue claim. Sole root-reassigned shared change: optional server lifecycle hook in receipts.ts. No Gemini orchestration wiring, all-model completion or genuine inference claim. Local fixture ranking has no approval/command authority.

## Verification receipt, 2026-11-15

Node26.11.1, macOS local fixture execution. RED missing actual export: 1/1 suite failed. Initial focused GREEN6/6; reviewed retention RED4/6 failed with 2 preservation controls. Final focused13/13, native254/254 (13,849.265792ms), compiled254/254 (13,642.9935ms), 0 failures/skips. `npm ci --ignore-scripts` pinned existing dev dependencies, audit0; check-backend/typecheck/diff-check exit0. No package/lock changes. Actual existing coordinator/new export/localhost request1, budget reservation1, provider calls0. Original test covers Chief approval and five received command stages, not fabricated executor completion.

QI07 confirms stale256→retained0 then current1success; invalidmodel256/invalidtransportmode256 each reserved0; occupied2+8 rejects256 without new retention then later1retry succeeds; admittederror20expired retries issue0 calls; admitted256 retains duplicate and rejects257th. Physical maximum2, queued8; all listeners/transports settle. Node24 floor, hostedCI, genuine Iris inference and Gemini orchestration unrun. Initial254 verification above predates QI09.

Final QI09 receipt: RED actual hung2/queued8 lifecycle1/1 failed (logical0 vs required2). Hook GREEN focused14/14, native255/255 (13,757.894541ms), compiled255/255 (13,611.827ms), check-backend/typecheck/diff-check exit0, failures/skips0. Actual hung2/queued8 expire while calls2/reserved200/physical2/logical2; subsequent20 admit8 then deadline, reject12QUEUE_FULL, newcalls/reservations0; releases returnphysical/logical0. Lifecycle hook exceptions swallowed after budget release, no raw input/output exposure. Six owned files frozen for coordinator TypeScript/security review and Git delivery; worker stage/commit/push/deploy0.
