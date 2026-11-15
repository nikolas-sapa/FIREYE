import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { setImmediate as immediate, setTimeout as delay } from 'node:timers/promises';
import { createQueuedGeminiClient } from '../orchestration/queued-gemini.ts';
import type { QueuedGeminiConfig } from '../orchestration/queued-gemini.ts';
import { createGeminiClient } from '../integrations/gemini/client.ts';
import { SponsorBudget, serverReceipt } from '../integrations/receipts.ts';
import type { Snapshot } from '../integrations/receipts.ts';
import type { GeminiInput } from '../integrations/gemini/types.ts';

// Same repository-local 1x1 synthetic PNG as sponsor-clients.test.ts.
// No external scene, person labels, licensed dataset or detection proof.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const model = 'gemini-2.5-flash';
const wall = 1_800_000_000_000;
const scripted = { hypotheses: [], synthesis: 'insufficient-evidence' };
function body(value: unknown = scripted) {
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] };
}
function reply() { return Response.json(body()); }
function input(n = 0, time = wall): GeminiInput {
  const bytes = Buffer.from(png, 'base64');
  const snapshot: Snapshot = { incident_id: 'i1', run_id: 'r1', authority_epoch: 1, input_revision: n,
    snapshot_id: `snapshot${n}`, received_cutoff_ms: time, valid_until_ms: time + 10_000,
    evidence: [{ evidence_id: `e${n}`, source_id: 'synthetic-png-fixture', rights_manifest_id: 'local-test-png-permission',
      source_kind: 'simulated', captured_at_ms: time - 10, received_at_ms: time - 5, modality: 'eo', synthetic: true,
      radiometric: false, calibration: null, content_hash: createHash('sha256').update(bytes).digest('hex'),
      byte_length: bytes.length, width_px: 1, height_px: 1 }] };
  return { snapshot, evidence_id: `e${n}`, png_base64: png };
}
function config(extra: Partial<QueuedGeminiConfig> = {}): QueuedGeminiConfig {
  return { enabled: true, authorization_id: 'local-fixture', budget: new SponsorBudget(300, 30_000),
    max_call_micro: 100, deadline_ms: 1000, now: () => wall, is_current: () => true,
    model, transport_mode: 'fixture', transport: async () => reply(), ...extra };
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function awaitCancellations(releases: (() => void)[]) {
  // Scheduler deadline can precede the client's abort timer by one tick.
  for (let tries = 0; tries < 20 && releases.length < 2; tries++) await delay(1);
  assert.equal(releases.length, 2);
}

test('QG01/QG07 20 actual localhost duplicates produce 1 request/reservation/issued immutable fixture receipt', async () => {
  let calls = 0;
  const bound = input();
  const owned = structuredClone(bound);
  const expectedHash = hash(bound);
  const server = createServer(async (request, response) => {
    calls++;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const wire = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(request.url, '/fixture'); assert.equal(request.method, 'POST');
    assert.equal(request.headers.authorization, undefined); assert.equal(request.headers['x-goog-api-key'], undefined);
    assert.deepEqual(wire.generationConfig, { maxOutputTokens: 512, responseMimeType: 'application/json' });
    assert.deepEqual(wire.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: png } });
    const text: string = wire.contents[0].parts[0].text;
    assert.deepEqual(JSON.parse(text.split('Received metadata: ')[1]), owned.snapshot.evidence[0]);
    for (const hidden of ['hidden_world_labels', 'planted_mask', 'true_target_coordinates', 'future_received_facts']) assert.equal(text.includes(hidden), false);
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const fixtureUrl = `http://127.0.0.1:${address.port}/fixture`;
  const budget = new SponsorBudget(1, 100);
  const options = config({ budget, transport_mode: 'local-http', transport: async request => {
    assert.equal(request.url, `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`);
    assert.deepEqual(request.headers, { 'Content-Type': 'application/json' }); assert.equal(request.redirect, 'error');
    return fetch(fixtureUrl, { method: request.method, headers: request.headers, body: request.body,
      signal: request.signal, redirect: request.redirect });
  } });
  try {
    const client = createQueuedGeminiClient(options);
    assert.deepEqual(client.counts(), { in_flight: 0, physical_in_flight: 0, queued: 0, retained: 0 });
    const pending = Array.from({ length: 20 }, () => client.analyze(bound));
    (bound.snapshot as { input_revision: number }).input_revision = 999;
    (options as { enabled: boolean }).enabled = false;
    const values = await Promise.all(pending);
    assert.equal(values.filter(value => value.ok).length, 20);
    assert.equal(new Set(values.map(value => value.receipt?.receipt_id)).size, 1);
    for (const value of values) {
      assert.ok(value.ok);
      assert.deepEqual(value.value, { kind: 'evidence-analysis', verification_status: 'unverified',
        evidence_ids: ['e0'], hypotheses: [], synthesis: 'insufficient-evidence' });
      assert.ok(Object.isFrozen(value) && Object.isFrozen(value.value) && Object.isFrozen(value.value.hypotheses));
      assert.ok(serverReceipt(value.receipt)); assert.equal(value.receipt.input_hash, expectedHash);
      assert.equal(value.receipt.adapter, 'gemini'); assert.equal(value.receipt.model, model);
      assert.equal(value.receipt.provenance, 'local-http'); assert.equal(value.receipt.fresh_provider_call, false);
    }
    const cached = await client.analyze(owned);
    assert.ok(cached.ok); assert.equal(cached.receipt?.receipt_id, values[0].receipt?.receipt_id);
    assert.equal(cached.receipt?.started_at_ms, values[0].receipt?.started_at_ms);
    assert.equal(calls, 1); assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
    await immediate(); assert.deepEqual(client.counts(), { in_flight: 0, physical_in_flight: 0, queued: 0, retained: 1 });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('QG02 20 changed supplied snapshots/evidence produce 20 exact hashes, reordered outer keys dedupe', async () => {
  let calls = 0;
  const client = createQueuedGeminiClient(config({ transport: async () => { calls++; return reply(); } }));
  const hashes = new Set<string>();
  for (let n = 0; n < 20; n++) {
    const bound = input(n);
    const value = await client.analyze(bound);
    assert.ok(value.ok); assert.deepEqual(value.value.evidence_ids, [bound.evidence_id]);
    assert.equal(value.receipt?.input_hash, hash(bound)); hashes.add(value.receipt!.input_hash);
    const reordered = await client.analyze({ png_base64: bound.png_base64, evidence_id: bound.evidence_id, snapshot: bound.snapshot });
    assert.ok(reordered.ok); assert.equal(reordered.receipt?.receipt_id, value.receipt?.receipt_id);
  }
  assert.equal(hashes.size, 20); assert.equal(calls, 20); assert.equal(client.counts().retained, 20);
});

test('QG03 20 each wrong-run/epoch/revision/replay/offline/expired inputs yield 0 actionable outputs/calls', async () => {
  let calls = 0;
  let mode = 'live';
  const budget = new SponsorBudget(300, 30_000);
  const client = createQueuedGeminiClient(config({ budget, is_current: snapshot => mode === 'live'
    && snapshot.incident_id === 'i1' && snapshot.run_id === 'r1' && snapshot.authority_epoch === 1 && snapshot.input_revision === 0,
    transport: async () => { calls++; return reply(); } }));
  const original = input();
  for (let n = 0; n < 20; n++) {
    for (const snapshot of [{ ...original.snapshot, run_id: 'old-run' }, { ...original.snapshot, authority_epoch: 0 },
      { ...original.snapshot, input_revision: 1 }, { ...original.snapshot, valid_until_ms: wall }]) {
      assert.equal((await client.analyze({ ...original, snapshot })).ok, false);
    }
    for (mode of ['replay', 'offline']) assert.deepEqual(await client.analyze(original), { ok: false, code: 'STALE' });
    mode = 'live';
  }
  assert.equal(calls, 0); assert.deepEqual(budget.usage(), { calls: 0, reserved_micro: 0 }); assert.equal(client.counts().retained, 0);
});

test('QG03 20 stale and 20 expired async cache reads plus 20 superseded replies yield 0 actionable outputs', async () => {
  for (let n = 0; n < 20; n++) {
    let time = wall;
    let current = true;
    let calls = 0;
    const budget = new SponsorBudget(1, 100);
    const client = createQueuedGeminiClient(config({ budget, now: () => time, is_current: () => current,
      transport: async () => { calls++; return reply(); } }));
    const bound = input(n);
    assert.equal((await client.analyze(bound)).ok, true);
    const stale = client.analyze(bound); current = false;
    assert.deepEqual(await stale, { ok: false, code: 'STALE' });
    current = true;
    const expired = client.analyze(bound); time = wall + 1000;
    assert.deepEqual(await expired, { ok: false, code: 'DEADLINE' });
    current = false;
    assert.deepEqual(await client.analyze(bound), { ok: false, code: 'STALE' });
    current = true;
    assert.deepEqual(await client.analyze(bound), { ok: false, code: 'DEADLINE' });
    assert.equal(calls, 1); assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
    const superseded = createQueuedGeminiClient(config({ is_current: () => current,
      transport: async () => { current = false; return reply(); } }));
    assert.equal((await superseded.analyze(bound)).ok, false);
  }
});

test('QG03 20 fresh inputs expiring between admission and callback invoke 0 transports and renew 0 deadlines', async () => {
  for (let n = 0; n < 20; n++) {
    let time = wall;
    let calls = 0;
    const client = createQueuedGeminiClient(config({ now: () => time, transport: async () => { calls++; return reply(); } }));
    const bound = input(n);
    const pending = client.analyze(bound); time += 1000;
    assert.deepEqual(await pending, { ok: false, code: 'DEADLINE' });
    assert.deepEqual(await client.analyze(bound), { ok: false, code: 'DEADLINE' }); assert.equal(calls, 0);
    await immediate(); assert.equal(client.counts().in_flight, 0); assert.equal(client.counts().physical_in_flight, 0);
  }
});

test('QG08 20 clock advances at remaining-time/transport boundaries start 0 late calls and renew 0 deadlines', async () => {
  // Actual clock reads 10..13 span remaining time, client snapshot, perform
  // admission and the last synchronous check before invoking transport.
  for (const crossing of [10, 11, 12, 13]) for (let n = 0; n < 20; n++) {
    let reads = 0;
    let time = wall;
    let calls = 0;
    const budget = new SponsorBudget(1, 100);
    const client = createQueuedGeminiClient(config({ budget, now: () => {
      if (++reads >= crossing) time = wall + 1000;
      return time;
    }, transport: async () => { calls++; return reply(); } }));
    const bound = input(n);
    assert.deepEqual(await client.analyze(bound), { ok: false, code: 'DEADLINE' });
    assert.equal(calls, 0, `late transport at clock read ${crossing}`);
    assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
    for (let retry = 0; retry < 20; retry++) assert.deepEqual(await client.analyze(bound), { ok: false, code: 'DEADLINE' });
    await immediate(); assert.equal(client.counts().in_flight, 0); assert.equal(budget.inFlight(), 0);
  }
});

test('QG09 20 clock-expired/callback-expired/superseded snapshots at actual dispatch start 0 stale transports', async () => {
  for (const crossing of ['clock', 'callback', 'superseded'] as const) for (let n = 0; n < 20; n++) {
    let reads = 0;
    let checks = 0;
    let time = wall;
    let current = true;
    let calls = 0;
    const bound = input(n);
    if (crossing !== 'superseded') (bound.snapshot as { valid_until_ms: number }).valid_until_ms = wall + 500;
    const budget = new SponsorBudget(1, 100);
    const client = createQueuedGeminiClient(config({ budget, now: () => {
      if (++reads >= 13 && crossing === 'clock') time = wall + 500;
      return time;
    }, is_current: () => {
      if (++checks === 6) { if (crossing === 'callback') time = wall + 500; else if (crossing === 'superseded') current = false; }
      return current;
    }, transport: async () => { calls++; return reply(); } }));
    assert.deepEqual(await client.analyze(bound), { ok: false, code: 'STALE' });
    assert.equal(calls, 0); assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
    await immediate(); assert.equal(client.counts().in_flight, 0); assert.equal(budget.inFlight(), 0);
  }
});

test('QG10 20 delayed client starts propagate original scheduler abort before caller deadline return', async () => {
  for (let n = 0; n < 20; n++) {
    let checks = 0;
    let calls = 0;
    let dispatched: AbortSignal | undefined;
    let release!: () => void;
    const budget = new SponsorBudget(1, 100);
    const client = createQueuedGeminiClient(config({ budget, now: Date.now, deadline_ms: 80, is_current: () => {
      // Shared perform's initial currentness check happens after remaining
      // time was computed, before its relative abort timer is installed.
      if (++checks === 5) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      return true;
    }, transport: async request => {
      calls++; dispatched = request.signal;
      await new Promise<void>(resolve => { release = resolve; }); return reply();
    } }));
    try {
      const value = await client.analyze(input(n, Date.now()));
      assert.deepEqual(value, { ok: false, code: 'DEADLINE' });
      assert.equal(calls, 1); assert.ok(dispatched); assert.equal(dispatched.aborted, true);
      assert.deepEqual(client.counts(), { in_flight: 1, physical_in_flight: 1, queued: 0, retained: 1 });
      assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
    } finally { release?.(); await immediate(); }
    assert.equal(client.counts().in_flight, 0); assert.equal(budget.inFlight(), 0);
  }
});

test('QG10 20 header-returned bodies retain original scheduler abort through physical body settlement', async () => {
  for (let n = 0; n < 20; n++) {
    let checks = 0;
    let calls = 0;
    let dispatched: AbortSignal | undefined;
    let release!: () => void;
    let cancellations = 0;
    const budget = new SponsorBudget(1, 100);
    const client = createQueuedGeminiClient(config({ budget, now: Date.now, deadline_ms: 80, is_current: () => {
      if (++checks === 5) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      return true;
    }, transport: async request => {
      calls++; dispatched = request.signal;
      return new Response(new ReadableStream<Uint8Array>({ cancel() {
        cancellations++; return new Promise<void>(resolve => { release = resolve; });
      } }));
    } }));
    try {
      assert.deepEqual(await client.analyze(input(n, Date.now())), { ok: false, code: 'DEADLINE' });
      assert.equal(calls, 1); assert.ok(dispatched); assert.equal(dispatched.aborted, true);
      assert.deepEqual(client.counts(), { in_flight: 1, physical_in_flight: 1, queued: 0, retained: 1 });
      assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
    } finally {
      for (let tries = 0; tries < 100 && !release; tries++) await delay(1);
      release?.(); await immediate();
    }
    assert.equal(cancellations, 1); assert.equal(client.counts().in_flight, 0); assert.equal(budget.inFlight(), 0);
  }
});

test('QG03 20 fresh scheduler-read microtasks each reject stale/expired wrapper reads with 1 call/reservation', async () => {
  for (let n = 0; n < 20; n++) for (const expiry of [false, true]) {
    let time = wall;
    let current = true;
    let checks = 0;
    let calls = 0;
    const budget = new SponsorBudget(1, 100);
    const client = createQueuedGeminiClient(config({ budget, now: () => time, is_current: () => {
      checks++;
      // Actual wrapper/client/queue reads precede this tenth currentness
      // check in SponsorJobs.#atRead. State changes before wrapper resumes.
      if (checks === 10) queueMicrotask(() => { if (expiry) time = wall + 1000; else current = false; });
      return current;
    }, transport: async () => { calls++; return reply(); } }));
    assert.deepEqual(await client.analyze(input(n)), { ok: false, code: expiry ? 'DEADLINE' : 'STALE' });
    assert.equal(checks, 11); assert.equal(calls, 1); assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
  }
});

test('QG04 10 blocked actual transports hold 2 physical/8 queued, eleventh rejects, all 10 settle', async () => {
  const releases: (() => void)[] = [];
  let calls = 0;
  let physical = 0;
  let maximum = 0;
  const client = createQueuedGeminiClient(config({ transport: async () => {
    calls++; physical++; maximum = Math.max(maximum, physical);
    await new Promise<void>(resolve => releases.push(resolve)); physical--; return reply();
  } }));
  const pending = Array.from({ length: 10 }, (_, n) => client.analyze(input(n)));
  await immediate();
  assert.deepEqual(client.counts(), { in_flight: 2, physical_in_flight: 2, queued: 8, retained: 10 });
  assert.deepEqual(await client.analyze(input(11)), { ok: false, code: 'QUEUE_FULL' });
  for (let round = 0; round < 5; round++) { for (const release of releases.splice(0)) release(); await immediate(); }
  assert.equal((await Promise.all(pending)).filter(value => value.ok).length, 10);
  assert.equal(maximum, 2); assert.equal(physical, 0); assert.equal(calls, 10);
});

test('QG04 2 hung transports plus 8 queued expire with 2 calls/reservations, slots release only on settlement', async () => {
  const budget = new SponsorBudget(100, 10_000);
  const releases: (() => void)[] = [];
  let calls = 0;
  const client = createQueuedGeminiClient(config({ budget, now: Date.now, deadline_ms: 80, transport: async () => {
    calls++; await new Promise<void>(resolve => releases.push(resolve)); return reply();
  } }));
  try {
    const pending = Array.from({ length: 10 }, (_, n) => client.analyze(input(n, Date.now())));
    await immediate(); assert.equal(client.counts().queued, 8);
    assert.equal((await Promise.all(pending)).filter(value => value.ok).length, 0);
    assert.deepEqual(client.counts(), { in_flight: 2, physical_in_flight: 2, queued: 0, retained: 10 });
    const later = await Promise.all(Array.from({ length: 20 }, (_, n) => client.analyze(input(n + 100, Date.now()))));
    assert.equal(later.filter(value => !value.ok && value.code === 'DEADLINE').length, 8);
    assert.equal(later.filter(value => !value.ok && value.code === 'QUEUE_FULL').length, 12);
    assert.equal(calls, 2); assert.deepEqual(budget.usage(), { calls: 2, reserved_micro: 200 });
    assert.equal(client.counts().in_flight, 2); assert.equal(client.counts().physical_in_flight, 2);
  } finally {
    for (const release of releases.splice(0)) release(); await immediate();
    assert.equal(client.counts().in_flight, 0); assert.equal(budget.inFlight(), 0);
  }
});

test('QG04 2 hung response cancellations retain physical/logical slots after deadline until actual settlement', async () => {
  const budget = new SponsorBudget(20, 2000);
  const releases: (() => void)[] = [];
  let calls = 0;
  const client = createQueuedGeminiClient(config({ budget, now: Date.now, deadline_ms: 80, transport: async () => {
    calls++;
    return new Response(new ReadableStream<Uint8Array>({ cancel() { return new Promise<void>(resolve => releases.push(resolve)); } }));
  } }));
  try {
    const pending = Array.from({ length: 10 }, (_, n) => client.analyze(input(n, Date.now())));
    assert.equal((await Promise.all(pending)).filter(value => value.ok).length, 0);
    assert.deepEqual(client.counts(), { in_flight: 2, physical_in_flight: 2, queued: 0, retained: 10 });
    assert.equal(calls, 2); assert.deepEqual(budget.usage(), { calls: 2, reserved_micro: 200 });
  } finally {
    await awaitCancellations(releases);
    for (const release of releases.splice(0)) release(); await immediate();
    assert.equal(client.counts().in_flight, 0); assert.equal(budget.inFlight(), 0);
  }
});

test('QG05 20 invalid/missing-rights/hidden-truth inputs and hostile accessors/proxies reserve/invoke/read 0', async () => {
  let calls = 0;
  let traps = 0;
  const budget = new SponsorBudget(100, 10_000);
  const client = createQueuedGeminiClient(config({ budget, transport: async () => { calls++; return reply(); } }));
  const bound = input(); const evidence = bound.snapshot.evidence[0];
  const hostile = { get snapshot() { traps++; throw new Error('private-sentinel'); }, evidence_id: 'e0', png_base64: png };
  const proxy = new Proxy({}, { ownKeys() { traps++; return []; } });
  const malformed = [null, hostile, proxy, { ...bound, hidden_world_labels: ['person'] },
    { ...bound, snapshot: { ...bound.snapshot, future_received_facts: [] } },
    { ...bound, snapshot: { ...bound.snapshot, evidence: [{ ...evidence, planted_mask: true }] } },
    { ...bound, true_target_coordinates: [1, 2] },
    { ...bound, snapshot: { ...bound.snapshot, evidence: [{ ...evidence, rights_manifest_id: undefined }] } },
    { ...bound, snapshot: { ...bound.snapshot, evidence: [{ ...evidence, rights_manifest_id: '' }] } },
    { ...bound, snapshot: { ...bound.snapshot, evidence: [{ ...evidence, captured_at_ms: null }] } },
    { ...bound, snapshot: { ...bound.snapshot, evidence: [{ ...evidence, modality: 'thermal' }] } },
    { ...bound, snapshot: { ...bound.snapshot, evidence: [{ ...evidence, content_hash: '0'.repeat(64) }] } },
    { ...bound, snapshot: { ...bound.snapshot, evidence: [{ ...evidence, byte_length: 1 }] } },
    { ...bound, evidence_id: 'unknown' }, { ...bound, png_base64: '' }];
  for (let n = 0; n < 20; n++) for (const invalid of malformed) assert.deepEqual(await client.analyze(invalid), { ok: false, code: 'INVALID_INPUT' });
  assert.equal(calls, 0); assert.equal(traps, 0); assert.equal(client.counts().retained, 0);
  assert.deepEqual(budget.usage(), { calls: 0, reserved_micro: 0 });
});

test('QG05 20 disabled/unapproved/missing-transport/model/mode cases reserve/invoke 0', async () => {
  let calls = 0;
  const transport = async () => { calls++; return reply(); };
  const disabled = createQueuedGeminiClient({ transport });
  const budget = new SponsorBudget(100, 10_000);
  const invalid = [config({ budget, transport, authorization_id: undefined }), config({ budget, transport: undefined }),
    config({ budget, transport, model: 'unsupported' }), config({ budget, transport, transport_mode: undefined }),
    config({ budget, transport, max_call_micro: 0 }), config({ budget, transport, deadline_ms: 10_001 })];
  for (let n = 0; n < 20; n++) {
    assert.deepEqual(await disabled.analyze(input(n)), { ok: false, code: 'DISABLED' });
    for (const options of invalid) {
      const client = createQueuedGeminiClient(options);
      assert.equal((await client.analyze(input(n))).ok, false); assert.equal(client.counts().retained, 0);
    }
  }
  assert.equal(calls, 0); assert.deepEqual(budget.usage(), { calls: 0, reserved_micro: 0 });
});

test('QG05 20 thrown errors and 20 malformed replies expose 0 raw strings/actionable results', async () => {
  let calls = 0;
  const client = createQueuedGeminiClient(config({ transport: async () => { calls++; throw new Error('private-provider-sentinel'); } }));
  for (let n = 0; n < 20; n++) {
    const value = await client.analyze(input(n)); assert.equal(value.ok, false);
    assert.equal(JSON.stringify(value).includes('private-provider-sentinel'), false);
    const invalid = n % 2 ? { hypotheses: ['human'], synthesis: 'review-required', true_target_coordinates: [1, 2] }
      : { hypotheses: ['human', 'human'], synthesis: 'review-required' };
    const malformed = createQueuedGeminiClient(config({ transport: async () => Response.json(body(invalid)) }));
    assert.equal((await malformed.analyze(input(n))).ok, false);
  }
  assert.equal(calls, 20);
});

test('QG06 256 stale attempts retain 0 identities, subsequent current input succeeds', async () => {
  let current = false;
  let calls = 0;
  const client = createQueuedGeminiClient(config({ is_current: () => current, transport: async () => { calls++; return reply(); } }));
  for (let n = 0; n < 256; n++) assert.deepEqual(await client.analyze(input(n)), { ok: false, code: 'STALE' });
  assert.equal(client.counts().retained, 0); current = true;
  assert.equal((await client.analyze(input(257))).ok, true); assert.equal(calls, 1);
});

test('QG06 256 invalid model/mode/rights attempts each retain/reserve 0', async () => {
  const budget = new SponsorBudget(300, 30_000);
  const modelClient = createQueuedGeminiClient(config({ budget, model: 'unsupported' }));
  const modeClient = createQueuedGeminiClient(config({ budget, transport_mode: undefined }));
  const rightsClient = createQueuedGeminiClient(config({ budget }));
  for (let n = 0; n < 256; n++) {
    assert.deepEqual(await modelClient.analyze(input(n)), { ok: false, code: 'UNSUPPORTED' });
    assert.deepEqual(await modeClient.analyze(input(n)), { ok: false, code: 'UNAUTHORIZED' });
    const bound = input(n);
    assert.deepEqual(await rightsClient.analyze({ ...bound, snapshot: { ...bound.snapshot,
      evidence: bound.snapshot.evidence.map(evidence => ({ ...evidence, rights_manifest_id: '' })) } }), { ok: false, code: 'INVALID_INPUT' });
  }
  assert.equal(modelClient.counts().retained + modeClient.counts().retained + rightsClient.counts().retained, 0);
  assert.deepEqual(budget.usage(), { calls: 0, reserved_micro: 0 });
});

test('QG06 256 queue-full rejections retain only 10 admitted identities, later retry gets first deadline', async () => {
  let time = wall;
  let calls = 0;
  const releases: (() => void)[] = [];
  const client = createQueuedGeminiClient(config({ now: () => time, transport: async () => {
    calls++; if (calls <= 10) await new Promise<void>(resolve => releases.push(resolve)); return reply();
  } }));
  const pending = Array.from({ length: 10 }, (_, n) => client.analyze(input(n)));
  await immediate();
  for (let n = 0; n < 256; n++) assert.deepEqual(await client.analyze(input(n + 11)), { ok: false, code: 'QUEUE_FULL' });
  assert.equal(client.counts().retained, 10);
  for (let round = 0; round < 5; round++) { for (const release of releases.splice(0)) release(); await immediate(); }
  assert.equal((await Promise.all(pending)).filter(value => value.ok).length, 10);
  time += 1000;
  assert.equal((await client.analyze(input(11))).ok, true); assert.equal(calls, 11);
});

test('QG06 admitted failed transport preserves original deadline, 20 retries invoke 0 additional calls', async () => {
  let time = wall;
  let calls = 0;
  const client = createQueuedGeminiClient(config({ now: () => time, transport: async () => { calls++; throw new Error('private'); } }));
  const bound = input(); assert.equal((await client.analyze(bound)).ok, false); time += 1000;
  for (let n = 0; n < 20; n++) assert.deepEqual(await client.analyze(bound), { ok: false, code: 'DEADLINE' });
  assert.equal(calls, 1);
});

test('QG06 256 admitted identities preserve duplicate and reject 257th without another call', async () => {
  let calls = 0;
  const client = createQueuedGeminiClient(config({ transport: async () => { calls++; return reply(); } }));
  for (let n = 0; n < 256; n++) assert.equal((await client.analyze(input(n))).ok, true);
  assert.equal(client.counts().retained, 256);
  assert.deepEqual(await client.analyze(input(257)), { ok: false, code: 'QUEUE_FULL' });
  assert.equal((await client.analyze(input(0))).ok, true); assert.equal(calls, 256);
});

test('BODY01 10 concurrent plus 60 localhost terminal failures bound client leases to2 and drain bodies', async t => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  let maximumClientLeases = 0;
  const retained: Response[] = [];
  const server = createServer((request, response) => {
    request.resume(); calls++; active++; maximum = Math.max(maximum, active);
    response.once('close', () => { active--; });
    const kind = request.url;
    response.writeHead(kind === '/redirect' ? 302 : kind === '/oversize' ? 200 : 503,
      kind === '/redirect' ? { location: 'http://127.0.0.1/unused' } : kind === '/oversize' ? { 'content-length': '262145' } : {});
    response.flushHeaders(); // Actual open HTTP body, no completion until client cleanup.
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  let path = '/error';
  const settings = config({ now: Date.now, deadline_ms: 1000, transport_mode: 'local-http' });
  const client = createQueuedGeminiClient({ ...settings, transport: async request => {
    maximumClientLeases = Math.max(maximumClientLeases, settings.budget!.inFlight());
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: request.method,
      body: request.body, headers: request.headers, signal: request.signal, redirect: 'manual' });
    retained.push(response); return response;
  } });
  try {
    const pending = Array.from({ length: 10 }, (_, n) => client.analyze(input(n, Date.now())));
    await immediate(); assert.equal(client.counts().in_flight, 2); assert.equal(client.counts().queued, 8);
    const first = await Promise.all(pending); assert.ok(first.every(value => !value.ok && value.code === 'TRANSPORT'));
    for (const [route, code] of [['/redirect', 'REDIRECT'], ['/error', 'TRANSPORT'], ['/oversize', 'OVERSIZE']] as const) {
      path = route;
      for (let n = 0; n < 20; n++) {
        const value = await client.analyze(input(calls + 100, Date.now()));
        assert.equal(value.ok, false); if (!value.ok) assert.equal(value.code, code);
      }
    }
    const drainDeadline = Date.now() + 1000;
    while (active && Date.now() < drainDeadline) await immediate();
    t.diagnostic(`Remote server close-event timing peak ${maximum}, not client leases or upstream cancellation confirmation`);
    assert.equal(calls, 70); assert.equal(maximumClientLeases, 2);
    assert.equal(active, 0); assert.equal(retained.filter(response => !response.bodyUsed).length, 0);
    assert.equal(client.counts().in_flight, 0); assert.equal(client.counts().physical_in_flight, 0);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

const bodyFailures = ['redirect', 'status', 'declared', 'stream', 'abort'] as const;
type BodyFailure = typeof bodyFailures[number];
function unfinished(kind: BodyFailure, cancel: () => void | Promise<void>): Response {
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    if (kind === 'stream') controller.enqueue(new Uint8Array(262_145));
  }, cancel });
  return new Response(stream, kind === 'redirect' ? { status: 302, headers: { location: 'http://127.0.0.1/unused' } }
    : kind === 'status' ? { status: 503 } : kind === 'declared' ? { headers: { 'content-length': '262145' } } : {});
}

test('BODY01 5 branches x4 delayed-cancel trials retain 2 physical/callback slots, 8 queued expire without prepay', async () => {
  for (const kind of bodyFailures) for (let trial = 0; trial < 4; trial++) {
    let calls = 0;
    let cancellations = 0;
    const releases: (() => void)[] = [];
    const budget = new SponsorBudget(100, 10_000);
    const client = createQueuedGeminiClient(config({ budget, now: Date.now, deadline_ms: 100, transport: async () => {
      calls++; return unfinished(kind, () => { cancellations++; return new Promise<void>(resolve => releases.push(resolve)); });
    } }));
    try {
      const started = performance.now();
      const pending = Array.from({ length: 10 }, (_, n) => client.analyze(input(n, Date.now())));
      await immediate(); assert.equal(client.counts().queued, 8);
      const values = await Promise.all(pending);
      assert.ok(values.every(value => !value.ok && value.code === 'DEADLINE'));
      assert.ok(performance.now() - started < 500);
      await awaitCancellations(releases);
      assert.equal(calls, 2); assert.equal(cancellations, 2);
      assert.deepEqual(budget.usage(), { calls: 2, reserved_micro: 200 });
      assert.deepEqual(client.counts(), { in_flight: 2, physical_in_flight: 2, queued: 0, retained: 10 });
      if (trial === 0) {
        const later = await Promise.all(Array.from({ length: 20 }, (_, n) => client.analyze(input(n + 100, Date.now()))));
        assert.equal(later.filter(value => !value.ok && value.code === 'DEADLINE').length, 8);
        assert.equal(later.filter(value => !value.ok && value.code === 'QUEUE_FULL').length, 12);
        assert.equal(calls, 2); assert.deepEqual(budget.usage(), { calls: 2, reserved_micro: 200 });
      }
    } finally {
      for (const release of releases.splice(0)) release(); await immediate();
    }
    assert.equal(client.counts().in_flight, 0); assert.equal(budget.inFlight(), 0);
  }
});

test('BODY01 20 direct terminal failures return before500ms with budget/hook held until actual cancellation settles', async () => {
  for (let n = 0; n < 20; n++) {
    const kind = bodyFailures[n % 4];
    const budget = new SponsorBudget(1, 100);
    let release!: () => void;
    let notifications = 0;
    const client = createGeminiClient({ ...config({ budget }), transport: async () => unfinished(kind,
      () => new Promise<void>(resolve => { release = resolve; })), on_transport_settled: () => { notifications++; } });
    const started = performance.now();
    const value = await client.analyze(input());
    assert.equal(value.ok, false);
    if (!value.ok) assert.equal(value.code, kind === 'redirect' ? 'REDIRECT' : kind === 'status' ? 'TRANSPORT' : 'OVERSIZE');
    assert.ok(performance.now() - started < 500); assert.equal(budget.inFlight(), 1); assert.equal(notifications, 0);
    assert.equal(typeof release, 'function'); release(); await immediate();
    assert.equal(budget.inFlight(), 0); assert.equal(notifications, 1);
  }
});

test('BODY01 rejected/throwing/locked-body cleanup holds2 slots after callerdeadline, never reports cleanup proof', async () => {
  for (const mode of ['rejected', 'throwing', 'locked'] as const) {
    const budget = new SponsorBudget(20, 2000);
    let calls = 0;
    let cancellations = 0;
    const locks: ReadableStreamDefaultReader<Uint8Array>[] = [];
    const client = createQueuedGeminiClient(config({ budget, now: Date.now, deadline_ms: 100, transport: async () => {
      calls++;
      const response = unfinished('status', () => {
        cancellations++;
        if (mode === 'throwing') throw new Error('private-cancellation-sentinel');
        return Promise.reject(new Error('private-cancellation-sentinel'));
      });
      if (mode === 'locked') locks.push(response.body!.getReader());
      return response;
    } }));
    const values = await Promise.all(Array.from({ length: 10 }, (_, n) => client.analyze(input(n, Date.now()))));
    assert.ok(values.every(value => !value.ok && value.code === 'DEADLINE'));
    assert.ok(values.every(value => !JSON.stringify(value).includes('private-cancellation-sentinel')));
    await immediate(); assert.equal(calls, 2); assert.equal(cancellations, mode === 'locked' ? 0 : 2);
    assert.equal(client.counts().in_flight, 2); assert.equal(budget.inFlight(), 2);
    assert.deepEqual(budget.usage(), { calls: 2, reserved_micro: 200 });
    // No external handles in these fixture streams. Failed cancellation is
    // intentionally not recovered/reset or claimed as transport completion.
    for (const lock of locks) lock.releaseLock();
  }
});

test('BODY01 20 bodyless/already-closed status failures release real budget and settled hook exactly once', async () => {
  for (let n = 0; n < 20; n++) {
    const budget = new SponsorBudget(1, 100);
    let notifications = 0;
    const response = n % 2 ? new Response(null, { status: 503 })
      : new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }), { status: 503 });
    const client = createGeminiClient({ ...config({ budget }), transport: async () => response,
      on_transport_settled: () => { notifications++; } });
    const value = await client.analyze(input()); assert.equal(value.ok, false);
    if (!value.ok) assert.equal(value.code, 'TRANSPORT');
    await immediate(); assert.equal(budget.inFlight(), 0); assert.equal(notifications, 1);
  }
});

