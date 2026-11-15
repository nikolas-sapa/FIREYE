import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approveProposal, validateCommandAcceptance } from '../state/approval.ts';
import { commitEvent, createIncidentState } from '../state/reducer.ts';
import type {
  ApprovalRequest, Command, CommitContext, EventInput, IncidentSeed, IncidentState, ReceiptStage, RejectionCode, Result,
} from '../protocol/types.ts';
import { approval, context, frame, proposal, seed, telemetry } from './fixtures.ts';

function accepted<T>(result: Result<T>): T {
  if (!result.ok) assert.fail(`${result.code}: ${result.reason}`);
  return result.value;
}

function eligible(initial: IncidentSeed = seed()): IncidentState {
  return accepted(commitEvent(createIncidentState(initial), proposal(), context('analyst')));
}

function request(state: IncidentState, changes: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return { ...approval(state.incident_revision), incident_id: state.incident_id, run_id: state.run_id,
    authority_epoch: state.authority_epoch, input_revision: state.input_revision,
    plan_revision: state.plan_revision, reservation_revision: state.reservation_revision,
    chief_epoch: state.chief_epoch, ...changes };
}

function chiefChange(state: IncidentState): IncidentState {
  return accepted(commitEvent(state, {
    contract_version: state.contract_version, incident_id: state.incident_id, run_id: state.run_id,
    authority_epoch: state.authority_epoch, event_id: 'chief-change1', stream_id: 'chief:server1',
    stream_sequence: 1, trace_id: 'trace-chief1', causation_id: null, kind: 'chief.changed',
    payload: { chief_id: 'chief2', chief_epoch: 2 },
  }, context('server')));
}

function rejected(result: Result<unknown>, code?: RejectionCode): void {
  if (result.ok) assert.fail('Expected rejection');
  if (code) assert.equal(result.code, code);
  assert.ok(result.reason.length > 0);
}

function frozen(state: IncidentState): IncidentState {
  return accepted(commitEvent(state, {
    contract_version: state.contract_version, incident_id: state.incident_id, run_id: state.run_id,
    authority_epoch: state.authority_epoch, event_id: 'producer-loss1', stream_id: 'authority:server1',
    stream_sequence: 1, trace_id: 'trace-loss1', causation_id: null, kind: 'authority.changed',
    payload: { authority_active: false, producer_id: state.producer_id,
      capture_epoch: state.capture_epoch, next_authority_epoch: state.authority_epoch + 1 },
  }, context('server')));
}

function approved(withEvidence = false): { state: IncidentState; command: Command; input: ApprovalRequest } {
  let state = eligible();
  if (withEvidence) {
    state = accepted(commitEvent(createIncidentState(seed()), frame(), context()));
    const current = proposal();
    assert.equal(current.kind, 'proposal.created');
    state = accepted(commitEvent(state, { ...current, payload: { ...current.payload, input_revision: state.input_revision } }, context('analyst')));
  }
  const input = request(state); state = accepted(approveProposal(state, input, context('human')));
  return { state, command: state.commands['command:a1'], input };
}

function receipt(state: IncidentState, command: Command, stage: ReceiptStage, stream_sequence: number): EventInput {
  return {
    contract_version: state.contract_version, incident_id: state.incident_id, run_id: state.run_id,
    authority_epoch: state.authority_epoch, event_id: `receipt-event${stream_sequence}`, stream_id: 'receipts:sim1',
    stream_sequence, trace_id: `trace-receipt${stream_sequence}`, causation_id: command.command_id,
    kind: 'command.receipt', payload: {
      receipt_id: `receipt${stream_sequence}`, command_id: command.command_id, command_version: command.command_version,
      transmission_id: command.transmission_id, mission_id: command.mission_id, mission_version: command.mission_version,
      stage, captured_at: '2026-11-14T00:00:01Z', capture_time_status: 'known', sim_tick: 1,
      producer_id: state.producer_id, capture_epoch: state.capture_epoch,
      reason: stage === 'rejected' ? 'EXERCISE: executor rejected' : null,
      evidence_ids: ['completed', 'failed', 'cancelled'].includes(stage) ? ['evidence1'] : [],
    },
  };
}

