import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIncidentState, commitEvent } from '../state/reducer.ts';
import { context, frame, proposal, seed, telemetry } from './fixtures.ts';
import type {
  Command, CommitContext, EventInput, IncidentSeed, IncidentState,
  RejectionCode, ReceiptStage, Result,
} from '../protocol/types.ts';

function accepted(result: Result<IncidentState>): IncidentState {
  if (!result.ok) assert.fail(`${result.code}: ${result.reason}`);
  return result.value;
}

function rejected(state: IncidentState, input: unknown, actor: CommitContext, code: RejectionCode): void {
  const before = JSON.stringify({ state, input, actor });
  const result = commitEvent(state, input, actor);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, code);
    assert.ok(result.reason.length > 0);
  }
  assert.equal(JSON.stringify({ state, input, actor }), before);
}

function producer(producer_id = 'sim1', capture_epoch = 1): CommitContext {
  const actor = context();
  return { ...actor, sim_tick: 10, actor: { ...actor.actor, principal_id: producer_id, producer_id, capture_epoch } };
}

function authority(state: IncidentState, authority_active: boolean, sequence = 1): EventInput {
  return {
    ...telemetry(), authority_epoch: state.authority_epoch,
    event_id: `authority${sequence}`, stream_id: 'server:server1', stream_sequence: sequence,
    kind: 'authority.changed', payload: {
      authority_active, producer_id: authority_active ? 'sim2' : state.producer_id,
      capture_epoch: state.capture_epoch + (authority_active ? 1 : 0),
      next_authority_epoch: state.authority_epoch + 1,
    },
  };
}

function observation(n = 1): Extract<EventInput, { kind: 'telemetry.received' }> {
  const input = telemetry(n);
  assert.equal(input.kind, 'telemetry.received');
  if (input.kind !== 'telemetry.received') throw new Error('fixture kind');
  return input;
}

function image(n = 1): Extract<EventInput, { kind: 'frame.received' }> {
  const input = frame(n);
  assert.equal(input.kind, 'frame.received');
  if (input.kind !== 'frame.received') throw new Error('fixture kind');
  return input;
}

function intent(): Extract<EventInput, { kind: 'proposal.created' }> {
  const input = proposal();
  assert.equal(input.kind, 'proposal.created');
  if (input.kind !== 'proposal.created') throw new Error('fixture kind');
  return input;
}

function hypothesis(input_revision = 1): EventInput {
  return {
    ...telemetry(), event_id: 'hypothesis-event1', stream_id: 'hypotheses:analyst1',
    kind: 'hypothesis.received', payload: {
      hypothesis_id: 'h1', kind: 'human', verification_status: 'unverified',
      evidence_ids: ['evidence1'], source_snapshot_id: 'snapshot1', input_revision,
      geography: null, location_uncertainty_m: null, model_score: null,
      contradictions: ['Exercise pixels are smoke-obscured.'], critical: true,
    },
  };
}

// Declared command fixture, not proof of a genuine approval. Task 3 generates real commands.
function command(): Command {
  return {
    contract_version: 'backend-protocol.v1', incident_id: 'i1', run_id: 'r1', authority_epoch: 1,
    command_id: 'command:a1', command_version: 1, idempotency_key: 'command:a1',
    transmission_id: 'command:a1:tx:1', asset_id: 'd1', mission_id: 'm1', mission_version: 1,
    route_id: 'route1', action_id: 'inspect', approval_id: 'a1', proposal_id: 'p1', proposal_revision: 1,
    input_revision: 0, plan_revision: 0, reservation_revision: 1, chief_epoch: 1, chief_id: 'chief1',
    sent_sim_tick: null, deadline_sim_tick: 20, lease_expires_at_sim_tick: 120, status: 'enqueued',
  };
}

function withCommand(): IncidentState {
  const state = accepted(commitEvent(createIncidentState(seed()), frame(), producer()));
  const declared = command();
  return { ...state, commands: { [declared.command_id]: declared } };
}

