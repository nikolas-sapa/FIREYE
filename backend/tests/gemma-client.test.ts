import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createGemmaClient } from '../integrations/gemma/client.ts';
import { SponsorBudget, serverReceipt } from '../integrations/receipts.ts';
import type { Snapshot, Transport, TransportRequest } from '../integrations/receipts.ts';
import type { GemmaConfig, GemmaInput } from '../integrations/gemma/types.ts';

const model = 'gemma-4-31b-it';

test('G402 post-race Gemma microtask supersession delivers 0 successful results', async () => {
  let current = true;
  let checks = 0;
  let calls = 0;
  const result = await createGemmaClient(config(async () => { calls++; return Response.json(reply()); }, {
    is_current: () => {
      checks++;
      if (checks === 2) queueMicrotask(() => { current = false; });
      return current;
    },
  })).analyze(input());
  assert.equal(current, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'STALE');
  assert.equal(result.receipt?.status, 'STALE');
  assert.ok(serverReceipt(result.receipt));
  assert.equal(calls, 1);
});

test('G402 post-race Gemma microtask expiry delivers 0 successes at deadline', async () => {
  let checks = 0;
  let wall = Date.now();
  const result = await createGemmaClient(config(async () => Response.json(reply()), {
    now: () => wall, deadline_ms: 1000,
    is_current: () => {
      if (++checks === 2) queueMicrotask(() => { wall += 1000; });
      return true;
    },
  })).analyze(input());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'DEADLINE');
  assert.equal(result.receipt?.status, 'DEADLINE');
  assert.ok(serverReceipt(result.receipt));
});
const text = 'Exercise source reports smoke. Claim remains unverified.';
function input(value = text): GemmaInput {
  const now = Date.now();
  const bytes = Buffer.from(value, 'utf8');
  const snapshot: Snapshot = {
    incident_id: 'i1', run_id: 'r1', authority_epoch: 1, input_revision: 1, snapshot_id: 's1',
    received_cutoff_ms: now, valid_until_ms: now + 5000,
    evidence: [{ evidence_id: 'e1', source_id: 'source1', rights_manifest_id: 'rights1', source_kind: 'simulated',
      captured_at_ms: now - 10, received_at_ms: now - 5, modality: 'text', synthetic: true,
      radiometric: false, calibration: null, content_hash: createHash('sha256').update(bytes).digest('hex'),
      byte_length: bytes.length, width_px: null, height_px: null }],
  };
  return { snapshot, evidence_id: 'e1', text: value };
}
function reply(decoded: unknown = { hypotheses: ['fire'], synthesis: 'review-required' }): unknown {
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(decoded) }] } }] };
}
function config(transport: Transport, extra: Partial<GemmaConfig> = {}): GemmaConfig {
  return { enabled: true, authorization_id: 'auth1', runtime: 'hosted-rest', model, max_call_micro: 100,
    deadline_ms: 1000, budget: new SponsorBudget(100, 100_000), is_current: () => true,
    transport, transport_mode: 'fixture', ...extra };
}

test('G401 20 missing/invalid gates and 20 unsupported IDs issue 0 transports', async () => {
  let calls = 0;
  const transport: Transport = async () => { calls++; return Response.json(reply()); };
  const missing: Partial<GemmaConfig>[] = [
    { enabled: undefined }, { enabled: false }, { authorization_id: undefined }, { authorization_id: '' },
    { max_call_micro: undefined }, { max_call_micro: 0 }, { max_call_micro: -1 }, { max_call_micro: Infinity },
    { deadline_ms: undefined }, { deadline_ms: 0 }, { deadline_ms: -1 }, { deadline_ms: 10_001 },
    { budget: undefined }, { is_current: undefined }, { runtime: undefined },
    { runtime: 'local' as GemmaConfig['runtime'] }, { model: undefined }, { model: '' },
    { transport_mode: undefined }, { transport_mode: 'provider' as GemmaConfig['transport_mode'] },
  ];
  for (const extra of missing) assert.equal((await createGemmaClient(config(transport, extra)).analyze(input())).ok, false);
  for (let n = 0; n < 20; n++) {
    const unsupported = ['gemini-2.5-flash', 'gemma-4-4b-it', 'gemma-3-27b-it', 'models/gemma-4-31b-it', `gemma-4-31b-it-${n}`][n % 5];
    const result = await createGemmaClient(config(transport, { model: unsupported })).analyze(input());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'UNSUPPORTED');
  }
  assert.deepEqual(await createGemmaClient().analyze({}), { ok: false, code: 'DISABLED' });
  const provider = await createGemmaClient({ ...config(transport), transport: undefined, transport_mode: undefined, credential: 'not-used' }).analyze(input());
  assert.deepEqual(provider, { ok: false, code: 'UNSUPPORTED' });
  assert.equal(calls, 0);
});

