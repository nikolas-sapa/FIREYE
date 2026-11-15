import { isIP } from 'node:net';
import { closed, configured, fail, freeze, id, perform, plainJson, record, secretLike, validSnapshot } from '../receipts.ts';
import type { TregClient, TregConfig, TregSearchRequest, TregSourceLinks } from './types.ts';

export function safeSourceUrl(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 2048 || /[\s\\]/.test(input)) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || isIP(url.hostname) || url.hostname.includes(':')
      || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)
      || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/i.test(url.hostname)
      || secretLike(decodeURIComponent(url.pathname))) return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export function createTregClient(options: TregConfig = {}): TregClient {
  const config = { ...options };
  return Object.freeze({ async analyze(input: unknown) {
    const gate = configured(config);
    if (gate) return fail(gate);
    if (!plainJson(input) || !closed(input, ['snapshot', 'query']) || typeof input.query !== 'string' || input.query.trim().length < 1
      || input.query.length > 256 || secretLike(input.query) || /[\r\n]/.test(input.query)
      || !validSnapshot(input.snapshot, (config.now ?? Date.now)())) return fail('INVALID_INPUT');
    const snapshot = freeze(structuredClone(input.snapshot));
    if (!snapshot.evidence.every(e => e.modality === 'text' && e.source_kind === 'public-link')) return fail('INVALID_INPUT');
    const body: TregSearchRequest = { q: input.query, limit: 5, contents: false };
    return perform('treg', snapshot, input, config, {
      url: 'https://treg.to/call/treg.web.search', model: null,
      headers: { 'X-Treg-Route-Waterfall': '0', 'X-Treg-Route-Max-Cost': (config.max_call_micro! / 1_000_000).toFixed(6),
        ...(config.transport ? {} : { 'X-Treg-Token': config.credential ?? '' }) }, body,
    }, (response, http) => {
      if (!record(response) || !record(response.output) || !Array.isArray(response.output.results) || response.output.results.length > 100) return null;
      const urls: string[] = [];
      for (const row of response.output.results) {
        if (!record(row) || typeof row.url !== 'string') return null;
        const url = safeSourceUrl(row.url);
        if (url && !urls.includes(url) && urls.length < 5) urls.push(url);
      }
      // Provider-native rows are not fetched. Raw/title/snippet/query are deliberately discarded.
      const served = http.headers.get('X-Treg-Served-By');
      const providers = ['branddev', 'bravesearch', 'crawl4ai', 'diffbot', 'exa', 'firecrawl', 'keenable', 'linkup', 'octen', 'olostep', 'parallel', 'perplexity', 'scrapegraphai', 'search1api', 'serper', 'spidercloud', 'tavily', 'tinyfish', 'valyu', 'you'];
      return { kind: 'public-source-links', urls, verification_status: 'unverified',
        served_by: served && providers.some(provider => served === provider || served.startsWith(`${provider}.web.`)) && id(served) ? served : null } satisfies TregSourceLinks;
    });
  } });
}
