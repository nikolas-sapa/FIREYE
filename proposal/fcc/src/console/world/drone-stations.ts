import type { ReconDrone, ReconTask, Unit } from '../contracts';
import type { Sim, UnitMeta } from './sim';
import { bearingDeg, destination, distanceM } from './geo';
import { stepAircraft } from './flight';

/** Illustrative battery model: 38 minutes powered flight, 18 minutes from empty to full on a pad. */
export const FLIGHT_SECONDS = 38 * 60;
export const CHARGE_SECONDS = 18 * 60;
export const isOnPad = (d: ReconDrone) => d.phase === 'docked' || d.phase === 'charging';

export function reconEvent(sim: Sim, e: Omit<import('../contracts').ReconEvent, 'tab' | 'provenance'>) {
  sim.recon!.events = [...sim.recon!.events, { ...e, tab: 'ops' as const, provenance: 'simulated' as const }].slice(-240);
}

export function initializeStations(sim: Sim) {
  const r = sim.recon!;
  const anchor = (id: string, heading: number) => sim.ctx.pack.manifest.places.find(p => p.id === id)?.pos
    ?? destination(sim.ctx.pack.manifest.center, heading, 4600);
  const bound = (p: import('../contracts').Geo) => {
    const [w, s, e, n] = sim.ctx.pack.raster.bbox;
    return { lon: Math.max(w + 0.003, Math.min(e - 0.003, p.lon)), lat: Math.max(s + 0.003, Math.min(n - 0.003, p.lat)) };
  };
  r.stations = [
    { id: 'station-north', name: 'North station · Nea Makri outskirts', pos: bound(destination(anchor('nea-makri', 340), 270, 1250)) },
    { id: 'station-south', name: 'South station · Pikermi outskirts', pos: bound(destination(anchor('pikermi', 210), 270, 700)) },
  ];
  r.drones = sim.units.map((u, i) => {
    const station = r.stations[i % 2], m = sim.umeta.get(u.id)!;
    u.pos = { ...station.pos, alt: 0 }; u.speedMps = 0; u.status = 'standby'; u.battery = 1;
    m.home = station.pos; m.plan = { mode: 'hold' }; m.altAGL = 0; m.patrol = [];
    return { unitId: u.id, stationId: station.id, phase: 'docked', changedAt: sim.t, sorties: 0 };
  });
}

export function flyPattern(sim: Sim, u: Unit, task: ReconTask) {
  const m = sim.umeta.get(u.id)!;
  m.altAGL = 90;
  if (task.pattern === 'circle') m.plan = { mode: 'orbit', center: task.target, radiusM: 220, ang: bearingDeg(task.target, u.pos) };
  else if (task.pattern === 'square') m.plan = { mode: 'circuit', pts: [45, 135, 225, 315].map(b => destination(task.target, b, 280)), i: 0 };
  else if (task.pattern === 'line') m.plan = { mode: 'sweep', cellId: task.cellId, legs: [destination(task.target, 0, 240), destination(task.target, 180, 240)], i: 0 };
  else m.plan = { mode: 'path', path: [u.pos, destination(task.target, 270, 140)], i: 1, after: 'hold' };
}

export function returnDrone(sim: Sim, u: Unit, reason: string) {
  const r = sim.recon!, d = r.drones.find(d => d.unitId === u.id)!;
  if (isOnPad(d) || d.phase === 'returning' || d.phase === 'landing') return;
  r.tasks = r.tasks.map(t => t.unitId === u.id && (t.status === 'enroute' || t.status === 'observing') ? { ...t, status: 'superseded' } : t);
  const m = sim.umeta.get(u.id)!;
  m.plan = { mode: 'path', path: [u.pos, m.home], i: 1, after: 'hold' }; m.altAGL = 90;
  u.taskId = undefined; u.status = 'rtb';
  d.phase = 'returning'; d.changedAt = sim.t;
  reconEvent(sim, { id: `return-${u.id}-${sim.t}`, t: sim.t, kind: 'fleet', severity: 'info', source: 'ORCHESTRATOR', tasking: true,
    title: `${u.callsign}, return to station`, body: `${reason} Landing and recharge at ${r.stations.find(s => s.id === d.stationId)!.name}.`, pos: m.home, refs: [u.id, `feed-${u.id}`, d.stationId] });
}

/** Called at the same bounded 0.5 s aircraft substep as legacy flight. No clock-based battery resets. */
export function stepReconDrone(sim: Sim, u: Unit, m: UnitMeta, dt: number) {
  const r = sim.recon!, d = r.drones.find(d => d.unitId === u.id)!;
  if (isOnPad(d)) {
    u.pos = { ...m.home, alt: 0 }; u.speedMps = 0; u.status = 'standby';
    if (d.phase === 'charging') {
      u.battery = Math.min(1, (u.battery ?? 0) + dt / CHARGE_SECONDS);
      if (u.battery >= 1) {
        d.phase = 'docked'; d.changedAt = sim.t;
        reconEvent(sim, { id: `charged-${u.id}-${sim.t}`, t: sim.t, kind: 'fleet', severity: 'info', source: 'STATION',
          title: `${u.callsign} recharged · reserve ready`, refs: [u.id, d.stationId] });
      }
    }
    return;
  }
  u.battery = Math.max(0, (u.battery ?? 1) - dt / FLIGHT_SECONDS);
  const reserve = 0.12 + (distanceM(u.pos, m.home) / Math.max(10, m.cruise) * 1.5 + 90) / FLIGHT_SECONDS;
  if (u.battery <= Math.max(0.25, reserve)) returnDrone(sim, u, 'Battery reserve reached.');
  if (d.phase === 'launching' && (u.pos.alt ?? 0) >= 89) {
    const task = r.tasks.find(t => t.id === u.taskId);
    if (task) { flyPattern(sim, u, task); d.phase = 'enroute'; d.changedAt = sim.t; }
    else returnDrone(sim, u, 'Reconnaissance cancelled.');
  }
  stepAircraft(sim, u, m, dt);
  if (d.phase === 'returning' && distanceM(u.pos, m.home) < 12 && u.speedMps < 1) {
    d.phase = 'landing'; d.changedAt = sim.t; m.plan = { mode: 'hold' }; m.altAGL = 0;
  }
  if (d.phase === 'landing' && (u.pos.alt ?? 0) <= 0.5 && u.speedMps < 0.5) {
    d.phase = 'charging'; d.changedAt = sim.t;
    u.pos = { ...m.home, alt: 0 }; u.speedMps = 0;
    reconEvent(sim, { id: `landed-${u.id}-${sim.t}`, t: sim.t, kind: 'fleet', severity: 'info', source: 'STATION',
      title: `${u.callsign} landed · charging`, body: 'Camera powered down on the charging pad.', refs: [u.id, `feed-${u.id}`, d.stationId] });
  }
  if (d.phase === 'returning' || d.phase === 'landing') u.status = 'rtb';
}
