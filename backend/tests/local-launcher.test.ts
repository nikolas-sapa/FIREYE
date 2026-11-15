import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readLocalDemoConfig } from '../config/local-demo.ts';
import { startLocalBackend } from '../scripts/start-local.ts';
import type { LocalBackend } from '../scripts/start-local.ts';
import type { BridgeView } from '../integration/received-view.ts';
import type { Command, EventInput, ApprovalRequest } from '../protocol/types.ts';

const config = () => readLocalDemoConfig({ FCC_LOCAL_PORT: '0' });
const entry = new URL(`../scripts/start-local.${import.meta.url.endsWith('.js') ? 'js' : 'ts'}`, import.meta.url);

async function call(server: LocalBackend, role: keyof LocalBackend['setup']['roles'], path: string,
  body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${server.url}/incidents/${server.incident_id}/${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: {
      Origin: server.allowed_origin, Authorization: `Bearer ${server.setup.roles[role].capability}`,
      'Content-Type': 'application/json', ...headers,
    }, ...(body === undefined ? {} : { body: body === '' ? '' : JSON.stringify(body) }),
  });
  return { status: response.status, data: response.status === 204 ? null
    : (await response.json() as { data?: unknown }).data };
}

function event(server: LocalBackend, n: number): EventInput {
  return { contract_version: 'backend-protocol.v1', incident_id: server.incident_id,
    run_id: server.run_id, authority_epoch: 1, event_id: `telemetry${n}`, stream_id: 'telemetry:d1',
    stream_sequence: n, trace_id: `trace${n}`, causation_id: null, kind: 'telemetry.received',
    payload: { asset_id: 'd1', mission_id: null, mission_version: 0, captured_at: null,
      capture_time_status: 'unknown', sim_tick: 0, position: null, battery_percent: null,
      producer_id: server.setup.roles.producer.principal_id, capture_epoch: 1 } };
}

function proposal(server: LocalBackend): EventInput {
  return { ...event(server, 1), event_id: 'proposal1', stream_id: 'proposals:analyst',
    kind: 'proposal.created', payload: { proposal_id: 'p1', proposal_revision: 1,
      candidate_ids: ['c1'], input_revision: 0, plan_revision: 0, reservation_revision: 0,
      chief_epoch: 1, rationale: 'EXERCISE: inspect a declared synthetic candidate.', expires_at_sim_tick: 120 } };
}

function approval(server: LocalBackend): ApprovalRequest {
  return { contract_version: 'backend-protocol.v1', incident_id: server.incident_id,
    run_id: server.run_id, authority_epoch: 1, approval_id: 'a1', proposal_id: 'p1',
    proposal_revision: 1, candidate_id: 'c1', expected_incident_revision: 1,
    input_revision: 0, plan_revision: 0, reservation_revision: 0, chief_epoch: 1, expires_at_sim_tick: 120 };
}

