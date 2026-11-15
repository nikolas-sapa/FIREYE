import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScenario, clc2018 } from '../src/console/scenario/load';
import { buildSource } from '../src/console/world3d/gen/source';
import { createContext, generateTile, generateFar } from '../src/console/world3d/gen/tile';

export async function loadPack() {
  const root = resolve('public');
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const path = resolve(root, '.' + String(url).replace(/^https?:\/\/[^/]+/, ''));
    try { return new Response(readFileSync(path)); } catch { return new Response(null, { status: 404 }); }
  }) as typeof fetch;
  try { return await loadScenario('mati-2018'); } finally { globalThis.fetch = original; }
}

const pack = await loadPack();
const W = 2048, H = 1700;
const pixels = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 2654435761) >>> 24;
const src = buildSource(pack, clc2018(pack), { imagery: { width: W, height: H, bbox: pack.imagery!.bbox, pixels }, scar: { lon: 23.952, lat: 38.04, r: 900 } });
let t = performance.now();
const ctx = createContext(src);
console.log('context ms', (performance.now() - t).toFixed(1), 'tiles', ctx.frame.tilesX, ctx.frame.tilesZ);
t = performance.now();
const far = generateFar(ctx);
console.log('far ms', (performance.now() - t).toFixed(1), 'chunks', far.chunks.length, 'verts', far.chunks.reduce((s, c) => s + c.mesh.position.length / 3, 0));
const [cx, cz] = ctx.frame.tileOf(ctx.frame.x(23.955), ctx.frame.z(38.047));
for (const detail of ['near', 'far'] as const) {
  const times: number[] = [];
  let maxObj = 0, maxInst = 0, worst = '';
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const tile = generateTile(ctx, cx + dx, cz + dz, detail);
    times.push(tile.ms);
    const inst = tile.groups.reduce((s, g) => s + g.count, 0);
    if (tile.ms >= Math.max(...times)) worst = `${tile.key} inst=${inst}`;
    maxObj = Math.max(maxObj, tile.objectCount); maxInst = Math.max(maxInst, inst);
  }
  times.sort((a, b) => a - b);
  console.log(detail, 'median', times[times.length >> 1].toFixed(1), 'p90', times[Math.floor(times.length * 0.9)].toFixed(1), 'max', times[times.length - 1].toFixed(1), 'maxObjects', maxObj, 'maxInstances', maxInst, 'worst', worst);
}
