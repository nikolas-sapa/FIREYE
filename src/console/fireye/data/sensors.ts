import type { Geo, Ms, ScenarioPack } from '../../contracts';
import { arrivalIdx, bearingDeg, destination, distanceM, scanRadius } from '../../world/geo';
import { elevationAt, weatherAt } from '../../scenario';
import type { SensorKind, SensorReading, SensorSpec, SensorStatus } from './types';

/* Deterministic noise: same sensor + same minute always gives the same value. */
function hash(s: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise in -1..1 over minutes. */
function noise(id: string, t: Ms, periodMin: number): number {
  const x = t / 60000 / periodMin;
  const i = Math.floor(x), f = x - i, k = f * f * (3 - 2 * f);
  return (hash(id, i) * (1 - k) + hash(id, i + 1) * k) * 2 - 1;
}

interface Anchor { id: string; fallback: Geo }
const ANCHORS: Record<string, Anchor> = {
  ignition: { id: 'ignition', fallback: { lon: 23.95191, lat: 38.03991 } },
  ntaou: { id: 'ntaou-penteli', fallback: { lon: 23.94493, lat: 38.03904 } },
  voutzas: { id: 'neos-voutzas', fallback: { lon: 23.98115, lat: 38.04226 } },
  mati: { id: 'mati', fallback: { lon: 23.99247, lat: 38.04932 } },
  kokkino: { id: 'kokkino-limanaki', fallback: { lon: 24.00043, lat: 38.0334 } },
  rafina: { id: 'rafina', fallback: { lon: 24.00734, lat: 38.02037 } },
  makri: { id: 'nea-makri', fallback: { lon: 23.97907, lat: 38.08305 } },
  kalli: { id: 'kallitechnoupoli', fallback: { lon: 23.95955, lat: 38.02527 } },
  marathonos: { id: 'marathonos-crossing', fallback: { lon: 23.98518, lat: 38.03414 } },
  agiaMarina: { id: 'agia-marina', fallback: { lon: 23.97212, lat: 38.06236 } },
  summit: { id: 'penteli-summit', fallback: { lon: 23.88, lat: 38.05 } },
  dioni: { id: 'dioni', fallback: { lon: 23.93221, lat: 38.02268 } },
};

type Layout = [code: string, kind: SensorKind, anchor: keyof typeof ANCHORS, bearing: number, distM: number, sector: string, exposure: number];
/** Hand-placed simulated mesh: denser on the Daou–Penteli slopes and the wildland-urban edge. */
const LAYOUT: Layout[] = [
  ['WX-01', 'wx', 'ignition', 320, 650, 'Daou–Penteli', 1.25],
  ['FLM-01', 'flame', 'ignition', 92, 280, 'Daou–Penteli', 1],
  ['FUL-01', 'fuel', 'ignition', 200, 520, 'Daou–Penteli', 1],
  ['AIR-01', 'air', 'ignition', 75, 1300, 'Daou–Penteli', 1],
  ['WX-02', 'wx', 'summit', 120, 2600, 'Penteli slopes', 1.35],
  ['FUL-02', 'fuel', 'ntaou', 285, 900, 'Penteli slopes', 1],
  ['FLM-02', 'flame', 'ntaou', 20, 700, 'Penteli slopes', 1],
  ['WX-03', 'wx', 'kalli', 40, 600, 'Kallitechnoupoli', 1.05],
  ['FLM-03', 'flame', 'kalli', 70, 1100, 'Kallitechnoupoli', 1],
  ['WX-04', 'wx', 'voutzas', 270, 350, 'Neos Voutzas', 1],
  ['AIR-02', 'air', 'voutzas', 90, 300, 'Neos Voutzas', 1],
  ['FLM-04', 'flame', 'voutzas', 250, 900, 'Neos Voutzas', 1],
  ['FUL-03', 'fuel', 'voutzas', 330, 800, 'Neos Voutzas', 1],
  ['AIR-03', 'air', 'marathonos', 10, 250, 'Marathonos Ave', 1],
  ['WX-05', 'wx', 'marathonos', 160, 500, 'Marathonos Ave', 0.95],
  ['WX-06', 'wx', 'mati', 230, 450, 'Mati', 0.9],
  ['AIR-04', 'air', 'mati', 140, 350, 'Mati', 1],
  ['FLM-05', 'flame', 'mati', 255, 900, 'Mati', 1],
  ['FUL-04', 'fuel', 'mati', 300, 1200, 'Mati', 1],
  ['AIR-05', 'air', 'kokkino', 0, 200, 'Kokkino Limanaki', 1],
  ['WX-07', 'wx', 'rafina', 300, 500, 'Rafina', 0.9],
  ['AIR-06', 'air', 'rafina', 20, 700, 'Rafina', 1],
  ['WX-08', 'wx', 'agiaMarina', 200, 400, 'Nea Makri west', 1.05],
  ['FUL-05', 'fuel', 'dioni', 30, 700, 'Dioni', 1],
];

export interface SensorModel {
  pack: ScenarioPack;
  specs: SensorSpec[];
  readingAt(id: string, t: Ms): SensorReading;
  /** All readings at t (cached per 30 s bucket). */
  all(t: Ms): SensorReading[];
}

interface Near { d: number; a: number; b: number }
/* b: bearing from the burning cell to the sensor (air sensors only). */

const cache = new WeakMap<ScenarioPack, SensorModel>();

export function sensorModel(pack: ScenarioPack): SensorModel {
  const hit = cache.get(pack);
  if (hit) return hit;
  const places = pack.manifest.places;
  const anchor = (k: keyof typeof ANCHORS): Geo => {
    const a = ANCHORS[k];
    const p = places.find((x) => x.id === a.id);
    return p ? { lon: p.pos.lon, lat: p.pos.lat } : a.fallback;
  };
  const refElev = elevationAt(pack, pack.manifest.center);
  const specs: SensorSpec[] = LAYOUT.map(([code, kind, a, b, d, sector, exposure]) => {
    const pos = destination(anchor(a), b, d);
    const near = places.reduce((best, p) => (distanceM(pos, p.pos) < distanceM(pos, best.pos) ? p : best), places[0]);
    return {
      id: `iot-${code.toLowerCase()}`, code, kind, sector, exposure, pos,
      elevM: Math.round(elevationAt(pack, pos)),
      name: near ? `near ${near.name.replace(/\s*\(.*\)$/, '')}` : sector,
    };
  });

  // Per-sensor list of nearby cells that burn, sorted by arrival, with a running minimum distance.
  // Reading at t only consults entries with arrival <= t: the current fire state, never the future.
  const nearby = new Map<string, { arr: Float64Array; minD: Float64Array }>();
  for (const s of specs) {
    const cells: Near[] = [];
    scanRadius(pack, s.pos, s.kind === 'air' ? 6000 : 3000, s.kind === 'air' ? 3 : 2, (_x, _y, i, d) => {
      const a = arrivalIdx(pack, i);
      if (Number.isFinite(a)) cells.push({ d, a, b: 0 });
    });
    cells.sort((p, q) => p.a - q.a);
    const arr = new Float64Array(cells.length), minD = new Float64Array(cells.length);
    let m = Infinity;
    cells.forEach((c, k) => { arr[k] = c.a; m = Math.min(m, c.d); minD[k] = m; });
    nearby.set(s.id, { arr, minD });
  }
  // Bearing from each burning cell toward an air sensor, for downwind smoke weighting.
  const airCells = new Map<string, Near[]>();
  for (const s of specs) {
    if (s.kind !== 'air') continue;
    const list: Near[] = [];
    scanRadius(pack, s.pos, 6000, 3, (x, y, i, d) => {
      const a = arrivalIdx(pack, i);
      if (!Number.isFinite(a)) return;
      const { w, h, bbox } = pack.raster;
      const g = { lon: bbox[0] + ((x + 0.5) / w) * (bbox[2] - bbox[0]), lat: bbox[3] - ((y + 0.5) / h) * (bbox[3] - bbox[1]) };
      list.push({ d, a, b: bearingDeg(g, s.pos) });
    });
    airCells.set(s.id, list);
  }

  const fireDist = (id: string, t: Ms): number | null => {
    const n = nearby.get(id)!;
    let lo = 0, hi = n.arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (n.arr[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo === 0 ? null : n.minD[lo - 1];
  };

  const emc = (tempC: number, rh: number) => {
    const T = tempC * 9 / 5 + 32, H = Math.max(1, Math.min(100, rh));
    return H < 10 ? 0.03229 + 0.281073 * H - 0.000578 * H * T
      : H < 50 ? 2.22749 + 0.160107 * H - 0.01478 * T
        : 21.0606 + 0.005565 * H * H - 0.00035 * H * T - 0.483199 * H;
  };
  const ffwiOf = (m: number, windKph: number) => {
    const x = Math.min(30, Math.max(0, m)) / 30;
    const eta = 1 - 2 * x + 1.5 * x * x - 0.5 * x * x * x;
    const U = windKph / 1.609;
    return Math.min(100, (eta * Math.sqrt(1 + U * U)) / 0.3002);
  };

  const ambient = (s: SensorSpec, t: Ms) => {
    const w = weatherAt(pack, t);
    const lapse = -0.0065 * (s.elevM - refElev);
    const tempC = w.tempC + lapse + noise(s.id + 't', t, 9) * 0.6;
    const rh = Math.max(4, w.rh * (1 - lapse * 0.035) + noise(s.id + 'h', t, 11) * 1.8);
    const gustK = 0.55 + 0.45 * (0.5 + 0.5 * noise(s.id + 'g', t, 2));
    const windKph = Math.max(0, w.windKph * s.exposure * (1 + noise(s.id + 'w', t, 3) * 0.12));
    const gustKph = Math.max(windKph, w.gustKph * s.exposure * gustK + windKph * (1 - gustK));
    const windDirDeg = (w.windDirDeg + noise(s.id + 'd', t, 6) * 12 + 360) % 360;
    return { tempC, rh, windKph, gustKph, windDirDeg };
  };

  const readingAt = (id: string, tIn: Ms): SensorReading => {
    const t = Math.floor(tIn / 30000) * 30000;
    const s = specs.find((x) => x.id === id)!;
    const a = ambient(s, t);
    const dist = fireDist(id, t);
    let { tempC, rh } = a;
    let ir = 0;
    if (dist !== null && dist < 600) {
      const k = Math.max(0, 1 - dist / 600);
      tempC += 34 * k * k;
      rh = Math.max(3, rh * (1 - 0.7 * k));
      ir = Math.min(1, k * 1.25);
    }
    // Fuel moisture lags the air: average equilibrium moisture over the previous hour.
    let m = 0;
    for (let k = 0; k < 6; k++) {
      const p = ambient(s, t - k * 600000);
      m += emc(p.tempC, p.rh);
    }
    let fmc = m / 6 + noise(s.id + 'f', t, 15) * 0.25;
    if (dist !== null && dist < 300) fmc = Math.max(0.5, fmc * (dist / 300));
    let pm25 = 9 + noise(s.id + 'p', t, 7) * 2;
    let co = 0.3 + noise(s.id + 'c', t, 7) * 0.08;
    const list = airCells.get(id);
    if (list) {
      const w = weatherAt(pack, t);
      const downwind = (w.windDirDeg + 180) % 360;
      let load = 0;
      for (const c of list) {
        if (c.a > t || t - c.a > 120 * 60000) continue;
        const off = Math.abs(((c.b - downwind + 540) % 360) - 180);
        if (off > 50) continue;
        load += Math.cos((off / 50) * (Math.PI / 2)) * (1 / Math.max(250, c.d));
      }
      pm25 += load * 1600;
      co += load * 160;
    } else if (dist !== null && dist < 1500) {
      pm25 += 400 * (1 - dist / 1500);
      co += 40 * (1 - dist / 1500);
    }
    const ffwi = ffwiOf(fmc, (a.windKph + a.gustKph) / 2);
    const burned = dist !== null && dist < 45;
    const battery = Math.max(0.2, 0.92 - hash(s.id, 1) * 0.25);
    let status: SensorStatus = 'nominal';
    if (burned) status = 'offline';
    else if (s.kind === 'flame') status = ir >= 0.35 ? 'alarm' : ir > 0.05 || ffwi >= 70 ? 'watch' : 'nominal';
    else if (s.kind === 'air') status = pm25 >= 150 || co >= 15 ? 'alarm' : pm25 >= 45 ? 'watch' : 'nominal';
    else if (s.kind === 'fuel') status = fmc <= 3.2 ? 'alarm' : fmc <= 5.5 ? 'watch' : 'nominal';
    else status = tempC >= 55 ? 'alarm' : ffwi >= 70 || rh <= 15 ? 'watch' : 'nominal';
    return {
      id, t, status, tempC, rh, windKph: a.windKph, gustKph: a.gustKph, windDirDeg: a.windDirDeg,
      fmc, pm25, co, ir, ffwi, fireDistM: dist, battery, link: burned ? 0 : 0.8 + hash(s.id, 2) * 0.2,
    };
  };

  let lastKey = NaN;
  let lastAll: SensorReading[] = [];
  const model: SensorModel = {
    pack,
    specs,
    readingAt,
    all(t) {
      const k = Math.floor(t / 30000);
      if (k !== lastKey) { lastKey = k; lastAll = specs.map((s) => readingAt(s.id, t)); }
      return lastAll;
    },
  };
  cache.set(pack, model);
  return model;
}

export const SENSOR_KIND_LABEL: Record<SensorKind, string> = {
  wx: 'Weather node', fuel: 'Fuel moisture', air: 'Smoke / gas', flame: 'IR flame detector',
};
