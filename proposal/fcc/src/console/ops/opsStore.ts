import { useSyncExternalStore } from 'react';
import type { AgentJob, ConsoleState, Finding } from '../contracts';
import { consoleStore } from '../store';

/* ------------------------------------------------------------------ comm log (derived from real state) */

export type CommLane = 'operator' | 'agent' | 'system';
export type JobStatus = 'queued' | 'running' | 'done';
export interface CommRow {
  id: string;
  lane: CommLane;
  t: number; // scenario ms
  seq: number; // monotonic tiebreak for equal t
  local?: boolean;
  sim?: boolean; // locally authored reply, not a real model call
  from: string;
  to?: string;
  verb?: string; // TASK | ACK | REPORT | ENTRY | REPLY
  text: string;
  meta?: string; // dim second line (provider / model)
  jobId?: string;
}

const MAX_ROWS = 400;
let rows: CommRow[] = [];
const listeners = new Set<() => void>();
let version = 0;
let seq = 0;
const seenJobs = new Map<string, string>(); // jobId -> last emitted status
const jobStatus = new Map<string, JobStatus>(); // jobId -> latest status (for status dots)
const seenLedger = new Set<string>();
const seenMessages = new Map<string, string>();
let wired = false;
let lastClock: number | null = null;
let lastPack: unknown;

const emittedIds = new Set<string>();
function emit(row: Omit<CommRow, 'seq'>) {
  if (emittedIds.has(row.id)) return;
  emittedIds.add(row.id);
  if (emittedIds.size > 2000) emittedIds.clear();
  rows = [...rows, { ...row, seq: ++seq }];
  if (rows.length > MAX_ROWS) rows = rows.slice(rows.length - MAX_ROWS);
  version++;
  listeners.forEach((fn) => fn());
}

function jobRow(j: AgentJob, findings: Finding[]): Omit<CommRow, 'seq'> | null {
  const short = j.input.length > 96 ? `${j.input.slice(0, 96)}…` : j.input;
  const meta = `${j.provider} / ${j.model}`;
  if (j.status === 'queued') {
    return { id: `job-${j.id}-q`, lane: 'agent', t: j.queuedAt, from: 'ORCH', to: j.agent, verb: 'TASK', text: short, jobId: j.id };
  }
  if (j.status === 'running') {
    return { id: `job-${j.id}-r`, lane: 'agent', t: j.startedAt ?? j.queuedAt, from: j.agent, to: 'ORCH', verb: 'ACK', text: 'running', meta, jobId: j.id };
  }
  const labels = j.findingIds.map((id) => findings.find((f) => f.id === id)?.label).filter(Boolean) as string[];
  const suffix = labels.length ? ` · ${labels.length} findings: ${labels.slice(0, 3).join(' | ')}` : ' · 0 findings';
  return { id: `job-${j.id}-d`, lane: 'agent', t: j.finishedAt ?? j.queuedAt, from: j.agent, to: 'ORCH', verb: 'REPORT', text: `${short}${suffix}`, meta, jobId: j.id };
}

/** Latest known status of a job (for the dot on its TASK row). */
export function jobStatusOf(jobId: string): JobStatus | undefined {
  return jobStatus.get(jobId);
}

/** Fold current store state into the derived comm log (dedupe by jobId+status, ledger id, message id). */
export function ingestSnapshot(s: ConsoleState) {
  if (lastClock !== null && (s.clock.t < lastClock || s.pack !== lastPack)) {
    rows = [];
    seq = 0;
    seenJobs.clear();
    jobStatus.clear();
    seenLedger.clear();
    seenMessages.clear();
    emittedIds.clear();
    version++;
    [...listeners].forEach((fn) => fn());
  }
  lastClock = s.clock.t;
  lastPack = s.pack;
  for (const j of s.jobs) {
    const eventTime = j.status === 'running' ? j.startedAt ?? j.queuedAt : j.status === 'done' ? j.finishedAt ?? j.queuedAt : j.queuedAt;
    if (eventTime > s.clock.t) continue;
    const prev = seenJobs.get(j.id);
    jobStatus.set(j.id, j.status);
    if (prev === j.status) continue;
    seenJobs.set(j.id, j.status);
    const row = jobRow(j, s.findings);
    if (row) emit(row);
  }
  for (const e of s.ledger.entries) {
    if (e.at > s.clock.t) continue;
    if (seenLedger.has(e.id)) continue;
    seenLedger.add(e.id);
    emit({ id: `led-${e.id}`, lane: 'system', t: e.at, from: e.agent, verb: 'ENTRY', text: e.text, meta: `+${Math.round(e.minutesSaved)}m saved` });
  }
  for (const m of s.messages) {
    if (m.at > s.clock.t) continue;
    const signature = JSON.stringify([m.at, m.role, m.text, !!m.thinking]);
    if (seenMessages.get(m.id) === signature) continue;
    seenMessages.set(m.id, signature);
    const row = { id: `msg-${m.id}`, lane: 'operator' as const, t: m.at, from: m.role === 'user' ? 'OPERATOR' : 'ORCH', text: m.thinking ? '…' : m.text };
    const index = rows.findIndex((entry) => entry.id === row.id);
    if (index < 0) {
      emit(row);
      continue;
    }
    rows = rows.map((entry, i) => i === index ? { ...entry, t: row.t, from: row.from, text: row.text } : entry);
    version++;
    [...listeners].forEach((fn) => fn());
  }
}

