import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as protocol from '../protocol/index.ts';
import * as publicState from '../state/index.ts';
import { approveProposal } from '../state/approval.ts';
import { commitEvent, createIncidentState } from '../state/reducer.ts';
import { replayLog, selectReceivedSnapshot } from '../state/replay.ts';
import type { ApprovalRequest, Command, CommitContext, CommittedEvent, EventInput, IncidentSeed, IncidentState, ReceiptStage, Result } from '../protocol/types.ts';
import { approval, context, frame, proposal, seed, telemetry } from './fixtures.ts';

function accepted<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(`${result.code}: ${result.reason}`);
  return result.value;
}

function rejected(result: Result<unknown>): void {
  if (result.ok) assert.fail('Expected structured rejection without partial state');
  assert.ok(result.reason.length > 0);
  assert.equal(Object.hasOwn(result, 'value'), false);
}

function clock(second: number): string {
  return `2026-11-14T00:00:${String(second).padStart(2, '0')}Z`;
}

function trusted(state: IncidentState, kind: CommitContext['actor']['actor_kind'], second: number): CommitContext {
  const base = context(kind);
  return { ...base, recorded_at: clock(second), received_at: clock(second), sim_tick: second,
    actor: { ...base.actor, incident_id: state.incident_id, run_id: state.run_id,
      principal_id: kind === 'simulator' ? state.producer_id : kind === 'human' ? state.chief_id : base.actor.principal_id,
      chief_epoch: kind === 'human' ? state.chief_epoch : null,
      producer_id: kind === 'simulator' ? state.producer_id : null,
      capture_epoch: kind === 'simulator' ? state.capture_epoch : null } };
}

function request(state: IncidentState): ApprovalRequest {
  return { ...approval(state.incident_revision), authority_epoch: state.authority_epoch,
    input_revision: state.input_revision, plan_revision: state.plan_revision,
    reservation_revision: state.reservation_revision, chief_epoch: state.chief_epoch };
}

function receipt(state: IncidentState, command: Command, stage: ReceiptStage, sequence: number): EventInput {
  return { contract_version: state.contract_version, incident_id: state.incident_id, run_id: state.run_id,
    authority_epoch: state.authority_epoch, event_id: `receipt-event${sequence}`, stream_id: 'receipts:sim1',
    stream_sequence: sequence, trace_id: `trace-receipt${sequence}`, causation_id: command.command_id,
    kind: 'command.receipt', payload: { receipt_id: `receipt${sequence}`, command_id: command.command_id,
      command_version: command.command_version, transmission_id: command.transmission_id,
      mission_id: command.mission_id, mission_version: command.mission_version, stage,
      captured_at: clock(sequence), capture_time_status: 'known', sim_tick: sequence,
      producer_id: state.producer_id, capture_epoch: state.capture_epoch,
      reason: stage === 'rejected' ? 'EXERCISE: rejection' : null,
      evidence_ids: ['completed', 'failed', 'cancelled'].includes(stage) ? ['evidence1'] : [] } };
}

