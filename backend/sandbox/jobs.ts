import { createHash } from 'node:crypto';
import { closed, freeze, id, ids, plainJson, positive, SponsorBudget, validSnapshot } from '../integrations/receipts.ts';
import type { Failure } from '../integrations/receipts.ts';
import type { SandboxConfig, SandboxExecutor, SandboxInput, SandboxJob, SandboxResult, SandboxValue } from './types.ts';

const operation = 'score-received-candidates.v1';
const requestBytes = 16_384;
const resultBytes = 8192;
const deadlineMs = 30_000;
const fail = (code: Failure): Readonly<{ ok: false; code: Failure }> => Object.freeze({ ok: false, code });
type Pending = { job: SandboxJob; bound: SandboxInput; hash: string; resolve: (result: SandboxResult) => void;
  settled: boolean; timer?: ReturnType<typeof setTimeout> };

function bytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function validBound(input: unknown, now: number): input is SandboxInput {
  if (!plainJson(input) || !closed(input, ['operation', 'snapshot', 'candidates']) || input.operation !== operation
    || !validSnapshot(input.snapshot, now) || !Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > 32) return false;
  const seen = new Set<string>();
  const snapshot = input.snapshot;
  for (const candidate of input.candidates) {
    if (!closed(candidate, ['candidate_id', 'evidence_ids']) || !id(candidate.candidate_id) || seen.has(candidate.candidate_id)
      || !ids(candidate.evidence_ids) || !candidate.evidence_ids.every(e => snapshot.evidence.some(received => received.evidence_id === e))) return false;
    seen.add(candidate.candidate_id);
  }
  return bytes(input) <= requestBytes;
}
function score(input: SandboxInput): SandboxValue {
  return freeze({ kind: 'received-evidence-coverage', scale: 'relative received-evidence coverage, not risk or confidence',
    ranking: input.candidates.map(candidate => ({ candidate_id: candidate.candidate_id, score: candidate.evidence_ids.length / input.snapshot.evidence.length }))
      .sort((a, b) => b.score - a.score || (a.candidate_id < b.candidate_id ? -1 : a.candidate_id > b.candidate_id ? 1 : 0)) });
}

export function createFixtureExecutor(): SandboxExecutor {
  return Object.freeze({ mode: 'fixture', execute: async (signal: AbortSignal, input: SandboxInput) => {
    if (signal.aborted) return fail('DEADLINE');
    return validBound(input, Date.now()) ? score(input) : fail('INVALID_INPUT');
  } });
}

// Deliberately no CLI import, subprocess, network, command string or VM lifecycle surface.
// Machine execution needs separate approval and a genuine bounded/cancellable binding.
export function createBoxdCliExecutor(): SandboxExecutor {
  return Object.freeze({ mode: 'boxd', execute: async () => fail('UNSUPPORTED') });
}

