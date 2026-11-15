import { types } from 'node:util';
import { createProviderSetup } from './provider-config.ts';
import { freeze } from '../integrations/receipts.ts';

export type ActivationProvider = 'iris' | 'gemini' | 'fal' | 'treg' | 'gemma' | 'firecrawl';
export type AuthStatus = 'missing' | 'unverified' | 'verified' | 'account-read-succeeded' | 'local-check-only' | 'failed' | 'unsupported';
export type HealthRequest = Readonly<{
  url: string; method: 'GET'; headers: Readonly<Record<string, string>>; redirect: 'error'; signal: AbortSignal;
}>;
export type CheckOptions = Readonly<{ enabled?: boolean; transport?: (request: HealthRequest) => Promise<Response> }>;
export type ActivationRow = Readonly<{
  provider: ActivationProvider; active: false; configuration_status: 'disabled' | 'configured' | 'unsupported';
  credential_status: 'missing' | 'present-unverified' | 'not-applicable'; endpoint: string | null;
  health_endpoint: string | null; model: string | null; model_status: 'missing' | 'configured-unverified' | 'catalog-listed' | 'not-applicable';
  auth_status: AuthStatus; max_call_micro: number | null; budget_gap: 'approval-required' | 'hard-ceiling-unsupported' | 'adapter-unavailable' | 'runtime-required' | null;
  live_supported: boolean;
}>;
export type ActivationReport = Readonly<{
  mode: 'dry' | 'read-only-check'; genuine_calls: 0; read_only_attempts: number;
  counts: Readonly<{ configured: number; auth_verified: number; cap_missing: number; live_unsupported: number }>;
  providers: readonly ActivationRow[];
  context: Readonly<{ boxd: 'execution-disabled'; prior_auth_receipts: 'provider-setup.md-not-current-checks' }>;
}>;

const healthEndpoints = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  treg: 'https://treg.to/auth/me',
} as const;
const credentialNames = { gemini: 'GEMINI_API_KEY', treg: 'TREG_TOKEN' } as const;

function envCredential(env: unknown, name: string): string | undefined {
  if (!env || typeof env !== 'object' || types.isProxy(env)) return undefined;
  const property = Object.getOwnPropertyDescriptor(env, name);
  const value: unknown = property && Object.hasOwn(property, 'value') ? property.value : undefined;
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(value) ? value : undefined;
}

function checkOptions(input: unknown): CheckOptions | null {
  if (!input || typeof input !== 'object' || types.isProxy(input)) return null;
  const enabled = Object.getOwnPropertyDescriptor(input, 'enabled');
  const transport = Object.getOwnPropertyDescriptor(input, 'transport');
  if (!enabled || !Object.hasOwn(enabled, 'value') || enabled.value !== true
    || transport && (!Object.hasOwn(transport, 'value') || typeof transport.value !== 'function')) return null;
  return { enabled: true, ...(transport ? { transport: transport.value as NonNullable<CheckOptions['transport']> } : {}) };
}

async function safeBody(response: Response): Promise<unknown> {
  if (!response.body || response.status !== 200 || response.redirected) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65_536) return null;
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function validHealthBody(provider: 'gemini' | 'treg', body: unknown): body is Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (provider === 'treg') return true;
  const models = (body as Record<string, unknown>).models;
  return Array.isArray(models) && models.length <= 2000 && models.every(model => model && typeof model === 'object'
    && !Array.isArray(model) && typeof model.name === 'string' && /^models\/[a-z0-9.-]{1,100}$/.test(model.name));
}

function budgetGap(blocker: string | null, cap: number | null, provider: ActivationProvider): ActivationRow['budget_gap'] {
  if (blocker === 'adapter-unavailable' || blocker === 'runtime-required' || blocker === 'hard-ceiling-unsupported') return blocker;
  if (cap === null) return 'approval-required';
  return provider === 'treg' ? null : 'hard-ceiling-unsupported';
}

