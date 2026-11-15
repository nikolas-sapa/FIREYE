import { createHash } from 'node:crypto';
import { SponsorJobs } from '../integrations/jobs.ts';
import { createGeminiClient } from '../integrations/gemini/client.ts';
import { closed, configured, fail, freeze, id, plainJson, record, validPng, validSnapshot } from '../integrations/receipts.ts';
import type { Result } from '../integrations/receipts.ts';
import type { EvidenceAnalysis, GeminiClient, GeminiConfig } from '../integrations/gemini/types.ts';

export type QueuedGeminiConfig = Omit<GeminiConfig, 'credential' | 'reservation' | 'on_transport_settled' | 'registered_candidate_ids'>;
export type QueuedGeminiClient = GeminiClient & Readonly<{ counts: () => ReturnType<SponsorJobs['counts']> & Readonly<{ physical_in_flight: number }> }>;

// SponsorJobs has already checked the closed analysis shape and evidence
// membership. Narrow only its validated value, never cast a raw Result.
function analysis(value: unknown): value is EvidenceAnalysis {
  return record(value) && value.kind === 'evidence-analysis' && value.verification_status === 'unverified'
    && Array.isArray(value.evidence_ids) && value.evidence_ids.every(id) && Array.isArray(value.hypotheses)
    && value.hypotheses.every(kind => ['human', 'animal', 'fire', 'gas_canister', 'other'].includes(kind))
    && typeof value.synthesis === 'string' && ['review-required', 'insufficient-evidence'].includes(value.synthesis);
}

// Inert construction. No caller callback, job identity or per-input config.
export function createQueuedGeminiClient(options: QueuedGeminiConfig = {}): QueuedGeminiClient {
  const config: QueuedGeminiConfig = { enabled: options.enabled, authorization_id: options.authorization_id,
    budget: options.budget, max_call_micro: options.max_call_micro, deadline_ms: options.deadline_ms,
    now: options.now, is_current: options.is_current, model: options.model,
    transport: options.transport, transport_mode: options.transport_mode };
  const jobs = new SponsorJobs(config);
  const deadlines = new Map<string, number>();
  return Object.freeze({ counts: () => Object.freeze({ ...jobs.counts(), physical_in_flight: config.budget?.inFlight() ?? 0 }), async analyze(input: unknown): Promise<Result<EvidenceAnalysis>> {
    try {
      const gate = configured(config);
      if (gate) return fail(gate);
      const now = config.now ?? Date.now;
      if (!plainJson(input) || !closed(input, ['snapshot', 'evidence_id', 'png_base64']) || !id(input.evidence_id)
        || !validSnapshot(input.snapshot, now())) return fail('INVALID_INPUT');
      const evidence = input.snapshot.evidence.find(item => item.evidence_id === input.evidence_id);
      if (!evidence || evidence.modality !== 'eo' || !validPng(input.png_base64, evidence)) return fail('INVALID_INPUT');
      if (!config.transport) return fail('UNSUPPORTED');
      if (!['fixture', 'local-http'].includes(config.transport_mode ?? '')) return fail('UNAUTHORIZED');
      if (typeof config.model !== 'string' || !/^gemini-[a-z0-9.-]{1,80}$/.test(config.model)) return fail('UNSUPPORTED');
      const owned = freeze({ snapshot: structuredClone(input.snapshot), evidence_id: input.evidence_id, png_base64: input.png_base64 });
      if (!config.is_current!(owned.snapshot)) return fail('STALE');
      const job_id = `job:${createHash('sha256').update(JSON.stringify(owned)).digest('hex')}`;
      let deadline = deadlines.get(job_id);
      if (deadline === undefined) {
        if (deadlines.size >= 256) return fail('QUEUE_FULL');
        deadline = now() + config.deadline_ms!;
      }
      if (now() >= deadline) return fail('DEADLINE');
      const retained = jobs.counts().retained;
      const pending = jobs.submit({ job_id, adapter: 'gemini', task_version: 'queued-gemini.v1', model: config.model,
        snapshot: owned.snapshot, deadline_at_ms: deadline, max_call_micro: config.max_call_micro,
        task_input: { evidence_id: owned.evidence_id, png_base64: owned.png_base64 } }, async (signal, reservation, bound) => {
          if (!validSnapshot(owned.snapshot, now()) || !config.is_current!(owned.snapshot)) return fail('STALE');
          const remaining = deadline - now();
          if (remaining <= 0) return fail('DEADLINE');
          let started = false;
          let settle!: () => void;
          const settled = new Promise<void>(resolve => { settle = resolve; });
          let detach = () => {};
          const result = await createGeminiClient({ ...config, reservation, deadline_ms: remaining,
            transport: async request => {
              const current = config.is_current!(bound.snapshot);
              const dispatchedAt = now();
              if (!current || !validSnapshot(bound.snapshot, dispatchedAt)) throw new Error('Queued Gemini snapshot stale');
              if (signal.aborted || request.signal.aborted || dispatchedAt >= deadline) throw new Error('Queued Gemini deadline expired');
              // Scheduler owns original deadline. Combine its abort with the
              // client's signal without releasing or claiming body settlement.
              const abort = new AbortController();
              const cancel = () => abort.abort();
              signal.addEventListener('abort', cancel, { once: true });
              request.signal.addEventListener('abort', cancel, { once: true });
              detach = () => { signal.removeEventListener('abort', cancel); request.signal.removeEventListener('abort', cancel); };
              if (signal.aborted || request.signal.aborted) cancel();
              started = true;
              return config.transport!(Object.freeze({ ...request, signal: abort.signal }));
            },
            on_transport_settled: () => { detach(); settle(); } }).analyze(bound);
          // Deadline/abort may resolve before actual transport/body work. Hold
          // the scheduler slot until the shared budget has really released.
          if (started) await settled;
          return result;
        });
      // Rejected attempts must not retain deadlines or poison identity limits.
      // SponsorJobs admits synchronously and owns every admitted identity.
      if (jobs.counts().retained > retained) deadlines.set(job_id, deadline);
      const result = await pending;
      if (!validSnapshot(owned.snapshot, now()) || !config.is_current!(owned.snapshot)) return fail('STALE');
      if (now() >= deadline) return fail('DEADLINE');
      if (!result.ok) return result;
      if (!analysis(result.value)) return fail('INVALID_REPLY');
      return freeze({ ok: true, value: result.value, ...(result.receipt ? { receipt: result.receipt } : {}) });
    } catch { return fail('STALE'); }
  } });
}
