import { createHash } from 'node:crypto';
import { SponsorJobs } from '../integrations/jobs.ts';
import { createIrisClient } from '../integrations/iris/client.ts';
import { closed, configured, fail, freeze, ids, plainJson, record, validSnapshot } from '../integrations/receipts.ts';
import type { Result } from '../integrations/receipts.ts';
import type { IrisClient, IrisConfig, IrisRanking } from '../integrations/iris/types.ts';

export type QueuedIrisConfig = Omit<IrisConfig, 'credential' | 'reservation' | 'on_transport_settled'>;
export type QueuedIrisClient = IrisClient & Readonly<{ counts: () => ReturnType<SponsorJobs['counts']> & Readonly<{ physical_in_flight: number }> }>;

// SponsorJobs has already checked the closed finite-ranking shape, scores and
// task membership. Narrow its internal unknown value, never cast a raw Result.
function ranking(value: unknown): value is IrisRanking {
  return record(value) && value.kind === 'finite-ranking' && Array.isArray(value.ranking)
    && value.ranking.every(row => record(row) && typeof row.candidate_id === 'string'
      && typeof row.score === 'number' && row.scale === 'provider choice probability, not calibrated incident probability');
}

// Inert construction. No caller callbacks, job IDs or per-input configuration.
export function createQueuedIrisClient(options: QueuedIrisConfig = {}): QueuedIrisClient {
  const config: QueuedIrisConfig = { enabled: options.enabled, authorization_id: options.authorization_id,
    budget: options.budget, max_call_micro: options.max_call_micro, deadline_ms: options.deadline_ms,
    now: options.now, is_current: options.is_current, model: options.model,
    registered_candidate_ids: options.registered_candidate_ids?.slice(),
    transport: options.transport, transport_mode: options.transport_mode };
  const jobs = new SponsorJobs(config);
  const deadlines = new Map<string, number>();
  return Object.freeze({ counts: () => Object.freeze({ ...jobs.counts(), physical_in_flight: config.budget?.inFlight() ?? 0 }), async analyze(input: unknown): Promise<Result<IrisRanking>> {
    try {
      const gate = configured(config);
      if (gate) return fail(gate);
      const now = config.now ?? Date.now;
      if (!plainJson(input) || !closed(input, ['snapshot', 'candidate_ids']) || !ids(input.candidate_ids)
        || !validSnapshot(input.snapshot, now()) || !ids(config.registered_candidate_ids)
        || !input.candidate_ids.every(candidate => config.registered_candidate_ids!.includes(candidate))) return fail('INVALID_INPUT');
      if (!config.transport) return fail('UNSUPPORTED');
      if (!['fixture', 'local-http'].includes(config.transport_mode ?? '')) return fail('UNAUTHORIZED');
      if (typeof config.model !== 'string' || !/^projects\/[A-Za-z0-9_-]{1,128}\/models\/iris(?:-[A-Za-z0-9_-]{1,40})?$/.test(config.model)) return fail('UNSUPPORTED');
      const owned = freeze({ snapshot: structuredClone(input.snapshot), candidate_ids: [...input.candidate_ids] });
      if (!config.is_current!(owned.snapshot)) return fail('STALE');
      const job_id = `job:${createHash('sha256').update(JSON.stringify(owned)).digest('hex')}`;
      let deadline = deadlines.get(job_id);
      if (deadline === undefined) {
        if (deadlines.size >= 256) return fail('QUEUE_FULL');
        deadline = now() + config.deadline_ms!;
      }
      if (now() >= deadline) return fail('DEADLINE');
      const retained = jobs.counts().retained;
      const pending = jobs.submit({ job_id, adapter: 'iris', task_version: 'queued-iris.v1', model: config.model,
        snapshot: owned.snapshot, deadline_at_ms: deadline, max_call_micro: config.max_call_micro,
        task_input: { candidate_ids: owned.candidate_ids } }, async (_signal, reservation, bound) => {
          let started = false;
          let settle!: () => void;
          const settled = new Promise<void>(resolve => { settle = resolve; });
          const result = await createIrisClient({ ...config, reservation, deadline_ms: Math.max(1, deadline - now()),
            transport: request => { started = true; return config.transport!(request); },
            on_transport_settled: settle }).analyze(bound);
          // SponsorJobs races deadline independently. Keep its physical slot
          // held until actual transport/body work releases the shared budget.
          if (started) await settled;
          return result;
        });
      // submit admits synchronously. Rejected jobs must not consume wrapper
      // identity capacity or acquire an original deadline they never used.
      if (jobs.counts().retained > retained) deadlines.set(job_id, deadline);
      const result = await pending;
      // This async adapter introduces a read boundary beyond SponsorJobs' own.
      if (!validSnapshot(owned.snapshot, now()) || !config.is_current!(owned.snapshot)) return fail('STALE');
      if (now() >= deadline) return fail('DEADLINE');
      if (!result.ok) return result;
      if (!ranking(result.value)) return fail('INVALID_REPLY');
      return freeze({ ok: true, value: result.value, ...(result.receipt ? { receipt: result.receipt } : {}) });
    } catch { return fail('STALE'); }
  } });
}
