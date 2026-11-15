import type { Action, ConsoleApi, Ms } from '../../contracts';

export interface JournalEntry {
  /** Chronicle entry id or runtime action key. */
  key: string;
  t: Ms;
  decision: 'approved' | 'rejected';
  title: string;
  /** Runtime action kind for re-application after a rebuild. */
  actionKind?: Action['kind'];
}

const entries = new Map<string, JournalEntry>();
const listeners = new Set<() => void>();
let version = 0;

export const actionKey = (a: Pick<Action, 'kind' | 'title'>) => `action:${a.kind}|${a.title}`;

/**
 * Human decisions keyed by simulation time. A decision is in force only while the playhead is at or
 * after it, so scrubbing back before an approval shows it as pending again, and forward restores it.
 */
export const journal = {
  version: () => version,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  record(e: JournalEntry) {
    entries.set(e.key, e);
    version++;
    listeners.forEach((fn) => fn());
  },
  at(key: string, t: Ms): JournalEntry | undefined {
    const e = entries.get(key);
    return e && e.t <= t ? e : undefined;
  },
  list(t: Ms): JournalEntry[] {
    return [...entries.values()].filter((e) => e.t <= t).sort((a, b) => a.t - b.t);
  },
  clear() { entries.clear(); version++; listeners.forEach((fn) => fn()); },
  /** Re-apply in-force runtime decisions to a rebuilt simulation (matched by kind and title). */
  reapply(actions: Action[], t: Ms, api: Pick<ConsoleApi, 'approve' | 'reject'>): number {
    let n = 0;
    for (const a of actions) {
      if (a.status !== 'proposed') continue;
      const e = journal.at(actionKey(a), t);
      if (!e) continue;
      if (e.decision === 'approved') api.approve(a.id); else api.reject(a.id);
      n++;
    }
    return n;
  },
};
