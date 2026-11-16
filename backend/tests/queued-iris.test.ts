import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createQueuedIrisClient } from '../orchestration/queued-iris.ts';
import { SponsorBudget } from '../integrations/receipts.ts';
import type { Snapshot } from '../integrations/receipts.ts';
import type { IrisConfig, IrisInput } from '../integrations/iris/types.ts';

const model = 'projects/public-fixture/models/iris-latest';
const wall = 1_800_000_000_000;
const candidate = `candidate:${'a'.repeat(64)}`;
function input(n = 0): IrisInput {
  const snapshot: Snapshot = { incident_id: 'i1', run_id: 'r1', authority_epoch: 1, input_revision: n,
    snapshot_id: `snapshot${n}`, received_cutoff_ms: wall, valid_until_ms: wall + 10_000,
    evidence: [{ evidence_id: 'e1', source_id: 'source1', rights_manifest_id: 'rights1', source_kind: 'simulated',
      captured_at_ms: wall - 10, received_at_ms: wall - 5, modality: 'thermal', synthetic: true,
      radiometric: false, calibration: null, content_hash: 'b'.repeat(64), byte_length: 10, width_px: 1, height_px: 1 }] };
  return { snapshot, candidate_ids: [candidate] };
}
function reply() { return Response.json({ model, answers: { ranking: { choice: candidate, probabilities: { [candidate]: 1 }, confidence: 1 } } }); }
function config(extra: Partial<IrisConfig> = {}): IrisConfig {
  return { enabled: true, authorization_id: 'local-fixture', budget: new SponsorBudget(100, 10_000),
    max_call_micro: 100, deadline_ms: 1000, now: () => wall, is_current: () => true,
    registered_candidate_ids: [candidate], model, transport_mode: 'fixture', transport: async () => reply(), ...extra };
}

test('Queued Iris never dispatches after its original deadline at synchronous clock boundaries', async () => {
  for (let crossing = 7; crossing <= 14; crossing++) {
    let reads = 0;
    let time = wall;
    let lateCalls = 0;
    const client = createQueuedIrisClient(config({ now: () => {
      if (++reads >= crossing) time = wall + 1000;
      return time;
    }, transport: async () => { if (time >= wall + 1000) lateCalls++; return reply(); } }));
    assert.deepEqual(await client.analyze(input()), { ok: false, code: 'DEADLINE' });
    assert.equal(lateCalls, 0, `late transport at clock boundary ${crossing}`);
  }
});

test('Queued Iris forwards scheduler abort while a delayed client transport remains in flight', async () => {
  let checks = 0;
  let dispatched: AbortSignal | undefined;
  let release!: () => void;
  const bound = input();
  const now = Date.now();
  const snapshot = { ...bound.snapshot, received_cutoff_ms: now, valid_until_ms: now + 10_000,
    evidence: bound.snapshot.evidence.map(item => ({ ...item, captured_at_ms: now - 10, received_at_ms: now - 5 })) };
  const client = createQueuedIrisClient(config({ now: Date.now, deadline_ms: 100, is_current: () => {
    if (++checks === 4) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
    return true;
  }, transport: async request => {
    dispatched = request.signal;
    await new Promise<void>(resolve => { release = resolve; });
    return reply();
  } }));
  try {
    assert.deepEqual(await client.analyze({ ...bound, snapshot }), { ok: false, code: 'DEADLINE' });
    assert.ok(dispatched);
    assert.equal(dispatched.aborted, true, 'original scheduler deadline must abort physical transport');
  } finally { release?.(); await delay(100); }
});

