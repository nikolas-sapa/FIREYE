import { closed, configured, fail, freeze, id, perform, plainJson, secretLike, validPng, validSnapshot } from '../receipts.ts';
import type { EvidenceAnalysis, HypothesisKind } from '../gemini/types.ts';
import type { FalCaptionRequest, FalClient, FalConfig } from './types.ts';

export function createFalClient(options: FalConfig = {}): FalClient {
  const config = { ...options };
  return Object.freeze({ async analyze(input: unknown) {
    const gate = configured(config);
    if (gate) return fail(gate);
    if (!plainJson(input) || !closed(input, ['snapshot', 'evidence_id', 'png_base64']) || !id(input.evidence_id)
      || !validSnapshot(input.snapshot, (config.now ?? Date.now)())) return fail('INVALID_INPUT');
    const snapshot = freeze(structuredClone(input.snapshot));
    const evidence = snapshot.evidence.find(e => e.evidence_id === input.evidence_id);
    if (!evidence || evidence.modality !== 'eo' || !validPng(input.png_base64, evidence)) return fail('INVALID_INPUT');
    const model = 'fal-ai/florence-2-large/caption';
    if (config.model !== model) return fail('UNSUPPORTED');
    const body: FalCaptionRequest = { image_url: `data:image/png;base64,${input.png_base64}` };
    return perform('fal', snapshot, input, config, {
      url: `https://fal.run/${model}`, model, headers: config.transport ? {} : { Authorization: `Key ${config.credential ?? ''}` }, body,
    }, response => {
      if (!closed(response, ['results']) || typeof response.results !== 'string' || response.results.length < 1 || response.results.length > 4096 || secretLike(response.results)) return null;
      const keywords: readonly [HypothesisKind, RegExp][] = [['human', /\b(person|people|human|man|woman)\b/i], ['animal', /\b(animal|dog|cat|deer)\b/i],
        ['fire', /\b(fire|flame|smoke)\b/i], ['gas_canister', /\bcanister\b/i]];
      const hypotheses = keywords.filter(([, expression]) => expression.test(response.results as string)).map(([kind]) => kind);
      return { kind: 'evidence-analysis', verification_status: 'unverified', evidence_ids: [evidence.evidence_id], hypotheses,
        synthesis: hypotheses.length ? 'review-required' : 'insufficient-evidence' } satisfies EvidenceAnalysis;
    });
  } });
}
