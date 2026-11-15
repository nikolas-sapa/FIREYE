import * as Cesium from 'cesium';
import { color } from '@ds';
import type { ScenarioPack } from '../contracts';
import { terrainMaxLevel } from '../stage3d/cartography';
import { CameraFilter } from '../stage3d/feeds/dynamics';
import type { FeedPose } from '../stage3d/feeds/poses';
import { createCameraStages, modelFor, type CameraModel, type CameraUniforms } from '../stage3d/fx';
import { RasterSampler, DEG2RAD } from '../stage3d/raster';
import { createHeightmapTerrain, getImagerySampler } from '../stage3d/terrain';
import { createDarkViewer } from '../stage3d/viewer';
import { createSensorDetail } from './feed-detail';
import { DEMO_FEEDS, demoPose, PresentationBudget, PresentationCadence, PresentationClock, sensorWorld, type DemoFeed } from './feed-motion';

export interface SensorSurface {
  feed: DemoFeed;
  canvas: HTMLCanvasElement;
  full: boolean;
  active: boolean;
  visible: boolean;
  moving: boolean;
  frozen: boolean;
  onReady: () => void;
  onError: () => void;
  onTelemetry: (pose: FeedPose, seconds: number) => void;
}
interface Surface extends SensorSurface {
  context: CanvasRenderingContext2D;
  ready: boolean;
  frame: number;
  hudAt: number;
  settled: boolean;
}
interface Motion { clock: PresentationClock; filter: CameraFilter }

/**
 * Monitoring-only counterpart of the legacy shared Cesium renderer.
 * No 2-second round-robin, incident entities, synthetic fire, thermal claims or per-frame React state.
 */
export class MonitoringFeedRenderer {
  private host: HTMLDivElement;
  private viewer: Cesium.Viewer;
  private sampler: RasterSampler;
  private world;
  private surfaces = new Set<Surface>();
  private motion = new Map<string, Motion>();
  private cadence = new PresentationCadence();
  private budget = new PresentationBudget();
  private cameraUniforms: CameraUniforms = { time: 0, exposure: 1.15, motion: 0, nuc: 0, shake: 0 };
  private cameras: Record<CameraModel, Cesium.PostProcessStage> | null = null;
  private model: CameraModel | null = null;
  private raf = 0;
  private ready = false;
  private dead = false;
  private failed = false;
  private full = false;
  private costMs = 1;
  private primed = new Set<string>();
  private detail: ReturnType<typeof createSensorDetail> | undefined;
  private buildings: Cesium.Primitive | undefined;
  private sceneTime = Cesium.JulianDate.fromIso8601('2018-07-23T12:00:00Z');

  constructor(private pack: ScenarioPack) {
    this.sampler = new RasterSampler(pack);
    this.world = sensorWorld(pack);
    this.host = document.createElement('div');
    this.host.setAttribute('aria-hidden', 'true');
    this.host.dataset.monitoringRenderer = 'true';
    this.host.style.cssText = 'position:fixed;left:-12000px;top:0;width:384px;height:216px;pointer-events:none';
    document.body.appendChild(this.host);
    try {
      this.viewer = createDarkViewer(this.host, { msaa: 1, preserveDrawingBuffer: true,
        useDefaultRenderLoop: false, creditContainer: document.createElement('div') });
    } catch (error) { this.host.remove(); throw error; }
    this.viewer.resolutionScale = 1 / Math.max(1, window.devicePixelRatio);
    this.viewer.clock.shouldAnimate = false;
    this.viewer.clock.currentTime = this.sceneTime;
    const scene = this.viewer.scene;
    scene.fog.density = 0.00012;
    scene.globe.maximumScreenSpaceError = 3;
    scene.globe.tileCacheSize = 700;
    scene.globe.preloadAncestors = true;
    scene.globe.preloadSiblings = true;
    if (scene.skyAtmosphere) { scene.skyAtmosphere.brightnessShift = 0; scene.skyAtmosphere.saturationShift = -0.1; }
    for (const f of DEMO_FEEDS) this.motion.set(f.id, { clock: new PresentationClock(), filter: new CameraFilter() });
    document.addEventListener('visibilitychange', this.visibility);
    void this.initialize();
  }

