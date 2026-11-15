/**
 * REV B intel layer: located observations from every input modality, the job
 * stream that produces them, drone coverage network and camera feeds.
 * Non-live findings (web, social, satellite, radio) carry an approximate
 * position and fade with age; drones and dash cams confirm them.
 */
import {
  CellState, Fuel, GRID_H, GRID_W,
  type CameraFeed, type CoverageCell, type Observation, type ObservationKind, type SourceKind, type Unit, type Vec,
} from './types';
import { bandIndex, clamp, dist, downwind, type BHost } from './hostB';
import { gridRef } from './terrain';
import { AGENT_TIME_SCALE } from './pipeline';

export const COVER_COLS = 12;
export const COVER_ROWS = 8;
const CW = GRID_W / COVER_COLS;
const CH = GRID_H / COVER_ROWS;

/** Lawnmower waypoints inside a coverage cell (cell units). */
export function sweepPath(c: { x: number; y: number; w: number; h: number }, lane = 3.5): Vec[] {
  const m = 1.6;
  const x0 = c.x + m, x1 = c.x + c.w - m, y0 = c.y + m, y1 = c.y + c.h - m;
  const pts: Vec[] = [];
  let k = 0;
  for (let y = y0; y <= y1 + 0.01; y += lane, k++) {
    if (k % 2 === 0) { pts.push({ x: x0, y }); pts.push({ x: x1, y }); }
    else { pts.push({ x: x1, y }); pts.push({ x: x0, y }); }
  }
  return pts;
}

