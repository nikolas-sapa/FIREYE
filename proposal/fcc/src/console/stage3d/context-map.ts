import * as Cesium from 'cesium';
import { font } from '@ds';
import { DARK_SURFACES, LIGHT_SURFACES, contrast, mix } from '../../design-system/tokens/appearance-palette';
import type { MapSettings } from './map-settings';
import { readVectorTile, type TileLayer } from './vector-tile';
import { drawTile } from './cartography-paint';
import { ContextRasterizer } from './context-rasterizer';
import type { Geo } from '../contracts';

const TILEJSON = 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v2/tiles.json';
const CREDIT = new Cesium.Credit('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · © <a href="https://carto.com/attributions">CARTO</a>', true);

/** One network/decode cache shared by the dark/light rasterizations. No persistent provider cache. */
class TileSource {
  private cache = new Map<string, Promise<TileLayer[]>>();
  private requests = new Set<AbortController>();
  dead = false;
  constructor(private template: string, private failed: () => void) {}
  get(x: number, y: number, z: number) {
    if (this.dead) return undefined;
    const key = `${z}/${x}/${y}`;
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return hit; }
    // The four raster consumers share this request. Removing one imagery layer must not cancel
    // the other consumers or leave a cached blank tile during rapid layer/mode switches.
    if (this.requests.size >= 4) return undefined;
    const request = new AbortController();
    this.requests.add(request);
    const timeout = window.setTimeout(() => request.abort(), 12000);
    const pending = fetch(this.template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), { signal: request.signal })
      .then((response) => {
        if (!response.ok || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('Context tile unavailable');
        return response.arrayBuffer();
      });
    const result = pending.then((data) => {
      if (!data) throw new Error('Empty vector tile');
      return this.dead ? [] : readVectorTile(data);
    }).catch(() => {
      this.cache.delete(key);
      if (!this.dead) this.failed();
      return [];
    }).finally(() => { window.clearTimeout(timeout); this.requests.delete(request); });
    this.cache.set(key, result);
    while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }
  destroy() {
    this.dead = true;
    for (const request of this.requests) request.abort();
    this.requests.clear(); this.cache.clear();
  }
}

export class ContextMap {
  private source?: TileSource;
  private rasterizer?: ContextRasterizer;
  private layers: Cesium.ImageryLayer[] = [];
  private template = '';
  private generation = 0;
  private key = '';
  private failed = false;
  private disposed = false;
  private enabled = false;
  private loading?: AbortController;
  private allowed = new URLSearchParams(location.search).get('context') !== '0'
    && (new URLSearchParams(location.search).get('tokens') !== '0' || new URLSearchParams(location.search).get('context') === '1');
  private online = () => {
    this.failed = false; this.key = '';
    if (!this.template) this.enabled = false;
    if (this.rasterizer?.isDestroyed) this.createRasterizer();
  };
  get active() { return this.allowed && !!this.template && !this.failed && navigator.onLine; }
  constructor(private viewer: Cesium.Viewer, private localNames: Set<string>, private localPlaces: Geo[]) {
    window.addEventListener('online', this.online);
    this.createRasterizer();
  }
  private createRasterizer() {
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      try { this.rasterizer = new ContextRasterizer(() => { if (!this.disposed) this.failed = true; }); }
      catch { this.rasterizer = undefined; }
    }
  }
  private async start() {
    this.enabled = true;
    const controller = new AbortController();
    this.loading = controller;
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(TILEJSON, { signal: controller.signal });
      if (!response.ok) throw new Error('Map context unavailable');
      const json = await response.json();
      // Do not let remote metadata redirect requests to arbitrary origins.
      const template = String(json.tiles?.[0] ?? '');
      if (!/^https:\/\/tiles\.basemaps\.cartocdn\.com\/.*\{z\}\/\{x\}\/\{y\}\.mvt$/.test(template)) throw new Error('Unsupported context source');
      if (!this.disposed) this.template = template;
    } catch { if (!this.disposed) this.failed = true; }
    finally { window.clearTimeout(timeout); this.loading = undefined; }
  }
  owns(layer: Cesium.ImageryLayer) { return this.layers.includes(layer); }
  apply(on: boolean, settings: MapSettings, blend: number) {
    if (on && this.allowed && !this.enabled) void this.start();
    const active = on && this.active;
    const key = `${settings.layers.roads}/${settings.layers.buildings}/${settings.layers.places}/${font.mono}`;
    if (active && this.key !== key) {
      this.key = key;
      const generation = ++this.generation;
      for (const layer of this.layers) this.viewer.imageryLayers.remove(layer);
      if (!this.rasterizer && !this.source) this.source = new TileSource(this.template, () => {
        if (!this.disposed) this.failed = true;
      });
      this.layers = [false, false, true, true].map((labelsOnly, i) => {
        const light = i % 2 === 1;
        const provider = new Cesium.UrlTemplateImageryProvider({
          // One overzoom above source z15, at 2× raster density. Bound leaf-tile texture fan-out.
          url: this.template, maximumLevel: 16, tileWidth: 256, tileHeight: 256, credit: CREDIT,
          enablePickFeatures: false,
        });
        const mono = font.mono, snapshot = { ...settings, layers: { ...settings.layers } };
        provider.requestImage = (x, y, z) => {
          const dataZ = Math.min(z, 15), over = 2 ** (z - dataZ);
          const localPoints = this.localPlaces.map(({ lon, lat }) => [
            ((lon + 180) / 360 * 2 ** z - x) * 256,
            ((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z - y) * 256,
          ]);
          if (this.rasterizer) return this.rasterizer.paint({
            url: this.template.replace('{z}', String(dataZ)).replace('{x}', String(Math.floor(x / over))).replace('{y}', String(Math.floor(y / over))),
            light, labelsOnly, settings: snapshot, z, ox: x % over, oy: y % over, over, mono, localNames: [...this.localNames], localPoints,
          });
          const data = this.source!.get(Math.floor(x / over), Math.floor(y / over), dataZ);
          return data?.then((layers) => drawTile(this.disposed || generation !== this.generation ? [] : layers,
            light, labelsOnly, snapshot, z, x % over, y % over, over, mono, this.localNames, localPoints) as HTMLCanvasElement);
        };
        return this.viewer.imageryLayers.addImageryProvider(provider);
      });
    }
    const bg = mix(DARK_SURFACES['ink-950'], LIGHT_SURFACES['ink-950'], blend);
    const lightLabels = contrast(LIGHT_SURFACES.bone, bg) > contrast(DARK_SURFACES.bone, bg);
    this.layers.forEach((layer, i) => {
      layer.show = active;
      // Keep label/halo contrast through twilight instead of crossfading text into its background.
      layer.alpha = i === 0 ? 1 : i === 1 ? blend : i === 2 ? (lightLabels ? 0 : 1) : (lightLabels ? 1 : 0);
    });
  }
  destroy() {
    this.disposed = true;
    this.loading?.abort();
    window.removeEventListener('online', this.online);
    this.source?.destroy();
    this.rasterizer?.destroy();
    if (!this.viewer.isDestroyed()) for (const layer of this.layers) this.viewer.imageryLayers.remove(layer);
    this.layers = [];
  }
}