  private async initialize() {
    try {
      const image = this.pack.imagery;
      if (!image) throw new Error('Dated terrain imagery is required');
      const rectangle = Cesium.Rectangle.fromDegrees(...image.bbox);
      const provider = await Cesium.SingleTileImageryProvider.fromUrl(image.url, { rectangle,
        credit: new Cesium.Credit(`EOX Sentinel-2 2018 archive · CC BY-NC-SA 4.0 · ${image.source}`) });
      if (this.dead) return;
      this.viewer.imageryLayers.add(new Cesium.ImageryLayer(provider, { rectangle, contrast: 1.08, saturation: 1 }));
      // Keep legacy canopy detail, without its synchronous 65,536-pixel tile jobs blocking frame delivery.
      try { this.detail = createSensorDetail(this.pack); this.viewer.imageryLayers.add(this.detail.layer); } catch { /* Raw dated imagery remains usable if workers are unavailable. */ }
      const sample = await getImagerySampler(this.pack);
      if (this.dead) return;
      const sea = sample?.(24.025, 38.03);
      if (sea) this.viewer.scene.globe.baseColor = new Cesium.Color(sea[0] / 255, sea[1] / 255, sea[2] / 255);
      // Native DEM heights are deterministic. Do not let a streamed terrain LOD move a mounted camera.
      this.viewer.scene.verticalExaggeration = 1;
      this.viewer.terrainProvider = createHeightmapTerrain(this.sampler, false,
        { maximumLevel: terrainMaxLevel(this.pack.raster.cellM, this.pack.manifest.center.lat), localCoverage: true });
      this.cameras = createCameraStages(this.viewer.scene, this.cameraUniforms);
      this.addBuildings();
      this.ready = true;
      this.kick();
    } catch { if (!this.dead) this.fail(); }
  }

