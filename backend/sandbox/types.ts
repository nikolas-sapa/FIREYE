import type { Snapshot, SponsorBudget, Failure } from '../integrations/receipts.ts';

export type SandboxOperation = 'score-received-candidates.v1';
export type SandboxCandidate = Readonly<{ candidate_id: string; evidence_ids: readonly string[] }>;
export type SandboxInput = Readonly<{ operation: SandboxOperation; snapshot: Snapshot; candidates: readonly SandboxCandidate[] }>;
export type SandboxJob = Readonly<{
  job_id: string; operation: SandboxOperation; snapshot: Snapshot; deadline_at_ms: number;
  task_input: Readonly<{ candidates: readonly SandboxCandidate[] }>;
}>;
export type SandboxValue = Readonly<{
  kind: 'received-evidence-coverage'; scale: 'relative received-evidence coverage, not risk or confidence';
  ranking: readonly Readonly<{ candidate_id: string; score: number }>[];
}>;
export type SandboxReceipt = Readonly<{
  contract_version: 'sandbox-jobs.v1'; operation: SandboxOperation; input_hash: string; snapshot_id: string;
  provenance: 'fixture'; remote_execution: false; started_at_ms: number; finished_at_ms: number; reserved_micro: number;
}>;
export type SandboxResult = Readonly<{ ok: true; value: SandboxValue; receipt: SandboxReceipt }> | Readonly<{ ok: false; code: Failure }>;
// Trusted constructor dependency, never selected/supplied by a model or job body.
export type SandboxExecutor = Readonly<{ mode: 'fixture' | 'boxd'; execute: (signal: AbortSignal, input: SandboxInput) => Promise<unknown> }>;
export type SandboxConfig = Readonly<{
  enabled?: boolean; authorization_id?: string; machine_id?: string; max_job_micro?: number; budget?: SponsorBudget;
  is_current?: (snapshot: Snapshot) => boolean; registered_candidate_ids?: readonly string[]; now?: () => number; executor?: SandboxExecutor;
}>;