test('BP04 one real approval creates exactly one immutable canonical reservation and enqueued command', () => {
  const state = eligible(); const input = request(state); const trusted = context('human');
  const before = JSON.stringify({ state, input, trusted });
  const next = accepted(approveProposal(state, input, trusted));
  assert.equal(JSON.stringify({ state, input, trusted }), before);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(next.incident_revision, state.incident_revision + 1);
  assert.equal(next.reservation_revision, state.reservation_revision + 1);
  assert.equal(Object.keys(next.commands).length, 1);
  assert.equal(Object.keys(next.reservations).length, 1);
  assert.equal(next.log.length, state.log.length + 1);
  assert.equal(next.stream_cursors['approval:chief1'], 1);
  const event = next.log.at(-1)!;
  assert.equal(event.kind, 'approval.committed');
  assert.equal(event.event_id, 'approval:a1');
  assert.equal(event.actor_id, trusted.actor.principal_id);
  assert.equal(event.actor_kind, 'human');
  assert.equal(event.session_id, trusted.actor.session_id);
  assert.equal(event.causation_id, 'p1');
  assert.equal(event.trace_id, 'a1');
  assert.deepEqual(Object.keys(event.payload).sort(), ['command', 'request', 'reservation']);
  const command = next.commands['command:a1'];
  assert.equal(command.command_version, 1);
  assert.equal(command.idempotency_key, command.command_id);
  assert.equal(command.transmission_id, 'command:a1:tx:1');
  assert.equal(command.asset_id, 'd1');
  assert.equal(command.status, 'enqueued');
  assert.equal(command.sent_sim_tick, null);
  assert.equal(command.deadline_sim_tick, 11);
  assert.equal(command.lease_expires_at_sim_tick, 120);
  assert.equal(Object.isFrozen(next), true);
  assert.equal(Object.isFrozen(command), true);
  assert.equal(Object.getPrototypeOf(next.commands), null);
  assert.equal(Object.getPrototypeOf(next.reservations), null);
  const validation = accepted(validateCommandAcceptance(next, command, context()));
  assert.deepEqual(validation, command);
  assert.equal(next.commands[command.command_id].status, 'enqueued');
});

test('BP04 20 serialized distinct approvals at one expected revision yield 1 transition and 19 conflicts', async () => {
  const start = eligible(); let state = start; let transitions = 0; let conflicts = 0;
  const inputs = Array.from({ length: 20 }, (_, n) => request(start, { approval_id: `race${n}` }));
  await Promise.all(inputs.map(async input => {
    const result = approveProposal(state, input, context('human'));
    if (result.ok) { assert.notEqual(result.value, state); state = result.value; transitions++; }
    else { assert.equal(result.code, 'CONFLICT'); conflicts++; }
  }));
  assert.equal(transitions, 1); assert.equal(conflicts, 19);
  assert.equal(Object.keys(state.commands).length, 1);
  assert.equal(Object.keys(state.reservations).length, 1);
  assert.equal(state.incident_revision, start.incident_revision + 1);
  assert.equal(state.log.filter(event => event.kind === 'approval.committed').length, 1);
  for (let n = 0; n < 20; n++) assert.equal(accepted(approveProposal(state, inputs[0], context('human'))), state);
  assert.equal(state.log.length, start.log.length + 1);
});

test('BP04 20 fixture or body-Chief impersonations create zero commands', () => {
  const state = eligible(); const before = JSON.stringify(state);
  for (let n = 0; n < 20; n++) {
    const input = n % 2 ? { ...request(state), chief_id: state.chief_id } : request(state);
    const trusted: CommitContext = n % 2 ? context('human')
      : { ...context('fixture'), actor: { ...context('fixture').actor, principal_id: state.chief_id, chief_epoch: state.chief_epoch } };
    assert.equal(approveProposal(state, input, trusted).ok, false);
  }
  assert.equal(Object.keys(state.commands).length, 0);
  assert.equal(JSON.stringify(state), before);
});

test('BP04 20 former-Chief attempts create zero commands after canonical handoff', () => {
  const state = chiefChange(eligible()); const before = JSON.stringify(state);
  for (let n = 0; n < 20; n++) {
    const trusted = { ...context('human'), actor: { ...context('human').actor,
      chief_epoch: n % 2 ? state.chief_epoch : 1 } };
    const result = approveProposal(state, request(state, { approval_id: `former${n}` }), trusted);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'UNAUTHORIZED');
  }
  assert.equal(Object.keys(state.commands).length, 0);
  assert.equal(JSON.stringify(state), before);
});

