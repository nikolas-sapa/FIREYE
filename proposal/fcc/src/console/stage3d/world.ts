import { useSyncExternalStore } from 'react';
import type { Geo, Unit } from '../contracts';
import type { StageKey, StageSnapshot } from './types';

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

interface Motion { from: Geo; to: Geo; fromHdg: number; toHdg: number; t0: number; dur: number }
const motion = new Map<string, Motion>();
let lastUnitsAt = 0;

function lerpAngle(a: number, b: number, k: number) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

function sampleMotion(m: Motion, now: number, out: Geo): Geo {
  const k = m.dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - m.t0) / m.dur));
  out.lon = m.from.lon + (m.to.lon - m.from.lon) * k;
  out.lat = m.from.lat + (m.to.lat - m.from.lat) * k;
  out.alt = (m.from.alt ?? 0) + ((m.to.alt ?? 0) - (m.from.alt ?? 0)) * k;
  return out;
}

function updateMotion(units: Unit[]) {
  const now = performance.now();
  const dur = lastUnitsAt ? Math.min(1000, Math.max(80, now - lastUnitsAt)) : 0;
  lastUnitsAt = now;
  const seen = new Set<string>();
  for (const u of units) {
    seen.add(u.id);
    const m = motion.get(u.id);
    if (!m) {
      motion.set(u.id, { from: { ...u.pos }, to: { ...u.pos }, fromHdg: u.heading, toHdg: u.heading, t0: now, dur: 0 });
      continue;
    }
    const cur = sampleMotion(m, now, { lon: 0, lat: 0 });
    const k = m.dur <= 0 ? 1 : Math.min(1, (now - m.t0) / m.dur);
    const jump = Math.abs(cur.lon - u.pos.lon) + Math.abs(cur.lat - u.pos.lat) > 0.02;
    m.fromHdg = lerpAngle(m.fromHdg, m.toHdg, k);
    m.toHdg = u.heading;
    m.from = jump ? { ...u.pos } : cur;
    m.to = { ...u.pos };
    m.t0 = now;
    m.dur = jump ? 0 : dur;
  }
  for (const id of motion.keys()) if (!seen.has(id)) motion.delete(id);
}

/** Smoothly interpolated unit position (between store updates). Writes into `out` when given. */
export function unitPos(u: Unit, now = performance.now(), out?: Geo): Geo {
  const m = motion.get(u.id);
  const o = out ?? { lon: 0, lat: 0 };
  if (!m) { o.lon = u.pos.lon; o.lat = u.pos.lat; o.alt = u.pos.alt; return o; }
  return sampleMotion(m, now, o);
}

export function unitHeading(u: Unit, now = performance.now()): number {
  const m = motion.get(u.id);
  if (!m) return u.heading;
  const k = m.dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - m.t0) / m.dur));
  return lerpAngle(m.fromHdg, m.toHdg, k);
}

/* ------------------------------------------------------------------ store */

export const stageWorld = {
  get(): Readonly<StageSnapshot> {
    return snap;
  },
  version(): number {
    return version;
  },
  set(p: Partial<StageSnapshot>) {
    const changed = new Set<StageKey>();
    for (const k of Object.keys(p) as StageKey[]) {
      const v = p[k];
      if (v === undefined || snap[k] === v) continue;
      (snap as unknown as Record<string, unknown>)[k] = v;
      changed.add(k);
    }
    if (!changed.size) return;
    if (changed.has('units')) updateMotion(snap.units);
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
