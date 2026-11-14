import type { Geo, Projection } from '../contracts';
import { FuelClass } from '../contracts';
import { cellToGeo } from '../scenario';
import type { Sim } from '../world/sim';
import { MIN, cellOf, cellSizeM, compass, destination, round } from '../world/geo';
import { rebuildCoverage } from '../world/coverage';
import { retargetAircraft } from '../world/units';
import { enqueue } from './swarm';

const BINS = 96;
const HORIZONS = [60, 180, 360] as const;
const UNC: Record<number, number> = { 60: 150, 180: 350, 360: 700 };
const CONF = [0.8, 0.6, 0.4];

/**
 * Before the evening wind shift is ingested the model runs on the pre-frontal forecast and under-predicts
 * spread (horizons scaled by this factor); after it, the projection follows the replay's arrival raster.
 */
export const PRE_SHIFT_BIAS = 0.6;

export function biasAt(sim: Sim, t: number): number {
  return t < sim.ctx.tShift ? PRE_SHIFT_BIAS : 1;
}

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
  const nz: number[] = [];
  for (let i = 0; i < n; i++) if (r[i] > 0) nz.push(i);
  if (!nz.length) return;
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
    const va = r[(a + n) % n];
    const vb = r[b % n];
    r[i] = (va * db + vb * da) / (da + db || 1);
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

interface Computed {
  bands: Projection['bands'];
  headDirDeg: number;
  rosMpm: number;
  center: Geo;
  head: Geo;
  fuelText: string;
}

