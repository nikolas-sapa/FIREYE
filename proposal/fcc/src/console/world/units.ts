import type { Geo, Unit, UnitKind } from '../contracts';
import { nearestRoadPath } from '../scenario';
import type { ScenarioContext } from './context';
import type { Rng } from './rng';
import type { Plan, Sim, UnitMeta } from './sim';
import { MIN, bearingDeg, clamp, destination, distanceM } from './geo';

/** Road-following route (OSM graph via DATA's nearestRoadPath); straight line if no road is near. */
export function roadRoute(ctx: ScenarioContext, from: Geo, to: Geo): Geo[] {
  let p: Geo[];
  try {
    p = nearestRoadPath(ctx.pack, from, to);
  } catch {
    p = [from, to];
  }
  const out: Geo[] = [];
  for (const q of p) if (!out.length || distanceM(out[out.length - 1], q) > 3) out.push({ lon: q.lon, lat: q.lat });
  return out.length >= 2 ? out : [{ lon: from.lon, lat: from.lat }, { lon: to.lon, lat: to.lat }];
}

const CRUISE: Record<UnitKind, number> = { drone: 18, engine: 13, crew: 1.3, dozer: 4, helo: 55, tanker: 80, ems: 15, law: 15 };
export const AIRBORNE = new Set<UnitKind>(['drone', 'helo', 'tanker']);

interface Spec {
  id: string;
  callsign: string;
  kind: UnitKind;
  division?: Unit['division'];
  pos: Geo;
  plan?: Plan;
  patrol?: Geo[];
  alt?: number;
}

export function createUnits(ctx: ScenarioContext, rng: Rng, t0: number): { units: Unit[]; umeta: Map<string, UnitMeta> } {
  const S = ctx.sites;
  const gf = S.gf;
  const road = (g: Geo): Geo => ctx.nearestRoadPoint(g, 1500) ?? g;
  const divA = [gf, destination(gf, 180, 1500), destination(gf, 215, 2300), destination(gf, 120, 1100), destination(gf, 260, 1600)].map(road);
  const divZ = [destination(gf, 250, 4200), destination(gf, 230, 5200), destination(gf, 275, 3600)].map(road);
  const crew7 = destination(gf, 190, 1200);
  const crew12 = destination(gf, 240, 3300);
  const specs: Spec[] = [];
  for (let i = 1; i <= 6; i++) {
    specs.push({ id: `hawk-${i}`, callsign: `HAWK-${i}`, kind: 'drone', division: 'AIR', pos: destination(gf, 150 + i * 22, 2000 + i * 250), alt: 120 });
  }
  specs.push(
    { id: 'e-41', callsign: 'E-41', kind: 'engine', division: 'A', pos: road(destination(gf, 200, 1800)), patrol: divA },
    { id: 'e-42', callsign: 'E-42', kind: 'engine', division: 'A', pos: road(gf), patrol: divA },
    { id: 'e-37', callsign: 'E-37', kind: 'engine', division: 'Z', pos: divZ[0], patrol: divZ },
    {
      id: 'dz-2',
      callsign: 'DZ-2',
      kind: 'dozer',
      division: 'A',
      pos: road(destination(gf, 220, 2500)),
      patrol: [destination(gf, 220, 2500), destination(gf, 200, 3000), destination(gf, 240, 2200)].map(road),
    },
    { id: 'crew-7', callsign: 'CREW-7', kind: 'crew', division: 'A', pos: crew7, plan: { mode: 'wander', anchor: crew7, radiusM: 220, target: crew7 } },
    { id: 'crew-12', callsign: 'CREW-12', kind: 'crew', division: 'Z', pos: crew12, plan: { mode: 'wander', anchor: crew12, radiusM: 220, target: crew12 } },
    { id: 'm-12', callsign: 'M-12', kind: 'ems', division: 'EMS', pos: S.staging },
    { id: 'm-14', callsign: 'M-14', kind: 'ems', division: 'EMS', pos: road(S.slyPark) },
    { id: 'so-5', callsign: 'SO-5', kind: 'law', pos: road(destination(gf, 300, 1200)), patrol: [gf, destination(gf, 300, 2800), destination(gf, 20, 1500)].map(road) },
    { id: 'h-205', callsign: 'H-205', kind: 'helo', division: 'AIR', pos: S.lake, alt: 250, plan: { mode: 'circuit', pts: [S.lake, S.fireCenterT0], i: 1 } },
    {
      id: 't-88',
      callsign: 'T-88',
      kind: 'tanker',
      division: 'AIR',
      pos: destination(S.fireCenterT0, 0, 4000),
      alt: 650,
      plan: { mode: 'orbit', center: S.fireCenterT0, radiusM: 4000, ang: 0 },
    },
  );
  const units: Unit[] = [];
  const umeta = new Map<string, UnitMeta>();
  for (const s of specs) {
    const air = AIRBORNE.has(s.kind);
    const u: Unit = {
      id: s.id,
      callsign: s.callsign,
      kind: s.kind,
      pos: { lon: s.pos.lon, lat: s.pos.lat, alt: air ? s.alt ?? 120 : 0 },
      heading: rng.range(0, 360),
      speedMps: 0,
      status: s.kind === 'ems' || s.kind === 'law' ? 'standby' : 'active',
      division: s.division,
      trail: [],
    };
    if (s.kind === 'drone') u.battery = 1;
    if (s.kind === 'engine' || s.kind === 'helo' || s.kind === 'tanker') u.water = 1;
    units.push(u);
    umeta.set(s.id, {
      plan: s.plan ?? { mode: 'hold' },
      patrol: s.patrol ?? [],
      home: { lon: s.pos.lon, lat: s.pos.lat },
      nextTrailT: t0,
      altAGL: s.alt ?? 0,
      cruise: CRUISE[s.kind],
      holdUntil: s.patrol ? t0 + rng.range(1, 6) * MIN : 0,
      phase: rng.range(0, 45),
    });
  }
  return { units, umeta };
}

