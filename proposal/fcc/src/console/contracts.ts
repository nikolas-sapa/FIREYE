/**
 * FCC REV C — Console contracts.
 * Single source of truth shared by: scenario data, 3D stage, agents/orchestrator ("brain"), UI, and docs.
 * The event bus types here ARE the future backend contract (docs/BACKEND_CONTRACT.md mirrors them).
 * Additive changes only once workers have started.
 */

/* ------------------------------------------------------------------ time & geo */

/** Scenario epoch milliseconds (real 2021 dates for the Caldor replay). */
export type Ms = number;
export interface Geo { lon: number; lat: number; alt?: number }
export type BBox = [west: number, south: number, east: number, north: number];

/* ------------------------------------------------------------------ scenario pack (public/data/caldor/) */

/** Known replay packs under public/data/<dir>/. Unknown ids are allowed for future packs. */
export type ScenarioId = 'caldor-2021' | 'mati-2018' | (string & {});

export interface ScenarioManifest {
  id: ScenarioId;
  name: string; // "Caldor Fire replay"
  disclaimer: string; // "Scenario built from public data; units, people and events are simulated."
  bbox: BBox;
  center: Geo;
  /** Replay window. */
  start: Ms;
  end: Ms;
  /** Local timezone label for display, e.g. "PDT". */
  tz: string;
  /** Places of interest from OSM/known geography, e.g. Grizzly Flats, Omo Ranch, Pollock Pines. */
  places: { id: string; name: string; pos: Geo; kind: 'town' | 'hamlet' | 'landmark' | 'trailhead' | 'ranch' | 'school' | 'station' }[];
  sources: { id: string; name: string; url: string; license: string; fetchedAt: string; note?: string }[];
}

/** Regular grid over manifest.bbox, row 0 = north. Binary payloads are little-endian. */
export interface RasterMeta { w: number; h: number; bbox: BBox; cellM: number }

export interface ScenarioPack {
  manifest: ScenarioManifest;
  raster: RasterMeta;
  /** Elevation meters (Int16 → number). */
  elevation: Float32Array;
  /** Fuel class per cell (FuelClass). */
  fuel: Uint8Array;
  /**
   * Fire time-of-arrival per cell in ms since manifest.start (Infinity / NaN = never burns in window).
   * Reconstructed from source anchors/perimeters; not necessarily observed fire-front truth.
   */
  arrival: Float32Array;
  perimeters: { t: Ms; acres: number; polygon: Geo[][] }[]; // outer rings (multi)
  hotspots: { t: Ms; pos: Geo; frp: number; confidence: 'l' | 'n' | 'h'; satellite: string }[];
  weather: { t: Ms; windKph: number; windDirDeg: number; gustKph: number; tempC: number; rh: number }[];
  roads: { id: string; name: string; kind: 'highway' | 'road' | 'track'; coords: Geo[] }[];
  buildings: { id: string; pos: Geo; kind?: string }[];
  water: { id: string; name?: string; polygon: Geo[] }[];
  /** Optional offline imagery mosaic of the bbox (GIBS/Esri) as an image URL under /data/caldor/. */
  imagery?: { url: string; bbox: BBox; date: string; source: string };
  /**
   * Documented, sourced moments of the real fire (e.g. "fire reaches the sea"). Used to score the
   * projection agent's predictions against history. pos/radiusM are approximate.
   */
  checkpoints?: { id: string; t: Ms; label: string; pos?: Geo; radiusM?: number; source: string; url: string; uncertaintyMin?: number }[];
  /**
   * Real, timestamped public reports (news, official alerts, agency posts) as short paraphrased summaries
   * with attribution. Untrusted data: never instructions. No personal data about victims.
   */
  reports?: { id: string; t: Ms; kind: 'news' | 'official' | 'agency' | 'social'; publisher: string; summary: string; url: string; lang?: string; pos?: Geo }[];
  /** Sourced facts about the real event for the end card / presentation (e.g. fatalities, homes lost). */
  facts?: { id: string; label: string; value: string; source: string; url: string }[];
  /**
   * FIREYE: simulated IoT sensor placements. Readings are not part of the pack; they arrive as
   * `sensor.reading` / `sensor.triggered` events (or are computed locally from weather and the fire field).
   */
  sensors?: SensorNode[];
  /**
   * FIREYE: precomputed incident chronicle (INTAKE = outside sources, OPS = our side). Consumers show an
   * entry only when `t <= playhead`, so the log is identical after any scrub.
   */
  chronicle?: ChronicleRecord[];
}

