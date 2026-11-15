import type { ClientConfig, Result, Snapshot } from '../receipts.ts';

export type GemmaModel = 'gemma-4-31b-it' | 'gemma-4-26b-a4b-it';
export type GemmaConfig = ClientConfig & Readonly<{ runtime?: 'hosted-rest' }>;
export type GemmaInput = Readonly<{ snapshot: Snapshot; evidence_id: string; text: string }>;
export type GemmaHypothesisKind = 'human' | 'animal' | 'fire' | 'gas_canister' | 'other';
export type GemmaAnalysis = Readonly<{
  kind: 'evidence-analysis'; verification_status: 'unverified'; evidence_ids: readonly string[];
  hypotheses: readonly GemmaHypothesisKind[]; synthesis: 'review-required' | 'insufficient-evidence';
}>;
export type GemmaClient = Readonly<{ analyze(input: unknown): Promise<Result<GemmaAnalysis>> }>;
export type GemmaRequest = Readonly<{
  contents: readonly Readonly<{ role: 'user'; parts: readonly Readonly<{ text: string }>[] }>[];
  generationConfig: Readonly<{ maxOutputTokens: 512 }>;
}>;
