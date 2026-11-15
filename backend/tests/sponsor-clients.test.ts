import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIrisClient } from '../integrations/iris/client.ts';
import { createGeminiClient } from '../integrations/gemini/client.ts';
import { createFalClient } from '../integrations/fal/client.ts';
import { createTregClient } from '../integrations/treg/client.ts';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { SponsorBudget } from '../integrations/receipts.ts';
import type { ClientConfig, Evidence, Snapshot, Transport, TransportRequest } from '../integrations/receipts.ts';

export const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
export function snapshot(text = false): Snapshot {
  const now = Date.now();
  const bytes = Buffer.from(png, 'base64');
  const evidence: Evidence = {
    evidence_id: 'e1', source_id: 'source1', rights_manifest_id: 'rights1', source_kind: text ? 'public-link' : 'simulated',
    captured_at_ms: now - 10, received_at_ms: now - 5, modality: text ? 'text' : 'eo', synthetic: !text,
    radiometric: false, calibration: null, content_hash: createHash('sha256').update(bytes).digest('hex'), byte_length: bytes.length,
    width_px: text ? null : 1, height_px: text ? null : 1,
  };
  return { incident_id: 'i1', run_id: 'r1', authority_epoch: 1, input_revision: 1, snapshot_id: 's1', received_cutoff_ms: now, valid_until_ms: now + 1000, evidence: [evidence] };
}
export function config(transport: Transport, extra: Partial<ClientConfig> = {}): ClientConfig {
  return { enabled: true, authorization_id: 'auth1', max_call_micro: 100, deadline_ms: 1000, budget: new SponsorBudget(100, 100_000),
    is_current: () => true, transport, transport_mode: 'fixture', ...extra };
}
export const irisReply = { model: 'projects/public-fixture/models/iris-latest', answers: { ranking: { choice: 'c1', probabilities: { c1: 0.8, c2: 0.2 }, confidence: 0.8 } }, usage: { inputTokens: 10, outputTokens: 0 } };
export const geminiReply = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ hypotheses: ['fire'], synthesis: 'review-required' }) }] } }] };
export const falReply = { results: 'Smoke is visible in an exercise scene.' };
export const tregReply = { output: { results: [{ url: 'https://example.com/fire' }] }, raw: { snippet: 'untrusted raw' }, _treg: {} };
export const adapters = [
  { create: createIrisClient, input: () => ({ snapshot: snapshot(), candidate_ids: ['c1', 'c2'] }), reply: irisReply, extra: { model: irisReply.model, registered_candidate_ids: ['c1', 'c2'] } },
  { create: createGeminiClient, input: () => ({ snapshot: snapshot(), evidence_id: 'e1', png_base64: png }), reply: geminiReply, extra: { model: 'gemini-2.5-flash' } },
  { create: createFalClient, input: () => ({ snapshot: snapshot(), evidence_id: 'e1', png_base64: png }), reply: falReply, extra: { model: 'fal-ai/florence-2-large/caption' } },
  { create: createTregClient, input: () => ({ snapshot: snapshot(true), query: 'public wildfire incident' }), reply: tregReply, extra: {} },
] as const;

test('SP01 four default factories issue 0 transport calls', async () => {
  let calls = 0;
  const transport = async () => { calls++; return Response.json({}); };
  for (const create of [createIrisClient, createGeminiClient, createFalClient, createTregClient]) {
    const client = create({ transport, transport_mode: 'fixture' });
    assert.equal((await client.analyze({})).ok, false);
  }
  assert.equal(calls, 0);
});