test('BP04 exact duplicate returns current state after later facts; changed reuse conflicts and membership stays required', () => {
  const { state, command, input } = approved();
  const later = accepted(commitEvent(state, receipt(state, command, 'delivered', 1), context()));
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  assert.equal(accepted(approveProposal(later, reordered, context('human'))), later);
  rejected(approveProposal(later, { ...input, candidate_id: 'c2' }, context('human')), 'CONFLICT');
  const outsider = { ...context('human'), actor: { ...context('human').actor, incident_id: 'other-incident' } };
  rejected(approveProposal(later, input, outsider), 'UNAUTHORIZED');
  const former = chiefChange(later);
  rejected(approveProposal(former, input, { ...context('human'), actor: { ...context('human').actor, chief_epoch: 2 } }), 'UNAUTHORIZED');
  const newChief = { ...context('human'), actor: { ...context('human').actor, principal_id: 'chief2', chief_epoch: 2 } };
  rejected(approveProposal(former, input, newChief), 'CONFLICT');
  assert.equal(later.incident_revision, state.incident_revision + 1);
  assert.equal(later.log.filter(event => event.kind === 'approval.committed').length, 1);
});

test('BP05 24 obsolete run, authority, input and plan approvals create zero commands after a real received update', () => {
  const start = eligible(); const old = request(start);
  const state = accepted(commitEvent(start, telemetry(), context()));
  const cases: Partial<ApprovalRequest>[] = [{ run_id: 'r0' }, { authority_epoch: 0 },
    { input_revision: old.input_revision }, { plan_revision: 1 }];
  for (const changes of cases) for (let n = 0; n < 6; n++) {
    rejected(approveProposal(state, request(state, { ...changes, approval_id: `stale-${Object.keys(changes)[0]}${n}` }), context('human')), 'STALE_VERSION');
  }
  rejected(approveProposal(state, { ...old, expected_incident_revision: state.incident_revision }, context('human')), 'STALE_VERSION');
  assert.equal(Object.keys(state.commands).length, 0);
  assert.equal(state.reservation_revision, 0);
});

test('BP05 20 expired, offline, replay or frozen approval attempts create zero commands', () => {
  const live = eligible(); const lost = frozen(live);
  for (let n = 0; n < 20; n++) {
    const state = n % 4 === 3 ? lost : live;
    const trusted: CommitContext = { ...context('human'),
      mode: n % 4 === 1 ? 'offline' : n % 4 === 2 ? 'replay' : 'live' };
    const input = request(state, { approval_id: `blocked${n}`, ...(n % 4 === 0 ? { expires_at_sim_tick: 1 } : {}) });
    rejected(approveProposal(state, input, trusted), n % 4 === 0 ? 'EXPIRED' : 'FROZEN');
    assert.equal(Object.keys(state.commands).length, 0);
  }
});

test('BP05 proposal, reservation, Chief and candidate scope bindings reject 10 changed requests', () => {
  const state = eligible();
  const cases: Partial<ApprovalRequest>[] = [{ proposal_revision: 2 }, { proposal_id: 'missing' },
    { reservation_revision: 1 }, { chief_epoch: 2 }, { candidate_id: 'missing' }, { candidate_id: 'c2' },
    { expires_at_sim_tick: 121 }, { incident_id: 'other' }, { expected_incident_revision: 0 }, { input_revision: 1 }];
  for (const changes of cases) rejected(approveProposal(state, request(state, changes), context('human')));
  assert.equal(Object.keys(state.commands).length, 0);
});

test('BP05 approval expiry caps deadline and lease at 5, 10 and 120 ticks without scope extension', () => {
  for (const expiry of [6, 11, 121, 400]) {
    const initial = seed();
    const extended = { ...initial, candidates: initial.candidates.map(candidate => ({ ...candidate, expires_at_sim_tick: 400 })) };
    const initialState = createIncidentState(extended); const event = proposal();
    assert.equal(event.kind, 'proposal.created');
    const state = accepted(commitEvent(initialState, { ...event, payload: { ...event.payload, expires_at_sim_tick: 400 } }, context('analyst')));
    const next = accepted(approveProposal(state, request(state, { expires_at_sim_tick: expiry }), context('human')));
    const command = next.commands['command:a1'];
    assert.equal(command.deadline_sim_tick, Math.min(11, expiry));
    assert.equal(command.lease_expires_at_sim_tick, Math.min(121, expiry));
    assert.equal(Object.values(next.reservations)[0].expires_at_sim_tick, command.lease_expires_at_sim_tick);
  }
});