function receipt(stage: ReceiptStage = 'sent', n = 1): Extract<EventInput, { kind: 'command.receipt' }> {
  return {
    ...telemetry(), event_id: `receipt-event${n}`, stream_id: 'receipts:sim1', stream_sequence: n,
    kind: 'command.receipt', payload: {
      receipt_id: `receipt${n}`, command_id: 'command:a1', command_version: 1,
      transmission_id: 'command:a1:tx:1', mission_id: 'm1', mission_version: 1,
      stage, captured_at: null, capture_time_status: 'unknown', sim_tick: n,
      producer_id: 'sim1', capture_epoch: 1, reason: stage === 'rejected' ? 'Exercise rejected' : null,
      evidence_ids: ['completed', 'failed', 'cancelled'].includes(stage) ? ['evidence1'] : [],
    },
  };
}

test('BP03 seed and 100 ordered telemetry commits make 0 caller mutations', () => {
  const original = seed();
  const initial = JSON.stringify(original);
  let state = createIncidentState(original);
  assert.equal(JSON.stringify(original), initial);
  assert.notEqual(state.seed, original);
  assert.equal(state.incident_revision, 0);
  assert.equal(Object.keys(state.telemetry).length, 0);
  for (let n = 1; n <= 100; n++) {
    const event = telemetry(n);
    const actor = producer();
    const before = JSON.stringify({ state, event, actor });
    const next = accepted(commitEvent(state, event, actor));
    assert.equal(JSON.stringify({ state, event, actor }), before);
    assert.notEqual(next, state);
    state = next;
  }
  assert.equal(state.incident_revision, 100);
  assert.equal(state.input_revision, 100);
  assert.equal(state.log.length, 100);
  assert.equal(state.stream_cursors['telemetry:d1'], 100);
  assert.equal(state.telemetry.d1.payload.sim_tick, 100);
  assert.equal(state.telemetry.d1.sim_tick, 10);
  assert.equal(state.telemetry.d1.actor_id, 'sim1');
  assert.equal(state.telemetry.d1.received_at, producer().received_at);
  assert.equal(state.telemetry.d1, state.log[99]);
});

test('BP03 20 historical exact duplicates return CURRENT state with 0 new revisions', () => {
  let state = createIncidentState(seed());
  for (let n = 1; n <= 25; n++) state = accepted(commitEvent(state, telemetry(n), producer()));
  for (let n = 1; n <= 20; n++) {
    const event = JSON.parse(JSON.stringify(telemetry(n))) as unknown;
    const result = commitEvent(state, event, { ...producer(), received_at: '2026-11-14T00:00:02Z' });
    assert.equal(accepted(result), state);
  }
  assert.equal(state.incident_revision, 25);
  assert.equal(state.log.length, 25);
});

test('BP03 20 changed event-ID collisions reject CONFLICT without state regression', () => {
  let state = createIncidentState(seed());
  for (let n = 1; n <= 20; n++) state = accepted(commitEvent(state, telemetry(n), producer()));
  for (let n = 1; n <= 20; n++) {
    const event = observation(n);
    rejected(state, { ...event, payload: { ...event.payload, battery_percent: 20 } }, producer(), 'CONFLICT');
  }
  assert.equal(state.telemetry.d1.payload.sim_tick, 20);
});

test('BP03 20 gaps and 20 reused older sequences leave latest/log/cursor unchanged', () => {
  let state = createIncidentState(seed());
  state = accepted(commitEvent(state, telemetry(), producer()));
  for (let n = 0; n < 20; n++) {
    rejected(state, { ...telemetry(n + 3), event_id: `gap${n}` }, producer(), 'STREAM_GAP');
    rejected(state, { ...telemetry(), event_id: `old${n}` }, producer(), 'CONFLICT');
  }
  assert.equal(state.incident_revision, 1);
  assert.equal(state.log.length, 1);
  assert.equal(state.telemetry.d1.payload.sim_tick, 1);
});