test('QI01 20 duplicates bind 1 actual transport/reservation and immutable exact hash', async () => {
  let calls = 0;
  const budget = new SponsorBudget(1, 100);
  const options = config({ budget, transport: async request => {
    calls++; assert.deepEqual(request.headers, { 'Content-Type': 'application/json' }); return reply();
  } });
  const client = createQueuedIrisClient(options);
  const bound = input();
  const expected = createHash('sha256').update(JSON.stringify(bound)).digest('hex');
  const pending = Array.from({ length: 20 }, () => client.analyze(bound));
  (bound.snapshot as { input_revision: number }).input_revision = 999;
  (options.registered_candidate_ids as string[]).splice(0);
  const values = await Promise.all(pending);
  assert.equal(values.filter(value => value.ok).length, 20);
  assert.equal(new Set(values.map(value => value.receipt?.receipt_id)).size, 1);
  assert.ok(values.every(value => value.receipt?.input_hash === expected));
  assert.ok(values.every(value => Object.isFrozen(value) && (!value.ok || Object.isFrozen(value.value.ranking))));
  assert.equal(calls, 1);
  assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
  assert.equal(client.counts().retained, 1);
});

test('QI02 20 changed inputs produce 20 exact receipt hashes without false cache', async () => {
  let calls = 0;
  const other = `proposed:candidate:${'c'.repeat(64)}`;
  const client = createQueuedIrisClient(config({ registered_candidate_ids: [candidate, other], transport: async request => {
    calls++;
    const wire = JSON.parse(request.body);
    const selected = Object.keys(wire.questions.ranking.criteria)[0];
    return Response.json({ model, answers: { ranking: { choice: selected, probabilities: { [selected]: 1 }, confidence: 1 } } });
  } }));
  const hashes = new Set<string>();
  for (let n = 0; n < 20; n++) {
    const bound = { ...input(n % 10), candidate_ids: [n < 10 ? candidate : other] };
    const value = await client.analyze(bound);
    assert.equal(value.ok, true);
    if (value.ok) assert.equal(value.value.ranking[0].candidate_id, bound.candidate_ids[0]);
    assert.equal(value.receipt?.input_hash, createHash('sha256').update(JSON.stringify(bound)).digest('hex'));
    hashes.add(value.receipt!.input_hash);
  }
  assert.equal(hashes.size, 20); assert.equal(calls, 20); assert.equal(client.counts().retained, 20);
});

test('QI03 20 stale/20 expired cached reads and 20 superseded replies yield 0 actionable results', async () => {
  for (let n = 0; n < 20; n++) {
    let time = wall;
    let current = true;
    let calls = 0;
    const client = createQueuedIrisClient(config({ now: () => time, is_current: () => current,
      transport: async () => { calls++; return reply(); } }));
    const bound = input(n);
    assert.equal((await client.analyze(bound)).ok, true);
    const stale = client.analyze(bound); current = false;
    assert.deepEqual(await stale, { ok: false, code: 'STALE' });
    current = true;
    const expired = client.analyze(bound); time = wall + 1000;
    assert.deepEqual(await expired, { ok: false, code: 'DEADLINE' });
    assert.deepEqual(await client.analyze(bound), { ok: false, code: 'DEADLINE' });
    assert.equal(calls, 1);
    const superseded = createQueuedIrisClient(config({ is_current: () => current,
      transport: async () => { current = false; return reply(); } }));
    current = true;
    assert.equal((await superseded.analyze(bound)).ok, false);
  }
});

test('QI04 10 actual blocked transports stay 2 physical/8 queued, eleventh rejects', async () => {
  const releases: (() => void)[] = [];
  let calls = 0;
  let physical = 0;
  let maximum = 0;
  const client = createQueuedIrisClient(config({ transport: async () => {
    calls++; physical++; maximum = Math.max(maximum, physical);
    await new Promise<void>(resolve => releases.push(resolve)); physical--; return reply();
  } }));
  const pending = Array.from({ length: 10 }, (_, n) => client.analyze(input(n)));
  await delay(1);
  assert.deepEqual(client.counts(), { in_flight: 2, physical_in_flight: 2, queued: 8, retained: 10 });
  assert.deepEqual(await client.analyze(input(11)), { ok: false, code: 'QUEUE_FULL' });
  while (calls < 10) { for (const release of releases.splice(0)) release(); await delay(1); }
  for (const release of releases.splice(0)) release();
  assert.equal((await Promise.all(pending)).filter(value => value.ok).length, 10);
  assert.equal(maximum, 2); assert.equal(physical, 0); assert.equal(calls, 10);
});

