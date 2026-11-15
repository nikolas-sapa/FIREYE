import type { Geo, Projection } from '../contracts';
import { FuelClass } from '../contracts';
import type { Sim } from '../world/sim';
import { MIN, compass, destination, round } from '../world/geo';
import { rebuildCoverage } from '../world/coverage';
import { retargetAircraft } from '../world/units';
import { enqueue } from './swarm';
import { fieldMinAt, gridGeo, runSpread, type SpreadField, type SpreadWeather } from './spread';
import { issueChecks } from './predictions';

const BINS = 96;
const HORIZONS = [60, 180, 360] as const;
const CONF = [0.8, 0.6, 0.4];
export const PROJ_HORIZON_MIN = 360;

const FUEL_LABEL: Record<number, string> = {
  [FuelClass.Grass]: 'Cured grass',
  [FuelClass.Shrub]: 'Dry shrub',
  [FuelClass.TimberLitter]: 'Timber litter',
  [FuelClass.TimberUnderstory]: 'Timber understory',
  [FuelClass.Urban]: 'Structures',
  [FuelClass.Agriculture]: 'Agricultural',
};

function fillAndSmooth(r: Float64Array): void {
  const n = r.length;
  let any = false;
  for (let i = 0; i < n; i++) if (r[i] > 0) any = true;
  if (!any) return;
  for (let i = 0; i < n; i++) {
    if (r[i] > 0) continue;
    let a = i;
    let b = i;
    let da = 0;
    let db = 0;
    while (r[(a + n) % n] <= 0 && da < n) {
      a--;
      da++;
    }
    while (r[b % n] <= 0 && db < n) {
      b++;
      db++;
    }
    r[i] = (r[(a + n) % n] * db + r[b % n] * da) / (da + db || 1);
  }
  const w = [1, 2, 3, 2, 1];
  for (let pass = 0; pass < 2; pass++) {
    const src = r.slice();
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += src[(i + k + n) % n] * w[k + 2];
      r[i] = s / 9;
    }
  }
}

interface Shape {
  bands: Projection['bands'];
  headDirDeg: number;
  rosMpm: number;
  center: Geo;
  head: Geo;
  fuelText: string;
}

/** Turns the modelled arrival field into radial band polygons, head direction and head ROS. */
function shapeOf(f: SpreadField, fallback: Geo): Shape {
  const g = f.grid;
  const center = f.center ?? fallback;
  const pad = (g.dxM + g.dyM) / 4;
  const rNow = new Float64Array(BINS);
  const r = HORIZONS.map(() => new Float64Array(BINS));
  const fuel = new Map<number, number>();
  let south = 0;
  let tot = 0;
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  for (let y = 1; y < g.gh - 1; y++) {
    for (let x = 0; x < g.gw; x++) {
      const i = y * g.gw + x;
      const v = f.t[i];
      if (!(v <= PROJ_HORIZON_MIN)) continue;
      const p = gridGeo(g, x, y);
      const ddx = (p.lon - center.lon) * 111320 * cosLat;
      const ddy = (p.lat - center.lat) * 110574;
      const d = Math.hypot(ddx, ddy) + pad;
      const ang = ((Math.atan2(ddx, ddy) * 180) / Math.PI + 360) % 360;
      const b = Math.floor((ang / 360) * BINS) % BINS;
      if (v === 0 && d > rNow[b]) rNow[b] = d;
      for (let k = 0; k < 3; k++) if (v <= HORIZONS[k] && d > r[k][b]) r[k][b] = d;
      if (v > 0 && v <= 180) {
        tot++;
        const fc = g.fuel[i];
        fuel.set(fc, (fuel.get(fc) ?? 0) + 1);
        if (g.elev[i - g.gw] - g.elev[i + g.gw] > 6) south++;
      }
    }
  }
  fillAndSmooth(rNow);
  r.forEach(fillAndSmooth);
  for (let b = 0; b < BINS; b++) {
    r[0][b] = Math.max(r[0][b], rNow[b], pad);
    r[1][b] = Math.max(r[1][b], r[0][b]);
    r[2][b] = Math.max(r[2][b], r[1][b]);
  }
  let hb = 0;
  let growth = -1;
  for (let b = 0; b < BINS; b++) {
    const gr = r[0][b] - rNow[b];
    if (gr > growth) {
      growth = gr;
      hb = b;
    }
  }
  const headDirDeg = ((hb + 0.5) * 360) / BINS;
  const bands = HORIZONS.map((h, k) => ({
    horizonMin: h,
    polygon: Array.from({ length: BINS }, (_, b) => {
      const p = destination(center, ((b + 0.5) * 360) / BINS, r[k][b]);
      return { lon: round(p.lon, 6), lat: round(p.lat, 6) };
    }),
    confidence: CONF[k],
  }));
  let topFuel = FuelClass.Shrub as number;
  let topN = 0;
  for (const [fc, c] of fuel) {
    if (FUEL_LABEL[fc] && c > topN) {
      topN = c;
      topFuel = fc;
    }
  }
  const fuelText = tot ? `${FUEL_LABEL[topFuel] ?? 'Mixed fuels'} (${Math.round((topN / tot) * 100)}% of +3H) · ${Math.round((south / tot) * 100)}% south aspects` : 'Fuel: mixed';
  return { bands, headDirDeg, rosMpm: round(Math.max(0, growth) / 60, 1), center, head: destination(center, headDirDeg, Math.max(200, rNow[hb])), fuelText };
}

