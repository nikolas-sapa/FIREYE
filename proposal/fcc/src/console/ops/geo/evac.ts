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

export function escapeRoutes(g: RoadGraph, from: Geo, hazard: Hazard, exits: Exit[]): EscapeRoute[] {
  const n = g.lon.length;
  if (n === 0) return [];
  const blocked = prepare(hazard.blocked);
  const caution = prepare(hazard.caution);
  const nodeBlocked = new Int8Array(n); // 0 unknown, 1 clear, 2 blocked
  const isBlocked = (i: number): boolean => {
    if (nodeBlocked[i] === 0) nodeBlocked[i] = inAny({ lon: g.lon[i], lat: g.lat[i] }, blocked) ? 2 : 1;
    return nodeBlocked[i] === 2;
  };

  const start = nearestIndex(g, from);
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
  const prevEdge: ({ lengthM: number; name: string; caution: boolean } | null)[] = new Array(n).fill(null);
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
      if (inAny(mid, blocked)) continue;
      const slow = inAny(mid, caution) || inNoExitZone(mid);
      const nd = d + e.lengthM * e.weight * (slow ? CAUTION_FACTOR : 1);
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
        prevEdge[v] = { lengthM: e.lengthM, name: e.name, caution: slow };
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
        if (e.caution) cautionM += e.lengthM;
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
