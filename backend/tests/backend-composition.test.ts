import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readLocalDemoConfig } from '../config/local-demo.ts';
import { startLocalBackend } from '../scripts/start-local.ts';
import type { LocalBackend } from '../scripts/start-local.ts';
import { createBridgeAuthority } from '../integration/session.ts';
import { createExerciseCoordinator, createPlanningSnapshot, exerciseCourseFingerprint } from '../orchestration/coordinator.ts';
import { generateMissionCandidates } from '../planning/mission-candidates.ts';
import { SponsorBudget } from '../integrations/receipts.ts';
import { createQueuedIrisClient } from '../orchestration/queued-iris.ts';
import type { Snapshot } from '../integrations/receipts.ts';
import type { ExerciseLayout, ExerciseObjective } from '../orchestration/types.ts';
import type { BridgeView } from '../integration/received-view.ts';
import type { Command, EventInput, IncidentSeed } from '../protocol/types.ts';
import { context, frame, seed, telemetry } from './fixtures.ts';

function accepted<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string; readonly reason?: string }): T {
  if (!result.ok) assert.fail(`${result.code}: ${result.reason}`);
  return result.value;
}
const clock = () => ({ received_at: '2026-11-14T00:00:01Z', sim_tick: 1 });
const objective: ExerciseObjective = { objective_id: 'composition-refresh', capture_goal: 'refresh_coverage',
  required_capabilities: ['thermal'], created_at_sim_tick: 1 };
const layout: ExerciseLayout = {
  approved_region: { min_x_m: 0, max_x_m: 500, min_y_m: 0, max_y_m: 500 },
  sectors: [{ sector_id: 'sector1', bounds: { min_x_m: 100, max_x_m: 110, min_y_m: 210, max_y_m: 220 },
    evidence_ids: ['evidence1'], coverage_age_ticks: 10 }],
  drones: [{ drone_id: 'd1', home: { x_m: 100, y_m: 200, z_m: 20 }, reserve_units: 100, link_available: true }],
  blocked_areas: [], policy: { model: 'toy-scalar.v1', snapshot_max_age_ticks: 5, intent_ttl_ticks: 10,
    route_speed_m_per_tick: 50, energy_units_per_m: .001, minimum_reserve_units: 10,
    wind_m_per_tick: 0, max_wind_m_per_tick: 6, separation_m: 1, coverage_altitude_m: 20 },
  rights_manifests: { t1: 'exercise-rights-1' },
};
function evidence(sequence = 1): EventInput {
  const value = frame(sequence);
  assert.equal(value.kind, 'frame.received');
  return { ...value, payload: { ...value.payload, content_hash: 'a'.repeat(64),
    ...(sequence === 1 ? {} : { captured_at: null, capture_time_status: 'unknown' as const, sim_tick: null }) } };
}

// Explicit fixture bootstrap, not runtime candidate registration or eligibility bypass.
function reviewedFixture() {
  const provisional = accepted(createBridgeAuthority(seed(), clock));
  accepted(provisional.ingest(telemetry(), context().actor));
  accepted(provisional.ingest(evidence(), context().actor));
  const snapshot = accepted(createPlanningSnapshot(provisional, objective, layout));
  const plan = accepted(generateMissionCandidates(snapshot, { incident_id: 'i1', run_id: 'r1',
    input_revision: 2, current_sim_tick: 1, mode: 'live', used_intent_ids: [] }));
  const course = plan.options.find(value => value.kind !== 'hold')!;
  assert.equal(course.assignments.length, 1);
  const assignment = course.assignments[0];
  const initial: IncidentSeed = { ...seed(), candidates: [{ candidate_id: assignment.candidate_id,
    action_id: assignment.action_id, asset_id: assignment.drone_id, mission_id: assignment.mission_id,
    mission_version: 1, route_id: assignment.route_id, plan_revision: 0,
    feasibility_snapshot_id: snapshot.snapshot_id, feasible: true, expires_at_sim_tick: 11 }] };
  return { initial, reviewed: { option_id: course.option_id, course_fingerprint: exerciseCourseFingerprint(course),
    candidate_id: assignment.candidate_id } };
}

async function call(server: LocalBackend, role: keyof LocalBackend['setup']['roles'], path: string, body?: unknown) {
  const response = await fetch(`${server.url}/incidents/${server.incident_id}/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: server.allowed_origin,
      Authorization: `Bearer ${server.setup.roles[role].capability}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: body === '' ? '' : JSON.stringify(body) }),
  });
  const value = await response.json() as { data: unknown };
  assert.equal(response.status, 200);
  return value.data;
}

