import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createProviderSetup } from '../setup/provider-config.ts';
import type { ProviderSetup } from '../setup/provider-config.ts';
import { SponsorJobs } from '../integrations/jobs.ts';
import type { SponsorJob } from '../integrations/jobs.ts';
import { closed, fail, ids, plainJson, record, secretLike, SponsorBudget, validPng } from '../integrations/receipts.ts';
import type { Adapter, Result, Snapshot, Transport } from '../integrations/receipts.ts';
import { createIrisClient } from '../integrations/iris/client.ts';
import { createGeminiClient } from '../integrations/gemini/client.ts';
import { createFalClient } from '../integrations/fal/client.ts';
import { createTregClient } from '../integrations/treg/client.ts';

export type SmokeOptions = Readonly<{
  now?: () => number; is_current: (snapshot: Snapshot) => boolean;
  transport?: Transport; transport_mode?: 'fixture' | 'local-http';
}>;

export function createSmokeSession(setup: ProviderSetup, options: SmokeOptions) {
  const now = options.now ?? Date.now;
  const approval = setup.approval();
  const budget = new SponsorBudget(approval?.max_calls ?? 0, approval?.max_total_micro ?? 0);
  const current = (snapshot: Snapshot) => !!setup.approval() && options.is_current(snapshot);
  const jobs = new SponsorJobs({ enabled: !!approval, authorization_id: approval?.authorization_id, budget, is_current: current, now });
  const claims = new Map<Adapter, string>();
  return Object.freeze({
    usage: () => budget.usage(),
    submit: async (input: unknown): Promise<Result<unknown>> => {
      if (!plainJson(input) || !record(input) || typeof input.adapter !== 'string' || !['iris', 'gemini', 'fal', 'treg'].includes(input.adapter)
        || !record(input.snapshot) || !Array.isArray(input.snapshot.evidence)) return fail('INVALID_INPUT');
      const job = input as SponsorJob;
      const fixture = !!options.transport && (options.transport_mode === 'fixture' || options.transport_mode === 'local-http');
      const gate = setup.authorize(job, fixture);
      if (!gate.ok) return gate;
      const task: unknown = job.task_input;
      if (job.adapter === 'iris' ? !closed(task, ['candidate_ids']) || !ids(task.candidate_ids)
        : job.adapter === 'treg' ? !closed(task, ['query']) || typeof task.query !== 'string' || !task.query.trim()
          || task.query.length > 256 || secretLike(task.query) || /[\r\n]/.test(task.query)
        : !closed(task, ['evidence_id', 'png_base64']) || typeof task.evidence_id !== 'string'
          || !job.snapshot.evidence.some(evidence => evidence.evidence_id === task.evidence_id && evidence.modality === 'eo' && validPng(task.png_base64, evidence))) return fail('INVALID_INPUT');
      const identity = createHash('sha256').update(JSON.stringify([job.adapter, job.model, job.task_version, job.snapshot, job.task_input])).digest('hex');
      const claimed = claims.get(job.adapter);
      if (claimed && claimed !== identity) return fail('BUDGET');
      // Scheduler validates the complete closed job and supplies the bound immutable input.
      const pending = jobs.submit(job, async (_signal, reservation, bound) => {
        const config = { ...gate.value, budget, now, is_current: current, reservation,
          ...(options.transport ? { transport: options.transport, transport_mode: options.transport_mode } : {}) };
        if (job.adapter === 'iris') return createIrisClient({ ...config,
          registered_candidate_ids: 'candidate_ids' in bound ? bound.candidate_ids : [] }).analyze(bound);
        if (job.adapter === 'gemini') return createGeminiClient(config).analyze(bound);
        if (job.adapter === 'fal') return createFalClient(config).analyze(bound);
        return createTregClient(config).analyze(bound);
      });
      // Claim before await, duplicate submissions share existing scheduler identity.
      claims.set(job.adapter, identity);
      return pending;
    },
  });
}

// No raw env, job input, exception text, auth headers or provider body is printed.
export async function runSmokeCli(args: readonly string[], env: unknown, write: (line: string) => void): Promise<number> {
  const emit = (value: unknown) => write(JSON.stringify(value));
  if (args.length === 0 || args.length === 1 && args[0] === '--status') {
    emit(createProviderSetup(env).status());
    return 0;
  }
  if (args.length !== 3 || args[0] !== '--live') { emit({ ok: false, code: 'INVALID_INPUT', genuine_calls: 0 }); return 2; }
  try {
    const approvalText = await readFile(args[1], 'utf8');
    const jobsText = await readFile(args[2], 'utf8');
    if (approvalText.length > 16_384 || jobsText.length > 1_600_000) { emit({ ok: false, code: 'OVERSIZE', genuine_calls: 0 }); return 2; }
    const setup = createProviderSetup(env, JSON.parse(approvalText));
    const inputs: unknown = JSON.parse(jobsText);
    if (!setup.approval()) { emit({ ok: false, code: 'UNAUTHORIZED', genuine_calls: 0 }); return 2; }
    if (!plainJson(inputs) || !Array.isArray(inputs) || inputs.length < 1 || inputs.length > 4) { emit({ ok: false, code: 'INVALID_INPUT', genuine_calls: 0 }); return 2; }
    // CLI standalone exercise only, never establishes application currentness or app sessions.
    const session = createSmokeSession(setup, { is_current: snapshot => snapshot.valid_until_ms > Date.now() });
    let failed = false;
    for (const input of inputs) {
      const result = await session.submit(input);
      failed ||= !result.ok;
      emit({ ok: result.ok, status: result.ok ? 'accepted' : result.code,
        ...(result.receipt ? { receipt: result.receipt } : {}), usage: session.usage() });
    }
    return failed ? 1 : 0;
  } catch { emit({ ok: false, code: 'INVALID_INPUT', genuine_calls: 0 }); return 2; }
}

if (import.meta.main) process.exitCode = await runSmokeCli(process.argv.slice(2), process.env, line => process.stdout.write(`${line}\n`));
