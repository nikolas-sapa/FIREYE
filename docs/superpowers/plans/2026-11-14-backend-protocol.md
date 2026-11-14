# Backend Protocol Foundation Implementation Plan

> For agentic workers: use `superpowers:subagent-driven-development` or `superpowers:executing-plans`, task by task. Owner selected supervised subagents, GPT-6.1 Sol only. Workers never perform Git; root delivery overrides default skill commits.

**Goal:** locally runnable, validated received-event protocol with immutable replay and current-human-approved simulated commands.

**Architecture:** pure validators, canonical received reducer and local compare-and-commit approval model. Future Convex provides shared transactions; teammate alone owns simulation/capture/executor/UI. This package creates neither server nor provider adapter.

**Tech Stack:** Node >=24, native erasable TypeScript, npm, built-in `node:test`; dev-only TypeScript `5.9.3`, `@types/node` `24.10.1`.

## Global constraints

- Approved [final bounded spec](../specs/2026-11-14-backend-protocol-design.md) is the complete schema/semantic authority. Wire names stay snake_case, version `backend-protocol.v1`.
- Baseline `ed470de61df5fad86c249d6a2a7facfb5d1666aa`; worktree `/Users/nikolassapalidis/Developer/worktrees/fire-command-center/backend-protocol`, branch `task/backend-protocol`.
- Exact task claims first; one schema/lock owner. Preserve peers. No frontend/root manifests/locks/CI/global config/reuse imports.
- Zero runtime dependencies/network/provider calls; no live identity/Convex/distributed atomicity claims. No physics, media fetching, real controls or deployment.
- Errors return `Result`, no partial state; accepted JSON copies are immutable. No current clock/random access in core functions.
- Test plan precedes implementation: BP01–BP08 in spec. Each small step targets 2–5 minutes; split code edits within a task, do not invent architecture.
- Required reviews: spec compliance then TypeScript/security code review. Delivery coordinator alone stages named files, commits/pushes reviewed task boundaries.

## Test plan and file ownership

| Task | Numeric cases | Sole writable files |
|---|---|---|
| 1 | BP01/BP02: 100 bad/10 good, 4 thermal +2 EO, 100 no-temperature | `backend/package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `protocol/types.ts`, `protocol/validation.ts`, `protocol/index.ts`, `tests/fixtures.ts`, `tests/validation.test.ts` |
| 2 | BP03/BP05/BP08: 100 events, 20 duplicate/gap, 24 stale, 20 wrong producer | `backend/state/reducer.ts`, `backend/tests/reducer.test.ts` |
| 3 | BP04/BP05/BP06: 20 competitors ->1, 40 unauthorized ->0, 20 invalid acceptance | `backend/state/approval.ts`, `backend/tests/approval.test.ts` |
| 4 | BP03/BP06/BP07/BP08: 3 replays/2 cutoffs, 0 mutations/calls/regressions | `backend/state/replay.ts`, `backend/state/index.ts`, `backend/tests/replay.test.ts` |

Fixtures export `seed(): IncidentSeed`, `context(actor_kind?: ActorContext['actor_kind']): CommitContext`, `telemetry(stream_sequence?: number): EventInput`, `frame(stream_sequence?: number): EventInput`, `proposal(): EventInput`, `approval(expected_incident_revision?: number): ApprovalRequest`, `malformedEvents(): readonly unknown[]`. Use spec IDs/clocks; seed candidates/feeds must match records. Initial telemetry/frame streams distinct; `context()` defaults to designated simulator, `context('human')` current Chief, fixture remains nonhuman. Helpers return fresh owned objects each call. Later workers consume but do not edit shared fixtures/schema without coordinator reassignment.

### Task 1: closed protocol and executable package

**Interfaces:** define/export all readonly spec records in `types.ts`, including IncidentState/Command/CommittedEvent types consumed downstream. Produce `validateSeed(input: unknown): Result<IncidentSeed>`, `validateEvent(input: unknown): Result<EventInput>`, `validateApproval(input: unknown): Result<ApprovalRequest>` through `protocol/index.ts`.

Canonical schema: exact Command field list in spec (`asset_id`, not target_asset_id; server-generated chief_id audit), approval.committed payload exactly `{request,command,reservation}` excluded from inbound EventInput; latest telemetry/frames and hypothesis/proposal maps retain full typed CommittedEvent wrappers with acquisition plus receipt clocks. No bare-payload map or invented receipt record.

- [ ] Verify native runtime `node --version`; `npm show typescript@5.9.3 version`; `npm show @types/node@24.10.1 version`. Expected exact package versions, Node >=24. Registry reads are not installation proof.
- [ ] Add isolated package, types/fixture definitions and failing tests before validator implementation. Package content:

```json
{"name":"@fire-command-center/backend-protocol","version":"0.1.0","private":true,"type":"module","engines":{"node":">=24"},"scripts":{"test":"node --test tests/*.test.ts","typecheck":"tsc --noEmit"},"devDependencies":{"@types/node":"24.10.1","typescript":"5.9.3"}}
```

`tsconfig.json`: strict, target ES2022, NodeNext module/resolution, noEmit, allowImportingTsExtensions, erasableSyntaxOnly, types=[node], include protocol/state/tests TS. `.gitignore`: `node_modules/` only. `npm install --ignore-scripts` from backend creates backend lock; no root install.

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, validateSeed } from '../protocol/index.ts';
import { seed, telemetry, malformedEvents } from './fixtures.ts';
test('BP01 rejects 100 malformed JSON events', () => {
  const fixtures = malformedEvents(); assert.equal(fixtures.length, 100);
  for (const input of fixtures) { const r = validateEvent(input); assert.equal(r.ok, false); if (!r.ok) assert.ok(r.reason.length > 0); }
  for (let n = 0; n < 10; n++) assert.equal(validateEvent(telemetry(n + 1)).ok, true);
});
test('BP02 four assets retain distinct thermal channels', () => {
  const r = validateSeed(seed()); assert.equal(r.ok, true);
  if (r.ok) assert.equal(new Set(r.value.assets.map(a => a.thermal_feed_id)).size, 4);
});
```

