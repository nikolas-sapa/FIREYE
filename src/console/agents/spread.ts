import type { Geo, Ms, ScenarioPack } from '../contracts';
import { FuelClass } from '../contracts';

/**
 * Independent fire-spread model used by the Projection agent.
 *
 * Minimum-travel-time (Dijkstra) spread over a coarsened copy of the pack raster. It reads only the DEM,
 * the fuel classes, hourly weather and the fire observed up to the issue time (arrival <= issuedAt). It never
 * reads arrival after the issue time, perimeters or checkpoints. Constants come from published, generic
 * fire-behaviour relations and are not fitted to any fire; see orchestrator/PROJECTION.md for the sources.
 */

export interface SpreadWeather {
  windKph: number;
  windDirDeg: number;
  tempC: number;
  rh: number;
}

/** Coarse model grid derived once per pack. */
export interface SpreadGrid {
  pack: ScenarioPack;
  stride: number;
  gw: number;
  gh: number;
  dxM: number;
  dyM: number;
  cellHa: number;
  fuel: Uint8Array;
  elev: Float32Array;
  /** Earliest arrival (ms since manifest.start) of any fine cell inside the coarse cell; Infinity = never. */
  minArr: Float32Array;
  west: number;
  north: number;
  dLon: number;
  dLat: number;
}

export interface SpreadField {
  issuedAt: Ms;
  horizonMin: number;
  grid: SpreadGrid;
  /** Minutes after issuedAt the modelled fire reaches each coarse cell. 0 = burned at issue, Infinity = not within the horizon. */
  t: Float32Array;
  burned: number;
  seeds: number;
  /** Centroid of the observed burned area at issue. */
  center: Geo | null;
  computeMs: number;
}

/** Coarse grid cell budget: keeps one projection well under 50 ms on the pack grids. */
const TARGET_CELLS = 100_000;
/** Burned cells that ignite neighbours: only the edge observed burning in the last 12 h (satellite hotspot window). */
const ACTIVE_EDGE_MIN = 12 * 60;

const KMH_TO_MPM = 1000 / 60;

const grids = new WeakMap<ScenarioPack, SpreadGrid>();

export function spreadGrid(pack: ScenarioPack): SpreadGrid {
  const cached = grids.get(pack);
  if (cached) return cached;
  const { w: W, h: H, bbox } = pack.raster;
  const stride = Math.max(1, Math.ceil(Math.sqrt((W * H) / TARGET_CELLS)));
  const gw = Math.ceil(W / stride);
  const gh = Math.ceil(H / stride);
  const n = gw * gh;
  const fuel = new Uint8Array(n);
  const elev = new Float32Array(n);
  const minArr = new Float32Array(n).fill(Infinity);
  for (let gy = 0; gy < gh; gy++) {
    const cy = Math.min(H - 1, gy * stride + (stride >> 1));
    for (let gx = 0; gx < gw; gx++) {
      const cx = Math.min(W - 1, gx * stride + (stride >> 1));
      const ci = cy * W + cx;
      const g = gy * gw + gx;
      fuel[g] = pack.fuel[ci];
      elev[g] = pack.elevation[ci];
    }
  }
  for (let y = 0; y < H; y++) {
    const row = ((y / stride) | 0) * gw;
    for (let x = 0; x < W; x++) {
      const a = pack.arrival[y * W + x];
      if (!(a === a)) continue;
      const g = row + ((x / stride) | 0);
      if (a < minArr[g]) minArr[g] = a;
    }
  }
  const midLat = (bbox[1] + bbox[3]) / 2;
  const dLon = ((bbox[2] - bbox[0]) / W) * stride;
  const dLat = ((bbox[3] - bbox[1]) / H) * stride;
  const dxM = dLon * 111320 * Math.cos((midLat * Math.PI) / 180);
  const dyM = dLat * 110574;
  const grid: SpreadGrid = { pack, stride, gw, gh, dxM, dyM, cellHa: (dxM * dyM) / 10_000, fuel, elev, minArr, west: bbox[0], north: bbox[3], dLon, dLat };
  grids.set(pack, grid);
  return grid;
}

