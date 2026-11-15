# Backend protocol foundation, final bounded spec

Status: approved bounded direction, 2026-11-14. Owner's explicit Go followed the written thermal/crew contracts and the choice of Convex canonical authority, one teammate simulator producer, protocol-only first coding PR. This document formalizes that slice, not full V1 adoption. Baseline: `ed470de61df5fad86c249d6a2a7facfb5d1666aa`; branch `task/backend-protocol`.

Interpretation: build a local pure-function protocol package proving validation, immutable received state and revision-bound simulated commands, without creating a cloud backend or touching teammate physics/UI.

## Numeric test plan first

All criteria are planned, not passed. Fixtures use incident `i1`, run `r1`, epoch 1, UTC scenario epoch `2026-11-14T00:00:00Z`, injected receipt clocks and explicit trusted-context fixtures.

| Test | Numeric pass criteria / implementing task |
|---|---|
| BP01, closed JSON boundary | 100 malformed inputs (25 impossible UTC, 25 non-finite/invalid integers, 25 modality/version/unknown-key violations, 25 missing IDs/payloads): 100 rejected with reasons; 10 valid messages accepted. Include JSON numeric overflow, `__proto__`, `constructor`, `prototype` and body-supplied actor fields. Task 1. |
| BP02, thermal honesty | Register 4 assets with 4 distinct thermal feeds; 2 optional EO feeds remain distinct. Across 100 non-radiometric/unknown-radiometry frames: 0 temperature fields accepted. Ten explicit-unknown capture/geography fixtures retain null/status exactly. Task 1. |
| BP03, immutable ordering | Commit 100 ordered events, replay 3 times: equal final state/log, 0 input mutations. Twenty duplicates add 0 revisions; 20 same-ID changed payloads reject; 20 gaps/older sequences cause 0 latest-state regressions. Task 2/4. |
| BP04, authenticated approval model | Twenty serialized competing attempts with identical expected revisions: exactly 1 approval/reservation/command and 1 revision transition. Twenty fixture/body-Chief impersonations and 20 former-Chief decisions produce 0 commands. Task 3. This is local CAS modeling, not distributed Convex/two-browser proof. |
| BP05, stale asynchronous work | 24 obsolete results, 6 each for wrong run, old epoch, input revision and plan revision: 0 actionable proposals/commands. Twenty expired/replay/offline approval attempts produce 0 commands. Task 2/3/4. |
| BP06, command fact lifecycle | Twenty duplicate receipts and 20 wrong command/mission/version/producer receipts: 0 duplicate transitions or false completion. Sent/delivered/accepted alone imply 0 completed outcomes; terminal-before-ACK remains terminal in 10 cases. Task 3/4. |
| BP07, replay/source isolation | Three saved logs at 2 receipt cutoffs: 0 future-received frames/receipts, 0 provider calls or commands. Twenty hidden-truth/answer-label/unknown-field payloads reject; unresolved critical hypotheses remain in 20 aging cases. Task 4. |
| BP08, sole producer loss | Twenty wrong producer/capture-epoch attempts reject. After authority loss, 20 mutations/approvals reject until a trusted explicit takeover advances epoch; no second producer starts automatically. Task 2/3/4. |

## Non-goals

No Convex provisioning, SDK, deployment, network endpoint, real authentication integration, provider calls, cloud VMs, payments, media fetch/upload/decode, physics/energy/LOS/RF implementation, route safety calculation, frontend adapters/UI, region adoption, calibrated temperatures/predictions, field orders or real controls. No root/frontend lock or CI edits. No prior-code imports. No claim that local fixtures satisfy T01–T06/C01–C06/E01–E10 end-to-end acceptance.

## Architecture and trade-offs

```text
Future verified server context + JSON event
                    -> closed validator -> immutable canonical commit/log
Received versions + current Chief approval -> local compare-and-commit
                    -> reservation + enqueued simulated command
Teammate producer receipts -> same validated log -> received state / replay
```

Convex is the approved eventual shared authority. One designated teammate producer owns authoritative simulated physics/capture/execution; other browsers consume committed received state. Host loss freezes mutation/dispatch until explicit reconciled takeover, never dual simulation. This PR models that seam locally; no Convex transaction adapter exists yet.

