import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import type { Feed, Finding, FindingKind, ScenarioPack, Unit } from '../../contracts';
import { AtmospherePass } from '../atmosphere';
import { prefersReducedMotion } from '../easing';
import { FireOverlay, getFireField, type FireField } from '../fire';
import { createCameraStages, isThermal, modelFor, type CameraModel, type CameraUniforms } from '../fx';
import { findingColor } from '../layers';
import { rgba } from '../palette';
import { FireParticles } from '../particles';
import { getProfile, type StageProfile } from '../profile';
import { RasterSampler, weatherAt, DEG2RAD } from '../raster';
import { getSampler } from '../sampler';
import { getSmokeField, type SmokeField } from '../smoke';
import { applySunLight, createDarkViewer, setupBasemap } from '../viewer';
import { stageWorld, unitHeading, unitPos } from '../world';
import { CameraFilter, FeedCadence } from './dynamics';
import { feedPose, type FeedPose } from './poses';
import { drawSatScene, pickSatScene, satProject, type SatScene } from './satellite';

export const FULL_W = 960;
export const FULL_H = 540;
export const THUMB_W = 384;
export const THUMB_H = 216;
const THUMB_PERIOD_MS = 2000;

export interface Detection {
  id: string;
  kind: FindingKind;
  label: string;
  confidence: number;
  color: string;
  /** Normalized 0..1 frame box. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FeedFrame {
  feedId: string;
  pose: FeedPose;
  detections: Detection[];
  frame: number;
  renderedAt: number;
  model: CameraModel;
  /** Thermal core is running a non-uniformity correction (image briefly freezes flat). */
  nuc?: boolean;
  /** Phone footage: the frame is a 9:16 portrait crop centred in the landscape surface. */
  portrait?: boolean;
  /** Satellite feeds: what the pixels are (real archived imagery vs synthetic render). */
  sat?: SatScene | { real: false };
  /** Ground speed of the carrying unit (m/s), for telemetry / burn-in. */
  speedMps?: number;
  replayRate?: number;
}

interface CamState { exp: number; lastS: number; nucUntil: number; nextNuc: number }

export interface SurfaceHandle {
  feedId: string;
  variant: 'thumb' | 'full';
  canvas: HTMLCanvasElement;
  onFrame?: (f: FeedFrame) => void;
  onError?: () => void;
}

interface Surface extends SurfaceHandle {
  key: number;
  ctx: CanvasRenderingContext2D;
  registeredAt: number;
  lastFrameAt: number;
}

const PROXY_SIZE: Partial<Record<FindingKind, { w: number; l: number; h: number; cyl?: boolean; n?: number }>> = {
  human: { w: 0.7, l: 0.7, h: 1.8, cyl: true, n: 2 },
  animal: { w: 0.9, l: 2.2, h: 1.6, n: 3 },
  combustible: { w: 1.6, l: 1.6, h: 2.6, cyl: true, n: 2 },
  structure: { w: 11, l: 14, h: 6 },
  vehicle: { w: 2, l: 4.8, h: 1.6, n: 2 },
};

/**
 * One hidden Cesium viewer shared by every <FeedSurface>. It targets 30 fps for the active full feed
 * and refreshes thumbnails round-robin (each about every 2 s), copying the WebGL canvas into each
 * surface's own 2D canvas.
 */
export class FeedRenderer {
  private static inst: FeedRenderer | null = null;
  private static failed = false;

  static get(): FeedRenderer | null {
    if (FeedRenderer.failed) return null;
    if (!FeedRenderer.inst) {
      try {
        FeedRenderer.inst = new FeedRenderer();
      } catch (err) {
        console.warn('[stage3d] feed renderer unavailable; feeds degrade to static cards', err);
        FeedRenderer.failed = true;
        return null;
      }
    }
    return FeedRenderer.inst;
  }

  static get available(): boolean {
    return !FeedRenderer.failed;
  }