export function shiftDriver(sim: Sim): string {
  const { shiftFrom: a, shiftTo: b } = sim.ctx;
  return `Wind shift ingested: ${Math.round(a.windDirDeg)}° → ${Math.round(b.windDirDeg)}° by ${sim.ctx.fmtTime(b.t)} (${sim.ctx.script.weatherSource}), gusts to ${Math.round(Math.max(a.gustKph, b.gustKph))} kph`;
}

/** True while the model runs on persistence (the scenario's later forecast has not been ingested yet). */
export function persistenceAt(sim: Sim): boolean {
  return sim.ctx.tShift !== null && !sim.shiftApplied;
}

/** Weather the model assumes: hourly pack weather as the forecast, or the issue-time observation held constant. */
function modelWeather(sim: Sim, t: number): (at: number) => SpreadWeather {
  if (persistenceAt(sim)) {
    const w = sim.ctx.weatherAt(t);
    return () => w;
  }
  return (at) => sim.ctx.weatherAt(at);
}

/** Runs the spread model at sim.t and publishes the revision. Returns null while no fire is observed. */
export function applyProjection(sim: Sim, reason: string, extra: string[] = []): Projection | null {
  const t = sim.t;
  if (t < sim.ctx.tDetect) return null;
  const field = runSpread(sim.ctx.pack, t, modelWeather(sim, t), PROJ_HORIZON_MIN);
  sim.timers.proj = t + 20 * MIN;
  if (!field.burned) return null;
  const c = shapeOf(field, sim.ctx.sites.ignition);
  const w = sim.ctx.weatherAt(t);
  const prev = sim.projection;
  const etaToPlaces: Record<string, number> = {};
  for (const p of sim.ctx.places) {
    const m = fieldMinAt(field, p.pos, 600);
    if (m < 0 || !Number.isFinite(m)) continue;
    etaToPlaces[p.id] = Math.round(t + m * MIN);
  }
  const drivers = [
    `Wind ${Math.round(w.windDirDeg)}° ${compass(w.windDirDeg)} ${Math.round(w.windKph)} kph · gusts ${Math.round(w.gustKph)}`,
    `RH ${Math.round(w.rh)}% · ${Math.round(w.tempC)}°C`,
    c.fuelText,
    `Head ${compass(c.headDirDeg)} at ${Math.round(c.rosMpm)} m/min`,
    ...extra,
  ];
  drivers.push(persistenceAt(sim) ? 'Model wind: current observation held constant (later forecast not yet ingested)' : `Model wind: hourly ${sim.ctx.script.weatherSource}`);
  const proj: Projection = {
    rev: (prev?.rev ?? 0) + 1,
    issuedAt: t,
    bands: c.bands,
    headDirDeg: Math.round(c.headDirDeg),
    rosMpm: c.rosMpm,
    drivers,
    previous: prev?.bands,
    etaToPlaces,
  };
  sim.projection = proj;
  sim.projField = field;
  sim.projHead = c.head;
  sim.projCenter = c.center;
  sim.projWeather = { dir: w.windDirDeg, kph: w.windKph };
  sim.projMs = [...sim.projMs.slice(-19), round(field.computeMs, 1)];
  sim.bus.publish({ type: 'projection.updated', at: t, projection: proj });
  issueChecks(sim, proj, field);
  rebuildCoverage(sim);
  retargetAircraft(sim, c.head);
  sim.gradeDirty = true;
  sim.briefDirty = true;
  void reason;
  return proj;
}