/** Advances `u` along `pts` starting at target index i by `dist` meters; returns the new target index. */
function moveAlong(u: Unit, pts: Geo[], i: number, dist: number): number {
  let d = dist;
  let k = i;
  while (d > 0 && k < pts.length) {
    const tgt = pts[k];
    const rem = distanceM(u.pos, tgt);
    if (rem < 0.5) {
      k++;
      continue;
    }
    u.heading = bearingDeg(u.pos, tgt);
    if (rem <= d) {
      u.pos = { lon: tgt.lon, lat: tgt.lat, alt: u.pos.alt };
      d -= rem;
      k++;
    } else {
      const p = destination(u.pos, u.heading, d);
      u.pos = { lon: p.lon, lat: p.lat, alt: u.pos.alt };
      d = 0;
    }
  }
  return k;
}

function stepUnit(sim: Sim, u: Unit, m: UnitMeta, dt: number): void {
  const plan = m.plan;
  const speed = m.override ?? m.cruise;
  switch (plan.mode) {
    case 'hold': {
      u.speedMps = 0;
      if (!u.taskId) u.status = u.kind === 'ems' || u.kind === 'law' ? 'standby' : 'active';
      if (m.patrol.length && m.holdUntil > 0 && sim.t >= m.holdUntil && !u.taskId) {
        let target = sim.rng.pick(m.patrol);
        if (distanceM(target, u.pos) < 200) target = sim.rng.pick(m.patrol);
        m.plan = { mode: 'path', path: roadRoute(sim.ctx, u.pos, target), i: 1, after: 'patrol' };
      }
      break;
    }
    case 'path': {
      u.speedMps = speed;
      u.status = u.taskId ? 'enroute' : 'active';
      plan.i = moveAlong(u, plan.path, plan.i, speed * dt);
      if (plan.i >= plan.path.length) {
        m.override = undefined;
        m.plan = { mode: 'hold' };
        m.holdUntil = plan.after === 'patrol' ? sim.t + sim.rng.range(4, 10) * MIN : 0;
        u.speedMps = 0;
      }
      break;
    }
    case 'sweep': {
      u.speedMps = speed;
      u.status = 'active';
      plan.i = moveAlong(u, plan.legs, plan.i, speed * dt);
      if (plan.i >= plan.legs.length) {
        plan.legs = plan.legs.slice().reverse();
        plan.i = 0;
      }
      break;
    }
    case 'orbit': {
      u.speedMps = speed;
      const dc = distanceM(u.pos, plan.center);
      if (dc > plan.radiusM * 1.6) {
        if (u.kind === 'drone') u.status = 'enroute';
        const tgt = destination(plan.center, bearingDeg(plan.center, u.pos), plan.radiusM);
        moveAlong(u, [tgt], 0, speed * dt);
        plan.ang = bearingDeg(plan.center, u.pos);
      } else {
        if (u.kind === 'drone') u.status = 'tasked';
        plan.ang = (plan.ang + ((speed * dt) / plan.radiusM) * (180 / Math.PI)) % 360;
        const p = destination(plan.center, plan.ang, plan.radiusM);
        u.pos = { lon: p.lon, lat: p.lat, alt: u.pos.alt };
        u.heading = (plan.ang + 90) % 360;
      }
      break;
    }
    case 'wander': {
      u.speedMps = speed;
      const k = moveAlong(u, [plan.target], 0, speed * dt);
      if (k >= 1) plan.target = destination(plan.anchor, sim.rng.range(0, 360), sim.rng.range(0, plan.radiusM));
      break;
    }
    case 'circuit': {
      u.speedMps = speed;
      plan.i = moveAlong(u, plan.pts, plan.i, speed * dt);
      if (plan.i >= plan.pts.length) plan.i = 0;
      break;
    }
  }
  if (AIRBORNE.has(u.kind)) u.pos.alt = m.altAGL;
}

