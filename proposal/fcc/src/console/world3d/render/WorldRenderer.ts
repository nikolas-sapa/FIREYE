import * as Cesium from 'cesium';
import * as THREE from 'three';
import type { ScenarioPack } from '../../contracts';
import { CameraFilter } from '../../stage3d/feeds/dynamics';
import type { FeedPose } from '../../stage3d/feeds/poses';
import { RasterSampler } from '../../stage3d/raster';
import { DEMO_FEEDS, demoPose, PresentationBudget, PresentationCadence, PresentationClock, sensorWorld, type DemoFeed } from '../../monitoring/feed-motion';
import { AgentMeshes } from '../agents/render';
import { AGENT_ID_BASE, AgentSim } from '../agents/sim';
import { computeEnv, type EnvInput, type EnvOverrides, type WorldEnv } from '../env';
import { HeightField } from '../frame';
import { curatedSites } from '../gen/sites';
import { buildSource } from '../gen/source';
import { CLASS_COLORS, decodeTruth, TRUTH_H, TRUTH_W, type TruthCapture } from '../truth/capture';
import { createRain, createSea, createSky, updateRain, updateSea, updateSky } from './atmosphere';
import { disposeArchetypeGeometry } from './geometry';
import { createWorldMaterials, createWorldUniforms } from './materials';
import { FireLayer } from './fire';
import { fireTiming } from '../fire/state';
import { getProfile } from '../../stage3d/profile';
import { SensorPost } from './post';
import { TILE_CACHE_CAP, TileStore } from './store';
import { WorldView } from './view';

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
  /** Successful pixel copy, separate from throttled HUD telemetry. Truth overlays are never eligible. */
  onPixels?: (thermal: 'white' | 'iron' | undefined) => void;
  /** Custom camera (FIREYE units); defaults to the monitoring demo pose. */
  pose?: (seconds: number, filter: CameraFilter) => FeedPose;
  thermal?: 'white' | 'iron';
  /** Lead tiles render every frame; the rest of a large wall rotates. */
  lead?: boolean;
}
interface Surface extends SensorSurface { context: CanvasRenderingContext2D; ready: boolean; frame: number; hudAt: number; settled: boolean }
interface Motion { clock: PresentationClock; filter: CameraFilter }

export interface WorldStats {
  fps: number; frameMs: number; views: number; draws: number; shadowViews: number; tris: number; trisPerView: number; maxViewTris: number;
  tiles: number; pending: number; genMsAvg: number; genMsMax: number; initMs: number; cacheMB: number; geometries: number; textures: number;
  agents: number; objects: number; longTasks: number; imagery: boolean; mode: 'wall' | 'full';
}

const RAD = 180 / Math.PI;
const THUMB: [number, number] = [384, 216], FULL: [number, number] = [960, 540];
const v = new THREE.Vector3();

/**
 * Shared three.js renderer for the six monitoring feeds. One WebGL context renders every visible camera into an
 * atlas, then copies each slot into its feed canvas. Same register() contract as the Cesium monitoring renderer.
 */
export class WorldRenderer {
  readonly hf: HeightField;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private uniforms = createWorldUniforms();
  private materials = createWorldMaterials(this.uniforms);
  private store: TileStore;
  private views = new Map<string, WorldView>();
  private sim: AgentSim;
  private agentMeshes: AgentMeshes;
  private sky = createSky(); private skyTruth = createSky(true);
  private sea = createSea(); private seaTruth = createSea(true);
  private rain = createRain();
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private fog = new THREE.FogExp2(0x888888, 0.0001);
  private post = new SensorPost();
  private rts = new Map<string, THREE.WebGLRenderTarget>();
  private truthRT: THREE.WebGLRenderTarget | null = null;
  private tileMask: THREE.DataTexture;
  private sampler: RasterSampler;
  private world;
  private surfaces = new Set<Surface>();
  private motion = new Map<string, Motion>();
  private poses = new Map<string, FeedPose>();
  private cadence = new PresentationCadence();
  private budget = new PresentationBudget();
  private raf = 0;
  private dead = false;
  private failed = false;
  private full = false;
  private costMs = 1;
  private envInput: EnvInput;
  private envAnchor = performance.now();
  private overrides: EnvOverrides = {};
  private envAt = -Infinity;
  private lastStep = NaN;
  private truthQueue: { feedId: string; resolve: (c: TruthCapture | null) => void }[] = [];
  private frames: number[] = [];
  private lastStats: WorldStats | null = null;
  private longTasks = 0;
  private shadowsReady = false;
  env!: WorldEnv;
  truthOverlay = false;
  onEnv: ((env: WorldEnv) => void) | null = null;

