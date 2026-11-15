import { FuelClass, type Geo, type ScenarioPack } from '../contracts';
import { getSampler } from './sampler';
import { sunPosition } from './sun';

const DEG = Math.PI / 180;
const MIN = 60_000;

/**
 * Everything the stage tunes per scenario, derived from the pack (bbox, raster, relief, arrival,
 * weather). No scenario-specific constants live anywhere else in the stage.
 */
export interface StageProfile {
  center: Geo;
  widthM: number;
  heightM: number;
  /** Larger bbox side in metres. */
  spanM: number;
  minElev: number;
  maxElev: number;
  /** 2nd..98th percentile elevation range of land cells. */
  reliefM: number;
  exaggeration: number;
  /** Contour interval in metres (index contour every 5th). */
  contourM: number;
  homeRangeM: number;
  minZoomM: number;
  maxZoomM: number;
  /** Place labels: towns visible below this camera distance, minor places below the second. */
  labelFarM: number;
  minorLabelFarM: number;
  unitLabelFarM: number;
  /** Fire hotspot clustering bin (metres). */
  hotspotBinM: number;
  /** Cells that ignited within this window draw as active flame. */
  activeMs: number;
  /** Median rate of spread from the arrival raster (m/min). */
  rosMpm: number;
  waterFrac: number;
  coastal: boolean;
  /** Time used for the baked relief light (mid-replay sun). */
  reliefSun: { azDeg: number; elDeg: number };
  /** Sizes of fire effects, scaled to the hotspot bin. */
  flameRadiusM: number;
  smokeRadiusM: number;
}

const cache = new WeakMap<ScenarioPack, StageProfile>();

export function getProfile(pack: ScenarioPack): StageProfile {
  let p = cache.get(pack);
  if (!p) {
    p = build(pack);
    cache.set(pack, p);
  }
  return p;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function build(pack: ScenarioPack): StageProfile {
  const s = getSampler(pack);
  const { w, h, bbox } = pack.raster;
  const b = pack.manifest.bbox ?? bbox;
  const center = pack.manifest.center ?? { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 };
  const widthM = (bbox[2] - bbox[0]) * 111320 * Math.cos(center.lat * DEG);
  const heightM = (bbox[3] - bbox[1]) * 110540;
  const spanM = Math.max(widthM, heightM);
  const cellM = pack.raster.cellM || widthM / w;

  // Relief percentiles over land cells (sub-sampled).
  const elev: number[] = [];
  let water = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 60000)));
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = y * w + x;
      n++;
      if (pack.fuel[i] === FuelClass.Water) { water++; continue; }
      const v = pack.elevation[i];
      if (Number.isFinite(v) && v > -500 && v < 9000) elev.push(v);
    }
  }
  elev.sort((a, c) => a - c);
  const pct = (q: number) => (elev.length ? elev[Math.min(elev.length - 1, Math.floor(q * elev.length))] : 0);
  const reliefM = Math.max(1, pct(0.98) - pct(0.02));
  const waterFrac = n ? water / n : 0;

  const spanKm = spanM / 1000;
  const ratio = reliefM / spanM;
  // Small scenes read best near true scale; very large or very flat scenes get a little lift.
  const exaggeration = clamp(1 + (0.3 * (spanKm - 8)) / 32 + Math.max(0, 0.05 - ratio) * 2, 1, 1.3);

  const steps = [2, 5, 10, 20, 25, 50, 100, 200];
  let contourM = steps[steps.length - 1];
  for (const c of steps) if (reliefM / c <= 45) { contourM = c; break; }

  // Spread rate from arrival gradients (ms per cell between 4-neighbours).
  const speeds: number[] = [];
  const st2 = Math.max(1, Math.floor(step / 2));
  for (let y = 1; y < h - 1; y += st2) {
    for (let x = 1; x < w - 1; x += st2) {
      const a = pack.arrival[y * w + x];
      if (!Number.isFinite(a)) continue;
      const ax = pack.arrival[y * w + x + 1], ay = pack.arrival[(y + 1) * w + x];
      if (!Number.isFinite(ax) || !Number.isFinite(ay)) continue;
      const g = Math.hypot(ax - a, ay - a) / cellM; // ms per metre
      if (g > 0) speeds.push(1 / g);
    }
  }
  speeds.sort((a, c) => a - c);
  const msPerMs = speeds.length ? speeds[Math.floor(speeds.length * 0.6)] : 0.5 / MIN;
  const rosMpm = clamp(msPerMs * MIN, 0.2, 400);
  const frontDepthM = clamp(spanM * 0.025, 250, 900);
  const activeMs = clamp(frontDepthM / rosMpm, 20, 90) * MIN;

  const hotspotBinM = clamp(spanM / 60, 120, 650);

  const dur = pack.manifest.end - pack.manifest.start;
  const sunT = pack.manifest.start + Math.min(3 * 3600e3, Math.max(0, dur / 2));
  const sun = sunPosition(sunT, center.lat, center.lon);
  const reliefSun = sun.elDeg > 5
    ? { azDeg: sun.azDeg, elDeg: clamp(sun.elDeg, 25, 45) }
    : { azDeg: 315, elDeg: 38 };

  return {
    center,
    widthM,
    heightM,
    spanM,
    minElev: s.min,
    maxElev: s.max,
    reliefM,
    exaggeration,
    contourM,
    homeRangeM: spanM * 0.95,
    minZoomM: clamp(cellM * 2, 40, 150),
    maxZoomM: Math.max(60000, spanM * 7),
    labelFarM: Math.max(20000, spanM * 4),
    minorLabelFarM: Math.max(8000, spanM * 1.15),
    unitLabelFarM: Math.max(12000, spanM * 1.8),
    hotspotBinM,
    activeMs,
    rosMpm,
    waterFrac,
    coastal: waterFrac > 0.02,
    reliefSun,
    flameRadiusM: hotspotBinM * 0.28,
    smokeRadiusM: hotspotBinM * 0.38,
  };
}
