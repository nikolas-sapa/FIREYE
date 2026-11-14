import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import type { Hotspot } from './fire';
import { FIRE } from './palette';
import type { StageProfile } from './profile';
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
let sparkImg: HTMLCanvasElement | null = null;

type Kind = 'flame' | 'smoke' | 'ember';

interface Slot {
  sys: Cesium.ParticleSystem;
  target: Cesium.Cartesian3;
  up: Cesium.Cartesian3;
  active: boolean;
}

const scratch = new Cesium.Cartesian3();
const scratch2 = new Cesium.Cartesian3();

export interface FireParticleOptions {
  maxFlames: number;
  maxSmoke: number;
  maxEmbers?: number;
  exaggeration: number;
  smokeScale?: number;
  /** Scales flame / smoke sizes to the scenario (hotspot bin). */
  profile?: StageProfile;
}

/**
 * Capped flame, smoke and ember-spark particle systems at the hottest active clusters. Smoke bends
 * downwind and is tinted brown-grey (combustion aerosol), sparks loft and run with the wind.
 */
export class FireParticles {
  private flames: Slot[] = [];
  private smoke: Slot[] = [];
  private embers: Slot[] = [];
  private enabled = true;
  private k: number;

  constructor(
    private scene: Cesium.Scene,
    private sampler: RasterSampler,
    private opts: FireParticleOptions,
  ) {
    flameImg ??= softDisc(64, 0.35);
    smokeImg ??= smokePuff(128);
    sparkImg ??= softDisc(16, 0.2);
    // Reference sizes were tuned for a 170 m flame cluster radius.
    this.k = Math.min(1.2, Math.max(0.3, (opts.profile?.flameRadiusM ?? 170) / 170));
  }

  private makeSlot(kind: Kind): Slot {
    const target = new Cesium.Cartesian3();
    const up = new Cesium.Cartesian3();
    const amber = Cesium.Color.fromCssColorString(FIRE.amber);
    const ember = Cesium.Color.fromCssColorString(FIRE.ember);
    const hot = Cesium.Color.fromCssColorString(FIRE.hot);
    // Wildfire smoke is brown-grey: neutral grey with a little of the fire ramp mixed in.
    const brown = Cesium.Color.fromCssColorString(FIRE.deep);
    const smokeA = Cesium.Color.lerp(Cesium.Color.fromCssColorString(ds.ink[300]), brown, 0.16, new Cesium.Color());
    const smokeB = Cesium.Color.lerp(Cesium.Color.fromCssColorString(ds.ink[500]), brown, 0.1, new Cesium.Color());
    const ss = (this.opts.smokeScale ?? 1) * Math.sqrt(this.k);
    const k = this.k;
    const slot: Slot = { target, up, active: false, sys: null as unknown as Cesium.ParticleSystem };
    const updateCallback = (p: Cesium.Particle, dt: number) => {
      const k = Math.min(1, dt * (kind === 'smoke' ? 0.25 : 1.5));
      Cesium.Cartesian3.subtract(slot.target, p.velocity, scratch);
      Cesium.Cartesian3.multiplyByScalar(scratch, k, scratch);
      Cesium.Cartesian3.add(p.velocity, scratch, p.velocity);
      if (kind === 'flame') {
        Cesium.Cartesian3.multiplyByScalar(slot.up, dt * 6, scratch2);
        Cesium.Cartesian3.add(p.velocity, scratch2, p.velocity);
      } else if (kind === 'ember') {
        // Sparks rise on the convection column, then fall out as they cool.
        const lift = p.age < p.life * 0.4 ? 9 : -6;
        Cesium.Cartesian3.multiplyByScalar(slot.up, dt * lift, scratch2);
        Cesium.Cartesian3.add(p.velocity, scratch2, p.velocity);
      }
    };
    if (kind === 'ember') {
      slot.sys = new Cesium.ParticleSystem({
        image: sparkImg!,
        startColor: amber.withAlpha(1),
        endColor: ember.withAlpha(0),
        startScale: 1,
        endScale: 0.4,
        minimumParticleLife: 2.5,
        maximumParticleLife: 6,
        minimumSpeed: 10,
        maximumSpeed: 26,
        minimumImageSize: new Cesium.Cartesian2(1.6, 1.6),
        maximumImageSize: new Cesium.Cartesian2(4.5, 4.5),
        sizeInMeters: true,
        emissionRate: 14,
        emitter: new Cesium.ConeEmitter(Cesium.Math.toRadians(35)),
        updateCallback,
      });
      this.scene.primitives.add(slot.sys);
      return slot;
    }
    slot.sys =
      kind === 'flame'
        ? new Cesium.ParticleSystem({
            image: flameImg!,
            startColor: Cesium.Color.lerp(amber, hot, 0.25, new Cesium.Color()).withAlpha(0.95),
            endColor: ember.withAlpha(0),
            startScale: 1.0,
            endScale: 0.35,
            minimumParticleLife: 0.9,
            maximumParticleLife: 2.0,
            minimumSpeed: 5,
            maximumSpeed: 12,
            imageSize: new Cesium.Cartesian2(70 * k, 70 * k),
            minimumImageSize: new Cesium.Cartesian2(30 * k, 40 * k),
            maximumImageSize: new Cesium.Cartesian2(80 * k, 110 * k),
            sizeInMeters: true,
            emissionRate: 9,
            emitter: new Cesium.CircleEmitter(170 * k),
            updateCallback,
          })
        : new Cesium.ParticleSystem({
            image: smokeImg!,
            startColor: smokeA.withAlpha(0.22),
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
            emitter: new Cesium.CircleEmitter(240 * k),
            updateCallback,
          });
    this.scene.primitives.add(slot.sys);
    return slot;
  }