test('G402 10 text fixtures preserve exact model, provenance and typed unverified output', async () => {
  let calls = 0;
  for (let n = 0; n < 10; n++) {
    const selected = n % 2 ? 'gemma-4-26b-a4b-it' : model;
    const value = input(`${text} Fixture ${n}.`);
    const result = await createGemmaClient(config(async request => {
      calls++;
      assert.equal(request.url, `https://generativelanguage.googleapis.com/v1beta/models/${selected}:generateContent`);
      assert.equal(request.method, 'POST');
      assert.equal(request.redirect, 'error');
      assert.equal(Object.keys(request.headers).length, 1);
      const body = JSON.parse(request.body);
      assert.deepEqual(Object.keys(body).sort(), ['contents', 'generationConfig']);
      assert.deepEqual(body.generationConfig, { maxOutputTokens: 512 });
      assert.equal(body.contents.length, 1);
      assert.equal(body.contents[0].parts.length, 1);
      assert.deepEqual(Object.keys(body.contents[0].parts[0]), ['text']);
      assert.ok(body.contents[0].parts[0].text.includes(value.text));
      assert.ok(body.contents[0].parts[0].text.includes('rights1'));
      return Response.json(reply());
    }, { model: selected })).analyze(value);
    assert.equal(result.ok, true);
    if (!result.ok) throw Error('expected typed result');
    assert.deepEqual(result.value, { kind: 'evidence-analysis', verification_status: 'unverified', evidence_ids: ['e1'], hypotheses: ['fire'], synthesis: 'review-required' });
    assert.equal(result.receipt?.adapter, 'gemma');
    assert.equal(result.receipt?.model, selected);
    assert.equal(result.receipt?.provenance, 'fixture');
    assert.equal(result.receipt?.fresh_provider_call, false);
    assert.ok(serverReceipt(result.receipt));
    assert.ok(Object.isFrozen(result.value.hypotheses));
  }
  assert.equal(calls, 10);
});

test('G402 20 malformed/tool-command/unknown-ID/superseded replies accept 0 results', async () => {
  const malformed = [null, {}, { candidates: [] }, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] }, reply({ hypotheses: ['fire', 'fire'], synthesis: 'review-required' })];
  const tools = [
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'approve', args: {} } }] } }] },
    reply({ hypotheses: ['fire'], synthesis: 'review-required', tool: 'execute' }),
    reply({ hypotheses: ['fire'], synthesis: 'approve-command' }),
    reply({ hypotheses: ['fire'], synthesis: 'review-required', coordinates: [0, 0] }),
    reply({ hypotheses: ['fire'], synthesis: 'review-required', approval: true }),
  ];
  const unknown = [reply({ hypotheses: ['unknown'], synthesis: 'review-required' }),
    reply({ hypotheses: ['e404'], synthesis: 'review-required' }), reply({ hypotheses: ['fire'], synthesis: 'review-required', evidence_ids: ['e404'] }),
    reply({ hypotheses: ['fire'], synthesis: 'review-required', model: 'gemini-2.5-flash' }), reply({ hypotheses: ['fire'], synthesis: 'unknown' })];
  for (const response of [...malformed, ...tools, ...unknown]) {
    const result = await createGemmaClient(config(async () => Response.json(response))).analyze(input());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'INVALID_REPLY');
  }
  for (let n = 0; n < 5; n++) {
    let current = true;
    const result = await createGemmaClient(config(async () => { current = false; return Response.json(reply()); }, { is_current: () => current })).analyze(input());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'STALE');
  }
});

test('G402 3 array-coerced synthesis values accept 0 results', async () => {
  for (const synthesis of [['review-required'], [['insufficient-evidence']], ['review-required', 'insufficient-evidence']]) {
    const result = await createGemmaClient(config(async () => Response.json(reply({ hypotheses: ['fire'], synthesis })))).analyze(input());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'INVALID_REPLY');
  }
});

test('G403 20 hidden/unknown input fields and hostile values issue 0 transports/getter reads', async () => {
  let calls = 0;
  let reads = 0;
  const client = createGemmaClient(config(async () => { calls++; return Response.json(reply()); }));
  for (let n = 0; n < 20; n++) {
    const key = ['hidden_world_labels', 'planted_mask', 'true_target_coordinates', 'future_received_facts'][n % 4];
    assert.equal((await client.analyze({ ...input(), [key]: 'evaluator-only' })).ok, false);
  }
  const accessor = input();
  Object.defineProperty(accessor, 'text', { enumerable: true, get() { reads++; return text; } });
  const proxy = new Proxy(input(), { get() { reads++; throw Error('no read'); } });
  const snapshotField = input();
  for (const value of [accessor, proxy, { ...snapshotField, snapshot: { ...snapshotField.snapshot, hidden_world_labels: 'private' } }]) assert.equal((await client.analyze(value)).ok, false);
  assert.equal(calls, 0);
  assert.equal(reads, 0);
});