function mixed(initial: IncidentSeed = seed(), offset = 0): { initial: IncidentSeed; states: readonly IncidentState[] } {
  const states: IncidentState[] = [createIncidentState(initial)];
  const append = (event: EventInput, kind: CommitContext['actor']['actor_kind'], second: number): void => {
    const previous = states.at(-1)!;
    states.push(accepted(commitEvent(previous, event, trusted(previous, kind, second + offset))));
  };
  append(telemetry(), 'simulator', 1);
  const firstFrame = frame(); assert.equal(firstFrame.kind, 'frame.received');
  append({ ...firstFrame, payload: { ...firstFrame.payload, captured_at: null,
    capture_time_status: 'unknown', sim_tick: null } }, 'simulator', 2);
  append({ ...telemetry(), event_id: 'hypothesis-event1', stream_id: 'hypotheses:analyst1',
    kind: 'hypothesis.received', payload: { hypothesis_id: 'h1', kind: 'human', verification_status: 'unverified',
      evidence_ids: ['evidence1'], source_snapshot_id: 'snapshot1', input_revision: 2, geography: null,
      location_uncertainty_m: null, model_score: null, contradictions: ['EXERCISE: alternative interpretation'], critical: true } }, 'analyst', 3);
  const pending = proposal(); assert.equal(pending.kind, 'proposal.created');
  append({ ...pending, payload: { ...pending.payload, input_revision: 2 } }, 'analyst', 4);
  const eligible = states.at(-1)!;
  states.push(accepted(approveProposal(eligible, request(eligible), trusted(eligible, 'human', 5 + offset))));
  append(receipt(states.at(-1)!, states.at(-1)!.commands['command:a1'], 'accepted', 1), 'simulator', 6);
  const later = frame(2); assert.equal(later.kind, 'frame.received');
  append({ ...later, payload: { ...later.payload, captured_at: '2030-01-01T00:00:00Z' } }, 'simulator', 7);
  append({ ...telemetry(), event_id: 'chief-event1', stream_id: 'chief:server1', kind: 'chief.changed',
    payload: { chief_id: 'chief2', chief_epoch: 2 } }, 'server', 8);
  append(receipt(states.at(-1)!, states.at(-1)!.commands['command:a1'], 'completed', 2), 'simulator', 9);
  append({ ...telemetry(), event_id: 'loss-event1', stream_id: 'authority:server1', kind: 'authority.changed',
    payload: { authority_active: false, producer_id: 'sim1', capture_epoch: 1, next_authority_epoch: 2 } }, 'server', 10);
  return { initial, states };
}

test('BP03 three deterministic replays of 100 events equal canonical state with zero input mutations', () => {
  const initial = seed(); let state = createIncidentState(initial);
  for (let n = 1; n <= 100; n++) {
    const result = commitEvent(state, telemetry(n), context());
    if (!result.ok) assert.fail(`${result.code}: ${result.reason}`);
    state = result.value;
  }
  assert.equal(state.log.length, 100);
  const before = JSON.stringify({ initial, state });
  for (let n = 0; n < 3; n++) {
    const result = replayLog(initial, state.log);
    if (!result.ok) assert.fail(`${result.code}: ${result.reason}`);
    assert.deepEqual(result.value, state);
    assert.equal(Object.isFrozen(result.value), true);
    assert.equal(Object.isFrozen(result.value.log), true);
  }
  assert.equal(JSON.stringify({ initial, state }), before);
  assert.equal(Object.isFrozen(initial), false);
});

test('BP07 three mixed approval and authority logs at two receipt cutoffs expose zero future facts', () => {
  for (const offset of [0, 10, 20]) {
    const { initial, states } = mixed(seed(), offset); const final = states.at(-1)!;
    assert.deepEqual(accepted(replayLog(initial, final.log)), final);
    for (const count of [3, 6]) {
      const cutoff = clock(count + offset); const historical = states[count];
      const view = accepted(selectReceivedSnapshot(final, cutoff));
      assert.equal(view.incident_revision, count);
      assert.deepEqual(view.telemetry, historical.telemetry);
      assert.deepEqual(view.frames, historical.frames);
      assert.deepEqual(view.hypotheses, historical.hypotheses);
      assert.deepEqual(view.commands, historical.commands);
      assert.equal(Object.hasOwn(view, 'seed'), false);
      assert.equal(Object.hasOwn(view, 'proposals'), false);
      assert.equal(Object.hasOwn(view, 'chief_id'), false);
      assert.equal(Object.hasOwn(view, 'producer_id'), false);
      for (const event of [...Object.values(view.telemetry), ...Object.values(view.frames), ...Object.values(view.hypotheses)]) {
        assert.ok(Date.parse(event.received_at) <= Date.parse(cutoff));
      }
      assert.equal(view.frames.t1.payload.captured_at, null);
      assert.equal(view.frames.t1.payload.capture_time_status, 'unknown');
      assert.equal(view.frames.t1.payload.sim_tick, null);
      assert.equal(view.frames.t1.received_at, clock(2 + offset));
      assert.equal(Object.keys(view.commands).length, count === 3 ? 0 : 1);
    }
    assert.equal(final.frames.t1.payload.captured_at, '2030-01-01T00:00:00Z');
    assert.equal(accepted(selectReceivedSnapshot(final, clock(7 + offset))).frames.t1.payload.captured_at,
      '2030-01-01T00:00:00Z');
  }
});