test('LL01 import has 0 listeners and defaults are EXERCISE/disabled/exact loopback', async () => {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(entry.href)});`],
  { stdio: ['ignore', 'pipe', 'pipe'] });
  const output: Buffer[] = [];
  child.stdout.on('data', chunk => output.push(Buffer.from(chunk)));
  child.stderr.on('data', chunk => output.push(Buffer.from(chunk)));
  const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
  try { const [code] = await once(child, 'exit'); assert.equal(code, 0); }
  finally { clearTimeout(timer); }
  assert.equal(Buffer.concat(output).length, 0);
  assert.deepEqual(readLocalDemoConfig({}), { mode: 'EXERCISE', providers: 'disabled',
    port: 8787, allowed_origin: 'http://localhost:5173', capability_ttl_ms: 600_000 });
});

test('LL01 10 actual start/stop cycles cancel polls and release 10/10 ports in <1s each', async () => {
  const runs = new Set<string>();
  for (let n = 0; n < 10; n++) {
    const server = await startLocalBackend(config()); runs.add(server.run_id);
    assert.equal(new URL(server.url).hostname, '127.0.0.1');
    assert.equal((await call(server, 'reader', 'snapshot')).status, 200);
    const poll = call(server, 'reader', 'snapshot?after_revision=0&wait_ms=10000').catch(() => null);
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    const start = performance.now();
    await server.close(); await server.close(); await poll;
    assert.ok(performance.now() - start < 1000);
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject); probe.listen(Number(new URL(server.url).port), '127.0.0.1', resolve);
    });
    await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
  assert.equal(runs.size, 10);
});

test('LL01 startup/disabled mode makes 0 fetch provider calls and creates 0 events', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No provider calls authorized'); };
  let server: LocalBackend | undefined;
  try { server = await startLocalBackend(config()); assert.equal(server.authority.read().incident_revision, 0); }
  finally { if (server) await server.close(); globalThis.fetch = original; }
  assert.equal(calls, 0);
});

test('LL02 20 invalid configurations reject 20/20, no wildcard or public origin', () => {
  const cases = [
    { FCC_LOCAL_PORT: '-1' }, { FCC_LOCAL_PORT: '65536' }, { FCC_LOCAL_PORT: '1.5' },
    { FCC_LOCAL_PORT: 'x' }, { FCC_LOCAL_PORT: '' }, { FCC_LOCAL_PORT: '08787' },
    { FCC_LOCAL_ORIGIN: '*' }, { FCC_LOCAL_ORIGIN: 'http://example.com' },
    { FCC_LOCAL_ORIGIN: 'http://0.0.0.0:5173' }, { FCC_LOCAL_ORIGIN: 'https://localhost:5173' },
    { FCC_LOCAL_ORIGIN: 'http://localhost:5173/' }, { FCC_LOCAL_ORIGIN: 'http://localhost:5173/path' },
    { FCC_LOCAL_ORIGIN: 'http://user@localhost:5173' }, { FCC_LOCAL_ORIGIN: 'http://localhost:5173?x=1' },
    { FCC_LOCAL_MODE: 'LIVE' }, { FCC_LOCAL_PROVIDERS: 'enabled' },
    { FCC_LOCAL_CAPABILITY_TTL_MS: '0' }, { FCC_LOCAL_CAPABILITY_TTL_MS: '1800001' },
    { FCC_LOCAL_CAPABILITY_TTL_MS: 'NaN' }, { FCC_LOCAL_HOST: '0.0.0.0' },
  ];
  for (const value of cases) assert.throws(() => readLocalDemoConfig(value));
});

test('LL02 20 invalid Host/Origin/expired role cases reject and 20 body Chief IDs grant 0 authority', async () => {
  const server = await startLocalBackend(config());
  try {
    for (let n = 0; n < 20; n++) {
      const response = n % 2 === 0
        ? await call(server, 'reader', 'snapshot', undefined, { Origin: 'http://localhost:9999' })
        : await new Promise<{ status: number }>((resolve, reject) => {
          const outgoing = request(`${server.url}/incidents/${server.incident_id}/snapshot`, { headers: {
            Origin: server.allowed_origin, Host: 'localhost:8787',
            Authorization: `Bearer ${server.setup.roles.reader.capability}` } }, response => {
            response.resume(); response.on('end', () => resolve({ status: response.statusCode ?? 0 }));
          });
          outgoing.on('error', reject); outgoing.end();
        });
      assert.equal(response.status, 403);
    }
    assert.equal((await call(server, 'analyst', 'events', proposal(server))).status, 200);
    for (let n = 0; n < 20; n++) assert.equal((await call(server, 'reader', 'approvals', {
      ...approval(server), chief_id: server.setup.roles.chief.principal_id, actor_kind: 'human' })).status, 403);
    assert.equal(server.authority.read().incident_revision, 1);
    assert.equal(Object.keys(server.authority.read().commands).length, 0);
  } finally { await server.close(); }
  let now = Date.now();
  const short = await startLocalBackend(readLocalDemoConfig({ FCC_LOCAL_PORT: '0', FCC_LOCAL_CAPABILITY_TTL_MS: '1' }),
    () => ({ received_at: new Date(now).toISOString(), sim_tick: 0 }));
  try { now += 2;
    for (let n = 0; n < 20; n++) assert.equal((await call(short, 'chief', 'snapshot')).status, 401);
  } finally { await short.close(); }
});

test('LL03 2 real HTTP readers converge 20/20 and retain 20 unknown positions/clocks', async () => {
  const server = await startLocalBackend(config());
  try {
    for (let n = 1; n <= 20; n++) {
      assert.equal((await call(server, 'producer', 'events', event(server, n))).status, 200);
      const [left, right] = await Promise.all([call(server, 'reader', 'snapshot'), call(server, 'chief', 'snapshot')]);
      assert.deepEqual(left.data, right.data);
      const view = left.data as BridgeView;
      assert.equal(view.incident_revision, n); assert.equal(view.coordinate_frame, null);
      assert.equal(view.telemetry.d1.payload.position, null);
      assert.equal(view.telemetry.d1.payload.captured_at, null);
      assert.equal(view.telemetry.d1.payload.capture_time_status, 'unknown');
      assert.equal(view.telemetry.d1.payload.battery_percent, null);
      assert.equal(view.feeds[0].modality, 'thermal'); assert.equal(view.feeds[0].calibration, null);
    }
  } finally { await server.close(); }
});

test('LL03 actual current-Chief cycle enqueues, checks, then factual receipts stay distinct', async () => {
  const server = await startLocalBackend(config());
  try {
    assert.equal((await call(server, 'producer', 'producer-heartbeats', '')).status, 200);
    assert.equal((await call(server, 'analyst', 'events', proposal(server))).status, 200);
    assert.equal((await call(server, 'chief', 'approvals', approval(server))).status, 200);
    const commands = (await call(server, 'producer', 'commands')).data as Command[];
    assert.equal(commands.length, 1); const command = commands[0];
    assert.equal(command.status, 'enqueued');
    assert.equal((await call(server, 'producer', 'command-checks', {
      command_id: command.command_id, expected_incident_revision: 2 })).status, 200);
    assert.equal(server.authority.read().incident_revision, 2);
    let sequence = 0;
    for (const stage of ['sent', 'delivered', 'accepted'] as const) {
      sequence++;
      const receipt: EventInput = { ...event(server, sequence), event_id: `receipt${sequence}`,
        stream_id: 'receipts:producer', kind: 'command.receipt', payload: {
          receipt_id: `receipt${sequence}`, command_id: command.command_id, command_version: command.command_version,
          transmission_id: command.transmission_id, mission_id: command.mission_id, mission_version: command.mission_version,
          stage, sim_tick: 0, producer_id: server.setup.roles.producer.principal_id,
          capture_epoch: 1, captured_at: null, capture_time_status: 'unknown', reason: null, evidence_ids: [] } };
      assert.equal(((await call(server, 'producer', 'events', receipt)).data as BridgeView).commands[0].status, stage);
    }
    assert.equal(server.authority.read().commands[command.command_id].status, 'accepted');
  } finally { await server.close(); }
});

test('LL03 20 unknown frame clocks/Geo remain null and 20 invented modalities reject', async () => {
  const server = await startLocalBackend(config());
  try {
    for (let n = 1; n <= 20; n++) {
      const frame: EventInput = { ...event(server, n), event_id: `frame${n}`, stream_id: 'frames:t1',
        kind: 'frame.received', payload: { frame_id: `frame${n}`, feed_id: 't1', asset_id: 'd1',
          evidence_id: `evidence${n}`, source_snapshot_id: `source${n}`, source_revision: 0,
          capture_owner_id: server.setup.roles.producer.principal_id, capture_epoch: 1,
          captured_at: null, capture_time_status: 'unknown', sim_tick: null,
          source_position: null, location_uncertainty_m: null, mime_type: 'image/png', byte_length: 1024,
          media_ref: `media${n}`, content_hash: `hash${n}`, width_px: 320, height_px: 180, media_limits_version: 'preview.v1' } };
      const response = await call(server, 'producer', 'events', frame);
      assert.equal(response.status, 200); const view = response.data as BridgeView;
      assert.equal(view.frames.t1.payload.source_position, null);
      assert.equal(view.frames.t1.payload.location_uncertainty_m, null);
      assert.equal(view.frames.t1.payload.captured_at, null); assert.equal(view.frames.t1.payload.sim_tick, null);
      assert.equal(view.feeds[0].calibration, null); assert.equal(view.coordinate_frame, null);
      assert.equal(view.media_verified, false);
      assert.equal((await call(server, 'producer', 'events', {
        ...frame, payload: { ...frame.payload, modality: 'radiometric-celsius' } })).status, 400);
      assert.equal(server.authority.read().incident_revision, n);
    }
  } finally { await server.close(); }
});

test('LL04 native/compiled CLI Ready is real PID/hash/port; SIGINT+SIGTERM remove private 0600 handoffs', async () => {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const child = spawn(process.execPath, [fileURLToPath(entry)], {
      env: { ...process.env, FCC_LOCAL_PORT: '0', FCC_LOCAL_MODE: 'EXERCISE', FCC_LOCAL_PROVIDERS: 'disabled',
        FCC_LOCAL_ORIGIN: 'http://localhost:5173', FCC_LOCAL_CAPABILITY_TTL_MS: '600000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exit = once(child, 'exit'); let output = ''; let errors = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { errors += String(chunk); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    try {
      while (!output.includes('\n') && child.exitCode === null) await new Promise<void>(resolve => setTimeout(resolve, 10));
      const ready = JSON.parse(output.trim()) as {
        ready: boolean; pid: number; entry_sha256: string; url: string; incident_id: string;
        run_id: string; capabilities_file: string; allowed_origin: string;
      };
      assert.equal(ready.ready, true); assert.equal(ready.pid, child.pid);
      assert.equal(ready.entry_sha256, createHash('sha256').update(await readFile(entry)).digest('hex'));
      assert.equal(new URL(ready.url).hostname, '127.0.0.1');
      assert.equal((await stat(ready.capabilities_file)).mode & 0o777, 0o600);
      const handoff = JSON.parse(await readFile(ready.capabilities_file, 'utf8')) as LocalBackend['setup'];
      for (const role of Object.values(handoff.roles)) {
        assert.ok(role.capability.length >= 32); assert.equal(output.includes(role.capability), false);
      }
      const response = await fetch(`${ready.url}/incidents/${ready.incident_id}/snapshot`, { headers: {
        Origin: ready.allowed_origin, Authorization: `Bearer ${handoff.roles.reader.capability}` } });
      assert.equal(response.status, 200);
      const view = (await response.json() as { data: BridgeView }).data;
      assert.equal(view.run_id, ready.run_id); assert.equal(view.incident_revision, 0);
      child.kill(signal); const [code] = await exit; assert.equal(code, 0); assert.equal(errors, '');
      await assert.rejects(stat(ready.capabilities_file), { code: 'ENOENT' });
    } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill('SIGTERM'); await exit; } }
  }
});

test('LL04 invalid CLI configuration fails closed with 0 readiness/private values', async () => {
  const child = spawn(process.execPath, [fileURLToPath(entry)], { env: { ...process.env, FCC_LOCAL_PORT: '-1' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let errors = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { errors += String(chunk); });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1); assert.equal(output, '');
  assert.equal(errors, 'Local EXERCISE backend failed to start or close. Check configuration and port.\n');
});

test('LL01 no real producer heartbeat freezes by 6s; reads cannot fabricate liveness', async () => {
  const server = await startLocalBackend(config());
  try {
    const start = performance.now();
    const response = await call(server, 'reader', 'snapshot?after_revision=0&wait_ms=6000');
    assert.equal((response.data as BridgeView).authority_active, false);
    assert.ok(performance.now() - start < 6000);
    assert.equal((await call(server, 'producer', 'producer-heartbeats', '')).status, 409);
    assert.equal(Object.keys(server.authority.read().commands).length, 0);
  } finally { await server.close(); }
});