/** Default half-life (sim s) per source for findings that are not currently in view. */
export const HALF_LIFE: Record<SourceKind, number> = {
  web: 1200, social: 900, satellite: 2400, radio: 900, terrain: 14400, weather: 1800, 'ground-cam': 1800, 'drone-cam': 1800,
};
const lcFirst = (s: string) => (s.length > 1 && /[a-z]/.test(s[1]) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const NON_LIVE: SourceKind[] = ['web', 'social', 'satellite', 'radio', 'terrain', 'weather'];

export interface IntelEvents {
  onNew(id: string): void;
  onConfirm(id: string, by: string, prevUncM: number): void;
  onResolve(id: string, note: string): void;
  onExpire(id: string): void;
  onLog(title: string, body: string): void;
}

export interface ObsMeta {
  key: string;
  noun: string;
  place: string;
  truePos: Vec;
  group?: string;
  firstSource: SourceKind;
  firstSourceLabel: string;
  confirmedBy?: string;
  confirmedAt?: number;
  wildlife?: boolean;
}

interface CatalogItem {
  key: string;
  kind: ObservationKind;
  at: number;
  seed?: boolean;
  source: SourceKind;
  sourceLabel: string;
  input: string;
  pos: Vec | ((h: BHost) => Vec | null);
  label: string | ((h: BHost, p: Vec) => string);
  noun: string;
  place: string | ((p: Vec) => string);
  conf: number;
  uncM: number;
  count?: number;
  sensitivity?: Observation['sensitivity'];
  halfLifeS?: number;
  group?: string;
  walkOut?: boolean;
  wildlife?: boolean;
  resolveAt?: number;
  resolveNote?: string;
}

const CATALOG: CatalogItem[] = [
  { key: 'chaparral', kind: 'fuel', sensitivity: 'increased', at: 0, seed: true, source: 'satellite', sourceLabel: 'Sentinel-2 L2A · NDMI',
    input: 'Sentinel-2 L2A · tile 10SFH · NDMI fuel moisture',
    pos: (h) => h.findCell(downwind(h.state, h.fire().head, 18), 14, (i) => h.state.grid.fuel[i] === Fuel.Brush && h.state.grid.dryness[i] > 0.6 && h.state.grid.state[i] === CellState.Unburnt),
    label: (h, p) => `DRY CHAPARRAL · ${Math.round(h.state.grid.dryness[Math.floor(p.y) * GRID_W + Math.floor(p.x)] * 100)}% DRY`,
    noun: 'A cured chaparral bed', place: (p) => `GRID ${gridRef(p)}`, conf: 0.82, uncM: 300 },
  { key: 'reservoir', kind: 'water', sensitivity: 'decreased', at: 0, seed: true, source: 'terrain', sourceLabel: 'USGS 3DEP · NHD',
    input: 'USGS 3DEP · NHD hydrography', pos: { x: 58, y: 125.5 }, label: 'CEDAR RESERVOIR · DIP SITE',
    noun: 'Cedar Reservoir', place: 'the dip site', conf: 0.98, uncM: 60, halfLifeS: 28800 },
  { key: 'town', kind: 'structure', at: 0, seed: true, source: 'web', sourceLabel: 'County parcel data',
    input: 'Firecrawl · El Dorado County parcel viewer', pos: { x: 168, y: 52 }, label: 'PINE HOLLOW · SW BLOCK',
    noun: 'The Pine Hollow SW block', place: 'Pine Hollow', conf: 0.95, uncM: 150, halfLifeS: 14400 },
  { key: 'vehicles', kind: 'combustible', at: 1300, source: 'web', sourceLabel: 'CHP incident log',
    input: 'Firecrawl · CHP CAD "2 vehicles abandoned on FS 12N"', pos: { x: 100.8, y: 70.5 }, label: '2 ABANDONED VEHICLES · FS 12N',
    noun: '2 abandoned vehicles', place: 'FS 12N', conf: 0.7, uncM: 220 },
  { key: 'hikers', kind: 'human', count: 2, at: 1450, source: 'social', sourceLabel: 'TikTok video · @sierra.trails',
    input: 'TikTok · "smoke right behind us at Hollow trailhead" · 0:34', pos: { x: 127.8, y: 56.4 }, label: '2 HIKERS · HOLLOW TRAILHEAD',
    noun: '2 hikers', place: 'Hollow Trailhead', conf: 0.66, uncM: 380, walkOut: true, group: 'trailhead' },
  { key: 'orchard', kind: 'fuel', sensitivity: 'decreased', at: 2000, source: 'satellite', sourceLabel: 'Sentinel-2 L2A · NDVI',
    input: 'Sentinel-2 L2A · tile 10SFH · NDVI', pos: { x: 141, y: 71 }, label: 'IRRIGATED ORCHARD · LOW RISK',
    noun: 'An irrigated walnut orchard', place: 'east of Miller Farm', conf: 0.85, uncM: 200, halfLifeS: 3600 },
  { key: 'propane', kind: 'combustible', at: 2150, source: 'web', sourceLabel: 'County hazmat registry',
    input: 'Firecrawl · county CUPA hazmat registry · Miller Farm', pos: { x: 121.5, y: 66.5 }, label: 'PROPANE · 2×1000 GAL',
    noun: '2×1000 gal propane tanks', place: 'Miller Farm', conf: 0.82, uncM: 150, halfLifeS: 2400 },
  { key: 'horses', kind: 'animal', count: 14, at: 2600, source: 'social', sourceLabel: 'Facebook video · Oak Ranch',
    input: 'Facebook · "horses still in the corral at Oak Ranch" · 1:12', pos: { x: 106.5, y: 97.5 }, label: '14 HORSES · OAK RANCH',
    noun: '14 horses', place: 'the Oak Ranch corral', conf: 0.66, uncM: 300, group: 'ranch',
    resolveAt: 9600, resolveNote: 'CHP escorted the Oak Ranch horses out via HWY 49.' },
  { key: 'ridge-res', kind: 'human', count: 4, at: 2650, source: 'radio', sourceLabel: 'E-17 · CMD NET',
    input: 'CMD NET · E-17 "four residents refusing to leave, lower Ridge Rd"', pos: { x: 166.8, y: 62.6 }, label: '4 RESIDENTS · RIDGE RD',
    noun: '4 residents', place: 'lower Ridge Rd', conf: 0.64, uncM: 250, group: 'ridge',
    resolveAt: 8400, resolveNote: 'Sheriff confirms the 4 Ridge Rd residents evacuated to Cedar Valley HS.' },
  { key: 'ridge-struct', kind: 'structure', at: 2850, source: 'web', sourceLabel: 'County parcel data',
    input: 'Firecrawl · parcel viewer · lower Ridge Rd', pos: { x: 164.5, y: 65.5 }, label: 'RIDGE RD · 6 STRUCT',
    noun: '6 structures', place: 'lower Ridge Rd', conf: 0.9, uncM: 150, halfLifeS: 7200 },
  { key: 'deer', kind: 'animal', count: 12, wildlife: true, at: 3000, source: 'drone-cam', sourceLabel: 'drone EO',
    input: 'clip · wildlife movement', pos: { x: 138, y: 47 }, label: 'DEER HERD · ~12',
    noun: 'A deer herd (~12)', place: 'north of Hollow Trail', conf: 0.78, uncM: 40 },
  { key: 'depot', kind: 'combustible', at: 3300, source: 'satellite', sourceLabel: 'Sentinel-2 L2A',
    input: 'Sentinel-2 L2A · tank farm detection', pos: { x: 161.5, y: 74.5 }, label: 'FUEL DEPOT · 12K GAL',
    noun: 'A 12,000 gal diesel depot', place: 'HWY 49 at Ridge Rd', conf: 0.74, uncM: 250, halfLifeS: 3600 },
  { key: 'resident', kind: 'human', count: 1, at: 3700, source: 'web', sourceLabel: 'KCRA 3 article',
    input: 'Firecrawl · KCRA 3 "Oak Ranch owner staying to defend horses"', pos: { x: 104.8, y: 96.4 }, label: 'RESIDENT · OAK RANCH',
    noun: '1 resident', place: 'Oak Ranch', conf: 0.7, uncM: 260, group: 'ranch',
    resolveAt: 9600, resolveNote: 'CHP confirms the Oak Ranch resident left via HWY 49.' },
  { key: 'roadblock', kind: 'road-block', at: 4600, source: 'ground-cam', sourceLabel: 'dash cam',
    input: 'clip · obstruction on roadway', pos: { x: 84, y: 106.4 }, label: 'POWER LINE DOWN · HWY 49',
    noun: 'A downed power line', place: 'HWY 49 west of FS 12N', conf: 0.88, uncM: 30 },
  { key: 'cattle', kind: 'animal', count: 40, at: 5200, source: 'web', sourceLabel: 'Ranchers Assn. post',
    input: 'Firecrawl · El Dorado Ranchers Assn. "cattle on HWY 49 pasture"', pos: { x: 150, y: 83 }, label: '~40 CATTLE · HWY 49',
    noun: 'About 40 cattle', place: 'the HWY 49 pasture', conf: 0.55, uncM: 600 },
];

const SOCIAL_NOISE = [
  'Instagram · "huge column from Cedar Valley"', 'X · "ash falling in Pine Hollow"', 'TikTok · "drive on HWY 49 right now"',
  'YouTube Short · "Hollow Fire from the ridge"', 'X · "planes dropping on the fire"', 'Instagram · "sunset is orange"',
  'Facebook · "anyone know if Ridge Rd is closed?"', 'TikTok · "evac traffic in Pine Hollow"',
];
const WEB_NOISE = [
  'Firecrawl · "Hollow Fire" news search', 'Firecrawl · CAL FIRE incident page', 'Firecrawl · county OES alerts',
  'Firecrawl · KCRA 3 live blog', 'Firecrawl · Sac Bee incident coverage', 'Firecrawl · CHP traffic incidents',
  'Firecrawl · PG&E PSPS status', 'Firecrawl · school district closures',
];
const RADIO_NOISE = ['CMD NET', 'TAC 2', 'AIR NET', 'TAC 4'];

interface ObsRt {
  o: Observation;
  m: ObsMeta;
  lastSeen: number;
  walk?: { path: Vec[]; idx: number; startAt: number };
  resolveAt?: number;
  resolveNote?: string;
  removeAt?: number;
}

interface SocialFeed { id: string; obsId: string; capturedAt: number; heading: number; until: number }

export interface Intel {
  seed(): void;
  reset(): void;
  /** Called per sim step (10 sim s). */
  update(): void;
  /** Called in small sim sub-steps; generates the job stream. */
  arrivals(simDt: number): void;
  reportSpot(p: Vec, sourceLabel: string): void;
  emberSpot(p: Vec): void;
  meta(id: string): ObsMeta | undefined;
  rt(id: string): { lastSeen: number } | undefined;
  assignment(droneId: string): CoverageCell | undefined;
  resolveGroup(group: string, note: string): void;
  buildFeeds(): CameraFeed[];
  readonly activeCount: number;
}

export function createIntel(h: BHost, ev: IntelEvents): Intel {
  const obs = new Map<string, ObsRt>();
  const discovered = new Set<string>();
  const pendingSpots: { p: Vec; at: number }[] = [];
  let lastSpotObsT = -1e9;
  const assign = new Map<string, string>(); // droneId -> cellId
  const cells: CoverageCell[] = [];
  const detections = new Map<string, number[]>();
  let social: SocialFeed[] = [];
  let lastCoverT = -1e9;
  // Arrival clocks (agent seconds).
  const next = new Map<string, number>();
  let agentT = 0;
  let satPass = 0;

  const t = () => h.state.t;

  function initCells() {
    cells.length = 0;
    let k = 0;
    for (let r = 0; r < COVER_ROWS; r++) for (let c = 0; c < COVER_COLS; c++) {
      k++;
      cells.push({ id: `C-${String(k).padStart(2, '0')}`, x: c * CW, y: r * CH, w: CW, h: CH, interest: 0, lastSweptAt: -1 });
    }
  }

  function bump(unitId: string) {
    const a = detections.get(unitId) ?? [];
    a.push(t());
    detections.set(unitId, a.filter((x) => x > t() - 1800));
  }

  function publish() {
    const list: Observation[] = [];
    for (const r of obs.values()) list.push(r.o);
    h.state.observations = list;
    h.markDirty();
  }

  function create(item: CatalogItem, opts: { source?: SourceKind; sourceLabel?: string; observedAt?: number; live?: boolean } = {}): string | null {
    const p = typeof item.pos === 'function' ? item.pos(h) : item.pos;
    if (!p) return null;
    const id = `obs-${item.key}`;
    const source = opts.source ?? item.source;
    const nonLive = NON_LIVE.includes(source);
    const unc = nonLive ? item.uncM : Math.min(item.uncM, 40);
    // Approximate fix: offset inside the uncertainty ring.
    const a = h.rand() * Math.PI * 2, rr = nonLive ? (unc / 40) * (0.25 + h.rand() * 0.45) : 0;
    const pos = { x: clamp(p.x + Math.cos(a) * rr, 1, GRID_W - 1), y: clamp(p.y + Math.sin(a) * rr, 1, GRID_H - 1) };
    const observedAt = opts.observedAt ?? t();
    const hl = item.halfLifeS ?? HALF_LIFE[source];
    const o: Observation = {
      id, kind: item.kind, pos, uncertaintyM: unc, observedAt, live: false, source, sourceLabel: opts.sourceLabel ?? item.sourceLabel,
      label: typeof item.label === 'function' ? item.label(h, p) : item.label, confidence: item.conf,
      freshness: 0.5 ** (Math.max(0, t() - observedAt) / hl), halfLifeS: hl, count: item.count, sources: 1, confirmed: !nonLive,
      sensitivity: item.sensitivity,
    };
    const m: ObsMeta = {
      key: item.key, noun: item.noun, place: typeof item.place === 'function' ? item.place(p) : item.place, truePos: { ...p },
      group: item.group, firstSource: source, firstSourceLabel: o.sourceLabel, wildlife: item.wildlife,
    };
    if (!nonLive) { m.confirmedBy = o.sourceLabel.split(' ')[0]; m.confirmedAt = t(); }
    const rt: ObsRt = { o, m, lastSeen: observedAt, resolveAt: item.resolveAt, resolveNote: item.resolveNote };
    obs.set(id, rt);
    discovered.add(item.key);
    if (item.walkOut) {
      const trail = h.world.roads.find((r) => r.id === 'trail')?.points ?? [];
      rt.walk = { path: trail.slice().reverse(), idx: 0, startAt: Infinity };
    }
    publish();
    ev.onNew(id);
    return id;
  }

  function burnedOver(p: Vec) {
    const g = h.state.grid;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy;
      if (x >= 0 && y >= 0 && x < g.w && y < g.h && g.state[y * g.w + x] !== CellState.Unburnt) n++;
    }
    return n >= 3;
  }

  function patch(r: ObsRt, p: Partial<Observation>) {
    r.o = { ...r.o, ...p };
  }

  function confirm(r: ObsRt, u: Unit) {
    if (r.o.confirmed || r.o.resolved) return false;
    const prev = r.o.uncertaintyM;
    const cam = u.kind === 'drone' ? `${u.callsign} ${u.sensor ?? 'EO/IR'}` : `${u.callsign} dash cam`;
    r.m.confirmedBy = u.callsign;
    r.m.confirmedAt = t();
    r.lastSeen = t();
    patch(r, {
      pos: { ...r.m.truePos }, uncertaintyM: 20, live: true, confirmed: true, freshness: 1, observedAt: t(),
      source: u.kind === 'drone' ? 'drone-cam' : 'ground-cam', sourceLabel: cam,
      confidence: Math.max(r.o.confidence, 0.9 + h.rand() * 0.06), sources: (r.o.sources ?? 1) + 1, halfLifeS: HALF_LIFE['drone-cam'],
    });
    if (r.walk && r.walk.startAt === Infinity) r.walk.startAt = t() + 240;
    bump(u.id);
    ev.onConfirm(r.o.id, u.callsign, prev);
    return true;
  }

  function resolve(r: ObsRt, note: string) {
    if (r.o.resolved) return;
    patch(r, { resolved: true, live: false });
    r.removeAt = t() + 300;
    ev.onResolve(r.o.id, note);
  }

  function nearestUnitOf(kind: Unit['kind'][], p: Vec) {
    let best: Unit | undefined, bd = Infinity;
    for (const u of h.state.units) {
      if (!kind.includes(u.kind)) continue;
      const d = dist(u.pos, p);
      if (d < bd) { bd = d; best = u; }
    }
    return { u: best, d: bd };
  }

  /** Discover the next due catalog item from `source`. Live sources require proximity (or a lapsed fallback). */
  function discover(source: SourceKind, by?: Unit): string | null {
    for (const it of CATALOG) {
      if (it.seed || discovered.has(it.key) || it.source !== source || it.at > t()) continue;
      if (source === 'drone-cam' || source === 'ground-cam') {
        const p = typeof it.pos === 'function' ? null : it.pos;
        if (!p) continue;
        const near = by && dist(by.pos, p) < 14;
        if (!near && t() < it.at + 900) continue;
        const u = near ? by! : nearestUnitOf(source === 'drone-cam' ? ['drone'] : ['engine', 'dozer'], p).u;
        if (!u) continue;
        const label = source === 'drone-cam' ? `${u.callsign} ${u.sensor ?? 'EO/IR'}` : `${u.callsign} dash cam`;
        bump(u.id);
        return create(it, { sourceLabel: label });
      }
      return create(it);
    }
    return null;
  }

  function rereport(source: SourceKind): string | null {
    const cands = [...obs.values()].filter((r) => !r.o.resolved && !r.o.confirmed && r.m.firstSource === source && t() - r.lastSeen > 240);
    if (!cands.length) return null;
    const r = cands[Math.floor(h.rand() * cands.length)];
    r.lastSeen = t();
    const unc = Math.max(110, Math.round(r.o.uncertaintyM * 0.85));
    // Pull the approximate fix toward the true position as reports accumulate.
    const pos = { x: r.o.pos.x + (r.m.truePos.x - r.o.pos.x) * 0.3, y: r.o.pos.y + (r.m.truePos.y - r.o.pos.y) * 0.3 };
    patch(r, { observedAt: t(), freshness: 1, uncertaintyM: unc, pos, sources: (r.o.sources ?? 1) + 1, confidence: Math.min(0.88, r.o.confidence + 0.04) });
    return r.o.id;
  }

  function spotFromPending(sourceLabel: string): string | null {
    while (pendingSpots.length) {
      const s = pendingSpots.shift()!;
      const i = Math.floor(s.p.y) * GRID_W + Math.floor(s.p.x);
      if (h.state.grid.state[i] !== CellState.Burning) continue;
      return addSpot(s.p, sourceLabel);
    }
    return null;
  }

  function addSpot(p: Vec, sourceLabel: string): string | null {
    for (const r of obs.values()) if (r.o.kind === 'spot' && !r.o.resolved && dist(r.m.truePos, p) < 8) return null;
    const id = `obs-spot-${Math.round(t())}`;
    const live = !sourceLabel.startsWith('FIRMS');
    const it: CatalogItem = {
      key: id.slice(4), kind: 'spot', at: t(), source: live ? 'drone-cam' : 'satellite', sourceLabel, input: '', pos: p,
      label: 'SPOT FIRE', noun: 'A spot fire', place: `GRID ${gridRef(p)}`, conf: live ? 0.92 : 0.74, uncM: live ? 30 : 375, halfLifeS: 900,
    };
    lastSpotObsT = t();
    return create(it, { source: it.source, sourceLabel });
  }

  // ---------------------------------------------------------------------------
  // Job stream
  // ---------------------------------------------------------------------------
  const due = (key: string, every: [number, number]) => {
    const n = next.get(key);
    if (n === undefined) { next.set(key, agentT + h.rand() * every[1]); return false; }
    if (agentT < n) return false;
    next.set(key, agentT + every[0] + h.rand() * (every[1] - every[0]));
    return true;
  };
  const pick = <T,>(a: T[]) => a[Math.floor(h.rand() * a.length)];
  const clip = () => `${String(Math.floor(h.rand() * 2)).padStart(2, '0')}:${String(Math.floor(10 + h.rand() * 49)).padStart(2, '0')}`;

  function droneJob(u: Unit) {
    const cell = assignment(u.id);
    h.pipeline.enqueue('drone-cam', {
      input: `${u.callsign} · ${u.sensor ?? 'EO/IR'} clip ${clip()}${cell ? ` · ${cell.id} sweep` : ''}`,
      onDone: () => {
        const ids: string[] = [];
        for (const r of obs.values()) {
          if (r.o.resolved || dist(u.pos, r.m.truePos) > 7.5) continue;
          if (confirm(r, u)) ids.push(r.o.id);
        }
        const d = discover('drone-cam', u);
        if (d) ids.push(d);
        if (!ids.length && pendingSpots.length && t() - lastSpotObsT > 1500) {
          const s = spotFromPending(`${u.callsign} ${u.sensor ?? 'EO/IR'}`);
          if (s) { bump(u.id); ids.push(s); }
        }
        if (ids.length) orchJob(ids);
        return { observationIds: ids };
      },
    });
  }

  function vehicleJob(u: Unit) {
    h.pipeline.enqueue('ground-cam', {
      input: `${u.callsign} dash cam clip ${clip()}`,
      onDone: () => {
        const ids: string[] = [];
        for (const r of obs.values()) {
          if (r.o.resolved || dist(u.pos, r.m.truePos) > 5) continue;
          if (confirm(r, u)) ids.push(r.o.id);
        }
        const d = discover('ground-cam', u);
        if (d) ids.push(d);
        if (ids.length) orchJob(ids);
        return { observationIds: ids };
      },
    });
  }

  function sourceJob(source: SourceKind, input: string, chance = 0.3) {
    h.pipeline.enqueue(source, {
      input,
      onDone: () => {
        const ids: string[] = [];
        const d = discover(source);
        if (d) {
          ids.push(d);
          if (source === 'social') {
            social = [{ id: `feed-soc-${d.slice(4)}`, obsId: d, capturedAt: t() - 300 - h.rand() * 600, heading: 200 + h.rand() * 60, until: t() + 2400 }, ...social].slice(0, 2);
          }
        } else if (h.rand() < chance) {
          const rr = rereport(source);
          if (rr) ids.push(rr);
        }
        if (ids.length) {
          orchJob(ids);
          const k = obs.get(ids[0])?.o.kind;
          if (k === 'fuel' || k === 'spot' || k === 'road-block') projJob(`new ${k} finding`);
        }
        return { observationIds: ids };
      },
    });
  }

  function orchJob(ids: string[]) {
    h.pipeline.enqueue('orchestrator', { input: `Grade ${ids.length} new finding${ids.length > 1 ? 's' : ''} · route to dock / map / log` });
  }

  let lastProjAt = -1e9;
  function projJob(reason: string) {
    if (h.pipeline.queueDepth('projection') > 1 || agentT - lastProjAt < 4) return;
    lastProjAt = agentT;
    const w = h.state.wind;
    h.pipeline.enqueue('projection', {
      input: `Re-project path · ${reason} · wind ${Math.round(w.dirDeg)}° ${Math.round(w.speedKph)} kph`,
      onDone: () => { h.requestForecast(); },
    });
  }

  function arrivals(simDt: number) {
    agentT += simDt / AGENT_TIME_SCALE;
    for (const u of h.state.units) {
      if (u.kind === 'drone') {
        if (u.status !== 'standby' && due(`d-${u.id}`, [3.5, 6])) droneJob(u);
      } else if (u.kind === 'engine' || u.kind === 'dozer') {
        if (u.status !== 'standby' && due(`v-${u.id}`, [6, 10])) vehicleJob(u);
      }
    }
    if (due('social', [5, 11])) {
      // A due catalog post arrives alongside a small burst of unrelated posts.
      const dueItem = CATALOG.find((it) => it.source === 'social' && !discovered.has(it.key) && it.at <= t());
      if (dueItem) {
        sourceJob('social', dueItem.input, 0);
        const n = 2 + Math.floor(h.rand() * 3);
        for (let k = 0; k < n; k++) sourceJob('social', pick(SOCIAL_NOISE), 0);
      } else sourceJob('social', pick(SOCIAL_NOISE), 0.35);
    }
    if (due('web', [6, 12])) {
      const dueItem = CATALOG.find((it) => it.source === 'web' && !discovered.has(it.key) && it.at <= t());
      sourceJob('web', dueItem ? dueItem.input : pick(WEB_NOISE), 0.3);
    }
    if (due('goes', [9, 12])) sourceJob('satellite', `GOES-18 ABI · CONUS 5-min scan · FDC`, 0);
    if (due('pass', [55, 80])) {
      satPass++;
      const sentinel = satPass % 2 === 0;
      const tiles = 6 + Math.floor(h.rand() * 5);
      const dueItem = CATALOG.find((it) => it.source === 'satellite' && !discovered.has(it.key) && it.at <= t());
      for (let k = 1; k <= tiles; k++) {
        const input = k === 1 && dueItem ? dueItem.input
          : sentinel ? `Sentinel-2 L2A · tile ${k}/${tiles} · fuels + structures` : `NASA FIRMS · VIIRS 375 m · tile ${k}/${tiles}`;
        if (!sentinel && k === 1 && !dueItem) {
          h.pipeline.enqueue('satellite', {
            input,
            onDone: () => {
              const s = t() - lastSpotObsT > 1500 ? spotFromPending('FIRMS VIIRS 375 m') : null;
              if (s) { orchJob([s]); projJob('FIRMS hotspot'); return { observationIds: [s] }; }
              return {};
            },
          });
        } else sourceJob('satellite', input, k === 1 ? 0.6 : 0);
      }
    }
    if (due('wx', [10, 15])) {
      h.pipeline.enqueue('weather', {
        input: h.rand() > 0.5 ? 'NWS gridpoint STO/52,61 · hourly forecast' : 'RAWS PNHC1 · 10-min observation',
        onDone: () => { if (h.rand() < 0.5) projJob('weather update'); },
      });
    }
    if (due('dem', [35, 60])) h.pipeline.enqueue('terrain', { input: h.rand() > 0.5 ? 'USGS 3DEP 1/3″ DEM · slope/aspect' : 'LANDFIRE FBFM40 · fuel model refresh' });
    if (due('radio', [5, 9])) {
      const us = h.state.units.filter((u) => u.status !== 'standby');
      const u = us.length ? pick(us) : undefined;
      const dueItem = CATALOG.find((it) => it.source === 'radio' && !discovered.has(it.key) && it.at <= t());
      sourceJob('radio', dueItem ? dueItem.input : `${pick(RADIO_NOISE)} · ${u?.callsign ?? 'ATGS'} · ${clip()}`, 0);
    }
    if (due('proj', [18, 26])) projJob('periodic');
    if (due('orch', [5, 8])) h.pipeline.enqueue('orchestrator', { input: `Re-grade ${obs.size + 4} items · dock budget 4` });
  }

  // ---------------------------------------------------------------------------
  // Coverage network
  // ---------------------------------------------------------------------------
  function updateCoverage() {
    const s = h.state;
    const g = s.grid;
    const burnCount = new Float32Array(cells.length);
    for (let i = 0; i < g.w * g.h; i++) {
      if (g.state[i] !== CellState.Burning) continue;
      const cx = Math.min(COVER_COLS - 1, Math.floor((i % g.w) / CW)), cy = Math.min(COVER_ROWS - 1, Math.floor(((i / g.w) | 0) / CH));
      burnCount[cy * COVER_COLS + cx]++;
    }
    const BW = [1, 0.55, 0.25];
    cells.forEach((c, k) => {
      let band = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const b = bandIndex(s, { x: c.x + ((sx + 0.5) / 4) * c.w, y: c.y + ((sy + 0.5) / 4) * c.h });
        if (b >= 0) band += BW[b];
      }
      band = (band / 16) * 0.8;
      const center = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
      const fd = h.fireDistance(center);
      const fire = Math.min(1, burnCount[k] / 20) * 0.9 + (fd < 16 ? 0.4 * (1 - fd / 16) : 0);
      let o = 0;
      for (const r of obs.values()) {
        if (r.o.resolved) continue;
        const p = r.m.truePos;
        if (p.x < c.x || p.y < c.y || p.x >= c.x + c.w || p.y >= c.y + c.h) continue;
        const life = r.o.kind === 'human' || (r.o.kind === 'animal' && !r.m.wildlife);
        if (life) o += r.o.confirmed ? 0.3 : 0.95;
        else if (r.o.kind === 'spot') o += 0.5;
        else if (r.o.kind === 'combustible') o += r.o.confirmed ? 0.1 : 0.3;
        else o += r.o.confirmed ? 0.02 : 0.08;
      }
      const v = clamp(Math.max(band, fire) + o, 0, 1);
      c.interest = Math.round((c.interest * 0.4 + v * 0.6) * 100) / 100;
    });

    // Assign available drones to the highest-interest cells (sticky, nearest-first).
    const drones = s.units.filter((u) => u.kind === 'drone');
    const avail = drones.filter((u) => u.status !== 'standby' && u.status !== 'rtb');
    for (const u of drones) if (!avail.includes(u)) assign.delete(u.id);
    const ranked = cells.filter((c) => c.interest >= 0.12).sort((a, b) => b.interest - a.interest);
    const top = ranked.slice(0, avail.length + 2).map((c) => c.id);
    const taken = new Set<string>();
    for (const u of avail) {
      const cur = assign.get(u.id);
      if (cur && top.includes(cur) && !taken.has(cur)) taken.add(cur);
      else assign.delete(u.id);
    }
    const free = ranked.slice(0, avail.length).filter((c) => !taken.has(c.id));
    for (const u of avail) {
      if (assign.has(u.id) || !free.length) continue;
      let bi = 0, bs = -Infinity;
      free.forEach((c, i) => {
        const sc = c.interest - dist(u.pos, { x: c.x + c.w / 2, y: c.y + c.h / 2 }) * 0.004;
        if (sc > bs) { bs = sc; bi = i; }
      });
      const c = free.splice(bi, 1)[0];
      assign.set(u.id, c.id);
      taken.add(c.id);
    }
    // Swap in a much hotter unassigned cell for the weakest assignment.
    const hot = ranked.find((c) => !taken.has(c.id));
    if (hot) {
      let weakest: { u: string; c: CoverageCell } | null = null;
      for (const [uid, cid] of assign) {
        const c = cells.find((x) => x.id === cid)!;
        if (!weakest || c.interest < weakest.c.interest) weakest = { u: uid, c };
      }
      if (weakest && hot.interest > weakest.c.interest + 0.25) assign.set(weakest.u, hot.id);
    }
    for (const c of cells) c.assignedUnitId = undefined;
    for (const [uid, cid] of assign) {
      const c = cells.find((x) => x.id === cid);
      if (c) c.assignedUnitId = uid;
    }
  }

  function markSwept() {
    for (const u of h.state.units) {
      if (u.kind !== 'drone' || u.status === 'standby') continue;
      const cx = Math.floor(u.pos.x / CW), cy = Math.floor(u.pos.y / CH);
      if (cx < 0 || cy < 0 || cx >= COVER_COLS || cy >= COVER_ROWS) continue;
      cells[cy * COVER_COLS + cx].lastSweptAt = t();
    }
  }

  function assignment(droneId: string): CoverageCell | undefined {
    const id = assign.get(droneId);
    return id ? cells.find((c) => c.id === id) : undefined;
  }

  // ---------------------------------------------------------------------------
  // Per-step update: liveness, freshness, walk-outs, resolution, expiry
  // ---------------------------------------------------------------------------
  function update() {
    const now = t();
    const viewers = h.state.units.filter((u) => (u.kind === 'drone' && u.status !== 'standby' && u.status !== 'rtb') || u.kind === 'engine' || u.kind === 'dozer');
    for (const [id, r] of obs) {
      if (r.removeAt !== undefined && now >= r.removeAt) { obs.delete(id); continue; }
      if (r.o.resolved) continue;
      // Hikers walk out along Hollow Trail once located.
      if (r.walk && now >= r.walk.startAt && r.walk.idx < r.walk.path.length) {
        let step = 0.03 * 10;
        while (step > 0 && r.walk.idx < r.walk.path.length) {
          const q = r.walk.path[r.walk.idx];
          const d = dist(r.m.truePos, q);
          if (d <= step) { r.m.truePos = { ...q }; r.walk.idx++; step -= d; }
          else { r.m.truePos.x += ((q.x - r.m.truePos.x) / d) * step; r.m.truePos.y += ((q.y - r.m.truePos.y) / d) * step; step = 0; }
        }
        if (r.walk.idx >= r.walk.path.length) { resolve(r, `${r.m.noun} walked out to Pine Hollow; EMS check complete.`); continue; }
      }
      if (r.resolveAt !== undefined && now >= r.resolveAt) { resolve(r, r.resolveNote ?? `${r.m.noun} cleared.`); continue; }
      if (r.o.kind === 'spot') {
        const i = Math.floor(r.m.truePos.y) * GRID_W + Math.floor(r.m.truePos.x);
        if (h.state.grid.state[i] !== CellState.Burning) { resolve(r, `Spot at ${r.m.place} burned out or merged with the main front.`); continue; }
      } else if (r.o.kind === 'human' || r.o.kind === 'animal') {
        if (h.fireDistance(r.m.truePos) < 4) { resolve(r, `${r.m.noun} at ${r.m.place} evacuated ahead of the front; law confirms.`); continue; }
      } else if (r.o.kind !== 'water' && r.o.kind !== 'road-block' && r.o.sensitivity !== 'decreased' && burnedOver(r.m.truePos)) {
        resolve(r, r.o.kind === 'structure' ? `Front reached ${r.m.place}; engines on structure defense.` : `Front passed ${r.m.place}; ${lcFirst(r.m.noun)} burned over.`);
        continue;
      }
      let live = false;
      let seer: Unit | undefined;
      if (r.o.confirmed) {
        for (const u of viewers) {
          const R = u.kind === 'drone' ? 6.5 : 4;
          if (dist(u.pos, r.m.truePos) < R) { live = true; seer = u; break; }
        }
      }
      if (live) {
        r.lastSeen = now;
        const label = seer!.kind === 'drone' ? `${seer!.callsign} ${seer!.sensor ?? 'EO/IR'}` : `${seer!.callsign} dash cam`;
        patch(r, { live: true, freshness: 1, observedAt: now, uncertaintyM: 20, pos: { ...r.m.truePos }, sourceLabel: label, source: seer!.kind === 'drone' ? 'drone-cam' : 'ground-cam' });
      } else {
        const age = Math.max(0, now - r.lastSeen);
        const f = 0.5 ** (age / r.o.halfLifeS);
        const unc = r.o.confirmed ? Math.min(90, 20 + (age / 60) * 1.5) : r.o.uncertaintyM;
        if (f < 0.1) { obs.delete(id); ev.onExpire(id); continue; }
        patch(r, { live: false, freshness: Math.round(f * 1000) / 1000, uncertaintyM: Math.round(unc) });
      }
    }
    social = social.filter((s) => now < s.until && obs.has(s.obsId) && !obs.get(s.obsId)!.o.resolved);
    markSwept();
    if (now - lastCoverT >= 60) { lastCoverT = now; updateCoverage(); }
    h.state.coverage = cells.map((c) => ({ ...c }));
    publish();
  }

  function seed() {
    for (const it of CATALOG) if (it.seed) create(it, { observedAt: t() - 300 - h.rand() * 600 });
    initCellsAndCover();
  }

  function initCellsAndCover() {
    if (!cells.length) initCells();
    updateCoverage();
    h.state.coverage = cells.map((c) => ({ ...c }));
  }

  return {
    seed,
    reset() {
      obs.clear(); discovered.clear(); pendingSpots.length = 0; lastSpotObsT = -1e9; assign.clear(); detections.clear();
      social = []; lastCoverT = -1e9; next.clear(); agentT = 0; satPass = 0; lastProjAt = -1e9;
      initCells();
    },
    update,
    arrivals,
    reportSpot(p, label) { const id = addSpot(p, label); if (id) orchJob([id]); },
    emberSpot(p) {
      if (pendingSpots.length < 3 && h.fireDistance(p) > 0) pendingSpots.push({ p: { ...p }, at: t() });
    },
    meta: (id) => obs.get(id)?.m,
    rt: (id) => obs.get(id),
    assignment,
    resolveGroup(group, note) {
      for (const r of obs.values()) if (r.m.group === group && !r.o.resolved) resolve(r, note);
    },
    get activeCount() { let n = 0; for (const r of obs.values()) if (!r.o.resolved) n++; return n; },
    buildFeeds() {
      const now = t();
      const out: CameraFeed[] = [];
      const list = h.state.observations;
      const det = (id: string) => (detections.get(id) ?? []).filter((x) => x > now - 1800).length;
      for (const u of h.state.units) {
        if (u.kind === 'drone') {
          let focus: string | undefined, bd = 7;
          for (const o of list) { const d = dist(o.pos, u.pos); if (d < bd && !o.resolved) { bd = d; focus = o.id; } }
          out.push({ id: `feed-${u.id}`, unitId: u.id, kind: 'drone', label: `${u.callsign} · ${u.sensor ?? 'EO/IR'}`, live: u.status !== 'standby',
            pos: { ...u.pos }, heading: u.heading, detections: det(u.id), focusObservationId: focus, sensor: u.sensor });
        } else if (u.kind === 'engine' || u.kind === 'dozer') {
          let focus: string | undefined, bd = 25;
          const hr = (u.heading * Math.PI) / 180;
          for (const o of list) {
            const dx = o.pos.x - u.pos.x, dy = o.pos.y - u.pos.y, d = Math.hypot(dx, dy);
            if (d > bd || d < 0.5 || o.resolved) continue;
            const cos = (dx * Math.sin(hr) - dy * Math.cos(hr)) / d;
            if (cos > 0.77) { bd = d; focus = o.id; }
          }
          out.push({ id: `feed-${u.id}`, unitId: u.id, kind: 'vehicle', label: `${u.callsign} · DASH CAM`, live: true,
            pos: { ...u.pos }, heading: u.heading, detections: det(u.id), focusObservationId: focus, sensor: 'DASH CAM' });
        }
      }
      for (const s of social) {
        const o = obs.get(s.obsId)?.o;
        if (!o) continue;
        out.push({ id: s.id, kind: 'social', label: `SOCIAL · ${o.sourceLabel.split('·')[0].trim().toUpperCase()}`, live: false,
          pos: { ...o.pos }, heading: s.heading, detections: 1, focusObservationId: o.id, sensor: 'PHONE VIDEO', capturedAt: s.capturedAt });
      }
      return out;
    },
  };
}
