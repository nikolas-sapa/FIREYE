import * as Cesium from 'cesium';
import { color } from '@ds';
import type { ScenarioPack } from '../contracts';
import type { DetailTerrain, DetailTile } from './feed-detail-worker';

/** One bounded worker and an 8 MiB canvas cache. No synchronous per-pixel work during camera rendering. */
export function createSensorDetail(pack: ScenarioPack) {
  const tilingScheme = new Cesium.GeographicTilingScheme();
  const rectangle = Cesium.Rectangle.fromDegrees(...pack.raster.bbox);
  const pending = new Map<string, { promise: Promise<HTMLCanvasElement>; resolve: (canvas: HTMLCanvasElement) => void }>();
  const cache = new Map<string, HTMLCanvasElement>();
  const worker = new Worker(new URL('./feed-detail-worker.ts', import.meta.url), { type: 'module' });
  const rgb = (hex: string) => { const c = Cesium.Color.fromCssColorString(hex); return [c.red * 255, c.green * 255, c.blue * 255]; };
  worker.postMessage({ fuel: pack.fuel, width: pack.raster.w, height: pack.raster.h, bbox: pack.raster.bbox,
    ink: rgb(color.void), bone: rgb(color.bone.DEFAULT) } satisfies DetailTerrain);
  let dead = false;
  const blank = () => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256; return canvas; };
  worker.onmessage = (event: MessageEvent<{ id: string; pixels: Uint8ClampedArray<ArrayBuffer> }>) => {
    if (dead) return;
    const job = pending.get(event.data.id);
    if (!job) return;
    const canvas = blank();
    canvas.getContext('2d')!.putImageData(new ImageData(event.data.pixels, 256, 256), 0, 0);
    cache.set(event.data.id, canvas);
    if (cache.size > 32) cache.delete(cache.keys().next().value!);
    pending.delete(event.data.id); job.resolve(canvas);
  };
  const dispose = () => {
    dead = true; worker.terminate();
    for (const job of pending.values()) job.resolve(blank());
    pending.clear(); cache.clear();
  };
  worker.onerror = dispose;
  const provider = {
    tilingScheme, rectangle, tileWidth: 256, tileHeight: 256, minimumLevel: 0, maximumLevel: 19,
    tileDiscardPolicy: undefined, errorEvent: new Cesium.Event(), credit: undefined, proxy: undefined, hasAlphaChannel: true,
    getTileCredits: () => undefined, pickFeatures: () => undefined,
    requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> | HTMLCanvasElement | undefined {
      if (dead || level < 12) return blank();
      const id = `${level}/${x}/${y}`;
      const cached = cache.get(id);
      if (cached) { cache.delete(id); cache.set(id, cached); return cached; }
      if (pending.has(id)) return pending.get(id)!.promise;
      if (pending.size >= 32) return undefined; // Cesium retries later, no unbounded worker queue.
      let resolve!: (canvas: HTMLCanvasElement) => void;
      const promise = new Promise<HTMLCanvasElement>(r => { resolve = r; });
      pending.set(id, { promise, resolve });
      const rect = tilingScheme.tileXYToRectangle(x, y, level), deg = Math.PI / 180;
      worker.postMessage({ id, bbox: [rect.west / deg, rect.south / deg, rect.east / deg, rect.north / deg], level } satisfies DetailTile);
      return promise;
    },
  };
  const layer = new Cesium.ImageryLayer(provider as unknown as Cesium.ImageryProvider, { minimumTerrainLevel: 12, rectangle });
  return { layer, dispose, idle: () => pending.size === 0 };
}
