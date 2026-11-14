import * as Cesium from 'cesium';
import type { Directive, Geo, ScenarioPack } from '../contracts';
import { easeServo, prefersReducedMotion } from './easing';
import { FireOverlay, getFireField, type FireField } from './fire';
import { createGradeStage } from './fx';
import { loadIcons } from './glyphs';
import { StageLayers } from './layers';
import { FireParticles } from './particles';
import { RasterSampler, weatherAt, DEG2RAD } from './raster';
import type { StageBasemap, StageKey } from './types';
import { createDarkViewer, setupBasemap } from './viewer';
import { stageWorld } from './world';

export interface StageEngineOptions {
  container: HTMLElement;
  creditContainer?: HTMLElement;
  onSelect?: (id: string | null, kind: 'unit' | 'finding' | 'place' | 'action' | null) => void;
  onStatus?: (s: StageStatus) => void;
}

export interface StageStatus {
  phase: 'boot' | 'loading' | 'ready' | 'error';
  basemap?: StageBasemap;
  error?: string;
}

export interface CameraInfo {
  headingDeg: number;
  pitchDeg: number;
  altM: number;
  center?: Geo;
}

const samplerCache = new WeakMap<ScenarioPack, RasterSampler>();
export function getSampler(pack: ScenarioPack): RasterSampler {
  let s = samplerCache.get(pack);
  if (!s) {
    s = new RasterSampler(pack);
    samplerCache.set(pack, s);
  }
  return s;
}

/** Imperative owner of the main Cesium scene. React only mounts it and forwards selection. */
export class StageEngine {
  readonly viewer: Cesium.Viewer;
  private sampler: RasterSampler | null = null;
  private field: FireField | null = null;
  private fire: FireOverlay | null = null;
  private particles: FireParticles | null = null;
  private layers: StageLayers | null = null;
  private pack: ScenarioPack | null = null;
  private pending = new Set<StageKey>();
  private handled = new Set<string>();
  private unsub: () => void;
  private destroyed = false;
  private ready = false;
  private exaggeration = 1;
  private weatherT = NaN;
  private frameFns = new Set<() => void>();
  private t0 = performance.now();
  private reduced = prefersReducedMotion();
  private handler: Cesium.ScreenSpaceEventHandler;
  private hoverAt = 0;
  private selected: string | null = null;
  basemap: StageBasemap | null = null;