  /** Same source-position box stand-ins as legacy, illustrative dimensions, not measured building models. */
  private addBuildings() {
    const instances = this.pack.buildings.slice(0, 4000).map((b, i) => {
      const height = 5 + ((i * 7) % 4);
      return new Cesium.GeometryInstance({
        geometry: Cesium.BoxGeometry.fromDimensions({ dimensions: new Cesium.Cartesian3(11 + i % 5, 9 + i % 3 * 2, height),
          vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT }),
        modelMatrix: Cesium.Transforms.headingPitchRollToFixedFrame(
          Cesium.Cartesian3.fromDegrees(b.pos.lon, b.pos.lat, this.sampler.elevation(b.pos.lon, b.pos.lat) + height / 2 - 0.5),
          new Cesium.HeadingPitchRoll((i * 37 % 90) * DEG2RAD, 0, 0)),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.fromCssColorString(color.ink[500])) },
      });
    });
    if (instances.length) this.buildings = this.viewer.scene.primitives.add(new Cesium.Primitive({ geometryInstances: instances,
      appearance: new Cesium.PerInstanceColorAppearance({ flat: false, translucent: false }), asynchronous: true }));
  }

  register(input: SensorSurface) {
    const context = input.canvas.getContext('2d', { alpha: false });
    if (!context) { input.onError(); return { update: () => {}, dispose: () => {} }; }
    const surface: Surface = { ...input, context, ready: false, settled: false, frame: 0, hudAt: -Infinity };
    this.surfaces.add(surface);
    this.motion.get(input.feed.id)?.clock.suspend(performance.now());
    if (this.failed) input.onError();
    this.kick();
    return {
      update: (patch: Partial<Pick<SensorSurface, 'active' | 'visible' | 'moving' | 'frozen'>>) => {
        if (Object.entries(patch).some(([key, value]) => surface[key as keyof SensorSurface] !== value)) {
          this.motion.get(surface.feed.id)?.clock.suspend(performance.now());
        }
        Object.assign(surface, patch); this.kick();
      },
      dispose: () => { this.surfaces.delete(surface); },
    };
  }

  private visibility = () => {
    for (const m of this.motion.values()) m.clock.suspend(performance.now());
    this.cadence.reset();
    if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; } else this.kick();
  };

  private kick() {
    if (!this.raf && !this.dead && !this.failed && !document.hidden && this.surfaces.size) this.raf = requestAnimationFrame(this.step);
  }

  private step = (now: number) => {
    this.raf = 0;
    if (this.dead || this.failed || document.hidden) return;
    const shown = [...this.surfaces].filter(s => s.active && s.visible);
    const full = shown.find(s => s.full);
    const targets = full ? [full] : shown;
    for (const [id, state] of this.motion) state.clock.tick(now, targets.some(s => s.feed.id === id && s.moving));
    if (!targets.length) return;
    if (this.ready) {
      if (this.full !== !!full) {
        this.full = !!full; this.cadence.reset();
        this.host.style.width = full ? '960px' : '384px'; this.host.style.height = full ? '540px' : '216px';
        this.viewer.resize();
      }
      // Lower the entire wall cadence together under load, not a jittery per-camera queue.
      const count = new Set(targets.map(s => s.feed.id)).size;
      const fps = full ? 30 : this.budget.rate(now, this.costMs, count);
      if (this.cadence.due(now, fps)) {
        try {
          const groups = new Map<string, Surface[]>();
          for (const s of targets) groups.set(s.feed.id, [...(groups.get(s.feed.id) ?? []), s]);
          for (const surfaces of groups.values()) {
            const state = this.motion.get(surfaces[0].feed.id)!;
            // Explicit Pause freezes exact pixels. Reduced motion still allows initial assets to finish loading.
            if (surfaces.every(s => s.ready && (s.frozen || (!s.moving && s.settled)))) continue;
            this.render(surfaces, state, now);
          }
        } catch { this.fail(); }
      }
    }
    this.kick();
  };

  private render(surfaces: Surface[], state: Motion, now: number) {
    const start = performance.now(), feed = surfaces[0].feed;
    const pose = demoPose(feed, this.world, this.sampler, state.clock.seconds, state.filter);
    const scene = this.viewer.scene, camera = scene.camera;
    const frustum = camera.frustum as Cesium.PerspectiveFrustum;
    frustum.fov = pose.fovDeg * DEG2RAD; frustum.near = 0.5;
    camera.setView({ destination: pose.position, orientation: { heading: pose.heading, pitch: pose.pitch, roll: pose.roll } });
    const model = modelFor(feed);
    if (this.cameras && this.model !== model) {
      for (const key of Object.keys(this.cameras) as CameraModel[]) this.cameras[key].enabled = key === model;
      this.model = model;
    }
    // Sensor styling is reused, but fake shake, noise animation and periodic thermal freezes are disabled.
    this.cameraUniforms.time = state.clock.seconds;
    this.viewer.render();
    if (!this.primed.has(feed.id)) {
      const ray = camera.getPickRay(new Cesium.Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight * 0.75));
      if (ray && scene.globe.pick(ray, scene)) this.primed.add(feed.id);
    }
    if (!this.primed.has(feed.id)) return;
    for (const s of surfaces) {
      s.context.drawImage(scene.canvas, 0, 0, s.canvas.width, s.canvas.height);
      s.canvas.dataset.frame = String(++s.frame);
      s.canvas.dataset.renderedAt = String(performance.now());
      s.canvas.dataset.simulationSeconds = String(state.clock.seconds);
      s.canvas.dataset.ready = 'true';
      s.settled = scene.globe.tilesLoaded && (!this.detail || this.detail.idle()) && (!this.buildings || this.buildings.ready);
      if (!s.ready) { s.ready = true; s.onReady(); }
      if (now - s.hudAt > 250) { s.hudAt = now; s.onTelemetry(pose, state.clock.seconds); }
    }
    this.costMs = this.costMs * 0.9 + Math.max(0.1, performance.now() - start) * 0.1;
  }

  private fail() {
    this.failed = true; cancelAnimationFrame(this.raf); this.raf = 0;
    for (const s of this.surfaces) s.onError();
  }

  destroy() {
    this.dead = true; cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.visibility);
    this.surfaces.clear();
    this.detail?.dispose();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
    this.host.remove();
  }
}
