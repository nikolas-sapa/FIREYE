import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import type { Hotspot } from './fire';
import { RasterSampler } from './raster';

function softDisc(size: number, core: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(core, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

function smokePuff(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9; i++) {
    const x = size * (0.3 + rnd() * 0.4), y = size * (0.3 + rnd() * 0.4), r = size * (0.18 + rnd() * 0.18);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
  }
  return c;
}

let flameImg: HTMLCanvasElement | null = null;
let smokeImg: HTMLCanvasElement | null = null;

interface Slot {
  sys: Cesium.ParticleSystem;
  target: Cesium.Cartesian3;
  up: Cesium.Cartesian3;
  active: boolean;
}

const scratch = new Cesium.Cartesian3();
const scratch2 = new Cesium.Cartesian3();

/** Capped flame + smoke particle systems at the hottest active clusters; smoke bends downwind. */
export class FireParticles {
  private flames: Slot[] = [];
  private smoke: Slot[] = [];
  private enabled = true;

  constructor(
    private scene: Cesium.Scene,
    private sampler: RasterSampler,
    private opts: { maxFlames: number; maxSmoke: number; exaggeration: number; smokeScale?: number },
  ) {
    flameImg ??= softDisc(64, 0.35);
    smokeImg ??= smokePuff(128);
  }

  private makeSlot(kind: 'flame' | 'smoke'): Slot {
    const target = new Cesium.Cartesian3();
    const up = new Cesium.Cartesian3();
    const amber = Cesium.Color.fromCssColorString(ds.amber);
    const ember = Cesium.Color.fromCssColorString(ds.ember);
    const smokeA = Cesium.Color.fromCssColorString(ds.ink[300]);
    const smokeB = Cesium.Color.fromCssColorString(ds.ink[500]);
    const ss = this.opts.smokeScale ?? 1;
    const slot: Slot = { target, up, active: false, sys: null as unknown as Cesium.ParticleSystem };
    const updateCallback = (p: Cesium.Particle, dt: number) => {
      const k = Math.min(1, dt * (kind === 'smoke' ? 0.25 : 1.5));
      Cesium.Cartesian3.subtract(slot.target, p.velocity, scratch);
      Cesium.Cartesian3.multiplyByScalar(scratch, k, scratch);
      Cesium.Cartesian3.add(p.velocity, scratch, p.velocity);
      if (kind === 'flame') {
        Cesium.Cartesian3.multiplyByScalar(slot.up, dt * 6, scratch2);
        Cesium.Cartesian3.add(p.velocity, scratch2, p.velocity);
      }
    };
    slot.sys =
      kind === 'flame'
        ? new Cesium.ParticleSystem({
            image: flameImg!,
            startColor: amber.withAlpha(0.95),
            endColor: ember.withAlpha(0),
            startScale: 1.0,
            endScale: 0.35,
            minimumParticleLife: 0.9,
            maximumParticleLife: 2.0,
            minimumSpeed: 5,
            maximumSpeed: 12,
            imageSize: new Cesium.Cartesian2(70, 70),
            minimumImageSize: new Cesium.Cartesian2(30, 40),
            maximumImageSize: new Cesium.Cartesian2(80, 110),
            sizeInMeters: true,
            emissionRate: 9,
            emitter: new Cesium.CircleEmitter(170),
            updateCallback,
          })
        : new Cesium.ParticleSystem({
            image: smokeImg!,
            startColor: smokeA.withAlpha(0.2),
            endColor: smokeB.withAlpha(0),
            startScale: 1.0,
            endScale: 6.0,
            minimumParticleLife: 40,
            maximumParticleLife: 60,
            minimumSpeed: 12,
            maximumSpeed: 20,
            minimumImageSize: new Cesium.Cartesian2(90 * ss, 90 * ss),
            maximumImageSize: new Cesium.Cartesian2(150 * ss, 150 * ss),
            sizeInMeters: true,
            emissionRate: 1.6,
            emitter: new Cesium.CircleEmitter(240),
            updateCallback,
          });
    this.scene.primitives.add(slot.sys);
    return slot;
  }

  set show(v: boolean) {
    this.enabled = v;
    for (const s of [...this.flames, ...this.smoke]) s.sys.show = v && s.active;
  }

  setHotspots(spots: Hotspot[], wind: { dirDeg: number; kph: number }) {
    const toDir = ((wind.dirDeg + 180) % 360) * (Math.PI / 180);
    const ms = Math.max(1.5, wind.kph / 3.6);
    const place = (slot: Slot, h: Hotspot, kind: 'flame' | 'smoke') => {
      const elev = this.sampler.elevation(h.lon, h.lat) * this.opts.exaggeration;
      const pos = Cesium.Cartesian3.fromDegrees(h.lon, h.lat, elev + (kind === 'flame' ? 6 : 40));
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
      slot.sys.modelMatrix = enu;
      const east = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4());
      const north = Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4());
      const up = Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian4());
      Cesium.Cartesian3.fromElements(up.x, up.y, up.z, slot.up);
      const we = Math.sin(toDir) * ms, wn = Math.cos(toDir) * ms;
      const rise = kind === 'smoke' ? 14 + 8 * h.heat : 9;
      const drift = kind === 'smoke' ? 1 : 0.15;
      slot.target.x = (east.x * we + north.x * wn) * drift + up.x * rise;
      slot.target.y = (east.y * we + north.y * wn) * drift + up.y * rise;
      slot.target.z = (east.z * we + north.z * wn) * drift + up.z * rise;
      if (kind === 'flame') slot.sys.emissionRate = 4 + 10 * h.heat;
      slot.active = true;
      slot.sys.show = this.enabled;
    };
    const hide = (s: Slot) => {
      s.active = false;
      s.sys.show = false;
    };
    const flames = spots.slice(0, this.opts.maxFlames);
    while (this.flames.length < flames.length) this.flames.push(this.makeSlot('flame'));
    this.flames.forEach((s, i) => (flames[i] ? place(s, flames[i], 'flame') : hide(s)));
    const smoke = spots.filter((_, i) => i % 3 === 0).slice(0, this.opts.maxSmoke);
    while (this.smoke.length < smoke.length) this.smoke.push(this.makeSlot('smoke'));
    this.smoke.forEach((s, i) => (smoke[i] ? place(s, smoke[i], 'smoke') : hide(s)));
  }

  destroy() {
    if (this.scene.isDestroyed()) return;
    for (const s of [...this.flames, ...this.smoke]) this.scene.primitives.remove(s.sys);
    this.flames = [];
    this.smoke = [];
  }
}
