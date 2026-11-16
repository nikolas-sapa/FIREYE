import { createContext, generateFar, generateTile, type GenContext } from './tile';
import type { Detail, FarTerrain, MeshArrays, TileData, WorldSource } from '../types';

export type WorkerRequest =
  | { type: 'init'; source: WorldSource; imagery?: { url: string; bbox: [number, number, number, number]; maxWidth: number } }
  | { type: 'tile'; id: number; tx: number; tz: number; detail: Detail };
export type WorkerResponse =
  | { type: 'ready'; far: FarTerrain; imagery: boolean; ms: number }
  | { type: 'tile'; id: number; tile: TileData }
  | { type: 'error'; id?: number; message: string };

export function meshBuffers(m: MeshArrays | null, out: ArrayBuffer[]) {
  if (!m) return;
  out.push(m.position.buffer as ArrayBuffer, m.color.buffer as ArrayBuffer, m.meta.buffer as ArrayBuffer, m.params.buffer as ArrayBuffer);
  if (m.index) out.push(m.index.buffer as ArrayBuffer);
}
export function tileBuffers(t: TileData) {
  const out: ArrayBuffer[] = [];
  meshBuffers(t.terrain, out); meshBuffers(t.roads, out);
  for (const g of t.groups) out.push(g.matrices.buffer as ArrayBuffer, g.colors.buffer as ArrayBuffer, g.params.buffer as ArrayBuffer);
  out.push(t.spawns.homes.buffer as ArrayBuffer, t.spawns.nodes.buffer as ArrayBuffer, t.spawns.pasture.buffer as ArrayBuffer);
  return [...new Set(out)].filter(b => b.byteLength > 0);
}

/** Decode the dated Sentinel-2 mosaic off the main thread, downsampled to about 8 m per pixel. */
async function decodeImagery(spec: NonNullable<Extract<WorkerRequest, { type: 'init' }>['imagery']>) {
  const blob = await (await fetch(spec.url)).blob();
  const probe = await createImageBitmap(blob);
  const scale = Math.min(1, spec.maxWidth / probe.width);
  const width = Math.round(probe.width * scale), height = Math.round(probe.height * scale);
  probe.close();
  const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(width, height), g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0); bitmap.close();
  return { width, height, bbox: spec.bbox, pixels: g.getImageData(0, 0, width, height).data };
}

if (typeof self !== 'undefined' && typeof document === 'undefined' && typeof (self as { postMessage?: unknown }).postMessage === 'function') {
  let ctx: GenContext | null = null;
  const queue: Extract<WorkerRequest, { type: 'tile' }>[] = [];
  const post = (msg: WorkerResponse, transfer: ArrayBuffer[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  const run = (req: Extract<WorkerRequest, { type: 'tile' }>) => {
    try {
      const tile = generateTile(ctx!, req.tx, req.tz, req.detail);
      post({ type: 'tile', id: req.id, tile }, tileBuffers(tile));
    } catch (e) { post({ type: 'error', id: req.id, message: String(e) }); }
  };
  self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data;
    if (msg.type === 'tile') { if (ctx) run(msg); else queue.push(msg); return; }
    const t0 = performance.now();
    let imagery = false;
    if (msg.imagery) {
      try { msg.source.imagery = await decodeImagery(msg.imagery); imagery = true; } catch { /* CORINE palette remains; still a usable world. */ }
    }
    try {
      ctx = createContext(msg.source);
      const far = generateFar(ctx);
      const buffers: ArrayBuffer[] = [];
      for (const c of far.chunks) { meshBuffers(c.mesh, buffers); meshBuffers(c.coarse, buffers); }
      for (const m of far.context ?? []) meshBuffers(m, buffers);
      post({ type: 'ready', far, imagery, ms: performance.now() - t0 }, buffers);
      for (const q of queue.splice(0)) run(q);
    } catch (e) { post({ type: 'error', message: String(e) }); }
  };
}
