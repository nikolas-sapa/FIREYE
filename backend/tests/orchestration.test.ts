import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExerciseCoordinator, createPlanningSnapshot, exerciseCourseFingerprint } from '../orchestration/coordinator.ts';
import { createBridgeAuthority } from '../integration/session.ts';
import { generateMissionCandidates } from '../planning/mission-candidates.ts';
import { createIrisClient } from '../integrations/iris/client.ts';
import { SponsorBudget } from '../integrations/receipts.ts';
import type { BridgeAuthority, BridgeResult } from '../integration/session.ts';
import type { Command, EventInput, ReceiptStage, Result } from '../protocol/types.ts';
import type { ExerciseLayout, ExerciseObjective, ReviewedExerciseCourse } from '../orchestration/types.ts';
import type { IrisClient } from '../integrations/iris/types.ts';
import type { Receipt } from '../integrations/receipts.ts';
import { context, frame, seed, telemetry } from './fixtures.ts';

function accepted<T>(result: Result<T> | BridgeResult<T>): T {
  if (!result.ok) assert.fail(`${result.code}: ${result.reason}`);
  return result.value;
}

const objective = (): ExerciseObjective => ({ objective_id: 'refresh-1', capture_goal: 'refresh_coverage',
  required_capabilities: ['thermal'], created_at_sim_tick: 1 });
const layout = (): ExerciseLayout => ({
  approved_region: { min_x_m: 0, max_x_m: 500, min_y_m: 0, max_y_m: 500 },
  sectors: [{ sector_id: 'sector1', bounds: { min_x_m: 100, max_x_m: 110, min_y_m: 210, max_y_m: 220 },
    evidence_ids: ['evidence1'], coverage_age_ticks: 10 }],
  drones: [{ drone_id: 'd1', home: { x_m: 100, y_m: 200, z_m: 20 }, reserve_units: 100, link_available: true }],
  blocked_areas: [], policy: { model: 'toy-scalar.v1', snapshot_max_age_ticks: 5, intent_ttl_ticks: 10,
    route_speed_m_per_tick: 50, energy_units_per_m: .001, minimum_reserve_units: 10,
    wind_m_per_tick: 0, max_wind_m_per_tick: 6, separation_m: 1, coverage_altitude_m: 20 },
  rights_manifests: { t1: 'exercise-rights-1' },
});

function makeAuthority(initial = seed()): BridgeAuthority {
  const authority = accepted(createBridgeAuthority(initial, () => ({ received_at: '2026-11-14T00:00:01Z', sim_tick: 1 })));
  accepted(authority.ingest(telemetry(), context().actor));
  const evidence = frame();
  assert.equal(evidence.kind, 'frame.received');
  accepted(authority.ingest({ ...evidence, payload: { ...evidence.payload, content_hash: 'a'.repeat(64) } }, context().actor));
  return authority;
}

function receivedFrame(sequence: number): EventInput {
  const event = frame(sequence);
  assert.equal(event.kind, 'frame.received');
  return { ...event, payload: { ...event.payload, sim_tick: 1 } };
}

function fixture(iris?: IrisClient) {
  const provisional = makeAuthority();
  const snapshot = accepted(createPlanningSnapshot(provisional, objective(), layout()));
  const plan = accepted(generateMissionCandidates(snapshot, { incident_id: 'i1', run_id: 'r1',
    input_revision: 2, current_sim_tick: 1, mode: 'live', used_intent_ids: [] }));
  const course = plan.options.find(option => option.kind !== 'hold')!;
  assert.equal(course.assignments.length, 1);
  const assignment = course.assignments[0];
  const candidate = { candidate_id: assignment.candidate_id, action_id: assignment.action_id,
    asset_id: assignment.drone_id, mission_id: assignment.mission_id, mission_version: 1,
    route_id: assignment.route_id, plan_revision: 0, feasibility_snapshot_id: snapshot.snapshot_id,
    feasible: true, expires_at_sim_tick: 11 };
  const authority = makeAuthority({ ...seed(), candidates: [candidate] });
  const reviewed: ReviewedExerciseCourse = { option_id: course.option_id,
    course_fingerprint: exerciseCourseFingerprint(course), candidate_id: candidate.candidate_id };
  const config = { analyst: context('analyst').actor, layout: layout(), reviewed_courses: [reviewed], ...(iris ? { iris } : {}) };
  const coordinator = createExerciseCoordinator(authority, config);
  return { authority, coordinator, config, candidate, course };
}

