/**
 * FCC simulation engine: cellular fire spread over the procedural world, unit
 * kinematics and tasking, forecast scheduling, metrics and the mock AI agent.
 *
 * Time model: `tick(dtReal)` advances sim time by dtReal * SIM_TIME_SCALE * speed.
 * Fire spread runs at fixed STEP sim-second increments; units integrate in
 * small sub-steps. Snapshot-level arrays (ingest, insights, markers,
 * recommendations, forecast, history) are replaced on change, so React can
 * compare by reference; `grid` and `units` are mutated in place.
 */
import {
  CELL_M, CellState, Fuel, GRID_H, GRID_W,
  type IngestItem, type Insight, type Marker, type Recommendation, type SimEngine, type SimSnapshot,
  type Unit, type UnitKind, type Vec,
} from './types';
import { buildWorld, gridRef, isFlammable, mulberry32, RELIEF_M } from './terrain';
import { computeForecast, pointInPolygon } from './forecast';
import { createAgent, type AgentHost, type FireStats, type RecTask } from './agent';

/** Sim seconds per real second at speed 1x. */
export const SIM_TIME_SCALE = 30;
/** Fixed fire-spread step, sim seconds. */
const STEP = 10;
/** Initial fire age at t0 (sim seconds). */
const T0 = 900;
const EPOCH = Date.UTC(2026, 7, 14, 21, 12, 0);
const CAP = 40;
const NOTIFY_INTERVAL = 0.25;

const W = GRID_W, H = GRID_H, N = W * H;

const BASE_P = new Float32Array(8);
BASE_P[Fuel.Grass] = 0.022;
BASE_P[Fuel.Brush] = 0.02;
BASE_P[Fuel.Timber] = 0.0105;
BASE_P[Fuel.Urban] = 0.009;
const BURN_MIN = new Float32Array(8);
BURN_MIN[Fuel.Grass] = 8;
BURN_MIN[Fuel.Brush] = 16;
BURN_MIN[Fuel.Timber] = 30;
BURN_MIN[Fuel.Urban] = 34;

const NDX = [1, -1, 0, 0, 1, 1, -1, -1];
const NDY = [0, 0, 1, -1, 1, -1, 1, -1];
const NDIST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

const SPEED: Record<UnitKind, number> = { drone: 0.13, helo: 0.36, tanker: 0.62, engine: 0.085, crew: 0.022, dozer: 0.03 };
const CREW_SIZE: Record<UnitKind, number> = { drone: 1, helo: 3, tanker: 2, engine: 4, crew: 20, dozer: 2 };
const OVERHEAD = 14;

type Mode =
  | 'orbit' | 'scan' | 'work' | 'goto' | 'dip' | 'drop' | 'rtb' | 'charge' | 'standby' | 'reload'
  | 'line' | 'hover' | 'refill';

interface Task {
  recId: string;
  kind: RecTask['kind'];
  target: Vec;
  cycles: number;
  markerId?: string;
  lineA?: Vec;
  lineB?: Vec;
  phase: 'approach' | 'execute' | 'return';
  timer: number;
}

