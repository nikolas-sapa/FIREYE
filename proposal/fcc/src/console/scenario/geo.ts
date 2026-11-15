import type { Geo, Ms, ScenarioPack } from '../contracts';

/**
 * Geo helpers over the scenario raster. Grid is equal-angle over manifest.bbox, row 0 = north.
 * All times are absolute scenario epoch ms (same clock as ConsoleState.clock.t); arrival values
 * in the pack are relative to manifest.start and converted here.
 */

const DEG = Math.PI / 180;
const R_EARTH = 6371008.8;

/** Window for the "active edge" state in fireFieldAt (cells that ignited within this many ms). */
export const ACTIVE_EDGE_MS = 90 * 60e3;

/**
 * Active-edge window for a pack: manifest `activeEdgeMin` when present (Mati: 15 min, a fast two-hour run),
 * else ACTIVE_EDGE_MS (Caldor).
 */
export function activeEdgeMs(pack: ScenarioPack): number {
  const m = (pack.manifest as { activeEdgeMin?: number }).activeEdgeMin;
  return typeof m === 'number' && m > 0 ? m * 60e3 : ACTIVE_EDGE_MS;
}

export const FIRE_UNBURNED = 0;
export const FIRE_ACTIVE = 1;
export const FIRE_BURNED = 2;

/** Fractional cell coordinates (x east, y south; integer + 0.5 = cell centre). Not clamped. */
export function geoToCellF(pack: ScenarioPack, geo: Geo): { x: number; y: number } {
  const { w, h, bbox } = pack.raster;
  return { x: ((geo.lon - bbox[0]) / (bbox[2] - bbox[0])) * w, y: ((bbox[3] - geo.lat) / (bbox[3] - bbox[1])) * h };
}

/** Integer cell index containing geo, clamped to the grid. */
export function geoToCell(pack: ScenarioPack, geo: Geo): { x: number; y: number } {
  const { w, h } = pack.raster;
  const f = geoToCellF(pack, geo);
  return { x: Math.min(w - 1, Math.max(0, Math.floor(f.x))), y: Math.min(h - 1, Math.max(0, Math.floor(f.y))) };
}

/** Geographic centre of cell (x, y). Fractional inputs interpolate linearly (x + 0.5 is the centre). */
export function cellToGeo(pack: ScenarioPack, x: number, y: number): Geo {
  const { w, h, bbox } = pack.raster;
  return { lon: bbox[0] + ((x + 0.5) / w) * (bbox[2] - bbox[0]), lat: bbox[3] - ((y + 0.5) / h) * (bbox[3] - bbox[1]) };
}

export function inBounds(pack: ScenarioPack, geo: Geo): boolean {
  const b = pack.raster.bbox;
  return geo.lon >= b[0] && geo.lon <= b[2] && geo.lat >= b[1] && geo.lat <= b[3];
}

