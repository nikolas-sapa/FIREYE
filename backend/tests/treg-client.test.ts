import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTregClient, safeSourceUrl } from '../integrations/treg/client.ts';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { SponsorBudget } from '../integrations/receipts.ts';
import { createProviderSetup } from '../setup/provider-config.ts';
import { createSmokeSession } from '../scripts/sponsor-smoke.ts';
import { setTimeout as delay } from 'node:timers/promises';
import type { ClientConfig, Snapshot, Transport } from '../integrations/receipts.ts';

function snapshot(): Snapshot {
  const now = Date.now();
  return { incident_id: 'i1', run_id: 'r1', authority_epoch: 1, input_revision: 1, snapshot_id: 's1', received_cutoff_ms: now, valid_until_ms: now + 1000,
    evidence: [{ evidence_id: 'e1', source_id: 'source1', rights_manifest_id: 'rights1', source_kind: 'public-link', captured_at_ms: now - 10, received_at_ms: now - 5,
      modality: 'text', synthetic: false, radiometric: false, calibration: null, content_hash: createHash('sha256').update('fixture').digest('hex'), byte_length: 7, width_px: null, height_px: null }] };
}
function config(transport: Transport, extra: Partial<ClientConfig> = {}): ClientConfig { return { enabled: true, authorization_id: 'auth1', max_call_micro: 100, deadline_ms: 1000,
  budget: new SponsorBudget(100, 100_000), is_current: () => true, transport, transport_mode: 'fixture', ...extra }; }
const input = () => ({ snapshot: snapshot(), query: 'public wildfire incident' });

test('SP05 unsafe navigation links reject, 1 safe HTTPS positive', () => {
  for (const url of ['http://example.com', 'https://127.0.0.1', 'https://u:p@example.com', 'https://localhost', 'https://[::1]']) {
    assert.equal(safeSourceUrl(url), null);
  }
  assert.equal(safeSourceUrl('https://example.com/fire?q=private#fragment'), 'https://example.com/fire');
});

test('SP05 metadata-only known response <=5 unique links, no query/snippet/raw echo', async () => {
  let calls = 0;
  const raw = 'secret-raw-provider';
  const client = createTregClient(config(async request => {
    calls++;
    assert.deepEqual(JSON.parse(request.body), { q: 'public wildfire incident', limit: 5, contents: false });
    assert.equal(request.headers['X-Treg-Route-Waterfall'], '0');
    assert.equal(request.redirect, 'error');
    return Response.json({ output: { results: Array.from({ length: 10 }, (_, n) => ({ url: `https://news.example.com/fire${n}?query=raw`, title: raw, snippet: raw })) }, raw, _treg: {} },
      { headers: { 'X-Treg-Cost-Micro': '50', 'X-Treg-Call-Id': 'call1', 'X-Treg-Served-By': 'exa.web.search' } });
  }));
  const result = await client.analyze(input());
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.value.urls.length, 5); assert.equal(result.value.served_by, 'exa.web.search'); }
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes(raw), false);
  assert.equal(JSON.stringify(result).includes('public wildfire incident'), false);
  assert.equal(result.receipt?.cost_micro, 50);
  assert.equal(result.receipt?.invocation_id, 'call1');
});

test('SP05 empty results mean 0 sources; unsupported provider-native shape rejects', async () => {
  const empty = await createTregClient(config(async () => Response.json({ output: { results: [] } }))).analyze(input());
  assert.equal(empty.ok, true);
  if (empty.ok) assert.deepEqual(empty.value.urls, []);
  assert.equal((await createTregClient(config(async () => Response.json({ output: { results: [{ link: 'https://example.com' }] } }))).analyze(input())).ok, false);
});

test('SP05 redirect/oversize declared/streamed payload reject 3/3, 0 retries', async () => {
  const responses = [new Response(null, { status: 302, headers: { location: 'http://localhost' } }),
    new Response('{}', { headers: { 'content-length': '262145' } }), new Response('x'.repeat(262145))];
  let calls = 0;
  for (const response of responses) {
    const result = await createTregClient(config(async () => { calls++; return response; })).analyze(input());
    assert.equal(result.ok, false);
  }
  assert.equal(calls, 3);
});

test('SP05 20 stale/TTL>60s requests issue 0 transports', async () => {
  let calls = 0;
  const client = createTregClient(config(async () => { calls++; return Response.json({ output: { results: [] } }); }));
  for (let n = 0; n < 20; n++) {
    const request = input();
    const invalid = { ...request, snapshot: { ...request.snapshot, valid_until_ms: n % 2 ? Date.now() - 1 : request.snapshot.received_cutoff_ms + 60_001 } };
    assert.equal((await client.analyze(invalid)).ok, false);
  }
  assert.equal(calls, 0);
});

test('SP05 20 unsafe/secret paths serialize 0 dangerous links', () => {
  const urls = ['https://127.1', 'https://2130706433', 'https://169.254.169.254', 'https://10.0.0.1', 'https://[::ffff:127.0.0.1]',
    'https://site.local', 'https://site.internal', 'https://example.com:8080', 'file:///etc/passwd', 'javascript:alert(1)',
    'https://example.com/api_key/private', 'https://example.com/%74oken/private', 'https://example.com/secret', 'https://example.com/password',
    'https://user@example.com', 'https://example.com\\@localhost', 'https://example.com/%zz', 'https://example.com/sk_private', 'https://localhost.', 'https://a.onion'];
  for (const url of urls) assert.equal(safeSourceUrl(url), null, url);
});

