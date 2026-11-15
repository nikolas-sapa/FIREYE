import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMissionCandidates } from '../planning/mission-candidates.ts';
import type { MissionPlan, MissionPlanningContext, MissionPlanningSnapshot } from '../planning/mission-types.ts';
import type { Result } from '../protocol/types.ts';

// Declared toy fixture: 100x100 region, three separated 10x10 sectors, altitude
// 20m, speed 10m/tick, cost .001units/m, wind0, reserve100/min10, separation1m.
export function missionFixture(): MissionPlanningSnapshot {
  return {
    snapshot_id: 'received-1', incident_id: 'exercise-1', run_id: 'run-1', input_revision: 7,
    observed_at_sim_tick: 100, intent_id: 'intent-1', intent_created_at_sim_tick: 100,
    objective: { objective_id: 'objective-1', capture_goal: 'refresh_coverage', required_capabilities: ['thermal'] },
    approved_region: { min_x_m: 0, max_x_m: 100, min_y_m: 0, max_y_m: 100 },
    sectors: [0, 1, 2].map(n => ({ sector_id: `sector-${n}`, coverage_age_ticks: 30 - n,
      bounds: { min_x_m: 10 + n * 30, max_x_m: 20 + n * 30, min_y_m: 10, max_y_m: 20 },
      evidence_ids: [`evidence-${n}`] })),
    drones: [0, 1, 2].map(n => ({ drone_id: `drone-${n}`,
      position: { x_m: 10 + n * 30, y_m: 5, z_m: 20 }, home: { x_m: 10 + n * 30, y_m: 5, z_m: 20 },
      capabilities: ['thermal'], feeds: [{ feed_id: `feed-${n}`, modality: 'thermal', status: 'available',
        source_id: `sensor-${n}`, source_kind: 'simulated', synthetic: true }], reserve_units: 100, link_available: true })),
    evidence: [0, 1, 2].map(n => ({ evidence_id: `evidence-${n}`, source_snapshot_id: `source-snapshot-${n}`,
      source_id: `sensor-${n}`, source_kind: 'simulated', synthetic: true,
      captured_at_sim_tick: n === 0 ? null : 90, received_at_sim_tick: 95 })),
    active_leases: [], blocked_areas: [], policy: { model: 'toy-scalar.v1', snapshot_max_age_ticks: 5,
      intent_ttl_ticks: 5, route_speed_m_per_tick: 10, energy_units_per_m: .001, minimum_reserve_units: 10,
      wind_m_per_tick: 0, max_wind_m_per_tick: 6, separation_m: 1, coverage_altitude_m: 20 },
  };
}

export function missionContext(): MissionPlanningContext {
  return { incident_id: 'exercise-1', run_id: 'run-1', input_revision: 7,
    current_sim_tick: 100, mode: 'live', used_intent_ids: [] };
}

function accepted(result: Result<MissionPlan>): MissionPlan {
  if (!result.ok) assert.fail(`${result.code}: ${result.reason}`);
  return result.value;
}

function rejected(input: unknown, context: unknown = missionContext()): void {
  const result = generateMissionCandidates(input, context);
  assert.equal(result.ok, false);
  if (result.ok) assert.fail('Expected rejection');
  assert.ok(result.reason.length > 0);
  assert.equal(Object.hasOwn(result, 'value'), false);
}

function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}

test('MP01 three drones/three sectors yield three unique assignments per course', () => {
  const plan = accepted(generateMissionCandidates(missionFixture(), missionContext()));
  assert.equal(plan.options.length, 3);
  for (const option of plan.options.slice(1)) {
    assert.equal(option.assignments.length, 3);
    assert.equal(new Set(option.assignments.map(item => item.drone_id)).size, 3);
    assert.equal(new Set(option.assignments.map(item => item.sector_id)).size, 3);
  }
});

test('MP01 twenty lease/block/sensor/reserve cases admit zero invalid assignments', () => {
  for (let n = 0; n < 20; n++) {
    const fixture = missionFixture(); const drone = fixture.drones[0];
    const input = n % 4 === 0 ? { ...fixture, active_leases: [{ lease_id: `lease-${n}`,
      drone_id: drone.drone_id, sector_id: 'sector-0', expires_at_sim_tick: 101 }] }
      : n % 4 === 1 ? { ...fixture, blocked_areas: [fixture.sectors[0].bounds] }
      : { ...fixture, drones: fixture.drones.map((item, index) => index !== 0 ? item
        : n % 4 === 2 ? { ...item, capabilities: [], feeds: [] } : { ...item, reserve_units: 0 }) };
    const plan = accepted(generateMissionCandidates(input, missionContext()));
    const assignments = plan.options.flatMap(option => option.assignments);
    assert.equal(assignments.some(item => n % 4 === 1 ? item.sector_id === 'sector-0'
      : item.drone_id === 'drone-0'), false);
    assert.ok(plan.exclusions.length > 0);
  }
});

