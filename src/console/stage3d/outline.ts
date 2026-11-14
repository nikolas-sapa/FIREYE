import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import { FuelClass, type ScenarioPack } from '../contracts';
import { getProfile } from './profile';
import type { RasterSampler } from './raster';
import { createHeightmapTerrain } from './terrain';
import type { MapSettings } from './map-settings';

type Detail = 'relief' | 'contours' | 'roads' | 'buildings';

/** A true DEM surface, not desaturated satellite pixels. Detail layers remain independently hideable. */
export class OutlineMap {
  readonly terrain: Cesium.TerrainProvider;
  readonly layers: Record<Detail, Cesium.ImageryLayer>;
  readonly contourM: number;
  private urls: string[] = [];

  private constructor(private viewer: Cesium.Viewer, s: RasterSampler, layers: Record<Detail, Cesium.ImageryLayer>, contourM: number, urls: string[]) {
    this.terrain = createHeightmapTerrain(s, true);
    this.layers = layers;
    this.contourM = contourM;
    this.urls = urls;
  }

  static async create(viewer: Cesium.Viewer, pack: ScenarioPack, s: RasterSampler): Promise<OutlineMap> {
    const { w, h, bbox, cellM } = pack.raster;
    const W = Math.min(1536, w * 2), H = Math.max(1, Math.round(W * h / w));
    const make = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
    const canvases = { relief: make(), contours: make(), roads: make(), buildings: make() };
    const g = canvases.relief.getContext('2d')!, cg = canvases.contours.getContext('2d')!;
    const img = g.createImageData(W, H), contours = cg.createImageData(W, H);
    const prof = getProfile(pack), step = prof.contourM;
    const pixel = (x: number, y: number) => Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x));
    const lo = prof.minElev, range = Math.max(1, prof.maxElev - lo);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.floor(x * w / W)), sy = Math.min(h - 1, Math.floor(y * h / H));
      const i = pixel(sx, sy), e = pack.elevation[i], wet = pack.fuel[i] === FuelClass.Water;
      const dx = (pack.elevation[pixel(sx + 1, sy)] - pack.elevation[pixel(sx - 1, sy)]) / (2 * cellM);
      const dy = (pack.elevation[pixel(sx, sy + 1)] - pack.elevation[pixel(sx, sy - 1)]) / (2 * cellM);
      const hill = Math.max(-1, Math.min(1, (-dx + dy + 0.8) / Math.hypot(dx, dy, 1)));
      // Cesium can sample a regional image's edge outside its rectangle. Constant edge texels
      // prevent long radial streaks beyond the cached area, without inventing terrain detail.
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      const k = Math.min(1, edge / (Math.min(W, H) * 0.025));
      const fade = k * k * (3 - 2 * k);
      const grey = 15 + ((wet ? 15 : 30 + 16 * (e - lo) / range + 17 * hill) - 15) * fade;
      const o = (y * W + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = grey;
      img.data[o + 3] = 255;
      const band = Math.floor(e / step);
      const left = pixel(Math.floor(Math.max(0, x - 1) * w / W), sy);
      const up = pixel(sx, Math.floor(Math.max(0, y - 1) * h / H));
      const coast = (pack.fuel[left] === FuelClass.Water) !== wet || (pack.fuel[up] === FuelClass.Water) !== wet;
      const contour = !wet && (Math.floor(pack.elevation[left] / step) !== band || Math.floor(pack.elevation[up] / step) !== band);
      if (coast || contour) {
        contours.data[o] = contours.data[o + 1] = contours.data[o + 2] = 220;
        contours.data[o + 3] = (coast ? 170 : band % 5 === 0 ? 100 : 42) * fade;
      }
    }
    g.putImageData(img, 0, 0);
    cg.putImageData(contours, 0, 0);
    const X = (lon: number) => (lon - bbox[0]) / (bbox[2] - bbox[0]) * W;
    const Y = (lat: number) => (bbox[3] - lat) / (bbox[3] - bbox[1]) * H;
    const roads = canvases.roads.getContext('2d')!;
    roads.strokeStyle = ds.bone.dim;
    roads.lineJoin = 'round';
    for (const road of pack.roads) {
      if (road.coords.length < 2 || road.kind === 'track') continue;
      roads.globalAlpha = road.kind === 'highway' ? 0.65 : 0.25;
      roads.lineWidth = road.kind === 'highway' ? 1.6 : 0.7;
      roads.beginPath();
      road.coords.forEach((p, i) => i ? roads.lineTo(X(p.lon), Y(p.lat)) : roads.moveTo(X(p.lon), Y(p.lat)));
      roads.stroke();
    }
    const buildings = canvases.buildings.getContext('2d')!;
    buildings.strokeStyle = ds.bone.dim;
    buildings.globalAlpha = 0.45;
    buildings.lineWidth = 0.7;
    const groundW = (bbox[2] - bbox[0]) * 111320 * Math.cos((bbox[1] + bbox[3]) * Math.PI / 360);
    for (const b of pack.buildings) {
      const size = Math.max(1.2, 9 / groundW * W);
      buildings.strokeRect(X(b.pos.lon) - size / 2, Y(b.pos.lat) - size / 2, size, size);
    }
    for (const key of ['contours', 'roads', 'buildings'] as const) {
      const ctx = canvases[key].getContext('2d')!;
      ctx.clearRect(0, 0, W, 3); ctx.clearRect(0, H - 3, W, 3);
      ctx.clearRect(0, 0, 3, H); ctx.clearRect(W - 3, 0, 3, H);
    }
    const rectangle = Cesium.Rectangle.fromDegrees(...bbox);
    const entries = await Promise.all((Object.keys(canvases) as Detail[]).map(async (key) => {
      const blob = await new Promise<Blob>((resolve, reject) => canvases[key].toBlob((b) => b ? resolve(b) : reject(new Error('Outline image unavailable'))));
      const url = URL.createObjectURL(blob);
      const provider = await Cesium.SingleTileImageryProvider.fromUrl(url, { rectangle, credit: key === 'relief' ? new Cesium.Credit('Outline · scenario DEM / current OSM · building marks approximate') : undefined });
      return { key, url, layer: new Cesium.ImageryLayer(provider, { rectangle, show: false }) };
    }));
    const layers = Object.fromEntries(entries.map(({ key, layer }) => [key, layer])) as Record<Detail, Cesium.ImageryLayer>;
    if (viewer.isDestroyed()) {
      entries.forEach(({ url }) => URL.revokeObjectURL(url));
      throw new Error('Stage closed');
    }
    for (const { layer } of entries) viewer.imageryLayers.add(layer);
    return new OutlineMap(viewer, s, layers, step, entries.map(({ url }) => url));
  }

  apply(settings: MapSettings, day: number) {
    const on = settings.mode === 'outline';
    this.layers.relief.show = on;
    this.layers.relief.brightness = 0.50 + 0.50 * day;
    for (const key of ['contours', 'roads', 'buildings'] as const) this.layers[key].show = on && settings.layers[key];
  }
  owns(layer: Cesium.ImageryLayer) { return Object.values(this.layers).includes(layer); }
  destroy() {
    for (const layer of Object.values(this.layers)) this.viewer.imageryLayers.remove(layer, true);
    for (const url of this.urls) URL.revokeObjectURL(url);
  }
}