test('OR01 twenty unknown/stale/currentness choices accept zero review commits', async () => {
  for (let n = 0; n < 20; n++) {
    const { authority, coordinator } = fixture();
    const assessment = accepted(await coordinator.assess(objective()));
    if (n % 4 === 0) assert.equal(coordinator.commitReview(assessment.assessment_id, 'unknown').ok, false);
    if (n % 4 === 1) assert.equal(coordinator.commitReview('unknown', assessment.selected_option_id!).ok, false);
    if (n % 4 === 2) {
      accepted(authority.ingest(receivedFrame(2), context().actor));
      assert.equal(coordinator.commitReview(assessment.assessment_id, assessment.selected_option_id!).ok, false);
    }
    if (n % 4 === 3) assert.equal((await coordinator.assess({ ...objective(), created_at_sim_tick: 2 })).ok, false);
    assert.equal(Object.keys(authority.read().proposals).length, 0);
    assert.equal(Object.keys(authority.read().commands).length, 0);
  }
});

test('OR02 twenty concurrent identical assessments create exactly one job', async () => {
  const { coordinator } = fixture();
  const results = await Promise.all(Array.from({ length: 20 }, () => coordinator.assess(objective())));
  const ids = results.map(value => accepted(value).assessment_id);
  assert.equal(new Set(ids).size, 1);
  assert.equal(coordinator.read().assessment_count, 1);
  assert.equal(coordinator.read().in_flight, 0);
});

test('OR03 twenty received snapshot changes supersede twenty older reviews', async () => {
  for (let n = 0; n < 20; n++) {
    const { authority, coordinator } = fixture();
    const before = accepted(await coordinator.assess(objective()));
    accepted(authority.ingest(receivedFrame(2), context().actor));
    coordinator.refresh();
    assert.equal(coordinator.read().assessments[0].status, 'superseded');
    assert.equal(coordinator.commitReview(before.assessment_id, before.selected_option_id!).ok, false);
    const after = accepted(await coordinator.assess(objective()));
    assert.notEqual(after.assessment_id, before.assessment_id);
    assert.equal(after.input_revision, 3);
    assert.equal(after.selected_option_id, null);
    assert.equal(after.status, 'review_only');
    assert.equal(Object.keys(authority.read().commands).length, 0);
  }
});

function producerReceipt(authority: BridgeAuthority, command: Command, stage: ReceiptStage, sequence: number): EventInput {
  return { contract_version: 'backend-protocol.v1', incident_id: 'i1', run_id: 'r1', authority_epoch: 1,
    event_id: `receipt-${sequence}`, stream_id: 'receipts:sim1', stream_sequence: sequence,
    trace_id: `trace-receipt-${sequence}`, causation_id: command.command_id, kind: 'command.receipt',
    payload: { receipt_id: `receipt-${sequence}`, command_id: command.command_id, command_version: command.command_version,
      transmission_id: command.transmission_id, mission_id: command.mission_id, mission_version: command.mission_version,
      stage, captured_at: '2026-11-14T00:00:01Z', capture_time_status: 'known', sim_tick: 1,
      producer_id: authority.read().producer_id, capture_epoch: authority.read().capture_epoch, reason: null,
      evidence_ids: stage === 'completed' ? ['evidence1'] : [] } };
}