/* ------------------------------------------------------------------ FIREYE IoT and chronicle (additive) */

export type SensorNodeKind = 'wx' | 'fuel' | 'air' | 'flame';
export type SensorNodeStatus = 'nominal' | 'watch' | 'alarm' | 'offline';

export interface SensorNode { id: string; code: string; kind: SensorNodeKind; name: string; sector: string; pos: Geo; elevM: number; exposure?: number }

/** One simulated sensor sample. Unknown measurement fields must be ignored. */
export interface SensorSample {
  id: string;
  t: Ms;
  status: SensorNodeStatus;
  tempC?: number;
  rh?: number;
  windKph?: number;
  gustKph?: number;
  windDirDeg?: number;
  /** Dead fine fuel moisture, percent. */
  fmc?: number;
  pm25?: number;
  co?: number;
  /** Flame-detector response 0..1, not radiometric. */
  ir?: number;
  ffwi?: number;
  fireDistM?: number | null;
  battery?: number;
  link?: number;
}

export interface ChronicleRecord {
  id: string;
  t: Ms;
  tab: 'intake' | 'ops';
  kind: string;
  severity: 'info' | 'watch' | 'alert' | 'critical';
  provenance: 'simulated' | 'historical' | 'derived';
  source: string;
  title: string;
  body?: string;
  pos?: Geo;
  url?: string;
  channel?: string;
  refs?: string[];
  decision?: 'needed' | 'approved' | 'rejected';
}

export enum FuelClass { None = 0, Water = 1, Rock = 2, Grass = 3, Shrub = 4, TimberLitter = 5, TimberUnderstory = 6, Urban = 7, Agriculture = 8 }

/* ------------------------------------------------------------------ world entities */

export type SourceKind = 'web' | 'satellite' | 'ground-cam' | 'drone-cam' | 'social' | 'weather' | 'terrain' | 'radio' | 'fixed-cam' | 'aircraft';

export type UnitKind = 'drone' | 'engine' | 'crew' | 'dozer' | 'helo' | 'tanker' | 'ems' | 'law';
export interface Unit {
  id: string;
  callsign: string; // "HAWK-3", "E-41", "CREW-7", "M-12" (ambulance)
  kind: UnitKind;
  pos: Geo; // alt meters AGL for aircraft/drones
  heading: number; // deg true
  speedMps: number;
  status: 'active' | 'enroute' | 'standby' | 'rtb' | 'tasked';
  division?: 'A' | 'Z' | 'AIR' | 'EMS';
  battery?: number; water?: number; // 0..1
  taskId?: string; // current action id
  route?: Geo[];
  trail: Geo[];
}

export type FindingKind = 'human' | 'animal' | 'structure' | 'combustible' | 'fuel' | 'spot' | 'water' | 'road-block' | 'smoke' | 'vehicle';
export interface Finding {
  id: string;
  kind: FindingKind;
  label: string; // "2 HIKERS · CAPPS CROSSING TRAIL"
  detail: string;
  pos: Geo;
  uncertaintyM: number;
  confidence: number; // 0..1
  live: boolean; // confirmed by a live feed right now
  observedAt: Ms;
  halfLifeS: number;
  freshness: number; // 0..1 (brain computes)
  sourceIds: string[];
  /** Box in a feed's frame (normalized 0..1) for detection overlays. */
  bbox?: { feedId: string; x: number; y: number; w: number; h: number };
  count?: number;
}

export interface Projection {
  rev: number;
  issuedAt: Ms;
  bands: { horizonMin: 60 | 180 | 360; polygon: Geo[]; confidence: number }[];
  headDirDeg: number;
  rosMpm: number;
  drivers: string[]; // ["Wind 240° 38 kph gusts 55", "Shrub on 30% south aspects"]
  /** Previous revision's bands, for the "ghost" comparison when re-projected. */
  previous?: Projection['bands'];
  /** Time the head reaches named places, e.g. { 'grizzly-flats': ms }. */
  etaToPlaces: Record<string, Ms>;
}

/* ------------------------------------------------------------------ feeds (simulated live cameras) */