test('BODY02 pending/rejected pre-cancellation x200/503 x20 never supplies observable body settlement', async () => {
  for (const status of [200, 503]) for (const rejected of [false, true]) for (let n = 0; n < 20; n++) {
    const budget = new SponsorBudget(1, 100);
    let notifications = 0;
    let cancellations = 0;
    let release: (() => void) | undefined;
    const response = new Response(new ReadableStream<Uint8Array>({ cancel() {
      cancellations++;
      return rejected ? Promise.reject(new Error('private-precancellation-sentinel'))
        : new Promise<void>(resolve => { release = resolve; });
    } }), { status });
    const cancellation = response.body!.cancel().catch(() => {});
    assert.equal(response.bodyUsed, true); assert.equal(response.body!.locked, false);
    try {
      const client = createGeminiClient({ ...config({ budget }), transport: async () => response,
        on_transport_settled: () => { notifications++; } });
      const started = performance.now();
      const value = await client.analyze(input(n));
      assert.equal(value.ok, false); if (!value.ok) assert.equal(value.code, 'INVALID_REPLY');
      assert.ok(performance.now() - started < 500);
      assert.equal(JSON.stringify(value).includes('private-precancellation-sentinel'), false);
      await immediate(); assert.equal(budget.inFlight(), 1); assert.equal(notifications, 0); assert.equal(cancellations, 1);
    } finally { release?.(); await cancellation; }
    // A transport's previous cancellation promise was never transferred to
    // perform. Even eventual external settlement is not observable proof.
    await immediate(); assert.equal(budget.inFlight(), 1); assert.equal(notifications, 0);
  }
});