test('QI05 20 disabled/malformed/unknown inputs invoke 0, 20 errors expose 0 raw strings', async () => {
  let calls = 0;
  const transport = async () => { calls++; throw new Error('private-secret-sentinel'); };
  const disabled = createQueuedIrisClient({ transport });
  const client = createQueuedIrisClient(config({ transport }));
  let getters = 0;
  const hostile = { get snapshot() { getters++; throw new Error('private-secret-sentinel'); }, candidate_ids: [candidate] };
  const malformed = [null, hostile, { ...input(), hidden: true }, { ...input(), candidate_ids: ['unknown'] }];
  for (let n = 0; n < 20; n++) {
    assert.deepEqual(await disabled.analyze(input(n)), { ok: false, code: 'DISABLED' });
    assert.equal((await client.analyze(malformed[n % malformed.length])).ok, false);
  }
  assert.equal(calls, 0); assert.equal(getters, 0);
  for (let n = 0; n < 20; n++) {
    const value = await client.analyze(input(n));
    assert.equal(value.ok, false); assert.equal(JSON.stringify(value).includes('private-secret-sentinel'), false);
  }
  assert.equal(calls, 20);
});

test('QI05 20 enabled clients without local transport reserve/invoke 0', async () => {
  const budget = new SponsorBudget(20, 2000);
  const client = createQueuedIrisClient(config({ budget, transport: undefined, transport_mode: undefined }));
  for (let n = 0; n < 20; n++) assert.deepEqual(await client.analyze(input(n)), { ok: false, code: 'UNSUPPORTED' });
  assert.deepEqual(budget.usage(), { calls: 0, reserved_micro: 0 });
  assert.deepEqual(client.counts(), { in_flight: 0, physical_in_flight: 0, queued: 0, retained: 0 });
});

test('QI07 256 stale submits poison 0 retained identities, subsequent current input succeeds', async () => {
  let current = false;
  let calls = 0;
  const client = createQueuedIrisClient(config({ is_current: () => current,
    transport: async () => { calls++; return reply(); } }));
  for (let n = 0; n < 256; n++) assert.deepEqual(await client.analyze(input(n)), { ok: false, code: 'STALE' });
  assert.equal(client.counts().retained, 0);
  current = true;
  assert.equal((await client.analyze(input(257))).ok, true);
  assert.equal(calls, 1);
});

test('QI07 256 invalid models retain/reserve 0 identities', async () => {
  const budget = new SponsorBudget(300, 30_000);
  const client = createQueuedIrisClient(config({ budget, model: 'unsupported-model' }));
  for (let n = 0; n < 256; n++) assert.deepEqual(await client.analyze(input(n)), { ok: false, code: 'UNSUPPORTED' });
  assert.equal(client.counts().retained, 0);
  assert.deepEqual(budget.usage(), { calls: 0, reserved_micro: 0 });
});

test('QI07 256 invalid transport modes retain/reserve 0 identities', async () => {
  const budget = new SponsorBudget(300, 30_000);
  const client = createQueuedIrisClient(config({ budget, transport_mode: undefined }));
  for (let n = 0; n < 256; n++) assert.deepEqual(await client.analyze(input(n)), { ok: false, code: 'UNAUTHORIZED' });
  assert.equal(client.counts().retained, 0);
  assert.deepEqual(budget.usage(), { calls: 0, reserved_micro: 0 });
});