test('SP05 <=10s cap, 10ms deadline, physical transport held until settled, 0 retries', async () => {
  let calls = 0;
  const budget = new SponsorBudget(10, 1000);
  let release!: () => void;
  const client = createTregClient(config(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); return Response.json({ output: { results: [] } }); }, { deadline_ms: 10, budget }));
  const result = await client.analyze(input());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'DEADLINE');
  assert.equal(calls, 1);
  assert.equal(budget.inFlight(), 1);
  release();
  await delay(1);
  assert.equal(budget.inFlight(), 0);
  assert.equal((await createTregClient(config(async () => { calls++; return Response.json({}); }, { deadline_ms: 10_001 })).analyze(input())).ok, false);
  assert.equal(calls, 1);
});

const exactCaps = [...Array.from({ length: 20 }, (_, n) => Number.MAX_SAFE_INTEGER - n),
  1, 9, 99, 999999, 1000000, 1000001, 100, 100000000];
for (const cap of exactCaps) {
  test(`TC-CAP-EXACT ${cap} micro, six decimals, 1 reservation, 0 over/under/native calls`, async t => {
    const nativeFetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Native provider call forbidden'); });
    const request = input();
    const budget = new SponsorBudget(1, cap);
    let calls = 0;
    let header = '';
    const client = createTregClient(config(async outgoing => {
      calls++;
      assert.equal(outgoing.url, 'https://treg.to/call/treg.web.search');
      assert.equal(outgoing.headers['X-Treg-Route-Waterfall'], '0');
      assert.equal(outgoing.headers['X-Treg-Token'], undefined);
      assert.equal(outgoing.redirect, 'error');
      header = outgoing.headers['X-Treg-Route-Max-Cost'];
      return Response.json({ output: { results: [] } });
    }, { max_call_micro: cap, budget, now: () => request.snapshot.received_cutoff_ms }));
    const result = await client.analyze(request);
    assert.equal(result.ok, true);
    assert.equal(result.receipt?.reserved_micro, cap);
    assert.equal(result.receipt?.provenance, 'fixture');
    assert.equal(result.receipt?.fresh_provider_call, false);
    assert.equal(calls, 1);
    assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: cap });
    assert.equal(budget.inFlight(), 0);
    assert.equal(nativeFetch.mock.calls.length, 0);
    assert.match(header, /^\d+\.\d{6}$/);
    const [whole, fraction] = header.split('.');
    assert.equal(BigInt(whole) * 1_000_000n + BigInt(fraction), BigInt(cap));
  });
}

test('TC-CAP-SETUP max-safe setup/smoke/client -> 1 localhost request/reservation, 0 native calls', async t => {
  const localFetch = globalThis.fetch;
  const nativeFetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Native provider call forbidden'); });
  let requests = 0;
  let capHeader: string | string[] | undefined;
  let waterfall: string | string[] | undefined;
  let credential: string | string[] | undefined;
  let body = '';
  const server = createServer((request, response) => {
    requests++;
    capHeader = request.headers['x-treg-route-max-cost'];
    waterfall = request.headers['x-treg-route-waterfall'];
    credential = request.headers['x-treg-token'];
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'X-Treg-Cost-Micro': '50', 'X-Treg-Call-Id': 'cap1' });
      response.end(JSON.stringify({ output: { results: [] } }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const localUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = input();
    const now = request.snapshot.received_cutoff_ms;
    const cap = Number.MAX_SAFE_INTEGER;
    const setup = createProviderSetup({ TREG_TOKEN: 'fixture-only' }, {
      authorization_id: 'auth-cap', expires_at_ms: now + 1000, max_calls: 1, max_total_micro: cap,
      adapters: [{ adapter: 'treg', model: 'treg.web.search', task_version: 'source-v1', rights_manifest_ids: ['rights1'], max_call_micro: cap, deadline_ms: 1000 }],
    }, () => now);
    assert.equal(setup.approval()?.max_total_micro, cap);
    let calls = 0;
    const session = createSmokeSession(setup, { now: () => now, is_current: () => true, transport_mode: 'local-http', transport: outgoing => {
      calls++;
      assert.equal(outgoing.url, 'https://treg.to/call/treg.web.search');
      assert.equal(outgoing.redirect, 'error');
      return localFetch(localUrl, { method: outgoing.method, headers: outgoing.headers, body: outgoing.body, signal: outgoing.signal, redirect: outgoing.redirect });
    } });
    const result = await session.submit({ job_id: 'job-cap', adapter: 'treg', model: 'treg.web.search', task_version: 'source-v1',
      snapshot: request.snapshot, deadline_at_ms: now + 1000, max_call_micro: cap, task_input: { query: request.query } });
    assert.equal(result.ok, true);
    assert.equal(result.receipt?.reserved_micro, cap);
    assert.equal(result.receipt?.provenance, 'local-http');
    assert.equal(result.receipt?.fresh_provider_call, false);
    assert.equal(result.receipt?.invocation_id, 'cap1');
    assert.equal(result.receipt?.cost_micro, 50);
    assert.equal(calls, 1);
    assert.equal(requests, 1);
    assert.deepEqual(session.usage(), { calls: 1, reserved_micro: cap });
    assert.equal(nativeFetch.mock.calls.length, 0);
    assert.deepEqual(JSON.parse(body), { q: request.query, limit: 5, contents: false });
    assert.equal(waterfall, '0');
    assert.equal(credential, undefined);
    assert.equal(capHeader, '9007199254.740991');
    assert.ok(typeof capHeader === 'string');
    const [whole, fraction] = capHeader.split('.');
    assert.equal(BigInt(whole) * 1_000_000n + BigInt(fraction), BigInt(cap));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