test('OR04 one actual exported-module objective-to-receipt loop makes zero provider calls', async () => {
  let transports = 0;
  const iris = createIrisClient({ transport: async () => { transports++; throw new Error('disabled'); } });
  const { authority, coordinator, candidate } = fixture(iris);
  const assessment = accepted(await coordinator.assess(objective()));
  assert.equal(assessment.mode, 'EXERCISE');
  assert.equal(assessment.verification_status, 'unverified');
  assert.equal(assessment.ranking.source, 'deterministic-fallback');
  assert.equal(assessment.ranking.reason, 'DISABLED');
  assert.equal(assessment.plan.executable, false);
  const reviewed = accepted(coordinator.commitReview(assessment.assessment_id, assessment.selected_option_id!));
  assert.equal(reviewed.status, 'proposed');
  assert.equal(Object.keys(authority.read().commands).length, 0);
  assert.equal(coordinator.approve(assessment.assessment_id, 'approval1', context('analyst').actor).ok, false);
  const approved = accepted(coordinator.approve(assessment.assessment_id, 'approval1', context('human').actor));
  assert.equal(approved.status, 'approved');
  const pending = accepted(authority.pending(context().actor));
  assert.equal(pending.length, 1);
  const command = accepted(authority.check({ command_id: pending[0].command_id,
    expected_incident_revision: authority.read().incident_revision }, context().actor));
  assert.equal(command.action_id, candidate.action_id);
  assert.equal(command.status, 'enqueued');
  let sequence = 0;
  for (const stage of ['sent', 'delivered', 'accepted', 'running', 'completed'] as const) {
    accepted(authority.ingest(producerReceipt(authority, command, stage, ++sequence), context().actor));
    assert.equal(authority.read().commands[command.command_id].status, stage);
  }
  assert.equal(accepted(authority.pending(context().actor)).length, 0);
  accepted(authority.ingest(receivedFrame(2), context().actor));
  coordinator.refresh();
  const after = accepted(await coordinator.assess(objective()));
  assert.equal(after.input_revision, 3);
  assert.equal(after.selected_option_id, null);
  assert.equal(transports, 0);
  assert.equal(authority.read().log.filter(event => event.kind === 'command.receipt').length, 5);
  assert.equal(authority.read().log.filter(event => event.kind === 'frame.received').length, 2);
});

test('OR05 late ranking after received evidence creates zero stale reviews', async () => {
  let release!: (value: Awaited<ReturnType<IrisClient['analyze']>>) => void;
  let calls = 0;
  const iris: IrisClient = { analyze: async () => { calls++; return new Promise(resolve => { release = resolve; }); } };
  const { authority, coordinator } = fixture(iris);
  const pending = coordinator.assess(objective());
  accepted(authority.ingest(receivedFrame(2), context().actor));
  coordinator.refresh();
  release({ ok: false, code: 'STALE' });
  assert.equal((await pending).ok, false);
  assert.equal(calls, 1);
  assert.equal(coordinator.read().assessments[0].status, 'superseded');
  assert.equal(Object.keys(authority.read().proposals).length, 0);
});

test('OR06 fingerprint mismatch and unregistered planner options remain review-only', async () => {
  const { authority, config } = fixture();
  const coordinator = createExerciseCoordinator(authority, { ...config,
    reviewed_courses: [{ ...config.reviewed_courses[0], course_fingerprint: '0'.repeat(64) }] });
  const assessment = accepted(await coordinator.assess(objective()));
  assert.equal(assessment.status, 'review_only');
  assert.equal(assessment.selected_option_id, null);
  for (const option of assessment.plan.options) {
    assert.equal(coordinator.commitReview(assessment.assessment_id, option.option_id).ok, false);
    assert.equal(option.executable, false);
  }
  assert.equal(Object.keys(authority.read().commands).length, 0);
});

test('OR07 twenty unknown/malformed rankings never select unknown candidate IDs', async () => {
  for (let n = 0; n < 20; n++) {
    const iris: IrisClient = { analyze: async () => ({ ok: true, value: { kind: 'finite-ranking',
      ranking: [{ candidate_id: 'unknown', score: n % 2 ? Infinity : 1,
        scale: 'provider choice probability, not calibrated incident probability' }] } }) };
    const { coordinator, course } = fixture(iris);
    const assessment = accepted(await coordinator.assess(objective()));
    assert.equal(assessment.ranking.source, 'deterministic-fallback');
    assert.equal(assessment.ranking.reason, 'INVALID_REPLY');
    assert.equal(assessment.selected_option_id, course.option_id);
    assert.equal(assessment.registered_candidate_ids.includes('unknown'), false);
  }
});

test('OR08 new objective supersedes old proposed review before Chief approval', async () => {
  const { authority, coordinator } = fixture();
  const before = accepted(await coordinator.assess(objective()));
  accepted(coordinator.commitReview(before.assessment_id, before.selected_option_id!));
  const after = accepted(await coordinator.assess({ ...objective(), objective_id: 'refresh-2' }));
  assert.equal(coordinator.read().assessments[0].status, 'superseded');
  assert.equal(coordinator.approve(before.assessment_id, 'approval-old', context('human').actor).ok, false);
  assert.equal(after.status, 'review_only');
  assert.equal(Object.keys(authority.read().commands).length, 0);
});

