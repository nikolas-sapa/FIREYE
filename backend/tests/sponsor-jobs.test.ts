import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SponsorBudget } from '../integrations/receipts.ts';
import { SponsorJobs } from '../integrations/jobs.ts';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ClientConfig, Snapshot } from '../integrations/receipts.ts';
import type { SponsorJob } from '../integrations/jobs.ts';
import { createIrisClient } from '../integrations/iris/client.ts';
import type { Reservation } from '../integrations/receipts.ts';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';

function snapshot(): Snapshot {
  const now = Date.now();
  return { incident_id: 'i1', run_id: 'r1', authority_epoch: 1, input_revision: 1, snapshot_id: 's1', received_cutoff_ms: now, valid_until_ms: now + 1000,
    evidence: [{ evidence_id: 'e1', source_id: 'source1', rights_manifest_id: 'rights1', source_kind: 'simulated', captured_at_ms: now - 10, received_at_ms: now - 5,
      modality: 'eo', synthetic: true, radiometric: false, calibration: null, content_hash: createHash('sha256').update(Buffer.from(png, 'base64')).digest('hex'), byte_length: Buffer.from(png, 'base64').length, width_px: 1, height_px: 1 }] };
}
function job(n = 1): SponsorJob { return { job_id: `j${n}`, adapter: 'gemini', task_version: 'v1', model: 'gemini-2.5-flash', snapshot: { ...snapshot(), snapshot_id: `s${n}` }, deadline_at_ms: Date.now() + 500, max_call_micro: 100, task_input: { evidence_id: 'e1', png_base64: png } }; }
function config(extra: Partial<ClientConfig> = {}): ClientConfig { return { enabled: true, authorization_id: 'auth1', budget: new SponsorBudget(100, 100_000), is_current: () => true, ...extra }; }
const positive = { ok: true as const, value: { kind: 'evidence-analysis', verification_status: 'unverified', evidence_ids: ['e1'], hypotheses: ['fire'], synthesis: 'review-required' } };

test('SP03 default budget and scheduler grant 0 unapproved calls', async () => {
  assert.equal(new SponsorBudget().reserve(1), false);
  const jobs = new SponsorJobs();
  let calls = 0;
  const result = await jobs.submit({}, async () => { calls++; return { ok: true, value: null }; });
  assert.equal(result.ok, false);
  assert.equal(calls, 0);
});

test('SP03 20 duplicates, alternate job ID/deadline still 1 immutable input invocation', async () => {
  let calls = 0;
  const jobs = new SponsorJobs(config());
  const input = job();
  const run = async () => { calls++; return positive; };
  const pending = Array.from({ length: 20 }, () => jobs.submit(input, run));
  pending.push(jobs.submit({ ...input, job_id: 'alternate', deadline_at_ms: input.deadline_at_ms + 1 }, run));
  for (const result of await Promise.all(pending)) assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(jobs.counts().retained, 1);
  const conflict = await jobs.submit({ ...input, snapshot: { ...input.snapshot, input_revision: 2 } }, run);
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, 'IDENTITY_CONFLICT');
});

