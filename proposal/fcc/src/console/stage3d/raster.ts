import type { BBox, Geo, ScenarioPack } from '../contracts';

const R_EARTH = 6371008.8;
const DEG = Math.PI / 180;

/**
 * Fast local sampler over the scenario raster. Kept inside the stage so per-frame / per-tile work
 * (terrain callbacks, particle placement, camera poses) never depends on other modules' hot paths.
 */
export class RasterSampler {
  readonly w: number;
  readonly h: number;
  readonly bbox: BBox;
  readonly dLon: number;
  readonly dLat: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  private readonly elev: Float32Array;
  /** Edge rows/columns, heavily smoothed: the surface outside the bbox settles onto these. */
  private readonly edgeN: Float32Array;
  private readonly edgeS: Float32Array;
  private readonly edgeW: Float32Array;
  private readonly edgeE: Float32Array;
  /**
   * Added to every height the stage places (not to the offline heightmap itself). Calibrated when a
   * basemap uses ellipsoidal heights (Google 3D tiles, Cesium World Terrain) while the pack DEM is
   * orthometric.
   */
  datumOffset = 0;

  constructor(readonly pack: ScenarioPack) {
    const { w, h, bbox } = pack.raster;
    this.w = w;
    this.h = h;
    this.bbox = bbox;
    this.dLon = (bbox[2] - bbox[0]) / w;
    this.dLat = (bbox[3] - bbox[1]) / h;
    // Clean nodata so the heightmap never spikes.
    const src = pack.elevation;
    let sum = 0, n = 0, mn = Infinity, mx = -Infinity;
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      if (Number.isFinite(v) && v > -500 && v < 9000) { sum += v; n++; if (v < mn) mn = v; if (v > mx) mx = v; }
    }
    this.mean = n ? sum / n : 0;
    this.min = Number.isFinite(mn) ? mn : 0;
    this.max = Number.isFinite(mx) ? mx : 0;
    const e = new Float32Array(w * h);
    for (let i = 0; i < e.length; i++) {
      const v = src[i];
      e[i] = Number.isFinite(v) && v > -500 && v < 9000 ? v : this.mean;
    }
    this.elev = e;
    const radius = Math.max(2, Math.round(2000 / Math.max(1, pack.raster.cellM || 30)));
    const row = (y: number) => Float32Array.from({ length: w }, (_, x) => e[y * w + x]);
    const col = (x: number) => Float32Array.from({ length: h }, (_, y) => e[y * w + x]);
    this.edgeN = smooth(row(0), radius);
    this.edgeS = smooth(row(h - 1), radius);
    this.edgeW = smooth(col(0), radius);
    this.edgeE = smooth(col(w - 1), radius);
  }

  inside(lon: number, lat: number): boolean {
    const b = this.bbox;
    return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
  }

  /** Continuous cell coordinates (cell centres at integer + 0.5). */
  fx(lon: number) { return (lon - this.bbox[0]) / this.dLon; }
  fy(lat: number) { return (this.bbox[3] - lat) / this.dLat; }

  cellIndex(lon: number, lat: number): number {
    const x = Math.floor(this.fx(lon));
    const y = Math.floor(this.fy(lat));
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return y * this.w + x;
  }

  cellGeo(x: number, y: number, out?: Geo): Geo {
    const o = out ?? { lon: 0, lat: 0 };
    o.lon = this.bbox[0] + (x + 0.5) * this.dLon;
    o.lat = this.bbox[3] - (y + 0.5) * this.dLat;
    return o;
  }

  /** Terrain height in metres as placed in the scene (DEM + datum offset). */
  elevation(lon: number, lat: number): number {
    return this.demElevation(lon, lat) + this.datumOffset;
  }

  /**
   * Bilinear DEM elevation in metres. Outside the bbox it eases over 3 km onto the smoothed edge
   * profile, so coasts stay at sea level and ridges fade without streaks.
   */
  demElevation(lon: number, lat: number): number {
    const b = this.bbox;
    const cl = Math.min(b[2], Math.max(b[0], lon));
    const ca = Math.min(b[3], Math.max(b[1], lat));
    let x = this.fx(cl) - 0.5;
    let y = this.fy(ca) - 0.5;
    const w = this.w, h = this.h;
    if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
    if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const tx = x - x0, ty = y - y0;
    const e = this.elev;
    const a = e[y0 * w + x0], bb = e[y0 * w + x1], c = e[y1 * w + x0], d = e[y1 * w + x1];
    const v = (a * (1 - tx) + bb * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    if (cl === lon && ca === lat) return v;
    const dx = (lon - cl) * 111320 * Math.cos(lat * DEG);
    const dy = (lat - ca) * 110540;
    const dist = Math.hypot(dx, dy);
    const k = Math.min(1, dist / 3000);
    const s = k * k * (3 - 2 * k);
    const outX = cl !== lon, outY = ca !== lat;
    const ex = outX ? sampleEdge(lon < b[0] ? this.edgeW : this.edgeE, y) : 0;
    const ey = outY ? sampleEdge(lat > b[3] ? this.edgeN : this.edgeS, x) : 0;
    const target = outX && outY ? (ex + ey) / 2 : outX ? ex : ey;
    return v + (target - v) * s;
  }

  /** Cell size in metres (approx, at bbox centre). */
  get cellM(): number {
    return this.pack.raster.cellM;
  }
}