test('BP08 explicit server loss freezes 20 mutations, takeover alone advances both epochs', () => {
  let state = accepted(commitEvent(createIncidentState(seed()), telemetry(), producer()));
  rejected(state, telemetry(3), producer(), 'STREAM_GAP');
  state = accepted(commitEvent(state, authority(state, false), context('server')));
  assert.equal(state.authority_active, false);
  assert.equal(state.authority_epoch, 2);
  assert.equal(state.capture_epoch, 1);
  for (let n = 0; n < 20; n++) {
    rejected(state, { ...telemetry(2), authority_epoch: 2, event_id: `frozen${n}` }, producer(), 'FROZEN');
  }
  const take = authority(state, true, 2);
  rejected(state, take, context('human'), 'UNAUTHORIZED');
  rejected(state, { ...take, payload: { ...take.payload, capture_epoch: 1 } }, context('server'), 'STALE_VERSION');
  state = accepted(commitEvent(state, take, context('server')));
  assert.equal(state.authority_active, true);
  assert.equal(state.authority_epoch, 3);
  assert.equal(state.capture_epoch, 2);
  assert.equal(state.producer_id, 'sim2');
  const next = observation(2);
  const newEvent = { ...next, authority_epoch: 3, payload: { ...next.payload, producer_id: 'sim2', capture_epoch: 2 } };
  rejected(state, newEvent, producer(), 'UNAUTHORIZED');
  state = accepted(commitEvent(state, newEvent, producer('sim2', 2)));
  assert.equal(state.telemetry.d1.actor_id, 'sim2');
  assert.equal(state.stream_cursors['telemetry:d1'], 2);
});

test('BP08 20 wrong producer/capture contexts and payloads reject with 0 mutations', () => {
  const state = createIncidentState(seed());
  for (let n = 0; n < 20; n++) {
    const event = observation();
    if (n % 4 === 0) rejected(state, event, producer('sim2'), 'UNAUTHORIZED');
    if (n % 4 === 1) rejected(state, event, producer('sim1', 2), 'UNAUTHORIZED');
    if (n % 4 === 2) rejected(state, { ...event, payload: { ...event.payload, producer_id: 'sim2' } }, producer(), 'UNAUTHORIZED');
    if (n % 4 === 3) rejected(state, { ...event, payload: { ...event.payload, capture_epoch: 2 } }, producer(), 'STALE_VERSION');
  }
  assert.equal(state.incident_revision, 0);
});

test('BP05 24 obsolete proposals (6 run, epoch, input, plan) create 0 actionable intent', () => {
  const state = createIncidentState(seed());
  for (let n = 0; n < 24; n++) {
    const event = intent();
    const input = n < 6 ? { ...event, run_id: 'old-run' }
      : n < 12 ? { ...event, authority_epoch: 0 }
      : n < 18 ? { ...event, payload: { ...event.payload, input_revision: 1 } }
      : { ...event, payload: { ...event.payload, plan_revision: 1 } };
    rejected(state, input, context('analyst'), 'STALE_VERSION');
  }
  assert.equal(Object.keys(state.proposals).length, 0);
  assert.equal(Object.keys(state.commands).length, 0);
  const current = accepted(commitEvent(state, proposal(), context('analyst')));
  assert.equal(current.proposals.p1.kind, 'proposal.created');
  assert.equal(current.input_revision, 0);
});

test('BP05 candidate feasibility, membership, expiry and proposal versions stay bounded', () => {
  const original = seed();
  const state = createIncidentState({ ...original, candidates: original.candidates.map(c => c.candidate_id === 'c2' ? { ...c, feasible: false } : c) });
  const event = intent();
  rejected(state, { ...event, payload: { ...event.payload, candidate_ids: ['unknown'] } }, context('analyst'), 'INVALID_SCHEMA');
  rejected(state, { ...event, payload: { ...event.payload, candidate_ids: ['c2'] } }, context('analyst'), 'STALE_VERSION');
  rejected(state, { ...event, payload: { ...event.payload, expires_at_sim_tick: 1 } }, context('analyst'), 'EXPIRED');
  rejected(state, { ...event, payload: { ...event.payload, expires_at_sim_tick: 121 } }, context('analyst'), 'STALE_VERSION');
  rejected(state, { ...event, payload: { ...event.payload, chief_epoch: 0 } }, context('analyst'), 'STALE_VERSION');
  rejected(state, { ...event, payload: { ...event.payload, reservation_revision: 1 } }, context('analyst'), 'STALE_VERSION');
  const first = accepted(commitEvent(state, event, context('analyst')));
  rejected(first, { ...event, event_id: 'proposal-second', stream_sequence: 2 }, context('analyst'), 'CONFLICT');
  const revised = accepted(commitEvent(first, { ...event, event_id: 'proposal-second', stream_sequence: 2, payload: { ...event.payload, proposal_revision: 2 } }, context('analyst')));
  assert.equal(revised.proposals.p1.payload.proposal_revision, 2);
});