Decision: pure TypeScript, Node >=24, npm, built-in `node --test` with erasable TypeScript, zero runtime dependencies. TypeScript `5.9.3` and `@types/node` `24.10.1` are pinned dev-only typechecking tools. Registry versions verified on 2026-11-14; installed Node `26.11.1`/npm `11.20.0` are environment receipts, not compatibility results. Native tests avoid an added runner/transpiler; limitation is no Node <24 support or non-erasable TS. Alternative was a transpiler/validation library, unnecessary for this bounded package. Server physics/PX4 and per-browser authority were not selected; physics remains teammate-owned.

## Module map and public signatures

All wire fields retain reviewed snake_case names. New composed envelope version is `backend-protocol.v1`; existing v0 planning documents remain untouched. No application consumer exists yet; teammate adapter is a later, separately claimed task.

| File | Responsibility / owner task |
|---|---|
| `backend/package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore` | Isolated package/tooling only; Task 1. |
| `backend/protocol/types.ts` | All readonly public records and Result types; sole schema owner Task 1. |
| `backend/protocol/validation.ts`, `index.ts` | Closed validators and protocol exports; Task 1. |
| `backend/tests/fixtures.ts`, `validation.test.ts` | Deterministic valid/malformed fixtures and guards; Task 1, later additions require reassignment. |
| `backend/state/reducer.ts`, `reducer.test.ts` | Canonical received commit, event ordering, authority freeze; Task 2. |
| `backend/state/approval.ts`, `approval.test.ts` | Versioned approval/reservation/command acceptance; Task 3. |
| `backend/state/replay.ts`, `index.ts`, `replay.test.ts` | Canonical replay, receipt cutoffs, exports and fault checks; Task 4. |

```typescript
type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: RejectionCode; readonly reason: string };
type RejectionCode = 'INVALID_SCHEMA' | 'INVALID_TIME' | 'VERSION_MISMATCH'
  | 'UNAUTHORIZED' | 'STALE_VERSION' | 'STREAM_GAP' | 'CONFLICT' | 'EXPIRED' | 'FROZEN';
validateSeed(input: unknown): Result<IncidentSeed>;
validateEvent(input: unknown): Result<EventInput>;
validateApproval(input: unknown): Result<ApprovalRequest>;
createIncidentState(seed: IncidentSeed): IncidentState;
commitEvent(state: IncidentState, input: unknown, context: CommitContext): Result<IncidentState>;
approveProposal(state: IncidentState, input: unknown, context: CommitContext): Result<IncidentState>;
validateCommandAcceptance(state: IncidentState, command: Command, context: CommitContext): Result<Command>;
replayLog(seed: IncidentSeed, log: readonly CommittedEvent[]): Result<IncidentState>;
selectReceivedSnapshot(state: IncidentState, received_at: string): Result<ReceivedSnapshot>;
```

`IncidentState` contains readonly `seed`, seed identity, `incident_revision`, `input_revision`, `plan_revision`, `reservation_revision`, `chief_id/chief_epoch`, `producer_id/capture_epoch`, `authority_active`, the readonly maps below and readonly canonical `log`. `ReceivedSnapshot` contains only identity/run/epoch, `incident_revision`, `telemetry`, `frames`, `hypotheses`, `commands`, `received_at` cutoff, not seed/candidates/Chief/producer controls. All state/snapshot properties readonly. Use JSON records/arrays, not Map/Set/Date. Internal maps use own-key lookup/null prototypes. Returning any rejection leaves caller state unchanged. Accepted records are owned deep copies; freezing must not mutate caller input.

```typescript
type CommittedFor<K extends CommittedEvent['kind']> = Extract<CommittedEvent, {readonly kind: K}>;
// Exact IncidentState maps, ReceivedSnapshot reuses telemetry/frames/hypotheses/commands.
readonly stream_cursors: Readonly<Record<string, number>>;
readonly telemetry: Readonly<Record<string, CommittedFor<'telemetry.received'>>>; // asset_id -> latest
readonly frames: Readonly<Record<string, CommittedFor<'frame.received'>>>; // feed_id -> latest
readonly hypotheses: Readonly<Record<string, CommittedFor<'hypothesis.received'>>>; // hypothesis_id
readonly proposals: Readonly<Record<string, CommittedFor<'proposal.created'>>>; // proposal_id
readonly reservations: Readonly<Record<string, Reservation>>; // reservation_id
readonly commands: Readonly<Record<string, Command>>; // command_id
readonly log: readonly CommittedEvent[];
```

Telemetry/frame/hypothesis/proposal map values are complete canonical committed wrappers, never bare payloads: acquisition clock remains in payload; received/recorded UTC, canonical revision and producer actor remain in envelope. Historical frames/receipts stay in log when latest map advances. Command status may be derived from receipts, whose actual clocks/evidence remain in log; no invented ReceiptSeen/observed-clock substitute record.

