import * as Cesium from 'cesium';
import type { Directive, Geo, ScenarioPack } from '../contracts';
import { onThemeChange } from '@ds';
import { AtmospherePass } from './atmosphere';
import { easeServo, prefersReducedMotion } from './easing';
import { FireOverlay, getFireField, type FireField } from './fire';
import { createGradeStage } from './fx';
import { loadIcons } from './glyphs';
import { StageLayers } from './layers';
import { FireParticles } from './particles';
import { getProfile, type StageProfile } from './profile';
import { RasterSampler, weatherAt, DEG2RAD } from './raster';
import { getSampler } from './sampler';
import { getSmokeField, type SmokeField } from './smoke';
import type { StageBasemap, StageKey } from './types';
import { applySunLight, createDarkViewer, setupBasemap } from './viewer';
import { stageWorld } from './world';
import { getMapSettings, onMapSettingsChange } from './map-settings';
import { OutlineMap } from './outline';
import { daylight, sunPosition } from './sun';
import type { BasemapResult } from './viewer';

export { getSampler };

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
  metersPerPixel?: number;
  streamedContext?: boolean;
  demSpacingM?: number;
  localTerrain?: boolean;
}

/** Imperative owner of the main Cesium scene. React only mounts it and forwards selection. */
export class StageEngine {
  readonly viewer: Cesium.Viewer;
  private sampler: RasterSampler | null = null;
  private field: FireField | null = null;
  private fire: FireOverlay | null = null;
  private particles: FireParticles | null = null;
  private layers: StageLayers | null = null;
  private smoke: SmokeField | null = null;
  private atmos: AtmospherePass | null = null;
  private profile: StageProfile | null = null;
  private sunKey = NaN;
  private offTheme: () => void;
  private offMap: () => void;
  private outline: OutlineMap | null = null;
  private satellite: BasemapResult | null = null;
  private satelliteTask: Promise<void> | null = null;
  private satelliteTerrain: Cesium.TerrainProvider | null = null;
  private satelliteDatum = 0;
  private appliedDatum = 0;
  private offTiles: () => void;
  private groundScale = 0;
  private scaleAt = 0;
  private scalePosition = new Cesium.Cartesian3();
  private scaleDirection = new Cesium.Cartesian3();
  private scaleWidth = 0;
  private scaleHeight = 0;
  private resolutionKey = '';
  private grade: Cesium.PostProcessStage | null = null;
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
    this.viewer.useBrowserRecommendedResolution = false;
    this.offTiles = scene.globe.tileLoadProgressEvent.addEventListener((remaining: number) => {
      if (remaining === 0) this.groundScale = 0;
    });
    // Until a pack arrives the camera sits far out; initPack frames the scenario from its profile.
    const first = stageWorld.get().pack;
    const c0 = first ? getProfile(first).center : { lon: 0, lat: 20 };
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(c0.lon, c0.lat, first ? getProfile(first).spanM * 30 : 2.2e7),
      orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
    });
    this.offTheme = onThemeChange(() => {
      if (!this.layers) return;
      this.layers.invalidateTheme();
      for (const k of ['findings', 'units', 'actions', 'coverage', 'projection'] as StageKey[]) this.pending.add(k);
      this.viewer.scene.requestRender();
    });
    this.offMap = onMapSettingsChange(() => { void this.applyMapSettings(); });
    scene.preRender.addEventListener(this.onPreRender);
    scene.postRender.addEventListener(this.onPostRender);
    this.handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => this.onClick(e.position), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => this.onHover(e.endPosition), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    this.unsub = stageWorld.subscribe((changed) => {
      for (const k of changed) this.pending.add(k);
      if (changed.has('pack')) void this.initPack();
    });
    if (import.meta.env.DEV) (window as unknown as { __fccStage?: StageEngine }).__fccStage = this;
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
      // Feed/provider calibration must never mutate the main map's local height frame.
      const s = new RasterSampler(pack);
      this.sampler = s;
      const [outline] = await Promise.all([
        OutlineMap.create(this.viewer, pack, s),
        loadIcons(),
        document.fonts?.load('500 10px "JetBrains Mono Variable"').catch(() => undefined),
      ]);
      if (this.destroyed) {
        outline.destroy();
        return;
      }
      this.outline = outline;
      this.basemap = 'offline';
      this.exaggeration = 1;
      const scene = this.viewer.scene;
      const prof = getProfile(pack);
      this.profile = prof;
      const ctrl = scene.screenSpaceCameraController;
      ctrl.minimumZoomDistance = prof.minZoomM;
      ctrl.maximumZoomDistance = prof.maxZoomM;
      scene.fog.density = Math.min(2.4e-4, Math.max(4e-5, 1.6e-4 * (30000 / prof.spanM) ** 0.5));
      if (stageWorld.get().dataMode !== 'monitoring') {
        this.field = getFireField(pack, s);
        this.fire = new FireOverlay(scene, this.field, { flicker: !this.reduced });
        this.particles = new FireParticles(scene, s, { maxFlames: 16, maxSmoke: 6, maxEmbers: 6, exaggeration: this.exaggeration, profile: prof });
        this.particles.show = !this.reduced;
        this.smoke = getSmokeField(pack, s);
        // Order matters: the atmosphere works on the scene-referred image, the grade runs last.
        if (!/[?&]atmos=0\b/.test(location.search)) {
          this.atmos = new AtmospherePass(scene, pack, this.field, this.smoke, { look: 'stage', quality: 1, shimmer: !this.reduced });
        }
      }
      this.grade = createGradeStage(scene, { saturation: 0.92, vignette: 0.42 });
      this.layers = new StageLayers(this.viewer, s, {
        exaggeration: this.exaggeration,
        labelFarM: prof.labelFarM,
        minorLabelFarM: prof.minorLabelFarM,
        unitLabelFarM: prof.unitLabelFarM,
      });
      this.layers.syncPlaces(pack);
      // Do not replay directives issued before the stage existed.
      for (const d of stageWorld.get().directives) this.handled.add(d.id);
      this.homeView(0);
      this.ready = true;
      if (import.meta.env.DEV) performance.measure('fcc:stage-init', { start: this.t0, end: performance.now() });
      for (const k of ['t', 'fireRev', 'projection', 'findings', 'units', 'coverage', 'actions', 'items'] as StageKey[]) this.pending.add(k);
      await this.applyMapSettings();
    } catch (err) {
      if (this.destroyed) return;
      console.error('[stage3d] init failed', err);
      this.o.onStatus?.({ phase: 'error', error: String(err) });
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsub();
    this.offTheme();
    this.offMap();
    this.offTiles();
    this.handler.destroy();
    this.atmos?.destroy();
    this.fire?.destroy();
    this.particles?.destroy();
    this.layers?.destroy();
    this.outline?.destroy();
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
    this.updateResolution();
    this.fire?.tick(this.reduced ? 0 : now);
    this.updateGroundScale();
    this.applyMapVisibility();
    if (this.atmos && this.profile && this.sampler) {
      const d = this.sampler.datumOffset;
      this.atmos.update(stageWorld.get().t, this.reduced ? 0 : now, this.exaggeration, (this.profile.minElev + d) * this.exaggeration, d * this.exaggeration);
    }
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
      if (w.dataMode !== 'monitoring' && this.field) {
        const updated = this.field.sync(w.t, w.fireRev);
        const wx = weatherAt(pack, w.t);
        if (updated || wx.t !== this.weatherT) {
          this.weatherT = wx.t;
          const wind = { dirDeg: wx.windDirDeg, kph: wx.windKph };
          this.particles!.setHotspots(this.field!.hotspots, wind);
          this.smoke!.update(this.field!.sources, wind, this.exaggeration);
        }
      }
      const sk = Math.round(w.t / 120000);
      if (sk !== this.sunKey && this.viewer.scene.globe.enableLighting) {
        this.sunKey = sk;
        applySunLight(this.viewer.scene, pack, w.t);
      }
      if (w.dataMode !== 'monitoring') L.syncPerimeter(pack, w.t);
    }
    if (keys.has('projection')) L.syncProjection(w.projection);
    if (keys.has('findings') || keys.has('items')) L.syncFindings(w.findings, w.items);
    if (keys.has('units')) L.syncUnits(w.units, this.viewer.camera);
    if (keys.has('coverage')) L.syncCoverage(w.coverage);
    if (keys.has('actions')) L.syncActions(w.actions);
    if (keys.has('directives')) this.applyDirectives(w.directives);
    L.applyAppearance(true);
    this.applyMapVisibility();
  }

  /** Switch only this viewer. The feed renderer keeps its own scene, optics and streamed imagery. */
  private async applyMapSettings() {
    if (!this.ready || !this.outline || !this.pack || !this.sampler || this.destroyed) return;
    if (getMapSettings().mode === 'satellite' && !this.satellite) {
      if (!this.satelliteTask) {
        this.satelliteTask = (async () => {
          this.satellite = await setupBasemap(this.viewer, this.pack!, this.sampler!);
          if (!this.destroyed) {
            this.satelliteTerrain = this.viewer.terrainProvider;
            this.satelliteDatum = this.sampler!.datumOffset;
          }
        })();
      }
      try { await this.satelliteTask; }
      catch { this.satelliteTask = null; }
    }
    if (this.destroyed) return;
    // Read again after the async load: an Outline click during loading must win.
    const outline = getMapSettings().mode === 'outline' || !this.satellite;
    const scene = this.viewer.scene;
    const datum = outline ? 0 : this.satelliteDatum;
    if (this.appliedDatum !== datum) {
      this.appliedDatum = datum;
      this.sampler.datumOffset = datum;
      this.layers?.destroy();
      const prof = this.profile!;
      this.layers = new StageLayers(this.viewer, this.sampler, {
        exaggeration: 1, labelFarM: prof.labelFarM,
        minorLabelFarM: prof.minorLabelFarM, unitLabelFarM: prof.unitLabelFarM,
      });
      this.layers.selectedId = this.selected;
      this.layers.syncPlaces(this.pack);
      for (const k of ['t', 'projection', 'findings', 'units', 'coverage', 'actions', 'items'] as StageKey[]) this.pending.add(k);
    }
    this.sampler.datumOffset = datum;
    this.groundScale = 0;
    this.viewer.terrainProvider = outline ? this.outline.terrain : this.satelliteTerrain!;
    for (let i = 0; i < this.viewer.imageryLayers.length; i++) {
      const layer = this.viewer.imageryLayers.get(i);
      if (!this.outline.context.owns(layer)) layer.show = !outline;
    }
    if (this.satellite?.tileset) this.satellite.tileset.show = !outline;
    scene.globe.show = outline || this.satellite?.basemap !== 'google-3d';
    scene.globe.enableLighting = !outline && this.satellite?.basemap === 'ion-world';
    scene.verticalExaggeration = 1;
    // Cartographic lines already antialias analytically. Avoid redundant multisample buffers at Retina.
    scene.msaaSamples = outline ? 1 : 4;
    this.sunKey = NaN;
    this.basemap = outline ? 'offline' : this.satellite!.basemap;
    this.applyMapVisibility();
    this.o.onStatus?.({ phase: 'ready', basemap: this.basemap });
    scene.requestRender();
  }

  private applyMapVisibility() {
    if (!this.ready || !this.layers || !this.profile || !this.outline) return;
    const settings = getMapSettings(), v = settings.layers;
    const { lat, lon } = this.profile.center;
    const day = daylight(sunPosition(stageWorld.get().t, lat, lon).elDeg);
    this.outline.apply(settings, this.groundScale);
    this.layers.applyAppearance();
    this.layers.applyVisibility(v);
    const outline = settings.mode === 'outline';
    this.layers.ds.projection.show = v.projection;
    this.layers.ds.units.show = v.units;
    this.layers.ds.findings.show = v.findings;
    this.layers.ds.actions.show = v.actions;
    this.layers.ds.coverage.show = v.coverage;
    for (const entity of this.layers.ds.base.entities.values) entity.show = entity.id.startsWith('p:') ? v.places : v.perimeter;
    if (this.fire) {
      this.fire.setTactical(outline);
      this.fire.show = v.fire && (this.field?.stats.burnedCells ?? 0) > 0;
    }
    if (this.particles) this.particles.show = !outline && v.fire && v.atmosphere && !this.reduced;
    if (this.atmos) this.atmos.stage.enabled = !outline && v.atmosphere;
    if (this.grade) {
      this.grade.enabled = !outline;
      // Keep the replay's day/night lighting even when the smoke/atmosphere layer is hidden.
      this.grade.uniforms.daylight = v.atmosphere ? 1 : day;
    }
    this.viewer.scene.fog.enabled = !outline && v.atmosphere;
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
    const p = getProfile(this.pack);
    this.flyTo(p.center, { rangeM: p.homeRangeM, headingDeg: 18, pitchDeg: -40, duration });
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
    const ray = cam.getPickRay(c);
    const hit = ray ? scene.globe.pick(ray, scene) : undefined;
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
      metersPerPixel: this.groundScale || undefined,
      streamedContext: this.outline?.context.active,
      demSpacingM: this.pack?.raster.cellM,
      localTerrain: center ? this.sampler?.inside(center.lon, center.lat) : false,
    };
  }

  /** Ground footprint at the view centre, not ellipsoid altitude. At most 10 samples/second. */
  private updateGroundScale() {
    const camera = this.viewer.camera, scene = this.viewer.scene, canvas = scene.canvas;
    const now = performance.now();
    if (now - this.scaleAt < 100) return;
    if (this.groundScale > 0 && Cesium.Cartesian3.equals(camera.positionWC, this.scalePosition)
      && Cesium.Cartesian3.equals(camera.directionWC, this.scaleDirection)
      && canvas.clientWidth === this.scaleWidth && canvas.clientHeight === this.scaleHeight) return;
    this.scaleAt = now;
    Cesium.Cartesian3.clone(camera.positionWC, this.scalePosition);
    Cesium.Cartesian3.clone(camera.directionWC, this.scaleDirection);
    this.scaleWidth = canvas.clientWidth; this.scaleHeight = canvas.clientHeight;
    const x = canvas.clientWidth / 2, y = canvas.clientHeight / 2;
    const a = camera.getPickRay(new Cesium.Cartesian2(x - 40, y));
    const b = camera.getPickRay(new Cesium.Cartesian2(x + 40, y));
    const p = a && scene.globe.pick(a, scene), q = b && scene.globe.pick(b, scene);
    this.groundScale = p && q ? Cesium.Cartesian3.distance(p, q) / 80 : 0;
  }

  /** Native-density hairlines, bounded to four megapixels; does not affect sensor viewers. */
  private updateResolution() {
    const canvas = this.viewer.scene.canvas;
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.devicePixelRatio || 1;
    const key = `${w}/${h}/${dpr}`;
    if (key === this.resolutionKey || !w || !h) return;
    this.resolutionKey = key;
    const density = Math.min(dpr, 2, Math.sqrt(4_000_000 / (w * h)));
    this.viewer.resolutionScale = density / dpr;
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
