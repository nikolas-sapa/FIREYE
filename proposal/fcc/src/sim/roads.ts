/** Road graph over WorldMeta roads, for routing ground movements along roads. */
import type { Vec, WorldMeta } from './types';
import { GRID_H, GRID_W } from './types';

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export interface RoadGraph {
  route(from: Vec, to: Vec): Vec[];
  nearest(p: Vec): { p: Vec; d: number; road: string };
}

export function buildRoadGraph(meta: WorldMeta, includeTrails = false): RoadGraph {
  const nodes: Vec[] = [];
  const road: string[] = [];
  const adj: { to: number; w: number }[][] = [];
  const link = (a: number, b: number) => {
    const w = dist(nodes[a], nodes[b]);
    adj[a].push({ to: b, w });
    adj[b].push({ to: a, w });
  };
  const ranges: { id: string; a: number; b: number }[] = [];
  for (const r of meta.roads) {
    if (r.kind === 'trail' && !includeTrails) continue;
    const a = nodes.length;
    for (const q of r.points) {
      if (q.x < -1 || q.y < -1 || q.x > GRID_W + 1 || q.y > GRID_H + 1) continue;
      const k = nodes.push({ x: q.x, y: q.y }) - 1;
      road.push(r.id);
      adj.push([]);
      if (k > a) link(k - 1, k);
    }
    ranges.push({ id: r.id, a, b: nodes.length - 1 });
  }
  // Junctions: crossings (close points on different roads) and road ends near another road.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (road[i] === road[j]) continue;
      if (dist(nodes[i], nodes[j]) < 1.6) link(i, j);
    }
  }
  for (const rg of ranges) {
    for (const end of [rg.a, rg.b]) {
      let best = Infinity, bj = -1;
      for (let j = 0; j < nodes.length; j++) {
        if (road[j] === rg.id) continue;
        const d = dist(nodes[end], nodes[j]);
        if (d < best) { best = d; bj = j; }
      }
      if (bj >= 0 && best < 6) link(end, bj);
    }
  }

  function nearestIdx(p: Vec) {
    let best = Infinity, bi = 0;
    for (let i = 0; i < nodes.length; i++) {
      const d = dist(p, nodes[i]);
      if (d < best) { best = d; bi = i; }
    }
    return { i: bi, d: best };
  }

  function dijkstra(s: number, t: number): number[] | null {
    const n = nodes.length;
    const dd = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    dd[s] = 0;
    for (;;) {
      let u = -1, bu = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dd[i] < bu) { bu = dd[i]; u = i; }
      if (u < 0) return null;
      if (u === t) break;
      done[u] = 1;
      for (const e of adj[u]) {
        const nd = dd[u] + e.w;
        if (nd < dd[e.to]) { dd[e.to] = nd; prev[e.to] = u; }
      }
    }
    const path: number[] = [];
    for (let v = t; v >= 0; v = prev[v]) path.push(v);
    return path.reverse();
  }

  return {
    nearest(p) {
      const r = nearestIdx(p);
      return { p: { ...nodes[r.i] }, d: r.d, road: road[r.i] };
    },
    route(from, to) {
      const direct = dist(from, to);
      if (!nodes.length) return [{ ...from }, { ...to }];
      const a = nearestIdx(from), b = nearestIdx(to);
      // Off-road legs that dwarf the road leg: go cross-country.
      if (a.i === b.i || a.d + b.d > direct * 0.9) return [{ ...from }, { ...to }];
      const path = dijkstra(a.i, b.i);
      if (!path) return [{ ...from }, { ...to }];
      const out: Vec[] = [{ ...from }];
      let last = from;
      for (const k of path) {
        const q = nodes[k];
        if (dist(q, last) >= 1.5) { out.push({ x: q.x, y: q.y }); last = q; }
      }
      out.push({ ...to });
      return out;
    },
  };
}
