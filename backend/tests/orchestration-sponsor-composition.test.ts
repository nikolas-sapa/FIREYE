import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setImmediate as immediate } from 'node:timers/promises';
import { createExerciseCoordinator, createPlanningSnapshot, exerciseCourseFingerprint } from '../orchestration/coordinator.ts';
import { createBridgeAuthority } from '../integration/session.ts';
import { generateMissionCandidates } from '../planning/mission-candidates.ts';
import { SponsorBudget, serverReceipt } from '../integrations/receipts.ts';
import type { Transport, TransportRequest } from '../integrations/receipts.ts';
import type { BridgeAuthority } from '../integration/session.ts';
import type { IncidentState, Result } from '../protocol/types.ts';
import type { ExerciseLayout, ExerciseSponsorConfig } from '../orchestration/types.ts';
import { context, frame, seed, telemetry } from './fixtures.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const bytes = Buffer.from(png, 'base64');
const wall = Date.parse('2026-11-14T00:00:01Z');
const irisModel = 'projects/exercise/models/iris';
const objective = { objective_id: 'refresh', capture_goal: 'refresh_coverage',
  required_capabilities: ['thermal'], created_at_sim_tick: 1 };

function accepted<T>(result: Result<T>): T {
  assert.ok(result.ok, result.ok ? '' : `${result.code}: ${result.reason}`);
  return result.value;
}

function setup(options: { enabled?: boolean; transport?: Transport; frames?: number; reader?: () => unknown } = {}) {
  const frameCount = options.frames ?? 1;
  const layout: ExerciseLayout = {
    approved_region: { min_x_m: 0, max_x_m: 500, min_y_m: 0, max_y_m: 500 },
    sectors: [{ sector_id: 'sector1', bounds: { min_x_m: 100, max_x_m: 110, min_y_m: 210, max_y_m: 220 },
      evidence_ids: Array.from({ length: frameCount }, (_, n) => `evidence${n + 1}`), coverage_age_ticks: 10 }],
    drones: [{ drone_id: 'd1', home: { x_m: 100, y_m: 200, z_m: 20 }, reserve_units: 100, link_available: true }],
    blocked_areas: [], rights_manifests: { eo1: 'local-png-fixture-permission' },
    policy: { model: 'toy-scalar.v1', snapshot_max_age_ticks: 5, intent_ttl_ticks: 10, route_speed_m_per_tick: 50,
      energy_units_per_m: .001, minimum_reserve_units: 10, wind_m_per_tick: 0, max_wind_m_per_tick: 6,
      separation_m: 1, coverage_altitude_m: 20 },
  };
  let tick = 1; let milliseconds = wall;
  function make(initial = seed()) {
    const result = createBridgeAuthority(initial, () => ({ received_at: new Date(milliseconds).toISOString(), sim_tick: tick }));
    assert.ok(result.ok); const authority = result.value;
    assert.ok(authority.ingest(telemetry(), context().actor).ok);
    for (let n = 1; n <= frameCount; n++) {
      const event = frame(n); assert.equal(event.kind, 'frame.received');
      assert.ok(authority.ingest({ ...event, stream_id: 'frames:eo1', payload: { ...event.payload,
        feed_id: 'eo1', sim_tick: 1, width_px: 1, height_px: 1, byte_length: bytes.length,
        content_hash: createHash('sha256').update(bytes).digest('hex') } }, context().actor).ok);
    }
    return authority;
  }
  const provisional = make();
  const snapshot = accepted(createPlanningSnapshot(provisional, objective, layout));
  const plan = accepted(generateMissionCandidates(snapshot, { incident_id: 'i1', run_id: 'r1',
    input_revision: frameCount + 1, current_sim_tick: 1, mode: 'live', used_intent_ids: [] }));
  const course = plan.options.find(value => value.kind !== 'hold')!;
  const assignment = course.assignments[0]; assert.ok(assignment);
  const candidate = { candidate_id: assignment.candidate_id, action_id: assignment.action_id,
    asset_id: assignment.drone_id, mission_id: assignment.mission_id, mission_version: 1,
    route_id: assignment.route_id, plan_revision: 0, feasibility_snapshot_id: snapshot.snapshot_id,
    feasible: true, expires_at_sim_tick: 11 };
  const authority = make({ ...seed(), candidates: [candidate] });
  let view: (state: IncidentState) => IncidentState = state => state;
  const projectedAuthority: BridgeAuthority = { ...authority, read: () => view(authority.read()) };
  const budget = new SponsorBudget(100, 10_000);
  let calls = 0; let reads = 0;
  const transport: Transport = async request => { calls++; return options.transport ? options.transport(request) : reply(request); };
  const sponsors: ExerciseSponsorConfig = { enabled: options.enabled, authorization_id: 'local-exercise', budget,
    max_call_micro: 100, deadline_ms: 1000,
    iris: { model: irisModel, transport, transport_mode: 'fixture' },
    gemini: { model: 'gemini-2.5-flash', transport, transport_mode: 'fixture' },
    read_evidence: (id, media) => { reads++; assert.match(id, /^evidence\d+$/); assert.match(media, /^media\d+$/);
      return options.reader ? options.reader() : { png_base64: png }; },
  };
  const config = { analyst: context('analyst').actor, layout,
    reviewed_courses: [{ option_id: course.option_id, course_fingerprint: exerciseCourseFingerprint(course), candidate_id: candidate.candidate_id }], sponsors };
  const coordinator = createExerciseCoordinator(projectedAuthority, config);
  return { authority, coordinator, budget, config, calls: () => calls, reads: () => reads,
    changeView: (next: typeof view) => { view = next; },
    advanceWall: () => { milliseconds++; },
    advance: () => { tick++; milliseconds++; return tick; } };
}

