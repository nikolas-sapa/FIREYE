import type { ClientConfig, Result, Snapshot } from '../receipts.ts';
import type { EvidenceAnalysis } from '../gemini/types.ts';

export type FalInput = Readonly<{ snapshot: Snapshot; evidence_id: string; png_base64: string }>;
export type FalClient = Readonly<{ analyze(input: unknown): Promise<Result<EvidenceAnalysis>> }>;
export type FalConfig = ClientConfig;
export type FalCaptionRequest = Readonly<{ image_url: string }>;
export type FalCaptionReply = Readonly<{ results: string }>;