export function wireComms() {
  if (wired) return;
  wired = true;
  ingestSnapshot(consoleStore.get());
  consoleStore.subscribe(() => ingestSnapshot(consoleStore.get()));
}

export function filterCommRows(source: CommRow[], lane: 'all' | CommLane, opts: { agent?: string | null; showAcks?: boolean }, clock: number): CommRow[] {
  let out = source.filter((r) => r.t <= clock);
  if (!opts.showAcks) out = out.filter((r) => r.verb !== 'ACK');
  if (lane !== 'all') out = out.filter((r) => r.lane === lane);
  if (opts.agent) {
    const a = opts.agent.toUpperCase();
    out = out.filter((r) => r.from.toUpperCase().includes(a) || r.to?.toUpperCase().includes(a));
  }
  return [...out].sort((x, y) => x.t - y.t || x.seq - y.seq);
}

export function getCommRows(lane: 'all' | CommLane, opts: { agent?: string | null; showAcks?: boolean } = {}, clock = consoleStore.get().clock.t): CommRow[] {
  return filterCommRows(rows, lane, opts, clock);
}

export function subscribeCommRows(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function commVersion() {
  return version;
}

export function useCommRows(lane: 'all' | CommLane, opts: { agent?: string | null; showAcks?: boolean } = {}): CommRow[] {
  const v = useSyncExternalStore(
    subscribeCommRows,
    () => version,
    () => version,
  );
  void v;
  return getCommRows(lane, opts);
}

/** Local operator line, timestamped in scenario time so it sorts with the rest of the feed. */
export function sendLocal(target: string, text: string) {
  const t = consoleStore.get().clock.t;
  emit({ id: `loc-${t}-${seq}-${Math.random().toString(36).slice(2, 7)}`, lane: 'operator', t, local: true, from: 'OPERATOR', to: target, text });
}

/** A simulated alert/message into the SYSTEM lane (scenario time). */
export function postSystem(from: string, text: string) {
  const t = consoleStore.get().clock.t;
  emit({ id: `sys-${t}-${seq}-${Math.random().toString(36).slice(2, 7)}`, lane: 'system', t, local: true, sim: true, from, verb: 'ALERT', text });
}

export function replyFromAgent(agent: string) {
  const s = consoleStore.get();
  const t = s.clock.t;
  const pool = s.pools.find((p) => agent.toUpperCase().includes(p.id.replace('pool-', '').toUpperCase()) || agent.toUpperCase().includes(p.label.split(' ')[0]!.toUpperCase()));
  const mine = s.jobs.filter((j) => j.agent === agent || (pool && j.poolId === pool.id));
  const done = mine.filter((j) => j.status === 'done').sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  const last = done[0];
  const ageS = last?.finishedAt ? Math.max(0, Math.round((t - last.finishedAt) / 1000)) : null;
  const findings = last ? last.findingIds.map((id) => s.findings.find((f) => f.id === id)?.label).filter(Boolean) as string[] : [];
  const text = last
    ? `last task '${last.input.length > 60 ? `${last.input.slice(0, 60)}…` : last.input}' done ${ageS}s ago · ${findings.length} findings${findings.length ? `: ${findings.slice(0, 3).join(' | ')}` : ''}`
    : `no completed tasks yet · queue ${pool?.queue ?? 0}`;
  const meta = last ? `${last.provider} / ${last.model}` : undefined;
  emit({ id: `sim-${t}-${seq}-${Math.random().toString(36).slice(2, 7)}`, lane: 'agent', t, local: true, sim: true, from: agent, to: 'OPERATOR', verb: 'REPLY', text, meta });
}

/* ------------------------------------------------------------------ priority weights (display-only re-rank) */

export interface Weights { severity: number; exposure: number; confidence: number; freshness: number; corroboration: number }
export const WEIGHT_KEYS: (keyof Weights)[] = ['severity', 'exposure', 'confidence', 'freshness', 'corroboration'];
const DEFAULT_W: Weights = { severity: 80, exposure: 60, confidence: 50, freshness: 40, corroboration: 50 };

export function loadWeights(): Weights {
  try {
    const v = JSON.parse(localStorage.getItem('ops.weights') ?? 'null');
    if (v && WEIGHT_KEYS.every((k) => typeof v[k] === 'number')) return v as Weights;
  } catch { /* optional */ }
  return { ...DEFAULT_W };
}
export function saveWeights(w: Weights) {
  try { localStorage.setItem('ops.weights', JSON.stringify(w)); } catch { /* optional */ }
}