function reply(request: TransportRequest): Response {
  const wire = JSON.parse(request.body);
  if (wire.model === irisModel) {
    const ids = Object.keys(wire.questions.ranking.criteria);
    return Response.json({ model: irisModel, answers: { ranking: { choice: ids[0], confidence: 1,
      probabilities: Object.fromEntries(ids.map((id, n) => [id, n === 0 ? 1 : 0])) } } });
  }
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
    hypotheses: [], synthesis: 'insufficient-evidence' }) }] } }] });
}

const analysis = (n = 1) => ({ objective, evidence_id: `evidence${n}` });
function noEffects(authority: BridgeAuthority) {
  assert.equal(Object.keys(authority.read().proposals).length, 0);
  assert.equal(Object.keys(authority.read().reservations).length, 0);
  assert.equal(authority.read().log.filter(row => row.kind === 'approval.committed').length, 0);
  assert.equal(Object.keys(authority.read().commands).length, 0);
}

test('OR03-S01 600 disabled ticks finish independently with zero jobs, readers, transports or reservations', async () => {
  const fixture = setup(); const pending = [];
  for (let n = 0; n < 600; n++) {
    assert.equal(fixture.advance(), n + 2);
    assert.ok(fixture.authority.heartbeat(context().actor).ok);
    pending.push(fixture.coordinator.analyzeEvidence(analysis()));
    fixture.coordinator.refresh();
  }
  assert.equal(pending.length, 600);
  assert.equal((await Promise.all(pending)).filter(r => !r.ok && r.code === 'DISABLED').length, 600);
  assert.deepEqual(fixture.coordinator.sponsorCounts(), { in_flight: 0, queued: 0, retained: 0 });
  assert.equal(fixture.calls(), 0); assert.equal(fixture.reads(), 0);
  assert.deepEqual(fixture.budget.usage(), { calls: 0, reserved_micro: 0 });
  noEffects(fixture.authority);
  const unchanged = setup();
  const defaultCoordinator = createExerciseCoordinator(unchanged.authority, { ...unchanged.config, sponsors: undefined });
  const assessment = accepted(await defaultCoordinator.assess(objective));
  assert.equal(assessment.ranking.reason, 'DISABLED');
  assert.deepEqual(defaultCoordinator.sponsorCounts(), { in_flight: 0, queued: 0, retained: 0 });
});