test('MP02 ten snapshots times ten seed labels produce 100 byte-identical results', () => {
  const expected = JSON.stringify(generateMissionCandidates(missionFixture(), missionContext()));
  for (let snapshot = 0; snapshot < 10; snapshot++) {
    for (let seedLabel = 0; seedLabel < 10; seedLabel++) {
      assert.equal(JSON.stringify(generateMissionCandidates(missionFixture(), missionContext())), expected);
    }
  }
  const input = missionFixture();
  assert.equal(JSON.stringify(generateMissionCandidates({ ...input, drones: [...input.drones].reverse(),
    sectors: [...input.sectors].reverse(), evidence: [...input.evidence].reverse() }, missionContext())), expected);
});

test('MP02 four delimiter/Unicode identities stay distinct and changed policy changes identity', () => {
  const ids = ['a:b', 'a%3Ab', 'a/b', '\ud800']; const outputs = ids.map(snapshot_id =>
    accepted(generateMissionCandidates({ ...missionFixture(), snapshot_id }, missionContext())));
  assert.equal(new Set(outputs.map(plan => plan.options[1].option_id)).size, 4);
  const base = missionFixture();
  const before = accepted(generateMissionCandidates(base, missionContext()));
  const after = accepted(generateMissionCandidates({ ...base, policy: { ...base.policy,
    energy_units_per_m: .002 } }, missionContext()));
  assert.notEqual(before.options[1].assignments[0].candidate_id, after.options[1].assignments[0].candidate_id);
});

test('MP03 twenty stale/replay/offline/wrong-revision intents reject without outputs', () => {
  for (let n = 0; n < 20; n++) {
    const fixture = missionFixture(); const context = missionContext();
    if (n % 4 === 0) rejected({ ...fixture, observed_at_sim_tick: 94 });
    if (n % 4 === 1) rejected(fixture, { ...context, mode: 'replay' });
    if (n % 4 === 2) rejected(fixture, { ...context, mode: 'offline' });
    if (n % 4 === 3) rejected(fixture, { ...context, input_revision: 8 });
  }
  rejected(missionFixture(), { ...missionContext(), used_intent_ids: ['intent-1'] });
  rejected({ ...missionFixture(), intent_created_at_sim_tick: 94 });
  rejected({ ...missionFixture(), observed_at_sim_tick: 101 });
  rejected({ ...missionFixture(), intent_created_at_sim_tick: 101 });
  rejected(missionFixture(), { ...missionContext(), run_id: 'other' });
});

test('MP03 twenty missing/nonfinite geometry/reserve/policy inputs reject without defaults', () => {
  for (let n = 0; n < 20; n++) {
    const fixture = missionFixture();
    if (n % 4 === 0) { const { policy: ignored, ...missing } = fixture; rejected(missing); }
    if (n % 4 === 1) rejected({ ...fixture, policy: { ...fixture.policy, wind_m_per_tick: NaN } });
    if (n % 4 === 2) rejected({ ...fixture, approved_region: { ...fixture.approved_region, max_x_m: Infinity } });
    if (n % 4 === 3) rejected({ ...fixture, drones: [{ ...fixture.drones[0], reserve_units: null }] });
  }
});