export function gridIndex(g: SpreadGrid, p: Geo): number {
  const x = Math.floor((p.lon - g.west) / g.dLon);
  const y = Math.floor((g.north - p.lat) / g.dLat);
  if (x < 0 || y < 0 || x >= g.gw || y >= g.gh) return -1;
  return y * g.gw + x;
}

export function gridGeo(g: SpreadGrid, x: number, y: number): Geo {
  return { lon: g.west + (x + 0.5) * g.dLon, lat: g.north - (y + 0.5) * g.dLat };
}

/** Observed burned mask at absolute time t (truth up to t; callers decide whether t is allowed). */
export function burnedMask(g: SpreadGrid, t: Ms): Uint8Array {
  const rel = t - g.pack.manifest.start;
  const out = new Uint8Array(g.minArr.length);
  for (let i = 0; i < out.length; i++) if (g.minArr[i] <= rel) out[i] = 1;
  return out;
}

/* ------------------------------------------------------------------ fire behaviour relations */

/** Fine dead fuel moisture (%) from temperature and RH: Simard (1968) equilibrium moisture content. */
export function fineFuelMoisture(tempC: number, rh: number): number {
  const f = (tempC * 9) / 5 + 32;
  let m: number;
  if (rh < 10) m = 0.03229 + 0.281073 * rh - 0.000578 * rh * f;
  else if (rh < 50) m = 2.22749 + 0.160107 * rh - 0.01478 * f;
  else m = 21.0606 + 0.005565 * rh * rh - 0.00035 * rh * f - 0.483199 * rh;
  return Math.max(1, m);
}

/** Cheney et al. (1998) grassland moisture coefficient. */
function grassMoisture(m: number, u: number): number {
  if (m < 12) return Math.exp(-0.108 * m);
  return Math.max(0, u <= 10 ? 0.684 - 0.0342 * m : 0.547 - 0.0228 * m);
}

/** Head ROS (m/min) and length-to-breadth ratio for grass: Cheney et al. (1998) natural pasture, McArthur (1966) LB. */
function grass(u: number, m: number): [number, number] {
  const kmh = (u >= 5 ? 0.054 + 0.269 * u : 0.054 + 0.209 * u) * grassMoisture(m, u);
  const lb = u < 5 ? 1 : 1.1 * Math.pow(u, 0.464);
  return [kmh * KMH_TO_MPM, lb];
}

/**
 * Head ROS (m/min) and LB for shrub and forest: the 10 % wind speed rule of thumb (Cruz & Alexander 2019),
 * damped above 6 % fine fuel moisture with the Cheney moisture slope; LB from Alexander (1985).
 */
function forest(u: number, m: number): [number, number] {
  const damp = Math.min(1, Math.exp(-0.108 * (m - 6)));
  const kmh = Math.max(0.03, 0.1 * u) * damp;
  return [kmh * KMH_TO_MPM, 1 + 0.0012 * Math.pow(u, 2.154)];
}

/** Head ROS and LB per FuelClass. Urban and agriculture factors are labelled assumptions (PROJECTION.md). */
export function headRos(fc: number, windKph: number, moisture: number): [number, number] {
  const u = Math.max(0, windKph);
  switch (fc) {
    case FuelClass.Grass:
      return grass(u, moisture);
    case FuelClass.Agriculture: {
      const [r, lb] = grass(u, moisture);
      return [r * 0.5, lb];
    }
    case FuelClass.Shrub:
    case FuelClass.TimberUnderstory:
      return forest(u, moisture);
    case FuelClass.TimberLitter:
    case FuelClass.Urban: {
      const [r, lb] = forest(u, moisture);
      return [r * 0.5, lb];
    }
    default:
      return [0, 1];
  }
}

/** Forestry Canada FBP slope factor exp(3.533 (tan slope)^1.2), slope capped at 60 %; applied upslope only. */
function slopeFactor(grade: number): number {
  return Math.exp(3.533 * Math.pow(Math.min(grade, 0.6), 1.2));
}

/* ------------------------------------------------------------------ min-travel-time solver */

