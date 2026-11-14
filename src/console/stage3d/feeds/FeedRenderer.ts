import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import type { Feed, FeedFx, Finding, FindingKind, ScenarioPack, Unit } from '../../contracts';
import { getSampler } from '../StageEngine';
import { FireOverlay, getFireField, type FireField } from '../fire';
import { createFeedFxStages } from '../fx';
import { findingColor } from '../layers';
import { FireParticles } from '../particles';
import { RasterSampler, weatherAt, DEG2RAD } from '../raster';
import { createDarkViewer, setupBasemap } from '../viewer';
import { stageWorld, unitPos } from '../world';
import { feedPose, type FeedPose } from './poses';

export const FULL_W = 960;
export const FULL_H = 540;
export const THUMB_W = 384;
export const THUMB_H = 216;
const FULL_INTERVAL_MS = 1000 / 18;
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
}

export interface SurfaceHandle {
  feedId: string;
  variant: 'thumb' | 'full';
  canvas: HTMLCanvasElement;
  onFrame?: (f: FeedFrame) => void;
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
 * One hidden Cesium viewer shared by every <FeedSurface>. It renders the active full feed at ~18 fps
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
  private fx: Record<FeedFx, Cesium.PostProcessStage>;
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
  private lastFull = 0;
  private lastThumb = 0;
  private thumbCursor = 0;
  private warm: { key: number; feedId: string } | null = null;
  private frameNo = 0;
  private t0 = performance.now();
  private renderCost = 8;
  private proxies = new Cesium.CustomDataSource('feed-proxies');
  private proxySig = '';
  private unitSig = '';
  private weatherT = NaN;
  private unsub: () => void;
  private idleTimer = 0;
  private activeFx: FeedFx | null = null;
  private sizeMode: 'full' | 'thumb' = 'thumb';

  private constructor() {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    // Must stay laid out (non-zero size) for Cesium; parked off-screen.
    host.style.cssText = `position:fixed;left:-12000px;top:0;width:${THUMB_W}px;height:${THUMB_H}px;pointer-events:none;`;
    document.body.appendChild(host);
    this.host = host;
    const credit = document.createElement('div');
    this.viewer = createDarkViewer(host, { msaa: 1, preserveDrawingBuffer: true, useDefaultRenderLoop: false, creditContainer: credit });
    const scene = this.viewer.scene;
    scene.fog.density = 2.4e-4;
    scene.globe.maximumScreenSpaceError = 2.5;
    scene.globe.tileCacheSize = 900;
    this.viewer.dataSources.add(this.proxies);
    this.fx = createFeedFxStages(scene, () => (performance.now() - this.t0) / 1000);
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
    if (!pack || pack === this.pack) return;
    this.pack = pack;
    const s = getSampler(pack);
    this.sampler = s;
    try {
      const bm = await setupBasemap(this.viewer, pack, s);
      this.exaggeration = bm.exaggeration;
      const scene = this.viewer.scene;
      this.field = getFireField(pack, s);
      this.fire = new FireOverlay(scene, this.field, { flicker: true, strength: 1.0 });
      this.particles = new FireParticles(scene, s, { maxFlames: 12, maxSmoke: 5, exaggeration: this.exaggeration, smokeScale: 0.8 });
      this.addBuildings(pack, s);
      this.ready = true;
      this.syncFire();
      this.syncProxies();
      this.syncUnitProxies();
      this.kick();
    } catch (err) {
      console.error('[stage3d] feed renderer init failed', err);
    }
  }

