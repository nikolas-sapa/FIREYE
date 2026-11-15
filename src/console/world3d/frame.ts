import { FuelClass } from '../contracts';
import { valueNoise } from './rng';
import type { WorldSourceGrid } from './types';

export const TILE_M = 256;
const DEG = Math.PI / 180;

/**
 * Local east-up-south frame in metres around the pack centre (three.js: +x east, +y up, -z north).
 * Equirectangular is accurate to centimetres over the 16 km pack and keeps raster cells uniform.
 */
export class LocalFrame {
  readonly mLon: number;
  readonly mLat = 110540;
  readonly xMin: number;
  readonly xMax: number;
  readonly zMin: number;
  readonly zMax: number;
  readonly tilesX: number;
  readonly tilesZ: number;
  constructor(readonly lon0: number, readonly lat0: number, readonly bbox: [number, number, number, number]) {
    this.mLon = 111320 * Math.cos(lat0 * DEG);
    this.xMin = this.x(bbox[0]); this.xMax = this.x(bbox[2]);
    this.zMin = this.z(bbox[3]); this.zMax = this.z(bbox[1]);
    this.tilesX = Math.ceil((this.xMax - this.xMin) / TILE_M);
    this.tilesZ = Math.ceil((this.zMax - this.zMin) / TILE_M);
  }
  x(lon: number) { return (lon - this.lon0) * this.mLon; }
  z(lat: number) { return -(lat - this.lat0) * this.mLat; }
  lon(x: number) { return this.lon0 + x / this.mLon; }
  lat(z: number) { return this.lat0 - z / this.mLat; }
  tileOf(x: number, z: number): [number, number] { return [Math.floor((x - this.xMin) / TILE_M), Math.floor((z - this.zMin) / TILE_M)]; }
  tileOrigin(tx: number, tz: number): [number, number] { return [this.xMin + tx * TILE_M, this.zMin + tz * TILE_M]; }
  validTile(tx: number, tz: number) { return tx >= 0 && tz >= 0 && tx < this.tilesX && tz < this.tilesZ; }
  static of(grid: Pick<WorldSourceGrid, 'center' | 'bbox'>) { return new LocalFrame(grid.center.lon, grid.center.lat, grid.bbox); }
}

/**
 * The single height function shared by the generator, far terrain, cameras and agents.
 * DEM bilinear (1×), sea cells lowered under the water plane, plus a small seeded micro-relief
 * that is visual only and never more than ±0.3 m.
 */
export class HeightField {
  readonly frame: LocalFrame;
  private readonly elev: Float32Array;
  private readonly w: number;
  private readonly h: number;
  private readonly cx: number;
  private readonly cz: number;
  constructor(readonly grid: WorldSourceGrid) {
    this.frame = LocalFrame.of(grid);
    this.w = grid.w; this.h = grid.h;
    this.cx = (this.frame.xMax - this.frame.xMin) / grid.w;
    this.cz = (this.frame.zMax - this.frame.zMin) / grid.h;
    const e = new Float32Array(grid.w * grid.h);
    for (let i = 0; i < e.length; i++) {
      const v = grid.elevation[i];
      const base = Number.isFinite(v) && v > -500 && v < 9000 ? v : 0;
      e[i] = grid.fuel[i] === FuelClass.Water ? Math.min(base, 0) - 2.2 : base;
    }
    this.elev = e;
  }
  /** Continuous raster cell coordinates of a local point. */
  cell(x: number, z: number): [number, number] { return [(x - this.frame.xMin) / this.cx, (z - this.frame.zMin) / this.cz]; }
  index(x: number, z: number): number {
    const cx = Math.floor((x - this.frame.xMin) / this.cx), cz = Math.floor((z - this.frame.zMin) / this.cz);
    if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) return -1;
    return cz * this.w + cx;
  }
  dem(x: number, z: number): number {
    let fx = (x - this.frame.xMin) / this.cx - 0.5, fz = (z - this.frame.zMin) / this.cz - 0.5;
    const outside = fx < 0 || fz < 0 || fx > this.w - 1 || fz > this.h - 1;
    fx = Math.min(this.w - 1, Math.max(0, fx)); fz = Math.min(this.h - 1, Math.max(0, fz));
    const x0 = Math.floor(fx), z0 = Math.floor(fz), x1 = Math.min(this.w - 1, x0 + 1), z1 = Math.min(this.h - 1, z0 + 1);
    const tx = fx - x0, tz = fz - z0, e = this.elev, w = this.w;
    const v = (e[z0 * w + x0] * (1 - tx) + e[z0 * w + x1] * tx) * (1 - tz) + (e[z1 * w + x0] * (1 - tx) + e[z1 * w + x1] * tx) * tz;
    if (!outside) return v;
    // Outside the pack: ease toward a low plain so the fogged horizon has no cliff.
    const dx = Math.max(this.frame.xMin - x, 0, x - this.frame.xMax), dz = Math.max(this.frame.zMin - z, 0, z - this.frame.zMax);
    const k = Math.min(1, Math.hypot(dx, dz) / 4000);
    // Sea stays sea beyond the pack edge; land eases toward a low plain.
    const target = v < 0 ? Math.min(v, -6) : Math.max(v * 0.6, 4);
    return v + (target - v) * k * k * (3 - 2 * k);
  }
  height(x: number, z: number): number {
    const d = this.dem(x, z);
    if (d < -0.5) return d;
    const micro = (valueNoise(x / 9, z / 9, 7) - 0.5) * 0.42 + (valueNoise(x / 2.7, z / 2.7, 11) - 0.5) * 0.16;
    return d + micro * Math.min(1, Math.max(0, d) / 1.5);
  }
  slope(x: number, z: number): number {
    const s = 3, dx = this.dem(x + s, z) - this.dem(x - s, z), dz = this.dem(x, z + s) - this.dem(x, z - s);
    return Math.hypot(dx, dz) / (2 * s);
  }
  fuelAt(x: number, z: number): number { const i = this.index(x, z); return i < 0 ? FuelClass.None : this.grid.fuel[i]; }
  clcAt(x: number, z: number): number { const i = this.index(x, z); return i < 0 || !this.grid.clc ? 0 : this.grid.clc[i]; }
  isWater(x: number, z: number) { return this.fuelAt(x, z) === FuelClass.Water || this.dem(x, z) < -0.4; }
}