- [ ] Run `node --test tests/validation.test.ts` from backend, expect RED missing export/function. Keep this receipt before implementation.
- [ ] Implement each closed record guard from spec, one kind at a time. Pattern, not unchecked cast:

```typescript
const invalid = (reason: string): Result<never> => ({ok:false, code:'INVALID_SCHEMA', reason});
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const own = (value: object, key: string): boolean => Object.hasOwn(value, key);
```

Validate exact keys before property access, valid real calendar UTC, all nested finite numbers/IDs, known discriminants and null/status relationships. Copy accepted inputs after validation. Temperature/hidden-truth/body identity-role fields reject; spec's chief_epoch concurrency binding remains allowed. Simulated feed flags and asset/modality binding covered by seed/frame semantic checks. Never use JSON.stringify as validation of Infinity.
- [ ] Add BP02 100 temperature-key rejections/unknown preservation and BP01 prototype/overflow/calendar/version cases. Run `node --test tests/validation.test.ts`, then `npm run typecheck`: expected GREEN, zero failed tests/type errors.
- [ ] Root review Task 1 diff and RED/GREEN receipt; root records claim handoff. No worker Git. Task 2 starts only after types/API review.

### Task 2: immutable canonical event reducer

**Consumes:** Task 1 records, validators and fixture exports. **Produces:** `createIncidentState(seed: IncidentSeed): IncidentState`, `commitEvent(state: IncidentState, input: unknown, context: CommitContext): Result<IncidentState>` from `state/reducer.ts`.