## Exact boundary records

All records are closed JSON values. Recursive guards reject arrays where objects are required, non-plain prototypes, reserved prototype keys, accessors/functions/symbols/BigInt/cycles and non-finite numbers. IDs are 1–128 nonblank characters; integer versions/sequences/ticks are safe nonnegative integers (stream_sequence starts at 1). UTC accepts `YYYY-MM-DDTHH:mm:ss[.sss]Z`, valid real calendar/time, no rollover or offsets. No real-time calls/randomness in reducers. Syntax validation authenticates neither source time nor sensor calibration.

`ActorContext`: trusted `principal_id`, `session_id`, `incident_id`, `run_id`, `actor_kind: human | simulator | analyst | server | fixture`, `chief_epoch: number | null`, `producer_id: string | null`, `capture_epoch: number | null`. Future verified server derives context from identity, run membership and leases, never request body. Tests construct it explicitly and label it fixture identity, not live auth. Canonical events fill `actor_id/actor_kind/session_id` from context. Body identity/role claims (`actor_id`, `actor_kind`, `session_id`, `chief_id`) reject; allowed `chief_epoch` is a concurrency binding, never privilege.

`CommitContext`: `actor: ActorContext`, actual `recorded_at`, `received_at` UTC, `sim_tick`, `mode: live | replay | offline`. These are trusted server/replay inputs, not client clock replacements. Replay/offline cannot approve/dispatch. STREAM_GAP returns unchanged state; the future sole ingestor must serialize a server `authority.changed` freeze event on its own next valid stream sequence before admitting another approval. Local tests commit that explicit freeze, then replay/reconcile and a server takeover to reenable. No hidden mutable gap flag, body flag or trusted-human bypass exists. This models the future adapter obligation, not an implemented reconnect service. Canonical receipt time cannot turn unknown capture time fresh.

`IncidentSeed`: identity/version, initial four revisions = 0, Chief/producer/capture epochs, `authority_active`, `assets`, `feeds`, finite `candidates`. Asset is `asset_id`, `capabilities: readonly ('thermal'|'eo')[]`, `thermal_feed_id`, optional `eo_feed_id`; reject missing thermal or feed reuse. Candidate is `candidate_id`, `action_id`, `asset_id`, `mission_id`, `mission_version`, `route_id`, `plan_revision`, `feasibility_snapshot_id`, `feasible: boolean`, `expires_at_sim_tick`; seed proves no physical feasibility, only preserves producer-declared exercise inputs.

Feed retains thermal contract names: `feed_id`, `asset_id`, `modality`, `source_kind`, `synthetic`, `radiometric`, `calibration`, `source_id/source_revision`, `capture_owner_id/capture_epoch`, `status`. Calibration is null or closed `calibration_id`, `source_id`, `sensor_id`, `method`, `units`, `calibrated_at: UTC|null`, `verified_source: string|null`, `verification_status`. Simulated feeds require synthetic=true, radiometric=false, calibration=null. EO cannot carry thermal calibration. No temperature sample/overlay fields in this PR, even a syntactically source-verified record is not measurement proof.

Feed/source/asset/modality registrations remain immutable seed identity; capture ownership is a CURRENT state lease. Validate frame capture_owner_id/capture_epoch against state.producer_id/state.capture_epoch and trusted ActorContext, not forever against the seed's initial capture owner. A server-approved takeover changes current producer/capture lease without mutating seed or rewriting prior frame/source facts.

`EventInput`: `contract_version`, `incident_id`, `run_id`, `authority_epoch`, `event_id`, `stream_id`, `stream_sequence`, `trace_id`, `causation_id: string|null`, `kind`, closed `payload`. Canonical `CommittedEvent` adds server-assigned `incident_revision`, `actor_id`, `actor_kind`, `session_id`, `recorded_at`, `received_at`, received `sim_tick`; caller cannot supply them. It is a discriminated union of each EventInput kind with those metadata fields, plus canonical `approval.committed`. The latter has identical envelope metadata and exactly `payload: {readonly request: ApprovalRequest; readonly command: Command; readonly reservation: Reservation}`. `approval.committed` is never an accepted EventInput kind, only emitted by the trusted compare-and-commit path or validated stored replay.