/** Bilinear terrain elevation (m) at geo; clamps outside the grid. */
export function elevationAt(pack: ScenarioPack, geo: Geo): number {
  const { w, h } = pack.raster;
  const f = geoToCellF(pack, geo);
  const fx = Math.min(w - 1, Math.max(0, f.x - 0.5));
  const fy = Math.min(h - 1, Math.max(0, f.y - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const e = pack.elevation;
  const a = e[y0 * w + x0], b = e[y0 * w + x1], c = e[y1 * w + x0], d = e[y1 * w + x1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/** Fuel class (FuelClass) at geo. */
export function fuelAt(pack: ScenarioPack, geo: Geo): number {
  const c = geoToCell(pack, geo);
  return pack.fuel[c.y * pack.raster.w + c.x];
}

/** Absolute arrival time (epoch ms) of cell (x, y), or Infinity if it never burns in the data. */
export function arrivalAt(pack: ScenarioPack, x: number, y: number): Ms {
  const { w, h } = pack.raster;
  if (x < 0 || y < 0 || x >= w || y >= h) return Infinity;
  const a = pack.arrival[(y | 0) * w + (x | 0)];
  return a === a ? pack.manifest.start + a : Infinity;
}

/** Absolute arrival time (epoch ms) at geo, or Infinity. */
export function arrivalAtGeo(pack: ScenarioPack, geo: Geo): Ms {
  const c = geoToCell(pack, geo);
  return inBounds(pack, geo) ? arrivalAt(pack, c.x, c.y) : Infinity;
}

/** True if cell (x, y) has burned by absolute time t. */
export function isBurnedAt(pack: ScenarioPack, x: number, y: number, t: Ms): boolean {
  const { w, h } = pack.raster;
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  return pack.arrival[(y | 0) * w + (x | 0)] <= t - pack.manifest.start;
}

/**
 * Fire state per cell at absolute time t: 0 unburned, 1 active edge (ignited within activeEdgeMs(pack)), 2 burned.
 * Pass `out` (length w*h) to avoid allocation; ~2-4 ms for the full grid.
 */
export function fireFieldAt(pack: ScenarioPack, t: Ms, out?: Uint8Array): Uint8Array {
  const arr = pack.arrival;
  const n = arr.length;
  const field = out && out.length === n ? out : new Uint8Array(n);
  const rel = t - pack.manifest.start;
  const edge = rel - activeEdgeMs(pack);
  for (let i = 0; i < n; i++) {
    const a = arr[i];
    // NaN compares false on both branches -> unburned.
    field[i] = a <= edge ? 2 : a <= rel ? 1 : 0;
  }
  return field;
}

/** Burned area (acres) at absolute time t. Uses per-row cell area (equal-angle grid). */
export function burnedAcresAt(pack: ScenarioPack, t: Ms): number {
  const { w, h, bbox } = pack.raster;
  const rel = t - pack.manifest.start;
  const dLon = ((bbox[2] - bbox[0]) / w) * DEG;
  const dLat = ((bbox[3] - bbox[1]) / h) * DEG;
  let acres = 0;
  for (let y = 0; y < h; y++) {
    const lat = (bbox[3] - ((y + 0.5) / h) * (bbox[3] - bbox[1])) * DEG;
    const cellM2 = R_EARTH * R_EARTH * dLon * dLat * Math.cos(lat);
    let n = 0;
    for (let x = 0, i = y * w; x < w; x++, i++) if (pack.arrival[i] <= rel) n++;
    acres += (n * cellM2) / 4046.8564224;
  }
  return acres;
}

/** Burned area (hectares) at absolute time t. */
export function burnedHaAt(pack: ScenarioPack, t: Ms): number {
  return burnedAcresAt(pack, t) * 0.40468564224;
}

/* ------------------------------------------------------------------ spherical geometry */

/** Great-circle distance in meters. */
export function distanceM(a: Geo, b: Geo): number {
  const p1 = a.lat * DEG, p2 = b.lat * DEG;
  const dp = p2 - p1, dl = (b.lon - a.lon) * DEG;
  const s = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b, degrees true [0, 360). */
export function bearingDeg(a: Geo, b: Geo): number {
  const p1 = a.lat * DEG, p2 = b.lat * DEG, dl = (b.lon - a.lon) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

/** Point reached from geo travelling `meters` on `bearing` (degrees true). Preserves alt. */
export function destination(geo: Geo, bearing: number, meters: number): Geo {
  const d = meters / R_EARTH, th = bearing * DEG;
  const p1 = geo.lat * DEG, l1 = geo.lon * DEG;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  const out: Geo = { lon: ((l2 / DEG + 540) % 360) - 180, lat: p2 / DEG };
  if (geo.alt !== undefined) out.alt = geo.alt;
  return out;
}

/** Linear interpolation between two positions (fine for the few-km scales used here). */
export function lerpGeo(a: Geo, b: Geo, f: number): Geo {
  return { lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f };
}

/** Total length of a polyline in meters. */
export function pathLengthM(path: Geo[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += distanceM(path[i - 1], path[i]);
  return s;
}

/** Position at distance `meters` along a polyline (clamped to its ends) plus the local heading. */
export function alongPath(path: Geo[], meters: number): { pos: Geo; heading: number; done: boolean } {
  if (path.length === 0) return { pos: { lon: 0, lat: 0 }, heading: 0, done: true };
  if (path.length === 1) return { pos: path[0], heading: 0, done: true };
  let rem = Math.max(0, meters);
  for (let i = 1; i < path.length; i++) {
    const seg = distanceM(path[i - 1], path[i]);
    if (rem <= seg) return { pos: lerpGeo(path[i - 1], path[i], seg > 0 ? rem / seg : 0), heading: bearingDeg(path[i - 1], path[i]), done: false };
    rem -= seg;
  }
  const n = path.length;
  return { pos: path[n - 1], heading: bearingDeg(path[n - 2], path[n - 1]), done: true };
}

/** Ray-cast point-in-polygon (lon/lat ring). */
export function pointInPolygon(p: Geo, ring: Geo[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------ road graph */

interface RoadGraph {
  lon: Float64Array;
  lat: Float64Array;
  adj: Int32Array[];
  w: Float32Array[];
  /** Spatial hash: cell key -> node ids, for nearest-node lookup. */
  buckets: Map<number, number[]>;
  bucketDeg: number;
}

const graphCache = new WeakMap<ScenarioPack, RoadGraph>();

function buildGraph(pack: ScenarioPack): RoadGraph {
  const ids = new Map<string, number>();
  const lon: number[] = [], lat: number[] = [];
  const adjL: number[][] = [], wL: number[][] = [];
  const node = (g: Geo) => {
    const k = `${g.lon.toFixed(5)},${g.lat.toFixed(5)}`;
    let id = ids.get(k);
    if (id === undefined) {
      id = lon.length;
      ids.set(k, id);
      lon.push(g.lon); lat.push(g.lat); adjL.push([]); wL.push([]);
    }
    return id;
  };
  const penalty = { highway: 1, road: 1.15, track: 1.8 } as const;
  for (const r of pack.roads) {
    const pen = penalty[r.kind] ?? 1.2;
    for (let i = 1; i < r.coords.length; i++) {
      const a = node(r.coords[i - 1]), b = node(r.coords[i]);
      if (a === b) continue;
      const d = distanceM(r.coords[i - 1], r.coords[i]) * pen;
      adjL[a].push(b); wL[a].push(d);
      adjL[b].push(a); wL[b].push(d);
    }
  }
  const bucketDeg = 0.01;
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < lon.length; i++) {
    const k = Math.floor(lon[i] / bucketDeg) * 100000 + Math.floor(lat[i] / bucketDeg);
    const b = buckets.get(k);
    if (b) b.push(i); else buckets.set(k, [i]);
  }
  return {
    lon: Float64Array.from(lon), lat: Float64Array.from(lat),
    adj: adjL.map((a) => Int32Array.from(a)), w: wL.map((a) => Float32Array.from(a)),
    buckets, bucketDeg,
  };
}

function nearestNode(g: RoadGraph, p: Geo, maxRings = 6): { id: number; d: number } {
  const bx = Math.floor(p.lon / g.bucketDeg), by = Math.floor(p.lat / g.bucketDeg);
  let best = -1, bestD = Infinity;
  for (let r = 0; r <= maxRings; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const b = g.buckets.get((bx + dx) * 100000 + (by + dy));
      if (!b) continue;
      for (const i of b) {
        const d = distanceM(p, { lon: g.lon[i], lat: g.lat[i] });
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    // A ring r guarantees everything within r buckets has been seen.
    if (best >= 0 && bestD < r * g.bucketDeg * 85000) break;
  }
  return { id: best, d: bestD };
}

/**
 * Road path from `from` to `to`: snap both ends to the nearest road vertex (within 3 km), A* over the
 * OSM road graph (tracks penalised), and return [from, ...road vertices, to]. Falls back to a straight line.
 */
export function nearestRoadPath(pack: ScenarioPack, from: Geo, to: Geo): Geo[] {
  if (!pack.roads.length) return [from, to];
  let g = graphCache.get(pack);
  if (!g) { g = buildGraph(pack); graphCache.set(pack, g); }
  const a = nearestNode(g, from), b = nearestNode(g, to);
  if (a.id < 0 || b.id < 0 || a.d > 3000 || b.d > 3000) return [from, to];
  if (a.id === b.id) return [from, { lon: g.lon[a.id], lat: g.lat[a.id] }, to];
  const n = g.lon.length;
  const gs = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const goal: Geo = { lon: g.lon[b.id], lat: g.lat[b.id] };
  const hK: number[] = [], hV: number[] = [];
  const push = (k: number, v: number) => {
    let i = hK.length;
    hK.push(k); hV.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hK[p] <= k) break;
      hK[i] = hK[p]; hV[i] = hV[p]; i = p;
    }
    hK[i] = k; hV[i] = v;
  };
  const pop = () => {
    const top = hV[0];
    const k = hK.pop()!, v = hV.pop()!;
    if (hK.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= hK.length) break;
        if (c + 1 < hK.length && hK[c + 1] < hK[c]) c++;
        if (hK[c] >= k) break;
        hK[i] = hK[c]; hV[i] = hV[c]; i = c;
      }
      hK[i] = k; hV[i] = v;
    }
    return top;
  };
  gs[a.id] = 0;
  push(distanceM({ lon: g.lon[a.id], lat: g.lat[a.id] }, goal), a.id);
  let found = false;
  while (hK.length) {
    const u = pop();
    if (closed[u]) continue;
    if (u === b.id) { found = true; break; }
    closed[u] = 1;
    const adj = g.adj[u], wt = g.w[u];
    for (let k = 0; k < adj.length; k++) {
      const v = adj[k];
      const nd = gs[u] + wt[k];
      if (nd < gs[v]) {
        gs[v] = nd; prev[v] = u;
        push(nd + distanceM({ lon: g.lon[v], lat: g.lat[v] }, goal), v);
      }
    }
  }
  if (!found) return [from, to];
  const out: Geo[] = [];
  for (let v = b.id; v >= 0; v = prev[v]) out.push({ lon: g.lon[v], lat: g.lat[v] });
  out.reverse();
  return [from, ...out, to];
}