test('BP03 all accepted outputs are deep-frozen copies, all dictionary keys own', () => {
  const original = seed();
  const event = observation();
  const actor = producer();
  const state = accepted(commitEvent(createIncidentState(original), event, actor));
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.seed.assets[0].capabilities));
  assert.ok(Object.isFrozen(state.telemetry));
  assert.ok(Object.isFrozen(state.log));
  assert.ok(Object.isFrozen(state.telemetry.d1.payload.position));
  assert.equal(Object.isFrozen(original), false);
  assert.equal(Object.isFrozen(event), false);
  assert.equal(Object.isFrozen(actor), false);
  assert.notEqual(state.telemetry.d1.payload, event.payload);
  assert.equal(Object.getPrototypeOf(state.stream_cursors), null);
  assert.equal(Object.getPrototypeOf(state.telemetry), null);
  assert.equal(Reflect.set(state.telemetry.d1.payload.position!, 'x_m', 999), false);
  const owned = { ...event, event_id: 'prototype-id', stream_id: '__proto__', payload: { ...event.payload, asset_id: 'constructor' } };
  const registration: IncidentSeed = { ...seed(), assets: seed().assets.map(a => a.asset_id === 'd1' ? { ...a, asset_id: 'constructor' } : a), feeds: seed().feeds.map(f => f.asset_id === 'd1' ? { ...f, asset_id: 'constructor' } : f), candidates: seed().candidates.map(c => c.asset_id === 'd1' ? { ...c, asset_id: 'constructor' } : c) };
  const safe = accepted(commitEvent(createIncidentState(registration), owned, producer()));
  assert.equal(Object.hasOwn(safe.telemetry, 'constructor'), true);
  assert.equal(Object.hasOwn(safe.stream_cursors, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(safe.telemetry), null);
});

test('BP03 20 older captures append history with 0 freshest telemetry/frame regressions', () => {
  const fresh = observation();
  let state = accepted(commitEvent(createIncidentState(seed()), { ...fresh, payload: { ...fresh.payload, sim_tick: 100 } }, producer()));
  const freshFrame = image();
  state = accepted(commitEvent(state, { ...freshFrame, payload: { ...freshFrame.payload, sim_tick: 100 } }, producer()));
  const telemetryLatest = state.telemetry.d1;
  const frameLatest = state.frames.t1;
  for (let n = 2; n <= 21; n++) {
    state = accepted(commitEvent(state, telemetry(n), producer()));
    state = accepted(commitEvent(state, frame(n), producer()));
    assert.deepEqual(state.telemetry.d1, telemetryLatest);
    assert.deepEqual(state.frames.t1, frameLatest);
  }
  assert.equal(state.log.length, 42);
  assert.equal(state.input_revision, 42);
});

test('BP02 registered four thermal and two EO feeds keep 6 wrappers and unknown metadata', () => {
  let state = createIncidentState(seed());
  for (const feed of seed().feeds) {
    const event = image();
    const input = { ...event, event_id: `frame-${feed.feed_id}`, stream_id: `frames:${feed.feed_id}`, payload: {
      ...event.payload, frame_id: `frame-${feed.feed_id}`, evidence_id: `evidence-${feed.feed_id}`,
      feed_id: feed.feed_id, asset_id: feed.asset_id, captured_at: null, capture_time_status: 'unknown', sim_tick: null,
    } };
    state = accepted(commitEvent(state, input, producer()));
  }
  assert.equal(Object.keys(state.frames).length, 6);
  assert.equal(state.seed.feeds.filter(f => f.modality === 'thermal').length, 4);
  for (const value of Object.values(state.frames)) {
    assert.equal(value.payload.captured_at, null);
    assert.equal(value.payload.source_position, null);
    assert.equal(value.payload.location_uncertainty_m, null);
    assert.equal(Object.hasOwn(value.payload, 'temperature_celsius'), false);
    assert.equal(value.actor_kind, 'simulator');
  }
  const event = image();
  rejected(state, { ...event, event_id: 'unregistered-feed', stream_id: 'frames:unknown', payload: { ...event.payload, feed_id: 'unknown' } }, producer(), 'INVALID_SCHEMA');
  rejected(createIncidentState(seed()), { ...event, payload: { ...event.payload, asset_id: 'd2' } }, producer(), 'INVALID_SCHEMA');
  rejected(createIncidentState(seed()), { ...event, payload: { ...event.payload, source_revision: 1 } }, producer(), 'STALE_VERSION');
});