  private fire: FireLayer | null = null;
  private fireT = NaN;
  private cursor = 0;

  constructor(pack: ScenarioPack, clc: Uint16Array | null, env: EnvInput, opts: { fire?: boolean } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB[0] * 3; canvas.height = THUMB[1] * 2;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.renderer = new THREE.WebGLRenderer({ canvas, context: gl });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.info.autoReset = false;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.fail(); });

    this.sampler = new RasterSampler(pack);
    this.world = sensorWorld(pack);
    const source = buildSource(pack, clc, { scar: { lon: 23.952, lat: 38.04, r: 950 } });
    this.hf = new HeightField(source.grid);
    const f = this.hf.frame;
    source.sites = curatedSites(lon => f.x(lon), lat => f.z(lat));
    this.store = new TileStore(source, pack.imagery ? { url: new URL(pack.imagery.url, location.href).href, bbox: pack.imagery.bbox } : undefined, this.materials);
    this.store.onChange = () => { if (this.store.failed) this.fail(); else this.kick(); };
    this.sim = new AgentSim(this.hf);
    this.agentMeshes = new AgentMeshes(this.materials);
    if (opts.fire && pack.arrival?.length) {
      this.fire = new FireLayer(pack, this.hf, this.uniforms, fireTiming(getProfile(pack).activeMs));
      this.scene.add(this.fire.group);
    }

    this.tileMask = new THREE.DataTexture(new Uint8Array(f.tilesX * f.tilesZ), f.tilesX, f.tilesZ, THREE.RedFormat, THREE.UnsignedByteType);
    this.tileMask.magFilter = this.tileMask.minFilter = THREE.NearestFilter; this.tileMask.needsUpdate = true;
    this.uniforms.uTileMask.value = this.tileMask;
    this.uniforms.uTileGrid.value.set(f.xMin, f.zMin, f.tilesX, f.tilesZ);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 4000;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.store.farGroup, this.store.group, this.agentMeshes.group, this.sky, this.sea, this.rain);
    this.scene.fog = this.fog;
    this.scene.matrixWorldAutoUpdate = true;

    for (const feed of DEMO_FEEDS) this.motion.set(feed.id, { clock: new PresentationClock(), filter: new CameraFilter() });
    this.envInput = env;
    this.updateEnv(performance.now(), true);
    document.addEventListener('visibilitychange', this.visibility);
  }

  /* ------------------------------------------------ public API */

  register(input: SensorSurface) {
    const context = input.canvas.getContext('2d', { alpha: false });
    if (!context) { input.onError(); return { update: () => {}, dispose: () => {} }; }
    const surface: Surface = { ...input, context, ready: false, settled: false, frame: 0, hudAt: -Infinity };
    this.surfaces.add(surface);
    this.motionOf(input.feed.id).clock.suspend(performance.now());
    if (this.failed) input.onError();
    this.kick();
    return {
      update: (patch: Partial<Pick<SensorSurface, 'active' | 'visible' | 'moving' | 'frozen' | 'thermal' | 'lead'>>) => {
        if (Object.entries(patch).some(([key, value]) => surface[key as keyof SensorSurface] !== value)) this.motionOf(surface.feed.id).clock.suspend(performance.now());
        Object.assign(surface, patch); this.kick();
      },
      dispose: () => { this.surfaces.delete(surface); },
    };
  }

  /** Reconstructed fire at sim time (ms since manifest start). */
  setFireTime(tRel: number) { if (tRel !== this.fireT) { this.fireT = tRel; this.kickAll(); } }

  setEnv(input: EnvInput) { this.envInput = input; this.envAnchor = performance.now(); this.updateEnv(performance.now(), true); this.kickAll(); }
  setOverrides(o: EnvOverrides) { this.overrides = o; this.updateEnv(performance.now(), true); this.kickAll(); }
  get envOverrides() { return this.overrides; }

  /** Ground truth for the feed's current camera: per-pixel classes and flammability plus visible objects. */
  captureTruth(feedId: string): Promise<TruthCapture | null> {
    return new Promise(resolve => {
      if (!this.views.has(feedId) || this.failed) { resolve(null); return; }
      this.truthQueue.push({ feedId, resolve }); this.kick();
    });
  }

  stats(): WorldStats | null { return this.lastStats; }

  /* ------------------------------------------------ loop */

  private kickAll() { for (const s of this.surfaces) s.settled = false; this.kick(); }

  private visibility = () => {
    for (const m of this.motion.values()) m.clock.suspend(performance.now());
    this.cadence.reset(); this.lastStep = NaN;
    if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; } else this.kick();
  };

  private kick() {
    if (!this.raf && !this.dead && !this.failed && !document.hidden && this.surfaces.size) this.raf = requestAnimationFrame(this.step);
  }

  private updateEnv(now: number, force = false) {
    if (!force && now - this.envAt < 1000) return;
    this.envAt = now;
    const i = this.envInput;
    const t = i.live ? Date.now() : i.timeMs + (now - this.envAnchor);
    this.env = computeEnv({ ...i, timeMs: t }, this.overrides);
    this.onEnv?.(this.env);
  }

  private view(feedId: string) {
    let view = this.views.get(feedId);
    if (!view) { view = new WorldView(feedId, this.hf); this.views.set(feedId, view); this.scene.add(view.group); view.group.visible = false; }
    return view;
  }

  private step = (now: number) => {
    this.raf = 0;
    if (this.dead || this.failed || document.hidden) return;
    const t0 = performance.now();
    const shown = [...this.surfaces].filter(s => s.active && s.visible);
    const full = shown.find(s => s.full);
    const targets = full ? [full] : shown;
    for (const [id, state] of this.motion) state.clock.tick(now, targets.some(s => s.feed.id === id && s.moving));
    if (!targets.length) { this.lastStep = NaN; return; }
    if (this.full !== !!full) { this.full = !!full; this.cadence.reset(); }
    this.updateEnv(now);
    this.store.beginFrame();
    const groups = new Map<string, Surface[]>();
    for (const s of targets) groups.set(s.feed.id, [...(groups.get(s.feed.id) ?? []), s]);
    const viewH = full ? FULL[1] : THUMB[1];
    const quota = full ? 40 : Math.max(8, Math.floor((TILE_CACHE_CAP - 4) / groups.size));
    if (this.fire && Number.isFinite(this.fireT)) this.fire.setTime(this.fireT, now);
    for (const [id, surfaces] of groups) {
      const view = this.view(id), state = this.motionOf(id);
      const s0 = surfaces[0];
      const pose = s0.pose ? s0.pose(state.clock.seconds, state.filter) : demoPose(s0.feed, this.world, this.sampler, state.clock.seconds, state.filter);
      this.poses.set(id, pose);
      this.applyPose(view, pose);
      view.select(this.store, viewH, !full, quota);
      if (view.settled && !this.sim.areas.has(id)) {
        this.sim.populate({ id, x: view.focus.x, z: view.focus.z, r: view.air ? 500 : 220, air: view.air }, view.tiles.map(t => t.entry.data.spawns));
      }
    }
    this.store.dispatch();
    this.store.upload(full ? 3 : 2);
    // At most one batch rebuild per frame keeps uploads bounded; never-built views go first.
    const dirty = [...groups.keys()].map(id => this.views.get(id)!).filter(v => v.dirty);
    dirty.sort((a, b) => a.objectCount - b.objectCount);
    for (const v of dirty) if (v.rebuild(this.materials, now, v.objectCount === 0 && v.tiles.length > 0)) break;
    const dt = Number.isFinite(this.lastStep) ? (now - this.lastStep) / 1000 : 0;
    this.lastStep = now;
    const anyMoving = targets.some(s => s.moving && !s.frozen);
    const alpha = this.sim.update(anyMoving ? Math.min(0.25, dt) : 0, { daylight: this.env.daylight, rain: this.env.rain, windMs: this.env.windMs });

    // Large walls (FIREYE): lead tiles every frame, the others round-robin a few per frame.
    let render = groups;
    const MAX = 4;
    if (!full && groups.size > MAX) {
      const ids = [...groups.keys()];
      const lead = ids.filter(id => groups.get(id)!.some(s => s.lead));
      const rest = ids.filter(id => !lead.includes(id));
      const pick = new Set(lead);
      for (let k = 0; k < rest.length && pick.size < MAX; k++) pick.add(rest[(this.cursor + k) % rest.length]);
      this.cursor = (this.cursor + Math.max(1, MAX - lead.length)) % Math.max(1, rest.length);
      render = new Map(ids.filter(id => pick.has(id)).map(id => [id, groups.get(id)!]));
    }
    const fps = full ? 30 : this.budget.rate(now, this.costMs, render.size);
    if (this.cadence.due(now, fps)) {
      try { this.renderAll(render, alpha, now); } catch (e) { console.error(e); this.fail(); return; }
    }
    if (this.truthQueue.length) this.flushTruth();
    const spent = performance.now() - t0;
    if (spent > 50) this.longTasks++;
    this.kick();
  };

  private motionOf(id: string) {
    let m = this.motion.get(id);
    if (!m) { m = { clock: new PresentationClock(), filter: new CameraFilter() }; this.motion.set(id, m); }
    return m;
  }

  private applyPose(view: WorldView, pose: FeedPose) {
    const c = Cesium.Cartographic.fromCartesian(pose.position);
    const f = this.hf.frame, x = f.x(c.longitude * RAD), z = f.z(c.latitude * RAD);
    const cam = view.camera;
    cam.position.set(x, Math.max(c.height, this.hf.height(x, z) + 1.2), z);
    cam.rotation.set(pose.pitch, -pose.heading, -pose.roll, 'YXZ');
    const aspect = 16 / 9;
    cam.aspect = aspect;
    cam.fov = 2 * Math.atan(Math.tan(pose.fovDeg / RAD / 2) / aspect) * RAD;
    const agl = cam.position.y - this.hf.height(x, z);
    cam.near = agl > 120 ? 3 : 0.3; cam.far = 42000;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  private target(w: number, h: number) {
    const key = `${w}x${h}`;
    let rt = this.rts.get(key);
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, depthBuffer: true });
      rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
      this.rts.set(key, rt);
    }
    return rt;
  }

  private setFrameUniforms(time: number) {
    const e = this.env, U = this.uniforms;
    U.uTime.value = time;
    const k = 0.035 + 0.0045 * e.windMs;
    U.uWind.value.set(e.windX * k, e.windZ * k);
    U.uGust.value = e.gust;
    U.uCuring.value = e.curing; U.uLeaf.value = e.leaf; U.uWet.value = e.wet; U.uNight.value = e.night;
    const h = e.localHour;
    U.uWindows.value = h >= 17 || h < 1 ? 0.55 : h < 5.5 ? 0.1 : h < 8 ? 0.3 : 0.15;
    this.fog.color.setRGB(e.fogColor[0], e.fogColor[1], e.fogColor[2]);
    this.fog.density = e.fogDensity;
    updateSky(this.sky.material as THREE.ShaderMaterial, e, time);
    updateSky(this.skyTruth.material as THREE.ShaderMaterial, e, time);
    updateSea(this.sea.material as THREE.ShaderMaterial, e, time);
    updateRain(this.rain, e, time);
    const sunUp = e.sunEl > -3;
    const dir = sunUp ? e.sunDir : e.moonDir;
    this.sun.userData.dir = dir;
    if (sunUp) { this.sun.color.setRGB(e.sunColor[0], e.sunColor[1], e.sunColor[2]); this.sun.intensity = e.sunIntensity; }
    else { this.sun.color.setRGB(0.55, 0.62, 0.8); this.sun.intensity = e.moonEl > 0 ? e.moonIntensity * 2.5 : 0; }
    const sky = new THREE.Color(e.skyZenith[0] * 0.55 + e.skyHorizon[0] * 0.45, e.skyZenith[1] * 0.55 + e.skyHorizon[1] * 0.45, e.skyZenith[2] * 0.55 + e.skyHorizon[2] * 0.45);
    const m = Math.max(sky.r, sky.g, sky.b, 1e-4);
    this.hemi.color.setRGB(0.45 + 0.55 * sky.r / m, 0.45 + 0.55 * sky.g / m, 0.45 + 0.55 * sky.b / m);
    const g = Math.max(e.ground[0], e.ground[1], e.ground[2], 1e-4);
    this.hemi.groundColor.setRGB(e.ground[0] / g * 0.6, e.ground[1] / g * 0.6, e.ground[2] / g * 0.6);
    this.hemi.intensity = e.ambient * 2.2;
    const p = this.post.material.uniforms;
    p.uExposure.value = 0.92 * (1 + 2.6 * e.night) * (1 + 0.35 * e.cloud * e.daylight);
    p.uGrain.value = 0.012 + 0.05 * e.night + 0.01 * e.rain;
    p.uSat.value = 1.02 - 0.5 * e.night - 0.15 * e.rain;
    U.uDay.value = e.daylight;
    this.fire?.setEnv(e);
  }

  private placeLight(view: WorldView) {
    const dir = this.sun.userData.dir as [number, number, number];
    const half = view.air ? 450 : 110, f = view.focus;
    const cam = this.sun.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix();
    this.sun.position.set(f.x + dir[0] * 1800, f.y + Math.max(0.05, dir[1]) * 1800, f.z + dir[2] * 1800);
    this.sun.target.position.copy(f);
    this.sun.updateMatrixWorld(); this.sun.target.updateMatrixWorld();
  }

  private prepareView(view: WorldView) {
    for (const v2 of this.views.values()) v2.show(false);
    view.show(true);
    this.uniforms.uObjFar.value = view.objFar;
    this.store.farLod(view.camera.position.x, view.camera.position.z, view.air ? 4500 : 2500);
    this.tileMask.image.data!.set(view.mask);
    this.tileMask.needsUpdate = true;
  }

  private renderAll(groups: Map<string, Surface[]>, alpha: number, now: number) {
    const start = performance.now();
    const [w, h] = this.full ? FULL : THUMB;
    const ids = [...groups.keys()];
    const cols = this.full ? 1 : Math.min(3, ids.length), rows = Math.ceil(ids.length / cols);
    const cw = w * cols, ch = h * rows;
    const canvas = this.renderer.domElement;
    if (canvas.width !== cw || canvas.height !== ch) this.renderer.setSize(cw, ch, false);
    this.agentMeshes.write(this.sim, alpha);
    const time = now / 1000;
    this.setFrameUniforms(time);
    const info = this.renderer.info;
    info.reset();
    let shadowViews = 0, maxViewTris = 0;
    const rt = this.target(w, h);
    const rendered: { id: string; x: number; y: number; thermal: 'white' | 'iron' | undefined }[] = [];
    ids.forEach((id, i) => {
      const surfaces = groups.get(id)!, view = this.views.get(id)!;
      if (surfaces.every(s => s.ready && (s.frozen || (!s.moving && s.settled)))) return;
      if (!view.tiles.length || view.objectCount === 0 && view.dirty) return;
      this.prepareView(view);
      const thermal = surfaces[0].thermal;
      this.uniforms.uThermal.value = thermal ? 1 : 0;
      this.post.material.uniforms.uThermal.value = thermal === 'iron' ? 2 : thermal ? 1 : 0;
      if (this.fire) {
        const smoke = this.fire.smokeNear(view.camera.position.x, view.camera.position.z);
        this.fog.density = this.env.fogDensity * (1 + 5 * smoke);
        const k = smoke * 0.6, d = this.env.daylight;
        this.fog.color.setRGB(this.env.fogColor[0] * (1 - k) + k * 0.36 * d, this.env.fogColor[1] * (1 - k) + k * 0.3 * d, this.env.fogColor[2] * (1 - k) + k * 0.25 * d);
        this.fire.setFog(this.fog.density);
      }
      const shadows = this.full && this.env.sunEl > 1;
      this.sun.shadow.intensity = shadows ? 0.82 * (1 - 0.8 * this.env.cloud) : 0;
      this.placeLight(view);
      // The shadow map is refreshed only for the fullscreen camera; wall views keep the same programs with zero shadow intensity.
      if (shadows || !this.shadowsReady) { this.renderer.shadowMap.needsUpdate = true; this.shadowsReady = true; shadowViews++; }
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.scene, view.camera);
      const sx = (i % cols) * w, sy = Math.floor(i / cols) * h;
      this.renderer.setRenderTarget(null);
      this.renderer.setViewport(sx, ch - sy - h, w, h);
      this.post.material.uniforms.uTime.value = this.motionOf(id).clock.seconds;
      this.post.render(this.renderer, rt.texture, w, h);
      maxViewTris = Math.max(maxViewTris, view.tris);
      rendered.push({ id, x: sx, y: sy, thermal });
    });
    for (const r of rendered) {
      const surfaces = groups.get(r.id)!, view = this.views.get(r.id)!, pose = this.poses.get(r.id)!, seconds = this.motionOf(r.id).clock.seconds;
      for (const s of surfaces) {
        s.context.drawImage(canvas, r.x, r.y, w, h, 0, 0, s.canvas.width, s.canvas.height);
        s.canvas.dataset.frame = String(++s.frame);
        s.canvas.dataset.renderedAt = String(performance.now());
        s.canvas.dataset.simulationSeconds = String(seconds);
        s.canvas.dataset.world = 'world3d';
        s.canvas.dataset.ready = 'true';
        s.canvas.dataset.truthOverlay = String(!!this.truthOverlay);
        if (!this.truthOverlay) s.onPixels?.(r.thermal);
        s.settled = view.settled && !view.dirty && !this.store.pending;
        if (!s.ready) { s.ready = true; s.onReady(); }
        if (performance.now() - s.hudAt > 250) { s.hudAt = performance.now(); s.onTelemetry(pose, seconds); }
      }
    }
    if (this.truthOverlay && this.full && rendered.length) this.overlayTruth(rendered[0].id, groups.get(rendered[0].id)!, now);
    const spent = performance.now() - start;
    if (rendered.length) this.costMs = this.costMs * 0.9 + Math.max(0.1, spent / rendered.length) * 0.1;
    this.frames.push(now); while (this.frames.length && now - this.frames[0] > 2000) this.frames.shift();
    if (!rendered.length && this.lastStats) return;
    const totalTris = info.render.triangles;
    const gen = this.store.genMs;
    this.lastStats = {
      fps: this.frames.length > 1 ? (this.frames.length - 1) / ((now - this.frames[0]) / 1000) : 0, frameMs: spent,
      views: rendered.length, draws: info.render.calls, shadowViews, tris: totalTris, trisPerView: rendered.length ? totalTris / rendered.length : 0, maxViewTris,
      tiles: this.store.size, pending: this.store.pending, genMsAvg: gen.length ? gen.reduce((a, b) => a + b, 0) / gen.length : 0, genMsMax: gen.length ? Math.max(...gen) : 0,
      initMs: this.store.initMs, cacheMB: this.store.bytes() / 1048576, geometries: info.memory.geometries, textures: info.memory.textures,
      agents: this.agentMeshes.visible, objects: [...this.views.values()].reduce((s, v2) => s + v2.objectCount, 0), longTasks: this.longTasks, imagery: this.store.imagery, mode: this.full ? 'full' : 'wall',
    };
  }

  /* ------------------------------------------------ truth */

  private renderTruth(view: WorldView): Uint8Array {
    if (!this.truthRT) {
      this.truthRT = new THREE.WebGLRenderTarget(TRUTH_W, TRUTH_H, { type: THREE.UnsignedByteType, depthBuffer: true, samples: 0 });
      this.truthRT.texture.minFilter = this.truthRT.texture.magFilter = THREE.NearestFilter;
    }
    this.prepareView(view);
    const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    this.scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const t = this.materials.truthFor(mesh.material);
      if (t) { swapped.push([mesh, mesh.material]); mesh.material = t; }
    });
    const sea = this.sea.material, sky = this.sky.material;
    this.sea.material = this.seaTruth.material; this.sky.material = this.skyTruth.material;
    const rain = this.rain.visible; this.rain.visible = false;
    const intensity = this.sun.shadow.intensity; this.sun.shadow.intensity = 0;
    const clear = this.renderer.getClearColor(new THREE.Color()), clearA = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0xffffff, 1);
    this.renderer.setRenderTarget(this.truthRT);
    this.renderer.render(this.scene, view.camera);
    const buf = new Uint8Array(TRUTH_W * TRUTH_H * 4);
    this.renderer.readRenderTargetPixels(this.truthRT, 0, 0, TRUTH_W, TRUTH_H, buf);
    this.renderer.setRenderTarget(null);
    this.renderer.setClearColor(clear, clearA);
    for (const [mesh, m] of swapped) mesh.material = m;
    this.sea.material = sea; this.sky.material = sky; this.rain.visible = rain; this.sun.shadow.intensity = intensity;
    return buf;
  }

  private decode(feedId: string, buf: Uint8Array): TruthCapture {
    const view = this.views.get(feedId)!, cam = view.camera, f = this.hf.frame, pose = this.poses.get(feedId);
    const resolve = (id: number) => {
      if (id >= AGENT_ID_BASE) {
        const a = this.sim.agents[id - AGENT_ID_BASE];
        return a ? { archetype: a.species, position: [a.x, a.y, a.z] as [number, number, number] } : null;
      }
      const o = view.object(id);
      if (!o) return null;
      const m = o.ref.group.matrices, k = (o.ref.indices ? o.ref.indices[o.index] : o.index) * 16;
      return { archetype: o.ref.archetype, position: [m[k + 12], m[k + 13], m[k + 14]] as [number, number, number] };
    };
    cam.getWorldDirection(v);
    const e = this.env;
    return decodeTruth(feedId, buf, TRUTH_W, TRUTH_H, resolve, { t: e.t, curing: e.curing, dryness: e.dryness, wet: e.wet, leaf: e.leaf, season: e.season }, {
      position: [cam.position.x, cam.position.y, cam.position.z], lon: f.lon(cam.position.x), lat: f.lat(cam.position.z), altM: cam.position.y,
      headingDeg: pose?.headingDeg ?? 0, pitchDeg: Math.asin(v.y) * RAD, fovDeg: cam.fov,
    });
  }

  private flushTruth() {
    const jobs = this.truthQueue.splice(0);
    for (const job of jobs) {
      const view = this.views.get(job.feedId);
      if (!view || !view.tiles.length) { job.resolve(null); continue; }
      try { this.setFrameUniforms(performance.now() / 1000); job.resolve(this.decode(job.feedId, this.renderTruth(view))); } catch { job.resolve(null); }
    }
  }

  private overlayAt = 0;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayTruth(feedId: string, surfaces: Surface[], now: number) {
    const view = this.views.get(feedId)!;
    if (!this.overlayCanvas || now - this.overlayAt > 250) {
      this.overlayAt = now;
      const cap = this.decode(feedId, this.renderTruth(view));
      const c = this.overlayCanvas ?? (this.overlayCanvas = document.createElement('canvas'));
      c.width = TRUTH_W; c.height = TRUTH_H;
      const g = c.getContext('2d')!, img = g.createImageData(TRUTH_W, TRUTH_H);
      for (let i = 0; i < cap.classes.length; i++) {
        const col = CLASS_COLORS[cap.classes[i] as keyof typeof CLASS_COLORS] ?? [0, 0, 0];
        img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }
    for (const s of surfaces) { s.context.globalAlpha = 0.6; s.context.drawImage(this.overlayCanvas, 0, 0, s.canvas.width, s.canvas.height); s.context.globalAlpha = 1; }
  }

  /* ------------------------------------------------ teardown */

  private fail() {
    if (this.failed) return;
    this.failed = true; cancelAnimationFrame(this.raf); this.raf = 0;
    for (const s of this.surfaces) s.onError();
    for (const j of this.truthQueue.splice(0)) j.resolve(null);
  }

  destroy() {
    this.dead = true; cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.visibility);
    this.surfaces.clear();
    for (const view of this.views.values()) view.dispose();
    this.fire?.dispose();
    this.store.dispose(); this.agentMeshes.dispose(); this.materials.dispose(); this.post.dispose();
    for (const rt of this.rts.values()) rt.dispose();
    this.truthRT?.dispose(); this.tileMask.dispose();
    for (const m of [this.sky, this.skyTruth, this.sea, this.seaTruth, this.rain]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    disposeArchetypeGeometry();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
