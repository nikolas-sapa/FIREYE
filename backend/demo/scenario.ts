import { createLocalDemoSeed } from '../config/local-demo.ts';
import { createBridgeAuthority } from '../integration/session.ts';
import type { BridgeAuthority, TrustedClock } from '../integration/session.ts';
import { createPlanningSnapshot, exerciseCourseFingerprint } from '../orchestration/coordinator.ts';
import type { ExerciseLayout, ExerciseObjective, ReviewedExerciseCourse } from '../orchestration/types.ts';
import { generateMissionCandidates } from '../planning/mission-candidates.ts';
import type { ActorContext, EventInput, IncidentSeed } from '../protocol/types.ts';

export interface DemoScenario {
  readonly provenance: 'seeded-fixture';
  readonly seed: IncidentSeed;
  readonly objective: ExerciseObjective;
  readonly layout: ExerciseLayout;
  readonly reviewed_courses: readonly ReviewedExerciseCourse[];
  readonly received_events: readonly EventInput[];
  readonly clock: TrustedClock;
}

export function demoActor(seed: IncidentSeed, role: 'analyst' | 'producer'): ActorContext {
  return { principal_id: role === 'producer' ? seed.producer_id : 'exercise-analyst',
    session_id: `${seed.run_id}:${role}`, incident_id: seed.incident_id, run_id: seed.run_id,
    actor_kind: role === 'producer' ? 'simulator' : 'analyst', chief_epoch: null,
    producer_id: role === 'producer' ? seed.producer_id : null, capture_epoch: role === 'producer' ? seed.capture_epoch : null };
}

/** Explicit metadata fixture. No frame, pixels, media hash, detection or executor receipt. */
export function createDemoScenario(clock: TrustedClock): DemoScenario {
  const original = createLocalDemoSeed();
  const initial: IncidentSeed = { ...original, assets: original.assets.slice(0, 1), feeds: original.feeds.slice(0, 1), candidates: [] };
  const objective: ExerciseObjective = { objective_id: 'fixture-refresh-1', capture_goal: 'refresh_coverage',
    required_capabilities: ['thermal'], created_at_sim_tick: clock.sim_tick };
  const layout: ExerciseLayout = { approved_region: { min_x_m: 0, max_x_m: 500, min_y_m: 0, max_y_m: 500 },
    sectors: [{ sector_id: 'fixture-sector1', bounds: { min_x_m: 100, max_x_m: 110, min_y_m: 210, max_y_m: 220 },
      evidence_ids: [], coverage_age_ticks: 10 }],
    drones: [{ drone_id: 'd1', home: { x_m: 100, y_m: 200, z_m: 20 }, reserve_units: 100, link_available: true }],
    blocked_areas: [], rights_manifests: {}, policy: { model: 'toy-scalar.v1', snapshot_max_age_ticks: 5,
      intent_ttl_ticks: 10, route_speed_m_per_tick: 50, energy_units_per_m: .001, minimum_reserve_units: 10,
      wind_m_per_tick: 0, max_wind_m_per_tick: 6, separation_m: 1, coverage_altitude_m: 20 } };
  const received_events: readonly EventInput[] = [{ contract_version: initial.contract_version,
    incident_id: initial.incident_id, run_id: initial.run_id, authority_epoch: initial.authority_epoch,
    event_id: 'seeded-fixture:telemetry1', stream_id: 'telemetry:d1', stream_sequence: 1,
    trace_id: 'seeded-fixture:setup', causation_id: null, kind: 'telemetry.received', payload: {
      asset_id: 'd1', mission_id: null, mission_version: 0, captured_at: clock.received_at, capture_time_status: 'known',
      sim_tick: clock.sim_tick, position: { x_m: 100, y_m: 200, z_m: 20 }, battery_percent: 90,
      producer_id: initial.producer_id, capture_epoch: initial.capture_epoch } }];
  const provisional = createBridgeAuthority(initial, () => clock);
  if (!provisional.ok) throw new TypeError('Fixture authority invalid');
  initializeDemoScenario(provisional.value, { seed: initial, received_events });
  const snapshot = createPlanningSnapshot(provisional.value, objective, layout);
  if (!snapshot.ok) throw new TypeError('Fixture planning snapshot invalid');
  const planned = generateMissionCandidates(snapshot.value, { incident_id: initial.incident_id, run_id: initial.run_id,
    input_revision: provisional.value.read().input_revision, current_sim_tick: clock.sim_tick, mode: 'live', used_intent_ids: [] });
  if (!planned.ok) throw new TypeError('Fixture planner rejected');
  const course = planned.value.options.find(value => value.kind !== 'hold' && value.assignments.length === 1);
  if (!course) throw new TypeError('Fixture finite course unavailable');
  const assignment = course.assignments[0];
  const seed: IncidentSeed = { ...initial, candidates: [{ candidate_id: assignment.candidate_id,
    action_id: assignment.action_id, asset_id: assignment.drone_id, mission_id: assignment.mission_id,
    mission_version: 1, route_id: assignment.route_id, plan_revision: 0,
    feasibility_snapshot_id: snapshot.value.snapshot_id, feasible: true,
    expires_at_sim_tick: clock.sim_tick + layout.policy.intent_ttl_ticks }] };
  return Object.freeze({ provenance: 'seeded-fixture', seed, objective, layout, clock, received_events,
    reviewed_courses: [{ option_id: course.option_id, candidate_id: assignment.candidate_id,
      course_fingerprint: exerciseCourseFingerprint(course) }] });
}

export function initializeDemoScenario(authority: BridgeAuthority,
  scenario: Pick<DemoScenario, 'seed' | 'received_events'>): void {
  for (const event of scenario.received_events) {
    const result = authority.ingest(event, demoActor(scenario.seed, 'producer'));
    if (!result.ok) throw new TypeError('Explicit seeded-fixture event rejected');
  }
}