test('BC01-03 actual startup/planner/jobs/Iris/Chief/5 receipts/2 HTTP readers/reassessment, 0 paid calls', async () => {
  const fixture = reviewedFixture();
  let invocations = 0;
  const model = 'projects/public-fixture/models/iris-latest';
  const upstream = createServer((request, response) => {
    invocations++;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/fixture-ranking');
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const wire = JSON.parse(Buffer.concat(chunks).toString()) as { state: Snapshot };
      assert.equal(wire.state.evidence[0].synthetic, true);
      assert.equal(wire.state.evidence[0].calibration, null);
      const candidate = fixture.reviewed.candidate_id;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ model, answers: { ranking: {
        choice: candidate, probabilities: { [candidate]: 1 }, confidence: 1 } } }));
    });
  });
  let server: LocalBackend | undefined;
  try {
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    const address = upstream.address(); assert.ok(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}/fixture-ranking`;
    server = await startLocalBackend(readLocalDemoConfig({ FCC_LOCAL_PORT: '0' }), clock, fixture.initial);
    assert.equal(server.authority.read().incident_revision, 0);
    await call(server, 'producer', 'producer-heartbeats', '');
    await call(server, 'producer', 'events', telemetry());
    await call(server, 'producer', 'events', evidence());
    const authority = server.authority;
    const budget = new SponsorBudget(1, 100);
    const is_current = (snapshot: Snapshot) => snapshot.input_revision === authority.read().input_revision;
    const now = () => Date.parse(clock().received_at);
    const iris = createQueuedIrisClient({ enabled: true, authorization_id: 'local-fixture', budget, is_current, now,
      max_call_micro: 100, deadline_ms: 1000, model, registered_candidate_ids: [fixture.reviewed.candidate_id],
      transport_mode: 'local-http', transport: request => {
        assert.equal(request.url, 'https://inference.oumi.ai/v1/systemone');
        assert.deepEqual(request.headers, { 'Content-Type': 'application/json' });
        return fetch(endpoint, { method: request.method, body: request.body,
          signal: request.signal, redirect: request.redirect });
      } });
    const coordinator = createExerciseCoordinator(authority, { analyst: context('analyst').actor,
      layout, reviewed_courses: [fixture.reviewed], iris });
    const results = await Promise.all(Array.from({ length: 20 }, () => coordinator.assess(objective)));
    const assessment = accepted(results[0]);
    assert.equal(new Set(results.map(value => accepted(value).assessment_id)).size, 1);
    assert.equal(coordinator.read().assessment_count, 1);
    assert.equal(assessment.status, 'review_ready');
    assert.equal(assessment.ranking.source, 'validated-ranking', assessment.ranking.reason);
    assert.equal(assessment.ranking.receipt?.provenance, 'local-http');
    assert.equal(assessment.ranking.receipt?.fresh_provider_call, false);
    assert.equal(invocations, 1);
    assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
    assert.equal(iris.counts().retained, 1);
    accepted(coordinator.commitReview(assessment.assessment_id, fixture.reviewed.option_id));
    assert.equal(Object.keys(authority.read().commands).length, 0);
    assert.equal(coordinator.approve(assessment.assessment_id, 'composition-approval', context('analyst').actor).ok, false);
    accepted(coordinator.approve(assessment.assessment_id, 'composition-approval', context('human').actor));
    const pending = await call(server, 'producer', 'commands') as Command[];
    assert.equal(pending.length, 1); const command = pending[0];
    assert.equal(command.status, 'enqueued');
    const before = authority.read().incident_revision;
    await call(server, 'producer', 'command-checks', { command_id: command.command_id, expected_incident_revision: before });
    assert.equal(authority.read().incident_revision, before);
    let sequence = 0;
    for (const stage of ['sent', 'delivered', 'accepted', 'running', 'completed'] as const) {
      sequence++;
      const receipt: EventInput = { contract_version: 'backend-protocol.v1', incident_id: server.incident_id,
        run_id: server.run_id, authority_epoch: 1, event_id: `composition-receipt${sequence}`,
        stream_id: 'composition-receipts', stream_sequence: sequence, trace_id: `composition-trace${sequence}`,
        causation_id: command.command_id, kind: 'command.receipt', payload: {
          receipt_id: `composition-receipt${sequence}`, command_id: command.command_id,
          command_version: command.command_version, transmission_id: command.transmission_id,
          mission_id: command.mission_id, mission_version: command.mission_version, stage,
          captured_at: null, capture_time_status: 'unknown', sim_tick: 1, producer_id: 'sim1', capture_epoch: 1,
          reason: null, evidence_ids: stage === 'completed' ? ['evidence1'] : [] } };
      await call(server, 'producer', 'events', receipt);
      const [left, right]: [unknown, unknown] = await Promise.all([call(server, 'reader', 'snapshot'), call(server, 'chief', 'snapshot')]);
      assert.deepEqual(left, right);
      const view = left as BridgeView;
      assert.equal(view.commands[0].status, stage);
      assert.equal(view.coordinate_frame, null);
      assert.equal(view.frames.t1.payload.source_position, null);
      assert.equal(view.feeds[0].calibration, null);
      const last = authority.read().log.at(-1)!;
      assert.equal(last.kind, 'command.receipt');
      if (last.kind === 'command.receipt') {
        assert.equal(last.payload.captured_at, null);
        assert.equal(last.payload.capture_time_status, 'unknown');
      }
    }
    assert.equal((await call(server, 'producer', 'commands') as Command[]).length, 0);
    await call(server, 'producer', 'events', evidence(2));
    const after = accepted(await coordinator.assess(objective));
    assert.notEqual(after.assessment_id, assessment.assessment_id);
    assert.equal(after.input_revision, 3);
    assert.equal(after.status, 'review_only');
    assert.equal(after.selected_option_id, null);
    assert.equal(coordinator.read().assessments[0].status, 'superseded');
    assert.equal(Object.keys(authority.read().commands).length, 1);
    assert.equal(authority.read().log.filter(value => value.kind === 'command.receipt').length, 5);
    assert.equal(invocations, 1);
    assert.equal(coordinator.read().in_flight, 0);
    assert.equal(iris.counts().in_flight, 0);
    const final = await call(server, 'reader', 'snapshot') as BridgeView;
    // Unknown acquisition time is retained in canonical history, not used to
    // overwrite a known-acquisition latest-per-feed presentation entry.
    const unknown = authority.read().log.find(value => value.event_id === 'frame-event2')!;
    assert.equal(unknown.kind, 'frame.received');
    if (unknown.kind === 'frame.received') {
      assert.equal(unknown.payload.captured_at, null);
      assert.equal(unknown.payload.sim_tick, null);
    }
    assert.equal(final.media_verified, false);
  } finally {
    if (server) await server.close();
    if (upstream.listening) {
      upstream.closeAllConnections();
      await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
    }
  }
});