test('SP03 scheduled actual Iris client maxcalls1 reserves once, preserves server provenance, finite planner SHA ID', async () => {
  const budget = new SponsorBudget(1, 100);
  const jobs = new SponsorJobs(config({ budget }));
  const candidate = `proposed:candidate:${'a'.repeat(64)}`;
  let calls = 0;
  const input = job();
  const result = await jobs.submit({ ...input, adapter: 'iris', model: 'projects/public-fixture/models/iris-latest', task_input: { candidate_ids: [candidate] } }, async (_signal, reservation, bound) => {
    const client = createIrisClient({ ...config({ budget }), max_call_micro: 100, deadline_ms: 500, reservation,
      model: 'projects/public-fixture/models/iris-latest', registered_candidate_ids: [candidate], transport_mode: 'fixture',
      transport: async () => { calls++; return Response.json({ model: 'projects/public-fixture/models/iris-latest', answers: { ranking: {
        choice: candidate, probabilities: { [candidate]: 1 }, confidence: 1 } } }); } });
    return client.analyze(bound);
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
  assert.equal(result.receipt?.provenance, 'fixture');
  assert.equal(result.receipt?.fresh_provider_call, false);
  assert.equal(result.receipt?.status, 'accepted');
});

test('SP03 <=2 physical in flight, <=8 queued, eleventh rejects', async () => {
  const jobs = new SponsorJobs(config());
  const releases: (() => void)[] = [];
  let calls = 0;
  const run = async () => { calls++; await new Promise<void>(resolve => releases.push(resolve)); return positive; };
  const pending = Array.from({ length: 10 }, (_, n) => jobs.submit(job(n + 1), run));
  await delay(1);
  assert.equal(jobs.counts().in_flight, 2);
  assert.equal(jobs.counts().queued, 8);
  assert.equal((await jobs.submit(job(11), run)).ok, false);
  while (calls < 10) { for (const release of releases.splice(0)) release(); await delay(1); }
  for (const release of releases.splice(0)) release();
  const results = await Promise.all(pending);
  assert.equal(results.filter(result => result.ok).length, 10);
  assert.equal(calls, 10);
});

test('SP03 deadline holds physical slots, queued deadline resolves, no retries', async () => {
  const jobs = new SponsorJobs(config());
  let calls = 0;
  const releases: (() => void)[] = [];
  const pending = Array.from({ length: 3 }, (_, n) => jobs.submit({ ...job(n + 1), deadline_at_ms: Date.now() + 20 }, async () => {
    calls++;
    await new Promise<void>(resolve => releases.push(resolve));
    return positive;
  }));
  const results = await Promise.all(pending);
  assert.equal(results.filter(result => !result.ok).length, 3);
  assert.equal(calls, 2);
  assert.equal(jobs.counts().in_flight, 2);
  for (const release of releases) release();
  await delay(1);
  assert.equal(jobs.counts().in_flight, 0);
  assert.equal(calls, 2);
});

test('SP03 failure retains full reservation, second over budget invokes 0 additional work', async () => {
  const budget = new SponsorBudget(2, 100);
  const jobs = new SponsorJobs(config({ budget }));
  let calls = 0;
  assert.equal((await jobs.submit(job(), async () => { calls++; throw Error('private'); })).ok, false);
  assert.equal((await jobs.submit(job(2), async () => { calls++; return positive; })).ok, false);
  assert.equal(calls, 1);
  assert.deepEqual(budget.usage(), { calls: 1, reserved_micro: 100 });
});

test('SP03 600 disabled provider jobs advance independent 600 ticks, 0 calls', async () => {
  const jobs = new SponsorJobs();
  let ticks = 0;
  let calls = 0;
  for (let n = 0; n < 600; n++) { ticks++; assert.equal((await jobs.submit(job(n), async () => { calls++; return positive; })).ok, false); }
  assert.equal(ticks, 600);
  assert.equal(calls, 0);
});

test('SP02 20 superseded job results produce 0 accepted outputs; 20 hostile results leak 0 raw text', async () => {
  for (let n = 0; n < 20; n++) {
    let current = true;
    const jobs = new SponsorJobs(config({ is_current: () => current }));
    assert.equal((await jobs.submit(job(n), async () => { current = false; return positive; })).ok, false);
    const raw = `private-provider-raw-${n}`;
    const unsafe = await new SponsorJobs(config()).submit(job(n), async () => ({ ok: true, value: { raw } }));
    assert.equal(unsafe.ok, false);
    assert.equal(JSON.stringify(unsafe).includes(raw), false);
  }
});

test('SP02 real Iris cached success becomes STALE after currentness changes, 0 extra calls', async () => {
  let current = true;
  let calls = 0;
  const budget = new SponsorBudget(2, 200);
  const jobs = new SponsorJobs(config({ budget, is_current: () => current }));
  const input = { ...job(), adapter: 'iris' as const, model: 'projects/public-fixture/models/iris-latest', task_input: { candidate_ids: ['c1'] } };
  const run = async (_signal: AbortSignal, reservation: Reservation, bound: unknown) => {
    const client = createIrisClient({ ...config({ budget, is_current: () => current }), max_call_micro: 100, deadline_ms: 500, reservation,
      model: input.model, registered_candidate_ids: ['c1'], transport_mode: 'fixture', transport: async () => {
        calls++; return Response.json({ model: input.model, answers: { ranking: { choice: 'c1', probabilities: { c1: 1 }, confidence: 1 } } });
      } });
    return client.analyze(bound);
  };
  assert.equal((await jobs.submit(input, run)).ok, true);
  current = false;
  const cached = await jobs.submit(input, run);
  assert.equal(cached.ok, false);
  if (!cached.ok) assert.equal(cached.code, 'STALE');
  assert.equal(calls, 1);
});

test('SP03 real Iris different candidate task input produces c2, never cached c1', async () => {
  let calls = 0;
  const budget = new SponsorBudget(2, 200);
  const jobs = new SponsorJobs(config({ budget }));
  const first = { ...job(), adapter: 'iris' as const, model: 'projects/public-fixture/models/iris-latest', task_input: { candidate_ids: ['c1'] } };
  const run = (candidate: string) => async (_signal: AbortSignal, reservation: Reservation, bound: unknown) => {
    const client = createIrisClient({ ...config({ budget }), max_call_micro: 100, deadline_ms: 500, reservation,
      model: first.model, registered_candidate_ids: ['c1', 'c2'], transport_mode: 'fixture', transport: async () => {
        calls++; return Response.json({ model: first.model, answers: { ranking: { choice: candidate, probabilities: { [candidate]: 1 }, confidence: 1 } } });
      } });
    return client.analyze(bound);
  };
  assert.equal((await jobs.submit(first, run('c1'))).ok, true);
  const second = await jobs.submit({ ...first, job_id: 'j2', task_input: { candidate_ids: ['c2'] } }, run('c2'));
  assert.equal(second.ok, true);
  if (second.ok) assert.equal((second.value as { ranking: { candidate_id: string }[] }).ranking[0].candidate_id, 'c2');
  assert.equal(calls, 2);
});

test('SP02 cached Promise resolution rechecks currentness, 0 actionable cached values', async () => {
  let current = true;
  const jobs = new SponsorJobs(config({ is_current: () => current }));
  const input = job();
  assert.equal((await jobs.submit(input, async () => positive)).ok, true);
  const cached = jobs.submit(input, async () => positive);
  current = false;
  const result = await cached;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'STALE');
});

test('SP03 bound frozen input prevents closure mismatch, actual issued Iris receipt rejects changed c2', async () => {
  const budget = new SponsorBudget(1, 100);
  const jobs = new SponsorJobs(config({ budget }));
  const input = { ...job(), adapter: 'iris' as const, model: 'projects/public-fixture/models/iris-latest', task_input: { candidate_ids: ['c1'] } };
  const result = await jobs.submit(input, async (_signal, reservation, bound) => {
    assert.ok(Object.isFrozen(bound));
    assert.deepEqual('candidate_ids' in bound && bound.candidate_ids, ['c1']);
    const client = createIrisClient({ ...config({ budget }), max_call_micro: 100, deadline_ms: 500, reservation, model: input.model,
      registered_candidate_ids: ['c1', 'c2'], transport_mode: 'fixture', transport: async () => Response.json({ model: input.model,
        answers: { ranking: { choice: 'c2', probabilities: { c2: 1 }, confidence: 1 } } }) });
    return client.analyze({ snapshot: input.snapshot, candidate_ids: ['c2'] });
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'INVALID_REPLY');
});

test('SP03 query/evidence task inputs bind identity, 4 distinct jobs invoke 4 callbacks', async () => {
  const jobs = new SponsorJobs(config());
  let calls = 0;
  const base = job();
  const twoEvidence = { ...base.snapshot, evidence: [...base.snapshot.evidence, { ...base.snapshot.evidence[0], evidence_id: 'e2' }] };
  for (const evidence_id of ['e1', 'e2']) {
    assert.equal((await jobs.submit({ ...base, job_id: `j-${evidence_id}`, snapshot: twoEvidence, task_input: { evidence_id, png_base64: png } }, async () => { calls++; return { ...positive, value: { ...positive.value, evidence_ids: [evidence_id] } }; })).ok, true);
  }
  for (const query of ['public fire one', 'public fire two']) {
    assert.equal((await jobs.submit({ ...base, adapter: 'treg', job_id: `j-${calls}`, task_input: { query } }, async () => { calls++; return { ok: true, value: { kind: 'public-source-links', urls: [], verification_status: 'unverified', served_by: null } }; })).ok, true);
  }
  assert.equal(calls, 4);
  assert.equal(jobs.counts().retained, 4);
});