test('OR09 malformed/accessor/proxy objectives invoke zero getters/traps', async () => {
  const { coordinator } = fixture(); let calls = 0;
  const accessor = { ...objective() };
  Object.defineProperty(accessor, 'capture_goal', { enumerable: true, get() { calls++; throw new Error('getter'); } });
  const proxy = new Proxy(objective(), { ownKeys() { calls++; throw new Error('proxy'); } });
  assert.equal((await coordinator.assess(accessor)).ok, false);
  assert.equal((await coordinator.assess(proxy)).ok, false);
  assert.equal((await coordinator.assess({ ...objective(), truth: 'hidden' })).ok, false);
  assert.equal(calls, 0);
});

test('OR10 optional validated finite ranking stays unverified and creates zero commands', async () => {
  const iris: IrisClient = { analyze: async input => {
    const ids = (input as { candidate_ids: readonly string[] }).candidate_ids;
    return { ok: true, value: { kind: 'finite-ranking', ranking: ids.map(candidate_id => ({ candidate_id, score: 1,
      scale: 'provider choice probability, not calibrated incident probability' })) } };
  } };
  const { authority, coordinator } = fixture(iris);
  const assessment = accepted(await coordinator.assess(objective()));
  assert.equal(assessment.ranking.source, 'validated-ranking');
  assert.equal(assessment.ranking.receipt, null);
  assert.equal(assessment.verification_status, 'unverified');
  assert.equal(Object.keys(authority.read().commands).length, 0);
});

test('OR11 actual Iris export consumes projected received metadata and preserves fixture receipt', async () => {
  let calls = 0; let authority!: BridgeAuthority;
  const budget = new SponsorBudget(1, 100);
  const client: IrisClient = { analyze: async input => {
    const request = input as { snapshot: { input_revision: number }; candidate_ids: readonly string[] };
    const model = 'projects/public-fixture/models/iris-latest';
    return createIrisClient({ enabled: true, authorization_id: 'exercise-fixture-1', max_call_micro: 100,
      deadline_ms: 500, budget, now: () => Date.parse('2026-11-14T00:00:01Z'),
      is_current: snapshot => snapshot.input_revision === authority.read().input_revision,
      model, registered_candidate_ids: request.candidate_ids, transport_mode: 'fixture',
      transport: async transportRequest => {
        calls++;
        const sent = JSON.parse(transportRequest.body);
        assert.equal(sent.state.evidence.length, 1);
        assert.equal(Object.hasOwn(sent.state, 'seed'), false);
        assert.equal(Object.hasOwn(sent.state, 'world'), false);
        return Response.json({ model, answers: { ranking: { choice: request.candidate_ids[0],
          probabilities: { [request.candidate_ids[0]]: 1 }, confidence: 1 } } });
      } }).analyze(input);
  } };
  const result = fixture(client); authority = result.authority;
  const assessment = accepted(await result.coordinator.assess(objective()));
  assert.equal(calls, 1);
  assert.equal(assessment.ranking.source, 'validated-ranking');
  assert.equal(assessment.ranking.receipt?.provenance, 'fixture');
  assert.equal(assessment.ranking.receipt?.fresh_provider_call, false);
  assert.equal(budget.usage().calls, 1);
  assert.equal(Object.keys(authority.read().commands).length, 0);
});

test('OR12 retained job and in-flight bounds reject without new work', async () => {
  const { coordinator } = fixture();
  for (let n = 0; n < 64; n++) accepted(await coordinator.assess({ ...objective(), objective_id: `objective-${n}` }));
  assert.equal((await coordinator.assess({ ...objective(), objective_id: 'over-limit' })).ok, false);
  assert.equal(coordinator.read().assessment_count, 64);
  let release!: (value: Awaited<ReturnType<IrisClient['analyze']>>) => void;
  const iris: IrisClient = { analyze: async () => new Promise(resolve => { release = resolve; }) };
  const pendingFixture = fixture(iris);
  const first = pendingFixture.coordinator.assess(objective());
  // Changed objective is unregistered, completes deterministically without Iris.
  accepted(await pendingFixture.coordinator.assess({ ...objective(), objective_id: 'other' }));
  release({ ok: false, code: 'STALE' });
  assert.equal((await first).ok, false);
  assert.equal(pendingFixture.coordinator.read().in_flight, 0);
});

