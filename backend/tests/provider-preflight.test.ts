import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createProviderActivation } from '../setup/activation-status.ts';
import type { CheckOptions } from '../setup/activation-status.ts';
import { runPreflightCli } from '../scripts/provider-preflight.ts';

test('ACT01 20 disabled checks, dry CLI and unknown providers invoke 0 transports', async () => {
  let calls = 0;
  const activation = createProviderActivation({ GEMINI_API_KEY: 'private-fixture' });
  for (let n = 0; n < 20; n++) await activation.check(n % 2 ? 'gemini' : 'unknown', {
    enabled: false, transport: async () => { calls++; return Response.json({ models: [] }); },
  });
  const output: string[] = [];
  for (const args of [[], ['--status']]) assert.equal(await runPreflightCli(args, {}, line => output.push(line)), 0);
  assert.equal(output.length, 2);
  assert.equal(calls, 0);
  assert.equal(activation.status().genuine_calls, 0);
  assert.equal(activation.status().counts.auth_verified, 0);
  assert.equal(activation.status().providers.every(provider => !provider.active), true);
});

test('ACT02 20 malformed/secret/accessor fixtures leak/throw/read 0', async () => {
  let getters = 0;
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('private-trap'); } });
  const accessor = Object.defineProperty({}, 'GEMINI_API_KEY', { get() { getters++; throw new Error('private-getter'); } });
  for (let n = 0; n < 20; n++) {
    const secret = `sk_private_sentinel_${n}_${'z'.repeat(48)}`;
    const env = [null, 1, proxy, accessor, { GEMINI_API_KEY: secret, GEMINI_MODEL: secret }][n % 5];
    const activation = createProviderActivation(env);
    await activation.check('gemini', { enabled: true, transport: async () => { throw new Error(secret); } });
    const hostileOptions = [null, 1, proxy, Object.defineProperty({}, 'enabled', { get() { getters++; throw new Error(secret); } })][n % 4];
    await activation.check('gemini', hostileOptions as CheckOptions);
    const output: string[] = [];
    assert.equal(await runPreflightCli(['--check', secret], env, line => output.push(line)), 2);
    assert.equal(JSON.stringify([activation, activation.status(), output]).includes(secret), false);
  }
  assert.equal(getters, 0);
});

test('ACT03 one actual localhost GET health path remains local-only, fixed URL/header/redirect guard', async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    calls++;
    assert.equal(request.url, '/health');
    assert.equal(request.method, 'GET');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const activation = createProviderActivation({ GEMINI_API_KEY: 'private-fixture', GEMINI_MODEL: 'gemini-2.5-flash' });
    const report = await activation.check('gemini', { enabled: true, transport: request => {
      assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models');
      assert.equal(request.headers['x-goog-api-key'], 'private-fixture');
      assert.equal(request.redirect, 'error');
      return fetch(`http://127.0.0.1:${address.port}/health`, { method: request.method, signal: request.signal });
    } });
    assert.equal(report.providers.find(provider => provider.provider === 'gemini')?.auth_status, 'local-check-only');
    assert.equal(report.counts.auth_verified, 0);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify(report).includes('private-fixture'), false);
    const redirected = await activation.check('gemini', { enabled: true, transport: async () => new Response(null, { status: 302 }) });
    assert.equal(redirected.providers.find(provider => provider.provider === 'gemini')?.auth_status, 'failed');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('ACT04 caps/credentials/unsupported distinct, existing live hard ceiling remains 3', () => {
  const now = 1_800_000_000_000;
  const models = { iris: 'projects/exercise/models/iris-latest', gemini: 'gemini-2.5-flash', fal: 'fal-ai/florence-2-large/caption', treg: 'treg.web.search' };
  const approval = { authorization_id: 'approval1', expires_at_ms: now + 5000, max_calls: 4, max_total_micro: 400,
    adapters: (['iris', 'gemini', 'fal', 'treg'] as const).map(adapter => ({ adapter, model: models[adapter], task_version: 'task1',
      rights_manifest_ids: ['rights1'], max_call_micro: 100, deadline_ms: 1000 })) };
  const report = createProviderActivation({ IRIS_API_KEY: 'fixture-i', GEMINI_API_KEY: 'fixture-g', FAL_KEY: 'fixture-f', TREG_TOKEN: 'fixture-t' }, approval, () => now).status();
  assert.equal(report.providers.filter(provider => provider.budget_gap === 'hard-ceiling-unsupported').length, 3);
  assert.equal(report.counts.cap_missing, 2);
  assert.equal(report.counts.configured, 4);
  assert.equal(report.providers.every(provider => !provider.active), true);
  const missing = createProviderActivation({}).status();
  assert.equal(missing.providers.find(provider => provider.provider === 'iris')?.credential_status, 'missing');
  assert.equal(missing.providers.find(provider => provider.provider === 'iris')?.configuration_status, 'disabled');
  assert.equal(missing.providers.find(provider => provider.provider === 'firecrawl')?.configuration_status, 'disabled');
});

test('ACT03 20 unsupported providers/absent credentials make 0 calls, malformed replies never verify', async () => {
  let calls = 0;
  const transport = async () => { calls++; return Response.json({}); };
  for (let n = 0; n < 20; n++) {
    const activation = createProviderActivation({});
    await activation.check(n % 2 ? 'gemini' : 'iris', { enabled: true, transport });
    assert.equal(activation.status().counts.auth_verified, 0);
  }
  assert.equal(calls, 0);
  for (const body of [{}, null, [], { models: [null] }, { models: [{ name: 'sk_secret_invalid' }] }]) {
    const report = await createProviderActivation({ GEMINI_API_KEY: 'private-fixture' }).check('gemini', { enabled: true,
      transport: async () => Response.json(body) });
    assert.equal(report.providers.find(row => row.provider === 'gemini')?.auth_status, 'failed');
    assert.equal(report.counts.auth_verified, 0);
  }
});

test('ACT03 hung read-only transport resolves failed by 5500ms, late body yields 0 verified', async () => {
  const activation = createProviderActivation({ GEMINI_API_KEY: 'private-fixture' });
  const start = performance.now();
  const report = await activation.check('gemini', { enabled: true, transport: () => new Promise<Response>(() => {}) });
  assert.ok(performance.now() - start < 5500);
  assert.equal(report.providers.find(row => row.provider === 'gemini')?.auth_status, 'failed');
  assert.equal(report.counts.auth_verified, 0);
  assert.equal(report.genuine_calls, 0);
});
