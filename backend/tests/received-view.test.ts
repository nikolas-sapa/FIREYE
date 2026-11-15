import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReceivedView } from '../integration/received-view.ts';
import { createBridgeAuthority } from '../integration/session.ts';
import { createIncidentState, commitEvent } from '../state/index.ts';
import type { EventInput, Result } from '../protocol/types.ts';
import { seed, context, frame, proposal, telemetry } from './fixtures.ts';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

test('B06 20 frame views preserve clocks, 10 unknowns and 10 duplicates add 0 revisions', () => {
  const created = createBridgeAuthority(seed(), () => ({ received_at: context().received_at, sim_tick: 1 }));
  assert.equal(created.ok, true); if (!created.ok) return;
  const authority = created.value;
  for (let n = 1; n <= 20; n++) {
    const event = frame(n); assert.equal(event.kind, 'frame.received'); if (event.kind !== 'frame.received') return;
    const input = n <= 10 ? { ...event, payload: { ...event.payload, captured_at: null, capture_time_status: 'unknown' as const } } : event;
    assert.equal(authority.ingest(input, context().actor).ok, true);
    const view = unwrap(createReceivedView(authority.read(), context().received_at));
    assert.deepEqual(view.frames.t1.payload, input.payload);
    assert.deepEqual(Object.keys(view.frames.t1).sort(), ['incident_revision', 'payload', 'received_at']);
    assert.equal(view.coordinate_frame, null); assert.equal(view.media_verified, false);
    assert.equal(view.feeds[0].synthetic, true); assert.equal(view.feeds[0].calibration, null);
    assert.equal(view.frames.t1.payload.source_position, null);
    if (n <= 10) assert.equal(authority.ingest(input, context().actor).ok, true);
    assert.equal(authority.read().incident_revision, n);
    const encoded = JSON.stringify(view);
    for (const privateField of ['actor_id', 'session_id', 'trace_id', 'seed', 'chief_id', 'temperature', 'confidence']) {
      assert.equal(Object.hasOwn(view, privateField), false);
      assert.equal(encoded.includes(`"${privateField}":`), false);
    }
  }
});

test('B06 10 unresolved critical hypotheses survive aging with 0 invented geography/scores', () => {
  let state = unwrap(commitEvent(createIncidentState(seed()), frame(), context()));
  for (let n = 1; n <= 10; n++) {
    const event: EventInput = { ...frame(), event_id: `hyp${n}`, stream_id: 'hypotheses:analyst1', stream_sequence: n,
      kind: 'hypothesis.received', payload: { hypothesis_id: `h${n}`, kind: 'human', verification_status: 'unverified',
        evidence_ids: ['evidence1'], source_snapshot_id: 'snapshot1', input_revision: 1, geography: null,
        location_uncertainty_m: null, model_score: null, contradictions: [], critical: true } };
    state = unwrap(commitEvent(state, event, context('analyst')));
  }
  const view = unwrap(createReceivedView(state, '2026-11-15T00:00:00Z'));
  assert.equal(Object.keys(view.hypotheses).length, 10);
  for (const value of Object.values(view.hypotheses)) {
    assert.equal(value.payload.critical, true); assert.equal(value.payload.geography, null);
    assert.equal(value.payload.model_score, null); assert.equal(value.payload.verification_status, 'unverified');
  }
});

test('B06 2 cutoffs exclude future proposals and stale proposals yield 0 review options', () => {
  let state = unwrap(commitEvent(createIncidentState(seed()), proposal(), context('analyst')));
  const later = { ...context(), received_at: '2026-11-14T00:00:02Z', recorded_at: '2026-11-14T00:00:02Z' };
  state = unwrap(commitEvent(state, telemetry(), later));
  const before = unwrap(createReceivedView(state, '2026-11-14T00:00:00Z'));
  assert.equal(before.proposals.length, 0); assert.equal(before.candidates.length, 0);
  const atProposal = unwrap(createReceivedView(state, context().received_at));
  assert.equal(atProposal.proposals.length, 1); assert.equal(atProposal.candidates.length, 1);
  const current = unwrap(createReceivedView(state, later.received_at));
  assert.equal(current.proposals.length, 0); assert.equal(current.candidates.length, 0);
  assert.equal(current.incident_revision, 2);
});

test('B06 corrupt future suffix rejects even an earlier receipt cutoff', () => {
  const state = unwrap(commitEvent(createIncidentState(seed()), frame(), context()));
  const corrupt = { ...state, log: [{ ...state.log[0], incident_revision: 7 }] };
  assert.equal(createReceivedView(corrupt, '2026-11-14T00:00:00Z').ok, false);
  assert.equal(createReceivedView(state, '2026-02-30T00:00:00Z').ok, false);
});

test('B04 current tick121 exposes 0 expired options, historical tick1 retains 1', () => {
  const state = unwrap(commitEvent(createIncidentState(seed()), proposal(), context('analyst')));
  const live = unwrap(createReceivedView(state, context().received_at, 121));
  assert.equal(live.proposals.length, 0); assert.equal(live.candidates.length, 0);
  const historical = unwrap(createReceivedView(state, context().received_at));
  assert.equal(historical.proposals.length, 1); assert.equal(historical.candidates.length, 1);
  for (const tick of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(createReceivedView(state, context().received_at, tick).ok, false);
  }
  assert.equal(createReceivedView(state, context().received_at, 0).ok, false);
});
