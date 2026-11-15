/**
 * Deterministic procedural world for the FCC simulation.
 * Everything here is pure: same seed -> same terrain, fuels, roads and town.
 */
import { CellState, Fuel, GRID_H, GRID_W, type Grid, type Vec, type WorldMeta } from './types';

export type Rng = () => number;

/** mulberry32 — small, fast, good-enough seeded PRNG. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Noise2D = (x: number, y: number) => number;

/** Value noise in [0,1] on an integer lattice with quintic interpolation. */
export function createNoise2D(seed: number): Noise2D {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) vals[i] = rng();
  const h = (x: number, y: number) => vals[perm[(perm[x & 255] + y) & 255]];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** Fractal Brownian motion, normalized to ~[0,1]. */
export function fbm(n: Noise2D, x: number, y: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += n(x * freq + o * 17.3, y * freq - o * 9.1) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal in [0,1]: sharp crests, soft valleys. */
export function ridged(n: Noise2D, x: number, y: number, octaves = 4): number {
  let amp = 1, freq = 1, sum = 0, norm = 0, prev = 1;
  for (let o = 0; o < octaves; o++) {
    let r = 1 - Math.abs(n(x * freq + o * 31.7, y * freq + o * 5.3) * 2 - 1);
    r *= r;
    sum += r * amp * prev;
    norm += amp;
    prev = r;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function distToSegment(px: number, py: number, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / l2, 0, 1);
  const x = a.x + t * dx - px, y = a.y + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

export function distToPolyline(px: number, py: number, pts: Vec[]): number {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distToSegment(px, py, pts[i], pts[i + 1]));
  return d;
}

/** Catmull-Rom resample of a control polyline into a smooth one (cell units). */
function spline(ctrl: Vec[], perSeg = 8): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push({ ...ctrl[ctrl.length - 1] });
  return out;
}

/** Vertical relief represented by elevation 0..1, in meters (used for slope). */
export const RELIEF_M = 820;

export interface World {
  grid: Grid;
  meta: WorldMeta;
  /** Pristine copies used by reset(). */
  pristine: { fuel: Uint8Array; dryness: Float32Array };
}

export function buildWorld(seed = 7): World {
  const W = GRID_W, H = GRID_H, N = W * H;
  const rng = mulberry32(seed * 9973 + 11);
  const nA = createNoise2D(seed * 31 + 1);
  const nB = createNoise2D(seed * 31 + 2);
  const nC = createNoise2D(seed * 31 + 3);
  const nD = createNoise2D(seed * 31 + 4);

  const ignition: Vec = { x: 70, y: 86 };
  const town = { name: 'PINE HOLLOW', center: { x: 179, y: 44 }, x0: 166, y0: 34, x1: 192, y1: 54 };
  const trailhead: Vec = { x: 127, y: 57 };
  const reservoir = { center: { x: 52, y: 131 }, rx: 14, ry: 7 };
  const helibase: Vec = { x: 26, y: 141 };
  const airbase: Vec = { x: 231, y: 141 };
  const icp: Vec = { x: 118, y: 110 };

  const river = spline([
    { x: 36, y: -2 }, { x: 31, y: 16 }, { x: 39, y: 33 }, { x: 33, y: 51 }, { x: 41, y: 69 },
    { x: 36, y: 88 }, { x: 44, y: 106 }, { x: 47, y: 120 }, { x: 50, y: 127 },
  ], 10);

  const roads: WorldMeta['roads'] = [
    { id: 'hwy49', name: 'HWY 49', kind: 'highway', points: spline([
      { x: -2, y: 113 }, { x: 22, y: 112 }, { x: 44, y: 110 }, { x: 72, y: 108 }, { x: 98, y: 104 },
      { x: 122, y: 100 }, { x: 146, y: 90 }, { x: 166, y: 76 }, { x: 184, y: 64 }, { x: 204, y: 52 }, { x: 242, y: 38 },
    ], 8) },
    { id: 'ridge', name: 'RIDGE RD', kind: 'road', points: spline([
      { x: 158, y: 84 }, { x: 163, y: 70 }, { x: 167, y: 60 }, { x: 170, y: 50 }, { x: 171, y: 36 },
      { x: 168, y: 22 }, { x: 162, y: 8 }, { x: 158, y: -2 },
    ], 8) },
    { id: 'fs12n', name: 'FS 12N', kind: 'road', points: spline([
      { x: 100, y: 104 }, { x: 103, y: 90 }, { x: 98, y: 76 }, { x: 103, y: 62 }, { x: 98, y: 46 },
      { x: 106, y: 30 }, { x: 113, y: 14 }, { x: 118, y: -2 },
    ], 8) },
    { id: 'trail', name: 'HOLLOW TRAIL', kind: 'trail', points: spline([
      { x: 166, y: 53 }, { x: 156, y: 56 }, { x: 146, y: 54 }, { x: 136, y: 58 }, { x: 127, y: 57 },
    ], 8) },
    { id: 'heli', name: 'HELIBASE RD', kind: 'road', points: spline([
      { x: 22, y: 112 }, { x: 24, y: 126 }, { x: 26, y: 141 },
    ], 6) },
  ];

  // --- elevation --------------------------------------------------------------
  const elevation = new Float32Array(N);
  let mn = Infinity, mx = -Infinity;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const base = fbm(nA, x / 70, y / 70, 5);
      const r = ridged(nB, x / 48 + 3.1, y / 48 - 1.7, 4);
      // Regional trend: high country to the north-east, foothills to the south-west.
      const trend = (x / W) * 0.18 + (1 - y / H) * 0.22;
      let e = base * 0.55 + r * 0.5 + trend;
      const dr = distToPolyline(x, y, river);
      e -= 0.32 * Math.exp(-(dr * dr) / 160);
      const rx = (x - reservoir.center.x) / (reservoir.rx * 2.2), ry = (y - reservoir.center.y) / (reservoir.ry * 2.6);
      e -= 0.3 * Math.exp(-(rx * rx + ry * ry) * 2);
      elevation[i] = e;
    }
  }
  // Flatten the town bench.
  let townAvg = 0, townN = 0;
  for (let y = town.y0; y <= town.y1; y++) for (let x = town.x0; x <= town.x1; x++) { townAvg += elevation[y * W + x]; townN++; }
  townAvg /= townN;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = Math.max(town.x0 - x, 0, x - town.x1), dy = Math.max(town.y0 - y, 0, y - town.y1);
      const m = 1 - smooth(0, 9, Math.sqrt(dx * dx + dy * dy));
      const i = y * W + x;
      elevation[i] = elevation[i] * (1 - m * 0.85) + townAvg * m * 0.85;
      mn = Math.min(mn, elevation[i]); mx = Math.max(mx, elevation[i]);
    }
  }
  for (let i = 0; i < N; i++) elevation[i] = (elevation[i] - mn) / (mx - mn);

  // --- fuel + dryness ----------------------------------------------------------
  const fuel = new Uint8Array(N);
  const dryness = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = elevation[i];
      const ex = (elevation[y * W + Math.min(W - 1, x + 1)] - elevation[y * W + Math.max(0, x - 1)]) * 0.5;
      const ey = (elevation[Math.min(H - 1, y + 1) * W + x] - elevation[Math.max(0, y - 1) * W + x]) * 0.5;
      const slope = Math.sqrt(ex * ex + ey * ey) * RELIEF_M / 40; // rise/run
      // Downslope direction faces north when elevation increases southward (+y).
      const northness = clamp(ey / (Math.sqrt(ex * ex + ey * ey) + 1e-4), -1, 1) * clamp(slope * 4, 0, 1);
      const dr = distToPolyline(x, y, river);
      const moist = fbm(nC, x / 30, y / 30, 4) * 0.55 + Math.exp(-dr / 9) * 0.4 + northness * 0.25 - e * 0.15;
      const n2 = fbm(nD, x / 14, y / 14, 3);

      let f: Fuel;
      if (e > 0.8 && n2 > 0.52 && slope > 0.12) f = Fuel.Rock;
      else if (moist > 0.5 || (northness > 0.3 && n2 > 0.4 && e > 0.25)) f = Fuel.Timber;
      else if (e < 0.34 && slope < 0.22) f = n2 > 0.66 ? Fuel.Brush : Fuel.Grass;
      else if (slope > 0.34 || n2 > 0.58) f = Fuel.Brush;
      else f = Fuel.Grass;
      fuel[i] = f;

      const fuelBias = f === Fuel.Brush ? 0.16 : f === Fuel.Grass ? 0.1 : f === Fuel.Timber ? -0.12 : 0;
      dryness[i] = clamp(0.52 - northness * 0.26 + fuelBias - (moist - 0.4) * 0.45 + (n2 - 0.5) * 0.25, 0.05, 1);
    }
  }

  // Water: river channel + reservoir.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const dr = distToPolyline(x + 0.5, y + 0.5, river);
      const rx = (x + 0.5 - reservoir.center.x) / reservoir.rx, ry = (y + 0.5 - reservoir.center.y) / reservoir.ry;
      const wob = fbm(nD, x / 6, y / 6, 2) * 0.35;
      if (dr < 1.1 || rx * rx + ry * ry < 1 + wob - 0.15) { fuel[i] = Fuel.Water; dryness[i] = 0; }
    }
  }

  // Town: urban blocks with a street grid.
  const buildings: WorldMeta['buildings'] = [];
  for (let y = town.y0; y <= town.y1; y++) {
    for (let x = town.x0; x <= town.x1; x++) {
      const i = y * W + x;
      const street = (x - town.x0) % 6 === 0 || (y - town.y0) % 5 === 0;
      fuel[i] = street ? Fuel.Road : Fuel.Urban;
      dryness[i] = street ? 0 : 0.35;
    }
  }
  for (let by = town.y0; by < town.y1; by += 5) {
    for (let bx = town.x0; bx < town.x1; bx += 6) {
      // Two rows of lots per block.
      for (let row = 0; row < 2; row++) {
        let cx = bx + 1.25;
        while (cx < bx + 5.6) {
          if (rng() < 0.86) {
            const w = 0.9 + rng() * 0.8, h = 1.0 + rng() * 0.6;
            if (cx + w > bx + 5.8) break;
            buildings.push({ x: cx, y: by + 1.2 + row * 1.85, w, h: Math.min(h, 1.55) });
            cx += w + 0.35 + rng() * 0.3;
          } else cx += 1.2;
        }
      }
    }
  }
  // Rural structures along Ridge Rd and the trail.
  const rural: Vec[] = [
    { x: 164, y: 66 }, { x: 166.5, y: 63 }, { x: 161, y: 73 }, { x: 168.5, y: 58 }, { x: 173, y: 30 }, { x: 169, y: 24 },
    { x: 150, y: 57.5 }, { x: 141, y: 55.5 }, { x: 129, y: 59.5 }, { x: 195, y: 58 }, { x: 199, y: 49 }, { x: 188, y: 60 },
  ];
  for (const p of rural) {
    buildings.push({ x: p.x, y: p.y, w: 1.1 + rng() * 0.5, h: 0.9 + rng() * 0.4 });
    const i = Math.floor(p.y) * W + Math.floor(p.x);
    if (fuel[i] !== Fuel.Water) { fuel[i] = Fuel.Urban; dryness[i] = 0.4; }
  }

  // Roads rasterized last (bridges over water are fine).
  for (const r of roads) {
    if (r.kind === 'trail') continue;
    const pts = r.points;
    for (let s = 0; s < pts.length - 1; s++) {
      const a = pts[s], b = pts[s + 1];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2) + 1;
      for (let k = 0; k <= steps; k++) {
        const x = Math.floor(a.x + ((b.x - a.x) * k) / steps), y = Math.floor(a.y + ((b.y - a.y) * k) / steps);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        fuel[i] = Fuel.Road;
        dryness[i] = 0;
      }
    }
  }
  // Trailhead parking: bare ground.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const i = (Math.floor(trailhead.y) + dy) * W + Math.floor(trailhead.x) + dx;
    fuel[i] = Fuel.Road; dryness[i] = 0;
  }

  const grid: Grid = {
    w: W, h: H, elevation, fuel, dryness,
    state: new Uint8Array(N).fill(CellState.Unburnt),
    heat: new Float32Array(N),
    retardant: new Float32Array(N),
    version: 0,
  };

  const meta: WorldMeta = {
    seed, ignition, town, trailhead, reservoir, helibase, airbase, icp, river, roads, buildings,
    landmarks: [
      { id: 'lm-town', label: 'PINE HOLLOW', pos: { x: town.center.x, y: town.y0 - 2.5 } },
      { id: 'lm-th', label: 'HOLLOW TRAILHEAD', pos: { x: trailhead.x, y: trailhead.y + 3 } },
      { id: 'lm-res', label: 'CEDAR RESERVOIR', pos: { x: reservoir.center.x, y: reservoir.center.y + reservoir.ry + 2.5 } },
      { id: 'lm-heli', label: 'HELIBASE', pos: { x: helibase.x, y: helibase.y + 3 } },
      { id: 'lm-air', label: 'AIR ATTACK BASE', pos: { x: airbase.x - 4, y: airbase.y + 3.5 } },
      { id: 'lm-icp', label: 'ICP', pos: { x: icp.x, y: icp.y + 3 } },
      { id: 'lm-river', label: 'BEAR CREEK', pos: { x: 30, y: 60 } },
    ],
  };

  return { grid, meta, pristine: { fuel: fuel.slice(), dryness: dryness.slice() } };
}

/** Flammable fuel types. */
export const isFlammable = (f: number) => f === Fuel.Grass || f === Fuel.Brush || f === Fuel.Timber || f === Fuel.Urban;

/** Military-style grid reference: column letter per 10 cells, row number per 10 cells, e.g. "K-08". */
export function gridRef(p: Vec): string {
  const col = String.fromCharCode(65 + clamp(Math.floor(p.x / 10), 0, 23));
  const row = String(clamp(Math.floor(p.y / 10) + 1, 1, 15)).padStart(2, '0');
  return `${col}-${row}`;
}
