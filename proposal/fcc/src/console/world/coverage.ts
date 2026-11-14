import type { Geo } from '../contracts';
import type { Sim } from './sim';
import { MIN, bboxOf, distanceM } from './geo';
import { sweepUnit } from './units';

const CELL_M = 1600;
const MAX_CELLS = 30;

function cellGeom(sim: Sim, ix: number, iy: number): { poly: Geo[]; center: Geo; dLon: number; dLat: number } {
  const b = sim.ctx.pack.raster.bbox;
  const lat0 = (b[1] + b[3]) / 2;
  const dLon = CELL_M / (111320 * Math.cos((lat0 * Math.PI) / 180));
  const dLat = CELL_M / 110574;
  const w = b[0] + ix * dLon;
  const n = b[3] - iy * dLat;
  return {
    poly: [
      { lon: w, lat: n },
      { lon: w + dLon, lat: n },
      { lon: w + dLon, lat: n - dLat },
      { lon: w, lat: n - dLat },
    ],
    center: { lon: w + dLon / 2, lat: n - dLat / 2 },
    dLon,
    dLat,
  };
}

/** Lawnmower legs inside a coverage cell (4 east-west passes, 200 m inset). */
export function sweepLegs(sim: Sim, cellId: string): Geo[] {
  const [, xs, ys] = cellId.split('-');
  const g = cellGeom(sim, Number(xs), Number(ys));
  const inset = 200 / CELL_M;
  const w = g.poly[0].lon + g.dLon * inset;
  const e = g.poly[1].lon - g.dLon * inset;
  const n = g.poly[0].lat - g.dLat * inset;
  const s = g.poly[3].lat + g.dLat * inset;
  const legs: Geo[] = [];
  for (let k = 0; k < 4; k++) {
    const lat = n - ((n - s) * k) / 3;
    if (k % 2 === 0) legs.push({ lon: w, lat }, { lon: e, lat });
    else legs.push({ lon: e, lat }, { lon: w, lat });
  }
  return legs;
}

/** Rebuilds the drone coverage grid over the active front + 6 h projection and assigns free drones. */
export function rebuildCoverage(sim: Sim): void {
  const proj = sim.projection;
  const band = proj?.bands.find((b) => b.horizonMin === 360)?.polygon;
  if (!band || band.length < 3) return;
  const pack = sim.ctx.pack;
  const b = pack.raster.bbox;
  const [w, s, e, n] = bboxOf(band);
  const g0 = cellGeom(sim, 0, 0);
  const ix0 = Math.max(0, Math.floor((w - b[0]) / g0.dLon));
  const ix1 = Math.floor((e - b[0]) / g0.dLon);
  const iy0 = Math.max(0, Math.floor((b[3] - n) / g0.dLat));
  const iy1 = Math.floor((b[3] - s) / g0.dLat);
  const t = sim.t;
  const bias = sim.projBias;
  const cells: { id: string; polygon: Geo[]; interest: number; unitId?: string; center: Geo }[] = [];
  for (let iy = iy0; iy <= iy1; iy++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const g = cellGeom(sim, ix, iy);
      let acc = 0;
      for (let a = 0; a < 5; a++) {
        for (let c = 0; c < 5; c++) {
          const p = { lon: g.poly[0].lon + g.dLon * ((a + 0.5) / 5), lat: g.poly[0].lat - g.dLat * ((c + 0.5) / 5) };
          const arr = sim.ctx.arrivalAt(p);
          if (!Number.isFinite(arr)) continue;
          const dt = (arr - t) / MIN;
          if (dt <= 0 && dt > -90) acc += 1;
          else if (dt > 0 && dt <= 60 * bias) acc += 0.9;
          else if (dt > 0 && dt <= 180 * bias) acc += 0.6;
          else if (dt > 0 && dt <= 360 * bias) acc += 0.3;
        }
      }
      let interest = acc / 25;
      for (const f of sim.findings) if (distanceM(f.pos, g.center) < CELL_M * 0.7) interest += 0.2;
      if (interest < 0.03) continue;
      cells.push({ id: `cov-${ix}-${iy}`, polygon: g.poly, interest: Math.min(1, interest), center: g.center });
    }
  }
  cells.sort((a, c) => c.interest - a.interest);
  const top = cells.slice(0, MAX_CELLS);
  const topIds = new Set(top.slice(0, 12).map((c) => c.id));
  const taken = new Set<string>();
  const free: string[] = [];
  for (const u of sim.units) {
    if (u.kind !== 'drone') continue;
    const m = sim.umeta.get(u.id);
    if (!m || m.plan.mode === 'orbit' || u.taskId) continue;
    if (m.plan.mode === 'sweep' && topIds.has(m.plan.cellId) && !taken.has(m.plan.cellId)) {
      taken.add(m.plan.cellId);
      const c = top.find((x) => x.id === (m.plan as { cellId: string }).cellId);
      if (c) c.unitId = u.id;
    } else free.push(u.id);
  }
  for (const uid of free) {
    const u = sim.units.find((x) => x.id === uid);
    if (!u) continue;
    const options = top.filter((c) => !taken.has(c.id)).slice(0, 6);
    if (!options.length) break;
    const value = (c: { interest: number; center: Geo }) => c.interest * 4 - distanceM(u.pos, c.center) / 2000;
    options.sort((a, c) => value(c) - value(a));
    const c = options[0];
    taken.add(c.id);
    c.unitId = uid;
    sweepUnit(sim, uid, c.id, sweepLegs(sim, c.id));
  }
  sim.coverage = top.map(({ id, polygon, interest, unitId }) => ({ id, polygon, interest: Math.round(interest * 100) / 100, unitId }));
}
