import type { DroneStation, Geo, Projection, ReconDrone, ReconTask } from '../contracts';
import type { Sim } from './sim';
import { MIN, angDiff, bearingDeg, destination, distanceM } from './geo';
import { FLIGHT_SECONDS, flyPattern, isOnPad, reconEvent as event, returnDrone } from './drone-stations';
import { sensorModel } from '../fireye/data/sensors';
import { sectorRisk } from '../fireye/data/risk';

export interface ReconState {
  tasks: ReconTask[];
  events: import('../contracts').ReconEvent[];
  stations: DroneStation[];
  drones: ReconDrone[];
  observed: Map<string, number>;
  seen: Set<string>;
  nextAt: number;
  previousProjection: Projection | null;
}

export const createRecon = (): ReconState => ({
  tasks: [], events: [], stations: [], drones: [], observed: new Map(), seen: new Set(), nextAt: 0, previousProjection: null,
});

/** Compare absolute forecast arrival times, never the naturally shrinking time remaining. */
export function projectionDeterioration(previous: Projection, next: Projection): string | null {
  if (next.rosMpm >= Math.max(previous.rosMpm * 1.2, previous.rosMpm + 3)) {
    return `Projected advance accelerated from ${Math.round(previous.rosMpm)} to ${Math.round(next.rosMpm)} m/min.`;
  }
  for (const [place, arrival] of Object.entries(next.etaToPlaces)) {
    const old = previous.etaToPlaces[place];
    if (old !== undefined && arrival > next.issuedAt && old - arrival >= 5 * MIN) {
      return `Projected arrival at ${place.replace(/-/g, ' ')} moved ${Math.round((old - arrival) / MIN)} minutes earlier.`;
    }
    if (old === undefined && arrival > next.issuedAt && arrival - next.issuedAt <= 60 * MIN) {
      return `Projection now reaches ${place.replace(/-/g, ' ')} within ${Math.round((arrival - next.issuedAt) / MIN)} minutes.`;
    }
  }
  return null;
}

function fixedCameraSees(sim: Sim, target: Geo): boolean {
  return sim.feeds.some(f => {
    const p = f.pose.pos;
    if (f.kind !== 'ridge-cam' || !f.live || !p) return false;
    const distance = distanceM(p, target);
    if (distance > 5000 || Math.abs(angDiff(f.pose.headingDeg ?? 0, bearingDeg(p, target))) > (f.pose.fovDeg ?? 50) / 2) return false;
    const ground = sim.ctx.elevAt(target);
    for (let k = 1; k < 10; k++) {
      const t = k / 10, q = { lon: p.lon + (target.lon - p.lon) * t, lat: p.lat + (target.lat - p.lat) * t };
      if (sim.ctx.elevAt(q) > (p.alt ?? sim.ctx.elevAt(p) + 18) * (1 - t) + ground * t + 3) return false;
    }
    return true;
  });
}

