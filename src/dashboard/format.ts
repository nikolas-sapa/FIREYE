import type { IconName, Tone } from '@ds';
import { pad, zulu } from '@ds';
import {
  CELL_M,
  ORIGIN,
  type ObservationKind,
  type SourceKind,
  type UnitKind,
  type Vec,
} from '@/sim/types';

const M_PER_DEG = 111_320;
const COS_LAT = Math.cos((ORIGIN.lat * Math.PI) / 180);

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

/** Zulu wall-clock time of a past sim instant, given the current snapshot clock. */
export function zuluAt(clock: Date, now: number, at: number) {
  return zulu(new Date(clock.getTime() - (now - at) * 1000));
}

/** Compact age label: "42S", "12M", "1H 04M". */
export function ageLabel(s: number) {
  const t = Math.max(0, Math.floor(s));
  if (t < 60) return `${t}S`;
  if (t < 3600) return `${Math.floor(t / 60)}M`;
  return `${Math.floor(t / 3600)}H ${pad(Math.floor((t % 3600) / 60))}M`;
}

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const cardinal = (deg: number) => CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
export const pct = (v: number) => Math.round(v * 100);

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/* --------------------------------- Sources -------------------------------- */

export const sourceIcon: Record<SourceKind, IconName> = {
  web: 'web', satellite: 'satellite', 'ground-cam': 'camera', 'drone-cam': 'drone', social: 'social', weather: 'wind', terrain: 'map', radio: 'radio',
};

export const sourceCode: Record<SourceKind, string> = {
  web: 'WEB', satellite: 'SAT', 'ground-cam': 'GND CAM', 'drone-cam': 'UAS CAM', social: 'SOCIAL', weather: 'WX', terrain: 'TERRAIN', radio: 'RADIO',
};

/** Live sources observe the scene directly; everything else is approximate and decays. */
export const isLiveSource = (s: SourceKind) => s === 'ground-cam' || s === 'drone-cam';

/* ------------------------------ Observations ------------------------------ */

export const obsIcon: Record<ObservationKind, IconName> = {
  human: 'human', animal: 'animal', structure: 'structure', combustible: 'combustible', fuel: 'tree', spot: 'flame', water: 'droplet', 'road-block': 'alert',
};

export const obsKindLabel: Record<ObservationKind, string> = {
  human: 'Persons', animal: 'Animals', structure: 'Structure', combustible: 'Combustible', fuel: 'Dry fuel', spot: 'Spot fire', water: 'Water', 'road-block': 'Road block',
};

export const obsTone: Record<ObservationKind, Tone> = {
  human: 'detection', animal: 'detection', structure: 'neutral', combustible: 'danger', fuel: 'warning', spot: 'danger', water: 'telemetry', 'road-block': 'warning',
};

/* ---------------------------------- Units --------------------------------- */

export const unitGroupLabel: Record<UnitKind, string> = {
  drone: 'UAS / Recon', helo: 'Rotor wing', tanker: 'Fixed wing', engine: 'Engines', crew: 'Hand crews', dozer: 'Heavy equip',
};
export const UNIT_ORDER: UnitKind[] = ['engine', 'crew', 'dozer', 'drone', 'helo', 'tanker'];
