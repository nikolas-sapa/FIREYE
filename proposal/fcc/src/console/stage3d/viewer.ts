import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { ScenarioPack } from '../contracts';
import { getStageCapabilities } from './capabilities';
import { pal } from './palette';
import { getProfile } from './profile';
import { RasterSampler } from './raster';
import { daylight, sunEnu, sunPosition } from './sun';
import { createDetailLayer, createGibsContext, createHeightmapTerrain, getComposite } from './terrain';
import type { StageBasemap } from './types';

let ionConfigured = false;
function configureIon() {
  if (ionConfigured) return;
  ionConfigured = true;
  const tok = import.meta.env.VITE_CESIUM_ION_TOKEN;
  // Without a token, keep Cesium from defaulting to ion assets (and from logging the default-token banner).
  if (tok) Cesium.Ion.defaultAccessToken = tok;
  const g = import.meta.env.VITE_GOOGLE_MAPS_KEY;
  if (g) Cesium.GoogleMaps.defaultApiKey = g;
}

export interface ViewerOptions {
  creditContainer?: HTMLElement;
  msaa?: number;
  preserveDrawingBuffer?: boolean;
  useDefaultRenderLoop?: boolean;
}

/** A Cesium Viewer with every widget off and the dark ops scene grade applied. */
export function createDarkViewer(container: HTMLElement, o: ViewerOptions = {}): Cesium.Viewer {
  configureIon();
  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    animation: false,
    timeline: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true,
    scene3DOnly: true,
    skyBox: false,
    msaaSamples: o.msaa ?? 4,
    creditContainer: o.creditContainer,
    useDefaultRenderLoop: o.useDefaultRenderLoop ?? true,
    contextOptions: { webgl: { preserveDrawingBuffer: !!o.preserveDrawingBuffer, alpha: false, powerPreference: 'high-performance' } },
  });
  const scene = viewer.scene;
  scene.backgroundColor = pal.void;
  if (scene.sun) scene.sun.show = false;
  if (scene.moon) scene.moon.show = false;
  if (scene.skyAtmosphere) {
    scene.skyAtmosphere.show = true;
    scene.skyAtmosphere.brightnessShift = -0.78;
    scene.skyAtmosphere.saturationShift = -0.85;
    scene.skyAtmosphere.hueShift = 0;
  }
  const globe = scene.globe;
  globe.baseColor = pal.ink950;
  globe.showGroundAtmosphere = false;
  globe.enableLighting = false;
  globe.depthTestAgainstTerrain = true;
  globe.tileCacheSize = 400;
  globe.preloadSiblings = true;
  scene.fog.enabled = true;
  scene.fog.density = 1.6e-4;
  scene.fog.minimumBrightness = 0.02;
  scene.highDynamicRange = false;
  const ctrl = scene.screenSpaceCameraController;
  ctrl.minimumZoomDistance = 120;
  ctrl.maximumZoomDistance = 260000;
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  return viewer;
}

export interface BasemapResult {
  basemap: StageBasemap;
  exaggeration: number;
  tileset?: Cesium.Cesium3DTileset;
}

/**
 * Configure terrain + imagery. Google key → photorealistic 3D tiles (globe hidden); ion token →
 * Cesium World Terrain + Bing aerial via ion; neither → heightmap from the pack + baked relief composite.
 * Any failure in a token path falls back to offline.
 */
