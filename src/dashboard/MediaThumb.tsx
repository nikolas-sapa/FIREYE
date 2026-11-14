import { memo, useEffect, useRef } from 'react';
import { Brackets, Crosshair, cn, color } from '@ds';
import type { IngestType } from '@/sim/types';
import { hashStr, timecode } from './format';

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const THERMAL = [color.ink[950], color.ink[800], color.ink[600], color.signal.deep, color.signal.DEFAULT, color.signal.hot, color.amber, color.bone.DEFAULT].map(hex);
const EO = [color.ink[950], color.ink[800], color.ink[600], color.ink[400], color.ink[300], color.ink[200]].map(hex);

function ramp(stops: RGB[], v: number): RGB {
  const x = Math.max(0, Math.min(0.9999, v)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 48;
const H = 32;

function paint(ctx: CanvasRenderingContext2D, seed: number, thermal: boolean) {
  const r = rng(seed);
  const waves = Array.from({ length: 4 }, () => ({ fx: 0.05 + r() * 0.2, fy: 0.05 + r() * 0.2, p: r() * 6.28, a: 0.08 + r() * 0.1 }));
  const spots = Array.from({ length: thermal ? 2 + Math.floor(r() * 3) : 1 }, () => ({
    x: W * (0.2 + r() * 0.6), y: H * (0.25 + r() * 0.55), rad: 2 + r() * (thermal ? 7 : 10), k: thermal ? 0.6 + r() * 0.45 : 0.35,
  }));
  const ridge = H * (0.25 + r() * 0.2);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = thermal ? 0.12 : 0.35;
      for (const w of waves) v += w.a * Math.sin(x * w.fx + y * w.fy + w.p);
      if (!thermal && y < ridge + Math.sin(x * 0.2) * 2) v += 0.25;
      for (const s of spots) {
        const d2 = (x - s.x) ** 2 + (y - s.y) ** 2;
        v += s.k * Math.exp(-d2 / (2 * s.rad * s.rad));
      }
      v += (r() - 0.5) * 0.06;
      const [cr, cg, cb] = ramp(thermal ? THERMAL : EO, v);
      const o = (y * W + x) * 4;
      img.data[o] = cr;
      img.data[o + 1] = cg;
      img.data[o + 2] = cb;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Procedurally generated sensor frame (no external media). */
export const MediaThumb = memo(function MediaThumb({ id, type, at, className }: { id: string; type: IngestType; at: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const thermal = type !== 'image';
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (ctx) paint(ctx, hashStr(id), thermal);
  }, [id, thermal]);

  const tag = type === 'video' ? 'IR' : type === 'satellite' ? 'SWIR' : 'EO';
  return (
    <div className={cn('relative h-16 w-24 shrink-0 overflow-hidden border border-line bg-ink-950', className)}>
      <canvas ref={ref} width={W} height={H} className="absolute inset-0 h-full w-full [image-rendering:pixelated]" />
      <div aria-hidden className="fcc-scanlines absolute inset-0" />
      {type === 'satellite' && <div aria-hidden className="absolute inset-0 fcc-linegrid opacity-60 [background-size:12px_12px]" />}
      <Crosshair size={14} gap={3} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-bone/80" />
      <Brackets size={4} tone="bone" inset={3} />
      <div className="absolute inset-x-1.5 top-1 flex items-center justify-between font-mono text-micro leading-none text-bone">
        {type === 'video' ? (
          <span className="flex items-center gap-1">
            <span className="h-1 w-1 animate-blink bg-ember" />
            REC
          </span>
        ) : (
          <span>{type === 'satellite' ? 'L2' : 'STILL'}</span>
        )}
        <span className="text-bone-dim">{tag}</span>
      </div>
      <div className="absolute inset-x-1.5 bottom-1 font-mono text-micro leading-none tracking-normal text-bone-dim fcc-num">{timecode(at)}</div>
    </div>
  );
});