test('QI07 rejected queue-full identity may retry with a new deadline after 10 admitted jobs settle', async () => {
  let time = wall;
  let calls = 0;
  const releases: (() => void)[] = [];
  const client = createQueuedIrisClient(config({ now: () => time, transport: async () => {
    calls++; if (calls <= 10) await new Promise<void>(resolve => releases.push(resolve)); return reply();
  } }));
  const pending = Array.from({ length: 10 }, (_, n) => client.analyze(input(n)));
  await delay(1);
  const retry = input(11);
  for (let n = 0; n < 256; n++) assert.deepEqual(await client.analyze(input(n + 11)), { ok: false, code: 'QUEUE_FULL' });
  assert.equal(client.counts().retained, 10);
  while (calls < 10) { for (const release of releases.splice(0)) release(); await delay(1); }
  for (const release of releases.splice(0)) release();
  assert.equal((await Promise.all(pending)).filter(value => value.ok).length, 10);
  time += 1000;
  assert.equal((await client.analyze(retry)).ok, true);
  assert.equal(calls, 11);
});

test('QI07 admitted failed transport keeps original deadline, 20 retries issue 0 new calls', async () => {
  let time = wall;
  let calls = 0;
  const client = createQueuedIrisClient(config({ now: () => time, transport: async () => { calls++; throw new Error('private'); } }));
  const bound = input();
  assert.equal((await client.analyze(bound)).ok, false);
  time += 1000;
  for (let n = 0; n < 20; n++) assert.deepEqual(await client.analyze(bound), { ok: false, code: 'DEADLINE' });
  assert.equal(calls, 1);
});

test('QI07 256 admitted identities retain original deadlines and valid 257th rejects without call', async () => {
  let calls = 0;
  const budget = new SponsorBudget(300, 30_000);
  const client = createQueuedIrisClient(config({ budget, transport: async () => { calls++; return reply(); } }));
  for (let n = 0; n < 256; n++) assert.equal((await client.analyze(input(n))).ok, true);
  assert.equal(client.counts().retained, 256);
  assert.deepEqual(await client.analyze(input(257)), { ok: false, code: 'QUEUE_FULL' });
  assert.equal((await client.analyze(input(0))).ok, true);
  assert.equal(calls, 256);
});

test('QI09 2 hung plus 8 queued timeout with calls/reservations2, physical/logical2 until actual settlement', async () => {
  const budget = new SponsorBudget(100, 10_000);
  const releases: (() => void)[] = [];
  let calls = 0;
  const client = createQueuedIrisClient(config({ budget, now: Date.now, deadline_ms: 20, transport: async () => {
    calls++; await new Promise<void>(resolve => releases.push(resolve)); return reply();
  } }));
  function fresh(n: number) {
    const time = Date.now();
    const bound = input(n);
    return { ...bound, snapshot: { ...bound.snapshot, received_cutoff_ms: time, valid_until_ms: time + 10_000,
      evidence: bound.snapshot.evidence.map(evidence => ({ ...evidence, captured_at_ms: time - 10, received_at_ms: time - 5 })) } };
  }
  try {
    const pending = Array.from({ length: 10 }, (_, n) => client.analyze(fresh(n)));
    assert.equal((await Promise.all(pending)).filter(value => value.ok).length, 0);
    await delay(1);
    assert.equal(client.counts().in_flight, 2);
    assert.equal(client.counts().physical_in_flight, 2);
    assert.equal(client.counts().queued, 0);
    const later = await Promise.all(Array.from({ length: 20 }, (_, n) => client.analyze(fresh(n + 100))));
    assert.equal(later.filter(value => value.ok).length, 0);
    assert.equal(later.filter(value => !value.ok && value.code === 'QUEUE_FULL').length, 12);
    assert.equal(later.filter(value => !value.ok && value.code === 'DEADLINE').length, 8);
    assert.equal(calls, 2);
    assert.deepEqual(budget.usage(), { calls: 2, reserved_micro: 200 });
  } finally {
    for (const release of releases.splice(0)) release();
    await delay(1);
    assert.equal(budget.inFlight(), 0);
    assert.equal(client.counts().in_flight, 0);
  }
});
