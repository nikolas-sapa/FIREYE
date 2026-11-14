import type { ScenarioPack } from '../contracts';
import type { Hotspot } from './fire';
import { getProfile, type StageProfile } from './profile';
import { RasterSampler } from './raster';

/** Plume heights are encoded in 8 bits over this range (metres above sea level). */
export const SMOKE_H_MAX = 6000;
const N = 224;
const DEG = Math.PI / 180;

export interface SmokeDomain {
  /** Local ENU metres (origin = profile.center at sea level). */
  minX: number;
  minY: number;
  size: number;
}

/**
 * 2D plume footprint over a square domain around the scenario: per texel the column density (R),
 * plume base (G) and top (B) altitude, and near-ground haze (A). Built on the CPU from the active fire
 * clusters and the hourly wind with a bent-over Gaussian plume; the atmosphere pass ray-marches it.
 * Double-buffered so the shader can cross-fade between updates.
 */
export class SmokeField {
  readonly domain: SmokeDomain;
  readonly profile: StageProfile;
  private canvases: [HTMLCanvasElement, HTMLCanvasElement];
  private front = 0;
  private img: ImageData;
  private dens = new Float32Array(N * N);
  private base = new Float32Array(N * N);
  private top = new Float32Array(N * N);
  private wsum = new Float32Array(N * N);
  private haze = new Float32Array(N * N);
  rev = 0;
  changedAt = 0;
  plumeTopM = 0;
  wind = { x: 0, y: 0, ms: 0 };
  private sig = '';
  private listeners = new Set<() => void>();

  constructor(readonly pack: ScenarioPack, readonly sampler: RasterSampler) {
    this.profile = getProfile(pack);
    const size = this.profile.spanM * 2.4;
    this.domain = { minX: -size / 2, minY: -size / 2, size };
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = N;
      c.height = N;
      return c;
    };
    this.canvases = [mk(), mk()];
    this.img = new ImageData(N, N);
  }

  get current(): HTMLCanvasElement { return this.canvases[this.front]; }
  get previous(): HTMLCanvasElement { return this.canvases[this.front ^ 1]; }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Local ENU metres of a lon/lat (equirectangular around the profile centre). */
  local(lon: number, lat: number): [number, number] {
    const c = this.profile.center;
    return [(lon - c.lon) * 111320 * Math.cos(c.lat * DEG), (lat - c.lat) * 110540];
  }

  update(sources: Hotspot[], wind: { dirDeg: number; kph: number }, exaggeration: number) {
    const sig = `${sources.length}|${sources.slice(0, 6).map((s) => `${s.lon.toFixed(4)},${s.heat.toFixed(2)}`).join(';')}|${wind.dirDeg.toFixed(0)}|${wind.kph.toFixed(0)}|${exaggeration}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const to = ((wind.dirDeg + 180) % 360) * DEG;
    const wx = Math.sin(to), wy = Math.cos(to);
    const ms = Math.max(1, wind.kph / 3.6);
    this.wind = { x: wx * ms, y: wy * ms, ms };
    // Bent-over plume: strong wind keeps the column low and long.
    const hTop = Math.min(4500, Math.max(1100, 5200 / (1 + wind.kph / 30)));
    this.plumeTopM = hTop;
    const lRise = 500 + ms * 70;
    const decayL = Math.max(8000, this.profile.spanM * 3);
    const { minX, minY, size } = this.domain;
    const px = size / N;
    const dens = this.dens, base = this.base, top = this.top, wsum = this.wsum;
    dens.fill(0); base.fill(0); top.fill(0); wsum.fill(0);
    const src = sources.slice(0, 48).map((s) => {
      const [x, y] = this.local(s.lon, s.lat);
      return { x, y, h: s.heat, g: this.sampler.elevation(s.lon, s.lat) * exaggeration };
    });
    const sigma0 = Math.max(60, this.profile.hotspotBinM * 0.45);
    // Many overlapping clusters would otherwise saturate the whole footprint, leaving a hard texel-stepped rim.
    const norm = 1 / Math.max(1, Math.sqrt(src.reduce((a, s) => a + s.h, 0)));
    for (let j = 0; j < N; j++) {
      // Row 0 = north (max y) to match texture orientation used by the fire field.
      const y = minY + size - (j + 0.5) * px;
      for (let i = 0; i < N; i++) {
        const x = minX + (i + 0.5) * px;
        const k = j * N + i;
        for (const s of src) {
          const dx = x - s.x, dy = y - s.y;
          const a = dx * wx + dy * wy;
          if (a < -4 * sigma0) continue;
          const c = -dx * wy + dy * wx;
          const aa = Math.max(0, a);
          const sg = sigma0 + 0.13 * aa;
          if (Math.abs(c) > 4.2 * sg) continue;
          let wgt = norm * s.h * Math.exp(-0.5 * (c / sg) ** 2) * Math.pow(sigma0 / sg, 0.55) * Math.exp(-aa / decayL);
          if (a < 0) wgt *= Math.exp(-((a / sigma0) ** 2));
          if (wgt < 1e-4) continue;
          const rise = 1 - Math.exp(-aa / lRise);
          const t = 250 + 120 * s.h + (hTop - 250) * rise;
          const b = t * 0.42 * (1 - Math.exp(-aa / (lRise * 1.6)));
          dens[k] += wgt;
          top[k] += (s.g + t) * wgt;
          base[k] += (s.g + b) * wgt;
          wsum[k] += wgt;
        }
      }
    }
    // Near-ground haze: smoke that has settled low, spread wide.
    const haze = this.haze;
    for (let k = 0; k < N * N; k++) {
      if (wsum[k] > 0) { top[k] /= wsum[k]; base[k] /= wsum[k]; }
      haze[k] = dens[k] * Math.exp(-Math.max(0, base[k] - this.profile.minElev * exaggeration) / 900);
    }
    blur(haze, N, 4);
    blur(haze, N, 4);
    const d = this.img.data;
    for (let k = 0; k < N * N; k++) {
      const o = k * 4;
      d[o] = Math.min(255, (1 - Math.exp(-dens[k] * 1.4)) * 255);
      d[o + 1] = Math.min(255, (base[k] / SMOKE_H_MAX) * 255);
      d[o + 2] = Math.min(255, (top[k] / SMOKE_H_MAX) * 255);
      d[o + 3] = Math.min(255, (1 - Math.exp(-haze[k] * 1.6)) * 255);
    }
    this.front ^= 1;
    this.canvases[this.front].getContext('2d')!.putImageData(this.img, 0, 0);
    this.rev++;
    this.changedAt = performance.now();
    for (const fn of this.listeners) fn();
  }
}

function blur(a: Float32Array, n: number, r: number) {
  const tmp = new Float32Array(a.length);
  const w = 2 * r + 1;
  for (let y = 0; y < n; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += a[y * n + Math.min(n - 1, Math.max(0, x))];
    for (let x = 0; x < n; x++) {
      tmp[y * n + x] = acc / w;
      acc += a[y * n + Math.min(n - 1, x + r + 1)] - a[y * n + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < n; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(n - 1, Math.max(0, y)) * n + x];
    for (let y = 0; y < n; y++) {
      a[y * n + x] = acc / w;
      acc += tmp[Math.min(n - 1, y + r + 1) * n + x] - tmp[Math.max(0, y - r) * n + x];
    }
  }
}

const cache = new WeakMap<ScenarioPack, SmokeField>();
export function getSmokeField(pack: ScenarioPack, s: RasterSampler): SmokeField {
  let f = cache.get(pack);
  if (!f) {
    f = new SmokeField(pack, s);
    cache.set(pack, f);
  }
  return f;
}
