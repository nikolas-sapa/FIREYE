import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { SponsorBudget } from '../integrations/receipts.ts';
import { SandboxJobs, createFixtureExecutor, createBoxdCliExecutor } from '../sandbox/jobs.ts';
import type { SandboxConfig, SandboxJob, SandboxExecutor, SandboxInput } from '../sandbox/types.ts';

function job(n = 1, deadline = Date.now() + 2000): SandboxJob {
  const now = Date.now();
  return { job_id: `job${n}`, operation: 'score-received-candidates.v1', deadline_at_ms: deadline,
    snapshot: { incident_id: 'incident1', run_id: 'run1', authority_epoch: 1, input_revision: 1, snapshot_id: `snapshot${n}`,
      received_cutoff_ms: now, valid_until_ms: now + 60_000, evidence: ['e1', 'e2'].map(evidence_id => ({ evidence_id,
        source_id: 'source1', rights_manifest_id: 'rights1', source_kind: 'simulated', captured_at_ms: now - 2, received_at_ms: now - 1,
        modality: 'eo', synthetic: true, radiometric: false, calibration: null, content_hash: 'a'.repeat(64), byte_length: 1, width_px: 1, height_px: 1 })) },
    task_input: { candidates: [{ candidate_id: 'c1', evidence_ids: ['e1'] }, { candidate_id: 'c2', evidence_ids: ['e1', 'e2'] }] } };
}
function config(extra: Partial<SandboxConfig> = {}): SandboxConfig {
  return { enabled: true, authorization_id: 'approval1', machine_id: 'explicit-fixture-machine', budget: new SponsorBudget(1000, 100_000),
    max_job_micro: 100, is_current: () => true, registered_candidate_ids: ['c1', 'c2'], executor: createFixtureExecutor(), ...extra };
}
function spy(): { executor: SandboxExecutor; calls: () => number } {
  let calls = 0;
  const fixture = createFixtureExecutor();
  return { executor: { mode: 'fixture', execute: async (signal, input) => { calls++; return fixture.execute(signal, input); } }, calls: () => calls };
}
function blocked(): { executor: SandboxExecutor; release: () => void; calls: () => number; inputs: SandboxInput[] } {
  let calls = 0;
  const releases: (() => void)[] = [];
  const inputs: SandboxInput[] = [];
  return { calls: () => calls, inputs, release: () => { for (const release of releases.splice(0)) release(); }, executor: {
    mode: 'fixture', execute: async (_signal, input) => { calls++; inputs.push(input); await new Promise<void>(resolve => releases.push(resolve));
      return createFixtureExecutor().execute(new AbortController().signal, input); } } };
}

test('SB01 20 unapproved configs yield 0 executor invocations', async () => {
  const run = spy();
  const bad: Partial<SandboxConfig>[] = [ { enabled: false }, { authorization_id: undefined }, { machine_id: undefined },
    { budget: new SponsorBudget() }, { max_job_micro: 0 }, { is_current: undefined }, { registered_candidate_ids: undefined },
    { authorization_id: 'api_key' }, { machine_id: 'machine;rm' }, { budget: new SponsorBudget(10, 0) } ];
  for (let n = 0; n < 20; n++) assert.equal((await new SandboxJobs(config({ executor: run.executor, ...bad[n % bad.length] })).submit(job())).ok, false);
  assert.equal((await new SandboxJobs().submit(job())).ok, false);
  assert.equal(run.calls(), 0);
});

test('SB07 actual fixture export yields exact finite ranking, not remote compute', async () => {
  const jobs = new SandboxJobs(config());
  const result = await jobs.submit(job());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { kind: 'received-evidence-coverage', scale: 'relative received-evidence coverage, not risk or confidence',
    ranking: [{ candidate_id: 'c2', score: 1 }, { candidate_id: 'c1', score: 0.5 }] });
  assert.equal(result.receipt.provenance, 'fixture');
  assert.equal(result.receipt.remote_execution, false);
  assert.equal(Object.isFrozen(result.value.ranking), true);
});

test('SB02 20 exact task-input duplicates, including alternate IDs, yield 1 job', async () => {
  const run = blocked();
  const jobs = new SandboxJobs(config({ executor: run.executor }));
  const input = job();
  const pending = Array.from({ length: 20 }, (_, n) => jobs.submit({ ...input, job_id: `job${n}` }));
  await delay(1);
  assert.equal(run.calls(), 1);
  assert.equal(jobs.counts().retained, 1);
  run.release();
  assert.equal((await Promise.all(pending)).filter(r => r.ok).length, 20);
  assert.equal((await jobs.submit({ ...input, task_input: { candidates: [{ candidate_id: 'c1', evidence_ids: ['e1'] }] } })).ok, false);
  assert.equal(run.calls(), 1);
});

