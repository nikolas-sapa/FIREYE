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
  /** REV B: drone coverage network (default on). */
  coverage?: boolean;
  /** REV B: approximate-location observations (default on). Replaces legacy markers on the map. */
  observations?: boolean;
  /** REV B: movement proposals, routes and safety zones (default on). */
  movements?: boolean;
}

export const DEFAULT_LAYERS: MapLayers = {
  terrain: true, contours: true, fuel: false, fire: true, forecast: true, units: true, markers: true, grid: true,
  coverage: true, observations: true, movements: true,
};

/* ===========================================================================
 * REV B — Orchestrator-first contract (additive).
 * Many analysis agents (one pool per input modality) feed a projection agent
 * and a single Orchestrator, which grades everything and decides where it shows.
 * ========================================================================= */

/** Input modalities from the REV B brief. */
export type SourceKind =
  | 'web'        // Firecrawl search/scrape of local news & articles
  | 'satellite'  // open satellite imagery / hotspots (NASA FIRMS, Sentinel-2, GOES)
  | 'ground-cam' // vehicle-mounted cameras on ground forces
  | 'drone-cam'  // supporting drone video
  | 'social'     // geotagged social media video relevant to the fire
  | 'weather'    // weather API
  | 'terrain'    // terrain / elevation / fuel model API
  | 'radio';     // CAD / radio traffic

/** What an alert is about. Drives icon + color. */
export type AlertClass = 'life' | 'hazard' | 'fuel' | 'movement' | 'projection' | 'status';

/**
 * Where the Orchestrator places an alert, derived from its importance score:
 *  0 INTERRUPT  score >= 85  — takes over the map center, must be acknowledged, pushed to field units
 *  1 FOCUS      score 60–84  — Orchestrator dock "Needs attention" stack
 *  2 AMBIENT    score 35–59  — map marker + subtle dock count only
 *  3 LOG        score < 35   — recorded in the log drawer, never surfaced proactively
 */
export type AlertTier = 0 | 1 | 2 | 3;
export type Audience = 'fire' | 'ems' | 'law' | 'public';

export interface OrchAlert {
  id: string;
  at: number; // sim s
  cls: AlertClass;
  tier: AlertTier;
  score: number; // 0..100 importance, graded by the Orchestrator
  title: string; // "2 hikers in projected path"
  body: string; // one or two sentences
  why: string; // grading rationale, e.g. "Life safety · inside +1H band · 0.87 conf"
  pos?: Vec;
  radiusCells?: number;
  observationId?: string;
  movementId?: string;
  sourceIds: string[]; // AnalysisJob / IngestItem ids that support it
  notify: Audience[]; // who the Orchestrator relayed it to
  ack: boolean;
  /** Scored as an interrupt but held behind another unacknowledged interrupt or the dock budget. */
  queued?: boolean;
  /** Subject cleared or aged out; alert kept for the log at tier 3. */
  resolved?: boolean;
  /** Sim time of the last re-grade that changed the alert. */
  updatedAt?: number;
}

/** A located finding. Non-live findings fade as they age. */
export type ObservationKind = 'human' | 'animal' | 'structure' | 'combustible' | 'fuel' | 'spot' | 'water' | 'road-block';

export interface Observation {
  id: string;
  kind: ObservationKind;
  pos: Vec;
  /** Location uncertainty radius in meters; drawn as an approximate-location ring. */
  uncertaintyM: number;
  observedAt: number; // sim s
  /** true when confirmed by a live feed (drone/ground cam) right now. */
  live: boolean;
  source: SourceKind;
  sourceLabel: string; // "KCRA 3 article", "TikTok video · 14 min ago", "HAWK-2 EO/IR"
  label: string; // "2 HIKERS · TRAILHEAD"
  confidence: number; // 0..1
  /** 1 = fresh, 0 = expired. Engine computes from age and halfLifeS (live = 1). */
  freshness: number;
  halfLifeS: number;
  /** Head count for humans / animals. */
  count?: number;
  /** Number of independent reports that support it. */
  sources?: number;
  /** true once a live feed has confirmed the exact position. */
  confirmed?: boolean;
  /** Fuel / object sensitivity to fire. */
  sensitivity?: 'increased' | 'decreased';
  /** Cleared (evacuated, extinguished); kept briefly for the log. */
  resolved?: boolean;
}