| Event kind / permitted context | Closed payload |
|---|---|
| `telemetry.received`, designated simulator | `asset_id`, `mission_id: string|null`, `mission_version`, `captured_at: UTC|null`, `capture_time_status: known|unknown`, `sim_tick`, `position: {x_m,y_m,z_m}|null`, `battery_percent: number|null`, `producer_id`, `capture_epoch`. Battery 0–100; coordinates finite; null means unknown, never `(0,0)`. |
| `frame.received`, designated capture producer | `frame_id`, `feed_id`, `asset_id`, `evidence_id`, `source_snapshot_id`, `source_revision`, `capture_owner_id/capture_epoch`, `captured_at/capture_time_status`, `sim_tick: integer|null`, `source_position: {coordinate_frame,units,altitude_datum,x,y,z}|null`, `location_uncertainty_m: number|null`, `mime_type`, `byte_length`, `media_ref`, `content_hash`, `width_px/height_px`, `media_limits_version`. Require positive bytes/dimensions, nonnegative uncertainty, source/capture registration match. `media_ref` is opaque server-managed ID only, no URL fetch; no media validity claim without decoder. |
| `hypothesis.received`, analyst | `hypothesis_id`, `kind: human|animal|fire|gas_canister|other`, `verification_status: unverified`, `evidence_ids`, `source_snapshot_id`, `input_revision`, `geography: {x_m,y_m,z_m}|null`, `location_uncertainty_m: number|null`, `model_score: {value,scale}|null`, `contradictions: readonly string[]`, `critical: boolean`. Evidence IDs must exist; model score finite with source scale, never calibrated probability. |
| `proposal.created`, analyst or human | `proposal_id/proposal_revision`, `candidate_ids`, `input_revision`, `plan_revision`, `reservation_revision`, `chief_epoch`, `rationale`, `expires_at_sim_tick`. All candidate IDs known/finite/feasible/current; actor cannot introduce arbitrary actions or command/world facts. |
| `command.receipt`, designated simulator | `receipt_id`, `command_id/command_version`, `transmission_id`, `mission_id/mission_version`, `stage: sent|delivered|accepted|running|completed|failed|cancelled|rejected`, `captured_at/capture_time_status`, `sim_tick`, `producer_id/capture_epoch`, `reason: string|null`, `evidence_ids`. Matching command/mission/version/producer required; terminal evidence required for completed/failed/cancelled; rejected requires reason. |
| `authority.changed`, server | `authority_active`, `producer_id`, `capture_epoch`, `next_authority_epoch`. Loss freezes; takeover requires strictly higher authority/capture epochs and explicit producer, never auto-election. |
| `chief.changed`, server | `chief_id`, `chief_epoch` strictly increasing. Invalidates pending approvals, not already received executor facts. |

Server authority loss requires authority_active=false, next_authority_epoch=current+1 and unchanged current producer_id/capture_epoch. Explicit active takeover requires server context, next_authority_epoch>current and capture_epoch>current, with a designated producer_id; update current state lease only, preserve immutable seed. No Chief/model/capture message can change that lease.

`media_ref` has exact opaque-ID grammar `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`; reject any slash/backslash and prefixes matching `^(?:https?|file|data|javascript):` case-insensitively. Other protocol IDs retain the general 1–128 nonblank-character rule. This lexical format proves neither media existence nor server-managed ownership; this package has no fetch sink and makes no access-rights claim.

`ApprovalRequest`: `contract_version`, `incident_id`, `run_id`, `authority_epoch`, `approval_id`, `proposal_id/proposal_revision`, `candidate_id`, `expected_incident_revision`, `input_revision`, `plan_revision`, `reservation_revision`, `chief_epoch`, `expires_at_sim_tick`. Authenticated current Chief only, current active/live run and exact revisions, current proposal/candidate, expiry strictly after context tick. Reserve asset/route exclusively and append exactly one `approval.committed` canonical event containing the request plus generated command and reservation. All three advance together; no split success path. Approval stream is reserved `approval:<principal_id>`, sequence is current cursor+1, event ID `approval:<approval_id>`, trace ID approval_id, causation_id proposal_id. Canonical actor is the verified human context, not a body identity or fabricated server actor. Reservation fields are `reservation_id`, `asset_id`, `route_id`, `approval_id`, `reservation_revision`, `expires_at_sim_tick`. Repeated approval first checks trusted membership/identity and exact logged request: exact same request/principal returns CURRENT unchanged state even when its expected revision is old; changed reuse rejects CONFLICT. New approval performs all current-version/expiry guards.

`Command` is a closed readonly record with exactly these fields, no target_asset_id alias:

```typescript
type CommandStatus = 'enqueued' | 'sent' | 'delivered' | 'accepted' | 'running'
  | 'completed' | 'failed' | 'cancelled' | 'rejected';
interface Command {
  readonly contract_version: 'backend-protocol.v1';
  readonly incident_id: string; readonly run_id: string; readonly authority_epoch: number;
  readonly command_id: string; readonly command_version: number; readonly idempotency_key: string;
  readonly transmission_id: string; readonly asset_id: string;
  readonly mission_id: string; readonly mission_version: number;
  readonly route_id: string; readonly action_id: string; readonly approval_id: string;
  readonly proposal_id: string; readonly proposal_revision: number;
  readonly input_revision: number; readonly plan_revision: number; readonly reservation_revision: number;
  readonly chief_epoch: number; readonly chief_id: string;
  readonly sent_sim_tick: number | null; readonly deadline_sim_tick: number;
  readonly lease_expires_at_sim_tick: number; readonly status: CommandStatus;
}
```

Generated `command_id` is `command:<approval_id>`, command_version=1, idempotency_key=command_id, initial transmission_id=`<command_id>:tx:1`, status=enqueued, sent_sim_tick=null. `chief_id` is server-filled accountable-human audit from ActorContext, never accepted as request privilege. Scope/mission/action/route bind exact approved candidate; numeric fields safe nonnegative integers. No retry scheduler here. TTL capped at 10 sim ticks, lease at 120, both constrained by approved scope expiry. Acceptance rechecks active producer/run/epoch/input/plan/Chief/expiry/current reservation; never fabricates a receipt. Old offline intent needs fresh approval.

## Ordering, replay and error semantics

Global revision advances by exactly 1 per accepted event/approval. Per-stream sequence must be next; exact duplicate event ID/content from same trusted principal returns CURRENT unchanged state, never an older historical state; conflicting reuse rejects. Gaps reject with STREAM_GAP; sole future ingestor serializes the explicit server freeze described above before further approval. Chief cannot clear a freeze. Canonical received_at is nondecreasing in revision order; reject a receipt-clock rollback rather than invent time. Old events never overwrite newest received telemetry/frame; older capture tick/history may be logged without replacing latest. Source acquisition sequence/tick drives freshness, not recent receipt alone.

Stream cursors persist across authority epochs, never reset on loss/takeover; new stream starts at sequence 1. Stream ownership derives from canonical actor records in the CURRENT authority epoch, not a wire prefix: a different principal cannot reuse another principal's stream within that epoch; after explicit takeover, the newly designated producer may continue that stream's next sequence. The `approval:` prefix is reserved exclusively for generated canonical approval.committed; reject inbound EventInput using that prefix, regardless of kind or body actor claims.

Lifecycle preserves independently received facts. Approval/enqueue is not send, delivery is not acceptance, acceptance is not completion. Terminal-before-ACK is retained without regression; missing receipt remains unconfirmed. Authority handoff blocks stale intent without erasing accepted executor history. No status aging clears critical hypotheses.

Chief handoff does not invalidate actual executor receipts: bind receipt to command ID/version, mission ID/version, transmission ID, incident/run and CURRENT producer/capture lease, without rejecting solely because the command's recorded Chief/input/plan is now old. New command acceptance is an intent gate and separately rechecks current Chief/input/plan/authority/expiry in Task 3. Task 2 receipt guards are local reducer logic, not an import of the unavailable Task 3 acceptance API.

Replay validates stored schema, contiguous revisions/cursors and canonical actor bindings, reconstructs without live approval/dispatch/provider calls, and retains original receipt clocks. `selectReceivedSnapshot` returns only received telemetry/frames/hypotheses/command facts from the canonical prefix at or before its valid UTC cutoff, using the original seed plus canonical log; no future-received facts or hidden simulator seed truth. Capture/scenario UTC is a distinct clock, preserved rather than compared blindly to wall receipt cutoff; full dual-cursor frontend replay remains outside this slice. Corrupt/incompatible logs reject, no partial success.

## Delivery and review

Four task-sized RED/GREEN cycles in the [implementation plan](../plans/2026-11-14-backend-protocol.md). Exact claims precede writes. One GPT-6.1 Sol coder at a time owns current task; read-only review may run alongside. No source worker performs Git. Root/Git specialist commits/pushes explicit approved paths to `task/backend-protocol`, opens reviewed PR; main protection respected. Package source/typecheck/tests must pass; live auth, Convex, two-client, frontend/browser/performance/provider checks remain explicitly skipped. No deployment implied by PR merge.
