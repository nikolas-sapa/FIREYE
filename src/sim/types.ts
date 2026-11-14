/**
 * FCC simulation contract. Shared by the engine (src/sim), the map renderer
 * (src/dashboard/map) and the dashboard panels (src/dashboard).
 *
 * World space: a grid of GRID_W x GRID_H cells, each CELL_M meters square.
 * All positions (Vec) are in CELL units (floats), origin top-left, +x east, +y south.
 */

export const GRID_W = 240;
export const GRID_H = 150;
export const CELL_M = 40;
/** Geographic anchor of cell (0,0) — fictional AO in the Sierra foothills. */
export const ORIGIN = { lat: 38.912, lon: -120.684 } as const;

export type Vec = { x: number; y: number };

export enum Fuel { Water = 0, Rock = 1, Grass = 2, Brush = 3, Timber = 4, Urban = 5, Road = 6, Burnt = 7 }
export enum CellState { Unburnt = 0, Burning = 1, Burnt = 2, Suppressed = 3 }

export interface Grid {
  w: number;
  h: number;
  /** 0..1 normalized elevation. */
  elevation: Float32Array;
  /** Fuel enum per cell. */
  fuel: Uint8Array;
  /** 0..1 fuel dryness (1 = extremely flammable). */
  dryness: Float32Array;
  /** CellState per cell. */
  state: Uint8Array;
  /** 0..1 fire intensity for burning cells, decays as they burn out. */
  heat: Float32Array;
  /** 0..1 retardant / water coverage that slows spread. */
  retardant: Float32Array;
  /** Version counter incremented whenever state/heat changes (for renderer caching). */
  version: number;
}

export interface Wind { speedKph: number; dirDeg: number; gustKph: number }
export interface Weather { tempC: number; humidityPct: number; fuelMoisturePct: number; redFlag: boolean }

export interface ForecastBand {
  horizonMin: 60 | 180 | 360;
  /** Closed polygon in cell coordinates. */
  polygon: Vec[];
  confidence: number; // 0..1
}

export type UnitKind = 'drone' | 'engine' | 'crew' | 'helo' | 'tanker' | 'dozer';
export type UnitStatus = 'active' | 'enroute' | 'standby' | 'rtb';

export interface Unit {
  id: string;
  callsign: string; // e.g. "HAWK-2", "E-41", "CREW-7"
  kind: UnitKind;
  pos: Vec;
  heading: number; // deg, 0 = north
  speed: number; // cells / sim-second
  target?: Vec;
  status: UnitStatus;
  battery?: number; // 0..1 (drones)
  water?: number; // 0..1 (engines, helos, tankers)
  /** Recent positions, newest last, max ~40. */
  trail: Vec[];
  /** Live sensor feed label for drones, e.g. "EO/IR 4K". */
  sensor?: string;
}

export type MarkerKind = 'human' | 'structure' | 'fuel' | 'hazard' | 'water' | 'poi' | 'spot';
export type Severity = 'low' | 'med' | 'high' | 'critical';

export interface Marker {
  id: string;
  kind: MarkerKind;
  pos: Vec;
  label: string; // short, e.g. "2 PERSONS · TRAILHEAD"
  detail: string; // one sentence
  severity: Severity;
  confidence: number; // 0..1
  sourceId?: string; // IngestItem id that produced it
  detectedAt: number; // sim time (s)
}

export type IngestType = 'video' | 'image' | 'news' | 'sensor' | 'radio' | 'satellite';

export interface IngestItem {
  id: string;
  type: IngestType;
  source: string; // "HAWK-2 EO/IR", "KCRA 3 News", "GOES-18", "CMD NET"
  title: string;
  summary: string;
  at: number; // sim time (s)
  tags: string[];
  /** Status of AI processing. */
  status: 'queued' | 'analyzing' | 'processed';
  /** Derived marker ids. */
  derived?: string[];
}

export type InsightKind = 'analysis' | 'forecast' | 'recommendation' | 'alert' | 'status';

export interface Insight {
  id: string;
  at: number;
  kind: InsightKind;
  title: string;
  body: string;
  confidence: number; // 0..1
  refs?: string[]; // ingest/marker ids
}

export interface Recommendation {
  id: string;
  at: number;
  title: string; // "Reposition E-41 to Ridge Rd anchor point"
  rationale: string;
  unitIds: string[];
  target: Vec;
  priority: 'P1' | 'P2' | 'P3';
  etaMin: number;
  impact: string; // "-18% spread toward Pine Hollow"
  status: 'pending' | 'accepted' | 'dismissed';
}

export interface Metrics {
  acres: number;
  containmentPct: number;
  rateOfSpreadMpm: number; // meters/min at the head
  structuresThreatened: number;
  personsAtRisk: number;
  personnel: number;
  activeUnits: number;
}

export interface SimSnapshot {
  t: number; // sim seconds since ignition
  clock: Date; // wall clock equivalent
  grid: Grid; // live reference (mutated in place) — read-only for consumers
  wind: Wind;
  weather: Weather;
  forecast: ForecastBand[];
  units: Unit[];
  markers: Marker[];
  ingest: IngestItem[]; // newest first, capped ~40
  insights: Insight[]; // newest first, capped ~40
  recommendations: Recommendation[]; // newest first
  metrics: Metrics;
  history: { acres: number[]; containment: number[]; ros: number[] }; // ~60 samples
  /** Increments every time forecast polygons are recomputed. */
  forecastRev: number;
  /** Static world features (roads, town, landmarks). Optional, additive. */
  world?: WorldMeta;
}

/** Static, vector description of the procedural world (for renderers and copy). */
export interface WorldMeta {
  seed: number;
  ignition: Vec;
  town: { name: string; center: Vec; x0: number; y0: number; x1: number; y1: number };
  trailhead: Vec;
  reservoir: { center: Vec; rx: number; ry: number };
  helibase: Vec;
  airbase: Vec;
  icp: Vec;
  river: Vec[];
  roads: { id: string; name: string; kind: 'highway' | 'road' | 'trail'; points: Vec[] }[];
  /** Building footprints in cell units. */
  buildings: { x: number; y: number; w: number; h: number }[];
  landmarks: { id: string; label: string; pos: Vec }[];
}

export interface SimEngine {
  /** Current state (mutable reference). */
  readonly state: SimSnapshot;
  /** Advance by real-time dt seconds (engine applies its own speed multiplier). */
  tick(dtReal: number): void;
  setPaused(p: boolean): void;
  readonly paused: boolean;
  setSpeed(mult: number): void; // 1, 2, 4, 8 ...
  readonly speed: number;
  accept(recId: string): void; // dispatches units toward target, lays retardant
  dismiss(recId: string): void;
  reset(): void;
  /** Called (throttled ~4Hz) when snapshot-level data changes; used by React. */
  subscribe(fn: () => void): () => void;
}

export interface MapLayers {
  terrain: boolean;
  contours: boolean;
  fuel: boolean;
  fire: boolean;
  forecast: boolean;
  units: boolean;
  markers: boolean;
  grid: boolean;
}

export const DEFAULT_LAYERS: MapLayers = {
  terrain: true, contours: true, fuel: false, fire: true, forecast: true, units: true, markers: true, grid: true,
};
