import type { Geo } from '../../contracts';

// Pure evacuation-routing helpers for the simulated Mati exercise. Routes are
// prototype shortest paths on OSM geometry, not validated evacuation guidance.

export interface Road { id: string; name?: string; kind: string; coords: Geo[] }

export interface RoadGraph {
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  readonly adj: { to: number; lengthM: number; name: string; weight: number }[][];
  readonly edgeCount: number;
}

export interface Exit { id: string; label: string; pos: Geo }

export interface Hazard { blocked: Geo[][]; caution: Geo[][] }

export interface EscapeRoute { exit: Exit; path: Geo[]; lengthM: number; roads: string[]; cautionM: number; roadMeters?: Record<string, number> }

export type AlertStage = 'monitor' | 'prepare' | 'leave' | 'shelter';
/** User-facing stage labels; internal id 'shelter' is shown neutrally and never advises sheltering. */
export const STAGE_LABEL: Record<AlertStage, string> = { monitor: 'MONITOR', prepare: 'PREPARE TO LEAVE', leave: 'LEAVE NOW', shelter: 'FIRE VERY CLOSE' };
export const VERY_CLOSE_TEXT = 'Fire very close: follow 112 instructions now';

const SNAP = 1e5;
const CAUTION_FACTOR = 6;
// osm.json kinds are exactly highway | road | track; unknown kinds cost like 'road'.
const KIND_WEIGHT: Record<string, number> = { highway: 0.5, road: 1, track: 4 };
const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;

export function distanceM(a: Geo, b: Geo): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pointInPolygon(p: Geo, poly: Geo[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.lat > p.lat) !== (b.lat > p.lat) && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

export function buildRoadGraph(roads: Road[]): RoadGraph {
  const index = new Map<string, number>();
  const lons: number[] = [];
  const lats: number[] = [];
  const adj: { to: number; lengthM: number; name: string; weight: number }[][] = [];
  const seen = new Map<string, [{ weight: number }, { weight: number }]>();
  let edgeCount = 0;
  const nodeOf = (c: Geo): number => {
    const x = Math.round(c.lon * SNAP);
    const y = Math.round(c.lat * SNAP);
    const key = `${x},${y}`;
    let id = index.get(key);
    if (id === undefined) {
      id = lons.length;
      index.set(key, id);
      lons.push(x / SNAP);
      lats.push(y / SNAP);
      adj.push([]);
    }
    return id;
  };
  for (const road of roads) {
    const name = road.name ?? '';
    const weight = KIND_WEIGHT[road.kind] ?? 1;
    let prev = -1;
    for (const c of road.coords) {
      const n = nodeOf(c);
      if (prev >= 0 && prev !== n) {
        const key = prev < n ? `${prev}-${n}` : `${n}-${prev}`;
        const dup = seen.get(key);
        if (!dup) {
          const lengthM = distanceM({ lon: lons[prev], lat: lats[prev] }, { lon: lons[n], lat: lats[n] });
          const a = { to: n, lengthM, name, weight };
          const b = { to: prev, lengthM, name, weight };
          adj[prev].push(a);
          adj[n].push(b);
          seen.set(key, [a, b]);
          edgeCount++;
        } else if (weight < dup[0].weight) {
          dup[0].weight = weight;
          dup[1].weight = weight;
        }
      }
      prev = n;
    }
  }
  return { lon: Float64Array.from(lons), lat: Float64Array.from(lats), adj, edgeCount };
}

function nearestIndex(g: RoadGraph, p: Geo): number {
  const kx = Math.cos(p.lat * RAD);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < g.lon.length; i++) {
    const dx = (g.lon[i] - p.lon) * kx;
    const dy = g.lat[i] - p.lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function nearestNode(g: RoadGraph, p: Geo): Geo {
  const i = nearestIndex(g, p);
  return i < 0 ? { lon: p.lon, lat: p.lat } : { lon: g.lon[i], lat: g.lat[i] };
}

const coord = (p: Geo) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
interface Directions { origin: Geo; destination: Geo; waypoints?: Geo[]; travelmode?: 'driving' | 'walking' | 'bicycling' | 'transit' }

export function googleMapsDirectionsUrl({ origin, destination, waypoints = [], travelmode = 'driving' }: Directions): string {
  const q = new URLSearchParams({ api: '1', origin: coord(origin), destination: coord(destination), travelmode });
  if (waypoints.length) q.set('waypoints', waypoints.slice(0, 9).map(coord).join('|'));
  return `https://www.google.com/maps/dir/?${q}`;
}

export function googleMapsEmbedUrl({ origin, destination, waypoints = [] }: Directions, key: string): string {
  const q = new URLSearchParams({ key, origin: coord(origin), destination: coord(destination), mode: 'driving' });
  if (waypoints.length) q.set('waypoints', waypoints.slice(0, 9).map(coord).join('|'));
  return `https://www.google.com/maps/embed/v1/directions?${q}`;
}

export function steeringWaypoints(path: Geo[], max = 3): Geo[] {
  const count = Math.max(0, Math.min(9, Math.floor(max)));
  if (path.length < 3 || !count) return [];
  const ds = [0];
  for (let i = 1; i < path.length; i++) ds.push(ds[i - 1] + distanceM(path[i - 1], path[i]));
  const total = ds[ds.length - 1];
  const out: Geo[] = [];
  for (let k = 1; k <= count; k++) {
    const target = total * k / (count + 1);
    let best = -1;
    for (let i = 1; i < path.length - 1; i++) {
      if (ds[i] < 100 || total - ds[i] < 100 || out.includes(path[i])) continue;
      if (best < 0 || Math.abs(ds[i] - target) < Math.abs(ds[best] - target)) best = i;
    }
    if (best >= 0) out.push(path[best]);
  }
  return out.sort((a, b) => path.indexOf(a) - path.indexOf(b));
}

// Exit nodes verified against public/data/mati/osm.json: last Marathonos Ave node at the
// north bbox edge, the Marathonos Ave node at the west bbox edge (Pallini/Pikermi side),
// and the Rafina port (east) end of Alexandrou Fleming highway (see check-evac.mts output).
export const MATI_EXITS: Exit[] = [
  { id: 'exit-north', label: 'North · Nea Makri / Marathon', pos: { lon: 23.97102, lat: 38.10039 } },
  { id: 'exit-south', label: 'South · Rafina port', pos: { lon: 24.00715, lat: 38.02035 } },
  { id: 'exit-west', label: 'West · Pikermi / Athens', pos: { lon: 23.86924, lat: 38.00565 } },
];

export const NO_EXIT_ZONES: { id: string; label: string; center: Geo; radiusM: number }[] = [
  { id: 'mati-coast', label: 'Mati coast · no road exit', center: { lon: 23.99663, lat: 38.04091 }, radiusM: 1100 },
];

function inNoExitZone(p: Geo): boolean {
  for (const z of NO_EXIT_ZONES) if (distanceM(p, z.center) <= z.radiusM) return true;
  return false;
}

interface PreparedPoly { poly: Geo[]; minLon: number; maxLon: number; minLat: number; maxLat: number }

function prepare(polys: Geo[][]): PreparedPoly[] {
  return polys.filter((poly) => poly.length >= 3).map((poly) => {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const v of poly) {
      if (v.lon < minLon) minLon = v.lon;
      if (v.lon > maxLon) maxLon = v.lon;
      if (v.lat < minLat) minLat = v.lat;
      if (v.lat > maxLat) maxLat = v.lat;
    }
    return { poly, minLon, maxLon, minLat, maxLat };
  });
}

function inAny(p: Geo, polys: PreparedPoly[]): boolean {
  for (const q of polys) {
    if (p.lon < q.minLon || p.lon > q.maxLon || p.lat < q.minLat || p.lat > q.maxLat) continue;
    if (pointInPolygon(p, q.poly)) return true;
  }
  return false;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.keys;
    const v = this.vals;
    const topK = k[0];
    const topV = v[0];
    const lastK = k.pop() as number;
    const lastV = v.pop() as number;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lastK) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastK;
      v[i] = lastV;
    }
    return [topK, topV];
  }
}