test('SP01 four known-positive clients and 40 malformed replies', async () => {
  for (const adapter of adapters) {
    let calls = 0;
    const transport: Transport = async () => { calls++; return Response.json(adapter.reply); };
    const result = await adapter.create(config(transport, adapter.extra)).analyze(adapter.input());
    assert.equal(result.ok, true);
    assert.equal(calls, 1);
    assert.equal(result.receipt?.provenance, 'fixture');
    assert.equal(result.receipt?.fresh_provider_call, false);
    assert.ok(Object.isFrozen(result));
    for (const malformed of [null, [], {}, 1, 'text', true, { results: 2 }, { output: null }, { candidates: [] }, { answers: {} }]) {
      assert.equal((await adapter.create(config(async () => Response.json(malformed), adapter.extra)).analyze(adapter.input())).ok, false);
    }
  }
});

test('SP01 4 adapters absent/zero/negative/nonfinite caps authorize 0 transport calls', async () => {
  let calls = 0;
  for (const adapter of adapters) for (const cap of [undefined, 0, -1, NaN, Infinity]) {
    const client = adapter.create(config(async () => { calls++; return Response.json(adapter.reply); }, { ...adapter.extra, max_call_micro: cap }));
    assert.equal((await client.analyze(adapter.input())).ok, false);
  }
  assert.equal(calls, 0);
});

test('SP02 20 late cross-run/epoch/revision/stale replies accept 0 outputs', async () => {
  for (let n = 0; n < 20; n++) {
    const adapter = adapters[n % 4];
    let current = true;
    const input = adapter.input();
    const client = adapter.create(config(async () => { current = false; return Response.json(adapter.reply); }, { ...adapter.extra, is_current: () => current }));
    const result = await client.analyze(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'STALE');
  }
});

test('SP02 20 unknown candidate/nonfinite Iris replies accept 0 rankings', async () => {
  for (let n = 0; n < 20; n++) {
    const reply = n % 2 ? { ...irisReply, answers: { ranking: { choice: 'unknown', probabilities: { c1: 0.8, c2: 0.2 }, confidence: 0.8 } } }
      : { ...irisReply, answers: { ranking: { choice: 'c1', probabilities: { c1: null, c2: 0.2 }, confidence: 0.8 } } };
    assert.equal((await createIrisClient(config(async () => Response.json(reply), adapters[0].extra)).analyze(adapters[0].input())).ok, false);
  }
});