  private host: HTMLDivElement;
  private viewer: Cesium.Viewer;
  private cams: Record<CameraModel, Cesium.PostProcessStage> | null = null;
  private camU: CameraUniforms = { time: 0, exposure: 1, motion: 1, nuc: 0, shake: 0 };
  private camState = new Map<string, CamState>();
  private atmos: AtmospherePass | null = null;
  private smoke: SmokeField | null = null;
  private profile: StageProfile | null = null;
  private reduced = prefersReducedMotion();
  private sunKey = NaN;
  private satCanvas = document.createElement('canvas');
  private satKey = '';
  private satReady = false;
  private surfacePrimed = new Set<string>();
  private src: CanvasImageSource | null = null;
  private portraitTmp = document.createElement('canvas');
  private surfaces = new Map<number, Surface>();
  private nextKey = 1;
  private raf = 0;
  private pack: ScenarioPack | null = null;
  private sampler: RasterSampler | null = null;
  private field: FireField | null = null;
  private fire: FireOverlay | null = null;
  private particles: FireParticles | null = null;
  private exaggeration = 1;
  private ready = false;
  private cadence = new FeedCadence();
  private fullId: string | null = null;
  private filters = new Map<string, CameraFilter>();
  private motionEpoch = -1;
  private visualS = 0;
  private lastStepAt = 0;
  private failures = 0;
  private retryAt = 0;
  private signalFailed = false;
  private lastThumb = 0;
  private thumbCursor = 0;
  private warm: { key: number; feedId: string } | null = null;
  private frameNo = 0;
  private renderCost = 8;
  private proxies = new Cesium.CustomDataSource('feed-proxies');
  private proxySig = '';
  private unitSig = '';
  private weatherT = NaN;
  private unsub: () => void;
  private idleTimer = 0;
  private activeModel: CameraModel | null = null;
  private sizeMode: 'full' | 'thumb' = 'thumb';
  private initializing = false;
  private dead = false;
  private basemapTiles: Cesium.Cesium3DTileset | undefined;
  private buildings: Cesium.Primitive | undefined;
  private sampleAt = performance.now();
  private sceneTime = Cesium.JulianDate.now();
  private renderTime = new Cesium.JulianDate();

  private constructor() {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    // Must stay laid out (non-zero size) for Cesium; parked off-screen.
    host.style.cssText = `position:fixed;left:-12000px;top:0;width:${THUMB_W}px;height:${THUMB_H}px;pointer-events:none;`;
    document.body.appendChild(host);
    this.host = host;
    const credit = document.createElement('div');
    this.viewer = createDarkViewer(host, { msaa: 1, preserveDrawingBuffer: true, useDefaultRenderLoop: false, creditContainer: credit });
    this.viewer.clock.shouldAnimate = false;
    const scene = this.viewer.scene;
    scene.fog.density = 1.2e-4;
    scene.globe.maximumScreenSpaceError = 2.5;
    scene.globe.tileCacheSize = 900;
    this.viewer.dataSources.add(this.proxies);
    if (import.meta.env.DEV) (window as unknown as { __fccFeeds?: FeedRenderer }).__fccFeeds = this;
    this.unsub = stageWorld.subscribe((changed) => {
      if (changed.has('pack')) void this.initPack();
      if (!this.ready) return;
      if (changed.has('t') || changed.has('fireRev')) this.syncFire();
      if (changed.has('findings')) this.syncProxies();
      if (changed.has('units')) this.syncUnitProxies();
    });
    void this.initPack();
  }

  private async initPack() {
    const pack = stageWorld.get().pack;
    if (this.dead || this.initializing || !pack || pack === this.pack) return;
    this.initializing = true;
    this.ready = false;
    this.releasePack();
    this.pack = pack;
    this.signalFailed = false; this.failures = 0; this.retryAt = 0;
    this.sunKey = this.weatherT = NaN;
    this.proxySig = this.unitSig = '';
    this.filters.clear(); this.camState.clear();
    this.satKey = ''; this.satReady = false;
    this.surfacePrimed.clear();
    this.proxies.entities.removeAll();
    this.viewer.imageryLayers.removeAll();
    this.viewer.scene.globe.show = true;
    this.viewer.scene.globe.enableLighting = false;
    const s = getSampler(pack);
    this.sampler = s;
    try {
      const bm = await setupBasemap(this.viewer, pack, s);
      this.basemapTiles = bm.tileset;
      if (this.dead || stageWorld.get().pack !== pack) return;
      this.exaggeration = bm.exaggeration;
      const scene = this.viewer.scene;
      this.profile = getProfile(pack);
      if (stageWorld.get().dataMode !== 'monitoring') {
        this.field = getFireField(pack, s);
        this.fire = new FireOverlay(scene, this.field, { flicker: !this.reduced, strength: 1.0 });
        this.particles = new FireParticles(scene, s, { maxFlames: 12, maxSmoke: 5, maxEmbers: 8, exaggeration: this.exaggeration, smokeScale: 0.8, profile: this.profile });
        this.particles.show = !this.reduced;
        this.smoke = getSmokeField(pack, s);
        // Atmosphere first (scene-referred light, smoke, sky), then the sensor model.
        this.atmos = new AtmospherePass(scene, pack, this.field, this.smoke, { look: 'camera', quality: 1.4, shimmer: !this.reduced });
        this.addBuildings(pack, s);
      }
      this.cams = createCameraStages(scene, this.camU);
      this.ready = true;
      this.syncFire();
      this.syncProxies();
      this.syncUnitProxies();
      this.kick();
    } catch (err) {
      if (!this.dead) {
        console.error('[stage3d] feed renderer init failed', err);
        this.signalFailed = true;
        for (const surface of this.surfaces.values()) surface.onError?.();
      }
    } finally {
      this.initializing = false;
      if (!this.dead && stageWorld.get().pack !== this.pack) void this.initPack();
    }
  }