test('BP06 20 wrong command, mission, transmission, reservation and lease attempts fail acceptance', () => {
  const { state, command } = approved(); const before = JSON.stringify(state);
  const cases: Partial<Command>[] = [{ command_version: 2 }, { mission_id: 'other' }, { transmission_id: 'other' },
    { reservation_revision: 2 }, { lease_expires_at_sim_tick: 121 }];
  for (const changes of cases) for (let n = 0; n < 4; n++) rejected(validateCommandAcceptance(state, { ...command, ...changes }, context()));
  const noReservation = { ...state, reservations: Object.create(null) };
  rejected(validateCommandAcceptance(noReservation, command, context()), 'STALE_VERSION');
  rejected(validateCommandAcceptance(state, command, { ...context(), sim_tick: command.deadline_sim_tick }), 'EXPIRED');
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.commands[command.command_id].status, 'enqueued');
});

test('BP06 acceptance rechecks current Chief/input/plan/authority and designated producer rather than body identity', () => {
  const { state, command } = approved();
  const changedInput = accepted(commitEvent(state, telemetry(), context()));
  const changedChief = chiefChange(state);
  const lost = frozen(state);
  for (const changed of [changedInput, changedChief, { ...state, plan_revision: 1 }, { ...state, authority_epoch: 2 }]) {
    rejected(validateCommandAcceptance(changed, command, context()), 'STALE_VERSION');
  }
  rejected(validateCommandAcceptance(lost, command, context()), 'FROZEN');
  for (const trusted of [context('human'), { ...context(), actor: { ...context().actor, principal_id: 'sim2' } },
    { ...context(), actor: { ...context().actor, capture_epoch: 2 } }, { ...context(), actor: { ...context().actor, run_id: 'r2' } }]) {
    rejected(validateCommandAcceptance(state, command, trusted), 'UNAUTHORIZED');
  }
  for (const mode of ['offline', 'replay'] as const) rejected(validateCommandAcceptance(state, command, { ...context(), mode }), 'FROZEN');
});

test('BP06 real sent, delivered and accepted receipts never imply completed; 20 exact receipts add zero transitions', () => {
  const initial = approved(); let state = initial.state;
  for (const [n, stage] of (['sent', 'delivered', 'accepted'] as const).entries()) {
    const event = receipt(state, initial.command, stage, n + 1);
    state = accepted(commitEvent(state, event, context()));
    assert.equal(state.commands[initial.command.command_id].status, stage);
    assert.notEqual(state.commands[initial.command.command_id].status, 'completed');
    assert.equal(accepted(validateCommandAcceptance(state, state.commands[initial.command.command_id], context())).status, stage);
    if (stage === 'accepted') {
      const revision = state.incident_revision;
      for (let count = 0; count < 20; count++) assert.equal(accepted(commitEvent(state, event, context())), state);
      assert.equal(state.incident_revision, revision);
    }
  }
  assert.equal(state.commands[initial.command.command_id].sent_sim_tick, 1);
});

test('BP06 20 wrong real receipt bindings add zero facts or false completions', () => {
  const { state, command } = approved(); const before = JSON.stringify(state);
  const event = receipt(state, command, 'accepted', 1); assert.equal(event.kind, 'command.receipt');
  const changes = [{ command_id: 'other' }, { command_version: 2 }, { mission_version: 2 },
    { producer_id: 'sim2' }, { transmission_id: 'other' }];
  for (const change of changes) for (let n = 0; n < 4; n++) {
    rejected(commitEvent(state, { ...event, payload: { ...event.payload, ...change } }, context()));
  }
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.commands[command.command_id].status, 'enqueued');
});

test('BP06 10 terminal-before-ACK executions never regress or become newly acceptable', () => {
  const terminals = ['completed', 'failed', 'cancelled', 'rejected'] as const;
  for (let n = 0; n < 10; n++) {
    const { state, command } = approved(true); const stage = terminals[n % terminals.length];
    const terminalState = accepted(commitEvent(state, receipt(state, command, stage, 1), context()));
    const delayed = accepted(commitEvent(terminalState, receipt(terminalState, command, 'accepted', 2), context()));
    assert.equal(delayed.commands[command.command_id].status, stage);
    rejected(validateCommandAcceptance(delayed, delayed.commands[command.command_id], context()), 'CONFLICT');
    assert.equal(delayed.log.at(-1)!.kind, 'command.receipt');
  }
});

test('BP06 Chief handoff blocks new acceptance but preserves actual historical executor completion', () => {
  const { state, command } = approved(true); const changedChief = chiefChange(state);
  rejected(validateCommandAcceptance(changedChief, command, context()), 'STALE_VERSION');
  const completed = accepted(commitEvent(changedChief, receipt(changedChief, command, 'completed', 1), context()));
  assert.equal(completed.commands[command.command_id].status, 'completed');
  assert.equal(completed.commands[command.command_id].chief_id, 'chief1');
  assert.equal(completed.chief_id, 'chief2');
});

