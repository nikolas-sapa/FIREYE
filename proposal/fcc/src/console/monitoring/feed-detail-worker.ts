import { FuelClass, type BBox } from '../contracts';

export interface DetailTerrain { fuel: Uint8Array; width: number; height: number; bbox: BBox; ink: number[]; bone: number[] }
export interface DetailTile { id: string; bbox: BBox; level: number }
const size = 256;
const DEG = Math.PI / 180;
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ h >>> 13) * 1274126177;
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v)
    + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v;
}

/** Pixel-identical legacy canopy/grain calculation, moved off the rendering thread. */
export function detailPixels(terrain: DetailTerrain, tile: DetailTile) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  if (tile.level < 12) return pixels;
  const [w, s, e, n] = terrain.bbox, [west, south, east, north] = tile.bbox;
  const mLon = 111320 * Math.cos((s + n) / 2 * DEG), mLat = 110540;
  for (let py = 0; py < size; py++) {
    const lat = north - (py + 0.5) / size * (north - south), my = lat * mLat;
    for (let px = 0; px < size; px++) {
      const lon = west + (px + 0.5) / size * (east - west);
      const x = Math.floor((lon - w) / ((e - w) / terrain.width));
      const y = Math.floor((n - lat) / ((n - s) / terrain.height));
      if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) continue;
      const fuel = terrain.fuel[y * terrain.width + x], mx = lon * mLon;
      let dark = 0, light = 0;
      if (fuel === FuelClass.TimberLitter || fuel === FuelClass.TimberUnderstory) {
        const v = noise(mx / 6.5, my / 6.5) * 0.7 + noise(mx / 2.1, my / 2.1) * 0.3;
        dark = Math.max(0, (v - 0.42) * 1.6) * 0.75; light = Math.max(0, (0.3 - v) * 1.2) * 0.25;
      } else if (fuel === FuelClass.Shrub) {
        const v = noise(mx / 2.6, my / 2.6);
        dark = Math.max(0, (v - 0.5) * 1.4) * 0.5; light = Math.max(0, 0.25 - v) * 0.3;
      } else if (fuel === FuelClass.Grass || fuel === FuelClass.Agriculture || fuel === FuelClass.None) {
        const v = hash(Math.floor(mx * 1.5), Math.floor(my * 1.5));
        dark = v > 0.7 ? (v - 0.7) * 0.9 : 0; light = v < 0.12 ? (0.12 - v) * 1.6 : 0;
      } else if (fuel === FuelClass.Rock) dark = Math.max(0, noise(mx / 1.3, my / 1.3) - 0.6) * 0.6;
      const rgb = light > dark ? terrain.bone : terrain.ink, offset = (py * size + px) * 4;
      pixels[offset] = rgb[0]; pixels[offset + 1] = rgb[1]; pixels[offset + 2] = rgb[2];
      pixels[offset + 3] = Math.min(255, Math.max(light, dark) * 255);
    }
  }
  return pixels;
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  let terrain: DetailTerrain;
  self.onmessage = (event: MessageEvent<DetailTerrain | DetailTile>) => {
    if ('fuel' in event.data) { terrain = event.data; return; }
    const pixels = detailPixels(terrain, event.data);
    self.postMessage({ id: event.data.id, pixels }, { transfer: [pixels.buffer] });
  };
}