  private syncFire() {
    const w = stageWorld.get();
    if (!this.field || !this.pack) return;
    const updated = this.field.sync(w.t, w.fireRev);
    const wx = weatherAt(this.pack, w.t);
    if (updated || wx.t !== this.weatherT || this.field.rev === 1) {
      this.weatherT = wx.t;
      const wind = { dirDeg: wx.windDirDeg, kph: wx.windKph };
      this.particles?.setHotspots(this.field.hotspots, wind);
      this.smoke?.update(this.field.sources, wind, this.exaggeration);
    }
    const sk = Math.round(w.t / 120000);
    if (sk !== this.sunKey && this.viewer.scene.globe.enableLighting) {
      this.sunKey = sk;
      applySunLight(this.viewer.scene, this.pack, w.t);
    }
  }

  private addBuildings(pack: ScenarioPack, s: RasterSampler) {
    const list = pack.buildings.slice(0, 4000);
    if (!list.length) return;
    const instances = list.map((b, i) => {
      const hgt = 5 + ((i * 7) % 4);
      const pos = Cesium.Cartesian3.fromDegrees(b.pos.lon, b.pos.lat, s.elevation(b.pos.lon, b.pos.lat) * this.exaggeration + hgt / 2 - 0.5);
      const m = Cesium.Transforms.headingPitchRollToFixedFrame(pos, new Cesium.HeadingPitchRoll(((i * 37) % 90) * DEG2RAD, 0, 0));
      const c = Cesium.Color.fromCssColorString(ds.ink[500]);
      return new Cesium.GeometryInstance({
        geometry: Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(11 + (i % 5), 9 + (i % 3) * 2, hgt), vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
        modelMatrix: m,
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(c) },
      });
    });
    this.buildings = this.viewer.scene.primitives.add(
      new Cesium.Primitive({ geometryInstances: instances, appearance: new Cesium.PerInstanceColorAppearance({ flat: false, translucent: false }), asynchronous: true }));
  }

  /** Simple 3D stand-ins for detections so cameras actually see something at the finding. */
  private syncProxies() {
    const w = stageWorld.get();
    const s = this.sampler;
    if (!s) return;
    const sig = w.findings.map((f) => `${f.id}:${f.pos.lon.toFixed(5)}:${f.pos.lat.toFixed(5)}:${f.count ?? 1}`).join('|');
    if (sig === this.proxySig) return;
    this.proxySig = sig;
    const e = this.proxies.entities;
    e.suspendEvents();
    for (const en of [...e.values]) if (en.id.startsWith('pf:')) e.remove(en);
    for (const f of w.findings) {
      const spec = PROXY_SIZE[f.kind];
      if (!spec) continue;
      const n = Math.min(4, f.count ?? spec.n ?? 1);
      const hot = f.kind === 'human' || f.kind === 'animal' || f.kind === 'vehicle';
      const colr = Cesium.Color.fromCssColorString(hot ? ds.bone.DEFAULT : f.kind === 'combustible' ? ds.ink[100] : ds.ink[400]);
      for (let i = 0; i < n; i++) {
        const lon = f.pos.lon + (i - (n - 1) / 2) * 0.000035;
        const lat = f.pos.lat + ((i % 2) - 0.5) * 0.00002;
        const h = s.elevation(lon, lat) * this.exaggeration + spec.h / 2;
        const position = Cesium.Cartesian3.fromDegrees(lon, lat, h);
        e.add({
          id: `pf:${f.id}:${i}`,
          position,
          ...(spec.cyl
            ? { cylinder: { length: spec.h, topRadius: spec.w / 2, bottomRadius: spec.w / 2, material: colr, slices: 10 } }
            : { box: { dimensions: new Cesium.Cartesian3(spec.w, spec.l, spec.h), material: colr } }),
        });
      }
    }
    e.resumeEvents();
  }

  private syncUnitProxies() {
    const w = stageWorld.get();
    const sig = w.units.map((u) => `${u.id}:${u.kind}`).join('|');
    if (sig === this.unitSig) return;
    this.unitSig = sig;
    const e = this.proxies.entities;
    for (const en of [...e.values]) if (en.id.startsWith('pu:')) e.remove(en);
    const s = this.sampler!;
    for (const u of w.units) {
      const air = u.kind === 'drone' || u.kind === 'helo' || u.kind === 'tanker';
      const dims =
        u.kind === 'engine' ? [2.5, 8.5, 3.2] : u.kind === 'dozer' ? [3.2, 6, 3] : u.kind === 'ems' || u.kind === 'law' ? [2.1, 5.5, 2.4]
        : u.kind === 'crew' ? [0.7, 0.7, 1.8] : u.kind === 'drone' ? [1.2, 1.2, 0.4] : u.kind === 'helo' ? [3, 14, 3.5] : [6, 30, 7];
      const hex = u.kind === 'engine' ? ds.ember : u.kind === 'ems' ? ds.bone.DEFAULT : u.kind === 'crew' ? ds.amber : ds.ink[200];
      const ref: { u: Unit } = { u };
      const g = { lon: 0, lat: 0, alt: 0 };
      e.add({
        id: `pu:${u.id}`,
        position: new Cesium.CallbackPositionProperty((_t, result) => {
          const cur = stageWorld.get().units.find((x) => x.id === ref.u.id) ?? ref.u;
          const p = unitPos(cur, this.sampleAt, g);
          const base = s.elevation(p.lon, p.lat) * this.exaggeration;
          return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, base + (air ? Math.max(40, p.alt ?? 120) : dims[2] / 2), undefined, result);
        }, false),
        orientation: new Cesium.CallbackProperty(() => {
          const cur = stageWorld.get().units.find((x) => x.id === ref.u.id) ?? ref.u;
          const p = unitPos(cur, this.sampleAt);
          const position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat,
            s.elevation(p.lon, p.lat) * this.exaggeration + (air ? Math.max(40, p.alt ?? 120) : dims[2] / 2));
          return Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll(unitHeading(cur, this.sampleAt) * DEG2RAD, 0, 0));
        }, false),
        box: { dimensions: new Cesium.Cartesian3(dims[0], dims[1], dims[2]), material: Cesium.Color.fromCssColorString(hex) },
      });
    }
  }

  /* -------------------------------------------------------------- surfaces */

  register(h: SurfaceHandle): () => void {
    const ctx = h.canvas.getContext('2d');
    if (!ctx) return () => undefined;
    const key = this.nextKey++;
    this.surfaces.set(key, { ...h, key, ctx, registeredAt: performance.now(), lastFrameAt: 0 });
    if (this.signalFailed) h.onError?.();
    this.kick();
    return () => {
      this.surfaces.delete(key);
    };
  }

  update(key: number, patch: Partial<SurfaceHandle>) {
    const s = this.surfaces.get(key);
    if (s) Object.assign(s, patch);
  }

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  private loop = () => {
    this.raf = 0;
    if (this.viewer.isDestroyed()) return;
    if (!this.surfaces.size) {
      this.scheduleDispose();
      return;
    }
    window.clearTimeout(this.idleTimer);
    this.idleTimer = 0;
    if (this.ready && performance.now() >= this.retryAt) {
      try {
        this.step();
        this.failures = 0;
      } catch (err) {
        this.retryAt = performance.now() + 250 * 2 ** this.failures++;
        if (this.failures === 1) console.warn('[stage3d] feed render error, backing off', err);
        if (this.failures >= 3) {
          this.ready = false; this.signalFailed = true;
          for (const s of this.surfaces.values()) s.onError?.();
        }
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private feedById(id: string): Feed | undefined {
    return stageWorld.get().feeds.find((f) => f.id === id);
  }

  private step() {
    const now = performance.now();
    const world = stageWorld.get();
    this.reduced = prefersReducedMotion();
    if (this.particles) this.particles.show = !this.reduced;
    if (this.atmos) this.atmos.shimmer = !this.reduced;
    if (this.motionEpoch !== stageWorld.motionEpoch()) {
      this.motionEpoch = stageWorld.motionEpoch();
      this.filters.clear(); this.camState.clear(); this.visualS = 0;
    }
    const ids = new Set(world.feeds.map((f) => f.id));
    for (const id of this.filters.keys()) if (!ids.has(id)) this.filters.delete(id);
    for (const id of this.camState.keys()) if (!ids.has(id)) this.camState.delete(id);
    if (this.lastStepAt && !world.paused && !this.reduced) this.visualS += Math.min(0.1, (now - this.lastStepAt) / 1000);
    this.lastStepAt = now;
    const all = [...this.surfaces.values()];
    let full: Surface | null = null;
    for (const s of all) if (s.variant === 'full' && this.feedById(s.feedId) && (!full || s.registeredAt > full.registeredAt)) full = s;
    if (this.fullId !== (full?.feedId ?? null)) {
      this.fullId = full?.feedId ?? null; this.cadence.reset(); this.warm = null;
    }
    // Resizing reallocates framebuffers, so the size follows "is any full surface active", not each render.
    this.setSize(full ? 'full' : 'thumb');

    if (this.warm && !full) {
      // Second pass for a thumbnail: tiles requested last frame are now resident.
      const w = this.warm;
      this.warm = null;
      const feed = this.feedById(w.feedId);
      if (feed) {
        const frame = this.render(feed);
        for (const s of all) if (s.variant === 'thumb' && s.feedId === w.feedId) this.copy(s, frame);
      }
      return;
    }

    if (full && this.cadence.due(now)) {
      const feed = this.feedById(full.feedId)!;
      const frame = this.render(feed);
      for (const s of all) if (s.variant === 'full' && s.feedId === full.feedId) this.copy(s, frame);
      // Thumbs showing the same feed ride along at the full rate (throttled to ~4 fps).
      for (const s of all) if (s.variant === 'thumb' && s.feedId === full.feedId && now - s.lastFrameAt > 250) this.copy(s, frame);
      return;
    }
    // Never spend a full-frame deadline warming a thumbnail.
    if (full && this.cadence.slack(now) < this.renderCost + 5) return;

    const thumbs = all.filter((s) => s.variant === 'thumb' && (!full || s.feedId !== full.feedId) && this.feedById(s.feedId));
    if (!thumbs.length) return;
    const feedsIds = [...new Set(thumbs.map((s) => s.feedId))];
    // Back off when renders are expensive (software GL) so the stage keeps its frame rate.
    const interval = Math.max(120, THUMB_PERIOD_MS / feedsIds.length, this.renderCost * 6);
    if (now - this.lastThumb < interval) return;
    this.lastThumb = now;
    // Freshly registered surfaces (never drawn) jump the queue.
    const fresh = thumbs.find((s) => !s.lastFrameAt);
    const id = fresh ? fresh.feedId : feedsIds[this.thumbCursor++ % feedsIds.length];
    const feed = this.feedById(id)!;
    const frame = this.render(feed);
    for (const s of thumbs) if (s.feedId === id) this.copy(s, frame);
    if (!full) this.warm = { key: 0, feedId: id };
  }

  private setSize(mode: 'full' | 'thumb') {
    if (this.sizeMode === mode) return;
    this.sizeMode = mode;
    this.host.style.width = `${mode === 'full' ? FULL_W : THUMB_W}px`;
    this.host.style.height = `${mode === 'full' ? FULL_H : THUMB_H}px`;
    this.viewer.resize();
  }

  private camStateOf(id: string, nowS: number): CamState {
    let c = this.camState.get(id);
    if (!c) {
      // Stagger NUC events per camera so several IR feeds never flatten together.
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      c = { exp: 1, lastS: NaN, nucUntil: 0, nextNuc: nowS + 8 + (h % 23) };
      this.camState.set(id, c);
    }
    return c;
  }

  /** Fraction of the frame lit by fire (0..1), from active clusters projected through the current camera. */
  private fireInView(): number {
    const f = this.field;
    if (!f || !f.hotspots.length) return 0;
    const scene = this.viewer.scene;
    const cam = scene.camera;
    const W = scene.canvas.clientWidth || 1, H = scene.canvas.clientHeight || 1;
    const s = this.sampler!;
    const tanF = Math.tan(((cam.frustum as Cesium.PerspectiveFrustum).fovy ?? 0.7) / 2);
    const r = this.profile?.flameRadiusM ?? 100;
    let acc = 0;
    for (const h of f.hotspots.slice(0, 12)) {
      const p = Cesium.Cartesian3.fromDegrees(h.lon, h.lat, s.elevation(h.lon, h.lat) * this.exaggeration + 10, undefined, this.scratchP);
      const toP = Cesium.Cartesian3.subtract(p, cam.positionWC, this.scratchD);
      if (Cesium.Cartesian3.dot(toP, cam.directionWC) <= 0) continue;
      const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, p, this.scratchW);
      if (!win || win.x < -W * 0.1 || win.x > W * 1.1 || win.y < -H * 0.1 || win.y > H * 1.1) continue;
      const dist = Cesium.Cartesian3.magnitude(toP);
      const px = (r / (dist * tanF)) * (H / 2);
      acc += h.heat * Math.min(1, (px * px * 3) / (W * H));
    }
    return Math.min(1, acc);
  }
  private scratchP = new Cesium.Cartesian3();
  private scratchD = new Cesium.Cartesian3();
  private scratchW = new Cesium.Cartesian2();

  /** Stable exposure / AGC with model-specific lag and staggered thermal NUC. */
  private sensor(feed: Feed, model: CameraModel, nowS: number): { nuc: boolean } {
    const c = this.camStateOf(feed.id, nowS);
    const initial = !Number.isFinite(c.lastS);
    const dt = initial ? 0 : Math.min(2, Math.max(0, nowS - c.lastS));
    c.lastS = nowS;
    const fire = this.fireInView();
    const sun = this.atmos?.sunElevDeg ?? 30;
    const dusk = sun < 6 ? 1 + (6 - Math.max(-6, sun)) * 0.06 : 1;
    let target = 1, tau = 0.5;
    switch (model) {
      case 'phone': target = (1.08 / (1 + 2.2 * fire)) * dusk; tau = 0.35; break;
      case 'dash': case 'helmet': target = (1.0 / (1 + 1.4 * fire)) * dusk; break;
      case 'uav-eo': case 'ridge': target = (1.0 / (1 + 0.6 * fire)) * dusk; tau = 0.7; break;
      case 'ir-white': case 'ir-iron': target = 1 / (1 + 0.5 * fire); tau = 0.6; break;
      default: target = 1;
    }
    if (this.reduced || initial) {
      c.exp = target;
    } else {
      c.exp += (target - c.exp) * (1 - Math.exp(-dt / tau));
    }
    let nuc = false;
    if (isThermal(model) && !this.reduced) {
      if (nowS >= c.nextNuc) {
        c.nucUntil = nowS + 0.35;
        c.nextNuc = nowS + 28 + ((c.nextNuc * 7.3) % 17);
      }
      nuc = nowS < c.nucUntil;
    }
    this.camU.exposure = Math.max(0.35, Math.min(1.8, c.exp));
    this.camU.nuc = nuc ? 1 : 0;
    this.camU.motion = this.reduced ? 0 : 1;
    this.camU.time = this.reduced ? 0 : nowS;
    const u = feed.unitId ? stageWorld.get().units.find((x) => x.id === feed.unitId) : undefined;
    const speed = u?.speedMps ?? 0;
    this.camU.shake = this.reduced ? 0 : model === 'phone' ? 1 : model === 'dash' ? 0.35 + Math.min(1, speed / 15) * 0.65 : model === 'helmet' ? 0.8 : 0;
    return { nuc };
  }

  private render(feed: Feed): FeedFrame {
    const t0 = performance.now();
    this.sampleAt = t0;
    const w = stageWorld.get();
    const nowS = this.visualS;
    const scene = this.viewer.scene;
    const model = modelFor(feed);
    let filter = this.filters.get(feed.id);
    if (!filter) { filter = new CameraFilter(); this.filters.set(feed.id, filter); }
    const groundAt = feed.kind.startsWith('uav-') ? undefined
      : (g: { lon: number; lat: number }) => scene.globe.getHeight(Cesium.Cartographic.fromDegrees(g.lon, g.lat));
    const pose = filter.update(feedPose(feed, w, this.sampler!, this.exaggeration, nowS, groundAt, t0), t0);
    pose.headingDeg = (pose.heading / DEG2RAD % 360 + 360) % 360;
    // Airborne camera height uses the stable native DEM, not a changing streamed terrain LOD.
    const unit = feed.unitId ? w.units.find((u) => u.id === feed.unitId) : undefined;
    const base = { feedId: feed.id, pose, frame: ++this.frameNo, model, speedMps: unit?.speedMps, replayRate: w.speed ?? 1 };

    if (model === 'sat' && this.pack) {
      const pick = pickSatScene(this.pack, w.t);
      if (pick) {
        const fp = feed.pose?.rangeM ?? 36000;
        const key = `${pick.trueImg.url}|${pick.thermal?.url ?? ''}|${pose.geo.lon.toFixed(4)}|${pose.geo.lat.toFixed(4)}|${fp}|${this.sizeMode}`;
        const size = this.sizeMode === 'full' ? [FULL_W, FULL_H] : [THUMB_W, THUMB_H];
        if (key !== this.satKey) {
          this.satKey = key;
          this.satReady = false;
          const canvas = document.createElement('canvas');
          canvas.width = size[0]; canvas.height = size[1];
          void drawSatScene(canvas, pick, pose.geo, fp).then((ok) => {
            if (this.satKey === key && !this.viewer.isDestroyed()) { this.satCanvas = canvas; this.satReady = ok; }
          });
        }
        this.src = this.satReady ? this.satCanvas : null;
        const dets: Detection[] = [];
        for (const id of feed.findingIds) {
          const f = w.findings.find((x) => x.id === id);
          if (!f) continue;
          const q = satProject(f.pos, pose.geo, fp, pick, size[0] / size[1]);
          const bw = Math.max(0.025, (Math.max(60, f.uncertaintyM * 2)) / q.mPerUnit);
          if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1) continue;
          dets.push({ id: f.id, kind: f.kind, label: f.label, confidence: f.confidence, color: findingColor(f, 'Z3_FOCUS'), x: q.x - bw / 2, y: q.y - bw * 0.8, w: bw, h: bw * 1.6 });
        }
        return { ...base, detections: dets, renderedAt: performance.now(), sat: pick.scene };
      }
    }

    const cam = scene.camera;
    const fr = cam.frustum as Cesium.PerspectiveFrustum;
    const portrait = model === 'phone';
    const aspect = (scene.canvas.clientWidth || 16) / (scene.canvas.clientHeight || 9);
    // Phones shoot portrait: pose fov is the portrait frame's vertical FOV; we crop 9:16 from a landscape render.
    fr.fov = portrait ? 2 * Math.atan(Math.tan((pose.fovDeg * DEG2RAD) / 2) * aspect) : pose.fovDeg * DEG2RAD;
    fr.near = feed.kind === 'satellite' ? 100 : 0.5;
    cam.setView({ destination: pose.position, orientation: { heading: pose.heading, pitch: pose.pitch, roll: pose.roll } });
    if (this.cams && this.activeModel !== model) {
      for (const k of Object.keys(this.cams) as CameraModel[]) this.cams[k].enabled = k === model;
      this.activeModel = model;
      this.atmos?.setLook(isThermal(model) ? 'thermal' : 'camera');
    }
    const sn = this.sensor(feed, model, nowS);
    if (this.atmos && this.profile) {
      const d = this.sampler!.datumOffset;
      this.atmos.update(w.t, nowS, this.exaggeration, (this.profile.minElev + d) * this.exaggeration, d * this.exaggeration);
    }
    scene.fog.density = feed.kind === 'satellite' ? 0 : 1.0e-4;
    const own = feed.unitId ? this.proxies.entities.getById(`pu:${feed.unitId}`) : undefined;
    if (own) own.show = false;
    this.fire?.tick(nowS);
    this.viewer.clock.currentTime = Cesium.JulianDate.addSeconds(this.sceneTime, nowS, this.renderTime);
    try { this.viewer.render(); } finally { if (own) own.show = true; }
    // Keep the visible archive-camera fallback until this sensor has a real terrain frame.
    // Once primed, ordinary terrain refinement must not keep switching the feed back and forth.
    if (!this.surfacePrimed.has(feed.id)) {
      // A moving camera can keep the global tile queue nonempty indefinitely. A hit on
      // rendered terrain is enough to start this feed; unrelated proxy assets cannot block it.
      this.scratchW.x = scene.canvas.clientWidth * 0.5;
      this.scratchW.y = scene.canvas.clientHeight * 0.75;
      const ray = cam.getPickRay(this.scratchW);
      if (scene.globe.tilesLoaded || (ray && scene.globe.pick(ray, scene))) this.surfacePrimed.add(feed.id);
    }
    this.src = this.surfacePrimed.has(feed.id) ? scene.canvas : null;
    const dets = this.detect(feed, w.findings);
    this.renderCost = this.renderCost * 0.8 + (performance.now() - t0) * 0.2;
    return {
      ...base,
      detections: portrait ? dets.map((d) => toPortrait(d)).filter((d): d is Detection => !!d) : dets,
      renderedAt: performance.now(),
      nuc: sn.nuc,
      portrait,
      sat: model === 'sat' ? { real: false } : undefined,
    };
  }

  private copy(s: Surface, frame: FeedFrame) {
    const src = this.src;
    if (!src) return;
    const g = s.ctx;
    const W = s.canvas.width, H = s.canvas.height;
    const sw = (src as HTMLCanvasElement).width, sh = (src as HTMLCanvasElement).height;
    if (frame.portrait) {
      // Social video posted portrait: crop the centre 9:16 and fill the sides with a dim, blurred copy.
      const cw = sh * (9 / 16);
      const tmp = this.portraitTmp;
      if (tmp.width !== 48) { tmp.width = 48; tmp.height = 27; }
      const tg = tmp.getContext('2d')!;
      tg.drawImage(src, 0, 0, sw, sh, 0, 0, 48, 27);
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 1;
      g.drawImage(tmp, 0, 0, 48, 27, 0, 0, W, H);
      g.fillStyle = PORTRAIT_DIM;
      g.fillRect(0, 0, W, H);
      const dw = H * (9 / 16);
      g.drawImage(src, (sw - cw) / 2, 0, cw, sh, (W - dw) / 2, 0, dw, H);
    } else {
      g.drawImage(src, 0, 0, sw, sh, 0, 0, W, H);
    }
    s.lastFrameAt = performance.now();
    s.onFrame?.(frame);
  }

  private detect(feed: Feed, findings: Finding[]): Detection[] {
    const out: Detection[] = [];
    if (!feed.findingIds.length) return out;
    const scene = this.viewer.scene;
    const cam = scene.camera;
    const W = scene.canvas.clientWidth || 1, H = scene.canvas.clientHeight || 1;
    const fovy = (cam.frustum as Cesium.PerspectiveFrustum).fovy ?? 0.7;
    const s = this.sampler!;
    for (const id of feed.findingIds) {
      const f = findings.find((x) => x.id === id);
      if (!f) continue;
      const color = findingColor(f, 'Z3_FOCUS');
      // Stored detector boxes describe an earlier source frame. Reproject the synthetic scene every
      // render instead of pinning a stale box to the screen as its camera moves.
      if (feed.kind === 'social' && f.bbox && f.bbox.feedId === feed.id) {
        out.push({ id: f.id, kind: f.kind, label: f.label, confidence: f.confidence, color, x: f.bbox.x, y: f.bbox.y, w: f.bbox.w, h: f.bbox.h });
        continue;
      }
      const spec = PROXY_SIZE[f.kind];
      const hgt = spec?.h ?? 2;
      const p = Cesium.Cartesian3.fromDegrees(f.pos.lon, f.pos.lat, s.elevation(f.pos.lon, f.pos.lat) * this.exaggeration + hgt / 2);
      const toP = Cesium.Cartesian3.subtract(p, cam.positionWC, new Cesium.Cartesian3());
      if (Cesium.Cartesian3.dot(toP, cam.directionWC) <= 0) continue;
      const win = Cesium.SceneTransforms.worldToWindowCoordinates(scene, p);
      if (!win) continue;
      const dist = Cesium.Cartesian3.magnitude(toP);
      const metersPerPx = (2 * dist * Math.tan(fovy / 2)) / H;
      const sizeM = Math.max(spec ? Math.max(spec.w, spec.l) * Math.min(3, f.count ?? spec.n ?? 1) : 8, 4);
      const bw = Math.max(26, sizeM / metersPerPx + 14), bh = Math.max(22, (spec ? hgt : 4) / metersPerPx + 14, bw * 0.7);
      const x = (win.x - bw / 2) / W, y = (win.y - bh / 2) / H;
      if (x > 1 || y > 1 || x + bw / W < 0 || y + bh / H < 0) continue;
      out.push({ id: f.id, kind: f.kind, label: f.label, confidence: f.confidence, color, x, y, w: bw / W, h: bh / H });
    }
    return out;
  }

  private scheduleDispose() {
    // Keep the context warm for quick remounts; dispose after 60 s with no surfaces.
    if (this.idleTimer) return;
    this.idleTimer = window.setTimeout(() => {
      if (this.surfaces.size) return;
      this.destroy();
    }, 60000);
  }

  private releasePack() {
    if (this.viewer.isDestroyed()) return;
    this.atmos?.destroy(); this.atmos = null;
    this.field = null; this.smoke = null;
    this.fire?.destroy(); this.fire = null;
    this.particles?.destroy(); this.particles = null;
    if (this.cams) for (const stage of Object.values(this.cams)) this.viewer.scene.postProcessStages.remove(stage);
    this.cams = null; this.activeModel = null;
    this.field = null; this.smoke = null; this.profile = null; this.src = null;
    if (this.buildings) this.viewer.scene.primitives.remove(this.buildings);
    if (this.basemapTiles && !this.basemapTiles.isDestroyed()) this.viewer.scene.primitives.remove(this.basemapTiles);
    this.buildings = undefined; this.basemapTiles = undefined;
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.idleTimer);
    this.unsub();
    this.releasePack();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
    this.host.remove();
    if (FeedRenderer.inst === this) FeedRenderer.inst = null;
  }
}

const PORTRAIT_DIM = rgba(ds.void, 0.55);

/**
 * The 9:16 crop is drawn at its source size in the centre of the surface, so normalised coordinates are
 * unchanged; detections outside the strip are dropped.
 */
function toPortrait(d: Detection): Detection | null {
  const strip = (9 / 16) * (9 / 16);
  const x0 = (1 - strip) / 2;
  return d.x > x0 + strip || d.x + d.w < x0 ? null : d;
}