test('BP03 canonical schema, actor, ordering, scope and calendar corruption reject with zero partial success', () => {
  const { initial, states } = mixed(); const state = states.at(-1)!;
  const event = state.log[0]; const approved = state.log[4];
  assert.equal(approved.kind, 'approval.committed');
  const corrupted: readonly unknown[] = [
    { ...event, incident_revision: 2 }, { ...event, stream_sequence: 2 },
    { ...event, actor_id: 'wrong-simulator' }, { ...event, actor_kind: 'human' },
    { ...event, actor_kind: 'fixture' }, { ...event, actor_id: '' }, { ...event, session_id: '' },
    { ...event, run_id: 'r2' }, { ...event, authority_epoch: 2 },
    { ...event, contract_version: 'backend-protocol.v0' },
    { ...event, received_at: '2026-02-30T00:00:00Z' },
    { ...event, recorded_at: '2026-11-14T24:00:00Z' },
    { ...event, received_at: '2026-11-14T00:00:01+00:00' },
    { ...event, sim_tick: Infinity }, { ...event, incident_revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...event, extra: 'not canonical' }, { ...event, stream_id: 'approval:fake' },
  ];
  const before = JSON.stringify({ initial, state });
  for (const bad of corrupted) rejected(replayLog(initial, [bad as CommittedEvent]));
  assert.equal(approved.kind, 'approval.committed');
  const badApprovals: readonly unknown[] = [
    { ...approved, actor_id: 'former-chief' }, { ...approved, actor_kind: 'server' },
    { ...approved, stream_id: 'approvals:chief1' }, { ...approved, stream_sequence: 2 },
    { ...approved, event_id: 'approval:forged' }, { ...approved, trace_id: 'other' },
    { ...approved, causation_id: 'other' },
    { ...approved, recorded_at: clock(3) }, { ...approved, sim_tick: 3 },
    { ...approved, payload: { ...approved.payload, request: { ...approved.payload.request, expected_incident_revision: 0 } } },
    { ...approved, payload: { ...approved.payload, request: { ...approved.payload.request, chief_epoch: 2 } } },
    { ...approved, payload: { ...approved.payload, request: { ...approved.payload.request, expires_at_sim_tick: 5 } } },
    { ...approved, payload: { ...approved.payload, request: { ...approved.payload.request, expires_at_sim_tick: 121 } } },
    { ...approved, payload: { ...approved.payload, request: { ...approved.payload.request, candidate_id: 'c2' } } },
    { ...approved, payload: { ...approved.payload, command: { ...approved.payload.command, action_id: 'land' } } },
    { ...approved, payload: { ...approved.payload, command: { ...approved.payload.command, command_version: 2 } } },
    { ...approved, payload: { ...approved.payload, command: { ...approved.payload.command, chief_id: 'other' } } },
    { ...approved, payload: { ...approved.payload, command: { ...approved.payload.command, status: 'completed' } } },
    { ...approved, payload: { ...approved.payload, command: { ...approved.payload.command, deadline_sim_tick: 100 } } },
    { ...approved, payload: { ...approved.payload, command: { ...approved.payload.command, sent_sim_tick: 5 } } },
    { ...approved, payload: { ...approved.payload, reservation: { ...approved.payload.reservation, route_id: 'route2' } } },
    { ...approved, payload: { ...approved.payload, reservation: { ...approved.payload.reservation, expires_at_sim_tick: 121 } } },
    { ...approved, payload: { ...approved.payload, reservation: { ...approved.payload.reservation, constructor: 'forged' } } },
  ];
  for (const bad of badApprovals) rejected(replayLog(initial, [...state.log.slice(0, 4), bad as CommittedEvent]));
  rejected(replayLog(initial, [state.log[0], { ...state.log[1], event_id: state.log[0].event_id }]));
  rejected(replayLog(initial, [state.log[0], { ...state.log[1], received_at: clock(0) }]));
  rejected(replayLog(initial, [state.log[0], { ...state.log[1], incident_revision: 3 }]));
  const invalidSuffix = { ...state, log: [...state.log.slice(0, 9), { ...state.log[9], received_at: 'not-UTC' }] };
  rejected(selectReceivedSnapshot(invalidSuffix, clock(3)));
  assert.equal(JSON.stringify({ initial, state }), before);
});