export async function setupBasemap(
  viewer: Cesium.Viewer,
  pack: ScenarioPack,
  s: RasterSampler,
  /** gibs: add NASA GIBS VIIRS context outside the bbox (network; off by default to stay offline). */
  o: { gibs?: boolean; forceOffline?: boolean } = {},
): Promise<BasemapResult> {
  const caps = getStageCapabilities();
  const scene = viewer.scene;
  const isDead = () => viewer.isDestroyed();

  const exag = getProfile(pack).exaggeration;
  const offline = async (): Promise<BasemapResult> => {
    s.datumOffset = 0;
    scene.verticalExaggeration = exag;
    viewer.terrainProvider = createHeightmapTerrain(s);
    if (o.gibs === true) {
      try {
        const date = pack.imagery?.date?.slice(0, 10) || new Date(pack.manifest.start).toISOString().slice(0, 10);
        const ctx = new Cesium.ImageryLayer(createGibsContext(date), { brightness: 0.42, contrast: 1.15, saturation: 0.25, gamma: 1.1 });
        viewer.imageryLayers.add(ctx);
      } catch {
        /* GIBS optional */
      }
    }
    const comp = await getComposite(pack, s);
    if (isDead()) return { basemap: 'offline', exaggeration: exag };
    const prov = await Cesium.SingleTileImageryProvider.fromUrl(comp.url, {
      rectangle: comp.rectangle,
      credit: new Cesium.Credit(pack.imagery ? `Imagery: ${pack.imagery.source}` : 'Relief: scenario DEM + fuels'),
    });
    if (isDead()) return { basemap: 'offline', exaggeration: exag };
    viewer.imageryLayers.add(new Cesium.ImageryLayer(prov, { rectangle: comp.rectangle, brightness: 1.0, contrast: 1.08, saturation: comp.base === 'imagery' ? 0.55 : 0.9, gamma: 1.0 }));
    viewer.imageryLayers.add(createDetailLayer(pack, s));
    return { basemap: 'offline', exaggeration: exag };
  };

  if (o.forceOffline) return offline();

  if (caps.google) {
    try {
      viewer.terrainProvider = createHeightmapTerrain(s);
      const tileset = await Cesium.createGooglePhotorealistic3DTileset(
        { key: import.meta.env.VITE_GOOGLE_MAPS_KEY, onlyUsingWithGoogleGeocoder: true },
        { maximumScreenSpaceError: 12, showCreditsOnScreen: true },
      );
      if (isDead()) return { basemap: 'google-3d', exaggeration: 1 };
      scene.primitives.add(tileset);
      // Photorealistic tiles are ellipsoid heights; calibrate the pack DEM against ion terrain when available.
      if (caps.cesium) {
        try {
          await calibrateDatum(await Cesium.CesiumTerrainProvider.fromIonAssetId(1), s);
        } catch {
          /* keep DEM heights */
        }
      }
      // Per Cesium guidance the globe is hidden under photorealistic tiles; ground primitives classify the mesh.
      scene.globe.show = false;
      scene.verticalExaggeration = 1;
      return { basemap: 'google-3d', exaggeration: 1, tileset };
    } catch (err) {
      console.warn('[stage3d] Google 3D tiles unavailable, falling back', err);
    }
  }
  if (caps.cesium) {
    try {
      const terrain = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, { requestVertexNormals: true, requestWaterMask: false });
      const imagery = await Cesium.IonImageryProvider.fromAssetId(2);
      if (isDead()) return { basemap: 'ion-world', exaggeration: exag };
      viewer.terrainProvider = terrain;
      viewer.imageryLayers.add(new Cesium.ImageryLayer(imagery, { brightness: 0.92, contrast: 1.1, saturation: 0.72, gamma: 1.02 }));
      scene.verticalExaggeration = exag;
      scene.globe.enableLighting = true;
      // The ion water mask is coarse in distant tiles: its specular lobe shows a serrated, tile-stepped rim
      // offshore and the animated normal map bands. The atmosphere pass adds sea glint from the pack mask instead.
      scene.globe.showWaterEffect = false;
      scene.globe.dynamicAtmosphereLighting = false;
      await calibrateDatum(terrain, s);
      return { basemap: 'ion-world', exaggeration: exag };
    } catch (err) {
      console.warn('[stage3d] Cesium ion unavailable, falling back', err);
    }
  }
  return offline();
}

/**
 * The pack DEM is orthometric (height above the geoid); ion terrain and Google tiles are ellipsoid heights.
 * Sample both at a few points and shift the sampler so overlays sit on the streamed surface.
 */
async function calibrateDatum(terrain: Cesium.TerrainProvider, s: RasterSampler) {
  const [w, so, e, n] = s.bbox;
  const pts: [number, number][] = [];
  for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) pts.push([w + ((e - w) * i) / 4, so + ((n - so) * j) / 4]);
  const cartos = pts.map(([lon, lat]) => Cesium.Cartographic.fromDegrees(lon, lat));
  try {
    const res = await Cesium.sampleTerrainMostDetailed(terrain, cartos);
    const d = res
      .map((c, i) => c.height - s.demElevation(pts[i][0], pts[i][1]))
      .filter((v) => Number.isFinite(v))
      .sort((x, y) => x - y);
    if (d.length) {
      const m = d[Math.floor(d.length / 2)];
      // Geoid undulation is within about +-110 m anywhere; anything larger means a sampling failure.
      if (Math.abs(m) < 120) s.datumOffset = m;
    }
  } catch {
    /* keep DEM heights */
  }
}

/** Scene light from the real solar position at replay time t (warm and dim near the horizon, moonlight at night). */
export function applySunLight(scene: Cesium.Scene, pack: ScenarioPack, t: number) {
  const c = getProfile(pack).center;
  const el = sunPosition(t, c.lat, c.lon).elDeg;
  let [x, y, z] = sunEnu(t, c.lat, c.lon);
  const day = daylight(el);
  if (el < 4) {
    // Below a few degrees the terrain would be black; keep a low fill from the same azimuth.
    const h = Math.hypot(x, y) || 1;
    const fz = Math.sin((day > 0.05 ? 4 + 8 * (1 - Math.max(0, el) / 4) : 30) * Math.PI / 180);
    x = (x / h) * Math.sqrt(1 - fz * fz); y = (y / h) * Math.sqrt(1 - fz * fz); z = fz;
  }
  const center = Cesium.Cartesian3.fromDegrees(c.lon, c.lat);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  const dir = Cesium.Matrix4.multiplyByPointAsVector(enu, new Cesium.Cartesian3(-x, -y, -z), new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(dir, dir);
  // Air-mass reddening: low sun loses blue first.
  const low = 1 - Math.min(1, Math.max(0, el) / 25);
  const col = day > 0.05
    ? new Cesium.Color(1, 1 - 0.22 * low, 1 - 0.48 * low, 1)
    : new Cesium.Color(0.55, 0.62, 0.8, 1);
  const intensity = day > 0.05 ? 0.9 + 1.4 * day : 0.45;
  if (scene.light instanceof Cesium.DirectionalLight) {
    scene.light.direction = dir;
    scene.light.color = col;
    scene.light.intensity = intensity;
  } else {
    scene.light = new Cesium.DirectionalLight({ direction: dir, color: col, intensity });
  }
}
