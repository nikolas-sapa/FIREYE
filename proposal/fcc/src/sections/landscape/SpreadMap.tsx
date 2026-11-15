import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { FuelClass } from '@/console/contracts';
import { color, cn } from '@ds';
import { FUEL_INFO, MODEL_SIDE, Review, SPREAD_BANDS_MIN, stitchReviews, type ReviewCell } from '@/image-lab/landscape';

export type MapLayer = 'fuel' | 'terrain' | 'review' | 'spread';
const CANVAS_PX = 1024;
const CELL_PX = CANVAS_PX / MODEL_SIDE;

/** Read at draw time so theme-dependent tokens (amber) stay current. */
export function fuelColor(f: FuelClass): [string, number] | null {
  switch (f) {
    case FuelClass.Water: return [color.ice, 0.55];
    case FuelClass.Rock: return [color.ink[200], 0.4];
    case FuelClass.Grass: return [color.amber, 0.45];
    case FuelClass.Agriculture: return [color.bone.mute, 0.45];
    case FuelClass.Shrub: return [color.phosphor, 0.35];
    case FuelClass.TimberLitter:
    case FuelClass.TimberUnderstory: return [color.phosphor, 0.7];
    case FuelClass.Urban: return [color.violet, 0.6];
    default: return null;
  }
}
const reviewColor = (k: Review) => (k === Review.V ? color.amber : k === Review.N ? color.ice : color.ink[300]);
const BAND_ALPHA = [0.75, 0.5, 0.3];

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export interface SpreadMapProps {
  imageUrl?: string;
  layers: Record<MapLayer, boolean>;
  fuel?: Uint8Array;
  elevation?: Float32Array;
  reviews?: (ReviewCell | undefined)[];
  disagree?: Uint8Array;
  arrival?: Float32Array;
  ignition?: number;
  /** Wind FROM direction (degrees) and speed for the corner indicator. */
  wind?: { fromDeg: number; kph: number };
  seams?: boolean;
  onIgnite?: (index: number) => void;
  describe?: (index: number) => string;
  className?: string;
}