test('OR03-S02 20 duplicate received snapshots use one actual Iris and one Gemini transport/reservation', async () => {
  const f = setup({ enabled: true });
  const rankings = await Promise.all(Array.from({ length: 20 }, () => f.coordinator.assess(objective)));
  for (const value of rankings) {
    const assessment = accepted(value); assert.equal(assessment.ranking.source, 'validated-ranking');
    assert.ok(serverReceipt(assessment.ranking.receipt)); assert.equal(assessment.ranking.receipt.provenance, 'fixture');
  }
  const values = await Promise.all(Array.from({ length: 20 }, () => {
    f.advanceWall(); return f.coordinator.analyzeEvidence(analysis());
  }));
  assert.equal(values.filter(value => value.ok).length, 20);
  assert.equal(new Set(values.map(value => value.receipt?.receipt_id)).size, 1);
  assert.equal(f.calls(), 2); assert.equal(f.reads(), 1);
  assert.deepEqual(f.budget.usage(), { calls: 2, reserved_micro: 200 });
  for (const value of values) {
    assert.ok(value.ok); assert.equal(value.value.verification_status, 'unverified');
    assert.equal(value.receipt?.fresh_provider_call, false); assert.ok(serverReceipt(value.receipt));
    assert.deepEqual(value.value.evidence_ids, ['evidence1']);
  }
  noEffects(f.authority);
});

test('OR02-S03 20 late stale/wrong-run/frozen results and replay attempts add zero jobs or effects', async () => {
  for (let n = 0; n < 20; n++) {
    const releases: (() => void)[] = [];
    const f = setup({ enabled: true, transport: request => new Promise(resolve => releases.push(() => resolve(reply(request)))) });
    const pending = f.coordinator.analyzeEvidence(analysis());
    await immediate(); assert.equal(f.calls(), 1);
    if (n % 3 === 0) assert.ok(f.authority.ingest(telemetry(2), context().actor).ok);
    if (n % 3 === 1) f.changeView(state => ({ ...state, run_id: 'wrong-run' }));
    if (n % 3 === 2) f.changeView(state => ({ ...state, authority_active: false }));
    releases.splice(0).forEach(release => release());
    const result = await pending; assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'STALE');
    assert.equal((await f.coordinator.analyzeEvidence({ ...analysis(), mode: n % 2 ? 'replay' : 'offline' })).ok, false);
    const replay = await f.coordinator.analyzeEvidence({ ...analysis(), run_id: 'r1' }); assert.equal(replay.ok, false);
    assert.equal(f.calls(), 1); assert.deepEqual(f.budget.usage(), { calls: 1, reserved_micro: 100 });
    assert.equal(f.coordinator.sponsorCounts().retained, 1);
    noEffects(f.authority);
  }
});

test('OR03-S04 Iris and Gemini share exactly 2 in-flight/8 queued slots and reject the eleventh job', async () => {
  const releases: (() => void)[] = [];
  let active = 0; let peak = 0;
  const f = setup({ enabled: true, frames: 10, transport: request => {
    active++; peak = Math.max(peak, active);
    return new Promise(resolve => releases.push(() => { active--; resolve(reply(request)); }));
  } });
  const ranking = f.coordinator.assess(objective);
  const analyses = Array.from({ length: 9 }, (_, n) => f.coordinator.analyzeEvidence(analysis(n + 1)));
  assert.deepEqual(f.coordinator.sponsorCounts(), { in_flight: 2, queued: 8, retained: 10 });
  const overflow = await f.coordinator.analyzeEvidence(analysis(10));
  assert.equal(overflow.ok, false); if (!overflow.ok) assert.equal(overflow.code, 'QUEUE_FULL');
  assert.deepEqual(f.budget.usage(), { calls: 2, reserved_micro: 200 });
  for (let n = 0; n < 10; n++) { await immediate(); releases.splice(0).forEach(release => release()); }
  assert.ok((await ranking).ok);
  assert.equal((await Promise.all(analyses)).filter(value => value.ok).length, 9);
  await immediate();
  assert.equal(peak, 2); assert.equal(f.calls(), 10);
  assert.deepEqual(f.budget.usage(), { calls: 10, reserved_micro: 1000 });
  assert.deepEqual(f.coordinator.sponsorCounts(), { in_flight: 0, queued: 0, retained: 10 });
  noEffects(f.authority);
});

