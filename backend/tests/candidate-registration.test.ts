import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMissionCandidates } from '../planning/mission-candidates.ts';
import { createCandidateRegistry, replayCandidateRegistrations } from '../planning/register-candidates.ts';
import type { RegistrationInputs, RegistrationRequest } from '../planning/register-candidates.ts';
import type { MissionPlanningSnapshot, MissionPlanningContext } from '../planning/mission-types.ts';
import type { ActorContext } from '../protocol/types.ts';

function fixture(input_revision = 7) {
  const snapshot: MissionPlanningSnapshot = {
    snapshot_id: 'snapshot', incident_id: 'incident', run_id: 'run', input_revision,
    observed_at_sim_tick: 100, intent_id: 'intent', intent_created_at_sim_tick: 100,
    objective: { objective_id: 'objective', capture_goal: 'refresh_coverage', required_capabilities: ['thermal'] },
    approved_region: { min_x_m: 0, max_x_m: 100, min_y_m: 0, max_y_m: 100 },
    sectors: [{ sector_id: 'sector', coverage_age_ticks: 30,
      bounds: { min_x_m: 10, max_x_m: 20, min_y_m: 10, max_y_m: 20 }, evidence_ids: [] }],
    drones: [{ drone_id: 'drone', position: { x_m: 10, y_m: 5, z_m: 20 },
      home: { x_m: 10, y_m: 5, z_m: 20 }, capabilities: ['thermal'],
      feeds: [{ feed_id: 'feed', modality: 'thermal', status: 'available', source_id: 'sensor',
        source_kind: 'simulated', synthetic: true }], reserve_units: 100, link_available: true }],
    evidence: [], active_leases: [], blocked_areas: [],
    policy: { model: 'toy-scalar.v1', snapshot_max_age_ticks: 5, intent_ttl_ticks: 5,
      route_speed_m_per_tick: 10, energy_units_per_m: .001, minimum_reserve_units: 10,
      wind_m_per_tick: 0, max_wind_m_per_tick: 6, separation_m: 1, coverage_altitude_m: 20 },
  };
  const context: MissionPlanningContext = { incident_id: 'incident', run_id: 'run', input_revision,
    current_sim_tick: 100, mode: 'live', used_intent_ids: [] };
  const plan = generateMissionCandidates(snapshot, context);
  assert.ok(plan.ok);
  const assignments = plan.value.options.flatMap(option => option.assignments);
  assert.equal(assignments.length, 2);
  const inputs: RegistrationInputs = { snapshot, context, known_asset_ids: ['asset'],
    mappings: assignments.map(p => ({ candidate_id: p.candidate_id, mission_id: p.mission_id,
      route_id: p.route_id, drone_id: p.drone_id, asset_id: 'asset' })) };
  const requests: RegistrationRequest[] = inputs.mappings.map(m => ({ run_id: 'run', input_revision,
    candidate_id: m.candidate_id, route_id: m.route_id, mission_id: m.mission_id,
    asset_id: m.asset_id, decision: 'approve' }));
  return { snapshot, context, inputs, requests };
}

const actor: ActorContext = { principal_id: 'reviewer', session_id: 'human-session', incident_id: 'incident',
  run_id: 'run', actor_kind: 'human', chief_epoch: null, producer_id: null, capture_epoch: null };

function ready() {
  const data = fixture(); const registry = createCandidateRegistry();
  assert.ok(registry.setCurrent(data.inputs).ok);
  return { ...data, registry };
}

