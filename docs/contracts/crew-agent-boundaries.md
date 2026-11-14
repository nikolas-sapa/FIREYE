# Crew and agent boundaries

Status: **v0, UNAPPROVED DRAFT**, 2026-11-14. Planning only, no executable schema, adopted authority/runtime or passed product tests.

Interpretation: small operating crew shares one authoritative received incident picture; larger analyst/drone-agent contexts propose bounded work, one current Chief approves changed mission/ground scope, teammate executors act only in simulation.

Basis: [taskboard P0-02/P0-07/P0-09/P0-10](../../TASKBOARD.md), [repository rules](../../AGENTS.md), [simulator parameter draft](../specs/simulator-parameter-contract.md) and [thermal contract](thermal-camera.md). All defaults below remain proposed, not measured or architecture approval.

## Numeric test plan first

Six checks here plus T01–T06 = 12 proposed checks, **0 executed**. Freeze source/run, authority/owner/contract versions, command order, recorded model replies and transport faults before later acceptance.

| Test | Proposed numeric pass criteria |
|---|---|
| C01, shared authority / local view | 2 clients × 20 simultaneous approvals of one proposal on healthy transport: exactly 1 accepted assignment/trial, 0 duplicate executions, identical committed revision after reconciliation. 20 old-Chief approvals: 0 accepted. 10 preset/selection/replay changes: 0 peer-view changes. |
| C02, fabricated human / critical scope | 20 director/agent attempts to approve critical, reassigned-drone or revised-ground tasks as `user`: 0 valid Chief approvals/dispatches. 10 genuine current-Chief approvals of eligible fixtures: exactly 10 recorded approval decisions; receipt stages remain separate. |
| C03, loss / deduplication | 100 commands, 30% loss, 20 duplicate transmissions, delay 0–8 sim s, reorder window 5: 0 fabricated successful ACKs/completions, 0 duplicate executions/stale-state overwrites, ≤2 retries/command. 10 delivered-then-rejected commands: 10 visible rejections, 0 successful acceptance labels. |
| C04, reconnect / expired intent | 30 sim s blackout plus 20 expired/offline approvals: 0 silently resumed dispatches or executions. Rejoin requires 2 fresh heartbeats and version/mission reconciliation; 20 unavailable-link frames stay last-known, 0 fake arrivals. |
| C05, developer replay | 3 saved runs at two replay cursors: 0 new provider calls/CPU jobs, 0 future-received facts, 0 dispatches. In 20 replay/control-mode toggles, 0 recorded director approvals become current human approvals; preserve original result/time/version. |
| C06, stale async / stream gaps | 20 delayed superseded analyst replies plus 20 old-epoch/cross-run events: 0 actionable updates/dispatches, 40 rejection reasons. 20 stream gaps/reconnects: 0 revision regressions; settle 20/20 by cursor replay or consistent snapshot before enabling approval. |

## Roles and field ownership

Contract records use `contract_version: crew-agent.v0`. Small crew does not mean one human per logical agent or one VM/service per context. Proposed baseline ≤16 logical contexts; no recursive agent spawning. Authentication library/database vendor are not chosen here.

| Record / state | Sole writer and boundary |
|---|---|
| Incident received state / authority epoch + revision | Root canonical commit/reducer boundary; accepts validated received facts and decisions. Never exposes hidden simulator truth as crew knowledge. |
| Simulation truth / capture / local execution | Teammate's single designated simulator producer under an authority lease; owns world/engine/render/RF fixture and executor facts. Root consumes contract events, never edits producer modules or physics. |
| Evidence / hypotheses / projection | Root source adapters and validated analytical jobs; preserve source snapshots/clocks/uncertainty. Projection is a labelled relative toy estimate, not a forecast guarantee. |
| Proposal / analytical job | Root orchestrator and bounded analyst/drone contexts; proposals cannot reserve, approve, execute or forge receipts. Iris ranks finite valid choices, not arbitrary new resources. |
| Approval / exclusive reservations | Root compare-and-commit path records authenticated current Chief decision and atomically reserves eligible resources; exactly one winner. |
| Transport receipt / acceptance / completion | Delivery adapter records actual arrival; teammate executor emits actual local acceptance/progress/terminal facts; root reducer records separately received receipts. |
| Person view / preset / pin / selection / replay cursor | Teammate local UI state, scoped to person/client. Does not mutate shared incident revision or peer view. Root suggestions cannot steal pins. |

Candidate authority proposal: Convex canonical incident state plus one designated teammate simulator producer. **Unapproved**; contract works across an eventual chosen runtime and does not relocate physics to backend or select an auth library. Exact app files, runtime and source adoption require owner approval and claims.

## Common envelope and shared picture

Required envelope: `incident_id`, `run_id`, `authority_epoch`, `contract_version`, `event_id`, `stream_id`, monotonic integer `stream_sequence`, `incident_revision`, `actor_id`, `actor_kind`, `session_id`, `trace_id`, `causation_id`, `recorded_at` UTC and relevant source capture/receipt clocks. Fields describe actual stages; unknown source metadata stays unknown. Reject incompatible versions, missing IDs, non-finite values, cross-run/old-epoch writes.

`incident_revision` orders canonical commits, not animation frames. `stream_sequence` orders one source stream, not all streams. Person-local state stays outside both. Two crew clients derive the same received version after reconciliation; network delay is shown as stale/behind, never invented consistency.