export function destination(g: Geo, bearingDeg: number, meters: number): Geo {
  const br = bearingDeg * DEG;
  const lat1 = g.lat * DEG, lon1 = g.lon * DEG;
  const dr = meters / R_EARTH;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(lat1), Math.cos(dr) - Math.sin(lat1) * Math.sin(lat2));
  return { lon: lon2 / DEG, lat: lat2 / DEG };
}

export function distanceM(a: Geo, b: Geo): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingDeg(a: Geo, b: Geo): number {
  const la1 = a.lat * DEG, la2 = b.lat * DEG, dLon = (b.lon - a.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

/** Ring of `n` points around `c` at radius `r` metres (closed: first point repeated). */
export function circle(c: Geo, r: number, n = 48): Geo[] {
  const pts: Geo[] = [];
  const mLon = 111320 * Math.cos(c.lat * DEG);
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push({ lon: c.lon + (Math.sin(a) * r) / mLon, lat: c.lat + (Math.cos(a) * r) / 110540 });
  }
  return pts;
}

export function centroid(poly: Geo[]): Geo {
  let lon = 0, lat = 0;
  const n = poly.length || 1;
  for (const p of poly) { lon += p.lon; lat += p.lat; }
  return { lon: lon / n, lat: lat / n };
}

/**
 * Hourly weather interpolated to t. `t` of the result is the bracketing sample time (stable key for
 * "weather changed" checks); wind direction interpolates the short way round.
 */
export function weatherAt(pack: ScenarioPack, t: number): ScenarioPack['weather'][number] {
  const w = pack.weather;
  if (!w.length) return { windKph: 0, windDirDeg: 0, gustKph: 0, tempC: 20, rh: 40, t: 0 };
  if (t <= w[0].t) return w[0];
  if (t >= w[w.length - 1].t) return w[w.length - 1];
  let lo = 0, hi = w.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (w[m].t <= t) lo = m; else hi = m; }
  const a = w[lo], b = w[hi];
  // Quantised to 10 minutes so consumers re-sync a few times per hour, not every frame.
  const f = Math.round(((t - a.t) / (b.t - a.t)) * 6) / 6;
  const dd = ((b.windDirDeg - a.windDirDeg + 540) % 360) - 180;
  return {
    t: a.t + (b.t - a.t) * f,
    windKph: a.windKph + (b.windKph - a.windKph) * f,
    windDirDeg: (a.windDirDeg + dd * f + 360) % 360,
    gustKph: a.gustKph + (b.gustKph - a.gustKph) * f,
    tempC: a.tempC + (b.tempC - a.tempC) * f,
    rh: a.rh + (b.rh - a.rh) * f,
  };
}

function smooth(a: Float32Array, r: number): Float32Array {
  let cur = a;
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(cur.length);
    let acc = 0;
    const n = cur.length;
    const at = (i: number) => cur[Math.min(n - 1, Math.max(0, i))];
    for (let i = -r; i <= r; i++) acc += at(i);
    for (let i = 0; i < n; i++) {
      out[i] = acc / (2 * r + 1);
      acc += at(i + r + 1) - at(i - r);
    }
    cur = out;
  }
  return cur;
}

function sampleEdge(a: Float32Array, f: number): number {
  const n = a.length;
  const x = Math.min(n - 1, Math.max(0, f));
  const i = Math.floor(x), j = Math.min(n - 1, i + 1);
  return a[i] + (a[j] - a[i]) * (x - i);
}

export const DEG2RAD = DEG;
