import type { IconName, Tone } from '@ds';
import { pad } from '@ds';
import {
  CELL_M,
  ORIGIN,
  type IngestType,
  type InsightKind,
  type MarkerKind,
  type Recommendation,
  type Severity,
  type UnitKind,
  type Vec,
} from '@/sim/types';

const M_PER_DEG = 111_320;
const COS_LAT = Math.cos((ORIGIN.lat * Math.PI) / 180);
const M2_PER_ACRE = 4046.856;

/** Cell-space position to WGS84 degrees (flat-earth approximation, fine at AO scale). */
export function cellToLatLon(p: Vec) {
  return {
    lat: ORIGIN.lat - (p.y * CELL_M) / M_PER_DEG,
    lon: ORIGIN.lon + (p.x * CELL_M) / (M_PER_DEG * COS_LAT),
  };
}

/** Elapsed sim time as T+HH:MM:SS. */
export function tPlus(s: number) {
  const t = Math.max(0, Math.floor(s));
  return `T+${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

/** Short duration MM:SS (or H:MM:SS past an hour). */
export function mmss(s: number) {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(t % 60)}` : `${pad(m)}:${pad(t % 60)}`;
}

/** Video-style timecode HH:MM:SS:FF from sim seconds. */
export function timecode(s: number) {
  const t = Math.max(0, s);
  const whole = Math.floor(t);
  const ff = Math.floor((t - whole) * 30);
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}:${pad(ff)}`;
}

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const cardinal = (deg: number) => CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
export const pct = (v: number) => Math.round(v * 100);

/** Polygon area in acres from a cell-space ring (shoelace). */
export function polygonAcres(poly: Vec[]) {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return (Math.abs(a / 2) * CELL_M * CELL_M) / M2_PER_ACRE;
}

export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Recommendation confidence; the contract has no field yet, so fall back to a stable per-id value. */
export function recConfidence(r: Recommendation) {
  const explicit = (r as Recommendation & { confidence?: number }).confidence;
  if (typeof explicit === 'number') return explicit;
  const base = r.priority === 'P1' ? 0.86 : r.priority === 'P2' ? 0.78 : 0.7;
  return Math.min(0.97, base + (hashStr(r.id) % 9) / 100);
}

export const severityTone: Record<Severity, Tone> = { low: 'neutral', med: 'warning', high: 'signal', critical: 'danger' };
export const priorityTone: Record<Recommendation['priority'], Tone> = { P1: 'danger', P2: 'signal', P3: 'neutral' };

export const ingestIcon: Record<IngestType, IconName> = {
  video: 'video', image: 'image', news: 'news', sensor: 'sensor', radio: 'radio', satellite: 'satellite',
};
export const ingestCode: Record<IngestType, string> = {
  video: 'VID', image: 'IMG', news: 'OSINT', sensor: 'RAWS', radio: 'COMMS', satellite: 'SAT',
};

export const markerIcon: Record<MarkerKind, IconName> = {
  human: 'human', structure: 'structure', fuel: 'tree', hazard: 'hazard', water: 'droplet', poi: 'target', spot: 'flame',
};
export const markerTone: Record<MarkerKind, Tone> = {
  human: 'detection', structure: 'warning', fuel: 'signal', hazard: 'danger', water: 'telemetry', poi: 'detection', spot: 'danger',
};
export const markerKindLabel: Record<MarkerKind, string> = {
  human: 'Human detection', structure: 'Structure', fuel: 'Critical fuel', hazard: 'Hazard', water: 'Water source', poi: 'Point of interest', spot: 'Spot fire',
};

export const insightTone: Record<InsightKind, Tone> = {
  analysis: 'telemetry', forecast: 'warning', recommendation: 'signal', alert: 'danger', status: 'nominal',
};

export const unitIcon: Record<UnitKind, IconName> = {
  drone: 'drone', engine: 'engine', crew: 'crew', helo: 'helo', tanker: 'tanker', dozer: 'dozer',
};
export const unitGroupLabel: Record<UnitKind, string> = {
  drone: 'UAS / Recon', helo: 'Rotor wing', tanker: 'Fixed wing', engine: 'Engines', crew: 'Hand crews', dozer: 'Heavy equip',
};
export const UNIT_ORDER: UnitKind[] = ['drone', 'helo', 'tanker', 'engine', 'crew', 'dozer'];