export interface AnalysisJob {
  id: string;
  source: SourceKind;
  input: string; // "KCRA 3 · 'Evacuation warning for Pine Hollow'", "E-41 dash cam clip 00:42"
  agent: string; // "VISION-07"
  model: string; // e.g. "fal · video-understanding", "treq · claude-sonnet", "firecrawl · search"
  status: 'queued' | 'running' | 'done';
  queuedAt: number;
  startedAt?: number;
  durationS: number;
  findings: number; // observations produced
  observationIds?: string[];
  /** 0..1 progress while running (1 when done). */
  progress?: number;
  /** Current stage, e.g. "search+scrape" then "extraction LLM" for web jobs. */
  stage?: string;
  /** Sandbox runtime, always "boxd". */
  sandbox?: string;
  /** Pool that ran it (matches AgentPool.id). Projection / Orchestrator jobs use their own pool ids. */
  pool?: SourceKind | 'projection' | 'orchestrator';
}

export interface AgentPool {
  id: string;
  role: 'analysis' | 'projection' | 'orchestrator';
  source?: SourceKind; // for analysis pools
  label: string; // "Video analysis"
  provider: string; // "fal", "treq", "firecrawl", "boxd"
  model: string;
  workers: number; // currently running sandboxes (autoscaled)
  maxWorkers: number;
  queue: number;
  throughputPerMin: number;
  p50LatencyS: number;
  /** Sandbox runtime the workers run in ("boxd"). */
  sandbox?: string;
  /** Upstream inputs, e.g. "NASA FIRMS · Sentinel-2 · GOES-18". */
  inputs?: string;
  /** Workers still cold-starting. */
  booting?: number;
  /** Direction of the last autoscale action. */
  scaling?: 'up' | 'down' | 'steady';
  /** Jobs currently running. */
  running?: number;
}

export interface CameraFeed {
  id: string;
  unitId?: string;
  kind: 'vehicle' | 'drone' | 'social' | 'satellite';
  label: string; // "E-41 · DASH CAM", "HAWK-2 · EO/IR"
  live: boolean;
  pos: Vec;
  heading: number;
  detections: number; // findings in last 5 min
  /** Optional observation the feed is currently looking at. */
  focusObservationId?: string;
  /** Sensor description, e.g. "LWIR 640", "EO/IR 4K", "DASH CAM". */
  sensor?: string;
  /** Social / recorded clips: sim time the clip was captured. */
  capturedAt?: number;
}

/** Drone coverage network: the AO is tiled and drones are assigned to the highest-interest cells. */
export interface CoverageCell {
  id: string; // "C-07"
  x: number; y: number; w: number; h: number; // in cells
  interest: number; // 0..1, from projection + observations
  assignedUnitId?: string;
  lastSweptAt: number; // sim s
}

/** Group movement suggestion: who moves, where, by which route, when, and the safety fallback. */
export interface MovementProposal {
  id: string;
  at: number;
  title: string; // "Pull DIV A back to Ridge Rd safety zone"
  group: string; // "DIV A · E-41, E-17, CREW-7"
  unitIds: string[];
  from: Vec;
  to: Vec;
  route: Vec[]; // polyline incl. from/to
  windowMin: [number, number]; // [start within, must complete by] minutes
  safetyZone: { center: Vec; radiusCells: number; label: string };
  trigger: string; // "+1H projection crosses HWY 49 at 14:20Z"
  reason: string;
  score: number; // 0..100
  status: 'proposed' | 'approved' | 'rejected' | 'executing' | 'done';
  /** Human readable window, e.g. "NOW → 21:45Z". */
  windowLabel?: string;
}

export interface OrchMessage {
  id: string;
  at: number;
  role: 'orchestrator' | 'user';
  text: string;
  refs?: string[]; // alert / observation / movement ids
}

export interface OrchestratorState {
  status: 'monitoring' | 'analyzing' | 'briefing';
  /** One-line current headline, e.g. "Head running NE at 32 m/min toward Pine Hollow". */
  headline: string;
  /** 3 short bullets: the situation in plain language. */
  brief: string[];
  messages: OrchMessage[]; // oldest first, capped
  suggestions: string[]; // prompt chips the user can tap
}

/** REV B snapshot extension. Engine always populates these. */
export interface SimSnapshotB extends SimSnapshot {
  alerts: OrchAlert[]; // newest first
  observations: Observation[];
  jobs: AnalysisJob[]; // newest first, capped ~60
  pools: AgentPool[];
  feeds: CameraFeed[];
  coverage: CoverageCell[];
  movements: MovementProposal[]; // newest first
  orchestrator: OrchestratorState;
}

export interface SimEngineB extends Omit<SimEngine, 'state'> {
  readonly state: SimSnapshotB;
  ask(text: string): void; // user message to the Orchestrator; reply arrives after a short "thinking" delay
  ackAlert(id: string): void;
  approveMovement(id: string): void; // dispatches the group along the route
  rejectMovement(id: string): void;
}
