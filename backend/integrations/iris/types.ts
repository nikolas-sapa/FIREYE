import type { ClientConfig, Result, Snapshot } from '../receipts.ts';

export type IrisInput = Readonly<{ snapshot: Snapshot; candidate_ids: readonly string[] }>;
export type IrisRanking = Readonly<{ kind: 'finite-ranking'; ranking: readonly Readonly<{ candidate_id: string; score: number; scale: 'provider choice probability, not calibrated incident probability' }>[] }>;
export type IrisClient = Readonly<{ analyze(input: unknown): Promise<Result<IrisRanking>> }>;
export type IrisConfig = ClientConfig;
// Official systemone wire shape. The application owns the question key and finite criteria.
export type IrisRequest = Readonly<{ model: string; state: unknown; questions: Readonly<{ ranking: Readonly<{ type: 'choice'; instructions: string; criteria: Readonly<Record<string, string>> }> }> }>;
