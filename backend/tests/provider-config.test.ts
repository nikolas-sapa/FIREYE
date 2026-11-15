import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createProviderSetup } from '../setup/provider-config.ts';
import { createSmokeSession, runSmokeCli } from '../scripts/sponsor-smoke.ts';
import type { Snapshot, Transport } from '../integrations/receipts.ts';
import type { SponsorJob } from '../integrations/jobs.ts';

const now = 1_800_000_000_000;
function approval() {
  return { authorization_id: 'smoke-approved', expires_at_ms: now + 5000, max_calls: 1, max_total_micro: 100,
    adapters: [{ adapter: 'iris', model: 'projects/exercise/models/iris-latest', task_version: 'smoke.v1',
      rights_manifest_ids: ['rights1'], max_call_micro: 100, deadline_ms: 1000 }] };
}
function snapshot(): Snapshot {
  return { incident_id: 'i1', run_id: 'r1', authority_epoch: 1, input_revision: 1, snapshot_id: 's1', received_cutoff_ms: now,
    valid_until_ms: now + 5000, evidence: [{ evidence_id: 'e1', source_id: 'source1', rights_manifest_id: 'rights1', source_kind: 'simulated',
      captured_at_ms: now - 10, received_at_ms: now - 5, modality: 'text', synthetic: true, radiometric: false, calibration: null,
      content_hash: createHash('sha256').update('fixture').digest('hex'), byte_length: 7, width_px: null, height_px: null }] };
}
function job(): SponsorJob {
  return { job_id: 'smoke1', adapter: 'iris', task_version: 'smoke.v1', model: 'projects/exercise/models/iris-latest',
    snapshot: snapshot(), task_input: { candidate_ids: ['candidate1'] }, deadline_at_ms: now + 1000, max_call_micro: 100 };
}
const env = { IRIS_API_KEY: 'private-fixture', IRIS_MODEL: 'projects/exercise/models/iris-latest' };

test('SS01 5 slots disabled by default, public routes/caps/rights explicit', () => {
  const setup = createProviderSetup({});
  assert.equal(setup.status().providers.length, 5);
  for (const provider of setup.status().providers) {
    assert.equal(provider.status, 'disabled');
    assert.equal(provider.max_call_micro, null);
    assert.equal(provider.rights_manifest_ids.length, 0);
    assert.ok(Object.hasOwn(provider, 'endpoint'));
    assert.ok(Object.hasOwn(provider, 'model'));
  }
  assert.equal(setup.status().context.firecrawl.product_adapter, 'unsupported');
  assert.equal(setup.status().context.boxd.execution_enabled, false);
});

test('SS01 20 absent/invalid caps or approvals invoke 0 transports', async () => {
  let calls = 0;
  for (let n = 0; n < 20; n++) {
    const invalid = n % 4 === 0 ? undefined : n % 4 === 1 ? { ...approval(), max_total_micro: 0 }
      : n % 4 === 2 ? { ...approval(), max_calls: 5 } : { ...approval(), expires_at_ms: now };
    const session = createSmokeSession(createProviderSetup(env, invalid, () => now), { now: () => now, is_current: () => true,
      transport: async () => { calls++; return Response.json({}); }, transport_mode: 'fixture' });
    assert.equal((await session.submit(job())).ok, false);
    assert.deepEqual(session.usage(), { calls: 0, reserved_micro: 0 });
  }
  assert.equal(calls, 0);
});