export function polygonDistanceM(p: Geo, poly: Geo[]): number {
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  const sx = 111320 * Math.cos(p.lat * RAD), sy = 111320;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ax = (a.lon - p.lon) * sx, ay = (a.lat - p.lat) * sy;
    const dx = (b.lon - a.lon) * sx, dy = (b.lat - a.lat) * sy;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

function crosses(a: Geo, b: Geo, polys: PreparedPoly[]): boolean {
  if (inAny(a, polys) || inAny(b, polys)) return true;
  const side = (p: Geo, q: Geo, r: Geo) => (q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon);
  return polys.some(({ poly, minLon, maxLon, minLat, maxLat }) => {
    if (Math.max(a.lon, b.lon) < minLon || Math.min(a.lon, b.lon) > maxLon || Math.max(a.lat, b.lat) < minLat || Math.min(a.lat, b.lat) > maxLat) return false;
    return poly.some((c, i) => {
      const d = poly[(i + 1) % poly.length];
      if (Math.max(a.lon, b.lon) < Math.min(c.lon, d.lon) || Math.min(a.lon, b.lon) > Math.max(c.lon, d.lon) || Math.max(a.lat, b.lat) < Math.min(c.lat, d.lat) || Math.min(a.lat, b.lat) > Math.max(c.lat, d.lat)) return false;
      return side(a, b, c) * side(a, b, d) <= 0 && side(c, d, a) * side(c, d, b) <= 0;
    });
  });
}

/** Share of segment a→b inside caution polygons, sampled every ~20 m; a crossing thinner than one sample still counts one sample. */
function cautionShare(a: Geo, b: Geo, polys: PreparedPoly[], lengthM: number): number {
  if (polys.length === 0) return 0;
  const steps = Math.max(2, Math.ceil(lengthM / 20));
  let inside = 0;
  for (let k = 0; k < steps; k++) {
    const f = (k + 0.5) / steps;
    if (inAny({ lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f }, polys)) inside++;
  }
  if (inside === 0 && crosses(a, b, polys)) inside = 1;
  return inside / steps;
}

export function escapeRoutes(g: RoadGraph, from: Geo, hazard: Hazard, exits: Exit[], options: { clearanceM?: number } = {}): EscapeRoute[] {
  const n = g.lon.length;
  if (n === 0) return [];
  const blocked = prepare(hazard.blocked);
  const caution = prepare(hazard.caution);
  const nodeBlocked = new Int8Array(n); // 0 unknown, 1 clear, 2 blocked
  const isBlocked = (i: number): boolean => {
    if (nodeBlocked[i] === 0) nodeBlocked[i] = inAny({ lon: g.lon[i], lat: g.lat[i] }, blocked) ? 2 : 1;
    return nodeBlocked[i] === 2;
  };

  const snapped = nearestNode(g, from);
  const start = nearestIndex(g, snapped);
  if (inAny(from, blocked) || crosses(from, snapped, blocked)) return [];
  const targets = new Map<number, Exit[]>();
  for (const exit of exits) {
    if (inNoExitZone(exit.pos)) continue;
    const t = nearestIndex(g, exit.pos);
    if (inNoExitZone({ lon: g.lon[t], lat: g.lat[t] })) continue;
    const list = targets.get(t);
    if (list) list.push(exit);
    else targets.set(t, [exit]);
  }
  if (targets.size === 0 || isBlocked(start)) return [];

  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevEdge: ({ lengthM: number; name: string; cautionM: number } | null)[] = new Array(n).fill(null);
  const done = new Uint8Array(n);
  const heap = new MinHeap();
  dist[start] = 0;
  heap.push(0, start);
  let remaining = targets.size;

  while (heap.size > 0 && remaining > 0) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (targets.has(u)) remaining--;
    for (const e of g.adj[u]) {
      const v = e.to;
      if (done[v] || isBlocked(v)) continue;
      const mid = { lon: (g.lon[u] + g.lon[v]) / 2, lat: (g.lat[u] + g.lat[v]) / 2 };
      if (crosses({ lon: g.lon[u], lat: g.lat[u] }, { lon: g.lon[v], lat: g.lat[v] }, blocked)) continue;
      const share = inNoExitZone(mid) ? 1 : cautionShare({ lon: g.lon[u], lat: g.lat[u] }, { lon: g.lon[v], lat: g.lat[v] }, caution, e.lengthM);
      const clearance = options.clearanceM ?? 0;
      let near = 0;
      if (clearance > 0) {
        const distance = Math.min(...[...blocked, ...caution].map((p) => polygonDistanceM(mid, p.poly)));
        near = 8 * Math.max(0, 1 - distance / clearance);
      }
      const nd = d + e.lengthM * e.weight * (1 + (CAUTION_FACTOR - 1) * share + near);
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        prevEdge[v] = { lengthM: e.lengthM, name: e.name, cautionM: e.lengthM * share };
        heap.push(nd, v);
      }
    }
  }

  const routes: { route: EscapeRoute; cost: number }[] = [];
  for (const [t, list] of targets) {
    if (!done[t]) continue;
    const nodes: number[] = [];
    const names: string[] = [];
    let lengthM = 0;
    let cautionM = 0;
    const roadMeters: Record<string, number> = {};
    for (let i = t; i !== -1; i = prev[i]) {
      nodes.push(i);
      const e = prevEdge[i];
      if (e) {
        lengthM += e.lengthM;
        cautionM += e.cautionM;
        names.push(e.name);
        if (e.name) roadMeters[e.name] = (roadMeters[e.name] ?? 0) + e.lengthM;
      }
    }
    nodes.reverse();
    names.reverse();
    const roads: string[] = [];
    for (const name of names) if (name && roads[roads.length - 1] !== name) roads.push(name);
    const path = nodes.map((i) => ({ lon: g.lon[i], lat: g.lat[i] }));
    for (const exit of list) routes.push({ route: { exit, path, lengthM, roads, cautionM, roadMeters }, cost: dist[t] });
  }
  routes.sort((a, b) => a.cost - b.cost);
  return routes.map((r) => r.route);
}

export function summarizeRoads(route: EscapeRoute, maxNames = 4): string[] {
  const meters = route.roadMeters;
  if (!meters) return route.roads.slice(0, maxNames);
  const order: string[] = [];
  for (const name of route.roads) if (!order.includes(name)) order.push(name);
  const top = new Set([...order].sort((a, b) => (meters[b] ?? 0) - (meters[a] ?? 0)).slice(0, Math.max(0, maxNames)));
  return order.filter((name) => top.has(name));
}

export function alertStage(etaMin: number | null, inBlocked: boolean): AlertStage {
  if (inBlocked) return 'shelter';
  if (etaMin === null || etaMin > 180) return 'monitor';
  if (etaMin <= 60) return 'leave';
  return 'prepare';
}

export function leaveBy(etaMs: number, prepMin = 45): number {
  return etaMs - prepMin * 60_000;
}

export function residentsNear(buildings: { pos: Geo; kind: string }[], center: Geo, radiusM: number, perBuilding = 2.4): number {
  let count = 0;
  for (const b of buildings) if (distanceM(b.pos, center) <= radiusM) count++;
  return Math.round(count * perBuilding);
}
