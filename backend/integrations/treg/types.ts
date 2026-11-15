import type { ClientConfig, Result, Snapshot } from '../receipts.ts';

export type TregInput = Readonly<{ snapshot: Snapshot; query: string }>;
export type TregSourceLinks = Readonly<{ kind: 'public-source-links'; urls: readonly string[]; verification_status: 'unverified'; served_by: string | null }>;
export type TregClient = Readonly<{ analyze(input: unknown): Promise<Result<TregSourceLinks>> }>;
export type TregConfig = ClientConfig;
export type TregSearchRequest = Readonly<{ q: string; limit: 5; contents: false }>;
