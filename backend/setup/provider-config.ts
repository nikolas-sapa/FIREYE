import { types } from 'node:util';
import { closed, fail, freeze, id, ids, integer, plainJson, positive, secretLike, validSnapshot } from '../integrations/receipts.ts';
import type { Adapter, ClientConfig, Result } from '../integrations/receipts.ts';
import type { SponsorJob } from '../integrations/jobs.ts';

export type Provider = Adapter;
export type SmokeAllowance = Readonly<{
  adapter: Adapter; model: string; task_version: string; rights_manifest_ids: readonly string[];
  max_call_micro: number; deadline_ms: number;
}>;
export type SmokeApproval = Readonly<{
  authorization_id: string; expires_at_ms: number; max_calls: number; max_total_micro: number;
  adapters: readonly SmokeAllowance[];
}>;
export type ProviderStatus = Readonly<{
  provider: Provider; status: 'disabled' | 'configured' | 'unsupported';
  credential_status: 'present-unverified' | 'missing' | 'not-applicable';
  endpoint: string | null; model: string | null; max_call_micro: number | null;
  deadline_ms: number | null; rights_manifest_ids: readonly string[];
  blocker: 'approval-required' | 'credential-required' | 'runtime-required' | 'hard-ceiling-unsupported' | 'adapter-unavailable' | null;
}>;
export type SetupStatus = Readonly<{
  genuine_calls: 0; max_calls: number; max_total_micro: number; providers: readonly ProviderStatus[];
  context: Readonly<{
    firecrawl: Readonly<{ credential_status: 'present-unverified' | 'missing'; product_adapter: 'unsupported'; route: 'direct-Firecrawl-not-Treg' }>;
    boxd: Readonly<{ execution_enabled: false; status: 'external-auth-separate'; alias: 'sandbox' }>;
  }>;
}>;
export type ProviderSetup = Readonly<{
  status: () => SetupStatus;
  approval: () => SmokeApproval | null;
  authorize: (job: SponsorJob, fixture: boolean) => Result<ClientConfig>;
}>;

const slots: readonly Provider[] = ['iris', 'gemini', 'fal', 'treg', 'gemma'];
const credentialNames = { iris: 'IRIS_API_KEY', gemini: 'GEMINI_API_KEY', fal: 'FAL_KEY', treg: 'TREG_TOKEN', gemma: 'GEMINI_API_KEY' } as const;

