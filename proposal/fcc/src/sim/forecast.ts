/**
 * Elliptical fire-growth projection. Rays are cast from the fire centroid; each ray
 * starts at the current perimeter and spends a "spread budget" derived from an
 * Anderson-style wind ellipse. Fuel, dryness, slope and retardant modulate the cost
 * of each step, so bands hug terrain and stall on water / rock / lined edges.
 */
import { CELL_M, CellState, Fuel, type ForecastBand, type Grid, type Vec, type Wind } from './types';
import { RELIEF_M } from './terrain';

const RAYS = 96;
const HORIZONS = [60, 180, 360] as const;

/** Relative spread speed per fuel type (cost = 1 / speed). */
const FUEL_SPEED: Record<number, number> = {
  [Fuel.Water]: 0.015, [Fuel.Rock]: 0.08, [Fuel.Grass]: 1.25, [Fuel.Brush]: 1, [Fuel.Timber]: 0.55,
  [Fuel.Urban]: 0.45, [Fuel.Road]: 0.35, [Fuel.Burnt]: 0.05,
};

const rFire = new Float32Array(RAYS);
const out = [new Float32Array(RAYS), new Float32Array(RAYS), new Float32Array(RAYS)];
const tmp = new Float32Array(RAYS);

function smoothRing(a: Float32Array, passes: number) {
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < RAYS; i++) tmp[i] = a[(i + RAYS - 1) % RAYS] * 0.25 + a[i] * 0.5 + a[(i + 1) % RAYS] * 0.25;
    a.set(tmp);
  }
}

export interface ForecastInput {
  grid: Grid;
  wind: Wind;
  /** Head rate of spread, meters per minute. */
  rosMpm: number;
  /** 0..1 penalty to confidence (e.g. gustiness, stale intel). */
  uncertainty: number;
}

export function computeForecast({ grid, wind, rosMpm, uncertainty }: ForecastInput): ForecastBand[] {
  const { w, h, state, fuel, dryness, retardant, elevation } = grid;
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (state[i] !== CellState.Unburnt) { sx += i % w; sy += (i / w) | 0; n++; }
  }
  if (n === 0) return [];
  const cx = sx / n + 0.5, cy = sy / n + 0.5;

  // Current perimeter radius per ray.
  rFire.fill(0);
  for (let i = 0; i < w * h; i++) {
    if (state[i] === CellState.Unburnt) continue;
    const dx = (i % w) + 0.5 - cx, dy = ((i / w) | 0) + 0.5 - cy;
    const d = Math.sqrt(dx * dx + dy * dy) + 0.7;
    let a = Math.atan2(dy, dx);
    if (a < 0) a += Math.PI * 2;
    const b = Math.floor((a / (Math.PI * 2)) * RAYS) % RAYS;
    if (d > rFire[b]) rFire[b] = d;
  }
  // Fill empty bins from neighbors (small or patchy fires).
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < RAYS; i++) {
      if (rFire[i] === 0) rFire[i] = Math.max(rFire[(i + RAYS - 1) % RAYS], rFire[(i + 1) % RAYS]) * 0.9;
    }
  }
  for (let i = 0; i < RAYS; i++) rFire[i] = Math.max(rFire[i], 1.5);
  smoothRing(rFire, 1);

  // Wind ellipse (length/width ratio grows with wind speed).
  const lw = 1 + 0.28 * Math.pow(Math.max(wind.speedKph, 0), 0.62);
  const ecc = Math.sqrt(1 - 1 / (lw * lw));
  const toRad = ((wind.dirDeg + 180) * Math.PI) / 180;
  const wx = Math.sin(toRad), wy = -Math.cos(toRad);
  const ros = Math.min(Math.max(rosMpm, 6), 70);

  for (let r = 0; r < RAYS; r++) {
    const a = ((r + 0.5) / RAYS) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    const cosPhi = dx * wx + dy * wy;
    const shape = (1 - ecc) / (1 - ecc * cosPhi);
    const budgets = HORIZONS.map((hm) => (ros * Math.pow(hm, 0.92) * shape) / CELL_M);
    let dist = rFire[r];
    let spent = 0;
    let k = 0;
    let prevE = -1;
    const maxSteps = 400;
    for (let s = 0; s < maxSteps && k < 3; s++) {
      const px = cx + dx * dist, py = cy + dy * dist;
      if (px < 0 || py < 0 || px >= w || py >= h) {
        while (k < 3) out[k++][r] = dist;
        break;
      }
      const i = (py | 0) * w + (px | 0);
      const e = elevation[i];
      const slope = prevE < 0 ? 0 : ((e - prevE) * RELIEF_M) / (CELL_M * 0.5);
      prevE = e;
      const slopeF = Math.min(Math.max(Math.exp(slope * 2.2), 0.45), 2.6);
      const unburnt = state[i] === CellState.Unburnt;
      const fs = unburnt ? FUEL_SPEED[fuel[i]] ?? 0.5 : 1.4;
      const speed = fs * (0.45 + dryness[i] * 0.9 + (unburnt ? 0 : 0.6)) * (1 - retardant[i] * 0.85) * slopeF;
      spent += 0.5 / Math.max(speed, 0.01);
      dist += 0.5;
      while (k < 3 && spent >= budgets[k]) out[k++][r] = dist;
    }
    while (k < 3) out[k++][r] = dist;
  }

  const bands: ForecastBand[] = [];
  const baseConf = [0.88, 0.72, 0.54];
  for (let k = 0; k < 3; k++) {
    const arr = out[k];
    smoothRing(arr, 3);
    const inner = k === 0 ? rFire : out[k - 1];
    for (let r = 0; r < RAYS; r++) arr[r] = Math.max(arr[r], inner[r] + 0.8);
    const polygon: Vec[] = [];
    for (let r = 0; r < RAYS; r++) {
      const a = ((r + 0.5) / RAYS) * Math.PI * 2;
      polygon.push({
        x: Math.min(Math.max(cx + Math.cos(a) * arr[r], 0), w),
        y: Math.min(Math.max(cy + Math.sin(a) * arr[r], 0), h),
      });
    }
    bands.push({
      horizonMin: HORIZONS[k],
      polygon,
      confidence: Math.max(0.2, baseConf[k] * (1 - uncertainty * (0.12 + k * 0.08))),
    });
  }
  return bands;
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