test('G403 12 text/hash/modality/time/currentness input failures issue 0 transports', async () => {
  let calls = 0;
  const transport: Transport = async () => { calls++; return Response.json(reply()); };
  const value = input();
  const evidence = value.snapshot.evidence[0];
  const altered = (extra: object) => ({ ...value, snapshot: { ...value.snapshot, evidence: [{ ...evidence, ...extra }] } });
  const invalid = [input(''), input('   '), input('x'.repeat(16_385)), input('\ud800'),
    { ...value, text: `${text} changed` }, { ...value, evidence_id: 'e404' }, altered({ modality: 'eo' }),
    altered({ width_px: 1 }), altered({ content_hash: 'a'.repeat(64) }), altered({ captured_at_ms: null }),
    { ...value, snapshot: { ...value.snapshot, valid_until_ms: Date.now() - 1 } },
    { ...value, snapshot: { ...value.snapshot, evidence: [evidence, { ...evidence, evidence_id: 'e2' }] } },
  ];
  for (const malformed of invalid) assert.equal((await createGemmaClient(config(transport)).analyze(malformed)).ok, false);
  assert.deepEqual(await createGemmaClient(config(transport, { is_current: () => false })).analyze(value), { ok: false, code: 'STALE' });
  assert.equal(calls, 0);
});

test('G403 20 errors serialize 0 credential/raw strings, oversized/redirect replies reject', async () => {
  for (let n = 0; n < 20; n++) {
    const secret = `secret-raw-provider-message-${n}`;
    const response = n % 2 ? async () => { throw Error(secret); } : async () => Response.json(reply({ hypotheses: [], synthesis: secret }));
    const result = await createGemmaClient(config(response, { credential: secret })).analyze(input());
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
  for (const [response, code] of [[new Response('x'.repeat(262_145)), 'OVERSIZE'], [new Response('', { status: 302, headers: { location: 'https://example.com' } }), 'REDIRECT']] as const) {
    const result = await createGemmaClient(config(async () => response)).analyze(input());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, code);
  }
});

test('G403 3 concurrent invocations start 2 attempts, queue 0; deadline aborts 1 attempt', async () => {
  let calls = 0;
  const releases: (() => void)[] = [];
  const budget = new SponsorBudget(10, 1000);
  const client = createGemmaClient(config(async () => {
    calls++;
    await new Promise<void>(resolve => releases.push(resolve));
    return Response.json(reply());
  }, { budget }));
  const first = client.analyze(input());
  const second = client.analyze(input());
  assert.deepEqual(await client.analyze(input()), { ok: false, code: 'BUDGET' });
  assert.equal(budget.inFlight(), 2);
  assert.equal(calls, 2);
  releases.forEach(release => release());
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(budget.inFlight(), 0);
  let aborted = false;
  const late = await createGemmaClient(config(request => new Promise((_, reject) => {
    calls++;
    request.signal.addEventListener('abort', () => { aborted = true; reject(Error('cancelled')); }, { once: true });
  }), { deadline_ms: 10 })).analyze(input());
  assert.equal(late.ok, false);
  if (!late.ok) assert.equal(late.code, 'DEADLINE');
  assert.equal(aborted, true);
  assert.equal(calls, 3);
});

test('G404 actual exported Gemma client traverses 1 non-mocked loopback HTTP, 0 providers', async () => {
  let calls = 0;
  let observed: TransportRequest | undefined;
  const server = createServer(async (req, res) => {
    calls++;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.deepEqual(Object.keys(body.contents[0].parts[0]), ['text']);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(reply()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const transport: Transport = request => {
      observed = request;
      return fetch(`http://127.0.0.1:${address.port}/fixture`, { method: request.method, body: request.body,
        headers: request.headers, signal: request.signal, redirect: request.redirect });
    };
    const result = await createGemmaClient(config(transport, { transport_mode: 'local-http' })).analyze(input());
    assert.equal(result.ok, true);
    assert.equal(result.receipt?.provenance, 'local-http');
    assert.equal(result.receipt?.fresh_provider_call, false);
    assert.equal(result.receipt?.invocation_id, null);
    assert.equal(result.receipt?.cost_micro, null);
    assert.equal(observed?.url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    assert.equal(calls, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