/** Simulated task allocation from current observations only, with a two-drone opening patrol. */
export function tickRecon(sim: Sim) {
  const r = sim.recon;
  if (!r) return;
  const projection = sim.projection;
  if (projection && projection.rev !== r.previousProjection?.rev) {
    const previous = r.previousProjection;
    const deterioration = previous ? projectionDeterioration(previous, projection) : null;
    if (!previous || deterioration) {
      r.tasks = r.tasks.map(task => {
        if (task.status !== 'enroute' && task.status !== 'observing') return task;
        const unit = sim.units.find(u => u.id === task.unitId);
        if (unit) unit.taskId = undefined;
        return { ...task, status: 'superseded' };
      });
    }
    event(sim, {
      id: `recon-projection-${projection.rev}`, t: sim.t, kind: previous ? 'projection' : 'detection',
      severity: previous ? (deterioration ? 'alert' : 'info') : 'critical', source: previous ? 'PROJECTION AGENT' : 'VISION AGENT',
      title: previous ? deterioration ?? `Spread projection updated · rev ${projection.rev}` : 'New fire detected',
      body: previous ? (deterioration ? 'The current spread estimate worsened. Expanding drone reconnaissance to inspect unobserved sectors.' : 'The current spread estimate was refreshed from available observations.')
        : 'An active fire has been detected. Launching available reserves to cover blind spots around the observed front.',
      pos: sim.projHead ?? undefined,
      refs: ['projection', 'vision', 'terrain'],
    });
    r.previousProjection = projection;
    r.nextAt = 0;
  }
  for (const f of sim.findings) {
    if (f.kind !== 'spot' || r.seen.has(f.id) || !(f.live || sim.fmeta.get(f.id)?.confirmed)) continue;
    r.seen.add(f.id);
    event(sim, { id: `recon-spot-${f.id}`, t: sim.t, kind: 'detection', severity: 'critical', source: 'VISION AGENT',
      title: `New spot fire confirmed · ${f.label}`, pos: f.pos, refs: f.sourceIds,
      body: 'Simulated sensor finding. Reconnaissance priority updated.' });
    r.nextAt = 0;
  }
  let changed = false;
  r.tasks = r.tasks.map(task => {
    if (task.status === 'complete' || task.status === 'superseded') return task;
    const unit = sim.units.find(u => u.id === task.unitId);
    const drone = r.drones.find(d => d.unitId === task.unitId);
    if (!unit || !drone || drone.phase === 'launching') return task;
    const arrived = distanceM(unit.pos, task.target) < 380
      && (task.pattern !== 'hover' || (sim.umeta.get(unit.id)?.plan.mode === 'hold' && unit.speedMps < 1));
    if (task.status === 'enroute' && arrived) {
      changed = true; drone.phase = 'observing'; drone.changedAt = sim.t;
      event(sim, { id: `${task.id}-observing`, t: sim.t, kind: 'fleet', severity: 'info', source: 'FLIGHT CONTROLLER',
        title: `${unit.callsign} on station · ${task.pattern} pattern`, body: 'Six-minute simulated sector observation in progress.',
        pos: task.target, refs: [unit.id, `feed-${unit.id}`, ...(task.sourceIds ?? [])] });
      return { ...task, status: 'observing', observedAt: sim.t };
    }
    if (task.status === 'observing' && sim.t - task.observedAt! >= 6 * MIN) {
      r.observed.set(task.cellId, sim.t);
      event(sim, { id: `${task.id}-complete`, t: sim.t, kind: 'fleet', severity: 'info', source: 'ORCHESTRATOR',
        title: `${unit.callsign} completed ${task.label.toLowerCase()}`, pos: task.target, refs: [unit.id, `feed-${unit.id}`, ...(task.sourceIds ?? [])] });
      changed = true; r.nextAt = 0; unit.taskId = undefined;
      return { ...task, status: 'complete' };
    }
    return task;
  });
  if (sim.t < r.nextAt && !changed) return;
  r.nextAt = sim.t + 5 * MIN;
  const model = sensorModel(sim.ctx.pack), risks = sectorRisk(model, sim.t);
  const [west, south, east, north] = sim.ctx.pack.raster.bbox;
  const cells = projection && sim.coverage.length ? sim.coverage.map(c => ({
    id: c.id, interest: c.interest, sources: ['terrain', 'projection'],
    target: { lon: c.polygon.reduce((n, p) => n + p.lon, 0) / c.polygon.length, lat: c.polygon.reduce((n, p) => n + p.lat, 0) / c.polygon.length },
  })) : risks.flatMap(risk => {
    const nodes = model.specs.filter(s => s.sector === risk.sector);
    const center = { lon: nodes.reduce((s, n) => s + n.pos.lon, 0) / nodes.length, lat: nodes.reduce((s, n) => s + n.pos.lat, 0) / nodes.length };
    return [30, 150, 270].map((bearing, i) => ({
      id: `sensitivity-${risk.sector}-${i}`, interest: risk.value / 100,
      sources: ['iot', 'weather', 'terrain', ...nodes.map(n => n.id)],
      target: destination(center, bearing, 500),
    }));
  });
  const desired = projection ? Math.min(6, 3 + Math.ceil(Math.max(0, projection.rosMpm - 10) / 20))
    : sim.t - sim.ctx.start < 15 * MIN ? 2 : (risks[0]?.value ?? 0) >= 88 ? 3 : 2;
  const active = r.tasks.filter(t => t.status === 'enroute' || t.status === 'observing');
  const reserved = new Set(active.map(t => t.cellId));
  for (const u of sim.units) {
    const d = r.drones.find(d => d.unitId === u.id)!;
    if (active.length >= desired) break;
    if (d.phase === 'returning' || d.phase === 'landing' || d.phase === 'charging' || u.taskId || (u.battery ?? 0) < 0.5) continue;
    const m = sim.umeta.get(u.id)!;
    const options = cells.filter(c => !reserved.has(c.id) && sim.t - (r.observed.get(c.id) ?? -Infinity) >= 20 * MIN
      && c.target.lon >= west && c.target.lon <= east && c.target.lat >= south && c.target.lat <= north
      && !fixedCameraSees(sim, c.target)
      && (distanceM(u.pos, c.target) + distanceM(c.target, m.home)) / m.cruise / FLIGHT_SECONDS + 8 * 60 / FLIGHT_SECONDS + 0.15 < (u.battery ?? 0));
    options.sort((a, b) => (b.interest * 8 - distanceM(u.pos, b.target) / 5000) - (a.interest * 8 - distanceM(u.pos, a.target) / 5000) || a.id.localeCompare(b.id));
    const cell = options[0];
    if (!cell) continue;
    const pattern = (['circle', 'square', 'line', 'hover'] as const)[(sim.units.indexOf(u) + d.sorties) % 4];
    const task: ReconTask = {
      id: `recon-${u.id}-${sim.t}-${cell.id}`, unitId: u.id, cellId: cell.id, target: cell.target, pattern, sourceIds: cell.sources,
      assignedAt: sim.t, status: 'enroute', label: `Reconnaissance near ${sim.ctx.nearestPlace(cell.target).name}`,
      reason: projection ? 'Priority blind spot in the current fire projection, outside estimated fixed-camera visibility.'
        : `High fire sensitivity (${Math.round(cell.interest * 100)}/100) from current fuel, gust and weather readings; terrain is not visible to fixed cameras.`,
    };
    r.tasks = [...r.tasks, task].slice(-60);
    active.push(task); reserved.add(cell.id); u.taskId = task.id;
    if (isOnPad(d)) {
      d.phase = 'launching'; d.changedAt = sim.t; d.sorties++;
      m.plan = { mode: 'hold' }; m.altAGL = 90;
    } else { d.phase = 'enroute'; d.changedAt = sim.t; flyPattern(sim, u, task); }
    const maneuver = { circle: 'Circle the sector', square: 'Fly a square perimeter', line: 'Fly repeated north–south lines', hover: 'Hold position and point the camera at the target' }[pattern];
    event(sim, { id: task.id, t: sim.t, kind: 'fleet', severity: 'info', source: 'ORCHESTRATOR', tasking: true,
      title: `${u.callsign}, recon ${sim.ctx.nearestPlace(cell.target).name}`,
      body: `${maneuver}. ${task.reason}`, pos: task.target, refs: [u.id, `feed-${u.id}`, ...cell.sources] });
    sim.ledger = { ...sim.ledger, droneTasksIssued: sim.ledger.droneTasksIssued + 1 };
  }
  for (const u of sim.units) {
    const d = r.drones.find(d => d.unitId === u.id)!;
    if (!u.taskId && !isOnPad(d) && d.phase !== 'returning' && d.phase !== 'landing') {
      returnDrone(sim, u, 'No uncovered priority sector currently needs another scan.');
    }
  }
}

export function reconSummary(sim: Sim): string {
  const r = sim.recon!;
  const tasks = r.tasks.filter(t => t.status === 'enroute' || t.status === 'observing');
  const lines = tasks.map(t => `${sim.units.find(u => u.id === t.unitId)?.callsign}: ${t.label.toLowerCase()}, ${t.pattern} pattern (${t.status}). ${t.reason}`);
  const returning = r.drones.filter(d => d.phase === 'returning' || d.phase === 'landing').length;
  const charging = r.drones.filter(d => d.phase === 'charging').length;
  return [...lines, `${returning} returning/landing · ${charging} charging · ${r.drones.filter(isOnPad).length - charging} ready in reserve at two stations.`].join('\n');
}