- [ ] Write RED fixture-driven tests for 100 ordered telemetry messages, duplicates, changed-ID collisions, wrong run/epoch/producer, gaps and frozen authority. Actual starter:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIncidentState, commitEvent } from '../state/reducer.ts';
import { seed, context, telemetry } from './fixtures.ts';
test('BP03 commits 100 without mutating inputs', () => {
  let state = createIncidentState(seed());
  for (let n = 1; n <= 100; n++) {
    const event = telemetry(n); const before = JSON.stringify({state,event});
    const r = commitEvent(state, event, context()); assert.equal(r.ok, true);
    assert.equal(JSON.stringify({state,event}), before);
    if (r.ok) state = r.value;
  }
  assert.equal(state.incident_revision, 100); assert.equal(state.log.length, 100);
});
```

- [ ] Run `node --test tests/reducer.test.ts`, expect RED missing reducer export before code.
- [ ] Implement reducer dispatch and canonical envelope construction. Minimal accepted transition shape:

```typescript
const nextRevision = state.incident_revision + 1;
const committed = {...event, incident_revision:nextRevision,
  actor_id:context.actor.principal_id, actor_kind:context.actor.actor_kind,
  session_id:context.actor.session_id, recorded_at:context.recorded_at,
  received_at:context.received_at, sim_tick:context.sim_tick};
```

First guard context membership/permissions, run/epoch, mode, next stream cursor, exact duplicate content and per-kind references. Deep-copy owned accepted records and update only affected received map/log/cursors; map values retain full committed wrappers, telemetry keyed asset_id and frames keyed feed_id. Telemetry/frame commits advance input_revision; proposals preserve it. Server-only handoff invalidates pending intent, never old received facts. STREAM_GAP returns unchanged state; tests next commit an explicit server authority.changed=false event on its valid server stream, then show 20 approvals reject FROZEN. Future sole ingestor must serialize this freeze before any further approval, never trust a Chief/body flag. Replay/reconciliation plus explicit server takeover reenable. Receipt-clock rollback rejects, preserving nondecreasing received_at across revisions. Older-capture history never replaces newer observation.
- [ ] Add 24 obsolete proposal cases and 20 gap/producer-loss fixtures, checking rejection codes and unchanged caller state. Run `node --test tests/reducer.test.ts` then `npm test` and `npm run typecheck`: expected GREEN, 0 regressions.
- [ ] Root spec/TypeScript/security review, hand off immutable API. No worker Git; no frontend consumer edits.

### Task 3: revision-bound approval and command checks

**Consumes:** `validateApproval`, `IncidentState`, `CommitContext`, `Command`, reducer's immutable committed log shape. **Produces:** `approveProposal(state: IncidentState, input: unknown, context: CommitContext): Result<IncidentState>`, `validateCommandAcceptance(state: IncidentState, command: Command, context: CommitContext): Result<Command>` from `state/approval.ts`.

- [ ] Build eligible state using committed current proposal; use no fabricated command fixture as acceptance proof. RED starter:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIncidentState, commitEvent } from '../state/reducer.ts';
import { approveProposal } from '../state/approval.ts';
import { seed, context, proposal, approval } from './fixtures.ts';
test('BP04 serialized competing approvals produce exactly one command', async () => {
  const p = commitEvent(createIncidentState(seed()), proposal(), context('analyst'));
  assert.equal(p.ok, true); if (!p.ok) return;
  let state = p.value; const request = approval(state.incident_revision); let accepted = 0;
  await Promise.all(Array.from({length:20}, async () => {
    const r = approveProposal(state, request, context('human'));
    if (r.ok && r.value !== state) { state = r.value; accepted++; }
  }));
  assert.equal(accepted, 1); assert.equal(Object.keys(state.commands).length, 1);
  assert.equal(state.incident_revision, p.value.incident_revision + 1);
});
```

- [ ] Run `node --test tests/approval.test.ts`, expect RED missing approval function. Add BP04 20 distinct approval IDs with one revision (19 CONFLICT), 20 fixture and 20 former-Chief fixtures, BP05 replay/offline/expired inputs.
- [ ] Implement all guards before allocating reservation/command. Validate trusted membership/identity before idempotency lookup; exact same approval request/principal returns CURRENT unchanged state even when its original expected revision is old. Changed ID reuse rejects CONFLICT. New requests compare current Chief/context identity, incident/input/plan/reservation/proposal revisions, epoch/run, known feasible candidate/scope, exclusive asset/route and strict expiry. Deterministic command IDs bind approval/version; one approval.committed log event owns reservation+command, revision +=1 exactly once. Reserved approval:<principal_id> stream advances one cursor; persisted actor comes from verified human context. Example guard:

```typescript
if (request.expected_incident_revision !== state.incident_revision)
  return {ok:false, code:'CONFLICT', reason:'incident revision changed'};
if (context.mode !== 'live' || !state.authority_active)
  return {ok:false, code:'FROZEN', reason:'approval unavailable'};
```

- [ ] Command acceptance rechecks active designated producer/run/epoch/Chief/current input/plan/reservation/scope expiry and command identity, never sets accepted/completed itself. Add 20 wrong-version/mission/expiry fixtures, 10 terminal-before-ACK and sent/delivered/accepted noncompletion checks through reducer. Root may reassign reducer receipt branch only if Task 2 omitted this specified branch; no concurrent shared-file writes.
- [ ] Run `node --test tests/approval.test.ts`, `npm test`, `npm run typecheck`: expected GREEN, 0 false commands/completions. Record local CAS only, not Convex/two-client proof. Root reviews/claims Task 4; no worker Git.

### Task 4: pure replay, receipt-cutoff views and faults

**Consumes:** all preceding public APIs; readonly canonical log includes approval.committed. **Produces:** `replayLog(seed: IncidentSeed, log: readonly CommittedEvent[]): Result<IncidentState>`, `selectReceivedSnapshot(state: IncidentState, received_at: string): Result<ReceivedSnapshot>` plus `state/index.ts` exports.

- [ ] RED test builds 100-event canonical log, runs three pure replays, compares final state and inputs:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIncidentState, commitEvent } from '../state/reducer.ts';
import { replayLog } from '../state/replay.ts';
import { seed, context, telemetry } from './fixtures.ts';
test('BP03 three deterministic replays equal canonical state', () => {
  const initial = seed(); let state = createIncidentState(initial);
  for (let n = 1; n <= 100; n++) { const r = commitEvent(state,telemetry(n),context()); assert.equal(r.ok,true); if(r.ok) state=r.value; }
  const before=JSON.stringify({initial,state});
  for(let n=0;n<3;n++){ const r=replayLog(initial,state.log); assert.equal(r.ok,true); if(r.ok) assert.deepEqual(r.value,state); }
  assert.equal(JSON.stringify({initial,state}),before);
});
```

- [ ] Run `node --test tests/replay.test.ts`, expect RED missing replay API. Add 3 mixed logs ×2 cutoffs, corrupt revision/actor/binding/UTC logs, unknown capture, terminal reorder, critical aging and authority-loss cases. Clock values vary by event to make future-cutoff checks nontrivial.
- [ ] Implement schema-checked contiguous replay using recorded context/clocks and deterministic recorded approval decision. Never call live approve/dispatch/provider functions; reconstruct approved reservation/command from canonical event after verifying original bindings. Receipt view projects only known observations/hypotheses/command facts from replay prefix, excluding seed candidates and private producer truth. Starter selection:

```typescript
const visible = state.log.filter(e => Date.parse(e.received_at) <= Date.parse(received_at));
```

Validate cutoff/calendar first; canonical log received_at must be nondecreasing, so the selection is a contiguous revision prefix. Preserve unknown capture and original receipt clocks. Return only ReceivedSnapshot fields, not authority controls or future seed data. Dual capture/simulation cursor UI replay is not this package's receipt-cutoff function.
- [ ] Run `node --test tests/replay.test.ts`, then `npm ci --ignore-scripts`, `npm test`, `npm run typecheck` from backend. Run real public `protocol/index.ts` and `state/index.ts` imports in node tests (not mocked), 0 runtime deps. All commands unpiped; expected 0 failing tests/type errors.
- [ ] Root verifies BP01–BP08 mapping, two-stage review and exact diff. Update scoped receipts/claims without checking full P0-02/P0-10 complete. Root/Git specialist commits named files and pushes `task/backend-protocol`/PR only. Explicitly skip live identity/Convex/browser/provider/deploy checks.

## Self-review / handoff

Spec coverage: BP01/02 ->1, BP03/05/08 ->2, BP04/05/06 ->3, BP03/06/07/08 ->4. Public signatures/types stay fixed; any changed schema returns to spec owner before implementation. No unapproved architecture dependency or task consumes an undefined fixture/API. Owner already selected supervised subagents; no repeat execution-choice question. Root delivers Git after real checks; document existence earns no product acceptance credit.