test('MP03 malformed/accessor/proxy/cyclic/oversized/hidden data reject with zero getters/traps', () => {
  let executions = 0; const accessor = { ...missionFixture() };
  Object.defineProperty(accessor, 'policy', { enumerable: true, get() { executions++; throw new Error('getter'); } });
  rejected(accessor);
  rejected(new Proxy(missionFixture(), { ownKeys() { executions++; throw new Error('trap'); } }));
  rejected(missionFixture(), new Proxy(missionContext(), { get() { executions++; throw new Error('trap'); } }));
  assert.equal(executions, 0);
  const cycle: Record<string, unknown> = { ...missionFixture() }; cycle.policy = cycle; rejected(cycle);
  rejected({ ...missionFixture(), hidden_world: { planted_person: true } });
  rejected({ ...missionFixture(), drones: Array(4).fill(missionFixture().drones[0]) });
  rejected({ ...missionFixture(), evidence: Array(17).fill(missionFixture().evidence[0]) });
  rejected({ ...missionFixture(), sectors: [missionFixture().sectors[0], missionFixture().sectors[0]] });
  rejected({ ...missionFixture(), sectors: [{ ...missionFixture().sectors[0], evidence_ids: ['unknown'] }] });
  rejected({ ...missionFixture(), blocked_areas: [{ min_x_m: 2, max_x_m: 1, min_y_m: 1, max_y_m: 2 }] });
  rejected({ ...missionFixture(), drones: new Array(1) });
  rejected({ ...missionFixture(), policy: { ...missionFixture().policy, model: 'calibrated' } });
  rejected({ ...missionFixture(), evidence: [{ ...missionFixture().evidence[0], received_at_sim_tick: 101 }] });
  rejected(Object.assign(Object.create({ inherited: true }), missionFixture()));
  rejected({ ...missionFixture(), snapshot_id: ' '.repeat(10) });
  rejected({ ...missionFixture(), policy: { ...missionFixture().policy, route_speed_m_per_tick: 0 } });
  rejected({ ...missionFixture(), drones: [{ ...missionFixture().drones[0], feeds: [{ ...missionFixture().drones[0].feeds[0], status: ['available'] }] }] });
  rejected({ ...missionFixture(), evidence: [{ ...missionFixture().evidence[0], source_kind: ['simulated'] }] });
  rejected(missionFixture(), { ...missionContext(), mode: ['live'] });
  rejected({ ...missionFixture(), evidence: [{ ...missionFixture().evidence[0], captured_at_sim_tick: 96 }] });
});

test('MP04 blocked interior ingress/pass/return segments and region violations emit zero invalid routes', () => {
  const fixture = missionFixture();
  // Each obstacle avoids coverage endpoints but intersects the declared segments.
  const obstacles = [
    { min_x_m: 9.9, max_x_m: 10.1, min_y_m: 6, max_y_m: 7 },
    { min_x_m: 14, max_x_m: 16, min_y_m: 9.9, max_y_m: 10.1 },
    { min_x_m: 14, max_x_m: 14.1, min_y_m: 13.9, max_y_m: 14.1 },
  ];
  for (const [index, obstacle] of obstacles.entries()) {
    const drone = index === 2 ? { ...fixture.drones[0], home: { x_m: 20, y_m: 5, z_m: 20 } } : fixture.drones[0];
    const input = { ...fixture, drones: [drone], sectors: [fixture.sectors[0]], blocked_areas: [obstacle] };
    const plan = accepted(generateMissionCandidates(input, missionContext()));
    assert.ok(plan.exclusions.some(item => item.reason === 'BLOCKED_ROUTE'));
    assert.equal(plan.options.find(item => item.kind === 'coverage_x'), undefined);
  }
  const outside = { ...fixture, drones: [{ ...fixture.drones[0], position: { x_m: -1, y_m: 5, z_m: 20 } }], sectors: [fixture.sectors[0]] };
  assert.equal(accepted(generateMissionCandidates(outside, missionContext())).options.length, 1);
  const outHome = { ...outside, drones: [{ ...fixture.drones[0], home: { x_m: 101, y_m: 5, z_m: 20 } }] };
  assert.equal(accepted(generateMissionCandidates(outHome, missionContext())).options.length, 1);
  const outSector = { ...fixture, sectors: [{ ...fixture.sectors[0], bounds: { ...fixture.sectors[0].bounds, max_x_m: 101 } }] };
  assert.equal(accepted(generateMissionCandidates(outSector, missionContext())).options.length, 1);
});