// One process only. No distributed queue, remote hard ceiling or cancellation claim.
export class SandboxJobs {
  readonly #config: SandboxConfig;
  readonly #queue: Pending[] = [];
  readonly #results = new Map<string, { job: SandboxJob; result: Promise<SandboxResult> }>();
  readonly #jobIds = new Map<string, string>();
  #active = 0;
  constructor(config: SandboxConfig = {}) {
    this.#config = { ...config, executor: config.executor ? Object.freeze({ ...config.executor }) : undefined,
      registered_candidate_ids: config.registered_candidate_ids ? Object.freeze([...config.registered_candidate_ids]) : undefined };
  }
  counts(): Readonly<{ in_flight: number; queued: number; retained: number }> {
    return Object.freeze({ in_flight: this.#active, queued: this.#queue.length, retained: this.#results.size });
  }
  submit(input: unknown): Promise<SandboxResult> {
    const config = this.#config;
    if (config.enabled !== true) return Promise.resolve(fail('DISABLED'));
    if (!id(config.authorization_id) || !id(config.machine_id) || !positive(config.max_job_micro) || !(config.budget instanceof SponsorBudget)
      || typeof config.is_current !== 'function' || !ids(config.registered_candidate_ids)) return Promise.resolve(fail('UNAUTHORIZED'));
    if (config.executor?.mode !== 'fixture' || typeof config.executor.execute !== 'function') return Promise.resolve(fail('UNSUPPORTED'));
    const now = this.#now();
    if (!positive(now) || !plainJson(input) || !closed(input, ['job_id', 'operation', 'snapshot', 'deadline_at_ms', 'task_input'])
      || !id(input.job_id) || input.operation !== operation || !positive(input.deadline_at_ms)
      || input.deadline_at_ms <= now || input.deadline_at_ms - now > deadlineMs
      || !closed(input.task_input, ['candidates']) || bytes(input) > requestBytes) return Promise.resolve(fail('INVALID_INPUT'));
    const bound = { operation: input.operation, snapshot: input.snapshot, candidates: input.task_input.candidates };
    if (!validBound(bound, now) || !bound.candidates.every(candidate => config.registered_candidate_ids!.includes(candidate.candidate_id))) return Promise.resolve(fail('INVALID_INPUT'));
    const job = freeze(structuredClone(input)) as SandboxJob;
    if (!this.#current(job)) return Promise.resolve(fail('STALE'));
    const immutable = freeze(structuredClone(bound));
    const hash = createHash('sha256').update(canonical(immutable)).digest('hex');
    const previous = this.#jobIds.get(job.job_id);
    if (previous && previous !== hash) return Promise.resolve(fail('IDENTITY_CONFLICT'));
    if (!previous && this.#jobIds.size >= 256) return Promise.resolve(fail('QUEUE_FULL'));
    const duplicate = this.#results.get(hash);
    if (duplicate) { this.#jobIds.set(job.job_id, hash); return this.#atRead(job, this.#atRead(duplicate.job, duplicate.result)); }
    if (this.#results.size >= 128 || (this.#active >= 2 && this.#queue.length >= 8)) return Promise.resolve(fail('QUEUE_FULL'));
    let resolve!: Pending['resolve'];
    const result = new Promise<SandboxResult>(done => { resolve = done; });
    this.#results.set(hash, { job, result });
    this.#jobIds.set(job.job_id, hash);
    const pending: Pending = { job, bound: immutable, hash, resolve, settled: false };
    pending.timer = setTimeout(() => {
      const index = this.#queue.indexOf(pending);
      if (index >= 0) { this.#queue.splice(index, 1); pending.settled = true; resolve(fail('DEADLINE')); }
    }, job.deadline_at_ms - now);
    this.#queue.push(pending);
    this.#drain();
    return this.#atRead(job, result);
  }
  #now(): number { try { return (this.#config.now ?? Date.now)(); } catch { return NaN; } }
  #current(job: SandboxJob): boolean {
    try { const now = this.#now(); return positive(now) && validSnapshot(job.snapshot, now) && this.#config.is_current!(job.snapshot) === true; } catch { return false; }
  }
  #atRead(job: SandboxJob, result: Promise<SandboxResult>): Promise<SandboxResult> {
    return result.then(value => !this.#current(job) ? fail('STALE') : this.#now() >= job.deadline_at_ms ? fail('DEADLINE') : value);
  }
  #drain(): void {
    while (this.#active < 2 && this.#queue.length) {
      const pending = this.#queue.shift()!;
      clearTimeout(pending.timer);
      const { job } = pending;
      const started = this.#now();
      if (!this.#current(job)) { pending.resolve(fail('STALE')); continue; }
      if (started >= job.deadline_at_ms) { pending.resolve(fail('DEADLINE')); continue; }
      const budget = this.#config.budget!;
      if (!budget.acquire(this.#config.max_job_micro!)) { pending.resolve(fail('BUDGET')); continue; }
      this.#active++;
      const controller = new AbortController();
      pending.timer = setTimeout(() => {
        pending.settled = true;
        controller.abort();
        pending.resolve(fail('DEADLINE'));
        // Abort is advisory. Physical slot and budget held until execute actually settles.
      }, job.deadline_at_ms - started);
      void Promise.resolve().then(() => {
        if (pending.settled || this.#now() >= job.deadline_at_ms) return fail('DEADLINE');
        if (!this.#current(job)) return fail('STALE');
        return this.#config.executor!.execute(controller.signal, pending.bound);
      }).then(value => {
        if (pending.settled) return;
        if (!this.#current(job)) { pending.resolve(fail('STALE')); return; }
        const finished = this.#now();
        if (finished >= job.deadline_at_ms) { pending.resolve(fail('DEADLINE')); return; }
        if (!plainJson(value) || bytes(value) > resultBytes || canonical(value) !== canonical(score(pending.bound))) { pending.resolve(fail('INVALID_REPLY')); return; }
        pending.resolve(freeze({ ok: true, value: structuredClone(value) as SandboxValue, receipt: {
          contract_version: 'sandbox-jobs.v1', operation, input_hash: pending.hash, snapshot_id: job.snapshot.snapshot_id,
          provenance: 'fixture', remote_execution: false, started_at_ms: started, finished_at_ms: finished, reserved_micro: this.#config.max_job_micro!,
        } }));
      }).catch(() => { if (!pending.settled) pending.resolve(fail('TRANSPORT')); }).finally(() => {
        clearTimeout(pending.timer);
        this.#active--;
        budget.release();
        this.#drain();
      });
    }
  }
}