test('BODY02 4 pre-cancelled queued trials hold2 slots, expire8 queued, later20 reserve/invoke0', async () => {
  for (const status of [200, 503]) for (const rejected of [false, true]) {
    const releases: (() => void)[] = [];
    let calls = 0;
    let cancellations = 0;
    const budget = new SponsorBudget(100, 10_000);
    const client = createQueuedGeminiClient(config({ budget, now: Date.now, deadline_ms: 80, transport: async () => {
      calls++;
      const response = new Response(new ReadableStream<Uint8Array>({ cancel() {
        cancellations++;
        return rejected ? Promise.reject(new Error('private-precancellation-sentinel'))
          : new Promise<void>(resolve => releases.push(resolve));
      } }), { status });
      void response.body!.cancel().catch(() => {});
      return response;
    } }));
    try {
      const pending = Array.from({ length: 10 }, (_, n) => client.analyze(input(n, Date.now())));
      await immediate(); assert.equal(client.counts().queued, 8);
      const values = await Promise.all(pending);
      assert.ok(values.every(value => !value.ok && value.code === 'DEADLINE'));
      assert.equal(JSON.stringify(values).includes('private-precancellation-sentinel'), false);
      assert.deepEqual(client.counts(), { in_flight: 2, physical_in_flight: 2, queued: 0, retained: 10 });
      const later = await Promise.all(Array.from({ length: 20 }, (_, n) => client.analyze(input(n + 100, Date.now()))));
      assert.equal(later.filter(value => !value.ok && value.code === 'DEADLINE').length, 8);
      assert.equal(later.filter(value => !value.ok && value.code === 'QUEUE_FULL').length, 12);
      assert.equal(calls, 2); assert.equal(cancellations, 2); assert.deepEqual(budget.usage(), { calls: 2, reserved_micro: 200 });
    } finally { for (const release of releases) release(); await immediate(); }
    assert.equal(client.counts().in_flight, 2); assert.equal(budget.inFlight(), 2);
  }
});