test('BP02 takeover changes capture lease, not immutable source registration or old frames', () => {
  let state = accepted(commitEvent(createIncidentState(seed()), frame(), producer()));
  const before = state.frames.t1;
  state = accepted(commitEvent(state, authority(state, false), context('server')));
  state = accepted(commitEvent(state, authority(state, true, 2), context('server')));
  const event = image(2);
  state = accepted(commitEvent(state, { ...event, authority_epoch: 3, payload: { ...event.payload, capture_owner_id: 'sim2', capture_epoch: 2, sim_tick: 0 } }, producer('sim2', 2)));
  assert.equal(state.frames.t1.actor_id, 'sim2');
  assert.equal(state.frames.t1.payload.sim_tick, 0);
  assert.equal(state.seed.feeds[0].capture_owner_id, 'sim1');
  assert.equal(state.seed.feeds[0].capture_epoch, 1);
  assert.equal(before.actor_id, 'sim1');
});

test('BP07 hypotheses reference only received evidence/snapshots and retain critical unknowns', () => {
  const initial = createIncidentState(seed());
  rejected(initial, hypothesis(0), context('analyst'), 'INVALID_SCHEMA');
  const state = accepted(commitEvent(initial, frame(), producer()));
  const event = hypothesis();
  rejected(state, { ...event, payload: { ...event.payload, source_snapshot_id: 'unknown' } }, context('analyst'), 'INVALID_SCHEMA');
  rejected(state, { ...event, payload: { ...event.payload, evidence_ids: ['unknown'] } }, context('analyst'), 'INVALID_SCHEMA');
  rejected(state, { ...event, payload: { ...event.payload, input_revision: 0 } }, context('analyst'), 'STALE_VERSION');
  const next = accepted(commitEvent(state, event, context('analyst')));
  assert.equal(next.hypotheses.h1.payload.critical, true);
  assert.equal(next.hypotheses.h1.payload.geography, null);
  assert.equal(next.hypotheses.h1.payload.verification_status, 'unverified');
  assert.equal(next.input_revision, 1);
});

test('BP08 permissions/membership checked before duplicates, same-epoch streams cannot be stolen', () => {
  const state = accepted(commitEvent(createIncidentState(seed()), telemetry(), producer()));
  for (const kind of ['fixture', 'human', 'analyst', 'server'] as const) rejected(state, telemetry(), context(kind), 'UNAUTHORIZED');
  rejected(state, telemetry(), { ...producer(), actor: { ...producer().actor, incident_id: 'i2' } }, 'UNAUTHORIZED');
  rejected(state, telemetry(), { ...producer(), actor: { ...producer().actor, run_id: 'r2' } }, 'UNAUTHORIZED');
  rejected(state, { ...telemetry(2), actor_id: 'chief1' }, producer(), 'INVALID_SCHEMA');
  const proposed = accepted(commitEvent(createIncidentState(seed()), proposal(), context('analyst')));
  const analyst2 = context('analyst');
  const event = intent();
  rejected(proposed, { ...event, event_id: 'stolen', stream_sequence: 2, payload: { ...event.payload, proposal_id: 'p2' } }, { ...analyst2, actor: { ...analyst2.actor, principal_id: 'analyst2' } }, 'UNAUTHORIZED');
  rejected(createIncidentState(seed()), { ...telemetry(), stream_id: 'approval:sim1' }, producer(), 'UNAUTHORIZED');
  rejected(createIncidentState(seed()), { ...proposal(), kind: 'approval.committed' }, context('human'), 'INVALID_SCHEMA');
});