test('BP04 live asset and route reservations reject two collisions, expired or terminal leases allow fresh approval', () => {
  function competing(byRoute: boolean): { state: IncidentState; input: ApprovalRequest } {
    const initial = seed();
    const candidates = initial.candidates.map(candidate => candidate.candidate_id === 'c2'
      ? { ...candidate, ...(byRoute ? { route_id: 'route1' } : { asset_id: 'd1' }) } : candidate);
    const state = accepted(approveProposal(eligible({ ...initial, candidates }), approval(), context('human')));
    const event = proposal(); assert.equal(event.kind, 'proposal.created');
    const next = accepted(commitEvent(state, { ...event, event_id: 'proposal-event2', stream_sequence: 2,
      payload: { ...event.payload, proposal_id: 'p2', candidate_ids: ['c2'], reservation_revision: 1 } }, context('analyst')));
    return { state: next, input: request(next, { approval_id: 'a2', proposal_id: 'p2', candidate_id: 'c2' }) };
  }
  for (const byRoute of [false, true]) {
    const { state, input } = competing(byRoute); const before = JSON.stringify(state);
    rejected(approveProposal(state, input, context('human')), 'CONFLICT');
    assert.equal(JSON.stringify(state), before);
    assert.equal(Object.keys(state.commands).length, 1);
    const terminalState = accepted(commitEvent(state, receipt(state, state.commands['command:a1'], 'rejected', 1), context()));
    const next = accepted(approveProposal(terminalState, { ...input, expected_incident_revision: terminalState.incident_revision }, context('human')));
    assert.equal(Object.keys(next.commands).length, 2);
    assert.equal(next.stream_cursors['approval:chief1'], 2);
  }
  const first = eligible(); const short = request(first, { expires_at_sim_tick: 2 });
  const state = accepted(approveProposal(first, short, context('human')));
  const event = proposal(); assert.equal(event.kind, 'proposal.created');
  const next = accepted(commitEvent(state, { ...event, event_id: 'proposal-event2', stream_sequence: 2,
    payload: { ...event.payload, proposal_id: 'p2', reservation_revision: 1 } }, context('analyst')));
  const renewed = accepted(approveProposal(next, request(next, { approval_id: 'a2', proposal_id: 'p2' }), { ...context('human'), sim_tick: 2 }));
  assert.equal(Object.keys(renewed.commands).length, 2);
});

test('BP04 current UTC clocks reject rollback and impossible calendars; malformed context runs zero accessors', () => {
  const state = eligible();
  const invalid = [{ received_at: '2026-11-14T00:00:00Z' }, { recorded_at: '2026-11-14T00:00:00Z' },
    { recorded_at: '2026-02-30T00:00:01Z' }, { received_at: '2026-11-14T00:00:01+00:00' }];
  for (const change of invalid) rejected(approveProposal(state, request(state), { ...context('human'), ...change }), 'INVALID_TIME');
  rejected(approveProposal(state, request(state), { ...context('human'), sim_tick: 0 }), 'STALE_VERSION');
  let accesses = 0;
  const getter = { ...context('human') };
  Object.defineProperty(getter, 'actor', { enumerable: true, get() { accesses++; return context('human').actor; } });
  rejected(approveProposal(state, request(state), getter), 'UNAUTHORIZED');
  const proxy = new Proxy(context('human'), { get() { accesses++; throw new Error('must not execute'); } });
  rejected(approveProposal(state, request(state), proxy), 'UNAUTHORIZED');
  assert.equal(accesses, 0);
  assert.equal(Object.keys(state.commands).length, 0);
});

test('BP06 closed runtime command guard rejects malformed primitive IDs without invoking coercion', () => {
  const { state, command } = approved(); let accesses = 0;
  const coercible = { toString() { accesses++; return command.command_id; } };
  rejected(validateCommandAcceptance(state, { ...command, command_id: coercible } as unknown as Command, context()), 'INVALID_SCHEMA');
  assert.equal(accesses, 0);
  for (const changed of [{ command_version: NaN }, { mission_version: Infinity }, { deadline_sim_tick: -1 },
    { status: 'invented' }, { chief_id: { principal_id: 'chief1' } }]) {
    rejected(validateCommandAcceptance(state, { ...command, ...changed } as unknown as Command, context()), 'INVALID_SCHEMA');
  }
});