test('BP07 malformed stored objects reject without evaluating accessors or proxy traps', () => {
  const { initial, states } = mixed(); const state = states.at(-1)!;
  let evaluations = 0;
  const accessor = { ...state.log[0] };
  Object.defineProperty(accessor, 'payload', { enumerable: true, get() { evaluations++; throw new Error('getter invoked'); } });
  const proxy = new Proxy(state.log[0], { get() { evaluations++; throw new Error('proxy invoked'); } });
  const sparse: CommittedEvent[] = []; sparse.length = 1;
  const accessorLog = [state.log[0]];
  Object.defineProperty(accessorLog, '0', { enumerable: true, get() { evaluations++; throw new Error('log getter invoked'); } });
  for (const bad of [accessor, proxy, { ...state.log[0], payload: null }, { ...state.log[0], payload: { temperature: 32 } }]) {
    rejected(replayLog(initial, [bad as CommittedEvent]));
  }
  rejected(replayLog(initial, sparse)); rejected(replayLog(initial, accessorLog));
  rejected(replayLog(initial, new Proxy([], { get() { evaluations++; throw new Error('log proxy invoked'); } })));
  assert.equal(evaluations, 0);
});

test('BP07 20 hidden-truth or answer payloads reject through real protocol and replay boundaries', () => {
  const initial = seed(); const next = accepted(commitEvent(createIncidentState(initial), frame(), context()));
  const recorded = next.log[0]; assert.equal(recorded.kind, 'frame.received');
  for (let n = 0; n < 20; n++) {
    const key = ['hidden_truth', 'answer_label', 'ground_truth', 'temperature', 'unknown_field'][n % 5];
    const payload = { ...recorded.payload, [key]: 'EXERCISE: forbidden oracle truth' };
    rejected(protocol.validateEvent({ ...frame(), payload }));
    rejected(replayLog(initial, [{ ...recorded, payload } as CommittedEvent]));
  }
});

test('BP07 10 unknown capture fixtures retain null clocks and geography after later receipt', () => {
  for (let n = 0; n < 10; n++) {
    const initial = seed(); const event = frame(); assert.equal(event.kind, 'frame.received');
    const state = accepted(commitEvent(createIncidentState(initial), { ...event, payload: { ...event.payload,
      captured_at: null, capture_time_status: 'unknown', sim_tick: null, source_position: null,
      location_uncertainty_m: null } }, { ...context(), recorded_at: clock(20 + n), received_at: clock(20 + n) }));
    const view = accepted(selectReceivedSnapshot(state, clock(30 + n)));
    assert.equal(view.frames.t1.payload.captured_at, null);
    assert.equal(view.frames.t1.payload.capture_time_status, 'unknown');
    assert.equal(view.frames.t1.payload.sim_tick, null);
    assert.equal(view.frames.t1.payload.source_position, null);
    assert.equal(view.frames.t1.payload.location_uncertainty_m, null);
    assert.equal(view.frames.t1.received_at, clock(20 + n));
    assert.deepEqual(accepted(replayLog(initial, state.log)), state);
  }
});

