import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SponsorBudget } from '../integrations/receipts.ts';
import { SponsorJobs } from '../integrations/jobs.ts';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ClientConfig, Snapshot } from '../integrations/receipts.ts';
import type { SponsorJob } from '../integrations/jobs.ts';
import { createIrisClient } from '../integrations/iris/client.ts';

function snapshot(): Snapshot {
  const now = Date.now();
  return { incident_id: 'i1', run_id: 'r1', authority_epoch: 1, input_revision: 1, snapshot_id: 's1', received_cutoff_ms: now, valid_until_ms: now + 1000,
    evidence: [{ evidence_id: 'e1', source_id: 'source1', rights_manifest_id: 'rights1', source_kind: 'simulated', captured_at_ms: now - 10, received_at_ms: now - 5,
      modality: 'eo', synthetic: true, radiometric: false, calibration: null, content_hash: createHash('sha256').update('fixture').digest('hex'), byte_length: 7, width_px: 1, height_px: 1 }] };
}
function job(n = 1): SponsorJob { return { job_id: `j${n}`, adapter: 'gemini', task_version: 'v1', model: 'gemini-2.5-flash', snapshot: { ...snapshot(), snapshot_id: `s${n}` }, deadline_at_ms: Date.now() + 500, max_call_micro: 100 }; }
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
  const result = await jobs.submit({ ...input, adapter: 'iris', model: 'projects/public-fixture/models/iris-latest' }, async (_signal, reservation) => {
    const client = createIrisClient({ ...config({ budget }), max_call_micro: 100, deadline_ms: 500, reservation,
      model: 'projects/public-fixture/models/iris-latest', registered_candidate_ids: [candidate], transport_mode: 'fixture',
      transport: async () => { calls++; return Response.json({ model: 'projects/public-fixture/models/iris-latest', answers: { ranking: {
        choice: candidate, probabilities: { [candidate]: 1 }, confidence: 1 } } }); } });
    return client.analyze({ snapshot: input.snapshot, candidate_ids: [candidate] });
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