export type FeedKind = 'uav-nadir' | 'uav-oblique' | 'uav-chase' | 'dash-cam' | 'helmet-cam' | 'ridge-cam' | 'satellite' | 'social';
export type FeedFx = 'eo' | 'ir-ironbow' | 'ir-whitehot' | 'night' | 'phone' | 'sat';
export interface Feed {
  id: string; // "feed-hawk-3"
  unitId?: string;
  kind: FeedKind;
  fx: FeedFx;
  label: string; // "HAWK-3 · EO/IR GIMBAL"
  live: boolean;
  /** Explicit unavailable sensor state; do not substitute archive or generated frames. */
  offlineReason?: string;
  /** Camera pose source: follows unit, fixed pose, or orbit target. */
  pose: { mode: 'unit' | 'fixed' | 'orbit'; pos?: Geo; target?: Geo; headingDeg?: number; pitchDeg?: number; fovDeg?: number; rangeM?: number };
  /** Orchestrator relevance 0..100 (orders the feed strip; top feed is enlarged). */
  relevance: number;
  findingIds: string[]; // detections currently in view
  /** Source channel, independent of the display-only fx palette. */
  modality?: 'thermal' | 'eo';
  sourceKind?: 'simulated' | 'uploaded' | 'live';
  synthetic?: boolean;
  radiometric?: boolean | 'unknown';
  calibration?: null;
}

/* ------------------------------------------------------------------ the Orchestrator attention model */

/** Every score term, exposed in the "Why am I seeing this?" popover. All 0..1 except where noted. */
export interface ScoreFactors {
  severity: number; // life(human) 1.0, animal .85, explosive/combustible .75, structure .6, fuel .4, info .15
  exposure: number; // from minutes-to-impact via projection: <30m 1.0 … >6h .1
  confidence: number; // model confidence × source reliability
  freshness: number;
  corroboration: number; // 0..10 points (independent sources)
  actionability: number; // 0..10 points (a concrete action is available)
  novelty: number; // 0..8 points (changed since user last saw it)
  fatigue: number; // 0..15 points subtracted (already seen / dismissed)
  lens: number; // role-lens multiplier 0.5..1.3
}

/** Screen zones = the attention budget. */
export type Zone = 'Z0_INTERRUPT' | 'Z1_STAGE' | 'Z2_DECISION' | 'Z3_FOCUS' | 'Z4_AMBIENT' | 'Z5_LEDGER';
export const ZONE_CAPACITY: Record<Zone, number> = { Z0_INTERRUPT: 1, Z1_STAGE: 1, Z2_DECISION: 3, Z3_FOCUS: 3, Z4_AMBIENT: 40, Z5_LEDGER: Infinity };

export type ItemKind = 'finding' | 'projection' | 'action' | 'status' | 'bundle';
export interface GradedItem {
  id: string; // stable, == finding/action id or bundle id
  kind: ItemKind;
  refId: string;
  cls: 'life' | 'hazard' | 'fuel' | 'movement' | 'projection' | 'status';
  title: string;
  body: string;
  score: number; // 0..100 final
  factors: ScoreFactors;
  zone: Zone;
  prevZone?: Zone;
  /** Plain-language explanation of the placement: "Life · in +1H band (ETA 42 min) · conf 0.91 · 2 sources". */
  reason: string;
  pos?: Geo;
  bundleOf?: string[]; // member item ids if kind === 'bundle'
  audiences: Audience[];
  seen: boolean;
  dismissed: boolean;
  pinned: boolean;
  updatedAt: Ms;
}
export type Audience = 'ic' | 'ops' | 'air' | 'ems' | 'law' | 'public';
export type RoleLens = 'ic' | 'ops' | 'air' | 'ems';
export type Autonomy = 'advise' | 'assist' | 'act';

/** The Orchestrator rearranges the screen with typed directives. With holdLayout=true they become suggestions. */
export type Directive = DirectiveBody & {
  /** True when Hold layout turned this Orchestrator directive into a suggestion; renderers must not act on it. */
  suggested?: boolean;
};
type DirectiveBody =
  | { id: string; kind: 'focusStage'; at: Ms; reason: string; itemId?: string; target: Geo; rangeM?: number; headingDeg?: number; pitchDeg?: number }
  | { id: string; kind: 'promoteFeed'; at: Ms; reason: string; itemId?: string; feedId: string }
  | { id: string; kind: 'restoreStage'; at: Ms; reason: string }
  | { id: string; kind: 'openPanel'; at: Ms; reason: string; panel: 'agents' | 'ledger' | 'drafts' | 'timeline' | 'feeds' }
  | { id: string; kind: 'highlight'; at: Ms; reason: string; itemId: string; ids: string[] }
  | { id: string; kind: 'dimOthers'; at: Ms; reason: string; itemId: string; on: boolean }
  | { id: string; kind: 'requestDecision'; at: Ms; reason: string; actionId: string }
  | { id: string; kind: 'notify'; at: Ms; reason: string; audiences: Audience[]; message: string; itemId?: string };

