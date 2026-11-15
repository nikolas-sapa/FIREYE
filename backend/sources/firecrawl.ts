import { createHash } from 'node:crypto';
import { freeze, id, integer, plainJson, positive, record } from '../integrations/receipts.ts';
import type { Failure } from '../integrations/receipts.ts';
import { normalizeSourceContext, SOURCE_MAX_BYTES } from './context.ts';
import type { FirecrawlClient, FirecrawlConfig, FirecrawlReceipt, FirecrawlRequest, FirecrawlResult } from './types.ts';

export const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape';
const fail = (code: Failure): Readonly<{ ok: false; code: Failure }> => Object.freeze({ ok: false, code });

export function createFirecrawlClient(options: FirecrawlConfig = {}): FirecrawlClient {
  const config = { ...options };
  let attempts = 0;
  return Object.freeze({ async retrieve(input, context): Promise<FirecrawlResult> {
    if (config.enabled !== true) return fail('DISABLED');
    if (!id(config.authorization_id) || config.max_calls !== 1 || !positive(config.deadline_ms) || config.deadline_ms > 10_000
      || typeof config.is_current !== 'function') return fail('UNAUTHORIZED');
    // Native paid route intentionally unsupported: no provider whole-call ceiling or DNS/redirect guarantees verified.
    if (!config.transport) return fail('UNSUPPORTED');
    if (!['fixture', 'local-http'].includes(config.transport_mode ?? '')) return fail('UNAUTHORIZED');
    const normalized = normalizeSourceContext(input, context);
    if (!normalized.ok) return fail(normalized.code);
    const source = normalized.value;
    if (source.kind !== 'article' || !context.permissions.some(p => p.source_id === source.source_id && p.rights_manifest_id === source.rights_manifest_id
      && p.url === source.url && p.context_use && p.retrieval)) return fail('UNAUTHORIZED');
    const now = config.now ?? Date.now;
    const started = now();
    const trusted = freeze(structuredClone(context));
    try { if (!integer(started) || started < trusted.received_cutoff_ms || started >= trusted.valid_until_ms || !config.is_current(trusted)) return fail('STALE'); }
    catch { return fail('STALE'); }
    if (attempts >= 1) return fail('BUDGET');
    attempts++;
    const controller = new AbortController();
    // Firecrawl's documented provider timeout floor is 1000ms; local deadline may be shorter.
    const body: FirecrawlRequest = { url: source.url, formats: ['markdown'], onlyMainContent: true, timeout: Math.max(1000, config.deadline_ms), maxAge: 0 };
    const requestBody = JSON.stringify(body);
    const inputHash = createHash('sha256').update(JSON.stringify(source)).digest('hex');
    const receipt = (status: FirecrawlReceipt['status']): FirecrawlReceipt => freeze({ adapter: 'firecrawl', endpoint: FIRECRAWL_ENDPOINT,
      authorization_id: config.authorization_id!, snapshot_id: source.snapshot_id, input_hash: inputHash,
      provenance: config.transport_mode!, fresh_provider_call: false, started_at_ms: started, finished_at_ms: now(), attempts: 1, status });
    const failure = (code: Failure): FirecrawlResult => freeze({ ok: false, code,
      receipt: receipt(code) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = async (): Promise<FirecrawlResult> => {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
          const response = await config.transport!({ url: FIRECRAWL_ENDPOINT, method: 'POST', headers: Object.freeze({ 'Content-Type': 'application/json' }),
            body: requestBody, signal: controller.signal, redirect: 'error' });
          if (response.redirected || (response.status >= 300 && response.status < 400)) return failure('REDIRECT');
          if (!response.ok) return failure('TRANSPORT');
          const length = response.headers.get('content-length');
          if (length !== null && (!/^\d+$/.test(length) || Number(length) > SOURCE_MAX_BYTES)) { await response.body?.cancel(); return failure('OVERSIZE'); }
          if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return failure('INVALID_REPLY');
          reader = response.body?.getReader();
          if (!reader) return failure('INVALID_REPLY');
          const chunks: Uint8Array[] = [];
          let bytes = 0;
          while (true) {
            if (controller.signal.aborted) return failure('DEADLINE');
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > SOURCE_MAX_BYTES) { await reader.cancel(); return failure('OVERSIZE'); }
            chunks.push(chunk.value);
          }
          const finished = now();
          if (controller.signal.aborted || finished >= started + config.deadline_ms!) return failure('DEADLINE');
          if (!integer(finished) || finished < started || finished >= trusted.valid_until_ms || !config.is_current!(trusted)) return failure('STALE');
          const reply: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
          if (!plainJson(reply) || !record(reply) || reply.success !== true || !record(reply.data) || typeof reply.data.markdown !== 'string'
            || !record(reply.data.metadata) || reply.data.metadata.sourceURL !== source.url || reply.data.metadata.statusCode !== 200) return failure('INVALID_REPLY');
          // Provider/title/publication/instruction fields are not trusted clocks or permissions. Only exact markdown bytes are retained.
          const { verification_status, instruction_authority, incident_assessment, source_age_ms, ...packet } = source;
          const content = reply.data.markdown;
          const received = now();
          const result = normalizeSourceContext({ ...packet, content, content_hash: createHash('sha256').update(content).digest('hex'),
            retrieved_at_ms: received, received_at_ms: received, links: [] }, { ...trusted, now_ms: received, received_cutoff_ms: received });
          return result.ok ? freeze({ ok: true, value: result.value, receipt: receipt('accepted') }) : failure(result.code);
        } catch { return failure(controller.signal.aborted ? 'DEADLINE' : 'TRANSPORT'); }
        finally { if (reader) { try { await reader.cancel(); } catch { /* no retries */ } } }
      };
      const deadline = new Promise<FirecrawlResult>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(failure('DEADLINE')); }, config.deadline_ms); });
      const result = await Promise.race([operation(), deadline]);
      if (result.ok) {
        const readAt = now();
        if (controller.signal.aborted || readAt >= started + config.deadline_ms) return failure('DEADLINE');
        try { if (!integer(readAt) || readAt < started || readAt >= trusted.valid_until_ms || !config.is_current(trusted)) return failure('STALE'); }
        catch { return failure('STALE'); }
      }
      return result;
    } finally { if (timer) clearTimeout(timer); }
  } });
}