test('SP04 20 raw secret errors serialize 0 supplied strings', async () => {
  for (let n = 0; n < 20; n++) {
    const secret = `secret-raw-provider-message-${n}`;
    const adapter = adapters[n % 4];
    const client = adapter.create(config(async () => { throw new Error(secret); }, adapter.extra));
    const result = await client.analyze(adapter.input());
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('SP04 20 hidden labels/masks/coordinates/future fields invoke 0 transports', async () => {
  let calls = 0;
  for (let n = 0; n < 20; n++) {
    const adapter = adapters[n % 4];
    const key = ['hidden_world_labels', 'planted_mask', 'true_target_coordinates', 'future_received_facts'][n % 4];
    const input = { ...adapter.input(), [key]: 'evaluator-only' };
    const client = adapter.create(config(async () => { calls++; return Response.json(adapter.reply); }, adapter.extra));
    assert.equal((await client.analyze(input)).ok, false);
  }
  assert.equal(calls, 0);
});

test('SP04 accessors/proxies reject with 0 getter/trap reads, thermal/media/hash mismatches reject', async () => {
  let reads = 0;
  let calls = 0;
  const client = createGeminiClient(config(async () => { calls++; return Response.json(geminiReply); }, adapters[1].extra));
  const accessor = adapters[1].input();
  Object.defineProperty(accessor, 'evidence_id', { enumerable: true, get() { reads++; return 'e1'; } });
  const proxy = new Proxy(adapters[1].input(), { get() { reads++; throw Error('no read'); } });
  const valid = adapters[1].input();
  for (const input of [accessor, proxy, { ...valid, png_base64: 'bad' }, { ...valid, snapshot: { ...valid.snapshot, evidence: [{ ...valid.snapshot.evidence[0], modality: 'thermal' }] } },
    { ...valid, snapshot: { ...valid.snapshot, evidence: [{ ...valid.snapshot.evidence[0], content_hash: 'a'.repeat(64) }] } }]) assert.equal((await client.analyze(input)).ok, false);
  assert.equal(reads, 0);
  assert.equal(calls, 0);
});

test('SP06 four actual exported clients traverse non-mocked loopback HTTP, 0 genuine provider calls', async () => {
  const observed: { request: TransportRequest; body: unknown }[] = [];
  for (const adapter of adapters) {
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      observed[observed.length - 1].body = JSON.parse(Buffer.concat(chunks).toString());
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(adapter.reply));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const transport: Transport = request => {
        observed.push({ request, body: null });
        return fetch(`http://127.0.0.1:${address.port}/fixture`, { method: request.method, body: request.body, headers: request.headers, signal: request.signal, redirect: request.redirect });
      };
      const result = await adapter.create(config(transport, { ...adapter.extra, transport_mode: 'local-http' })).analyze(adapter.input());
      assert.equal(result.ok, true);
      assert.equal(result.receipt?.provenance, 'local-http');
      assert.equal(result.receipt?.fresh_provider_call, false);
      assert.equal(result.receipt?.invocation_id, null);
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  }
  assert.equal(observed.length, 4);
  assert.equal(observed[0].request.url, 'https://inference.oumi.ai/v1/systemone');
  assert.equal(observed[1].request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.deepEqual((observed[2].body as { image_url: string }).image_url, `data:image/png;base64,${png}`);
  assert.deepEqual(observed[3].body, { q: 'public wildfire incident', limit: 5, contents: false });
  assert.equal(observed[3].request.headers['X-Treg-Route-Waterfall'], '0');
  assert.equal(observed[3].request.headers['X-Treg-Route-Max-Cost'], '0.000100');
});

test('SP06 3 unsupported hard-ceiling provider transports issue 0 global fetches', async () => {
  // No injected transport means genuine built-in mode. Reject before fetch without a made-up cap field.
  for (const adapter of adapters.slice(0, 3)) {
    const result = await adapter.create({ ...config(async () => Response.json(adapter.reply), adapter.extra), transport: undefined, transport_mode: undefined, credential: 'not-used' }).analyze(adapter.input());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'UNSUPPORTED');
  }
});

test('SP04 actual Iris rejects array-coerced source/modality, 0 transports', async () => {
  let calls = 0;
  const input = adapters[0].input();
  const client = createIrisClient(config(async () => { calls++; return Response.json(irisReply); }, adapters[0].extra));
  for (const mutation of [{ source_kind: ['simulated'], synthetic: false }, { modality: ['eo'] }]) {
    const malformed = { ...input, snapshot: { ...input.snapshot, evidence: [{ ...input.snapshot.evidence[0], ...mutation }] } };
    assert.equal((await client.analyze(malformed)).ok, false);
  }
  assert.equal(calls, 0);
});

test('SP04 actual Iris null-prototype/sparse/custom/accessor arrays return typed rejection, 0 traps/calls', async () => {
  let calls = 0;
  let traps = 0;
  const client = createIrisClient(config(async () => { calls++; return Response.json(irisReply); }, adapters[0].extra));
  const nullPrototype = ['c1', 'c2'];
  Object.setPrototypeOf(nullPrototype, null);
  const custom = ['c1', 'c2'];
  delete custom[1];
  Object.defineProperty(custom, 'extra', { value: 'c2', enumerable: true });
  const accessor = ['c1', 'c2'];
  Object.defineProperty(accessor, '1', { enumerable: true, get() { traps++; return 'c2'; } });
  const proxy = new Proxy(['c1', 'c2'], { get() { traps++; throw Error('no trap'); } });
  for (const candidate_ids of [nullPrototype, Array(2), custom, accessor, proxy]) {
    const result = await client.analyze({ ...adapters[0].input(), candidate_ids });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'INVALID_INPUT');
  }
  assert.equal(calls, 0);
  assert.equal(traps, 0);
});
