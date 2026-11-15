import { useEffect, useRef, useState } from 'react';
import { Button, cn } from '@ds';
import type { BBox, Geo } from '../../contracts';
import { archiveCrop } from './archive-camera';

export interface ArchiveImage { url: string; bbox: BBox; date?: string; source: string }
interface Props {
  image: ArchiveImage; label: string; target?: Geo; seed?: number;
  variant?: 'thumb' | 'full'; controls?: boolean; playing?: boolean; className?: string;
}
const images = new Map<string, Promise<HTMLImageElement>>();
function load(url: string) {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = url;
    });
    images.set(url, pending);
  }
  return pending;
}

/** Dependency-free, offline camera loops. Simulation labels remain visible even in recording-safe mode. */
export function ArchiveCamera({ image, label, target, seed = 0, variant = 'thumb', controls = false, playing = true, className }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [explicitPlay, setExplicitPlay] = useState(false);
  const full = variant === 'full';
  const moving = playing && !paused && (!reduced || explicitPlay);
  const elapsed = useRef(0);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const out = canvas.current, context = out?.getContext('2d', { alpha: false });
    if (!out || !context) return;
    delete out.dataset.ready;
    let dead = false, raf = 0, last = 0, frames = 0;
    setFailed(false);
    const center = target ? { x: (target.lon - image.bbox[0]) / (image.bbox[2] - image.bbox[0]),
      y: (image.bbox[3] - target.lat) / (image.bbox[3] - image.bbox[1]) } : { x: 0.5, y: 0.5 };
    void load(image.url).then(source => {
      if (dead) return;
      const draw = (now: number) => {
        if (dead) return;
        if (!last || now - last >= 1000 / (full ? 24 : 8)) {
          if (last && moving && !document.hidden) elapsed.current += Math.min(0.15, (now - last) / 1000);
          last = now;
          const crop = archiveCrop(source.naturalWidth, source.naturalHeight, out.width / out.height, elapsed.current, seed, center);
          context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
          context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, out.width, out.height);
          out.dataset.frame = String(++frames); out.dataset.ready = 'true';
        }
        if (moving) raf = requestAnimationFrame(draw);
      };
      draw(performance.now());
    }).catch(() => { if (!dead) setFailed(true); });
    return () => { dead = true; cancelAnimationFrame(raf); };
  }, [image.url, image.bbox, target?.lon, target?.lat, seed, full, moving]);
  const year = image.date?.match(/\b20\d\d\b/)?.[0] ?? 'archive';
  return <div className={cn('relative h-full w-full overflow-hidden bg-void', className)} data-demo-camera={label}>
    <img src={image.url} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
    <canvas ref={canvas} width={full ? 1280 : 384} height={full ? 720 : 216} role="img" aria-label={`Simulated ${label}, animated ${year} archive imagery, not live footage`} className="absolute inset-0 h-full w-full object-cover opacity-0 data-[ready=true]:opacity-100" />
    <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2 font-mono text-micro uppercase text-bone">
      <span className="border border-amber/50 bg-ink-950/90 px-1.5 py-1 text-amber">Simulated</span>
      <span className="bg-ink-950/90 px-1.5 py-1">{label}</span>
    </div>
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 border border-bone/70"><span className="absolute left-1/2 top-1/2 h-px w-10 -translate-x-1/2 bg-bone/60" /><span className="absolute left-1/2 top-1/2 h-10 w-px -translate-y-1/2 bg-bone/60" /></div>
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-ink-950/90 px-2 py-1.5">
      <p className="font-mono text-micro uppercase leading-4 text-bone-dim">{failed ? 'Archive unavailable' : `Animated archive · EOX ${year}`}<span className="ml-2 text-bone-mute">Not live footage</span></p>
      {controls && <Button size="sm" variant="ghost" onClick={() => { if (reduced && !explicitPlay) { setExplicitPlay(true); setPaused(false); } else setPaused(p => !p); }} aria-label={moving ? 'Pause simulated feed' : 'Play simulated feed'}>{moving ? 'Pause' : 'Play'}</Button>}
    </div>
  </div>;
}
