import { createHash } from 'node:crypto';
import { closed, fail, freeze, id, ids, plainJson, positive, record, serverReceipt, SponsorBudget, validSnapshot } from './receipts.ts';
import { safeSourceUrl } from './treg/client.ts';
import type { Adapter, ClientConfig, Reservation, Result, Snapshot } from './receipts.ts';

export type SponsorJob = Readonly<{
  job_id: string; adapter: Adapter; task_version: string; model: string;
  snapshot: Snapshot; deadline_at_ms: number; max_call_micro: number;
}>;
type Pending = { job: SponsorJob; run: (signal: AbortSignal, reservation: Reservation) => Promise<Result<unknown>>; resolve: (result: Result<unknown>) => void; settled: boolean; queueTimer?: ReturnType<typeof setTimeout> };

// One process, bounded retained identities. No distributed queue/transaction claim.
export class SponsorJobs {
  readonly #config: ClientConfig;
  readonly #queue: Pending[] = [];
  readonly #results = new Map<string, Promise<Result<unknown>>>();
  readonly #jobIds = new Map<string, string>();
  #active = 0;
  constructor(config: ClientConfig = {}) { this.#config = { ...config }; }
  counts(): Readonly<{ in_flight: number; queued: number; retained: number }> {
    return Object.freeze({ in_flight: this.#active, queued: this.#queue.length, retained: this.#results.size });
  }
  submit(input: unknown, run: (signal: AbortSignal, reservation: Reservation) => Promise<Result<unknown>>): Promise<Result<unknown>> {
    const config = this.#config;
    if (config.enabled !== true) return Promise.resolve(fail('DISABLED'));
    if (!id(config.authorization_id) || !(config.budget instanceof SponsorBudget) || typeof config.is_current !== 'function') return Promise.resolve(fail('UNAUTHORIZED'));
    const now = (config.now ?? Date.now)();
    if (!plainJson(input) || !closed(input, ['job_id', 'adapter', 'task_version', 'model', 'snapshot', 'deadline_at_ms', 'max_call_micro'])
      || !id(input.job_id) || !id(input.task_version) || typeof input.model !== 'string' || input.model.length > 200
      || !['iris', 'gemini', 'fal', 'treg'].includes(String(input.adapter)) || !validSnapshot(input.snapshot, now)
      || !positive(input.max_call_micro) || !positive(input.deadline_at_ms) || input.deadline_at_ms <= now || input.deadline_at_ms - now > 10_000) return Promise.resolve(fail('INVALID_INPUT'));
    const job = freeze(structuredClone(input)) as SponsorJob;
    const identity = createHash('sha256').update(JSON.stringify([job.adapter, job.task_version, job.model, job.snapshot])).digest('hex');
    const previous = this.#jobIds.get(job.job_id);
    if (previous && previous !== identity) return Promise.resolve(fail('IDENTITY_CONFLICT'));
    const duplicate = this.#results.get(identity);
    if (duplicate) { if (this.#jobIds.size >= 256 && !previous) return Promise.resolve(fail('QUEUE_FULL')); this.#jobIds.set(job.job_id, identity); return duplicate; }
    if (this.#results.size >= 256 || (this.#active >= 2 && this.#queue.length >= 8)) return Promise.resolve(fail('QUEUE_FULL'));
    let resolve!: Pending['resolve'];
    const result = new Promise<Result<unknown>>(done => { resolve = done; });
    this.#results.set(identity, result);
    this.#jobIds.set(job.job_id, identity);
    const pending: Pending = { job, run, resolve, settled: false };
    pending.queueTimer = setTimeout(() => {
      const index = this.#queue.indexOf(pending);
      if (index >= 0) { this.#queue.splice(index, 1); pending.settled = true; pending.resolve(fail('DEADLINE')); }
    }, job.deadline_at_ms - now);
    this.#queue.push(pending);
    this.#drain();
    return result;
  }
  #drain(): void {
    while (this.#active < 2 && this.#queue.length) {
      const pending = this.#queue.shift()!;
      clearTimeout(pending.queueTimer);
      const { job } = pending;
      const config = this.#config;
      const now = config.now ?? Date.now;
      try {
        if (job.deadline_at_ms <= now() || !validSnapshot(job.snapshot, now()) || !config.is_current!(job.snapshot)) {
          pending.resolve(fail('STALE'));
          continue;
        }
      } catch { pending.resolve(fail('STALE')); continue; }
      const reservation = config.budget!.prepay(job.max_call_micro);
      if (!reservation) { pending.resolve(fail('BUDGET')); continue; }
      this.#active++;
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        pending.settled = true;
        pending.resolve(fail('DEADLINE'));
        // Do not release physical slot until work actually settles.
      }, job.deadline_at_ms - now());
      void Promise.resolve().then(() => pending.run(controller.signal, reservation)).then(result => {
        if (pending.settled) return;
        if (job.deadline_at_ms <= now()) { pending.resolve(fail('DEADLINE')); return; }
        if (!validSnapshot(job.snapshot, now()) || !config.is_current!(job.snapshot)) { pending.resolve(fail('STALE')); return; }
        // Only actual clients should be supplied. Never pass task exceptions/raw errors through.
        if (!safeResult(result)) pending.resolve(fail('INVALID_REPLY'));
        else {
          const receipt = serverReceipt(result.receipt) ? result.receipt : undefined;
          pending.resolve(result.ok ? freeze({ ok: true, value: structuredClone(result.value), ...(receipt ? { receipt } : {}) })
            : Object.freeze({ ...fail(result.code), ...(receipt ? { receipt } : {}) }));
        }
      }).catch(() => { if (!pending.settled) pending.resolve(fail('TRANSPORT')); }).finally(() => {
        clearTimeout(timer);
        this.#active--;
        this.#drain();
      });
    }
  }
}

function safeResult(result: unknown): result is Result<unknown> {
  if (!plainJson(result) || !record(result) || typeof result.ok !== 'boolean' || Object.keys(result).some(key => !['ok', 'value', 'code', 'receipt'].includes(key))) return false;
  if (!result.ok) return typeof result.code === 'string' && ['DISABLED', 'UNAUTHORIZED', 'UNSUPPORTED', 'INVALID_INPUT', 'STALE', 'BUDGET', 'DEADLINE', 'TRANSPORT', 'REDIRECT', 'OVERSIZE', 'INVALID_REPLY', 'QUEUE_FULL', 'IDENTITY_CONFLICT'].includes(result.code);
  const value = result.value;
  if (!record(value)) return false;
  if (value.kind === 'evidence-analysis') return closed(value, ['kind', 'verification_status', 'evidence_ids', 'hypotheses', 'synthesis'])
    && value.verification_status === 'unverified' && ids(value.evidence_ids) && Array.isArray(value.hypotheses) && value.hypotheses.length <= 5
    && value.hypotheses.every(kind => ['human', 'animal', 'fire', 'gas_canister', 'other'].includes(kind)) && ['review-required', 'insufficient-evidence'].includes(String(value.synthesis));
  if (value.kind === 'finite-ranking') return closed(value, ['kind', 'ranking']) && Array.isArray(value.ranking) && value.ranking.length <= 32
    && value.ranking.every(row => closed(row, ['candidate_id', 'score', 'scale']) && id(row.candidate_id) && typeof row.score === 'number' && Number.isFinite(row.score) && row.score >= 0 && row.score <= 1 && row.scale === 'provider choice probability, not calibrated incident probability');
  if (value.kind === 'public-source-links') return closed(value, ['kind', 'urls', 'verification_status', 'served_by']) && value.verification_status === 'unverified'
    && Array.isArray(value.urls) && value.urls.length <= 5 && value.urls.every(url => safeSourceUrl(url) === url) && (value.served_by === null || id(value.served_by));
  return false;
}