/* ------------------------------------------------------------------ actions & drafts */

export type ActionKind = 'retask-drone' | 'move-group' | 'evac-notice' | 'radio-script' | 'sitrep' | 'resource-order' | 'rescue' | 'reproject';
export interface Draft {
  format: 'evac-notice' | 'radio' | 'ics209' | 'order' | 'rescue';
  title: string;
  /** Rendered document body (plain text with line breaks). Editable in UI. */
  body: string;
  fields: { label: string; value: string }[];
}
export interface Action {
  id: string;
  kind: ActionKind;
  title: string; // "Evacuation ORDER · Zone EDC-GF-1 (Grizzly Flats)"
  summary: string;
  risk: 'low' | 'high'; // low may auto-execute in Act autonomy
  requiresApproval: boolean;
  status: 'proposed' | 'approved' | 'executing' | 'done' | 'rejected' | 'undone';
  proposedAt: Ms;
  decidedBy?: 'user' | 'orchestrator';
  audiences: Audience[];
  unitIds: string[];
  route?: Geo[];
  target?: Geo;
  window?: { startMin: number; endMin: number };
  safetyZone?: { center: Geo; radiusM: number; label: string };
  trigger?: string;
  draft?: Draft;
  itemId?: string;
}

/* ------------------------------------------------------------------ agents & ledger */

export interface AgentPool {
  id: string; // "pool-video"
  role: 'analysis' | 'projection' | 'orchestrator' | 'ingest';
  source?: SourceKind;
  label: string; // "Video understanding"
  provider: string; // "fal", "treq", "firecrawl", "boxd", "nasa-firms", "nasa-gibs", "open-meteo", "nws"
  model: string; // "fal-ai/video-understanding", "treq · reasoning-large"
  workers: number; maxWorkers: number; queue: number;
  throughputPerMin: number; p50LatencyS: number;
}
export interface AgentJob {
  id: string; poolId: string; source: SourceKind; agent: string; // "VISION-07"
  input: string; model: string; provider: string;
  status: 'queued' | 'running' | 'done';
  queuedAt: Ms; startedAt?: Ms; finishedAt?: Ms;
  findingIds: string[];
}
/** "Useful work" counters for the judges. */
export interface Ledger {
  footageReviewedS: number;
  imagesAnalyzed: number;
  articlesRead: number;
  postsScreened: number;
  satellitePasses: number;
  radioMinutesTranscribed: number;
  projectionsRun: number;
  droneTasksIssued: number;
  draftsWritten: number;
  notificationsRelayed: number;
  /** Estimated analyst minutes saved (sum of per-task human-equivalent minus agent time). */
  analystMinutesSaved: number;
  entries: { id: string; at: Ms; agent: string; text: string; minutesSaved: number }[]; // newest first, capped
}

/* ------------------------------------------------------------------ conversation & brief */

export interface Message { id: string; at: Ms; role: 'orchestrator' | 'user'; text: string; refs?: string[]; thinking?: boolean }
export interface Brief { headline: string; bullets: string[]; changed: string[]; at: Ms }

/* ------------------------------------------------------------------ event bus (the backend seam) */

export type BusEvent =
  | { type: 'source.ingested'; at: Ms; source: { id: string; kind: SourceKind; label: string; title: string; summary: string; pos?: Geo; uncertaintyM?: number; feedId?: string; url?: string } }
  | { type: 'analysis.job'; at: Ms; job: AgentJob }
  | { type: 'analysis.finding'; at: Ms; finding: Finding }
  | { type: 'projection.updated'; at: Ms; projection: Projection }
  | { type: 'orchestrator.graded'; at: Ms; item: GradedItem }
  | { type: 'ui.directive'; at: Ms; directive: Directive }
  | { type: 'action.proposed'; at: Ms; action: Action }
  | { type: 'action.decided'; at: Ms; actionId: string; status: Action['status']; by: 'user' | 'orchestrator' }
  | { type: 'brief.updated'; at: Ms; brief: Brief }
  | { type: 'message'; at: Ms; message: Message }
  | { type: 'ledger.entry'; at: Ms; entry: Ledger['entries'][number] }
  | { type: 'prediction.scored'; at: Ms; check: PredictionCheck }
  | { type: 'sensor.reading'; at: Ms; reading: SensorSample }
  | { type: 'sensor.triggered'; at: Ms; reading: SensorSample; threshold: string; entry?: ChronicleRecord };

/* ------------------------------------------------------------------ console state (store) */

