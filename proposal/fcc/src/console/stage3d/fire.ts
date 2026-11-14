import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import type { Geo, ScenarioPack } from '../contracts';
import { FIRE, glsl3 } from './palette';
import { getProfile } from './profile';
import { RasterSampler } from './raster';

const SCAR_AGE_MS = 10 * 3600 * 1000;

export interface Hotspot extends Geo {
  heat: number;
}

export interface FireStats {
  burnedCells: number;
  activeCells: number;
  acres: number;
}

/**
 * Computes the fire field (from pack.arrival) into an RGBA data image:
 * R = burned mask, G = active heat (1 at ignition, 0 after the profile's active window), B = scar age.
 * One field instance can feed several Cesium scenes (stage + feed renderer).
 */
export class FireField {
  readonly w: number;
  readonly h: number;
  private canvases: [HTMLCanvasElement, HTMLCanvasElement];
  private front = 0;
  private image: ImageData;
  rev = 0;
  lastT = -Infinity;
  /** Hottest clusters (flames / embers). */
  hotspots: Hotspot[] = [];
  /** Every active cluster, hottest first (smoke sources). */
  sources: Hotspot[] = [];
  readonly activeMs: number;
  private readonly binCells: number;
  stats: FireStats = { burnedCells: 0, activeCells: 0, acres: 0 };
  private listeners = new Set<() => void>();

  constructor(readonly pack: ScenarioPack, readonly sampler: RasterSampler) {
    this.w = pack.raster.w;
    this.h = pack.raster.h;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = this.w;
      c.height = this.h;
      return c;
    };
    this.canvases = [mk(), mk()];
    const prof = getProfile(pack);
    this.activeMs = prof.activeMs;
    this.binCells = Math.max(2, Math.round(prof.hotspotBinM / (pack.raster.cellM || 30)));
    this.image = new ImageData(this.w, this.h);
  }

  /** The canvas holding the latest field. Alternates between two canvases so Cesium re-uploads it. */
  get canvas(): HTMLCanvasElement {
    return this.canvases[this.front];
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private syncedRev = NaN;

  /** Idempotent: recompute when the store bumps fireRev or the clock drifts > 5 min (or jumps back). */
  sync(t: number, fireRev: number) {
    if (fireRev === this.syncedRev && t >= this.lastT && t - this.lastT < 5 * 60 * 1000) return false;
    this.syncedRev = fireRev;
    this.update(t);
    return true;
  }

  update(t: number, maxHotspots = 18) {
    const { w, h, pack } = this;
    const tRel = t - pack.manifest.start;
    const arr = pack.arrival;
    const d = this.image.data;
    const bin = this.binCells;
    const activeMs = this.activeMs;
    const bw = Math.ceil(w / bin), bh = Math.ceil(h / bin);
    const sum = new Float32Array(bw * bh), sx = new Float32Array(bw * bh), sy = new Float32Array(bw * bh);
    let burned = 0, active = 0;
    for (let y = 0; y < h; y++) {
      const by = ((y / bin) | 0) * bw;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const a = arr[i];
        const o = i * 4;
        if (!(a <= tRel)) {
          d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 255;
          continue;
        }
        const age = tRel - a;
        burned++;
        let heat = 1 - age / activeMs;
        if (heat > 0) {
          active++;
          heat = Math.sqrt(heat);
          const b = by + ((x / bin) | 0);
          sum[b] += heat;
          sx[b] += x * heat;
          sy[b] += y * heat;
        } else heat = 0;
        d[o] = 255;
        d[o + 1] = heat * 255;
        d[o + 2] = Math.min(1, age / SCAR_AGE_MS) * 255;
        d[o + 3] = 255;
      }
    }
    this.front ^= 1;
    const ctx = this.canvases[this.front].getContext('2d')!;
    ctx.putImageData(this.image, 0, 0);

    const bins: number[] = [];
    const minHeat = bin * 0.6;
    for (let i = 0; i < sum.length; i++) if (sum[i] > minHeat) bins.push(i);
    bins.sort((a, b) => sum[b] - sum[a]);
    const spots: Hotspot[] = [];
    for (const b of bins) {
      if (spots.length >= 64) break;
      const g = this.sampler.cellGeo(sx[b] / sum[b], sy[b] / sum[b]);
      spots.push({ lon: g.lon, lat: g.lat, heat: Math.min(1, sum[b] / (bin * bin * 0.35)) });
    }
    this.sources = spots;
    this.hotspots = spots.slice(0, maxHotspots);
    const cellAcres = ((pack.raster.cellM || 30) ** 2) / 4046.86;
    this.stats = { burnedCells: burned, activeCells: active, acres: burned * cellAcres };
    this.lastT = t;
    this.rev++;
    for (const fn of this.listeners) fn();
  }
}