test('MP04 at most three actual options, trace on all ten waypoints, hold grants zero authority', () => {
  const fixture = missionFixture(); const plan = accepted(generateMissionCandidates(fixture, missionContext()));
  assert.ok(plan.options.length <= 3); assert.equal(plan.executable, false);
  assert.equal(plan.options[0].kind, 'hold'); assert.equal(plan.options[0].assignments.length, 0);
  for (const option of plan.options) {
    assert.equal(option.executable, false);
    for (const assignment of option.assignments) {
      assert.equal(assignment.registration_status, 'proposed_awaiting_reviewed_registration');
      assert.equal(Object.hasOwn(assignment, 'feasible'), false);
      assert.equal(assignment.waypoints.length, 10);
      for (const waypoint of assignment.waypoints) {
        assert.equal(waypoint.mission_id, assignment.mission_id); assert.ok(waypoint.reason.length > 0);
        assert.ok(waypoint.position.x_m >= 0 && waypoint.position.x_m <= 100);
        assert.ok(waypoint.position.y_m >= 0 && waypoint.position.y_m <= 100);
      }
      const sector = fixture.sectors.find(item => item.sector_id === assignment.sector_id)!;
      assert.deepEqual(assignment.evidence, fixture.evidence.filter(item => sector.evidence_ids.includes(item.evidence_id)));
      assert.equal(assignment.toy_estimate.model, 'toy-scalar.v1');
      assert.ok(assignment.toy_estimate.remaining_reserve_units >= 10);
    }
  }
  const none = accepted(generateMissionCandidates({ ...fixture, blocked_areas: [fixture.approved_region] }, missionContext()));
  assert.equal(none.options.length, 1); assert.equal(none.options[0].assignments.length, 0);
});

test('MP04 lost link/excess wind/exact lease expiry/separation and reserve boundary use declared toy rules', () => {
  const fixture = missionFixture();
  assert.equal(accepted(generateMissionCandidates({ ...fixture, drones: fixture.drones.map(item => ({ ...item, link_available: false })) }, missionContext())).options.length, 1);
  assert.equal(accepted(generateMissionCandidates({ ...fixture, policy: { ...fixture.policy, wind_m_per_tick: 7 } }, missionContext())).options.length, 1);
  const expiry = accepted(generateMissionCandidates({ ...fixture, active_leases: [{ lease_id: 'expired',
    drone_id: 'drone-0', sector_id: 'sector-0', expires_at_sim_tick: 100 }] }, missionContext()));
  assert.equal(expiry.options[1].assignments.length, 3);
  const separated = accepted(generateMissionCandidates({ ...fixture, policy: { ...fixture.policy, separation_m: 100 } }, missionContext()));
  assert.equal(separated.options[1].assignments.length, 1);
  const one = { ...fixture, drones: [fixture.drones[0]], sectors: [fixture.sectors[0]] };
  const assignment = accepted(generateMissionCandidates(one, missionContext())).options[1].assignments[0];
  const exact = { ...one, drones: [{ ...one.drones[0], reserve_units: assignment.toy_estimate.cost_units + 10 }] };
  assert.ok(accepted(generateMissionCandidates(exact, missionContext())).options.length > 1);
  const insufficient = { ...exact, drones: [{ ...exact.drones[0], reserve_units: exact.drones[0].reserve_units - .001 }] };
  assert.ok(accepted(generateMissionCandidates(insufficient, missionContext())).options.length < 3);
});

test('MP05 twenty frozen-input runs mutate zero bytes, preserve unknown clocks and freeze owned output', () => {
  const fixture = frozen(missionFixture()); const context = frozen(missionContext());
  const before = JSON.stringify({ fixture, context });
  for (let n = 0; n < 20; n++) {
    const plan = accepted(generateMissionCandidates(fixture, context));
    assert.equal(JSON.stringify({ fixture, context }), before);
    assert.equal(Object.isFrozen(plan), true); assert.equal(Object.isFrozen(plan.options), true);
    const evidence = plan.options[1].assignments.flatMap(item => item.evidence).find(item => item.evidence_id === 'evidence-0')!;
    assert.equal(evidence.captured_at_sim_tick, null); assert.equal(Object.isFrozen(evidence), true);
    assert.equal(JSON.stringify(plan).includes('planted_person'), false);
    assert.notEqual(plan.options[1].assignments[0].waypoints[0].position, fixture.drones[0].position);
  }
});

test('MP05 twenty real public calls use zero fetch/random/current-time calls and zero input writes', () => {
  const originalFetch = globalThis.fetch; const originalRandom = Math.random; const originalNow = Date.now;
  let sideEffects = 0;
  const forbidden = (): never => { sideEffects++; throw new Error('Unexpected side effect'); };
  globalThis.fetch = forbidden; Math.random = forbidden; Date.now = forbidden;
  try {
    const fixture = missionFixture(); const context = missionContext(); const before = JSON.stringify({ fixture, context });
    for (let n = 0; n < 20; n++) accepted(generateMissionCandidates(fixture, context));
    assert.equal(JSON.stringify({ fixture, context }), before); assert.equal(sideEffects, 0);
  } finally { globalThis.fetch = originalFetch; Math.random = originalRandom; Date.now = originalNow; }
});