const NX = [1, -1, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 2, 2, -2, -2];
const NY = [0, 0, 1, -1, 1, -1, 1, -1, 2, -2, 2, -2, 1, -1, 1, -1];
const NK = NX.length;
const FUELS = 9;

class Heap {
  k = new Float64Array(1024);
  v = new Int32Array(1024);
  n = 0;
  push(key: number, val: number): void {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2);
      k.set(this.k);
      const v = new Int32Array(this.n * 2);
      v.set(this.v);
      this.k = k;
      this.v = v;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p];
      this.v[i] = this.v[p];
      i = p;
    }
    this.k[i] = key;
    this.v[i] = val;
  }
  /** Pops the minimum; returns its value and leaves the key in `top`. */
  top = 0;
  pop(): number {
    const rv = this.v[0];
    this.top = this.k[0];
    const n = --this.n;
    const key = this.k[n];
    const val = this.v[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c];
      this.v[i] = this.v[c];
      i = c;
    }
    this.k[i] = key;
    this.v[i] = val;
    return rv;
  }
}

/** Inputs for the generic minimum-travel-time solver, independent of any scenario pack. */
export interface TravelTimeGrid {
  gw: number;
  gh: number;
  dxM: number;
  dyM: number;
  /** FuelClass per cell; classes with zero head ROS never burn. */
  fuel: Uint8Array;
  elev: Float32Array;
  /** Minutes after issue; seeded cells already hold their start time, every other cell Infinity. Filled in place. */
  t: Float32Array;
  horizonMin: number;
  /** Weather for model hour `hour` (0 = first hour after issue). */
  weatherAt: (hour: number) => SpreadWeather;
}

/** Ignition cells for solveTravelTime: indices pushed with their start times. */
export class SpreadSeeds {
  readonly heap = new Heap();
  push(index: number, minutes = 0): void {
    this.heap.push(minutes, index);
  }
  get size(): number {
    return this.heap.n;
  }
}

/**
 * Dijkstra over the 16-neighbour stencil with elliptical wind spread and an upslope factor.
 * `heap` holds the active seeds; `t` must already contain their start times.
 */
function solveTravelTime(grid: TravelTimeGrid & { heap: Heap }): void {
  const { gw, gh, fuel, elev, t: T, heap, horizonMin, weatherAt } = grid;
  const dist = NX.map((dx, k) => Math.hypot(dx * grid.dxM, NY[k] * grid.dyM));
  const bear = NX.map((dx, k) => Math.atan2(dx * grid.dxM, -NY[k] * grid.dyM));
  const tables = new Map<number, Float32Array>();
  const rates = (hb: number): Float32Array => {
    let tb = tables.get(hb);
    if (tb) return tb;
    const w = weatherAt(hb);
    const m = fineFuelMoisture(w.tempC, w.rh);
    const down = (((w.windDirDeg + 180) % 360) * Math.PI) / 180;
    tb = new Float32Array(FUELS * NK);
    for (let f = 0; f < FUELS; f++) {
      const [rh, lb0] = headRos(f, w.windKph, m);
      if (rh <= 0) continue;
      const lb = Math.min(8, Math.max(1, lb0));
      const e = Math.sqrt(1 - 1 / (lb * lb));
      for (let k = 0; k < NK; k++) tb[f * NK + k] = (rh * (1 - e)) / (1 - e * Math.cos(bear[k] - down));
    }
    tables.set(hb, tb);
    return tb;
  };

  while (heap.n) {
    const i = heap.pop();
    const tc = heap.top;
    // T is Float32: compare in float32, or a fresh entry whose time rounded down reads as stale and is never expanded.
    if (Math.fround(tc) > T[i]) continue;
    if (tc > horizonMin) break;
    const x = i % gw;
    const y = (i / gw) | 0;
    const tb = rates(Math.floor(tc / 60));
    const ei = elev[i];
    for (let k = 0; k < NK; k++) {
      const nx = x + NX[k];
      const ny = y + NY[k];
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const j = ny * gw + nx;
      if (T[j] <= tc) continue;
      const fj = fuel[j];
      const r = fj < FUELS ? tb[fj * NK + k] : 0;
      if (r <= 0) continue;
      const dz = elev[j] - ei;
      const d = dist[k];
      const nt = tc + d / (dz > 0 ? r * slopeFactor(dz / d) : r);
      if (nt < T[j] && nt <= horizonMin) {
        T[j] = nt;
        heap.push(nt, j);
      }
    }
  }
}

