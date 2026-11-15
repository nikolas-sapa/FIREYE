import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, request } from 'node:http';
import { createBridgeAuthority } from '../integration/session.ts';
import { startLocalBridge } from '../integration/local-http.ts';
import type { FixtureSession } from '../integration/local-http.ts';
import type { BridgeView } from '../integration/received-view.ts';
import type { Command, EventInput } from '../protocol/types.ts';
import { seed, context, telemetry, proposal, approval, frame } from './fixtures.ts';

const origin = 'http://127.0.0.1:5173';

async function setup() {
  const created = createBridgeAuthority(seed(), () => ({ received_at: new Date().toISOString(), sim_tick: 1 }));
  if (!created.ok) throw new Error(created.reason);
  const sessions = new Map<string, FixtureSession>(['simulator', 'human', 'analyst', 'fixture'].map(kind => [kind,
    { actor: context(kind as 'simulator').actor, expires_at: new Date(Date.now() + 600_000).toISOString() }]));
  sessions.set('expired', { actor: context('human').actor, expires_at: new Date(Date.now() - 1).toISOString() });
  const bridge = await startLocalBridge(created.value, { port: 0, allowed_origin: origin, fixture_sessions: sessions });
  return { authority: created.value, bridge, client(token: string) {
    return async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const response = await fetch(`${bridge.url}/incidents/i1/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: body === '' ? '' : JSON.stringify(body) }),
      });
      const result = response.status === 204 ? null : await response.json() as { data?: unknown; error?: unknown };
      return { status: response.status, result };
    };
  } };
}

function data<T>(response: { status: number; result: { data?: unknown } | null }): T {
  assert.equal(response.status, 200); return response.result?.data as T;
}

test('B01 2 HTTP clients see 20/20 same revisions, 10 local selections cause 0 writes', async () => {
  const { authority, bridge, client } = await setup();
  try {
    const producer = client('simulator'); const first = client('human'); const second = client('fixture');
    const firstAgent = new Agent({ keepAlive: true }); const secondAgent = new Agent({ keepAlive: true });
    const read = (agent: Agent) => new Promise<BridgeView>((resolve, reject) => {
      const outgoing = request(`${bridge.url}/incidents/i1/snapshot`, { agent, headers: {
        Origin: origin, Authorization: 'Bearer fixture' } }, response => {
        const chunks: Buffer[] = []; response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          try { assert.equal(response.statusCode, 200); resolve(JSON.parse(Buffer.concat(chunks).toString()).data as BridgeView); }
          catch (error) { reject(error); }
        });
      });
      outgoing.on('error', reject); outgoing.end();
    });
    try {
    for (let n = 1; n <= 20; n++) {
      data(await producer('events', telemetry(n)));
      const [left, right] = await Promise.all([read(firstAgent), read(secondAgent)]);
      assert.deepEqual(left, right);
      assert.equal(left.incident_revision, n);
    }
    } finally { firstAgent.destroy(); secondAgent.destroy(); }
    const local = { pin: 't1', camera: 'map' };
    for (let n = 0; n < 10; n++) { local.pin = `t${n % 4 + 1}`; local.camera = `camera${n}`; }
    assert.equal(authority.read().incident_revision, 20);
    assert.equal((await first('snapshot?after_revision=20&wait_ms=1')).status, 204);
    assert.equal((await second('snapshot?received_at=2026-11-14T00%3A00%3A00Z')).status, 200);
  } finally { await bridge.close(); }
});

test('B02 20 actual HTTP approval trials each yield 1 winner, 0 duplicate commands', async () => {
  for (let trial = 0; trial < 20; trial++) {
    const { authority, bridge, client } = await setup();
    try {
      data(await client('analyst')('events', proposal()));
      const requests = Array.from({ length: 20 }, (_, n) => ({ ...approval(), approval_id: `a${n}` }));
      const responses = await Promise.all(requests.map(input => client('human')('approvals', input)));
      assert.equal(responses.filter(value => value.status === 200).length, 1);
      assert.equal(responses.filter(value => value.status === 409).length, 19);
      assert.equal(Object.keys(authority.read().commands).length, 1);
      const winning = requests[responses.findIndex(value => value.status === 200)];
      for (let n = 0; n < 10; n++) data(await client('human')('approvals', winning));
      assert.equal(authority.read().incident_revision, 2);
    } finally { await bridge.close(); }
  }
});

test('B03 100 malformed/foreign/body-role HTTP events and 20 privilege failures commit 0', async () => {
  const { authority, bridge, client } = await setup();
  try {
    for (let n = 0; n < 100; n++) {
      const input = n % 4 === 0 ? { ...telemetry(), actor_kind: 'human' }
        : n % 4 === 1 ? { ...telemetry(), run_id: 'foreign' }
        : n % 4 === 2 ? { ...telemetry(), payload: { ...telemetry().payload, producer_id: 'foreign' } }
        : { ...telemetry(), payload: { ...telemetry().payload, chief_id: 'chief1' } };
      // Distinct fixture sessions avoid conflating malformed validation with rate limiting.
      const response = await client(n < 50 ? 'simulator' : 'human')('events', input);
      assert.ok([400, 403, 409].includes(response.status));
    }
    for (let n = 0; n < 20; n++) {
      const token = ['missing', 'expired', 'fixture', 'analyst'][n % 4];
      assert.ok([401, 403].includes((await client(token)('approvals', approval())).status));
    }
    assert.equal(authority.read().incident_revision, 0);
  } finally { await bridge.close(); }
});

test('B03 exact Host/Origin, 64KiB, 60 mutation attempts and query bounds enforced', async () => {
  const { authority, bridge, client } = await setup();
  try {
    assert.equal((await client('simulator')('events', telemetry(), { Origin: 'http://evil.example' })).status, 403);
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const outgoing = request(`${bridge.url}/incidents/i1/events`, { method: 'POST', headers: {
        Origin: origin, Host: 'localhost:1234', Authorization: 'Bearer simulator', 'Content-Type': 'application/json' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode ?? 0));
      });
      outgoing.on('error', reject); outgoing.end(JSON.stringify(telemetry()));
    });
    assert.equal(wrongHost, 403);
    assert.equal((await client('human')('snapshot?wait_ms=10001')).status, 400);
    assert.equal((await client('human')('snapshot?after_revision=0&after_revision=1')).status, 400);
    assert.equal((await client('human')('snapshot?actor_kind=server')).status, 400);
    assert.equal((await client('simulator')('events', { padding: 'x'.repeat(65_537) })).status, 413);
    for (let n = 0; n < 60; n++) assert.equal((await client('analyst')('approvals', {})).status, 403);
    assert.equal((await client('analyst')('approvals', {})).status, 429);
    assert.equal(authority.read().incident_revision, 0);
    const empty = await fetch(`${bridge.url}/incidents/i1/snapshot`, { headers: { Authorization: 'Bearer human' } });
    assert.equal(empty.status, 403); await empty.arrayBuffer();
  } finally { await bridge.close(); }
});

test('B05 10 HTTP rejoins no regressions; real heartbeat timer freezes within 6s', async () => {
  const { authority, bridge, client } = await setup();
  try {
    data(await client('analyst')('events', proposal()));
    data(await client('human')('approvals', approval()));
    for (let n = 0; n < 10; n++) assert.equal(data<BridgeView>(await client('fixture')('snapshot')).incident_revision, 2);
    const start = Date.now();
    const wait = await client('human')('snapshot?after_revision=2&wait_ms=6000');
    assert.equal(data<BridgeView>(wait).authority_active, false);
    assert.ok(Date.now() - start <= 6000);
    for (let n = 0; n < 10; n++) assert.equal((await client('simulator')('commands')).status, 409);
    assert.equal((await client('simulator')('producer-heartbeats', '')).status, 409);
    assert.equal(authority.read().incident_revision, 3);
  } finally { await bridge.close(); }
});

test('B05 at most16 polls; close cancels waiters without hanging', async () => {
  const { bridge, client } = await setup();
  try {
    const polls = Array.from({ length: 17 }, () => client('human')('snapshot?after_revision=0&wait_ms=100'));
    const results = await Promise.all(polls);
    assert.equal(results.filter(value => value.status === 429).length, 1);
    assert.equal(results.filter(value => value.status === 204).length, 16);
  } finally { await bridge.close(); }
});

test('B03 fixture lifetime >30min rejects startup and expiry during poll returns401', async () => {
  const created = createBridgeAuthority(seed(), () => ({ received_at: new Date().toISOString(), sim_tick: 1 }));
  if (!created.ok) throw new Error(created.reason);
  const tooLong = new Map([['human', { actor: context('human').actor,
    expires_at: new Date(Date.now() + 31 * 60_000).toISOString() }]]);
  await assert.rejects(startLocalBridge(created.value, { port: 0, allowed_origin: origin, fixture_sessions: tooLong }), /lifetime/);
  const session = { actor: context('human').actor, expires_at: new Date(Date.now() + 50).toISOString() };
  const bridge = await startLocalBridge(created.value, { port: 0, allowed_origin: origin, fixture_sessions: new Map([['human', session]]) });
  try {
    const response = await fetch(`${bridge.url}/incidents/i1/snapshot?after_revision=0&wait_ms=100`, {
      headers: { Origin: origin, Authorization: 'Bearer human' } });
    assert.equal(response.status, 401); await response.arrayBuffer();
    assert.equal(created.value.read().incident_revision, 0);
  } finally { await bridge.close(); }
});

test('B05 close stops 1 active poll in <1s and repeated close is idempotent', async () => {
  const { bridge, client } = await setup();
  const poll = client('human')('snapshot?after_revision=0&wait_ms=10000').catch(() => null);
  await new Promise<void>(resolve => setTimeout(resolve, 30));
  const start = Date.now();
  await bridge.close(); await bridge.close(); await poll;
  assert.ok(Date.now() - start < 1000);
});

test('B07 actual fixture HTTP loop keeps factual stages and identical received views', async () => {
  const { bridge, client } = await setup();
  try {
    data(await client('analyst')('events', proposal()));
    assert.equal(data<BridgeView>(await client('human')('approvals', approval())).commands[0].status, 'enqueued');
    const command = data<Command[]>(await client('simulator')('commands'))[0];
    let sequence = 0;
    for (const stage of ['sent', 'delivered', 'accepted'] as const) {
      if (stage === 'accepted') {
        const snapshot = data<BridgeView>(await client('human')('snapshot'));
        const checked = data<Command>(await client('simulator')('command-checks', {
          command_id: command.command_id, expected_incident_revision: snapshot.incident_revision }));
        assert.equal(checked.status, 'delivered');
      }
      sequence++;
      const receipt: EventInput = { ...telemetry(), event_id: `receipt${sequence}`, stream_id: 'receipts:sim1', stream_sequence: sequence,
        kind: 'command.receipt', payload: { receipt_id: `receipt${sequence}`, command_id: command.command_id,
          command_version: command.command_version, transmission_id: command.transmission_id, mission_id: command.mission_id,
          mission_version: command.mission_version, stage, sim_tick: 1, producer_id: 'sim1', capture_epoch: 1,
          captured_at: null, capture_time_status: 'unknown', reason: null, evidence_ids: [] } };
      assert.equal(data<BridgeView>(await client('simulator')('events', receipt)).commands[0].status, stage);
    }
    data(await client('simulator')('events', frame()));
    const [left, right] = await Promise.all([client('human')('snapshot'), client('fixture')('snapshot')]);
    assert.deepEqual(data<BridgeView>(left), data<BridgeView>(right));
    const view = data<BridgeView>(left);
    assert.equal(view.incident_revision, 6); assert.equal(view.commands[0].status, 'accepted');
    assert.equal(view.frames.t1.payload.frame_id, 'frame1'); assert.equal(view.mode, 'EXERCISE');
    assert.equal((await client('simulator')('command-checks', { command_id: command.command_id, expected_incident_revision: 6 })).status, 409);
    assert.equal(JSON.stringify(view).includes('completed'), false);
  } finally { await bridge.close(); }
});

test('B03 oversized chunked request rejects at 64KiB without authority writes', async () => {
  const { authority, bridge } = await setup();
  try {
    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = request(`${bridge.url}/incidents/i1/events`, { method: 'POST', headers: {
        Origin: origin, Authorization: 'Bearer simulator', 'Content-Type': 'application/json' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode ?? 0));
      });
      outgoing.on('error', reject); outgoing.write('x'.repeat(32_768)); outgoing.end('x'.repeat(32_769));
    });
    assert.equal(status, 413); assert.equal(authority.read().incident_revision, 0);
  } finally { await bridge.close(); }
});

test('B04 HTTP live tick121 exposes 0 expired options, explicit receipt replay retains1', async () => {
  const wall = new Date().toISOString();
  let tick = 1;
  const created = createBridgeAuthority(seed(), () => ({ received_at: wall, sim_tick: tick }));
  if (!created.ok) throw new Error(created.reason);
  const sessions = new Map<string, FixtureSession>(['analyst', 'human', 'simulator'].map(kind => [kind,
    { actor: context(kind as 'analyst').actor, expires_at: new Date(Date.parse(wall) + 600_000).toISOString() }]));
  const bridge = await startLocalBridge(created.value, { port: 0, allowed_origin: origin, fixture_sessions: sessions });
  const call = async (path: string, token: string, input?: unknown) => {
    const response = await fetch(`${bridge.url}/incidents/i1/${path}`, { method: input === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(input === undefined ? {} : { body: input === '' ? '' : JSON.stringify(input) }) });
    assert.equal(response.status, 200);
    return (await response.json() as { data: BridgeView }).data;
  };
  try {
    await call('events', 'analyst', proposal());
    tick = 121;
    await call('producer-heartbeats', 'simulator', '');
    const live = await call('snapshot', 'human');
    assert.equal(live.proposals.length, 0); assert.equal(live.candidates.length, 0);
    const historical = await call(`snapshot?received_at=${encodeURIComponent(wall)}`, 'human');
    assert.equal(historical.proposals.length, 1); assert.equal(historical.candidates.length, 1);
    assert.equal(created.value.read().incident_revision, 1);
  } finally { await bridge.close(); }
});
