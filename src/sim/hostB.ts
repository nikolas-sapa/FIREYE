/** Shared helpers and the engine surface used by the REV B intel + orchestrator modules. */
import type { FireStats } from './agent';
import type { Pipeline } from './pipeline';
import type { RoadGraph } from './roads';
import { pointInPolygon } from './forecast';
import { CELL_M, type SimSnapshotB, type Vec, type WorldMeta } from './types';

export interface BHost {
  readonly state: SimSnapshotB;
  readonly world: WorldMeta;
  readonly pipeline: Pipeline;
  readonly roads: RoadGraph;
  rand(): number;
  nextId(prefix: string): string;
  fire(): FireStats;
  /** Distance (cells) from p to the nearest burning cell; Infinity when none. */
  fireDistance(p: Vec): number;
  findCell(near: Vec, radius: number, pred: (i: number) => boolean): Vec | null;
  /** "21:42Z" for a sim time. */
  zulu(t: number): string;
  requestForecast(): void;
  /** Send ground units along a road route to `to`. */
  dispatch(unitIds: string[], to: Vec, opts: { after: 'standby' | 'work'; tag: string; line?: boolean }): void;
  /** true once the unit finished the route dispatched with `tag`. */
  routeDone(unitId: string, tag: string): boolean;
  markDirty(): void;
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const km = (cells: number) => ((cells * CELL_M) / 1000).toFixed(1);

/** Innermost forecast band index containing p (0 = +1H, 1 = +3H, 2 = +6H), or -1. */
export function bandIndex(s: SimSnapshotB, p: Vec): number {
  for (let k = 0; k < s.forecast.length; k++) if (pointInPolygon(p, s.forecast[k].polygon)) return k;
  return -1;
}
export const BAND_LABEL = ['+1H', '+3H', '+6H'];

/** Minutes until the front reaches p at the current head rate of spread. */
export function etaMin(h: BHost, p: Vec): number {
  const d = h.fireDistance(p);
  if (!Number.isFinite(d)) return Infinity;
  return (d * CELL_M) / Math.max(h.fire().rosMpm, 6);
}

export function downwind(s: SimSnapshotB, from: Vec, cells: number): Vec {
  const to = ((s.wind.dirDeg + 180) * Math.PI) / 180;
  return { x: from.x + Math.sin(to) * cells, y: from.y - Math.cos(to) * cells };
}
