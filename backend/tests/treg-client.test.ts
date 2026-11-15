import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTregClient, safeSourceUrl } from '../integrations/treg/client.ts';
import { createHash } from 'node:crypto';
import { SponsorBudget } from '../integrations/receipts.ts';
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