test('BP03 10 malformed receipt-clock contexts reject, equal and forward receipt times accepted', () => {
  const state = accepted(commitEvent(createIncidentState(seed()), telemetry(), producer()));
  for (let n = 0; n < 10; n++) rejected(state, telemetry(2), { ...producer(), received_at: n % 2 ? '2026-11-14T00:00:00Z' : '2026-02-30T00:00:01Z' }, 'INVALID_TIME');
  const equal = accepted(commitEvent(state, telemetry(2), producer()));
  const next = accepted(commitEvent(equal, telemetry(3), { ...producer(), received_at: '2026-11-14T00:00:02.000Z' }));
  assert.equal(next.incident_revision, 3);
  rejected(state, telemetry(2), { ...producer(), recorded_at: '2026-11-14T24:00:00Z' }, 'INVALID_TIME');
  rejected(state, telemetry(2), { ...producer(), sim_tick: NaN }, 'INVALID_SCHEMA');
  for (const mode of ['replay', 'offline'] as const) rejected(state, telemetry(2), { ...producer(), mode }, 'FROZEN');
});

test('BP05 server Chief transition advances strictly and invalidates intent, not executor history', () => {
  const first = accepted(commitEvent(createIncidentState(seed()), proposal(), context('analyst')));
  const change: EventInput = { ...telemetry(), event_id: 'chief-change', stream_id: 'server:server1', kind: 'chief.changed', payload: { chief_id: 'chief2', chief_epoch: 2 } };
  rejected(first, change, context('human'), 'UNAUTHORIZED');
  rejected(first, { ...change, payload: { chief_id: 'chief2', chief_epoch: 1 } }, context('server'), 'STALE_VERSION');
  const next = accepted(commitEvent(first, change, context('server')));
  assert.equal(next.chief_id, 'chief2');
  assert.equal(next.chief_epoch, 2);
  assert.equal(Object.keys(next.proposals).length, 0);
  assert.equal(next.log.length, 2);
  rejected(next, { ...intent(), event_id: 'old-chief', stream_sequence: 2 }, context('analyst'), 'STALE_VERSION');
  const currentHuman = context('human');
  const current = { ...currentHuman, actor: { ...currentHuman.actor, principal_id: 'chief2', chief_epoch: 2 } };
  assert.equal(accepted(commitEvent(next, { ...intent(), event_id: 'new-chief', stream_id: 'proposals:chief2', payload: { ...intent().payload, chief_epoch: 2, proposal_revision: 2 } }, current)).proposals.p1.actor_id, 'chief2');
});

test('BP06 sent, delivered, accepted and running never imply completed', () => {
  let state = withCommand();
  for (const [n, stage] of (['sent', 'delivered', 'accepted', 'running'] as const).entries()) {
    state = accepted(commitEvent(state, receipt(stage, n + 1), producer()));
    assert.equal(state.commands['command:a1'].status, stage);
    assert.notEqual(state.commands['command:a1'].status, 'completed');
  }
  assert.equal(state.commands['command:a1'].sent_sim_tick, 1);
  assert.equal(state.log.length, 5);
});

test('BP06 20 receipt duplicates add 0 revisions, 20 bad bindings produce 0 completion', () => {
  let state = withCommand();
  state = accepted(commitEvent(state, receipt(), producer()));
  for (let n = 0; n < 20; n++) assert.equal(accepted(commitEvent(state, receipt(), producer())), state);
  for (let n = 0; n < 20; n++) {
    const event = receipt('completed', 2);
    const payload = n % 5 === 0 ? { ...event.payload, command_id: 'unknown' }
      : n % 5 === 1 ? { ...event.payload, command_version: 2 }
      : n % 5 === 2 ? { ...event.payload, mission_id: 'wrong' }
      : n % 5 === 3 ? { ...event.payload, mission_version: 2 }
      : { ...event.payload, transmission_id: 'wrong' };
    rejected(state, { ...event, payload }, producer(), n % 5 === 0 ? 'INVALID_SCHEMA' : 'STALE_VERSION');
  }
  assert.equal(state.commands['command:a1'].status, 'sent');
  assert.equal(state.log.length, 2);
});

