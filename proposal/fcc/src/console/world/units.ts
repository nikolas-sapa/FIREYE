import type { Geo, Unit, UnitKind } from '../contracts';
import { nearestRoadPath } from '../scenario';
import type { ScenarioContext } from './context';
import type { Rng } from './rng';
import type { Sim, UnitMeta } from './sim';
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

export function createUnits(ctx: ScenarioContext, rng: Rng, t0: number): { units: Unit[]; umeta: Map<string, UnitMeta> } {
  const specs = ctx.script.units(ctx);
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
      cruise: s.cruise ?? CRUISE[s.kind],
      marine: s.marine,
      helmetCam: s.helmetCam,
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
        m.plan = { mode: 'path', path: m.marine ? [{ lon: u.pos.lon, lat: u.pos.lat }, target] : roadRoute(sim.ctx, u.pos, target), i: 1, after: 'patrol' };
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
  const ground = !AIRBORNE.has(u.kind) && !m.marine;
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
  for (const u of sim.units) {
    const m = sim.umeta.get(u.id);
    if (!m || u.taskId) continue;
    if (u.kind === 'helo' && m.plan.mode === 'circuit') m.plan.pts = [sim.ctx.sites.water, head];
    else if (u.kind === 'tanker' && m.plan.mode === 'orbit') m.plan.center = { lon: head.lon, lat: head.lat };
  }
}