  constructor(private o: StageEngineOptions) {
    this.viewer = createDarkViewer(o.container, { creditContainer: o.creditContainer, msaa: 4 });
    const scene = this.viewer.scene;
    createGradeStage(scene, { saturation: 0.92, vignette: 0.42 });
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-120.55, 38.2, 420000),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    scene.preRender.addEventListener(this.onPreRender);
    scene.postRender.addEventListener(this.onPostRender);
    this.handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => this.onClick(e.position), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => this.onHover(e.endPosition), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    this.unsub = stageWorld.subscribe((changed) => {
      for (const k of changed) this.pending.add(k);
      if (changed.has('pack')) void this.initPack();
    });
    o.onStatus?.({ phase: 'boot' });
    if (stageWorld.get().pack) void this.initPack();
  }

  /* -------------------------------------------------------------- lifecycle */

  private async initPack() {
    const pack = stageWorld.get().pack;
    if (!pack || pack === this.pack || this.destroyed) return;
    this.pack = pack;
    this.o.onStatus?.({ phase: 'loading' });
    try {
      const s = getSampler(pack);
      this.sampler = s;
      const [bm] = await Promise.all([
        setupBasemap(this.viewer, pack, s),
        loadIcons(),
        document.fonts?.load('500 10px "JetBrains Mono Variable"').catch(() => undefined),
      ]);
      if (this.destroyed) return;
      this.basemap = bm.basemap;
      this.exaggeration = bm.exaggeration;
      const scene = this.viewer.scene;
      this.field = getFireField(pack, s);
      this.fire = new FireOverlay(scene, this.field, { flicker: !this.reduced });
      this.particles = new FireParticles(scene, s, { maxFlames: 16, maxSmoke: 6, exaggeration: this.exaggeration });
      this.particles.show = !this.reduced;
      this.layers = new StageLayers(this.viewer, s, { exaggeration: this.exaggeration });
      this.layers.syncPlaces(pack);
      // Do not replay directives issued before the stage existed.
      for (const d of stageWorld.get().directives) this.handled.add(d.id);
      this.homeView(0);
      this.ready = true;
      for (const k of ['t', 'fireRev', 'projection', 'findings', 'units', 'coverage', 'actions', 'items'] as StageKey[]) this.pending.add(k);
      this.o.onStatus?.({ phase: 'ready', basemap: bm.basemap });
    } catch (err) {
      console.error('[stage3d] init failed', err);
      this.o.onStatus?.({ phase: 'error', error: String(err) });
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsub();
    this.handler.destroy();
    this.fire?.destroy();
    this.particles?.destroy();
    this.layers?.destroy();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }

  /** Pause the main render loop (e.g. while a feed covers the stage). */
  setActive(active: boolean) {
    if (this.viewer.isDestroyed()) return;
    this.viewer.useDefaultRenderLoop = active;
  }

  /* -------------------------------------------------------------- frame */

  private onPreRender = () => {
    const now = (performance.now() - this.t0) / 1000;
    this.fire?.tick(this.reduced ? 0 : now);
    if (!this.ready || !this.pending.size) return;
    const p = this.pending;
    this.pending = new Set();
    this.apply(p);
  };

  private onPostRender = () => {
    for (const fn of this.frameFns) fn();
  };

  onFrame(fn: () => void): () => void {
    this.frameFns.add(fn);
    return () => this.frameFns.delete(fn);
  }

  private apply(keys: Set<StageKey>) {
    const w = stageWorld.get();
    const pack = this.pack!;
    const L = this.layers!;
    if (keys.has('t') || keys.has('fireRev')) {
      const updated = this.field!.sync(w.t, w.fireRev);
      const wx = weatherAt(pack, w.t);
      if (updated || wx.t !== this.weatherT) {
        this.weatherT = wx.t;
        this.particles!.setHotspots(this.field!.hotspots, { dirDeg: wx.windDirDeg, kph: wx.windKph });
      }
      L.syncPerimeter(pack, w.t);
    }
    if (keys.has('projection')) L.syncProjection(w.projection);
    if (keys.has('findings') || keys.has('items')) L.syncFindings(w.findings, w.items);
    if (keys.has('units')) L.syncUnits(w.units, this.viewer.camera);
    if (keys.has('coverage')) L.syncCoverage(w.coverage);
    if (keys.has('actions')) L.syncActions(w.actions);
    if (keys.has('directives')) this.applyDirectives(w.directives);
  }

  private applyDirectives(list: Directive[]) {
    // Newest first: take the newest unhandled focusStage.
    let focus: Extract<Directive, { kind: 'focusStage' }> | null = null;
    for (const d of list) {
      if (this.handled.has(d.id)) continue;
      this.handled.add(d.id);
      if (d.kind === 'focusStage' && !d.suggested && !focus) focus = d;
    }
    if (focus) this.flyTo(focus.target, { rangeM: focus.rangeM, headingDeg: focus.headingDeg, pitchDeg: focus.pitchDeg });
  }

  /* -------------------------------------------------------------- camera */

  homeView(duration = 2.2) {
    if (!this.pack) return;
    const b = this.pack.manifest.bbox;
    const c = this.pack.manifest.center ?? { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 };
    const spanM = Math.max((b[2] - b[0]) * 111320 * Math.cos(c.lat * DEG2RAD), (b[3] - b[1]) * 110540);
    this.flyTo(c, { rangeM: spanM * 0.95, headingDeg: 18, pitchDeg: -40, duration });
  }

  flyTo(target: Geo, o: { rangeM?: number; headingDeg?: number; pitchDeg?: number; duration?: number } = {}) {
    if (this.viewer.isDestroyed()) return;
    const cam = this.viewer.camera;
    const s = this.sampler;
    const h = s ? s.elevation(target.lon, target.lat) * this.exaggeration : 0;
    const center = Cesium.Cartesian3.fromDegrees(target.lon, target.lat, h);
    const heading = o.headingDeg !== undefined ? o.headingDeg * DEG2RAD : cam.heading;
    const pitch = (o.pitchDeg ?? -38) * DEG2RAD;
    const range = o.rangeM ?? 3500;
    const duration = this.reduced ? 0 : o.duration ?? 2.4;
    cam.cancelFlight();
    cam.flyToBoundingSphere(new Cesium.BoundingSphere(center, 1), {
      offset: new Cesium.HeadingPitchRange(heading, pitch, range),
      duration,
      easingFunction: easeServo,
    });
  }

  cameraInfo(): CameraInfo {
    const cam = this.viewer.camera;
    const scene = this.viewer.scene;
    const c = new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
    const hit = cam.pickEllipsoid(c, scene.globe.ellipsoid);
    let center: Geo | undefined;
    if (hit) {
      const cg = Cesium.Cartographic.fromCartesian(hit);
      center = { lon: cg.longitude / DEG2RAD, lat: cg.latitude / DEG2RAD };
    }
    return {
      headingDeg: ((cam.heading / DEG2RAD) + 360) % 360,
      pitchDeg: cam.pitch / DEG2RAD,
      altM: cam.positionCartographic.height,
      center,
    };
  }

  /* -------------------------------------------------------------- picking & projection */

  private parsePick(picked: unknown): { id: string; kind: 'unit' | 'finding' | 'place' | 'action' } | null {
    const ent = (picked as { id?: unknown } | undefined)?.id;
    if (!(ent instanceof Cesium.Entity)) return null;
    const raw = ent.id;
    const m = /^([fupa]):([^:]+)/.exec(raw);
    if (!m) return null;
    const kind = ({ f: 'finding', u: 'unit', p: 'place', a: 'action' } as const)[m[1] as 'f' | 'u' | 'p' | 'a'];
    return { id: m[2], kind };
  }

  private onClick(pos: Cesium.Cartesian2) {
    const hit = this.parsePick(this.viewer.scene.pick(pos));
    this.o.onSelect?.(hit?.id ?? null, hit?.kind ?? null);
  }

  private onHover(pos: Cesium.Cartesian2) {
    const now = performance.now();
    if (now - this.hoverAt < 90) return;
    this.hoverAt = now;
    const hit = this.parsePick(this.viewer.scene.pick(pos));
    this.viewer.scene.canvas.style.cursor = hit ? 'pointer' : '';
  }

  setSelected(id: string | null) {
    if (id === this.selected) return;
    this.selected = id;
    if (!this.layers) return;
    this.layers.selectedId = id;
    this.layers.invalidateSelection();
    this.pending.add('findings');
    this.pending.add('units');
  }

  geoOf(id: string): Geo | undefined {
    return this.layers?.geoOf(id);
  }

  private scratchC = new Cesium.Cartesian3();
  private scratchW = new Cesium.Cartesian2();
  /** Screen position (CSS px within the canvas) of a stage id, or null when off-screen / behind the globe. */
  screenOf(id: string): { x: number; y: number; radiusPx: number } | null {
    if (!this.layers) return null;
    const p = this.layers.resolve(id, this.scratchC);
    if (!p) return null;
    return this.screenOfCart(p, this.layers.findingRadius(id));
  }

  private screenOfCart(p: Cesium.Cartesian3, radiusM: number) {
    const scene = this.viewer.scene;
    const cam = scene.camera;
    const toP = Cesium.Cartesian3.subtract(p, cam.positionWC, new Cesium.Cartesian3());
    if (Cesium.Cartesian3.dot(toP, cam.directionWC) <= 0) return null;
    const w = Cesium.SceneTransforms.worldToWindowCoordinates(scene, p, this.scratchW);
    if (!w) return null;
    const dist = Cesium.Cartesian3.magnitude(toP);
    const frustum = cam.frustum as Cesium.PerspectiveFrustum;
    const fovy = frustum.fovy ?? 1;
    const radiusPx = radiusM > 0 ? (radiusM / (dist * Math.tan(fovy / 2))) * (scene.canvas.clientHeight / 2) : 0;
    return { x: w.x, y: w.y, radiusPx };
  }

  get isReady() {
    return this.ready;
  }

  fireStats() {
    return this.field?.stats;
  }
}