/**
 * Modelled minutes from now until the fire reaches `pos` (min over a ring of radius uncM * 0.7).
 * 0 = at the observed active edge, -1 = burned more than 90 min ago, Infinity = outside the model horizon.
 * Present-time burn state is an observation; everything ahead of it comes from the model.
 */
export function modelEtaMin(sim: Sim, pos: Geo, uncM: number): number {
  const obs = sim.ctx.arrivalNear(pos, uncM > 50 ? uncM * 0.7 : 0);
  if (obs <= sim.t) return obs > sim.t - 90 * MIN ? 0 : -1;
  const f = sim.projField;
  if (!f) return Infinity;
  const m = fieldMinAt(f, pos, uncM > 50 ? uncM * 0.7 : 0);
  if (m < 0 || !Number.isFinite(m)) return Infinity;
  const dt = f.issuedAt + m * MIN - sim.t;
  return dt <= 0 ? 0 : dt / MIN;
}

export function projectionBusy(sim: Sim): boolean {
  const p = sim.pools.find((x) => x.def.id === 'pool-projection');
  return !!p && p.queue.length + p.running.length > 0;
}

/** Runs the Projection agent as a job; the new revision is applied when the job completes. */
export function requestProjection(sim: Sim, reason: string, extra: string[] = [], force = false): void {
  if (!force && projectionBusy(sim)) return;
  enqueue(sim, 'pool-projection', {
    input: `Re-project +1H/+3H/+6H · ${reason}`,
    source: 'terrain',
    minutes: 15,
    counters: { projectionsRun: 1 },
    durS: 8,
    text: (a) => `${a} re-ran the spread model (${reason}) · rev ${(sim.projection?.rev ?? 0) + 1} · ${sim.projMs[sim.projMs.length - 1] ?? 0} ms compute`,
    onDone: (s) => {
      applyProjection(s, reason, extra);
    },
  });
  sim.timers.proj = sim.t + 20 * MIN;
}

export function tickProjection(sim: Sim): void {
  if (!sim.projection) {
    if (sim.t >= sim.ctx.tDetect && sim.t >= sim.timers.proj) {
      if (!applyProjection(sim, 'initial')) sim.timers.proj = sim.t + MIN;
    }
    return;
  }
  if (!sim.shiftApplied && sim.ctx.tShift !== null && sim.t >= sim.ctx.tShift) {
    sim.shiftApplied = true;
    requestProjection(sim, 'wind shift', [shiftDriver(sim)], true);
    return;
  }
  const w = sim.ctx.weatherAt(sim.t);
  const pw = sim.projWeather;
  if (pw && !persistenceAt(sim) && (Math.abs(((w.windDirDeg - pw.dir + 540) % 360) - 180) > 35 || Math.abs(w.windKph - pw.kph) > 12)) {
    requestProjection(sim, 'weather change', [`Observed wind ${Math.round(w.windDirDeg)}° ${Math.round(w.windKph)} kph (was ${Math.round(pw.dir)}°)`]);
    return;
  }
  if (sim.t >= sim.timers.proj) requestProjection(sim, 'scheduled 20 min');
}
