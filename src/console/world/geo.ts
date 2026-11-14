import type { BBox, Geo, ScenarioPack } from '../contracts';
import { bearingDeg, destination, distanceM, geoToCellF } from '../scenario/geo';

export { bearingDeg, destination, distanceM };

export const MIN = 60_000;

/** Signed smallest difference b - a in degrees (-180..180). */
export function angDiff(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(deg: number): string {
  return POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function cellSizeM(pack: ScenarioPack, lat: number): { dx: number; dy: number } {
  const { w, h, bbox } = pack.raster;
  return {
    dx: ((bbox[2] - bbox[0]) / w) * 111320 * Math.cos((lat * Math.PI) / 180),
    dy: ((bbox[3] - bbox[1]) / h) * 110574,
  };
}

export function cellOf(pack: ScenarioPack, g: Geo): { x: number; y: number } {
  const f = geoToCellF(pack, g);
  return { x: Math.floor(f.x), y: Math.floor(f.y) };
}

/** Visits raster cells within `r` meters of `c` (every `stride` cells). */
export function scanRadius(pack: ScenarioPack, c: Geo, r: number, stride: number, fn: (x: number, y: number, i: number, d: number) => void): void {
  const { dx, dy } = cellSizeM(pack, c.lat);
  const { x: cx, y: cy } = cellOf(pack, c);
  const W = pack.raster.w;
  const H = pack.raster.h;
  const rx = Math.ceil(r / dx);
  const ry = Math.ceil(r / dy);
  const r2 = r * r;
  for (let y = Math.max(0, cy - ry); y <= Math.min(H - 1, cy + ry); y += stride) {
    const ddy = (y - cy) * dy;
    for (let x = Math.max(0, cx - rx); x <= Math.min(W - 1, cx + rx); x += stride) {
      const ddx = (x - cx) * dx;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 > r2) continue;
      fn(x, y, y * W + x, Math.sqrt(d2));
    }
  }
}

/** Absolute arrival (epoch ms) of raster index i, Infinity if it never burns. */
export function arrivalIdx(pack: ScenarioPack, i: number): number {
  const a = pack.arrival[i];
  return a === a ? pack.manifest.start + a : Infinity;
}

export function centroid(pts: Geo[]): Geo {
  if (!pts.length) return { lon: 0, lat: 0 };
  let lon = 0;
  let lat = 0;
  for (const p of pts) {
    lon += p.lon;
    lat += p.lat;
  }
  return { lon: lon / pts.length, lat: lat / pts.length };
}

export function bboxOf(pts: Geo[]): BBox {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of pts) {
    if (p.lon < w) w = p.lon;
    if (p.lon > e) e = p.lon;
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
  }
  return [w, s, e, n];
}

export function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${String(r).padStart(2, '0')}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function round(n: number, d = 0): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function clamp(n: number, a: number, b: number): number {
  return n < a ? a : n > b ? b : n;
}