test('SS02 20 duplicates compose actual Iris/jobs through 1 non-mocked loopback call/reservation', async () => {
  let calls = 0;
  const server = createServer((_request, response) => {
    calls++;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ model: job().model, answers: { ranking: { choice: 'candidate1', probabilities: { candidate1: 1 }, confidence: 1 } } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const transport: Transport = request => fetch(`http://127.0.0.1:${address.port}`, { method: request.method, body: request.body, signal: request.signal });
    const session = createSmokeSession(createProviderSetup(env, approval(), () => now), { now: () => now, is_current: () => true,
      transport, transport_mode: 'local-http' });
    const results = await Promise.all(Array.from({ length: 20 }, () => session.submit(job())));
    for (const result of results) { assert.equal(result.ok, true); assert.equal(result.receipt?.provenance, 'local-http'); assert.equal(result.receipt?.fresh_provider_call, false); }
    assert.equal(calls, 1);
    assert.deepEqual(session.usage(), { calls: 1, reserved_micro: 100 });
    assert.equal((await session.submit({ ...job(), task_input: { candidate_ids: ['candidate2'] } })).ok, false);
    assert.equal(calls, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('SS02 stale/auth/cap/rights/model failures give 0 fallback calls', async () => {
  let calls = 0;
  const transport: Transport = async () => { calls++; return Response.json({}); };
  const setup = createProviderSetup(env, approval(), () => now);
  const session = createSmokeSession(setup, { now: () => now, is_current: () => true, transport, transport_mode: 'fixture' });
  for (const input of [{ ...job(), max_call_micro: 101 }, { ...job(), model: 'projects/other/models/iris-latest' },
    { ...job(), snapshot: { ...snapshot(), evidence: [{ ...snapshot().evidence[0], rights_manifest_id: 'rights2' }] } },
    { ...job(), snapshot: { ...snapshot(), valid_until_ms: now } }]) assert.equal((await session.submit(input)).ok, false);
  assert.equal((await createSmokeSession(createProviderSetup({}, approval(), () => now), { now: () => now, is_current: () => true, transport, transport_mode: 'fixture' }).submit(job())).ok, false);
  assert.equal(calls, 0);
  assert.deepEqual(session.usage(), { calls: 0, reserved_micro: 0 });
});

test('SS03 live Iris hard-ceiling unsupported, default CLI and expired approval give 0 calls', async () => {
  const setup = createProviderSetup(env, approval(), () => now);
  assert.equal(setup.status().providers.find(provider => provider.provider === 'iris')?.status, 'unsupported');
  const session = createSmokeSession(setup, { now: () => now, is_current: () => true });
  const result = await session.submit(job());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'UNSUPPORTED');
  assert.deepEqual(session.usage(), { calls: 0, reserved_micro: 0 });
  const output: string[] = [];
  assert.equal(await runSmokeCli([], env, line => output.push(line)), 0);
  assert.equal(JSON.parse(output[0]).genuine_calls, 0);
  assert.equal(JSON.parse(output[0]).providers.length, 5);
});

test('SS04 20 sentinel secrets never appear in serialized config/status/CLI/errors', async () => {
  for (let n = 0; n < 20; n++) {
    const secret = `sk_sentinel_private_${n}_${'z'.repeat(48)}`;
    const privateEnv = { IRIS_API_KEY: secret, GEMINI_API_KEY: secret, FAL_KEY: secret, TREG_TOKEN: secret, FIRECRAWL_API_KEY: secret,
      IRIS_MODEL: secret, GEMINI_MODEL: secret, GEMMA_MODEL: secret };
    const setup = createProviderSetup(privateEnv, { ...approval(), authorization_id: secret }, () => now);
    const output: string[] = [];
    assert.equal(await runSmokeCli([], privateEnv, line => output.push(line)), 0);
    const result = await createSmokeSession(setup, { now: () => now, is_current: () => true }).submit(job());
    assert.equal(JSON.stringify([setup, setup.status(), output, result]).includes(secret), false);
  }
});

test('SS04 20 malformed jobs/evidence reject without throws, 0 transport/reservation', async () => {
  let calls = 0;
  const session = createSmokeSession(createProviderSetup(env, approval(), () => now), { now: () => now, is_current: () => true,
    transport: async () => { calls++; return Response.json({}); }, transport_mode: 'fixture' });
  const cases = [null, 1, false, [], {}, { ...job(), snapshot: null }, { ...job(), snapshot: { ...snapshot(), evidence: [null] } },
    { ...job(), snapshot: { ...snapshot(), evidence: [1] } }, { ...job(), task_input: null }, { ...job(), task_input: {} }];
  for (let n = 0; n < 20; n++) assert.equal((await session.submit(cases[n % cases.length])).ok, false);
  assert.equal(calls, 0);
  assert.deepEqual(session.usage(), { calls: 0, reserved_micro: 0 });
});

test('SS01 four authorized slots retain 3 hard-cap blocks, Treg explicit configured, Gemma not fifth', () => {
  const models = { iris: job().model, gemini: 'gemini-2.5-flash', fal: 'fal-ai/florence-2-large/caption', treg: 'treg.web.search' } as const;
  const grants = { ...approval(), max_calls: 4, max_total_micro: 400,
    adapters: (['iris', 'gemini', 'fal', 'treg'] as const).map(adapter => ({ ...approval().adapters[0], adapter, model: models[adapter] })) };
  const setup = createProviderSetup({ ...env, GEMINI_API_KEY: 'fixture-g', FAL_KEY: 'fixture-f', TREG_TOKEN: 'fixture-t' }, grants, () => now);
  assert.deepEqual(setup.status().providers.map(provider => provider.status), ['unsupported', 'unsupported', 'unsupported', 'configured', 'disabled']);
  assert.equal(setup.status().providers[4].blocker, 'adapter-unavailable');
  assert.equal(createProviderSetup(env, { ...grants, max_calls: 5 }, () => now).approval(), null);
});

test('SS04 expired captured approval and hostile env accessors invoke 0 calls/getters', async () => {
  let time = now;
  let calls = 0;
  const setup = createProviderSetup(env, approval(), () => time);
  const session = createSmokeSession(setup, { now: () => time, is_current: () => true,
    transport: async () => { calls++; return Response.json({}); }, transport_mode: 'fixture' });
  time += 6000;
  for (let n = 0; n < 20; n++) assert.equal((await session.submit(job())).ok, false);
  assert.deepEqual(session.usage(), { calls: 0, reserved_micro: 0 });
  let getters = 0;
  const hostile = Object.defineProperty({}, 'GEMINI_API_KEY', { get() { getters++; return 'private-fixture'; } });
  assert.equal(createProviderSetup(hostile).status().providers[1].credential_status, 'missing');
  assert.equal(getters, 0);
  assert.equal(calls, 0);
});