test('BP07 critical hypotheses remain unresolved across 20 aging cutoffs without fabricated freshness', () => {
  const { states } = mixed(); const state = states.at(-1)!;
  for (let day = 15; day < 35; day++) {
    const cutoff = `2026-12-${String(day - 14).padStart(2, '0')}T00:00:00Z`;
    const view = accepted(selectReceivedSnapshot(state, cutoff));
    assert.equal(view.hypotheses.h1.payload.critical, true);
    assert.equal(view.hypotheses.h1.payload.verification_status, 'unverified');
    assert.equal(view.hypotheses.h1.received_at, clock(3));
    assert.deepEqual(view.hypotheses.h1.payload.contradictions, ['EXERCISE: alternative interpretation']);
    assert.equal(view.frames.t1.received_at, clock(7));
    assert.equal(view.commands['command:a1'].status, 'completed');
  }
});

test('BP06 10 terminal-before-ACK logs retain terminal outcomes and original receipt evidence', () => {
  for (let n = 0; n < 10; n++) {
    const { initial, states } = mixed(); let state = states[5];
    const command = state.commands['command:a1'];
    const stage: ReceiptStage = n % 2 ? 'failed' : 'completed';
    state = accepted(commitEvent(state, receipt(state, command, stage, 1), trusted(state, 'simulator', 6)));
    state = accepted(commitEvent(state, receipt(state, command, 'accepted', 2), trusted(state, 'simulator', 7)));
    state = accepted(commitEvent(state, receipt(state, command, 'sent', 3), trusted(state, 'simulator', 8)));
    const replayed = accepted(replayLog(initial, state.log));
    assert.deepEqual(replayed, state);
    assert.equal(replayed.commands[command.command_id].status, stage);
    assert.equal(replayed.log.filter(event => event.kind === 'command.receipt').length, 3);
    assert.equal(accepted(selectReceivedSnapshot(state, clock(6))).commands[command.command_id].status, stage);
    assert.equal(accepted(selectReceivedSnapshot(state, clock(7))).commands[command.command_id].status, stage);
  }
});

test('BP08 20 loss and explicit takeover logs preserve received facts without reviving stale command intent', () => {
  for (let n = 0; n < 20; n++) {
    const { initial, states } = mixed(); let state = n % 2 ? states.at(-1)! : states[5];
    const status = state.commands['command:a1'].status;
    if (n % 2 === 0) {
      state = accepted(commitEvent(state, { ...telemetry(), event_id: 'pending-chief1', stream_id: 'chief:server1',
        kind: 'chief.changed', payload: { chief_id: 'chief2', chief_epoch: 2 } }, trusted(state, 'server', 8)));
      state = accepted(commitEvent(state, { ...telemetry(), event_id: 'pending-loss1', stream_id: 'authority:server1',
        kind: 'authority.changed', payload: { authority_active: false, producer_id: 'sim1', capture_epoch: 1,
          next_authority_epoch: 2 } }, trusted(state, 'server', 10)));
    }
    const frozen = accepted(replayLog(initial, state.log));
    assert.equal(frozen.authority_active, false);
    assert.equal(frozen.commands['command:a1'].status, status);
    const takeover: EventInput = { ...telemetry(), authority_epoch: 2, event_id: 'takeover1',
      stream_id: 'authority:server1', stream_sequence: 2, kind: 'authority.changed',
      payload: { authority_active: true, producer_id: 'sim2', capture_epoch: 2, next_authority_epoch: 3 } };
    state = accepted(commitEvent(state, takeover, trusted(state, 'server', 11)));
    const sequence = state.stream_cursors['frames:t1'] + 1;
    const next = frame(sequence); assert.equal(next.kind, 'frame.received');
    state = accepted(commitEvent(state, { ...next, authority_epoch: 3, payload: { ...next.payload,
      capture_owner_id: 'sim2', capture_epoch: 2 } }, trusted(state, 'simulator', 12)));
    const replayed = accepted(replayLog(initial, state.log));
    assert.deepEqual(replayed, state);
    assert.equal(replayed.producer_id, 'sim2'); assert.equal(replayed.capture_epoch, 2);
    assert.equal(replayed.seed.producer_id, 'sim1');
    assert.equal(replayed.log[1].actor_id, 'sim1'); assert.equal(replayed.log.at(-1)!.actor_id, 'sim2');
    assert.equal(replayed.stream_cursors['frames:t1'], sequence);
    assert.equal(Object.keys(replayed.commands).length, 1);
    assert.equal(replayed.commands['command:a1'].status, status);
    assert.equal(replayed.log.filter(event => event.kind === 'approval.committed').length, 1);
    assert.equal(replayed.log.filter(event => event.kind === 'command.receipt').length, n % 2 ? 2 : 0);
    const before = accepted(selectReceivedSnapshot(state, clock(10)));
    const after = accepted(selectReceivedSnapshot(state, clock(12)));
    assert.equal(before.authority_epoch, 2); assert.equal(after.authority_epoch, 3);
    assert.equal(before.frames.t1.actor_id, 'sim1'); assert.equal(after.frames.t1.actor_id, 'sim2');
    assert.equal(before.commands['command:a1'].status, status);
  }
});