  private syncFire() {
    const w = stageWorld.get();
    if (!this.field || !this.pack) return;
    const updated = this.field.sync(w.t, w.fireRev);
    const wx = weatherAt(this.pack, w.t);
    if (updated || wx.t !== this.weatherT || this.field.rev === 1) {
      this.weatherT = wx.t;
      this.particles?.setHotspots(this.field.hotspots, { dirDeg: wx.windDirDeg, kph: wx.windKph });
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
    this.viewer.scene.primitives.add(
      new Cesium.Primitive({ geometryInstances: instances, appearance: new Cesium.PerInstanceColorAppearance({ flat: false, translucent: false }), asynchronous: true }),
    );
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
          const p = unitPos(cur, performance.now(), g);
          const base = s.elevation(p.lon, p.lat) * this.exaggeration;
          return Cesium.Cartesian3.fromDegrees(p.lon, p.lat, base + (air ? Math.max(40, p.alt ?? 120) : dims[2] / 2), undefined, result);
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
    if (this.ready) {
      try {
        this.step();
      } catch (err) {
        console.warn('[stage3d] feed render error', err);
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private feedById(id: string): Feed | undefined {
    return stageWorld.get().feeds.find((f) => f.id === id);
  }

  private step() {
    const now = performance.now();
    const all = [...this.surfaces.values()];
    let full: Surface | null = null;
    for (const s of all) if (s.variant === 'full' && this.feedById(s.feedId) && (!full || s.registeredAt > full.registeredAt)) full = s;
    // Resizing reallocates framebuffers, so the size follows "is any full surface active", not each render.
    this.setSize(full ? 'full' : 'thumb');

    if (this.warm) {
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

    if (full && now - this.lastFull >= FULL_INTERVAL_MS) {
      this.lastFull = now;
      const feed = this.feedById(full.feedId)!;
      const frame = this.render(feed);
      for (const s of all) if (s.variant === 'full' && s.feedId === full.feedId) this.copy(s, frame);
      // Thumbs showing the same feed ride along at the full rate (throttled to ~4 fps).
      for (const s of all) if (s.variant === 'thumb' && s.feedId === full.feedId && now - s.lastFrameAt > 250) this.copy(s, frame);
      return;
    }

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
    this.render(feed);
    this.warm = { key: 0, feedId: id };
  }

  private setSize(mode: 'full' | 'thumb') {
    if (this.sizeMode === mode) return;
    this.sizeMode = mode;
    this.host.style.width = `${mode === 'full' ? FULL_W : THUMB_W}px`;
    this.host.style.height = `${mode === 'full' ? FULL_H : THUMB_H}px`;
    this.viewer.resize();
  }

  private render(feed: Feed): FeedFrame {
    const t0 = performance.now();
    const w = stageWorld.get();
    const nowS = (t0 - this.t0) / 1000;
    const scene = this.viewer.scene;
    const pose = feedPose(feed, w, this.sampler!, this.exaggeration, nowS, (g) => scene.globe.getHeight(Cesium.Cartographic.fromDegrees(g.lon, g.lat)));
    const cam = scene.camera;
    const fr = cam.frustum as Cesium.PerspectiveFrustum;
    fr.fov = pose.fovDeg * DEG2RAD;
    fr.near = feed.kind === 'satellite' ? 100 : 0.5;
    cam.setView({ destination: pose.position, orientation: { heading: pose.heading, pitch: pose.pitch, roll: pose.roll } });
    if (this.activeFx !== feed.fx) {
      for (const k of Object.keys(this.fx) as FeedFx[]) this.fx[k].enabled = k === feed.fx;
      this.activeFx = feed.fx;
    }
    scene.fog.density = feed.kind === 'satellite' ? 0 : feed.kind === 'dash-cam' || feed.kind === 'helmet-cam' || feed.kind === 'social' ? 3.2e-4 : 2.2e-4;
    const own = feed.unitId ? this.proxies.entities.getById(`pu:${feed.unitId}`) : undefined;
    if (own) own.show = false;
    this.viewer.render();
    if (own) own.show = true;
    const dets = this.detect(feed, w.findings);
    this.renderCost = this.renderCost * 0.8 + (performance.now() - t0) * 0.2;
    this.frameNo++;
    return { feedId: feed.id, pose, detections: dets, frame: this.frameNo, renderedAt: performance.now() };
  }

  private copy(s: Surface, frame: FeedFrame) {
    const src = this.viewer.scene.canvas;
    s.ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, s.canvas.width, s.canvas.height);
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
      if (f.bbox && f.bbox.feedId === feed.id) {
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

  destroy() {
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.fire?.destroy();
    this.particles?.destroy();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
    this.host.remove();
    if (FeedRenderer.inst === this) FeedRenderer.inst = null;
  }
}