export function tickUnits(sim: Sim, dtS: number): void {
  const steps = Math.max(1, Math.ceil(dtS / 15));
  const dt = dtS / steps;
  for (const u of sim.units) {
    const m = sim.umeta.get(u.id);
    if (!m) continue;
    for (let k = 0; k < steps; k++) stepUnit(sim, u, m, dt);
    if (sim.t >= m.nextTrailT) {
      u.trail = [...u.trail.slice(-23), { lon: u.pos.lon, lat: u.pos.lat, alt: u.pos.alt }];
      m.nextTrailT = sim.t + (AIRBORNE.has(u.kind) ? 20_000 : 30_000);
    }
    const minute = sim.t / MIN + m.phase;
    if (u.battery !== undefined) u.battery = clamp(0.3 + 0.7 * (1 - (minute % 42) / 42), 0, 1);
    if (u.water !== undefined) u.water = u.kind === 'engine' ? clamp(1 - ((minute % 35) / 35) * 0.8, 0, 1) : clamp(1 - (minute % 12) / 12, 0, 1);
  }
}

export function unitById(sim: Sim, id: string): Unit | undefined {
  return sim.units.find((u) => u.id === id);
}

/** Sends a unit to `target` (via roads for ground units). `arriveBy` sets a speed so it arrives on time. */
export function sendTo(sim: Sim, id: string, target: Geo, opts: { road?: boolean; after?: 'hold' | 'patrol'; arriveBy?: number; speed?: number } = {}): Geo[] {
  const u = unitById(sim, id);
  const m = sim.umeta.get(id);
  if (!u || !m) return [];
  const ground = !AIRBORNE.has(u.kind);
  const path = ground && opts.road !== false ? roadRoute(sim.ctx, u.pos, target) : [{ lon: u.pos.lon, lat: u.pos.lat }, { lon: target.lon, lat: target.lat }];
  m.plan = { mode: 'path', path, i: 1, after: opts.after ?? 'hold' };
  m.override = undefined;
  if (opts.speed) m.override = opts.speed;
  if (opts.arriveBy && opts.arriveBy > sim.t) {
    let len = 0;
    for (let i = 1; i < path.length; i++) len += distanceM(path[i - 1], path[i]);
    m.override = clamp(len / ((opts.arriveBy - sim.t) / 1000), 3, 28);
  }
  u.route = path;
  return path;
}

export function orbitUnit(sim: Sim, id: string, center: Geo, radiusM: number): void {
  const u = unitById(sim, id);
  const m = sim.umeta.get(id);
  if (!u || !m) return;
  m.plan = { mode: 'orbit', center: { lon: center.lon, lat: center.lat }, radiusM, ang: bearingDeg(center, u.pos) };
  if (u.kind === 'drone') m.altAGL = 90;
  u.route = [{ lon: u.pos.lon, lat: u.pos.lat }, { lon: center.lon, lat: center.lat }];
}

export function sweepUnit(sim: Sim, id: string, cellId: string, legs: Geo[]): void {
  const u = unitById(sim, id);
  const m = sim.umeta.get(id);
  if (!u || !m || !legs.length) return;
  m.plan = { mode: 'sweep', cellId, legs, i: 0 };
  m.altAGL = 120;
  u.route = undefined;
}

export function resumePatrol(sim: Sim, id: string): void {
  const m = sim.umeta.get(id);
  const u = unitById(sim, id);
  if (!m || !u) return;
  u.taskId = undefined;
  u.route = undefined;
  if (u.kind === 'crew') {
    m.plan = { mode: 'wander', anchor: { lon: u.pos.lon, lat: u.pos.lat }, radiusM: 220, target: { lon: u.pos.lon, lat: u.pos.lat } };
  } else if (u.kind !== 'drone') {
    m.plan = { mode: 'hold' };
    m.holdUntil = m.patrol.length ? sim.t + 5 * MIN : 0;
  }
}

/** Keeps aircraft circuits on the active head (called after each projection). */
export function retargetAircraft(sim: Sim, head: Geo): void {
  const h = sim.umeta.get('h-205');
  if (h && h.plan.mode === 'circuit') h.plan.pts = [sim.ctx.sites.lake, head];
  const t = sim.umeta.get('t-88');
  if (t && t.plan.mode === 'orbit') t.plan.center = { lon: head.lon, lat: head.lat };
}