test('BP07 invalid receipt cutoffs reject and pre-log cutoff exposes zero seed or future facts', () => {
  const { states } = mixed(); const state = states.at(-1)!;
  for (const cutoff of ['2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z', '2026-11-14T24:00:00Z',
    '2026-11-14T00:00:00+00:00', '2026-11-14T00:00:00.1Z', '', 'tomorrow']) {
    rejected(selectReceivedSnapshot(state, cutoff));
  }
  const empty = accepted(selectReceivedSnapshot(state, clock(0)));
  assert.equal(empty.incident_revision, 0);
  for (const values of [empty.telemetry, empty.frames, empty.hypotheses, empty.commands]) assert.equal(Object.keys(values).length, 0);
  assert.deepEqual(Object.keys(empty).sort(), ['authority_epoch', 'commands', 'contract_version', 'frames',
    'hypotheses', 'incident_id', 'incident_revision', 'received_at', 'run_id', 'telemetry'].sort());
  assert.equal(Object.isFrozen(empty), true); assert.equal(Object.isFrozen(empty.frames), true);
  assert.equal(Object.getPrototypeOf(empty.frames), null);
});

test('BP07 real public entry points replay with zero network, random or present-time calls', t => {
  const { initial, states } = mixed(); const state = states.at(-1)!;
  assert.equal(publicState.replayLog, replayLog);
  assert.equal(publicState.commitEvent, commitEvent);
  assert.equal(publicState.approveProposal, approveProposal);
  assert.equal(protocol.validateSeed(initial).ok, true);
  const presentTime = t.mock.method(Date, 'now', () => assert.fail('Present time must not influence replay'));
  const random = t.mock.method(Math, 'random', () => assert.fail('Randomness must not influence replay'));
  const provider = t.mock.method(globalThis, 'fetch', () => assert.fail('Replay must not call a provider'));
  assert.deepEqual(accepted(publicState.replayLog(initial, state.log)), state);
  assert.equal(accepted(publicState.selectReceivedSnapshot(state, clock(3))).incident_revision, 3);
  assert.equal(presentTime.mock.callCount(), 0); assert.equal(random.mock.callCount(), 0);
  assert.equal(provider.mock.callCount(), 0);
  assert.equal(state.log.filter(event => event.kind === 'approval.committed').length, 1);
  assert.equal(Object.keys(state.commands).length, 1);
});