test('SB03 <=2 physical in-flight and <=8 queued, eleventh rejection', async () => {
  const run = blocked();
  const jobs = new SandboxJobs(config({ executor: run.executor }));
  const pending = Array.from({ length: 10 }, (_, n) => jobs.submit(job(n + 1)));
  await delay(1);
  assert.deepEqual(jobs.counts(), { in_flight: 2, queued: 8, retained: 10 });
  assert.equal((await jobs.submit(job(11))).ok, false);
  for (let n = 0; n < 5; n++) { run.release(); await delay(1); assert.ok(jobs.counts().in_flight <= 2); assert.ok(jobs.counts().queued <= 8); }
  assert.equal((await Promise.all(pending)).filter(r => r.ok).length, 10);
});

test('SB03 shared actual budget grants at most 2 physical slots across schedulers', async () => {
  const budget = new SponsorBudget(10, 1000);
  const run = blocked();
  const jobs = Array.from({ length: 3 }, () => new SandboxJobs(config({ budget, executor: run.executor })));
  const pending = jobs.map((queue, n) => queue.submit(job(n + 1)));
  await delay(1);
  assert.equal(run.calls(), 2);
  assert.equal(budget.inFlight(), 2);
  run.release();
  assert.equal((await Promise.all(pending)).filter(r => r.ok).length, 2);
  await delay(1);
  assert.equal(budget.inFlight(), 0);
});

test('SB04 20 stale submits and 20 stale cached reads yield 0 current successes', async () => {
  const run = spy();
  let current = false;
  const jobs = new SandboxJobs(config({ executor: run.executor, is_current: () => current }));
  const input = job();
  for (let n = 0; n < 20; n++) assert.equal((await jobs.submit(input)).ok, false);
  assert.equal(run.calls(), 0);
  current = true;
  assert.equal((await jobs.submit(input)).ok, true);
  current = false;
  for (let n = 0; n < 20; n++) assert.equal((await jobs.submit(input)).ok, false);
  assert.equal(run.calls(), 1);
});

test('SB04 source changed while in-flight and queued yields 0 successes, no queued invocation', async () => {
  let current = true;
  const run = blocked();
  const jobs = new SandboxJobs(config({ executor: run.executor, is_current: () => current }));
  const pending = Array.from({ length: 3 }, (_, n) => jobs.submit(job(n + 1)));
  await delay(1);
  current = false;
  run.release();
  assert.equal((await Promise.all(pending)).filter(r => r.ok).length, 0);
  assert.equal(run.calls(), 2);
});

test('SB05 timed-out hung jobs keep physical slots, queue deadline and late results yield 0 success', async () => {
  const budget = new SponsorBudget(10, 1000);
  const run = blocked();
  const jobs = new SandboxJobs(config({ budget, executor: run.executor }));
  const pending = Array.from({ length: 3 }, (_, n) => jobs.submit(job(n + 1, Date.now() + 30)));
  const results = await Promise.all(pending);
  assert.equal(results.filter(r => r.ok).length, 0);
  assert.equal(run.calls(), 2);
  assert.equal(jobs.counts().in_flight, 2);
  assert.equal(budget.inFlight(), 2);
  run.release();
  await delay(1);
  assert.equal(jobs.counts().in_flight, 0);
  assert.equal(budget.inFlight(), 0);
  assert.equal(results.filter(r => r.ok).length, 0);
});

test('SB05 cached result past deadline yields 0 successes, >30,000ms rejects', async () => {
  let now = Date.now();
  const input = job(1, now + 100);
  const jobs = new SandboxJobs(config({ now: () => now }));
  assert.equal((await jobs.submit(input)).ok, true);
  now += 100;
  assert.equal((await jobs.submit(input)).ok, false);
  assert.equal((await jobs.submit({ ...input, job_id: 'alternate', deadline_at_ms: now + 100 })).ok, false);
  assert.equal((await jobs.submit({ ...input, job_id: 'long', deadline_at_ms: now + 30_001 })).ok, false);
});

test('SB06 closed allowlist, received IDs, graph and request byte bounds reject without invocation', async () => {
  const run = spy();
  const jobs = new SandboxJobs(config({ executor: run.executor }));
  const input = job();
  const bad: unknown[] = [ { ...input, operation: 'shell' }, { ...input, command: 'whoami' }, { ...input, env: {} },
    { ...input, private_world: {} }, { ...input, task_input: { candidates: [{ candidate_id: 'c1', evidence_ids: ['missing'] }] } },
    { ...input, task_input: { candidates: [{ candidate_id: 'unregistered', evidence_ids: ['e1'] }] } },
    { ...input, task_input: { candidates: [{ candidate_id: 'secret', evidence_ids: ['e1'] }] } },
    { ...input, snapshot: { ...input.snapshot, evidence: input.snapshot.evidence.map(e => ({ ...e, command: 'whoami' })) } } ];
  const accessor = { ...input }; Object.defineProperty(accessor, 'job_id', { get() { throw Error('must not execute getter'); } }); bad.push(accessor);
  const oversized = { ...input, job_id: 'oversize', task_input: { candidates: Array.from({ length: 32 }, (_, n) => ({
    candidate_id: `candidate${n}`, evidence_ids: Array.from({ length: 16 }, (_, i) => `e${i}${'x'.repeat(40)}`) })) },
    snapshot: { ...input.snapshot, evidence: Array.from({ length: 16 }, (_, i) => ({ ...input.snapshot.evidence[0], evidence_id: `e${i}${'x'.repeat(40)}` })) } };
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) > 16_384);
  bad.push(oversized);
  for (const value of bad) assert.equal((await jobs.submit(value)).ok, false);
  assert.equal(run.calls(), 0);
});