A source/debounced batch carries original event IDs/sequences/clocks plus batch boundaries; batching never changes acquisition time, drops critical facts or turns late observations fresh. Older facts may remain history but cannot overwrite newer last-known state. Missing sequence pauses approval-sensitive consumption until replay or a consistent snapshot resolves the gap.

Reconnect request includes run/epoch, last applied incident revision and per-stream cursors. Response supplies ordered deduplicated replay, or a snapshot with revision/cursors and subsequent events strictly after that cutoff. Apply atomically, reject older snapshot, avoid replay/live double application. Socket-open alone is not reconciliation or mission-link recovery.

## Proposal, approval, job and ACK records

- Proposal: `proposal_id`, `proposal_revision`, action/asset/mission IDs, finite candidate/route IDs, input/evidence snapshot IDs and revisions, current plan/reservation/Chief revisions, rationale, feasibility snapshot and expiry. Model output gets schema/semantic validation on arrival, then again at approval and acceptance.
- Approval: `approval_id`, proposal/action/version, `chief_id`, `chief_epoch`, expected incident/plan/reservation revisions, approved finite scope, lease and expiry, actual decision time. Chief handoff invalidates pending approvals. Accepted executor facts are not retroactively undone by handoff.
- Job: `job_id`, stable idempotency key, immutable input snapshot/content hashes, task/model/adapter-contract version, queue state, attempts, timeout, cap/budget version, rejection reason and actual output receipt. Same run/frame(s)/task/input version retries deduplicate; intentional reanalysis requires a new version/reason.
- Command: `command_id`, stable command version/idempotency key, new `transmission_id` per retry, target/mission IDs, approval/snapshot/reservation versions, finite payload, sent tick, deadline and lease. Local executor revalidates ownership, TTL, feasibility, reserve and approved scope.
- ACK/terminal event: `receipt_id`, command/transmission/mission/version, actual delivered/accepted/progress/completed tick and UTC or unknown source clock, executor identity/epoch, rejection reason and linked evidence. An acknowledgement without local acceptance evidence cannot imply accepted; acceptance cannot imply completed.

Lifecycle: `proposed → approved → enqueued → sent → delivered → accepted → running → completed`. Proposal rejection/expiry prevents queueing; local rejection after delivery emits NACK. Transmission expiry/missing receipt means unconfirmed, not task completed or aircraft landed. Preserve failed/cancelled executor outcomes separately. Terminal receipts arriving before older ACKs reconcile without regression.

Root commits approval/reservation atomically against current revisions, then enqueues. Agents/body-supplied `user`/`chief_id` cannot assert human identity: server derives principal and authority from authenticated session. Secrets and provider credentials stay server-side; metadata URLs/logs exclude secrets. Exact auth policy/implementation remains gated.

Director fixtures/replay may record `actor_kind=fixture`, never impersonate the Chief. Developer demonstration controls stay visibly distinct from live exercise control. No critical task, new collection scope, reassignment or revised ground placement autoapproves. Routine sensing/finite choices may run inside an already human-approved mission envelope and current lease; no approval required per captured frame.

## Lost link, asynchronous work and bounded contexts

Sending is intent, delivery is arrival, acceptance is executor decision, completion requires an actual terminal fact received by crew. Link loss freezes last-known observed pose/battery with age/uncertainty. Missing ACK remains unconfirmed. Local lease/heartbeat failsafe is a teammate simulator event, not root inventing success, safe landing or real aircraft certification.

Reconnect reconciles authority/session epoch, accepted command version, active mission/lease, failsafe, battery and observation cursor before unlocking. Expired offline approvals never silently resume; new scope needs new Chief approval. Proposed TTL 10 sim s, retries at 2/4 sim s (max 2), lease 120 sim s follow parameter draft; final values still gated.

Analysts run on immutable **received** snapshots with bounded queues, not every animation frame. Proposed ≤2 in-flight provider requests, ≤8 queued jobs, ≤30 calls/10 min, ≤8 wall s model timeout. Stale/invalid output rejects with reason; provider failure does not halt 600 deterministic fixture ticks. Only separately approved Boxd CPU preprocessing: ≤2 concurrent jobs, ≤30 wall s/job, budget off by default, 0 VMs.

Model completion/job sleeps never advance world time. Raw retrieved text/media/model replies have no instruction authority. Hidden exercise truth stays evaluator-only. Alert aging/fading/mute/ack does not resolve an unresolved critical alert. Replay uses capture AND receipt cutoffs, saved replies only, no inference recall or commands.

## Compatibility, consumption and non-goals

Pinned PR2 `6bdb5884`, static read: `bus/adapters.ts` has an unused backend seam; its `isBusEvent` checks only type and numeric `at`, not finite payloads/revisions/auth. `store.tsx` snapshots the local simulator rather than reducing received events. `director/beats.ts` approves scripted actions as `user`. These are integration gaps, not C01–C06 passes; isolated build/typecheck/static assets establish no shared authority/provider acceptance.

After approval, root offers validated state/evidence/proposal/job/ACK contracts and fixtures; teammate alone adapts existing BusEvent/domain/store/render/simulator consumption. Existing `action.decided` cannot stand for delivered/accepted/completed. Version interface through reviewed revision, not root editing `proposal/fcc/**` or trusting mock-only wiring. A real two-client reducer/approval check and non-mocked adapter/dist check remain required.

Non-goals: real dispatch/aircraft/vehicle control, field orders/public alarms, flight/RF certification, calibrated wildfire prediction, identity recognition, controller training, auth/vendor selection, new dependencies/provisioning/paid requests or backend takeover of teammate physics/UI. Draft approval does not itself authorize implementation.