function envString(env: unknown, name: string): string | undefined {
  if (env === null || typeof env !== 'object' || types.isProxy(env)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(env, name);
  return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value : undefined;
}
function credential(value: string | undefined): string | undefined {
  return value && value.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(value) ? value : undefined;
}
function validModel(provider: Provider, value: unknown): value is string {
  if (typeof value !== 'string' || secretLike(value)) return false;
  if (provider === 'iris') return /^projects\/[A-Za-z0-9_-]{1,128}\/models\/iris(?:-[A-Za-z0-9_-]{1,40})?$/.test(value);
  if (provider === 'gemini') return /^gemini-[a-z0-9.-]{1,80}$/.test(value);
  if (provider === 'fal') return value === 'fal-ai/florence-2-large/caption';
  if (provider === 'treg') return value === 'treg.web.search';
  return ['gemma-4-31b-it', 'gemma-4-26b-a4b-it'].includes(value);
}
function endpoint(provider: Provider, model: string | null): string | null {
  if (provider === 'iris') return 'https://inference.oumi.ai/v1/systemone';
  if (provider === 'gemini' || provider === 'gemma') return model ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` : null;
  if (provider === 'fal') return 'https://fal.run/fal-ai/florence-2-large/caption';
  if (provider === 'treg') return 'https://treg.to/call/treg.web.search';
  return null;
}
function parseApproval(input: unknown, now: number): SmokeApproval | null {
  if (!plainJson(input) || !closed(input, ['authorization_id', 'expires_at_ms', 'max_calls', 'max_total_micro', 'adapters'])
    || !id(input.authorization_id) || !integer(input.expires_at_ms) || input.expires_at_ms <= now
    || !positive(input.max_calls) || input.max_calls > 4 || !positive(input.max_total_micro)
    || !Array.isArray(input.adapters) || input.adapters.length < 1 || input.adapters.length > 4 || input.adapters.length > input.max_calls) return null;
  const seen = new Set<Adapter>();
  let total = 0;
  for (const allowance of input.adapters) {
    if (!closed(allowance, ['adapter', 'model', 'task_version', 'rights_manifest_ids', 'max_call_micro', 'deadline_ms'])
      || typeof allowance.adapter !== 'string' || !slots.includes(allowance.adapter as Adapter)
      || seen.has(allowance.adapter as Adapter) || !validModel(allowance.adapter as Adapter, allowance.model)
      || !id(allowance.task_version) || !ids(allowance.rights_manifest_ids) || !positive(allowance.max_call_micro)
      || !positive(allowance.deadline_ms) || allowance.deadline_ms > 10_000) return null;
    seen.add(allowance.adapter as Adapter);
    total += allowance.max_call_micro;
    if (!Number.isSafeInteger(total) || total > input.max_total_micro) return null;
  }
  return freeze(structuredClone(input)) as SmokeApproval;
}

// Secret values remain in the server closure, never enumerable status/config fields.
// Import, status and construction have no provider/CLI/network side effects.
export function createProviderSetup(env: unknown = {}, inputApproval: unknown = null, now: () => number = Date.now): ProviderSetup {
  const approval = parseApproval(inputApproval, now());
  const credentials = new Map<Adapter, string | undefined>();
  for (const adapter of slots) credentials.set(adapter, credential(envString(env, credentialNames[adapter])));
  const gemmaRuntime = envString(env, 'GEMMA_RUNTIME') === 'hosted-rest';
  const models = new Map<Provider, string | null>();
  for (const provider of slots) {
    const allowance = approval?.adapters.find(entry => entry.adapter === provider);
    const value = allowance?.model ?? (provider === 'fal' ? 'fal-ai/florence-2-large/caption' : provider === 'treg' ? 'treg.web.search' : envString(env, `${provider.toUpperCase()}_MODEL`));
    models.set(provider, validModel(provider, value) ? value : null);
  }
  const firecrawlPresent = !!credential(envString(env, 'FIRECRAWL_API_KEY'));
  const currentApproval = () => approval && approval.expires_at_ms > now() ? approval : null;
  return Object.freeze({
    approval: currentApproval,
    status: () => {
      const current = currentApproval();
      return freeze({ genuine_calls: 0, max_calls: current?.max_calls ?? 0, max_total_micro: current?.max_total_micro ?? 0,
        providers: slots.map(provider => {
          const allowance = current?.adapters.find(entry => entry.adapter === provider);
          const present = !!credentials.get(provider);
          const model = models.get(provider)!;
          const blocker: ProviderStatus['blocker'] = !allowance ? 'approval-required' : !present ? 'credential-required'
            : provider === 'gemma' && !gemmaRuntime ? 'runtime-required'
            : provider !== 'treg' ? 'hard-ceiling-unsupported' : null;
          return { provider, status: blocker === null ? 'configured' : blocker === 'hard-ceiling-unsupported' ? 'unsupported' : 'disabled',
            credential_status: present ? 'present-unverified' : 'missing', endpoint: endpoint(provider, model), model,
            max_call_micro: allowance?.max_call_micro ?? null, deadline_ms: allowance?.deadline_ms ?? null,
            rights_manifest_ids: allowance?.rights_manifest_ids ?? [], blocker } satisfies ProviderStatus;
        }), context: { firecrawl: { credential_status: firecrawlPresent ? 'present-unverified' : 'missing', product_adapter: 'unsupported', route: 'direct-Firecrawl-not-Treg' },
          boxd: { execution_enabled: false, status: 'external-auth-separate', alias: 'sandbox' } } } satisfies SetupStatus);
    },
    authorize: (job, fixture) => {
      if (!plainJson(job) || !closed(job, ['job_id', 'adapter', 'task_version', 'model', 'snapshot', 'deadline_at_ms', 'max_call_micro', 'task_input'])
        || !id(job.job_id) || !id(job.task_version) || typeof job.adapter !== 'string' || !slots.includes(job.adapter)
        || typeof job.model !== 'string' || !positive(job.max_call_micro) || !positive(job.deadline_at_ms)
        || !validSnapshot(job.snapshot, now())) return fail('INVALID_INPUT');
      const current = currentApproval();
      if (!current) return fail('UNAUTHORIZED');
      const allowance = current.adapters.find(entry => entry.adapter === job.adapter);
      if (!allowance) return fail('DISABLED');
      if (job.model !== allowance.model || job.task_version !== allowance.task_version) return fail('UNSUPPORTED');
      if (job.adapter === 'gemma' && !gemmaRuntime) return fail('UNSUPPORTED');
      if (job.max_call_micro !== allowance.max_call_micro) return fail('BUDGET');
      if (job.deadline_at_ms <= now() || job.deadline_at_ms > now() + allowance.deadline_ms
        || job.deadline_at_ms > current.expires_at_ms) return fail('DEADLINE');
      if (!job.snapshot.evidence.every(evidence => allowance.rights_manifest_ids.includes(evidence.rights_manifest_id))) return fail('UNAUTHORIZED');
      const key = credentials.get(job.adapter);
      if (!key) return fail('UNAUTHORIZED');
      if (!fixture && job.adapter !== 'treg') return fail('UNSUPPORTED');
      return Object.freeze({ ok: true, value: Object.freeze({ enabled: true, authorization_id: current.authorization_id,
        max_call_micro: allowance.max_call_micro, deadline_ms: allowance.deadline_ms, model: allowance.model, credential: key }) });
    },
  });
}
