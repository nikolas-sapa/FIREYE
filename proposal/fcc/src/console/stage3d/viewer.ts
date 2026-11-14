import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import type { ScenarioPack } from '../contracts';
import { getStageCapabilities } from './capabilities';
import { pal } from './palette';
import { RasterSampler, DEG2RAD } from './raster';
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

export const OFFLINE_EXAGGERATION = 1.3;

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

  const offline = async (): Promise<BasemapResult> => {
    scene.verticalExaggeration = OFFLINE_EXAGGERATION;
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
    if (isDead()) return { basemap: 'offline', exaggeration: OFFLINE_EXAGGERATION };
    const prov = await Cesium.SingleTileImageryProvider.fromUrl(comp.url, {
      rectangle: comp.rectangle,
      credit: new Cesium.Credit(pack.imagery ? `Imagery: ${pack.imagery.source}` : 'Relief: scenario DEM + fuels'),
    });
    if (isDead()) return { basemap: 'offline', exaggeration: OFFLINE_EXAGGERATION };
    viewer.imageryLayers.add(new Cesium.ImageryLayer(prov, { rectangle: comp.rectangle, brightness: 1.0, contrast: 1.08, saturation: comp.base === 'imagery' ? 0.55 : 0.9, gamma: 1.0 }));
    viewer.imageryLayers.add(createDetailLayer(pack, s));
    return { basemap: 'offline', exaggeration: OFFLINE_EXAGGERATION };
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
      const terrain = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, { requestVertexNormals: true });
      const imagery = await Cesium.IonImageryProvider.fromAssetId(2);
      if (isDead()) return { basemap: 'ion-world', exaggeration: 1 };
      viewer.terrainProvider = terrain;
      viewer.imageryLayers.add(new Cesium.ImageryLayer(imagery, { brightness: 0.78, contrast: 1.12, saturation: 0.45, gamma: 1.05 }));
      scene.verticalExaggeration = 1;
      scene.globe.enableLighting = true;
      // Fixed low NW key light so relief reads regardless of replay hour.
      const c = s.bbox;
      const center = Cesium.Cartesian3.fromDegrees((c[0] + c[2]) / 2, (c[1] + c[3]) / 2);
      const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
      const az = 315 * DEG2RAD, el = 35 * DEG2RAD;
      const local = new Cesium.Cartesian3(-Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), -Math.sin(el));
      const dir = Cesium.Matrix4.multiplyByPointAsVector(enu, local, new Cesium.Cartesian3());
      scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.normalize(dir, dir), intensity: 2.2 });
      return { basemap: 'ion-world', exaggeration: 1 };
    } catch (err) {
      console.warn('[stage3d] Cesium ion unavailable, falling back', err);
    }
  }
  return offline();
}