test('OR04-S05 20 actual model inputs expose zero simulator-truth/future keys', async () => {
  let checked = 0;
  function inspect(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key, /truth|future|hidden|forecast|mask|detection/i); inspect(child);
    }
  }
  for (let n = 0; n < 20; n++) {
    const f = setup({ enabled: true, transport: async request => {
      assert.deepEqual(request.headers, { 'Content-Type': 'application/json' });
      const wire = JSON.parse(request.body); inspect(wire); checked++;
      if (wire.state) assert.deepEqual(Object.keys(wire.state).sort(), ['authority_epoch', 'evidence', 'incident_id',
        'input_revision', 'received_cutoff_ms', 'run_id', 'snapshot_id', 'valid_until_ms']);
      else {
        assert.deepEqual(wire.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: png } });
        const metadata = JSON.parse(wire.contents[0].parts[0].text.split('Received metadata: ')[1]);
        inspect(metadata);
        assert.deepEqual(Object.keys(metadata).sort(), ['byte_length', 'calibration', 'captured_at_ms', 'content_hash',
          'evidence_id', 'height_px', 'modality', 'radiometric', 'received_at_ms', 'rights_manifest_id',
          'source_id', 'source_kind', 'synthetic', 'width_px']);
      }
      return reply(request);
    } });
    f.changeView(state => ({ ...state, simulator_truth: ['untrusted-hidden-label'], future_positions: [999] }));
    assert.ok(n % 2 ? (await f.coordinator.assess(objective)).ok : (await f.coordinator.analyzeEvidence(analysis())).ok);
    noEffects(f.authority);
  }
  assert.equal(checked, 20);
});

test('OR03-S07 queue-full analysis can be retried after the shared queue drains', async () => {
  const releases: (() => void)[] = [];
  const f = setup({ enabled: true, frames: 10, transport: request =>
    new Promise(resolve => releases.push(() => resolve(reply(request)))) });
  const ranking = f.coordinator.assess(objective);
  const analyses = Array.from({ length: 9 }, (_, n) => f.coordinator.analyzeEvidence(analysis(n + 1)));
  assert.deepEqual(f.coordinator.sponsorCounts(), { in_flight: 2, queued: 8, retained: 10 });
  const full = await f.coordinator.analyzeEvidence(analysis(10));
  assert.equal(full.ok, false); if (!full.ok) assert.equal(full.code, 'QUEUE_FULL');
  for (let n = 0; n < 10; n++) { await immediate(); releases.splice(0).forEach(release => release()); }
  assert.ok((await ranking).ok); assert.ok((await Promise.all(analyses)).every(value => value.ok));
  await immediate(); assert.equal(f.coordinator.sponsorCounts().in_flight, 0);
  const retry = f.coordinator.analyzeEvidence(analysis(10));
  await immediate(); releases.splice(0).forEach(release => release());
  const result = await retry;
  assert.ok(result.ok, result.ok ? '' : result.code);
  assert.equal(f.calls(), 11); assert.deepEqual(f.budget.usage(), { calls: 11, reserved_micro: 1100 });
  noEffects(f.authority);
});

test('OR03-S06 unknown evidence, wrong bytes, extra fields and unknown clocks invoke zero transports', async () => {
  const f = setup({ enabled: true, reader: () => ({ png_base64: 'not-png' }) });
  assert.equal((await f.coordinator.analyzeEvidence(analysis(99))).ok, false);
  assert.equal((await f.coordinator.analyzeEvidence({ ...analysis(), png_base64: png })).ok, false);
  assert.equal((await f.coordinator.analyzeEvidence(analysis())).ok, false);
  assert.equal(f.calls(), 0); assert.deepEqual(f.budget.usage(), { calls: 0, reserved_micro: 0 });
  const thermal = setup({ enabled: true });
  thermal.changeView(state => ({ ...state, log: state.log.map(row => row.kind === 'frame.received'
    ? { ...row, payload: { ...row.payload, captured_at: null, capture_time_status: 'unknown', sim_tick: null } } : row) }));
  assert.equal((await thermal.coordinator.analyzeEvidence(analysis())).ok, false);
  assert.equal(thermal.calls(), 0); noEffects(f.authority); noEffects(thermal.authority);
});
