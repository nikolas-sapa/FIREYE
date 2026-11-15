import type { TilePaintJob } from './cartography-paint';

/** Four bounded jobs; decoding, geometry walks and painting never block camera interaction. */
export class ContextRasterizer {
  private worker = new Worker(new URL('./context-worker.ts', import.meta.url), { type: 'module' });
  private sequence = 0;
  isDestroyed = false;
  private pending = new Map<number, { resolve: (canvas: HTMLCanvasElement) => void; reject: (error: Error) => void }>();
  constructor(private failed: () => void) {
    this.worker.onmessage = ({ data }: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
      const pending = this.pending.get(data.id);
      if (!pending) { data.bitmap?.close(); return; }
      this.pending.delete(data.id);
      if (!data.bitmap || data.error) { this.failed(); pending.reject(new Error('Map context unavailable')); return; }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const context = canvas.getContext('bitmaprenderer');
      if (context) context.transferFromImageBitmap(data.bitmap);
      else { canvas.getContext('2d')!.drawImage(data.bitmap, 0, 0); data.bitmap.close(); }
      pending.resolve(canvas);
    };
    this.worker.onerror = () => { this.failed(); this.destroy(); };
  }
  paint(job: TilePaintJob) {
    if (this.isDestroyed) return undefined;
    if (this.pending.size >= 4) return undefined;
    const id = ++this.sequence;
    return new Promise<HTMLCanvasElement>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, job });
    });
  }
  destroy() {
    this.isDestroyed = true;
    this.worker.terminate();
    // These results belong to imagery layers that are being disposed; no unhandled rejections.
    for (const p of this.pending.values()) p.resolve(document.createElement('canvas'));
    this.pending.clear();
  }
}