export interface DirectorState {
  enabled: boolean;
  beat: number; // index into beats
  beats: { id: string; at: number /* seconds into demo */; title: string; caption: string }[];
  elapsedS: number;
  captions: boolean;
}

/**
 * Projection overlap against the replay reconstruction, with separate sourced checkpoint timing.
 * The model may seed from arrivals at/before issue time, never future fire arrivals.
 */
export interface PredictionCheck {
  id: string;
  /** When the projection was issued (scenario time). */
  issuedAt: Ms;
  horizonMin: number;
  /** issuedAt + horizon; scored once clock.t >= targetT. */
  targetT: Ms;
  status: 'pending' | 'scored';
  /** Intersection-over-union of projected vs replay-reconstructed burned area at targetT, 0..1. */
  iou?: number;
  areaPredHa: number;
  areaActualHa?: number; // legacy field name: replay reconstruction area, not independently observed truth
  /** Per documented checkpoint: projected arrival vs documented time. */
  checkpoints: { id: string; label: string; documentedT: Ms; predictedT?: Ms; errorMin?: number }[];
  method: string; // e.g. "Huygens wavelet spread on DEM + fuel + hourly wind; no tuning to this fire"
}

export type ReconPattern = 'circle' | 'square' | 'line' | 'hover';
export interface DroneStation { id: string; name: string; pos: Geo }
export interface ReconDrone {
  unitId: string;
  stationId: string;
  phase: 'docked' | 'launching' | 'enroute' | 'observing' | 'returning' | 'landing' | 'charging';
  changedAt: Ms;
  sorties: number;
}
export interface ReconTask {
  id: string;
  unitId: string;
  cellId: string;
  target: Geo;
  label: string;
  reason: string;
  assignedAt: Ms;
  observedAt?: Ms;
  pattern?: ReconPattern;
  sourceIds?: string[];
  status: 'enroute' | 'observing' | 'complete' | 'superseded';
}

export interface ReconEvent extends ChronicleRecord {
  kind: 'fleet' | 'projection' | 'detection';
  /** A low-risk drone movement command, also shown as an agent notification. */
  tasking?: boolean;
}

export interface ConsoleState {
  ready: boolean;
  pack: ScenarioPack | null;
  clock: { t: Ms; speed: number; paused: boolean };
  units: Unit[];
  findings: Finding[];
  feeds: Feed[];
  projection: Projection | null;
  items: GradedItem[]; // all graded items, sorted by score desc
  actions: Action[]; // newest first
  pools: AgentPool[];
  jobs: AgentJob[]; // newest first, capped ~80
  ledger: Ledger;
  messages: Message[]; // oldest first
  brief: Brief;
  suggestions: string[];
  directives: Directive[]; // newest first, capped; UI consumes the latest
  stage: { mode: 'globe' | 'feed'; feedId?: string; dimmed: boolean; highlight: string[] };
  coverage: { id: string; polygon: Geo[]; interest: number; unitId?: string }[];
  settings: { autonomy: Autonomy; lens: RoleLens; holdLayout: boolean; tokens: { cesium: boolean; google: boolean } };
  director: DirectorState;
  /** Bumps when fire state should be re-rendered (time crossed a raster step). */
  fireRev: number;
  /** Active replay pack. */
  scenarioId?: ScenarioId;
  /** Newest first. */
  predictions?: PredictionCheck[];
  /** FIREYE-only simulated reconnaissance. No dispatch or approval actions. */
  recon?: { tasks: ReconTask[]; events: ReconEvent[]; stations?: DroneStation[]; drones?: ReconDrone[] };
}

/** Actions exposed by the store hook. */
export interface ConsoleApi {
  setPaused(p: boolean): void;
  setSpeed(x: number): void;
  seek(t: Ms): void;
  setAutonomy(a: Autonomy): void;
  setLens(l: RoleLens): void;
  setHoldLayout(h: boolean): void;
  approve(actionId: string): void;
  reject(actionId: string): void;
  undo(actionId: string): void;
  editDraft(actionId: string, body: string): void;
  ask(text: string): void;
  dismiss(itemId: string): void;
  pin(itemId: string): void;
  markSeen(itemId: string): void;
  acknowledge(itemId: string): void;
  promoteFeed(feedId: string | null): void;
  focus(target: Geo, rangeM?: number): void;
  applyDirective(id: string): void; // when holdLayout turns directives into suggestions
  director: { start(): void; stop(): void; next(): void; prev(): void; goto(i: number): void; setCaptions(on: boolean): void };
}
