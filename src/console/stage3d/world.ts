import { useSyncExternalStore } from 'react';
import type { Geo, Unit } from '../contracts';
import type { StageKey, StageSnapshot } from './types';
import { UnitMotion } from './motion';

/**
 * Module-level mirror of the console state the stage needs. Both the main Stage engine and the shared
 * feed renderer read from here, so they stay decoupled from the store implementation (and a dev harness
 * can drive them directly).
 */
const snap: StageSnapshot = {
  pack: null,
  t: 0,
  paused: false,
  units: [],
  findings: [],
  feeds: [],
  projection: null,
  items: [],
  actions: [],
  coverage: [],
  stage: { mode: 'globe', dimmed: false, highlight: [] },
  directives: [],
  fireRev: 0,
};

type Listener = (changed: ReadonlySet<StageKey>) => void;
const listeners = new Set<Listener>();
let version = 0;

/* ------------------------------------------------------------------ unit motion smoothing */

const motion = new UnitMotion();
let lastUnitsAt = 0;
let motionEpoch = 0;

/** Smoothly interpolated unit position (between store updates). Writes into `out` when given. */
export function unitPos(u: Unit, now = performance.now(), out?: Geo): Geo {
  return motion.position(u, now, out);
}

export function unitHeading(u: Unit, now = performance.now()): number {
  return motion.heading(u, now);
}

/* ------------------------------------------------------------------ store */

export const stageWorld = {
  get(): Readonly<StageSnapshot> {
    return snap;
  },
  version(): number {
    return version;
  },
  motionEpoch: () => motionEpoch,
  set(p: Partial<StageSnapshot>) {
    const oldT = snap.t, oldPack = snap.pack, oldSpeed = snap.speed;
    const changed = new Set<StageKey>();
    for (const k of Object.keys(p) as StageKey[]) {
      const v = p[k];
      if (v === undefined || snap[k] === v) continue;
      (snap as unknown as Record<string, unknown>)[k] = v;
      changed.add(k);
    }
    if (!changed.size) return;
    if (changed.has('units') || changed.has('pack') || changed.has('t')) {
      const now = performance.now(), elapsed = now - lastUnitsAt;
      const expected = elapsed * (snap.speed ?? 60);
      const reset = oldPack !== snap.pack || snap.t < oldT || oldSpeed !== snap.speed
        || elapsed > 1500 || Math.abs(snap.t - oldT) > Math.max(2000, expected * 3);
      if (reset) motionEpoch++;
      motion.update(snap.units, now, reset);
      lastUnitsAt = now;
    }
    version++;
    for (const fn of listeners) fn(changed);
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

const subscribeAny = (cb: () => void) => stageWorld.subscribe(cb);

/** React hook: re-render when the selected slice of the stage snapshot changes (by reference). */
export function useStageWorld<T>(sel: (s: Readonly<StageSnapshot>) => T): T {
  return useSyncExternalStore(subscribeAny, () => sel(snap), () => sel(snap));
}