function compute(sim: Sim, t: number, bias: number): Computed {
  const pack = sim.ctx.pack;
  const W = pack.raster.w;
  const H = pack.raster.h;
  const arr = pack.arrival;
  const elev = pack.elevation;
  const rel = t - sim.ctx.start;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (arr[y * W + x] <= rel) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  const ig = cellOf(pack, sim.ctx.sites.ignition);
  const cx = n ? sx / n : ig.x;
  const cy = n ? sy / n : ig.y;
  const center = cellToGeo(pack, cx, cy);
  const { dx, dy } = cellSizeM(pack, center.lat);
  const thr = HORIZONS.map((h) => rel + h * MIN * bias);
  const rNow = new Float64Array(BINS);
  const r = HORIZONS.map(() => new Float64Array(BINS));
  const fuel = new Map<number, number>();
  let south = 0;
  let tot = 0;
  for (let y = 2; y < H - 2; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = y * W + x;
      const a = arr[i];
      if (!(a <= thr[2])) continue;
      const ddx = (x - cx) * dx;
      const ddy = (cy - y) * dy;
      const d = Math.hypot(ddx, ddy);
      const ang = ((Math.atan2(ddx, ddy) * 180) / Math.PI + 360) % 360;
      const b = Math.floor((ang / 360) * BINS) % BINS;
      if (a <= rel && d > rNow[b]) rNow[b] = d;
      for (let k = 0; k < 3; k++) if (a <= thr[k] && d > r[k][b]) r[k][b] = d;
      if (a > rel && a <= thr[1]) {
        tot++;
        const fc = pack.fuel[i];
        fuel.set(fc, (fuel.get(fc) ?? 0) + 1);
        if (elev[i - 2 * W] - elev[i + 2 * W] > 4) south++;
      }
    }
  }
  fillAndSmooth(rNow);
  r.forEach(fillAndSmooth);
  for (let b = 0; b < BINS; b++) {
    r[0][b] = Math.max(r[0][b], rNow[b]);
    r[1][b] = Math.max(r[1][b], r[0][b]);
    r[2][b] = Math.max(r[2][b], r[1][b]);
  }
  let hb = 0;
  let growth = -1;
  for (let b = 0; b < BINS; b++) {
    const g = r[0][b] - rNow[b];
    if (g > growth) {
      growth = g;
      hb = b;
    }
  }
  let ros = growth / 60;
  if (growth < 100) {
    for (let b = 0; b < BINS; b++) {
      const g = (r[1][b] - rNow[b]) / 3;
      if (g > growth) {
        growth = g;
        hb = b;
      }
    }
    ros = growth / 60;
  }
  const headDirDeg = ((hb + 0.5) * 360) / BINS;
  const bands = HORIZONS.map((h, k) => ({
    horizonMin: h,
    polygon: Array.from({ length: BINS }, (_, b) => {
      const p = destination(center, ((b + 0.5) * 360) / BINS, r[k][b] + UNC[h]);
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
  const fuelText = tot ? `${FUEL_LABEL[topFuel] ?? 'Mixed fuels'} (${Math.round((topN / tot) * 100)}% of +3H) · ${Math.round((south / tot) * 100)}% south aspects` : 'Fuel: mixed conifer and shrub';
  return { bands, headDirDeg, rosMpm: round(ros, 1), center, head: destination(center, headDirDeg, Math.max(200, rNow[hb])), fuelText };
}

export function shiftDriver(sim: Sim): string {
  const { shiftFrom: a, shiftTo: b } = sim.ctx;
  return `Wind shift ingested: ${Math.round(a.windDirDeg)}° → ${Math.round(b.windDirDeg)}° by ${sim.ctx.fmtTime(b.t)} (Open-Meteo archive), gusts to ${Math.round(Math.max(a.gustKph, b.gustKph))} kph`;
}

export function applyProjection(sim: Sim, reason: string, extra: string[] = []): Projection {
  const t = sim.t;
  const bias = biasAt(sim, t);
  sim.projBias = bias;
  const c = compute(sim, t, bias);
  const w = sim.ctx.weatherAt(t);
  const prev = sim.projection;
  const etaToPlaces: Record<string, number> = {};
  for (const p of sim.ctx.places) {
    const pa = sim.ctx.placeArr[p.id];
    if (!Number.isFinite(pa) || pa > t + 36 * 60 * MIN) continue;
    etaToPlaces[p.id] = pa <= t ? pa : Math.round(t + (pa - t) / bias);
  }
  const drivers = [
    `Wind ${Math.round(w.windDirDeg)}° ${compass(w.windDirDeg)} ${Math.round(w.windKph)} kph · gusts ${Math.round(w.gustKph)}`,
    `RH ${Math.round(w.rh)}% · ${Math.round(w.tempC)}°C`,
    c.fuelText,
    `Head ${compass(c.headDirDeg)} at ${Math.round(c.rosMpm)} m/min`,
    ...extra,
  ];
  if (bias < 1) drivers.push('Model wind: daytime forecast (evening shift not yet ingested)');
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
  sim.projHead = c.head;
  sim.projCenter = c.center;
  sim.projWeather = { dir: w.windDirDeg, kph: w.windKph };
  sim.timers.proj = t + 20 * MIN;
  sim.bus.publish({ type: 'projection.updated', at: t, projection: proj });
  rebuildCoverage(sim);
  retargetAircraft(sim, c.head);
  sim.gradeDirty = true;
  sim.briefDirty = true;
  void reason;
  return proj;
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
    text: (a) => `${a} re-ran the spread model (${reason}) · rev ${sim.projection?.rev ?? 1}`,
    onDone: (s) => {
      applyProjection(s, reason, extra);
    },
  });
  sim.timers.proj = sim.t + 20 * MIN;
}

export function tickProjection(sim: Sim): void {
  if (!sim.projection) {
    applyProjection(sim, 'initial');
    return;
  }
  if (!sim.shiftApplied && sim.t >= sim.ctx.tShift) {
    sim.shiftApplied = true;
    requestProjection(sim, 'wind shift', [shiftDriver(sim)], true);
    return;
  }
  const w = sim.ctx.weatherAt(sim.t);
  const pw = sim.projWeather;
  if (pw && sim.shiftApplied && (Math.abs(((w.windDirDeg - pw.dir + 540) % 360) - 180) > 35 || Math.abs(w.windKph - pw.kph) > 12)) {
    requestProjection(sim, 'weather change', [`Observed wind ${Math.round(w.windDirDeg)}° ${Math.round(w.windKph)} kph (was ${Math.round(pw.dir)}°)`]);
    return;
  }
  if (sim.t >= sim.timers.proj) requestProjection(sim, 'scheduled 20 min');
}