test('SB06 malformed/oversized executor output accepted 0 times, exceptions sanitized', async () => {
  const outputs = [ { kind: 'received-evidence-coverage', ranking: [{ candidate_id: 'c1', score: Infinity }] },
    { command: 'whoami' }, { value: 'x'.repeat(8193) }, { kind: 'received-evidence-coverage',
      scale: 'relative received-evidence coverage, not risk or confidence', ranking: [{ candidate_id: 'c1', score: 1 }] } ];
  for (const output of outputs) {
    const jobs = new SandboxJobs(config({ executor: { mode: 'fixture', execute: async () => output } }));
    assert.equal((await jobs.submit(job())).ok, false);
  }
  const jobs = new SandboxJobs(config({ executor: { mode: 'fixture', execute: async () => { throw Error('secret internals'); } } }));
  assert.deepEqual(await jobs.submit(job()), { ok: false, code: 'TRANSPORT' });
});

test('SB07 actual Boxd export stays unsupported with positive authorization/budget, 0 spend', async () => {
  const budget = new SponsorBudget(1, 100);
  const boxd = createBoxdCliExecutor();
  assert.equal(boxd.mode, 'boxd');
  const input = job();
  assert.deepEqual(await boxd.execute(new AbortController().signal, { operation: input.operation, snapshot: input.snapshot, ...input.task_input }),
    { ok: false, code: 'UNSUPPORTED' });
  assert.deepEqual(await new SandboxJobs(config({ budget, executor: boxd })).submit(input), { ok: false, code: 'UNSUPPORTED' });
  assert.deepEqual(budget.usage(), { calls: 0, reserved_micro: 0 });
});

test('SB02 canonical property order dedupes, <=128 results and <=256 aliases retained', async () => {
  const run = spy();
  const jobs = new SandboxJobs(config({ executor: run.executor }));
  const input = job();
  assert.equal((await jobs.submit(input)).ok, true);
  assert.equal((await jobs.submit({ ...input, job_id: 'reordered', task_input: { candidates: input.task_input.candidates.map(candidate => ({
    evidence_ids: candidate.evidence_ids, candidate_id: candidate.candidate_id })) } })).ok, true);
  assert.equal(run.calls(), 1);
  for (let n = 2; n <= 128; n++) assert.equal((await jobs.submit(job(n))).ok, true);
  assert.equal((await jobs.submit(job(129))).ok, false);
  assert.equal(jobs.counts().retained, 128);
  for (let n = 0; n < 127; n++) assert.equal((await jobs.submit({ ...input, job_id: `alias${n}` })).ok, true);
  assert.equal((await jobs.submit({ ...input, job_id: 'alias-overflow' })).ok, false);
  assert.equal(run.calls(), 128);
});

test('SB05 exact 30,000ms horizon accepts fixture, currentness/clock exceptions fail closed', async () => {
  const input = job();
  const now = Date.now();
  assert.equal((await new SandboxJobs(config({ now: () => now })).submit({ ...input, deadline_at_ms: now + 30_000 })).ok, true);
  const run = spy();
  assert.equal((await new SandboxJobs(config({ executor: run.executor, now: () => { throw Error('clock'); } })).submit(input)).ok, false);
  assert.equal((await new SandboxJobs(config({ executor: run.executor, is_current: () => { throw Error('currentness'); } })).submit(input)).ok, false);
  assert.equal(run.calls(), 0);
});

test('SB02 caller input mutation cannot change dispatched task or retained identity', async () => {
  const run = blocked();
  const jobs = new SandboxJobs(config({ executor: run.executor }));
  const input = { ...job(), task_input: { candidates: [{ candidate_id: 'c1', evidence_ids: ['e1'] }, { candidate_id: 'c2', evidence_ids: ['e1', 'e2'] }] } };
  const pending = jobs.submit(input);
  input.task_input.candidates[0].evidence_ids.push('e2');
  await delay(1);
  assert.deepEqual(run.inputs[0].candidates[0].evidence_ids, ['e1']);
  assert.equal(Object.isFrozen(run.inputs[0].candidates), true);
  run.release();
  assert.equal((await pending).ok, true);
});