test('CR01 20 reviewed current candidates register exactly 20 immutable exact identities', () => {
  const registry = createCandidateRegistry();
  let count = 0;
  for (let n = 0; n < 20; n++) {
    const { requests, inputs } = fixture(7 + n);
    assert.ok(registry.setCurrent(inputs).ok);
    const result = registry.register(requests[0], actor); assert.ok(result.ok); count++;
    assert.deepEqual(result.value.identity, requests[0]);
    assert.equal(result.value.reviewer_id, actor.principal_id);
    assert.equal(result.value.executable, false);
    assert.equal(result.value.status, 'reviewed_proposal');
    assert.ok(Object.isFrozen(result.value.proposal.waypoints[0].position));
    assert.throws(() => Object.assign(result.value.proposal.waypoints[0].position, { x_m: 999 }));
    const before = JSON.stringify(registry.snapshot());
    Object.assign(inputs.mappings[0], { asset_id: 'mutated' });
    assert.equal(JSON.stringify(registry.snapshot()), before);
    assert.equal(registry.snapshot().entries.length, n + 1);
  }
  assert.equal(count, 20);
  assert.equal(new Set(registry.snapshot().entries.map(e => e.identity.candidate_id)).size, 20);
});

test('CR01 20 invalid DTO, identity, currentness, geometry and human cases reject 20/20 with zero entries', () => {
  const invalid: ((request: RegistrationRequest) => unknown)[] = [
    () => null, () => ({}), r => ({ ...r, candidate_id: 'unknown' }), r => ({ ...r, route_id: 'unknown' }),
    r => ({ ...r, mission_id: 'unknown' }), r => ({ ...r, asset_id: 'unknown' }),
    r => ({ ...r, run_id: 'wrong' }), r => ({ ...r, input_revision: 6 }),
    r => ({ ...r, input_revision: 8 }), r => ({ ...r, input_revision: NaN }),
    r => ({ ...r, decision: 'reject' }), r => ({ ...r, decision: undefined }),
    r => ({ ...r, reviewer_id: 'forged' }), r => ({ ...r, geometry: [{ x_m: Infinity }] }),
    r => ({ ...r, waypoints: [] }), r => ({ ...r, candidate_id: '' }),
    r => ({ ...r, asset_id: 1 }), r => ({ ...r, extra: true }),
    r => Object.defineProperty({ ...r }, 'candidate_id', { get() { throw new Error('getter invoked'); } }),
    r => new Proxy(r, { ownKeys() { throw new Error('proxy invoked'); } }),
  ];
  let rejects = 0;
  for (const mutate of invalid) {
    const { registry, requests } = ready();
    assert.equal(registry.register(mutate(requests[0]), actor).ok, false); rejects++;
    assert.equal(registry.snapshot().entries.length, 0);
  }
  assert.equal(rejects, 20);
  for (const actor_kind of ['analyst', 'simulator', 'server', 'fixture'] as const) {
    const { registry, requests } = ready();
    assert.equal(registry.register(requests[0], { ...actor, actor_kind }).ok, false);
    assert.equal(registry.snapshot().entries.length, 0);
  }
});

test('CR01 unmapped, forged mappings, non-finite source and same-ID changed geometry fail closed', () => {
  const { registry, inputs, requests, snapshot } = ready();
  assert.equal(registry.setCurrent({ ...inputs, snapshot: { ...snapshot,
    policy: { ...snapshot.policy, coverage_altitude_m: 99 } } }).ok, false);
  assert.ok(registry.register(requests[0], actor).ok);
  assert.equal(registry.register({ ...requests[0], geometry: [{ x_m: 1, y_m: 2, z_m: 3 }] }, actor).ok, false);
  for (const patch of [{ asset_id: 'unknown' }, { mission_id: 'invented' }, { route_id: 'invented' }, { drone_id: 'unknown' }]) {
    const empty = createCandidateRegistry();
    assert.equal(empty.setCurrent({ ...inputs, mappings: [{ ...inputs.mappings[0], ...patch }] }).ok, false);
    assert.equal(empty.snapshot().entries.length, 0);
  }
  const empty = createCandidateRegistry();
  assert.ok(empty.setCurrent({ ...inputs, mappings: [] }).ok);
  assert.equal(empty.register(requests[0], actor).ok, false);
  assert.equal(createCandidateRegistry().setCurrent({ ...inputs, snapshot: { ...snapshot,
    policy: { ...snapshot.policy, wind_m_per_tick: Infinity } } }).ok, false);
});