  set show(v: boolean) {
    this.enabled = v;
    for (const s of [...this.flames, ...this.smoke, ...this.embers]) s.sys.show = v && s.active;
  }

  setHotspots(spots: Hotspot[], wind: { dirDeg: number; kph: number }) {
    const toDir = ((wind.dirDeg + 180) % 360) * (Math.PI / 180);
    const ms = Math.max(1.5, wind.kph / 3.6);
    const place = (slot: Slot, h: Hotspot, kind: Kind) => {
      const elev = this.sampler.elevation(h.lon, h.lat) * this.opts.exaggeration;
      const pos = Cesium.Cartesian3.fromDegrees(h.lon, h.lat, elev + (kind === 'flame' ? 6 : 40));
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(pos);
      slot.sys.modelMatrix = enu;
      const east = Cesium.Matrix4.getColumn(enu, 0, new Cesium.Cartesian4());
      const north = Cesium.Matrix4.getColumn(enu, 1, new Cesium.Cartesian4());
      const up = Cesium.Matrix4.getColumn(enu, 2, new Cesium.Cartesian4());
      Cesium.Cartesian3.fromElements(up.x, up.y, up.z, slot.up);
      const we = Math.sin(toDir) * ms, wn = Math.cos(toDir) * ms;
      const rise = kind === 'smoke' ? 14 + 8 * h.heat : kind === 'ember' ? 12 : 9;
      const drift = kind === 'smoke' ? 1 : kind === 'ember' ? 0.9 : 0.15;
      slot.target.x = (east.x * we + north.x * wn) * drift + up.x * rise;
      slot.target.y = (east.y * we + north.y * wn) * drift + up.y * rise;
      slot.target.z = (east.z * we + north.z * wn) * drift + up.z * rise;
      if (kind === 'flame') slot.sys.emissionRate = 4 + 10 * h.heat;
      if (kind === 'ember') slot.sys.emissionRate = 6 + 18 * h.heat * Math.min(1.5, ms / 8);
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
    const embers = spots.slice(0, this.opts.maxEmbers ?? 0);
    while (this.embers.length < embers.length) this.embers.push(this.makeSlot('ember'));
    this.embers.forEach((s, i) => (embers[i] ? place(s, embers[i], 'ember') : hide(s)));
  }

  destroy() {
    if (this.scene.isDestroyed()) return;
    for (const s of [...this.flames, ...this.smoke, ...this.embers]) this.scene.primitives.remove(s.sys);
    this.flames = [];
    this.smoke = [];
    this.embers = [];
  }
}