interface Brain {
  role: 'perimeter' | 'head' | 'scan' | 'town' | 'ground' | 'helo' | 'tanker' | 'dozer';
  mode: Mode;
  anchor: Vec;
  phase: number;
  orbitR: number;
  timer: number;
  workClock: number;
  trailClock: number;
  task?: Task;
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const wrap360 = (d: number) => ((d % 360) + 360) % 360;

export function createSimulation(seed = 7): SimEngine {
  const world = buildWorld(seed);
  const { grid, meta } = world;
  const burnAge = new Float32Array(N);
  /** Ignition energy accumulated from burning neighbors; a cell ignites at its threshold. */
  const ignAcc = new Float32Array(N);
  const ignThr = new Float32Array(N);
  const burning = new Int32Array(N);
  let nBurning = 0;
  let fireCells = 0;
  let rng = mulberry32(seed * 7919 + 3);

  let paused = false;
  let speed = 1;
  let stepAcc = 0;
  let notifyAcc = 0;
  let dirty = true;
  const listeners = new Set<() => void>();

  // Weather drivers (targets eased toward).
  let baseDir = 250, baseSpeed = 24, tgtDir = 250, tgtSpeed = 24;
  let humidity = 11, tgtHumidity = 11;
  let gustPhase = 0;

  // Fire statistics.
  const fire: FireStats = { head: { ...meta.ignition }, centroid: { ...meta.ignition }, burning: 0, acres: 0, rosMpm: 0, radius: 0 };
  let maxDist = 0;
  const distRing = new Float32Array(11);
  let distRingN = 0;
  let lastMinute = -1;

  // Forecast scheduling.
  let lastForecastT = -1e9;
  let lastForecastDir = baseDir;
  let forecastRequest: 'intel' | 'wind' | 'periodic' | null = null;
  let lastForecastReason: 'intel' | 'wind' | 'periodic' | 'init' = 'init';

  let lastHistoryT = -1e9;
  let lastContainT = -1e9;
  let containSmoothed = 0;
  let idCounter = 0;

  const recTasks = new Map<string, RecTask>();
  const persons = new Map<string, number>();
  const brains = new Map<string, Brain>();

  // forecastRev keeps counting across reset() so renderer caches invalidate.
  let revBase = 0;
  let state: SimSnapshot = emptySnapshot();

  function emptySnapshot(): SimSnapshot {
    return {
      t: 0,
      clock: new Date(EPOCH),
      grid,
      wind: { speedKph: baseSpeed, dirDeg: baseDir, gustKph: baseSpeed * 1.5 },
      weather: { tempC: 34, humidityPct: humidity, fuelMoisturePct: 4, redFlag: false },
      forecast: [],
      units: [],
      markers: [],
      ingest: [],
      insights: [],
      recommendations: [],
      metrics: { acres: 0, containmentPct: 0, rateOfSpreadMpm: 0, structuresThreatened: 0, personsAtRisk: 0, personnel: OVERHEAD, activeUnits: 0 },
      history: { acres: [], containment: [], ros: [] },
      forecastRev: revBase,
      world: meta,
    };
  }

  // ---------------------------------------------------------------------------
  // Fire
  // ---------------------------------------------------------------------------
  function igniteIdx(i: number): boolean {
    if (grid.state[i] !== CellState.Unburnt || !isFlammable(grid.fuel[i])) return false;
    grid.state[i] = CellState.Burning;
    grid.heat[i] = 0.3;
    burnAge[i] = 0;
    burning[nBurning++] = i;
    fireCells++;
    const d = Math.hypot((i % W) - meta.ignition.x, ((i / W) | 0) - meta.ignition.y);
    if (d > maxDist) maxDist = d;
    return true;
  }

  function windVec() {
    const to = ((state.wind.dirDeg + 180) * Math.PI) / 180;
    return { wx: Math.sin(to), wy: -Math.cos(to) };
  }

  function spreadStep() {
    const { fuel, dryness, retardant, elevation, heat } = grid;
    const st = grid.state;
    const { wx, wy } = windVec();
    const gust = state.wind.speedKph + (state.wind.gustKph - state.wind.speedKph) * rng() * rng();
    const k = 0.052 * gust;
    const wf = state.weather;
    const weatherF = (wf.redFlag ? 1.12 : 1) * clamp(1.55 - wf.humidityPct / 26, 0.45, 1.3);
    const n0 = nBurning;
    const spotP = 0.0016 * (wf.redFlag ? 1.5 : 1) * clamp(gust / 25, 0.4, 2);

    for (let b = 0; b < n0; b++) {
      const i = burning[b];
      const x = i % W, y = (i / W) | 0;
      const hv = heat[i];
      const e0 = elevation[i];
      for (let d = 0; d < 8; d++) {
        const nx = x + NDX[d], ny = y + NDY[d];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (st[j] !== CellState.Unburnt) continue;
        const base = BASE_P[fuel[j]];
        if (base === 0) continue;
        const dd = NDIST[d];
        const align = (NDX[d] * wx + NDY[d] * wy) / dd;
        const slope = ((elevation[j] - e0) * RELIEF_M) / (CELL_M * dd);
        const slopeF = clamp(Math.exp(1.5 * slope), 0.65, 2);
        const dr = dryness[j];
        const dryF = 0.2 + 1.15 * dr * Math.sqrt(dr);
        const r = 1 - retardant[j];
        const p = base * Math.exp(k * align) * slopeF * dryF * r * r * r * hv * weatherF * (dd > 1 ? 0.62 : 1);
        ignAcc[j] += p * (0.6 + rng() * 0.8);
        if (ignAcc[j] >= ignThr[j]) igniteIdx(j);
      }
      // Ember spotting from intense brush/timber cells.
      if (hv > 0.75 && (fuel[i] === Fuel.Brush || fuel[i] === Fuel.Timber) && rng() < spotP) {
        const L = 3 + rng() * 7;
        const jx = Math.round(x + wx * L + (rng() - 0.5) * 3), jy = Math.round(y + wy * L + (rng() - 0.5) * 3);
        if (jx >= 0 && jy >= 0 && jx < W && jy < H) {
          const j = jy * W + jx;
          if (retardant[j] < 0.4 && rng() < dryness[j]) igniteIdx(j);
        }
      }
    }

    // Burn-down + suppression; compact the burning list in place.
    let w = 0;
    let cx = 0, cy = 0;
    for (let b = 0; b < nBurning; b++) {
      const i = burning[b];
      const f = fuel[i];
      const age = (burnAge[i] += STEP / 60 / BURN_MIN[f]);
      let hv = age < 0.2 ? 0.3 + (0.7 * age) / 0.2 : 1 - (age - 0.2) / 0.8;
      const r = retardant[i];
      hv *= 1 - 0.8 * r;
      if (age >= 1 || hv <= 0.02) {
        st[i] = CellState.Burnt;
        heat[i] = 0;
        continue;
      }
      if (r > 0.55) {
        st[i] = CellState.Suppressed;
        heat[i] = 0;
        continue;
      }
      heat[i] = hv;
      burning[w++] = i;
      cx += i % W;
      cy += (i / W) | 0;
    }
    nBurning = w;

    // Retardant / water decays slowly (half-life ~2 h sim).
    const decay = Math.pow(0.5, STEP / 7200);
    for (let i = 0; i < N; i++) if (retardant[i] > 0) retardant[i] = retardant[i] > 0.002 ? retardant[i] * decay : 0;

    // Fire stats: centroid of active cells and head (max downwind projection).
    if (nBurning > 0) {
      cx /= nBurning; cy /= nBurning;
      fire.centroid.x = cx + 0.5; fire.centroid.y = cy + 0.5;
      let best = -Infinity, hi = burning[0];
      for (let b = 0; b < nBurning; b++) {
        const i = burning[b];
        const pr = ((i % W) - cx) * wx + (((i / W) | 0) - cy) * wy;
        if (pr > best) { best = pr; hi = i; }
      }
      fire.head.x = (hi % W) + 0.5; fire.head.y = ((hi / W) | 0) + 0.5;
    }
    fire.burning = nBurning;
    fire.acres = (fireCells * CELL_M * CELL_M) / 4046.86;
    fire.radius = Math.sqrt(fireCells / Math.PI);
    grid.version++;
  }

  function sampleRos() {
    const minute = Math.floor(state.t / 60);
    if (minute === lastMinute) return;
    lastMinute = minute;
    for (let i = distRing.length - 1; i > 0; i--) distRing[i] = distRing[i - 1];
    // Head ROS from equivalent-radius growth; an elongated wind ellipse runs ~2.2x faster at the head.
    distRing[0] = Math.sqrt(fireCells / Math.PI);
    distRingN = Math.min(distRingN + 1, distRing.length);
    const span = distRingN - 1;
    if (span > 0) {
      const raw = nBurning === 0 ? 0 : (2.2 * (distRing[0] - distRing[span]) * CELL_M) / span;
      fire.rosMpm = fire.rosMpm === 0 ? raw : fire.rosMpm * 0.7 + raw * 0.3;
    }
  }

  function fireDistance(p: Vec): number {
    let best = Infinity;
    for (let b = 0; b < nBurning; b++) {
      const i = burning[b];
      const dx = (i % W) + 0.5 - p.x, dy = ((i / W) | 0) + 0.5 - p.y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** Nearest cell (square scan) to p within R matching pred; returns cell center. */
  function scanNearest(p: Vec, R: number, pred: (i: number) => boolean, score?: (i: number, d: number) => number): Vec | null {
    const x0 = Math.max(0, Math.floor(p.x - R)), x1 = Math.min(W - 1, Math.ceil(p.x + R));
    const y0 = Math.max(0, Math.floor(p.y - R)), y1 = Math.min(H - 1, Math.ceil(p.y + R));
    let best = Infinity, bx = -1, by = -1;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (!pred(i)) continue;
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
        if (d > R) continue;
        const s = score ? score(i, d) : d;
        if (s < best) { best = s; bx = x; by = y; }
      }
    }
    return bx < 0 ? null : { x: bx + 0.5, y: by + 0.5 };
  }

  function applyRetardant(p: Vec, r: number, amount: number, knockdown = 0.5) {
    const x0 = Math.max(0, Math.floor(p.x - r)), x1 = Math.min(W - 1, Math.ceil(p.x + r));
    const y0 = Math.max(0, Math.floor(p.y - r)), y1 = Math.min(H - 1, Math.ceil(p.y + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
        if (d > r) continue;
        const i = y * W + x;
        if (grid.fuel[i] === Fuel.Water) continue;
        const a = amount * (1 - 0.35 * (d / r));
        if (grid.retardant[i] < a) grid.retardant[i] = a;
        if (grid.state[i] === CellState.Burning) grid.heat[i] *= knockdown;
      }
    }
    grid.version++;
  }

  const isFireCell = (i: number) => grid.state[i] !== CellState.Unburnt;

  function isEdgeCell(i: number, minRet: number) {
    if (grid.state[i] !== CellState.Unburnt || !isFlammable(grid.fuel[i]) || grid.retardant[i] >= minRet) return false;
    const x = i % W, y = (i / W) | 0;
    return (x > 0 && isFireCell(i - 1)) || (x < W - 1 && isFireCell(i + 1)) || (y > 0 && isFireCell(i - W)) || (y < H - 1 && isFireCell(i + W));
  }

  function burningNear(i: number) {
    const x = i % W, y = (i / W) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = x + NDX[d], ny = y + NDY[d];
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid.state[ny * W + nx] === CellState.Burning) return true;
    }
    return false;
  }

  function computeContainment() {
    let edges = 0, held = 0;
    const st = grid.state;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (st[i] !== CellState.Unburnt) continue;
        if (!((x > 0 && st[i - 1] !== 0) || (x < W - 1 && st[i + 1] !== 0) || (y > 0 && st[i - W] !== 0) || (y < H - 1 && st[i + W] !== 0))) continue;
        edges++;
        const fu = grid.fuel[i];
        if (fu === Fuel.Water || fu === Fuel.Rock || grid.retardant[i] > 0.4) held++;
      }
    }
    const raw = edges ? (held / edges) * 100 : 0;
    containSmoothed = containSmoothed === 0 ? raw : containSmoothed * 0.6 + raw * 0.4;
  }

  // ---------------------------------------------------------------------------
  // Weather
  // ---------------------------------------------------------------------------
  function updateWeather(dt: number) {
    const a = Math.min(1, dt / 240);
    let dd = wrap360(tgtDir - baseDir);
    if (dd > 180) dd -= 360;
    baseDir = wrap360(baseDir + dd * a);
    baseSpeed += (tgtSpeed - baseSpeed) * a;
    humidity += (tgtHumidity - humidity) * Math.min(1, dt / 600);
    const t = state.t;
    gustPhase += dt;
    const w = state.wind;
    w.dirDeg = wrap360(baseDir + 5 * Math.sin(t / 1100) + 2 * Math.sin(t / 270));
    w.speedKph = Math.max(4, baseSpeed + 3 * Math.sin(t / 640) + 1.5 * Math.sin(t / 97));
    if (gustPhase > 30) {
      gustPhase = 0;
      w.gustKph = w.speedKph * (1.35 + rng() * 0.3);
    }
    w.gustKph = Math.max(w.gustKph, w.speedKph);
    const wx = state.weather;
    wx.humidityPct = humidity;
    wx.tempC = 34 + 1.5 * Math.sin(t / 5000) - (humidity - 11) * 0.25;
    wx.fuelMoisturePct = 2 + humidity * 0.18;
  }

  // ---------------------------------------------------------------------------
  // Forecast + metrics
  // ---------------------------------------------------------------------------
  function runForecast(reason: 'intel' | 'wind' | 'periodic') {
    const w = state.wind;
    const uncertainty = clamp((w.gustKph - w.speedKph) / Math.max(w.speedKph, 1), 0, 1);
    state.forecast = nBurning === 0 ? [] : computeForecast({ grid, wind: w, rosMpm: fire.rosMpm, uncertainty });
    state.forecastRev++;
    lastForecastT = state.t;
    lastForecastDir = w.dirDeg;
    lastForecastReason = reason;
    updateMetrics(true);
    dirty = true;
  }

  function structuresIn(poly: Vec[]) {
    let n = 0;
    for (const b of meta.buildings) if (pointInPolygon({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, poly)) n++;
    return n;
  }

  function updateMetrics(full: boolean) {
    const m = state.metrics;
    m.acres = fire.acres;
    m.rateOfSpreadMpm = fire.rosMpm;
    m.containmentPct = containSmoothed;
    if (full) {
      const b360 = state.forecast[2];
      m.structuresThreatened = b360 ? structuresIn(b360.polygon) : 0;
      const b180 = state.forecast[1];
      let p = 0;
      for (const mk of state.markers) {
        const n = persons.get(mk.id) ?? 0;
        if (!n) continue;
        if ((b180 && pointInPolygon(mk.pos, b180.polygon)) || fireDistance(mk.pos) < 30) p += n;
      }
      m.personsAtRisk = p;
    }
    let personnel = OVERHEAD, active = 0;
    for (const u of state.units) {
      personnel += CREW_SIZE[u.kind];
      if (u.status !== 'standby') active++;
    }
    m.personnel = personnel;
    m.activeUnits = active;
  }

  function sampleHistory() {
    const h = state.history;
    const push = (a: number[], v: number) => { const n = a.concat(v); return n.length > 60 ? n.slice(n.length - 60) : n; };
    state.history = {
      acres: push(h.acres, Math.round(fire.acres * 10) / 10),
      containment: push(h.containment, Math.round(containSmoothed * 10) / 10),
      ros: push(h.ros, Math.round(fire.rosMpm * 10) / 10),
    };
  }

  // ---------------------------------------------------------------------------
  // Units
  // ---------------------------------------------------------------------------
  function nearestRoadPoint(p: Vec, roadIds?: string[]): Vec {
    let best = Infinity, bp: Vec = p;
    for (const r of meta.roads) {
      if (r.kind === 'trail' || (roadIds && !roadIds.includes(r.id))) continue;
      for (const q of r.points) {
        if (q.x < 0 || q.y < 0 || q.x >= W || q.y >= H) continue;
        const d = dist(p, q);
        if (d < best) { best = d; bp = q; }
      }
    }
    return { x: bp.x, y: bp.y };
  }

  function mkUnit(id: string, callsign: string, kind: UnitKind, pos: Vec, brain: Partial<Brain> & Pick<Brain, 'role' | 'mode'>, extra: Partial<Unit> = {}): Unit {
    brains.set(id, {
      anchor: { ...pos }, phase: rng() * Math.PI * 2, orbitR: 10, timer: 0, workClock: rng() * 20, trailClock: 0, ...brain,
    });
    return { id, callsign, kind, pos: { ...pos }, heading: rng() * 360, speed: SPEED[kind], status: 'active', trail: [], ...extra };
  }

  function createUnits(): Unit[] {
    const ig = meta.ignition;
    const hw = (p: Vec) => nearestRoadPoint(p, ['hwy49']);
    return [
      mkUnit('hawk-1', 'HAWK-1', 'drone', { x: ig.x + 10, y: ig.y }, { role: 'perimeter', mode: 'orbit' }, { battery: 0.86, sensor: 'EO/IR 4K' }),
      mkUnit('hawk-2', 'HAWK-2', 'drone', { x: ig.x + 6, y: ig.y - 8 }, { role: 'head', mode: 'orbit' }, { battery: 0.71, sensor: 'LWIR 640' }),
      mkUnit('hawk-3', 'HAWK-3', 'drone', { x: ig.x + 24, y: ig.y - 12 }, { role: 'scan', mode: 'scan' }, { battery: 0.58, sensor: 'MSI 5-BAND' }),
      mkUnit('hawk-4', 'HAWK-4', 'drone', { x: 150, y: 52 }, { role: 'town', mode: 'orbit' }, { battery: 0.93, sensor: 'EO 61MP' }),
      mkUnit('e-41', 'E-41', 'engine', hw({ x: ig.x + 2, y: ig.y + 20 }), { role: 'ground', mode: 'work' }, { water: 0.78 }),
      mkUnit('e-17', 'E-17', 'engine', { x: meta.town.x0, y: meta.town.y1 - 1 }, { role: 'ground', mode: 'work' }, { water: 1, status: 'standby' }),
      mkUnit('e-22', 'E-22', 'engine', { ...meta.icp }, { role: 'ground', mode: 'goto', anchor: hw({ x: ig.x + 26, y: ig.y + 18 }) }, { water: 1, status: 'enroute' }),
      mkUnit('crew-7', 'CREW-7', 'crew', { x: ig.x - 2, y: ig.y + 9 }, { role: 'ground', mode: 'work' }),
      mkUnit('crew-12', 'CREW-12', 'crew', { x: ig.x - 10, y: ig.y + 2 }, { role: 'ground', mode: 'work' }),
      mkUnit('h-2', 'H-2', 'helo', { x: meta.reservoir.center.x + 4, y: meta.reservoir.center.y - 3 }, { role: 'helo', mode: 'dip' }, { water: 0.2 }),
      mkUnit('t-910', 'T-910', 'tanker', { ...meta.airbase }, { role: 'tanker', mode: 'standby' }, { water: 1, status: 'standby', heading: 270 }),
      mkUnit('dz-1', 'DZ-1', 'dozer', { x: meta.icp.x + 2, y: meta.icp.y - 1 }, { role: 'dozer', mode: 'standby' }, { status: 'standby' }),
    ];
  }

  function turnHeading(u: Unit, desired: number, maxDeg: number) {
    let d = wrap360(desired - u.heading);
    if (d > 180) d -= 360;
    u.heading = wrap360(u.heading + clamp(d, -maxDeg, maxDeg));
  }

  /** Straight-line move; heading eases toward travel direction. Returns true on arrival. */
  function moveToward(u: Unit, tgt: Vec, dt: number, mult = 1): boolean {
    const dx = tgt.x - u.pos.x, dy = tgt.y - u.pos.y;
    const d = Math.hypot(dx, dy);
    const step = u.speed * mult * dt;
    if (d > 1e-3) {
      const air = u.kind === 'drone' || u.kind === 'helo' || u.kind === 'tanker';
      turnHeading(u, (Math.atan2(dx, -dy) * 180) / Math.PI, (air ? 90 : 240) * dt);
    }
    if (d <= step) { u.pos.x = tgt.x; u.pos.y = tgt.y; return true; }
    u.pos.x += (dx / d) * step;
    u.pos.y += (dy / d) * step;
    return false;
  }

  function setTarget(u: Unit, p: Vec | undefined) {
    if (!p) { u.target = undefined; return; }
    if (!u.target) u.target = { x: p.x, y: p.y };
    else { u.target.x = p.x; u.target.y = p.y; }
  }

  function orbit(u: Unit, b: Brain, center: Vec, R: number, dt: number) {
    b.orbitR += (R - b.orbitR) * Math.min(1, dt / 60);
    const far = dist(u.pos, center) > b.orbitR * 1.6 + 4;
    if (!far) b.phase += ((u.speed * 0.95) / Math.max(b.orbitR, 3)) * dt;
    const lead = b.phase + 0.35;
    const p = { x: clamp(center.x + Math.cos(lead) * b.orbitR, 2, W - 2), y: clamp(center.y + Math.sin(lead) * b.orbitR, 2, H - 2) };
    setTarget(u, p);
    moveToward(u, p, dt, far ? 1.3 : 1);
    u.status = far ? 'enroute' : 'active';
  }

  function finishTask(b: Brain) {
    b.task = undefined;
  }

  function updateDrone(u: Unit, b: Brain, dt: number) {
    u.battery = Math.max(0, (u.battery ?? 1) - dt / 4800);
    if (b.mode === 'charge') {
      u.status = 'standby';
      setTarget(u, undefined);
      u.battery = Math.min(1, u.battery + dt / 160);
      if (u.battery >= 0.99) b.mode = b.role === 'scan' ? 'scan' : 'orbit';
      return;
    }
    if (b.mode === 'rtb' || u.battery < 0.2) {
      b.mode = 'rtb';
      u.status = 'rtb';
      setTarget(u, meta.helibase);
      if (moveToward(u, meta.helibase, dt, 1.2)) b.mode = 'charge';
      return;
    }
    const tk = b.task;
    if (tk && tk.kind === 'scan') {
      orbit(u, b, tk.target, 6, dt);
      if (dist(u.pos, tk.target) < 9) {
        tk.timer += dt;
        if (tk.timer > 150 && tk.phase === 'approach') {
          tk.phase = 'execute';
          if (tk.markerId) {
            updateMarker(tk.markerId, { confidence: 0.95, detail: 'Confirmed by LWIR orbit: four persons sheltering at a residence on lower Ridge Rd.', severity: 'critical' });
            addInsight({ kind: 'analysis', confidence: 0.95, refs: [tk.markerId], title: `${u.callsign} confirms persons on Ridge Rd`,
              body: `LWIR orbit at GRID ${gridRef(tk.target)} confirms 4 persons at one residence. Detection confidence raised 64% → 95%.` });
          }
        }
        if (tk.timer > 420) finishTask(b);
      }
      return;
    }
    const f = fire;
    switch (b.role) {
      case 'perimeter': orbit(u, b, f.centroid, Math.min(f.radius + 7, 34), dt); break;
      case 'head': orbit(u, b, f.head, 8, dt); break;
      case 'town': orbit(u, b, { x: (meta.trailhead.x + meta.town.x0) / 2 + 4, y: (meta.trailhead.y + meta.town.y1) / 2 }, 16, dt); break;
      default: {
        // Lissajous scan box ahead of the head, oriented along the wind.
        const { wx, wy } = windVec();
        const c = { x: f.head.x + wx * 16, y: f.head.y + wy * 16 };
        b.phase += dt * 0.0042;
        const a = Math.sin(b.phase) * 15, q = Math.sin(b.phase * 2) * 8;
        const p = { x: clamp(c.x + wx * q - wy * a, 2, W - 2), y: clamp(c.y + wy * q + wx * a, 2, H - 2) };
        setTarget(u, p);
        u.status = moveToward(u, p, dt, 1.1) || dist(u.pos, p) < 8 ? 'active' : 'enroute';
      }
    }
  }

  function updateHelo(u: Unit, b: Brain, dt: number) {
    const tk = b.task;
    if (tk && tk.kind === 'extract') {
      if (tk.phase === 'approach') {
        u.status = 'enroute';
        setTarget(u, tk.target);
        if (moveToward(u, tk.target, dt)) { tk.phase = 'execute'; tk.timer = 0; }
      } else if (tk.phase === 'execute') {
        u.status = 'active';
        tk.timer += dt;
        u.heading = wrap360(u.heading + dt * 2);
        if (tk.timer > 120) {
          const mk = state.markers.find((m) => m.id === tk.markerId);
          if (mk) {
            const n = persons.get(mk.id) ?? 0;
            const where = mk.label.split('·')[1]?.trim() ?? gridRef(mk.pos);
            updateMarker(mk.id, { label: `EXTRACTED · ${where}`, severity: 'low', detail: `${n} persons hoisted by ${u.callsign} and flown to ICP.` }, 0);
            addInsight({ kind: 'status', confidence: 0.97, refs: [mk.id], title: `${u.callsign}: ${n} persons extracted`,
              body: `${n} persons hoisted at GRID ${gridRef(mk.pos)}, en route to ICP for medical evaluation. Persons-at-risk count updated.` });
          }
          tk.phase = 'return';
        }
      } else {
        u.status = 'enroute';
        setTarget(u, meta.icp);
        if (moveToward(u, meta.icp, dt)) { finishTask(b); b.mode = 'dip'; }
      }
      return;
    }
    if (b.mode === 'dip' || (u.water ?? 0) < 0.05) {
      if (b.mode !== 'dip') { b.mode = 'dip'; b.timer = 0; }
      const p = { x: meta.reservoir.center.x + 3, y: meta.reservoir.center.y - 2 };
      setTarget(u, p);
      u.status = tk ? 'enroute' : 'active';
      if (moveToward(u, p, dt)) {
        b.timer += dt;
        u.water = Math.min(1, (u.water ?? 0) + dt / 40);
        if (u.water >= 1) { b.mode = 'drop'; b.timer = 0; }
      }
      return;
    }
    // Drop target: tasked target (re-aimed at nearby fire), else the head.
    let tgt: Vec = fire.head;
    if (tk && tk.kind === 'water') {
      const near = scanNearest(tk.target, 6, (i) => grid.state[i] === CellState.Burning);
      if (!near && tk.cycles < 3) { finishTask(b); }
      else tgt = near ?? tk.target;
    } else if (nBurning === 0) {
      u.status = 'standby';
      setTarget(u, meta.helibase);
      moveToward(u, meta.helibase, dt);
      return;
    }
    setTarget(u, tgt);
    u.status = 'active';
    if (moveToward(u, tgt, dt)) {
      applyRetardant(tgt, 2.8, 0.75, 0.25);
      u.water = 0;
      b.mode = 'dip';
      if (b.task) {
        b.task.cycles--;
        if (b.task.cycles <= 0) {
          const mk = b.task.markerId ? state.markers.find((m) => m.id === b.task!.markerId) : undefined;
          if (mk && mk.kind === 'spot') updateMarker(mk.id, { label: 'SPOT · KNOCKED DOWN', severity: 'low', detail: `Knocked down by ${u.callsign} after 3 bucket cycles.` });
          finishTask(b);
        }
      }
    }
  }

  function updateTanker(u: Unit, b: Brain, dt: number) {
    const tk = b.task;
    if (tk && tk.kind === 'retardant-line' && tk.lineA && tk.lineB) {
      if (tk.phase === 'approach') {
        u.status = 'enroute';
        setTarget(u, tk.lineA);
        if (moveToward(u, tk.lineA, dt)) tk.phase = 'execute';
      } else if (tk.phase === 'execute') {
        u.status = 'active';
        setTarget(u, tk.lineB);
        const arrived = moveToward(u, tk.lineB, dt, 0.55);
        tk.timer += dt;
        if (tk.timer > 2) { tk.timer = 0; applyRetardant(u.pos, 1.6, 1, 0.3); }
        u.water = clamp(dist(u.pos, tk.lineB) / Math.max(dist(tk.lineA, tk.lineB), 1), 0, 1);
        if (arrived) {
          applyRetardant(u.pos, 1.6, 1, 0.3);
          tk.phase = 'return';
          addInsight({ kind: 'status', confidence: 0.93, title: `${u.callsign}: retardant line complete`,
            body: `${Math.round((dist(tk.lineA, tk.lineB) * CELL_M) / 10) * 10} m Phos-Chek line laid at GRID ${gridRef(tk.target)}. Spread model updated; returning to reload.` });
          forecastRequest = 'intel';
        }
      } else {
        finishTask(b);
        b.mode = 'rtb';
      }
      return;
    }
    if (b.mode === 'rtb') {
      u.status = 'rtb';
      setTarget(u, meta.airbase);
      if (moveToward(u, meta.airbase, dt)) { b.mode = 'reload'; b.timer = 0; }
      return;
    }
    if (b.mode === 'reload') {
      u.status = 'standby';
      setTarget(u, undefined);
      u.water = Math.min(1, (u.water ?? 0) + dt / 300);
      if (u.water >= 1) b.mode = 'standby';
      return;
    }
    u.status = 'standby';
    setTarget(u, undefined);
  }

  function edgeScore(u: Unit, b: Brain) {
    return (i: number, d: number) => {
      const x = (i % W) + 0.5, y = ((i / W) | 0) + 0.5;
      // Prefer cold edges (anchor-and-flank) and staying near the work anchor.
      return d + (burningNear(i) ? (u.kind === 'engine' ? -1 : 3) : 0) + 0.25 * Math.hypot(x - b.anchor.x, y - b.anchor.y);
    };
  }

  function updateGround(u: Unit, b: Brain, dt: number) {
    const tk = b.task;
    if (tk) {
      if (tk.kind === 'protect' && u.kind === 'dozer' && tk.lineA && tk.lineB) {
        if (tk.phase === 'approach') {
          u.status = 'enroute';
          setTarget(u, tk.lineA);
          if (moveToward(u, tk.lineA, dt, 1.4)) tk.phase = 'execute';
        } else {
          u.status = 'active';
          setTarget(u, tk.lineB);
          const done = moveToward(u, tk.lineB, dt, 0.7);
          tk.timer += dt;
          if (tk.timer > 4) { tk.timer = 0; applyRetardant(u.pos, 1.2, 1); }
          if (done) { b.anchor = { ...u.pos }; b.mode = 'work'; finishTask(b); }
        }
        return;
      }
      u.status = 'enroute';
      setTarget(u, tk.target);
      if (moveToward(u, tk.target, dt, 1.2)) {
        if (tk.kind === 'protect') applyRetardant(tk.target, u.kind === 'engine' ? 3.5 : 2.5, 0.85, 0.4);
        b.anchor = { ...tk.target };
        b.mode = 'work';
        finishTask(b);
      }
      return;
    }
    if (b.mode === 'standby') { u.status = 'standby'; setTarget(u, undefined); return; }
    if (b.mode === 'goto') {
      u.status = 'enroute';
      setTarget(u, b.anchor);
      if (moveToward(u, b.anchor, dt)) b.mode = 'work';
      return;
    }
    if (b.mode === 'refill') {
      u.status = 'standby';
      u.water = Math.min(1, (u.water ?? 0) + dt / 180);
      if (u.water >= 1) b.mode = 'work';
      return;
    }
    // Work: pick an unlined edge cell near the anchor; lay line / spray as we go.
    b.workClock += dt;
    if (b.workClock > 20 || !u.target) {
      b.workClock = 0;
      const R = u.kind === 'engine' ? 9 : 11;
      const tgt = scanNearest(u.pos, R, (i) => isEdgeCell(i, 0.45), edgeScore(u, b));
      if (tgt) setTarget(u, tgt);
      else setTarget(u, b.anchor);
    }
    const tgt = u.target!;
    const nearFire = fireDistance(u.pos) < 7;
    // Line construction is far slower than travel: ~10 m/min for crews.
    const lineMult = !nearFire ? 1 : u.kind === 'crew' ? 0.12 : u.kind === 'dozer' ? 0.4 : 0.15;
    const arrived = moveToward(u, tgt, dt, lineMult);
    u.status = nearFire || !arrived ? 'active' : 'standby';
    if (arrived && dist(tgt, b.anchor) > 0.5 && !scanNearest(u.pos, 1.6, (i) => isEdgeCell(i, 0.45))) b.workClock = 99;
    b.timer += dt;
    if (b.timer > 6 && nearFire) {
      b.timer = 0;
      if (u.kind === 'engine') {
        applyRetardant(u.pos, 1.6, 0.7, 0.6);
        u.water = Math.max(0, (u.water ?? 1) - 0.035);
        if (u.water <= 0.02) b.mode = 'refill';
      } else if (u.kind === 'crew') applyRetardant(u.pos, 1.1, 0.7, 0.7);
      else applyRetardant(u.pos, 1.4, 1, 0.6);
      if (u.kind !== 'engine') b.anchor = { ...u.pos };
    }
  }

  function updateUnits(dt: number) {
    for (const u of state.units) {
      const b = brains.get(u.id)!;
      switch (u.kind) {
        case 'drone': updateDrone(u, b, dt); break;
        case 'helo': updateHelo(u, b, dt); break;
        case 'tanker': updateTanker(u, b, dt); break;
        default: updateGround(u, b, dt);
      }
      b.trailClock += dt;
      if (b.trailClock >= 12) {
        b.trailClock = 0;
        const last = u.trail[u.trail.length - 1];
        if (!last || dist(last, u.pos) > 0.25) {
          u.trail.push({ x: u.pos.x, y: u.pos.y });
          if (u.trail.length > 40) u.trail.shift();
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Snapshot mutators (replace arrays so consumers can compare by reference)
  // ---------------------------------------------------------------------------
  const nextId = (prefix: string) => `${prefix}-${String(++idCounter).padStart(4, '0')}`;

  function addInsight(i: Omit<Insight, 'id' | 'at'>): Insight {
    const ins: Insight = { id: nextId('ins'), at: state.t, ...i };
    state.insights = [ins, ...state.insights].slice(0, CAP);
    dirty = true;
    return ins;
  }

  function updateMarker(id: string, patch: Partial<Marker>, p?: number) {
    state.markers = state.markers.map((m) => (m.id === id ? { ...m, ...patch } : m));
    if (p !== undefined) persons.set(id, p);
    dirty = true;
  }

  function activeTaskFor(recId: string) {
    for (const b of brains.values()) if (b.task?.recId === recId) return true;
    return false;
  }

  function etaMin(unitIds: string[], target: Vec) {
    let worst = 0;
    for (const id of unitIds) {
      const u = state.units.find((x) => x.id === id);
      if (!u) continue;
      worst = Math.max(worst, dist(u.pos, target) / (u.speed * 1.2) / 60);
    }
    return Math.max(1, Math.round(worst));
  }

  const host: AgentHost = {
    get state() { return state; },
    world: meta,
    rand: () => rng(),
    nextId,
    fire: () => fire,
    fireDistance,
    findCell: (near, radius, pred) => scanNearest(near, radius, pred),
    ignite: (p) => {
      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const ok = igniteIdx(y * W + x);
      if (ok) grid.version++;
      return ok;
    },
    setWind: (d, s) => { tgtDir = wrap360(d); tgtSpeed = s; },
    setRedFlag: (on) => { state.weather.redFlag = on; dirty = true; },
    setHumidity: (pct) => { tgtHumidity = pct; },
    requestForecast: (reason) => { forecastRequest = reason; },
    get lastForecastReason() { return lastForecastReason; },
    addIngest: (item: IngestItem) => { state.ingest = [item, ...state.ingest].slice(0, CAP); dirty = true; },
    replaceIngest: (item: IngestItem) => { state.ingest = state.ingest.map((x) => (x.id === item.id ? item : x)); dirty = true; },
    addMarker: (m, p) => {
      let list = [...state.markers.filter((x) => x.id !== m.id), m];
      if (list.length > 30) {
        const drop = list.find((x) => x.severity === 'low') ?? list[0];
        list = list.filter((x) => x !== drop);
      }
      state.markers = list;
      if (p !== undefined) persons.set(m.id, p);
      dirty = true;
    },
    updateMarker,
    addInsight,
    addRecommendation: (r, task) => {
      const rec: Recommendation = { id: nextId('rec'), at: state.t, status: 'pending', ...r };
      recTasks.set(rec.id, task);
      let list = [rec, ...state.recommendations];
      while (list.length > 14) {
        const idx = list.map((x) => x.status).lastIndexOf('dismissed');
        const k = idx >= 0 ? idx : list.map((x) => x.status !== 'pending').lastIndexOf(true);
        if (k < 0) { list = list.slice(0, 14); break; }
        list.splice(k, 1);
      }
      state.recommendations = list;
      if (r.priority === 'P1') addInsight({ kind: 'recommendation', confidence: 0.8, title: `Proposed · ${rec.title}`, body: `${rec.impact}. ${rec.rationale}`, refs: [rec.id] });
      dirty = true;
      return rec;
    },
    hasRec: (key) => state.recommendations.some((r) => recTasks.get(r.id)?.key === key && (r.status === 'pending' || (r.status === 'accepted' && activeTaskFor(r.id)))),
    unit: (id) => state.units.find((u) => u.id === id),
    etaMin,
    structuresIn,
  };

  const agent = createAgent(host);

  // ---------------------------------------------------------------------------
  // Main step
  // ---------------------------------------------------------------------------
  function simStep() {
    state.t += STEP;
    updateWeather(STEP);
    spreadStep();
    sampleRos();
    agent.update();
    if (state.t - lastContainT >= 60) { lastContainT = state.t; computeContainment(); }
    let dd = Math.abs(state.wind.dirDeg - lastForecastDir) % 360;
    if (dd > 180) dd = 360 - dd;
    if (forecastRequest) { const r = forecastRequest; forecastRequest = null; runForecast(r); }
    else if (dd > 10) runForecast('wind');
    else if (state.t - lastForecastT >= 300) runForecast('periodic');
    if (state.t - lastHistoryT >= 60) { lastHistoryT = state.t; sampleHistory(); }
    updateMetrics(state.t % 60 === 0);
  }

  function init() {
    revBase = state.forecastRev;
    baseDir = tgtDir = 250; baseSpeed = tgtSpeed = 24; humidity = tgtHumidity = 11; gustPhase = 0;
    state = emptySnapshot();
    grid.state.fill(CellState.Unburnt);
    grid.heat.fill(0);
    grid.retardant.fill(0);
    grid.fuel.set(world.pristine.fuel);
    grid.dryness.set(world.pristine.dryness);
    burnAge.fill(0);
    ignAcc.fill(0);
    {
      const tr = mulberry32(seed * 104729 + 17);
      for (let i = 0; i < N; i++) ignThr[i] = 0.55 + tr() * 1.0;
    }
    nBurning = 0; fireCells = 0; maxDist = 0; distRingN = 0; lastMinute = -1;
    fire.rosMpm = 0; fire.head = { ...meta.ignition }; fire.centroid = { ...meta.ignition };
    rng = mulberry32(seed * 7919 + 3);
    baseDir = tgtDir = 250; baseSpeed = tgtSpeed = 24; humidity = tgtHumidity = 11; gustPhase = 0;
    lastForecastT = -1e9; lastForecastDir = baseDir; forecastRequest = null; lastForecastReason = 'init';
    lastHistoryT = -1e9; lastContainT = -1e9; containSmoothed = 0; idCounter = 0;
    recTasks.clear(); persons.clear(); brains.clear();
    agent.reset();
    stepAcc = 0;

    const ig = meta.ignition;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) igniteIdx((ig.y + dy) * W + ig.x + dx);
    state.units = createUnits();
    updateWeather(0);
    while (state.t < T0) simStep();
    // Settle unit kinematics so orbits and patterns are established at t0.
    for (let s = 0; s < 60; s++) updateUnits(2);
    for (const u of state.units) u.trail = [];
    runForecast('periodic');
    lastForecastReason = 'init';
    computeContainment();
    updateMetrics(true);
    state.clock = new Date(EPOCH + state.t * 1000);
    grid.version++;
    dirty = true;
  }

  function notify() {
    notifyAcc = 0;
    dirty = false;
    state.clock = new Date(EPOCH + state.t * 1000);
    state.units = state.units.slice();
    for (const fn of listeners) fn();
  }

  init();

  const engine: SimEngine = {
    get state() { return state; },
    get paused() { return paused; },
    get speed() { return speed; },
    tick(dtReal: number) {
      const dtr = clamp(dtReal, 0, 0.1);
      notifyAcc += dtr;
      if (!paused) {
        const simDt = dtr * SIM_TIME_SCALE * speed;
        stepAcc += simDt;
        let steps = 0;
        while (stepAcc >= STEP && steps < 24) { stepAcc -= STEP; simStep(); steps++; }
        if (stepAcc > STEP * 4) stepAcc = 0;
        let rem = simDt;
        while (rem > 0) { const d = Math.min(rem, 2); updateUnits(d); rem -= d; }
        dirty = true;
      }
      if (dirty && notifyAcc >= NOTIFY_INTERVAL) notify();
    },
    setPaused(p: boolean) { if (paused !== p) { paused = p; notify(); } },
    setSpeed(m: number) { const s = clamp(m, 0.25, 32); if (s !== speed) { speed = s; notify(); } },
    accept(recId: string) {
      const rec = state.recommendations.find((r) => r.id === recId);
      if (!rec || rec.status !== 'pending') return;
      const task = recTasks.get(recId);
      state.recommendations = state.recommendations.map((r) => (r.id === recId ? { ...r, status: 'accepted' as const } : r));
      const { wx, wy } = windVec();
      const callsigns: string[] = [];
      rec.unitIds.forEach((uid, k) => {
        const u = state.units.find((x) => x.id === uid);
        const b = brains.get(uid);
        if (!u || !b || !task) return;
        callsigns.push(u.callsign);
        const n = rec.unitIds.length;
        const off = n > 1 ? (k - (n - 1) / 2) * 3 : 0;
        const target = { x: clamp(rec.target.x - wy * off, 1, W - 1), y: clamp(rec.target.y + wx * off, 1, H - 1) };
        const t: Task = { recId, kind: task.kind, target, cycles: task.kind === 'water' ? 3 : 1, markerId: task.markerId, phase: 'approach', timer: 0 };
        if (task.kind === 'retardant-line' || (task.kind === 'protect' && u.kind === 'dozer')) {
          const half = u.kind === 'tanker' ? 10 : 7;
          // Line runs perpendicular to the wind, across the head's path.
          t.lineA = { x: clamp(rec.target.x - wy * half, 1, W - 1), y: clamp(rec.target.y + wx * half, 1, H - 1) };
          t.lineB = { x: clamp(rec.target.x + wy * half, 1, W - 1), y: clamp(rec.target.y - wx * half, 1, H - 1) };
          if (dist(u.pos, t.lineB) < dist(u.pos, t.lineA)) { const a = t.lineA; t.lineA = t.lineB; t.lineB = a; }
        }
        if (u.kind === 'helo' && task.kind === 'water' && (u.water ?? 0) > 0.3) b.mode = 'drop';
        b.task = t;
        u.status = 'enroute';
        setTarget(u, t.lineA ?? target);
      });
      addInsight({
        kind: 'status', confidence: 0.95, refs: [recId], title: `Dispatched · ${rec.title}`,
        body: `${callsigns.join(', ')} en route to GRID ${gridRef(rec.target)}, ETA ${rec.etaMin} min. Projected impact: ${rec.impact}.`,
      });
      updateMetrics(false);
      notify();
    },
    dismiss(recId: string) {
      const rec = state.recommendations.find((r) => r.id === recId);
      if (!rec || rec.status !== 'pending') return;
      state.recommendations = state.recommendations.map((r) => (r.id === recId ? { ...r, status: 'dismissed' as const } : r));
      notify();
    },
    reset() {
      init();
      notify();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
  return engine;
}