/** Runs solveTravelTime from explicit seeds on a caller-supplied grid. Returns minutes after issue per cell. */
export function runTravelTime(grid: Omit<TravelTimeGrid, 't'>, seeds: SpreadSeeds): Float32Array {
  const t = new Float32Array(grid.gw * grid.gh).fill(Infinity);
  const heap = seeds.heap;
  for (let i = 0; i < heap.n; i++) t[heap.v[i]] = Math.min(t[heap.v[i]], heap.k[i]);
  solveTravelTime({ ...grid, t, heap });
  return t;
}

/**
 * Runs the model from the fire observed at `issuedAt` for `horizonMin` minutes.
 * `wx(t)` supplies the weather the model assumes at absolute time t (forecast or persistence).
 */
export function runSpread(pack: ScenarioPack, issuedAt: Ms, wx: (t: Ms) => SpreadWeather, horizonMin = 360): SpreadField {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const g = spreadGrid(pack);
  const { gw, gh, fuel, elev, minArr } = g;
  const n = gw * gh;
  const rel = issuedAt - pack.manifest.start;
  const T = new Float32Array(n).fill(Infinity);
  const heap = new Heap();
  let burned = 0;
  let seeds = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    if (!(minArr[i] <= rel)) continue;
    T[i] = 0;
    burned++;
    sx += i % gw;
    sy += (i / gw) | 0;
  }
  if (burned) {
    const edgeFrom = rel - ACTIVE_EDGE_MIN * 60_000;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (T[i] !== 0 || minArr[i] < edgeFrom) continue;
        let edge = false;
        if (x > 0 && T[i - 1] !== 0) edge = true;
        else if (x < gw - 1 && T[i + 1] !== 0) edge = true;
        else if (y > 0 && T[i - gw] !== 0) edge = true;
        else if (y < gh - 1 && T[i + gw] !== 0) edge = true;
        if (edge) {
          heap.push(0, i);
          seeds++;
        }
      }
    }
  }

  solveTravelTime({ gw, gh, dxM: g.dxM, dyM: g.dyM, fuel, elev, t: T, heap, horizonMin,
    weatherAt: (hour) => wx(issuedAt + (hour + 0.5) * 3_600_000) });
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    issuedAt,
    horizonMin,
    grid: g,
    t: T,
    burned,
    seeds,
    center: burned ? gridGeo(g, sx / burned - 0.5, sy / burned - 0.5) : null,
    computeMs: t1 - t0,
  };
}

/** Minimum modelled minutes-after-issue within radiusM of p (Infinity if not reached, -1 outside the grid). */
export function fieldMinAt(f: SpreadField, p: Geo, radiusM = 0): number {
  const g = f.grid;
  const c = gridIndex(g, p);
  if (c < 0) return -1;
  const cx = c % g.gw;
  const cy = (c / g.gw) | 0;
  const rx = Math.ceil(radiusM / g.dxM);
  const ry = Math.ceil(radiusM / g.dyM);
  let best = Infinity;
  for (let y = Math.max(0, cy - ry); y <= Math.min(g.gh - 1, cy + ry); y++) {
    for (let x = Math.max(0, cx - rx); x <= Math.min(g.gw - 1, cx + rx); x++) {
      if (rx && ry && ((x - cx) * g.dxM) ** 2 + ((y - cy) * g.dyM) ** 2 > radiusM * radiusM) continue;
      const v = f.t[y * g.gw + x];
      if (v < best) best = v;
    }
  }
  return best;
}

/** Predicted burned mask at issuedAt + horizonMin. */
export function fieldMask(f: SpreadField, horizonMin: number): Uint8Array {
  const out = new Uint8Array(f.t.length);
  for (let i = 0; i < out.length; i++) if (f.t[i] <= horizonMin) out[i] = 1;
  return out;
}
