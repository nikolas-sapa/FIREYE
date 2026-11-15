import { drawTile, type TilePaintJob } from './cartography-paint';
import { readVectorTile, type TileLayer } from './vector-tile';
import fccFont from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url';
import teamFont from '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url';

const cache = new Map<string, Promise<TileLayer[]>>();
const fonts = new Map<string, Promise<void>>();
function loadFont(mono: string) {
  const team = mono.includes('Geist'), family = team ? 'Geist Mono Variable' : 'JetBrains Mono Variable';
  const hit = fonts.get(family); if (hit) return hit;
  const pending = new FontFace(family, `url("${team ? teamFont : fccFont}")`, { weight: '100 900' }).load()
    .then((face) => { (self as unknown as { fonts: FontFaceSet }).fonts.add(face); }).catch(() => undefined);
  fonts.set(family, pending);
  return pending;
}
function tile(url: string) {
  const hit = cache.get(url);
  if (hit) { cache.delete(url); cache.set(url, hit); return hit; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const pending = fetch(url, { signal: controller.signal }).then(async (response) => {
    if (!response.ok || Number(response.headers.get('content-length')) > 8 * 1024 * 1024) throw new Error('Context unavailable');
    return readVectorTile(await response.arrayBuffer());
  }).catch((error) => { cache.delete(url); throw error; }).finally(() => clearTimeout(timer));
  cache.set(url, pending);
  while (cache.size > 64) cache.delete(cache.keys().next().value!);
  return pending;
}

self.onmessage = async ({ data }: MessageEvent<{ id: number; job: TilePaintJob }>) => {
  const { id, job: j } = data;
  try {
    const layers = await tile(j.url);
    if (j.labelsOnly) await loadFont(j.mono);
    const canvas = drawTile(layers, j.light, j.labelsOnly, j.settings, j.z, j.ox, j.oy, j.over, j.mono, new Set(j.localNames), j.localPoints) as OffscreenCanvas;
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ id, bitmap }, { transfer: [bitmap] });
  } catch {
    self.postMessage({ id, error: 'Map context unavailable' });
  }
};