const fieldCache = new WeakMap<ScenarioPack, FireField>();
export function getFireField(pack: ScenarioPack, s: RasterSampler): FireField {
  let f = fieldCache.get(pack);
  if (!f) {
    f = new FireField(pack, s);
    fieldCache.set(pack, f);
  }
  return f;
}

const FIRE_GLSL = `
uniform sampler2D image;
uniform float time;
uniform float flicker;
uniform float strength;
uniform vec2 texel;

float fcc_h21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float fcc_noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fcc_h21(i), fcc_h21(i + vec2(1.0, 0.0)), f.x), mix(fcc_h21(i + vec2(0.0, 1.0)), fcc_h21(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec4 fcc_tap(vec2 st) { return texture(image, st); }

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  // Wrapped so hash inputs stay small enough for float precision (seams every ~20 km are invisible).
  vec2 cell = mod(materialInput.st / texel, 509.0);
  // Domain warp (~4 cells) hides the blocky source rasters (VIIRS pixels / perimeter steps).
  vec2 warp = vec2(fcc_noise(cell * 0.11), fcc_noise(cell * 0.11 + 17.3)) - 0.5;
  warp += (vec2(fcc_noise(cell * 0.37 + 5.1), fcc_noise(cell * 0.37 + 9.7)) - 0.5) * 0.45;
  vec2 st = materialInput.st + warp * texel * 7.0;
  vec4 c = fcc_tap(st);
  float burned = smoothstep(0.35, 0.65, c.r);
  float heat = c.g;
  float age = c.b;

  // Front: burned/unburned boundary, only where the fire is still active.
  vec2 o1 = texel * 1.6;
  float nb = 0.0;
  float nh = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec4 s1 = fcc_tap(st + vec2(cos(a), sin(a)) * o1);
    nb += s1.r;
    nh = max(nh, s1.g);
  }
  nb /= 8.0;
  float boundary = 1.0 - abs(nb * 2.0 - 1.0);
  float activeEdge = smoothstep(0.25, 0.75, max(heat, nh));
  float front = clamp(boundary * 1.6, 0.0, 1.0) * activeEdge;

  float halo = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398 + 0.39;
    halo += fcc_tap(st + vec2(cos(a), sin(a)) * texel * 5.0).g;
  }
  halo = (halo / 8.0) * (1.0 - burned);

  float n1 = fcc_noise(cell * 0.5 + vec2(time * 0.55, -time * 0.4));
  float n2 = fcc_noise(cell * 1.7 - vec2(time * 1.6, time * 1.1));
  float fl = mix(1.0, 0.55 + 0.9 * n1 * n2 + 0.2 * n2, flicker);
  // Fine structure for close cameras, faded out once a cell is smaller than ~2 px (avoids shimmer).
  float cellsPerPx = length(fwidth(cell));
  float fineK = 1.0 - smoothstep(0.08, 0.5, cellsPerPx);
  vec2 lc = mod(cell, 61.0);
  float fine = fcc_noise(lc * 6.0 + vec2(time * 0.9, -time * 0.7)) * 0.65 + fcc_noise(lc * 17.0 - vec2(0.0, time * 1.4)) * 0.35;
  float fineMod = mix(1.0, smoothstep(0.25, 0.8, fine) * 1.5, fineK);

  vec3 EMBER = ${glsl3(FIRE.ember)};
  vec3 SIGNAL = ${glsl3(FIRE.signal)};
  vec3 AMBER = ${glsl3(FIRE.amber)};
  vec3 BONE = ${glsl3(ds.bone.DEFAULT)};
  vec3 SCAR = ${glsl3(ds.ink[900])} * 0.7 + ${glsl3(FIRE.wash)} * 0.3;

  // Scar: charcoal, darker with age, faint red where it burned recently.
  vec3 col = mix(SCAR * 1.2, SCAR * 0.5, age) + EMBER * heat * 0.05;
  // Interior embers: sparse flickering speckles inside recently burned ground.
  float speck = smoothstep(0.62, 0.92, fcc_noise(cell * 0.9 + vec2(time * 0.2, 0.0)) * (0.6 + 0.6 * n2));
  float ember = burned * heat * speck * 0.8;
  col = mix(col, mix(EMBER * 0.7, SIGNAL, n1), clamp(ember * 1.4 * fl, 0.0, 1.0));
  // Flame front: signal core flaring to amber / bone where it is hottest.
  float core = front * fl * fineMod;
  ember *= mix(1.0, step(0.55, fine) * 1.4, fineK);
  vec3 fcol = mix(EMBER, SIGNAL, smoothstep(0.1, 0.5, core));
  fcol = mix(fcol, AMBER, smoothstep(0.5, 0.85, core));
  fcol = mix(fcol, BONE, 0.6 * smoothstep(0.95, 1.3, core * (0.8 + 0.4 * n2)));
  col = mix(col, fcol, clamp(core * 1.3, 0.0, 1.0));

  float a = burned * 0.84;
  a = max(a, clamp(core * 1.3, 0.0, 1.0));
  float haloA = halo * 0.45 * fl;
  if (burned < 0.5) col = mix(col, mix(EMBER, SIGNAL, n1), clamp(haloA * 2.0, 0.0, 1.0));
  a = max(a, haloA);

  float glow = max(core, max(ember, haloA));
  m.diffuse = col * 0.4;
  // Scar emission stays low so a fast fire's wide active window reads as charcoal, not a glowing disc.
  m.emission = col * (0.15 + 1.5 * glow) * strength;
  m.alpha = clamp(a, 0.0, 1.0);
  return m;
}
`;