test('CR02 20 repeats produce zero duplicates and append immutable audit receipts', () => {
  const { registry, requests } = ready();
  assert.ok(registry.register(requests[0], actor).ok);
  const log = registry.auditLog();
  for (let n = 0; n < 20; n++) assert.ok(registry.register(requests[0], actor).ok);
  assert.equal(registry.snapshot().entries.length, 1);
  assert.equal(registry.auditLog().filter(e => e.kind === 'repeated').length, 20);
  assert.equal(log.length, 2);
  assert.ok(Object.isFrozen(log[1]));
});

test('CR02 20 concurrent two-candidate races each have exactly one asset winner', async () => {
  let winners = 0;
  for (let n = 0; n < 20; n++) {
    const { registry, requests } = ready();
    const results = await Promise.all(requests.map(request => Promise.resolve().then(() => registry.register(request, actor))));
    assert.equal(results.filter(r => r.ok).length, 1); winners++;
    assert.equal(registry.snapshot().entries.length, 1);
    assert.equal(registry.snapshot().entries.filter(e => e.eligible).length, 1);
  }
  assert.equal(winners, 20);
});

test('CR02 20 model geometry/safety/approval flags grant zero authority', () => {
  const flags = ['feasible', 'safe', 'approved', 'geometry', 'executable'];
  let rejected = 0;
  for (let n = 0; n < 20; n++) {
    const { registry, requests } = ready();
    const result = registry.register({ ...requests[0], [flags[n % flags.length]]: true }, actor);
    assert.equal(result.ok, false); rejected++;
    assert.equal(registry.snapshot().entries.length, 0);
  }
  assert.equal(rejected, 20);
});

test('CR03 10 revision interleaves invalidate 10/10 and pending old reviews reject', () => {
  for (let n = 0; n < 10; n++) {
    const { registry, requests, inputs } = ready();
    assert.ok(registry.register(requests[0], actor).ok);
    const next = fixture(8 + n);
    assert.ok(registry.setCurrent(next.inputs).ok);
    assert.equal(registry.snapshot().entries.filter(e => e.eligible).length, 0);
    assert.equal(registry.register(requests[1], actor).ok, false);
    assert.equal(registry.setCurrent(inputs).ok, false);
    assert.ok(registry.register(next.requests[0], actor).ok);
    assert.equal(registry.snapshot().entries.filter(e => e.eligible).length, 1);
    assert.equal(registry.snapshot().entries.length, 2);
  }
});

test('CR03 10 serialized audit replays produce byte-identical registries', () => {
  const { registry, requests } = ready();
  assert.ok(registry.register(requests[0], actor).ok);
  assert.ok(registry.register(requests[0], actor).ok);
  assert.equal(registry.register(requests[1], actor).ok, false);
  const next = fixture(8); assert.ok(registry.setCurrent(next.inputs).ok);
  assert.ok(registry.register(next.requests[1], actor).ok);
  const log = JSON.stringify(registry.auditLog()); const expected = JSON.stringify(registry.snapshot());
  for (let n = 0; n < 10; n++) assert.equal(JSON.stringify(replayCandidateRegistrations(JSON.parse(log))), expected);
  const empty = createCandidateRegistry();
  assert.equal(JSON.stringify(replayCandidateRegistrations([])), JSON.stringify(empty.snapshot()));
  assert.throws(() => replayCandidateRegistrations([{ kind: 'registered', request: requests[0], actor }]));
});

test('CR03 unknown required feasibility input produces zero eligible options', () => {
  const { registry, requests } = ready(); assert.ok(registry.register(requests[0], actor).ok);
  const { inputs, snapshot } = fixture(8);
  const unknown = { ...snapshot, policy: { ...snapshot.policy, wind_m_per_tick: null } };
  assert.ok(registry.setCurrent({ ...inputs, snapshot: unknown, mappings: [] }).ok);
  assert.equal(registry.snapshot().entries.filter(e => e.eligible).length, 0);
  assert.equal(registry.register(fixture(8).requests[0], actor).ok, false);
});
