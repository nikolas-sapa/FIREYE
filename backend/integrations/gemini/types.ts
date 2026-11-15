import type { ClientConfig, Result, Snapshot } from '../receipts.ts';

export type GeminiInput = Readonly<{ snapshot: Snapshot; evidence_id: string; png_base64: string }>;
export type HypothesisKind = 'human' | 'animal' | 'fire' | 'gas_canister' | 'other';
export type EvidenceAnalysis = Readonly<{
  kind: 'evidence-analysis'; verification_status: 'unverified'; evidence_ids: readonly string[];
  hypotheses: readonly HypothesisKind[]; synthesis: 'review-required' | 'insufficient-evidence';
}>;
export type GeminiClient = Readonly<{ analyze(input: unknown): Promise<Result<EvidenceAnalysis>> }>;
export type GeminiConfig = ClientConfig;
export type GeminiRequest = Readonly<{
  contents: readonly Readonly<{ role: 'user'; parts: readonly (Readonly<{ text: string }> | Readonly<{ inlineData: Readonly<{ mimeType: 'image/png'; data: string }> }>)[] }>[];
  generationConfig: Readonly<{ maxOutputTokens: 512; responseMimeType: 'application/json' }>;
}>;