test('BP06 10 terminal-before-ACK cases never regress; unknown evidence cannot complete', () => {
  for (let n = 0; n < 10; n++) {
    let state = withCommand();
    const terminal = receipt(n % 2 ? 'failed' : 'completed');
    state = accepted(commitEvent(state, terminal, producer()));
    const status = state.commands['command:a1'].status;
    for (const [index, stage] of (['sent', 'delivered', 'accepted', 'running'] as const).entries()) {
      state = accepted(commitEvent(state, receipt(stage, index + 2), producer()));
      assert.equal(state.commands['command:a1'].status, status);
    }
    assert.equal(state.log.length, 6);
  }
  const state = withCommand();
  const event = receipt('completed');
  rejected(state, { ...event, payload: { ...event.payload, evidence_ids: ['unknown'] } }, producer(), 'INVALID_SCHEMA');
  rejected(state, { ...event, payload: { ...event.payload, evidence_ids: [] } }, producer(), 'INVALID_SCHEMA');
});

test('BP06 completion after Chief change retains original approved binding and no fake acceptance', () => {
  let state = withCommand();
  const change: EventInput = { ...telemetry(), event_id: 'chief-receipt', stream_id: 'server:server1', kind: 'chief.changed', payload: { chief_id: 'chief2', chief_epoch: 2 } };
  state = accepted(commitEvent(state, change, context('server')));
  state = accepted(commitEvent(state, receipt('completed'), producer()));
  assert.equal(state.commands['command:a1'].status, 'completed');
  assert.equal(state.commands['command:a1'].chief_id, 'chief1');
  assert.equal(state.commands['command:a1'].chief_epoch, 1);
  assert.equal(state.log.filter(e => e.kind === 'command.receipt' && e.payload.stage === 'accepted').length, 0);
  assert.equal(state.commands['command:a1'].sent_sim_tick, null);
});

test('BP06 reused receipt identity conflicts even under a new event ID', () => {
  const state = accepted(commitEvent(withCommand(), receipt(), producer()));
  const event = receipt('completed', 2);
  rejected(state, { ...event, payload: { ...event.payload, receipt_id: 'receipt1' } }, producer(), 'CONFLICT');
});

test('BP03 shallow-frozen caller state/log records cannot alias accepted output', () => {
  const original = accepted(commitEvent(createIncidentState(seed()), frame(), producer()));
  const mutable = structuredClone(original.frames.t1);
  Object.freeze(mutable);
  const caller: IncidentState = { ...original, frames: Object.freeze({ t1: mutable }), log: Object.freeze([mutable]) };
  const before = JSON.stringify(caller);
  const next = accepted(commitEvent(caller, telemetry(), producer()));
  assert.equal(JSON.stringify(caller), before);
  assert.equal(Object.isFrozen(mutable.payload), false);
  assert.notEqual(next.frames.t1.payload, mutable.payload);
  assert.ok(Object.isFrozen(next.frames.t1.payload));
  assert.notEqual(next.log[0], mutable);
  assert.equal(next.frames.t1, next.log[0]);
});

test('BP03 equal-tick older UTC and unknown captures never turn recent receipt into freshness', () => {
  const initial = image();
  let state = accepted(commitEvent(createIncidentState(seed()), initial, producer()));
  const first = state.frames.t1;
  const older = image(2);
  state = accepted(commitEvent(state, { ...older, payload: { ...older.payload, sim_tick: 1, captured_at: '2026-11-14T00:00:00Z' } }, producer()));
  assert.deepEqual(state.frames.t1, first);
  const unknown = image(3);
  state = accepted(commitEvent(state, { ...unknown, payload: { ...unknown.payload, sim_tick: null, captured_at: null, capture_time_status: 'unknown' } }, { ...producer(), received_at: '2026-11-14T01:00:00Z' }));
  assert.deepEqual(state.frames.t1, first);
  const received = state.log.at(-1);
  assert.equal(received?.kind, 'frame.received');
  if (received?.kind === 'frame.received') {
    assert.equal(received.payload.capture_time_status, 'unknown');
    assert.equal(received.payload.captured_at, null);
    assert.equal(received.received_at, '2026-11-14T01:00:00Z');
  }
});