test('OR13 twenty hostile custom receipts leak zero sentinels and invoke zero getters/traps', async () => {
  let traps = 0; const sentinel = 'raw-secret-sentinel';
  for (let n = 0; n < 20; n++) {
    const iris: IrisClient = { analyze: async input => {
      const ids = (input as { candidate_ids: readonly string[] }).candidate_ids;
      let receipt: object = { provenance: 'provider', endpoint: sentinel, model: sentinel };
      if (n % 4 === 1) Object.defineProperty(receipt, 'endpoint', { enumerable: true, get() { traps++; return sentinel; } });
      if (n % 4 === 2) receipt = new Proxy(receipt, { ownKeys() { traps++; throw new Error(sentinel); } });
      if (n % 4 === 3) return { ok: false, code: sentinel, receipt } as unknown as Awaited<ReturnType<IrisClient['analyze']>>;
      return { ok: true, value: { kind: 'finite-ranking', ranking: [{ candidate_id: ids[0], score: 1,
        scale: 'provider choice probability, not calibrated incident probability' }] }, receipt: receipt as Receipt };
    } };
    const { coordinator } = fixture(iris);
    const result = accepted(await coordinator.assess(objective()));
    assert.equal(result.ranking.receipt, null);
    assert.equal(JSON.stringify(coordinator.read()).includes(sentinel), false);
  }
  assert.equal(traps, 0);
});

test('OR14 twenty cached resolution interleaves reject stale assessments', async () => {
  for (let n = 0; n < 20; n++) {
    const { authority, coordinator } = fixture();
    accepted(await coordinator.assess(objective()));
    const cached = coordinator.assess(objective());
    accepted(authority.ingest(receivedFrame(2), context().actor));
    assert.equal((await cached).ok, false);
    assert.equal(coordinator.read().assessments[0].status, 'superseded');
  }
});

test('OR15 actual advancing clock preserves current course but expiry rejects approval', async () => {
  const reference = fixture(); const initial = reference.authority.read().seed;
  let tick = 1;
  const authority = accepted(createBridgeAuthority(initial, () => ({
    received_at: `2026-11-14T00:00:0${tick}Z`, sim_tick: tick })));
  accepted(authority.ingest(telemetry(), context().actor));
  const evidence = frame(); assert.equal(evidence.kind, 'frame.received');
  accepted(authority.ingest({ ...evidence, payload: { ...evidence.payload, content_hash: 'a'.repeat(64) } }, context().actor));
  const coordinator = createExerciseCoordinator(authority, reference.config);
  const assessed = accepted(await coordinator.assess(objective()));
  tick = 2;
  const duplicate = accepted(await coordinator.assess(objective()));
  assert.equal(duplicate.assessment_id, assessed.assessment_id);
  accepted(coordinator.commitReview(assessed.assessment_id, assessed.selected_option_id!));
  accepted(coordinator.approve(assessed.assessment_id, 'advancing-clock-approval', context('human').actor));
  const pending = accepted(authority.pending(context().actor)); assert.equal(pending.length, 1);
  const command = accepted(authority.check({ command_id: pending[0].command_id,
    expected_incident_revision: authority.read().incident_revision }, context().actor));
  accepted(authority.ingest(producerReceipt(authority, command, 'sent', 1), context().actor));
  assert.equal(authority.read().commands[command.command_id].status, 'sent');
  tick = 7; // observed tick1, max age5: current review is expired.
  assert.equal((await coordinator.assess(objective())).ok, false);
  assert.equal(coordinator.approve(assessed.assessment_id, 'expired-approval', context('human').actor).ok, false);
  assert.equal(coordinator.read().assessments[0].status, 'superseded');
});

test('OR16 twenty fresh promise microtask races return zero stale successes', async () => {
  for (let n = 0; n < 20; n++) {
    const { authority, coordinator } = fixture();
    const pending = coordinator.assess(objective());
    queueMicrotask(() => { accepted(authority.ingest(receivedFrame(2), context().actor)); });
    assert.equal((await pending).ok, false);
    assert.equal(coordinator.read().assessments[0].status, 'superseded');
    assert.equal(Object.keys(authority.read().proposals).length, 0);
  }
});