// Independent diagnostic closure, never authorizes a paid call or changes actual setup guards.
export function createProviderActivation(env: unknown = {}, approval: unknown = null, now: () => number = Date.now) {
  const setup = createProviderSetup(env, approval, now);
  const credentials = { gemini: envCredential(env, credentialNames.gemini), treg: envCredential(env, credentialNames.treg) };
  const auth = new Map<ActivationProvider, AuthStatus>();
  const checks = new Map<ActivationProvider, number>();
  const catalogListed = new Set<ActivationProvider>();
  let attempts = 0;
  const status = (): ActivationReport => {
    const base = setup.status();
    const providers: ActivationRow[] = base.providers.map(row => ({
      provider: row.provider, active: false, configuration_status: row.status, credential_status: row.credential_status,
      endpoint: row.endpoint, health_endpoint: row.provider === 'gemini' || row.provider === 'treg' ? healthEndpoints[row.provider] : null,
      model: row.model, model_status: row.model ? catalogListed.has(row.provider) ? 'catalog-listed' : 'configured-unverified' : 'missing',
      auth_status: auth.get(row.provider) ?? (row.credential_status === 'missing' ? 'missing' : row.credential_status === 'not-applicable' ? 'unsupported' : 'unverified'),
      max_call_micro: row.max_call_micro, budget_gap: budgetGap(row.blocker, row.max_call_micro, row.provider),
      live_supported: row.provider === 'treg',
    }));
    providers.push({ provider: 'firecrawl', active: false, configuration_status: base.context.firecrawl.credential_status === 'missing' ? 'disabled' : 'unsupported',
      credential_status: base.context.firecrawl.credential_status, endpoint: null, health_endpoint: null, model: null, model_status: 'not-applicable',
      auth_status: base.context.firecrawl.credential_status === 'missing' ? 'missing' : 'unverified', max_call_micro: null,
      budget_gap: 'adapter-unavailable', live_supported: false });
    return freeze({ mode: attempts ? 'read-only-check' : 'dry', genuine_calls: 0, read_only_attempts: attempts,
      counts: { configured: providers.filter(row => row.credential_status === 'present-unverified' && (row.model !== null || row.provider === 'firecrawl')).length,
        auth_verified: providers.filter(row => row.auth_status === 'verified').length,
        cap_missing: providers.filter(row => row.max_call_micro === null).length,
        live_unsupported: providers.filter(row => !row.live_supported).length }, providers,
      context: { boxd: 'execution-disabled', prior_auth_receipts: 'provider-setup.md-not-current-checks' } });
  };
  return Object.freeze({ status, check: async (provider: unknown, inputOptions: CheckOptions = {}): Promise<ActivationReport> => {
    const options = checkOptions(inputOptions);
    if (!options || provider !== 'gemini' && provider !== 'treg') return status();
    const key = credentials[provider];
    if (!key) return status();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 5000); });
    attempts++;
    const check = attempts;
    checks.set(provider, check);
    auth.set(provider, 'failed');
    catalogListed.delete(provider);
    try {
      const headers: Record<string, string> = { [provider === 'gemini' ? 'x-goog-api-key' : 'X-Treg-Token']: key };
      const request: HealthRequest = Object.freeze({ url: healthEndpoints[provider], method: 'GET', redirect: 'error', signal: controller.signal,
        headers: Object.freeze(headers) });
      const operation = (async () => {
        const response = await (options.transport ? options.transport(request) : fetch(request.url, {
          method: request.method, headers: request.headers, redirect: request.redirect, signal: request.signal,
        }));
        if (!options.transport && response.url !== request.url) return null;
        return safeBody(response);
      })();
      const body = await Promise.race([operation, deadline]);
      if (checks.get(provider) === check && validHealthBody(provider, body)) {
        auth.set(provider, options.transport ? 'local-check-only' : provider === 'treg' ? 'account-read-succeeded' : 'verified');
        if (!options.transport && provider === 'gemini') {
          for (const row of setup.status().providers.filter(row => row.provider === 'gemini' || row.provider === 'gemma')) {
            if (row.model && (body.models as { name: string }[]).some(entry => entry.name === `models/${row.model}`)) catalogListed.add(row.provider);
          }
        }
      }
    } catch { /* Public status contains finite failure marker, never exception/account/body data. */ }
    finally { clearTimeout(timer); controller.abort(); }
    return status();
  } });
}
