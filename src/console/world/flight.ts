import type { Geo, Unit } from '../contracts';
import type { Sim, UnitMeta } from './sim';
import { angDiff, bearingDeg, clamp, destination, distanceM } from './geo';

/** Illustrative flight envelope, not a certified aircraft performance model. */
export function flightEnvelope(kind: Unit['kind']) {
  return kind === 'tanker' ? { accel: 2, lateral: 9.81 * Math.tan(25 * Math.PI / 180), yaw: 8, climb: 8, min: 45, max: 110 }
    : kind === 'helo' ? { accel: 2.5, lateral: 5, yaw: 12, climb: 5, min: 0, max: 65 }
    : { accel: 3, lateral: 4, yaw: 35, climb: 3, min: 0, max: 25 };
}

/** Continuous pursuit with bounded acceleration and bank-derived turn radius. No waypoint teleports. */
export function stepAircraft(sim: Sim, u: Unit, m: UnitMeta, dt: number) {
  const env = flightEnvelope(u.kind), plan = m.plan;
  if (plan.mode !== 'hold') m.loiterCenter = undefined;
  let wantedSpeed = clamp(m.override ?? m.cruise, env.min, env.max);
  const radius = Math.max(20, wantedSpeed * wantedSpeed / env.lateral);
  let heading = u.heading;
  const orbit = (center: Geo, requestedRadius: number) => {
    const r = Math.max(radius * 1.2, requestedRadius);
    const d = distanceM(center, u.pos), radial = bearingDeg(center, u.pos);
    heading = radial + 90 + clamp((d - r) / r * 65, -75, 75);
    if (plan.mode === 'orbit') {
      plan.ang = radial;
      u.status = d > r * 1.6 ? 'enroute' : 'tasked';
    }
  };
  if (plan.mode === 'orbit') orbit(plan.center, plan.radiusM);
  else if (plan.mode === 'hold') {
    if (u.kind === 'tanker') {
      m.loiterCenter ??= destination(u.pos, u.heading + 90, radius * 1.2);
      orbit(m.loiterCenter, radius * 1.2); // Fixed-wing aircraft cannot hover.
    } else wantedSpeed = 0;
  } else {
    m.loiterCenter = undefined;
    const points = plan.mode === 'path' ? plan.path : plan.mode === 'sweep' ? plan.legs
      : plan.mode === 'circuit' ? plan.pts : [plan.target];
    const index = plan.mode === 'wander' ? 0 : plan.i;
    const target = points[index];
    if (target) {
      const distance = distanceM(u.pos, target);
      heading = bearingDeg(u.pos, target);
      const final = plan.mode === 'path' && index === points.length - 1;
      if (final && u.kind !== 'tanker') wantedSpeed = Math.min(wantedSpeed, Math.sqrt(2 * env.accel * distance));
      const capture = final ? Math.max(4, u.speedMps * dt * 1.5) : Math.max(10, radius * 0.65, u.speedMps * dt * 1.5);
      if (distance <= capture) {
        if (plan.mode === 'wander') plan.target = destination(plan.anchor, sim.rng.range(0, 360), sim.rng.range(0, plan.radiusM));
        else {
          plan.i++;
          if (plan.i >= points.length) {
            if (plan.mode === 'sweep') { plan.legs = [...plan.legs].reverse(); plan.i = Math.min(1, plan.legs.length - 1); }
            else if (plan.mode === 'circuit') plan.i = 0;
            else {
              m.plan = { mode: 'hold' }; m.override = undefined;
              if (u.kind !== 'tanker') wantedSpeed = 0;
            }
          }
        }
      }
    } else m.plan = { mode: 'hold' };
    u.status = u.taskId ? 'enroute' : 'active';
  }
  const oldSpeed = u.speedMps;
  u.speedMps = clamp(oldSpeed + clamp(wantedSpeed - oldSpeed, -env.accel * dt, env.accel * dt), env.min, env.max);
  const maxRate = Math.min(env.yaw, env.lateral / Math.max(3, u.speedMps) * 180 / Math.PI);
  const wantedRate = clamp(angDiff(u.heading, heading) / 1.5, -maxRate, maxRate);
  const angularAccel = u.kind === 'tanker' ? 2 : u.kind === 'helo' ? 6 : 25;
  m.turnRate = clamp((m.turnRate ?? 0) + clamp(wantedRate - (m.turnRate ?? 0), -angularAccel * dt, angularAccel * dt), -maxRate, maxRate);
  const turn = m.turnRate * dt;
  const next = destination(u.pos, u.heading + turn / 2, (oldSpeed + u.speedMps) / 2 * dt);
  u.heading = (u.heading + turn + 360) % 360;
  const alt = u.pos.alt ?? m.altAGL;
  u.pos = { ...next, alt: alt + clamp(m.altAGL - alt, -env.climb * dt, env.climb * dt) };
}
