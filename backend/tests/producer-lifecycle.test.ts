import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalDemoSeed } from '../config/local-demo.ts';
import { createBridgeAuthority } from '../integration/session.ts';
import { startLocalBridge } from '../integration/local-http.ts';
import type { BridgeView } from '../integration/received-view.ts';
import type { ActorContext, Command, EventInput, IncidentSeed } from '../protocol/types.ts';
import { seed, context, proposal, approval, telemetry } from './fixtures.ts';

/** Real HTTP driver, fixture activity only. No simulator Runtime or provider transport. */
async function fixture(initial: IncidentSeed = createLocalDemoSeed()) {
  const epoch = Date.now(); const started = performance.now();
  const created = createBridgeAuthority(initial, () => {
    const elapsed = Math.floor(performance.now() - started);
    return { received_at: new Date(epoch + elapsed).toISOString(), sim_tick: 1 + Math.floor(elapsed / 1000) };
  });
  if (!created.ok) throw new Error(created.reason);
  const actors: Record<string, ActorContext> = {};
  for (const role of ['simulator', 'human', 'analyst', 'reader1', 'reader2'] as const) {
    actors[role] = { ...context(role.startsWith('reader') ? 'fixture' : role as 'simulator').actor,
      principal_id: role === 'simulator' ? initial.producer_id : role === 'human' ? initial.chief_id : role,
      session_id: `lifecycle:${role}`, incident_id: initial.incident_id, run_id: initial.run_id,
      producer_id: role === 'simulator' ? initial.producer_id : null,
      capture_epoch: role === 'simulator' ? initial.capture_epoch : null };
  }
  const bridge = await startLocalBridge(created.value, { port: 0, allowed_origin: 'http://localhost:5173',
    fixture_sessions: new Map(Object.entries(actors).map(([role, actor]) => [role,
      { actor, expires_at: new Date(epoch + 600_000).toISOString() }])) });
  let requests = 0;
  async function call<T>(role: string, resource: string, input?: unknown) {
    const url = new URL(`${bridge.url}/incidents/${initial.incident_id}/${resource}`);
    assert.equal(url.hostname, '127.0.0.1'); // All driver requests physically target loopback.
    requests++;
    return new Promise<{ status: number; data?: T; error?: { code: string } }>((resolve, reject) => {
      const outgoing = request(url, { agent: false, method: input === undefined ? 'GET' : 'POST',
        headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${role}`, 'Content-Type': 'application/json' } }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => {
          try { resolve({ status: response.statusCode ?? 0, ...JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch (error) { reject(error); }
        });
      });
      outgoing.setTimeout(10_000, () => outgoing.destroy(new Error('Fixture HTTP deadline')));
      outgoing.on('error', reject);
      outgoing.end(input === undefined || input === '' ? undefined : JSON.stringify(input));
    });
  }
  return { authority: created.value, bridge, initial, call, requestCount: () => requests };
}

function data<T>(response: { status: number; data?: T }): T {
  assert.equal(response.status, 200); assert.notEqual(response.data, undefined); return response.data!;
}

test('PL01 3 fixture assets, 8 wall seconds, 20 HTTP reader checkpoints, <=6s freeze and 10 no-revivals', { timeout: 25_000 }, async t => {
  const f = await fixture();
  const heartbeatTimes: number[] = []; const sequences = new Map<string, number>();
  const started = performance.now();
  try {
    assert.equal(f.initial.assets.length, 3); assert.equal(f.initial.feeds.length, 3);
    const beat = async () => {
      assert.equal((await f.call('simulator', 'producer-heartbeats', '')).status, 200);
      heartbeatTimes.push(performance.now());
    };
    await beat();
    for (let n = 0; n < 20; n++) {
      await delay(Math.max(0, started + (n + 1) * 400 - performance.now()));
      await beat();
      const asset_id = f.initial.assets[n % 3].asset_id;
      const sequence = (sequences.get(asset_id) ?? 0) + 1; sequences.set(asset_id, sequence);
      const event: EventInput = { contract_version: f.initial.contract_version, incident_id: f.initial.incident_id,
        run_id: f.initial.run_id, authority_epoch: f.initial.authority_epoch, event_id: `fixture:${asset_id}:${sequence}`,
        stream_id: `fixture:telemetry:${asset_id}`, stream_sequence: sequence, trace_id: 'fixture:lifecycle', causation_id: null,
        kind: 'telemetry.received', payload: { asset_id, mission_id: null, mission_version: 0,
          captured_at: null, capture_time_status: 'unknown', sim_tick: f.authority.now().sim_tick,
          position: null, battery_percent: null, producer_id: f.initial.producer_id, capture_epoch: f.initial.capture_epoch } };
      data(await f.call<BridgeView>('simulator', 'events', event));
      const [left, right] = await Promise.all([f.call<BridgeView>('reader1', 'snapshot'), f.call<BridgeView>('reader2', 'snapshot')]);
      assert.deepEqual(data(left), data(right));
      assert.equal(data(left).authority_active, true); assert.equal(data(left).incident_revision, n + 1);
    }
    const activeWallMs = performance.now() - started;
    assert.ok(activeWallMs >= 8000, `Physical activity ${activeWallMs}ms`);
    const maxGapMs = Math.max(...heartbeatTimes.slice(1).map((at, n) => at - heartbeatTimes[n]));
    assert.ok(maxGapMs <= 1000, `Heartbeat gap ${maxGapMs}ms`);
    assert.equal(f.authority.read().incident_revision, 20); assert.ok(f.authority.read().incident_revision <= 50);
    assert.equal(Object.keys(f.authority.read().telemetry).length, 3);
    for (const row of Object.values(f.authority.read().telemetry)) {
      assert.equal(row.payload.position, null); assert.equal(row.payload.captured_at, null);
    }
    const stopped = performance.now();
    const frozen = data(await f.call<BridgeView>('reader1', 'snapshot?after_revision=20&wait_ms=6000'));
    const freezeWallMs = performance.now() - stopped;
    assert.equal(frozen.authority_active, false);
    assert.ok(freezeWallMs >= 4800 && freezeWallMs <= 6000, `Physical freeze ${freezeWallMs}ms`);
    assert.equal(frozen.incident_revision, 21);
    for (let n = 0; n < 10; n++) {
      const late = await f.call('simulator', 'producer-heartbeats', '');
      assert.equal(late.status, 409); assert.equal(late.error?.code, 'FROZEN');
    }
    assert.equal(f.authority.read().authority_active, false); assert.equal(f.authority.read().incident_revision, 21);
    assert.equal(f.authority.read().log.filter(row => row.kind === 'command.receipt').length, 0);
    t.diagnostic(JSON.stringify({ active_wall_ms: activeWallMs, max_heartbeat_gap_ms: maxGapMs,
      freeze_wall_ms: freezeWallMs, checkpoints: 20, heartbeats: heartbeatTimes.length,
      loopback_requests: f.requestCount(), revisions: 21, late_rejections: 10, provider_calls: 0 }));
  } finally { await f.bridge.close(); }
});

test('PL02 10 approval-observation interleaves: 10 valid then 10 STALE_VERSION acceptance checks', async () => {
  for (let n = 0; n < 10; n++) {
    const f = await fixture(seed());
    try {
      data(await f.call('analyst', 'events', proposal()));
      data(await f.call('human', 'approvals', approval()));
      const command = data(await f.call<Command[]>('simulator', 'commands'))[0];
      assert.ok(command);
      assert.equal((await f.call('simulator', 'command-checks', { command_id: command.command_id,
        expected_incident_revision: 2 })).status, 200);
      const observation = telemetry();
      assert.equal(observation.kind, 'telemetry.received');
      data(await f.call('simulator', 'events', { ...observation,
        payload: { ...observation.payload, captured_at: null, capture_time_status: 'unknown', position: null } }));
      const checked = await f.call('simulator', 'command-checks', { command_id: command.command_id,
        expected_incident_revision: 3 });
      assert.equal(checked.status, 409); assert.equal(checked.error?.code, 'STALE_VERSION');
      assert.deepEqual(data(await f.call<Command[]>('simulator', 'commands')), []);
      assert.equal(f.authority.read().commands[command.command_id].status, 'enqueued');
      assert.equal(f.authority.read().log.filter(row => row.kind === 'command.receipt').length, 0);
    } finally { await f.bridge.close(); }
  }
});

test('PL03 10000 pure tick budgets, 600s x3 x1Hz exceeds existing 999 ordinary revisions', () => {
  const budgets = Array.from({ length: 10_000 }, (_, seconds) => seconds * 3);
  assert.equal(budgets.length, 10_000); assert.equal(budgets[600], 1800);
  assert.ok(budgets[600] > 999); assert.equal(budgets[333], 999); assert.equal(budgets[334], 1002);
  // Proposal only, no ceiling or cadence changes: 2s heartbeat, each asset telemetry every10s.
  const heartbeatPerMinute = 60 / 2; const telemetryPerMinute = 3 * 60 / 10;
  assert.equal(heartbeatPerMinute + telemetryPerMinute, 48); assert.ok(48 < 60);
  const tenMinuteObservations = 600 / 10 * 3;
  assert.equal(tenMinuteObservations, 180); assert.ok(tenMinuteObservations < 999);
});