/** Ground-draped fire overlay for one scene. Classifies terrain and 3D tiles alike. */
export class FireOverlay {
  private material: Cesium.Material;
  private primitive: Cesium.GroundPrimitive;
  private off: () => void;

  constructor(private scene: Cesium.Scene, field: FireField, opts: { flicker?: boolean; strength?: number } = {}) {
    const bbox = field.pack.raster.bbox;
    this.material = new Cesium.Material({
      translucent: true,
      fabric: {
        type: `FccFire${Math.random().toString(36).slice(2, 8)}`,
        uniforms: {
          image: field.canvas,
          time: 0,
          flicker: opts.flicker === false ? 0 : 1,
          strength: opts.strength ?? 1,
          texel: new Cesium.Cartesian2(1 / field.w, 1 / field.h),
        },
        source: FIRE_GLSL,
      },
    });
    this.primitive = new Cesium.GroundPrimitive({
      geometryInstances: new Cesium.GeometryInstance({
        geometry: new Cesium.RectangleGeometry({
          rectangle: Cesium.Rectangle.fromDegrees(bbox[0], bbox[1], bbox[2], bbox[3]),
          vertexFormat: Cesium.EllipsoidSurfaceAppearance.VERTEX_FORMAT,
        }),
      }),
      appearance: new Cesium.EllipsoidSurfaceAppearance({ material: this.material, flat: true, aboveGround: false }),
      classificationType: Cesium.ClassificationType.BOTH,
      asynchronous: true,
    });
    scene.groundPrimitives.add(this.primitive);
    this.off = field.onChange(() => {
      this.material.uniforms.image = field.canvas;
      scene.requestRender();
    });
  }

  tick(seconds: number) {
    this.material.uniforms.time = seconds;
  }

  set show(v: boolean) {
    this.primitive.show = v;
  }

  destroy() {
    this.off();
    if (!this.scene.isDestroyed()) this.scene.groundPrimitives.remove(this.primitive);
  }
}