export function SpreadMap({ imageUrl, layers, fuel, elevation, reviews, disagree, arrival, ignition, wind, seams = true,
  onIgnite, describe, className }: SpreadMapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cursor, setCursor] = useState<number>();
  const [focused, setFocused] = useState(false);

  const shade = useMemo(() => {
    if (!elevation) return undefined;
    // Hillshade, light from the north-west at 45 degrees; 40 m cells.
    const out = new Float32Array(elevation.length);
    const az = (315 * Math.PI) / 180, alt = Math.PI / 4;
    for (let y = 0; y < MODEL_SIDE; y++) for (let x = 0; x < MODEL_SIDE; x++) {
      const at = (dx: number, dy: number) => elevation[Math.min(MODEL_SIDE - 1, Math.max(0, y + dy)) * MODEL_SIDE + Math.min(MODEL_SIDE - 1, Math.max(0, x + dx))];
      const gx = (at(1, 0) - at(-1, 0)) / 80, gy = (at(0, 1) - at(0, -1)) / 80;
      const slope = Math.atan(Math.hypot(gx, gy)), aspect = Math.atan2(gy, -gx);
      out[y * MODEL_SIDE + x] = Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
    }
    return out;
  }, [elevation]);

  // Every available output, accepted or not, stitched with feathered overlaps; opacity marks acceptance.
  const stitched = useMemo(() => reviews?.some(Boolean) ? stitchReviews(reviews, () => true) : undefined, [reviews]);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
    const cells = new ImageData(MODEL_SIDE, MODEL_SIDE);
    const px = cells.data;
    const paint = (i: number, c: [number, number, number], a: number) => {
      const o = i * 4, k = px[o + 3] / 255, na = a + k * (1 - a);
      for (let j = 0; j < 3; j++) px[o + j] = Math.round((c[j] * a + px[o + j] * k * (1 - a)) / (na || 1));
      px[o + 3] = Math.round(na * 255);
    };
    if (layers.terrain && shade) {
      for (let i = 0; i < shade.length; i++) {
        const s = Math.max(0, Math.min(1, shade[i]));
        paint(i, s > 0.7 ? [255, 255, 255] : [0, 0, 0], s > 0.7 ? (s - 0.7) * 0.9 : (0.7 - s) * 0.8);
      }
    }
    if (layers.fuel && fuel) {
      const cache = new Map<number, [[number, number, number], number] | null>();
      for (let i = 0; i < fuel.length; i++) {
        let entry = cache.get(fuel[i]);
        if (entry === undefined) { const c = fuelColor(fuel[i]); entry = c ? [rgb(c[0]), c[1]] : null; cache.set(fuel[i], entry); }
        if (entry) paint(i, entry[0], entry[1]);
      }
    }
    if (layers.review && reviews && stitched) {
      const palette = [Review.V, Review.N, Review.U].map(k => rgb(reviewColor(k)));
      const { shares: s, covered, owner } = stitched;
      for (let i = 0; i < covered.length; i++) {
        if (!covered[i]) continue;
        const k = i * 3, top = s[k] >= s[k + 1] && s[k] >= s[k + 2] ? 0 : s[k + 1] >= s[k + 2] ? 1 : 2;
        paint(i, palette[top], reviews[owner[i]]?.accepted ? 0.55 : 0.2);
      }
    }
    if (layers.spread && arrival) {
      const ember = rgb(color.ember);
      for (let i = 0; i < arrival.length; i++) {
        const t = arrival[i];
        const band = SPREAD_BANDS_MIN.findIndex(b => t <= b);
        if (band >= 0) paint(i, ember, BAND_ALPHA[band]);
      }
    }
    const layer = document.createElement('canvas');
    layer.width = layer.height = MODEL_SIDE;
    layer.getContext('2d')!.putImageData(cells, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(layer, 0, 0, CANVAS_PX, CANVAS_PX);

    // Cell-edge outlines: isochrones on band changes, disagreements as hairlines.
    ctx.lineWidth = 1.5;
    const edges = (test: (a: number, b: number) => boolean, stroke: string) => {
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      for (let y = 0; y < MODEL_SIDE; y++) for (let x = 0; x < MODEL_SIDE; x++) {
        const i = y * MODEL_SIDE + x;
        if (x + 1 < MODEL_SIDE && test(i, i + 1)) { ctx.moveTo((x + 1) * CELL_PX, y * CELL_PX); ctx.lineTo((x + 1) * CELL_PX, (y + 1) * CELL_PX); }
        if (y + 1 < MODEL_SIDE && test(i, i + MODEL_SIDE)) { ctx.moveTo(x * CELL_PX, (y + 1) * CELL_PX); ctx.lineTo((x + 1) * CELL_PX, (y + 1) * CELL_PX); }
      }
      ctx.stroke();
    };
    if (layers.spread && arrival) {
      const bandOf = (i: number) => SPREAD_BANDS_MIN.findIndex(b => arrival[i] <= b);
      edges((a, b) => bandOf(a) !== bandOf(b), color.bone.DEFAULT);
    }
    if (layers.review && disagree) edges((a, b) => disagree[a] !== disagree[b], color.ember);
    if (seams) {
      ctx.strokeStyle = color.bone.DEFAULT;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(CANVAS_PX / 2, 0); ctx.lineTo(CANVAS_PX / 2, CANVAS_PX); ctx.moveTo(0, CANVAS_PX / 2); ctx.lineTo(CANVAS_PX, CANVAS_PX / 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    const mark = (i: number, stroke: string, r: number) => {
      const cx = (i % MODEL_SIDE + 0.5) * CELL_PX, cy = (Math.floor(i / MODEL_SIDE) + 0.5) * CELL_PX;
      ctx.strokeStyle = stroke; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.moveTo(cx - r - 6, cy); ctx.lineTo(cx + r + 6, cy); ctx.moveTo(cx, cy - r - 6); ctx.lineTo(cx, cy + r + 6); ctx.stroke();
    };
    if (ignition !== undefined) mark(ignition, color.signal.DEFAULT, 9);
    if (focused && cursor !== undefined) mark(cursor, color.bone.DEFAULT, 6);
    if (wind) {
      // Arrow points downwind, the direction the head runs.
      const cx = CANVAS_PX - 64, cy = 64, to = ((wind.fromDeg + 180) * Math.PI) / 180, len = 34;
      ctx.fillStyle = color.ink[950]; ctx.globalAlpha = 0.8; ctx.fillRect(cx - 52, cy - 52, 104, 120); ctx.globalAlpha = 1;
      ctx.strokeStyle = color.bone.DEFAULT; ctx.lineWidth = 3;
      const ex = cx + Math.sin(to) * len, ey = cy - Math.cos(to) * len, sx = cx - Math.sin(to) * len, sy = cy + Math.cos(to) * len;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
      ctx.lineTo(ex - Math.sin(to - 0.5) * 14, ey + Math.cos(to - 0.5) * 14); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.sin(to + 0.5) * 14, ey + Math.cos(to + 0.5) * 14); ctx.stroke();
      ctx.fillStyle = color.bone.DEFAULT; ctx.font = '600 18px ui-monospace, monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(wind.kph)} KM/H`, cx, cy + 58);
    }
  }, [layers, fuel, shade, reviews, stitched, disagree, arrival, ignition, wind, seams, cursor, focused]);

  const cellAt = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * MODEL_SIDE);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * MODEL_SIDE);
    return x >= 0 && y >= 0 && x < MODEL_SIDE && y < MODEL_SIDE ? y * MODEL_SIDE + x : undefined;
  };
  const onKey = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const current = cursor ?? ignition ?? (MODEL_SIDE / 2) * MODEL_SIDE + MODEL_SIDE / 2;
    const step = event.shiftKey ? 16 : 4;
    let x = current % MODEL_SIDE, y = Math.floor(current / MODEL_SIDE);
    if (event.key === 'ArrowLeft') x -= step; else if (event.key === 'ArrowRight') x += step;
    else if (event.key === 'ArrowUp') y -= step; else if (event.key === 'ArrowDown') y += step;
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onIgnite?.(current); return; }
    else return;
    event.preventDefault();
    setCursor(Math.min(MODEL_SIDE - 1, Math.max(0, y)) * MODEL_SIDE + Math.min(MODEL_SIDE - 1, Math.max(0, x)));
  };
  const readout = cursor !== undefined ? describe?.(cursor) : undefined;

  return (
    <figure className={cn('min-w-0 border border-line bg-ink-900', className)}>
      <div className="fcc-sensor relative aspect-square bg-void">
        {imageUrl ? <img src={imageUrl} alt="Satellite source, 2020 mosaic" className="absolute inset-0 h-full w-full object-cover" /> :
          <div className="fcc-hatch absolute inset-0 flex items-center justify-center font-mono text-nano uppercase text-bone-dim">Pick a landscape</div>}
        <canvas ref={canvas} width={CANVAS_PX} height={CANVAS_PX} tabIndex={imageUrl ? 0 : -1}
          role="application" aria-roledescription="landscape map"
          aria-label="Landscape map. Click to set the ignition point. With the keyboard, arrow keys move the cursor (Shift for larger steps) and Enter sets ignition."
          onPointerMove={event => setCursor(cellAt(event))} onPointerLeave={() => !focused && setCursor(undefined)}
          onClick={event => { const i = cellAt(event as unknown as PointerEvent<HTMLCanvasElement>); if (i !== undefined) onIgnite?.(i); }}
          onKeyDown={onKey} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          className="absolute inset-0 h-full w-full cursor-crosshair focus-visible:outline focus-visible:outline-1 focus-visible:outline-signal" />
      </div>
      <figcaption aria-live="polite" className="min-h-[2.25rem] border-t border-line px-3 py-2 font-mono text-nano uppercase text-bone-dim">
        {readout ?? 'Hover or focus the map to inspect a cell'}
      </figcaption>
    </figure>
  );
}

export const fuelLegend = () => (Object.keys(FUEL_INFO).map(Number) as FuelClass[])
  .flatMap(f => { const c = fuelColor(f); return c ? [{ label: FUEL_INFO[f].label, color: c[0] }] : []; });
