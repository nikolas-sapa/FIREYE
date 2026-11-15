import { useEffect, useRef } from 'react';
import { cn, font, pad, zulu } from '@ds';
import { useSimEngine } from '@/sim/SimProvider';
import { gridRef, RELIEF_M } from '@/sim/terrain';
import { CELL_M, CellState, Fuel, GRID_H, GRID_W, type CameraFeed, type Grid, type Observation, type SimSnapshotB } from '@/sim/types';
import { C, mixRgb, rgba, type RGB } from './layers';

export interface CameraViewProps {
  feedId: string;
  /** 'thumb' renders at lower resolution and frame rate with a minimal HUD. */
  variant?: 'thumb' | 'full';
  className?: string;
}

type Palette = 'eo' | 'ironbow' | 'whitehot';

const MONO = font.mono;
const FPS_FULL = 24;
const FPS_THUMB = 20;
const FPS_REDUCED = 2;

function hash2(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const strHash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

function buildLut(stops: RGB[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    const c = mixRgb(stops[k], stops[k + 1], t - k);
    lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
  }
  return lut;
}

let LUTS: Record<'ironbow' | 'whitehot', Uint8ClampedArray> | null = null;
const luts = () =>
  (LUTS ??= {
    ironbow: buildLut([C.void, mixRgb(C.void, C.violet, 0.3), mixRgb(C.violet, C.signalDeep, 0.55), C.signal, C.amber, C.bone]),
    whitehot: buildLut([C.void, C.ink700, C.ink400, C.boneMute, C.boneDim, C.bone]),
  });

let EO: RGB[] | null = null;
const eoPalette = () => {
  if (EO) return EO;
  const p: RGB[] = [];
  p[Fuel.Water] = mixRgb(C.void, C.ice, 0.16);
  p[Fuel.Rock] = mixRgb(C.ink500, C.bone, 0.08);
  p[Fuel.Grass] = mixRgb(C.ink500, C.amber, 0.24);
  p[Fuel.Brush] = mixRgb(C.ink600, C.phosphor, 0.12);
  p[Fuel.Timber] = mixRgb(C.ink700, C.phosphor, 0.14);
  p[Fuel.Urban] = mixRgb(C.ink500, C.bone, 0.22);
  p[Fuel.Road] = mixRgb(C.ink500, C.bone, 0.3);
  p[Fuel.Burnt] = C.scar;
  return (EO = p);
};

function paletteFor(feed: CameraFeed): Palette {
  const s = (feed.sensor ?? feed.label).toUpperCase();
  if (s.includes('LWIR')) return 'ironbow';
  if (s.includes('MSI')) return 'whitehot';
  return 'eo';
}

function elevAt(g: Grid, x: number, y: number) {
  const ix = clamp(Math.floor(x), 0, g.w - 1), iy = clamp(Math.floor(y), 0, g.h - 1);
  return g.elevation[iy * g.w + ix];
}

function obsColor(o: Observation): RGB {
  switch (o.kind) {
    case 'human': case 'animal': return C.violet;
    case 'combustible': case 'spot': return C.ember;
    case 'fuel': case 'road-block': return C.amber;
    case 'water': return C.ice;
    default: return C.bone;
  }
}
const DET_LABEL: Partial<Record<Observation['kind'], string>> = {
  human: 'PERSON', animal: 'ANIMAL', combustible: 'HAZMAT', structure: 'STRUCT', spot: 'SPOT FIRE', 'road-block': 'BLOCK',
};

/** Per-frame cell cache for the top-down sensor renderer. */
interface TopCache { buf: Float32Array; }

function setSpacing(ctx: CanvasRenderingContext2D, v: string) {
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = v;
}

export function CameraView({ feedId, variant = 'full', className }: CameraViewProps) {
  const engine = useSimEngine();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feedRef = useRef(feedId);
  feedRef.current = feedId;

  useEffect(() => {
    const root = rootRef.current!, canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    const thumb = variant === 'thumb';
    const low = document.createElement('canvas');
    const lctx = low.getContext('2d')!;
    let img: ImageData | null = null;
    const cache: TopCache = { buf: new Float32Array(0) };
    let W = 1, H = 1, dpr = 1;
    let visible = true;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = mq.matches;
    const onMq = () => { reduced = mq.matches; };
    mq.addEventListener?.('change', onMq);

    function layout() {
      const r = root.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, thumb ? 1 : 1.5);
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const lw = thumb ? 160 : 320;
      const lh = Math.max(1, Math.round((lw * H) / W));
      if (low.width !== lw || low.height !== lh) {
        low.width = lw; low.height = lh;
        img = lctx.createImageData(lw, lh);
      }
    }

    const fontStr = (px: number, w = 500) => `${w} ${px}px ${MONO}`;
    function txt(s: string, x: number, y: number, col: RGB, px: number, a = 1, align: CanvasTextAlign = 'left', plate = false) {
      ctx.font = fontStr(px);
      setSpacing(ctx, '0.12em');
      ctx.textAlign = align;
      if (plate) {
        const w = ctx.measureText(s).width;
        const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
        ctx.fillStyle = rgba(C.ink950, 0.7 * a);
        ctx.fillRect(x0 - 3, y - px, w + 6, px + 4);
      }
      ctx.fillStyle = rgba(col, a);
      ctx.fillText(s, x, y);
      ctx.textAlign = 'left';
    }

    // --- top-down sensor (drones, satellite) ------------------------------------------
    function renderTop(s: SimSnapshotB, feed: CameraFeed, pal: Palette, t: number, seed: number) {
      if (!img) return { cx: 0, cy: 0, fx: 0, fy: -1, rx: 1, ry: 0, cpp: 1, burning: 0, bx: 0, by: 0 };
      const g = s.grid;
      const lw = img.width, lh = img.height;
      const d = img.data;
      const sat = feed.kind === 'satellite';
      const mpp = sat ? 14 : thumb ? 4.4 : 2.2; // metres per low-res pixel
      const cpp = mpp / CELL_M;
      const drift = reduced ? 0 : 1;
      const cx = feed.pos.x + drift * (Math.sin(t * 0.13 + seed * 9) * 0.7 + Math.sin(t * 1.7 + seed) * 0.04);
      const cy = feed.pos.y + drift * (Math.cos(t * 0.11 + seed * 7) * 0.7 + Math.cos(t * 1.9 + seed) * 0.04);
      const hd = ((sat ? 0 : feed.heading) + drift * Math.sin(t * 0.21 + seed * 5) * 2.5) * (Math.PI / 180);
      const fx = Math.sin(hd), fy = -Math.cos(hd); // forward (screen up)
      const rx = Math.cos(hd), ry = Math.sin(hd); // right
      const hw = (lw / 2) * cpp, hh = (lh / 2) * cpp;
      const ext = Math.abs(rx) * hw + Math.abs(fx) * hh, eyt = Math.abs(ry) * hw + Math.abs(fy) * hh;
      const bx0 = Math.max(0, Math.floor(cx - ext) - 1), bx1 = Math.min(g.w - 1, Math.ceil(cx + ext) + 1);
      const by0 = Math.max(0, Math.floor(cy - eyt) - 1), by1 = Math.min(g.h - 1, Math.ceil(cy + eyt) + 1);
      const bw = Math.max(1, bx1 - bx0 + 1), bh = Math.max(1, by1 - by0 + 1);
      const thermal = pal !== 'eo';
      const stride = thermal ? 1 : 3;
      if (cache.buf.length < bw * bh * stride) cache.buf = new Float32Array(bw * bh * stride * 2);
      const cb = cache.buf;
      const eo = eoPalette();
      const zf = (RELIEF_M / CELL_M) * 0.5;
      let burning = 0, bsx = 0, bsy = 0;
      const flick = reduced ? 0 : 1;
      for (let y = by0; y <= by1; y++) {
        for (let x = bx0; x <= bx1; x++) {
          const i = y * g.w + x;
          const e = g.elevation;
          const dzdx = (e[y * g.w + Math.min(g.w - 1, x + 1)] - e[y * g.w + Math.max(0, x - 1)]) * zf;
          const dzdy = (e[Math.min(g.h - 1, y + 1) * g.w + x] - e[Math.max(0, y - 1) * g.w + x]) * zf;
          const shade = clamp(0.78 - 0.55 * (dzdx + dzdy), 0.3, 1.25);
          const st = g.state[i];
          const o = ((y - by0) * bw + (x - bx0)) * stride;
          const hv = hash2(x, y);
          if (thermal) {
            let v: number;
            if (st === CellState.Burning) {
              v = 0.74 + 0.26 * clamp(g.heat[i], 0, 1) * (1 - flick * 0.15 * (0.5 + 0.5 * Math.sin(t * (6 + hv * 8) + hv * 30)));
              burning++; bsx += x; bsy += y;
            } else if (st === CellState.Burnt) v = 0.4 + 0.08 * hv;
            else if (st === CellState.Suppressed) v = 0.3;
            else {
              const f = g.fuel[i];
              v = f === Fuel.Water ? 0.06 : f === Fuel.Road ? 0.34 : f === Fuel.Urban ? 0.3 : f === Fuel.Rock ? 0.27 : 0.16 + 0.1 * g.dryness[i];
              v *= 0.7 + 0.3 * shade;
            }
            cb[o] = v;
          } else {
            let c: RGB;
            if (st === CellState.Burning) {
              const h = clamp(g.heat[i] * (0.8 + 0.4 * hv) * (1 - flick * 0.2 * (0.5 + 0.5 * Math.sin(t * (7 + hv * 9) + hv * 40))), 0, 1);
              c = h < 0.5 ? mixRgb(C.signalDeep, C.signal, h * 2) : mixRgb(C.signalHot, C.amber, (h - 0.5) * 2);
              burning++; bsx += x; bsy += y;
            } else if (st === CellState.Burnt) {
              const k = 0.75 + hv * 0.4;
              c = [C.scar[0] * k, C.scar[1] * k, C.scar[2] * k];
            } else if (st === CellState.Suppressed) c = mixRgb(C.ink700, C.ice, 0.1);
            else {
              const b = eo[g.fuel[i]] ?? eo[Fuel.Grass];
              const k = shade * (0.9 + 0.2 * hv);
              c = [b[0] * k, b[1] * k, b[2] * k];
              if (g.retardant[i] > 0.12) c = mixRgb(c, C.signalDeep, Math.min(0.6, g.retardant[i]));
            }
            cb[o] = c[0]; cb[o + 1] = c[1]; cb[o + 2] = c[2];
          }
        }
      }
      const lut = thermal ? luts()[pal === 'ironbow' ? 'ironbow' : 'whitehot'] : null;
      const ax = rx * cpp, ay = ry * cpp;
      let seedN = (t * 1000) | 0;
      const blank = C.void;
      for (let py = 0; py < lh; py++) {
        const oy = (py - lh / 2) * cpp;
        let wx = cx - rx * hw - fx * oy, wy = cy - ry * hw - fy * oy;
        let o = py * lw * 4;
        for (let px = 0; px < lw; px++, wx += ax, wy += ay, o += 4) {
          if (wx < 0 || wy < 0 || wx >= g.w || wy >= g.h) { d[o] = blank[0]; d[o + 1] = blank[1]; d[o + 2] = blank[2]; d[o + 3] = 255; continue; }
          const gx = clamp(wx - 0.5 - bx0, 0, bw - 1.001), gy = clamp(wy - 0.5 - by0, 0, bh - 1.001);
          const x0 = gx | 0, y0 = gy | 0, tx = gx - x0, ty = gy - y0;
          const x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
          const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
          const i00 = (y0 * bw + x0) * stride, i10 = (y0 * bw + x1) * stride, i01 = (y1 * bw + x0) * stride, i11 = (y1 * bw + x1) * stride;
          // Sub-cell texture so a 40 m cell does not read as a flat tile at drone zoom.
          const tex = hash2(Math.floor(wx * 5), Math.floor(wy * 5)) * 0.6 + hash2(Math.floor(wx * 13), Math.floor(wy * 13)) * 0.4 - 0.5;
          seedN = (Math.imul(seedN, 1664525) + 1013904223) | 0;
          const grain = ((seedN >>> 24) / 255 - 0.5) * (thumb ? 0.05 : 0.07);
          if (lut) {
            const v = cb[i00] * w00 + cb[i10] * w10 + cb[i01] * w01 + cb[i11] * w11 + tex * 0.05 + grain * 0.6;
            const li = clamp((v * 255) | 0, 0, 255) * 3;
            d[o] = lut[li]; d[o + 1] = lut[li + 1]; d[o + 2] = lut[li + 2];
          } else {
            const k = 1 + tex * 0.22 + grain;
            d[o] = (cb[i00] * w00 + cb[i10] * w10 + cb[i01] * w01 + cb[i11] * w11) * k;
            d[o + 1] = (cb[i00 + 1] * w00 + cb[i10 + 1] * w10 + cb[i01 + 1] * w01 + cb[i11 + 1] * w11) * k;
            d[o + 2] = (cb[i00 + 2] * w00 + cb[i10 + 2] * w10 + cb[i01 + 2] * w01 + cb[i11 + 2] * w11) * k;
          }
          d[o + 3] = 255;
        }
      }
      lctx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(low, 0, 0, W, H);
      return { cx, cy, fx, fy, rx, ry, cpp, burning, bx: burning ? bsx / burning + 0.5 : 0, by: burning ? bsy / burning + 0.5 : 0 };
    }

    function droneOverlay(s: SimSnapshotB, feed: CameraFeed, pal: Palette, v: ReturnType<typeof renderTop>, t: number, frameNo: number, seed: number) {
      const lw = low.width;
      const k = W / lw;
      const toScreen = (x: number, y: number) => {
        const dx = x - v.cx, dy = y - v.cy;
        const ox = dx * v.rx + dy * v.ry, oy = -(dx * v.fx + dy * v.fy);
        return { x: W / 2 + (ox / v.cpp) * k, y: H / 2 + (oy / v.cpp) * k };
      };
      const thermal = pal !== 'eo';
      // Smoke haze over an active fire in EO.
      if (!thermal && v.burning) {
        const p = toScreen(v.bx, v.by);
        const r = Math.max(W, H) * 0.7;
        const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        gr.addColorStop(0, rgba(C.ink400, 0.22));
        gr.addColorStop(1, rgba(C.ink400, 0));
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W, H);
      }
      // Detections.
      const inView = (p: { x: number; y: number }, m: number) => p.x > m && p.y > m && p.x < W - m && p.y < H - m;
      let n = 0;
      for (const o of s.observations) {
        const lab = DET_LABEL[o.kind];
        if (!lab || o.resolved) continue;
        const p = toScreen(o.pos.x, o.pos.y);
        if (!inView(p, 8)) continue;
        const focus = feed.focusObservationId === o.id;
        const col = thermal ? C.bone : obsColor(o);
        const sz = (o.kind === 'structure' ? 16 : o.kind === 'animal' ? 13 : 9) * (thumb ? 0.8 : 1);
        if (o.kind === 'human' || o.kind === 'animal') {
          const cnt = Math.min(6, o.count ?? 1);
          for (let i = 0; i < cnt; i++) {
            const a = seed * 40 + i * 2.4, rr = 1.5 + i * 1.3;
            const q = { x: p.x + Math.cos(a) * rr * (thumb ? 0.8 : 1.2), y: p.y + Math.sin(a) * rr * (thumb ? 0.8 : 1.2) };
            ctx.fillStyle = thermal ? rgba(C.bone, 0.95) : rgba(C.boneDim, 0.85);
            ctx.beginPath(); ctx.arc(q.x, q.y, thumb ? 0.9 : 1.4, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.strokeStyle = rgba(col, focus ? 1 : 0.8);
        ctx.lineWidth = 1;
        const c = sz * 0.4;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const x = p.x + sx * sz, y = p.y + sy * sz;
          ctx.moveTo(x, y - sy * c); ctx.lineTo(x, y); ctx.lineTo(x - sx * c, y);
        }
        ctx.stroke();
        if (!thumb || focus) txt(`${focus ? 'TRK · ' : ''}${lab} ${o.confidence.toFixed(2)}`, p.x - sz, p.y - sz - 3, col, thumb ? 6 : 8, 0.95, 'left', true);
        n++;
      }
      if (v.burning > 2) {
        const p = toScreen(v.bx, v.by);
        if (inView(p, 20)) {
          const sz = thumb ? 14 : 24;
          ctx.strokeStyle = rgba(C.signalHot, 0.85);
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(p.x - sz, p.y - sz, sz * 2, sz * 2);
          ctx.setLineDash([]);
          if (!thumb) txt(`ACTIVE FIRE · ${v.burning} CELLS`, p.x - sz, p.y - sz - 3, C.signalHot, 8, 0.95, 'left', true);
        }
      }
      // Reticle.
      const R = thumb ? 9 : 16;
      ctx.strokeStyle = rgba(C.bone, 0.75);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W / 2 - R * 2, H / 2); ctx.lineTo(W / 2 - R * 0.6, H / 2);
      ctx.moveTo(W / 2 + R * 0.6, H / 2); ctx.lineTo(W / 2 + R * 2, H / 2);
      ctx.moveTo(W / 2, H / 2 - R * 2); ctx.lineTo(W / 2, H / 2 - R * 0.6);
      ctx.moveTo(W / 2, H / 2 + R * 0.6); ctx.lineTo(W / 2, H / 2 + R * 2);
      ctx.stroke();
      if (!thumb) {
        ctx.strokeStyle = rgba(C.bone, 0.3);
        ctx.strokeRect(W / 2 - R * 4, H / 2 - R * 2.6, R * 8, R * 5.2);
      }
      const unit = feed.unitId ? s.units.find((u) => u.id === feed.unitId) : undefined;
      const alt = Math.round(110 + seed * 40 + (reduced ? 0 : Math.sin(t * 0.3 + seed * 3) * 2));
      const hdg = Math.round(((feed.heading % 360) + 360) % 360);
      const pm = thumb ? 6 : 10, top = thumb ? 11 : 16;
      const live = feed.live;
      const blink = reduced || Math.floor(t * 1.4) % 2 === 0;
      txt(feed.label.toUpperCase(), pm, top, C.bone, thumb ? 7 : 9, 0.95);
      if (live) {
        ctx.fillStyle = rgba(C.ember, blink ? 1 : 0.25);
        const tw = (() => { ctx.font = fontStr(thumb ? 7 : 9); setSpacing(ctx, '0.12em'); return ctx.measureText(feed.label.toUpperCase()).width; })();
        ctx.beginPath(); ctx.arc(pm + tw + 8, top - 3, thumb ? 2 : 2.5, 0, Math.PI * 2); ctx.fill();
        txt(thumb ? 'LIVE' : 'REC · LIVE', pm + tw + 14, top, C.phosphor, thumb ? 6 : 8, 0.95);
      }
      if (thumb) return;
      // The top-right corner is left free for the host tile's own LIVE chip.
      txt(pal === 'eo' ? 'EO · DAY' : pal === 'ironbow' ? 'IR · IRONBOW' : 'IR · WHITE-HOT', pm, top + 12, C.boneMute, 7, 0.9);
      const bat = typeof unit?.battery === 'number' ? ` · BAT ${Math.round(unit.battery * 100)}` : '';
      txt(`GRID ${gridRef(feed.pos)} · ${n} DET`, pm, H - pm - 12, C.boneMute, 7, 0.9);
      txt(`ALT ${alt} M AGL · HDG ${pad(hdg, 3)}°${bat}`, pm, H - pm, C.boneDim, 8, 0.9);
      txt(`${zulu(s.clock)} · ${pad(frameNo % 24)}F`, W - pm, H - pm, C.boneDim, 8, 0.9, 'right');
      if (W < 420) return;
      // Heading tape.
      const tapeW = Math.min(220, W * 0.45), tx0 = W / 2 - tapeW / 2, ty = top + 6;
      ctx.strokeStyle = rgba(C.bone, 0.35);
      ctx.beginPath();
      for (let dd = -30; dd <= 30; dd += 5) {
        const deg = hdg + dd - (hdg % 5);
        const x = tx0 + ((deg - hdg + 30) / 60) * tapeW;
        if (x < tx0 || x > tx0 + tapeW) continue;
        const major = ((deg % 30) + 30) % 30 === 0;
        ctx.moveTo(x, ty); ctx.lineTo(x, ty + (major ? 6 : 3));
      }
      ctx.stroke();
      txt(pad(hdg, 3), W / 2, ty + 16, C.bone, 8, 0.9, 'center');
      ctx.fillStyle = rgba(C.bone, 0.9);
      ctx.beginPath(); ctx.moveTo(W / 2, ty + 7); ctx.lineTo(W / 2 - 3, ty + 1); ctx.lineTo(W / 2 + 3, ty + 1); ctx.closePath(); ctx.fill();
    }

    // --- forward perspective (dash cams, social clips) --------------------------------
    function renderForward(s: SimSnapshotB, feed: CameraFeed, t: number, social: boolean, seed: number) {
      const g = s.grid;
      const moving = !!(feed.unitId && s.units.find((u) => u.id === feed.unitId)?.status === 'enroute');
      const shakeK = reduced ? 0 : social ? 3.2 : moving ? 1.1 : 0.35;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(shakeK * 0.004 * Math.sin(t * 5.3 + seed * 10));
      ctx.translate(-W / 2 + shakeK * Math.sin(t * 13.1 + seed) , -H / 2 + shakeK * Math.cos(t * 17.3 + seed * 2));
      const horizon = H * (social ? 0.5 : 0.44);
      const fov = (social ? 58 : 74) * (Math.PI / 180);
      const focal = W / 2 / Math.tan(fov / 2);
      const eye = elevAt(g, feed.pos.x, feed.pos.y) * RELIEF_M + 2.4;
      const N = thumb ? 40 : 80;
      const h0 = (feed.heading * Math.PI) / 180;
      // Fire intensity per column along each ray (6 km).
      const fire = new Float32Array(N);
      let fireMax = 0;
      for (let i = 0; i < N; i++) {
        const a = h0 + (i / (N - 1) - 0.5) * fov;
        const dx = Math.sin(a), dy = -Math.cos(a);
        let acc = 0;
        for (let dm = 120; dm < 6000; dm += thumb ? 240 : 140) {
          const x = feed.pos.x + (dx * dm) / CELL_M, y = feed.pos.y + (dy * dm) / CELL_M;
          if (x < 0 || y < 0 || x >= GRID_W || y >= GRID_H) break;
          const ci = Math.floor(y) * g.w + Math.floor(x);
          if (g.state[ci] === CellState.Burning) acc += (0.35 + g.heat[ci]) * (1 - dm / 6000);
        }
        fire[i] = Math.min(1.5, acc * 0.35);
        if (fire[i] > fireMax) fireMax = fire[i];
      }
      const smoke = clamp(fireMax * 0.6 + Math.min(0.4, s.metrics.acres / 6000), 0, 1);
      // Sky.
      const sky = ctx.createLinearGradient(0, 0, 0, horizon);
      sky.addColorStop(0, rgba(mixRgb(C.ink900, C.ink700, smoke * 0.4), 1));
      sky.addColorStop(1, rgba(mixRgb(C.ink600, mixRgb(C.amber, C.signalDeep, 0.4), 0.12 + smoke * 0.3), 1));
      ctx.fillStyle = sky;
      ctx.fillRect(-20, -20, W + 40, horizon + 22);
      // Ridge layers, far to near; each takes the max elevation angle in its depth slab.
      const layers = [9000, 5500, 3200, 1800, 900, 420];
      const colOf = (k: number) => {
        const near = k / (layers.length - 1);
        return mixRgb(mixRgb(C.ink500, C.amber, 0.06 + smoke * 0.08), C.ink950, 0.25 + near * 0.7);
      };
      let prev = 12000;
      layers.forEach((dist, k) => {
        ctx.beginPath();
        ctx.moveTo(-20, H + 20);
        for (let i = 0; i < N; i++) {
          const a = h0 + (i / (N - 1) - 0.5) * fov;
          const dx = Math.sin(a), dy = -Math.cos(a);
          let best = -Infinity;
          for (const f of [0.7, 0.85, 1]) {
            const dm = dist + (prev - dist) * (1 - f) * 0.5;
            const e = elevAt(g, feed.pos.x + (dx * dm) / CELL_M, feed.pos.y + (dy * dm) / CELL_M) * RELIEF_M;
            const ang = (e - eye) / dm;
            if (ang > best) best = ang;
          }
          const y = horizon - best * focal;
          const x = (i / (N - 1)) * W;
          if (i === 0) ctx.lineTo(-20, y);
          ctx.lineTo(x, y);
          if (i === N - 1) ctx.lineTo(W + 20, y);
        }
        ctx.lineTo(W + 20, H + 20);
        ctx.closePath();
        ctx.fillStyle = rgba(colOf(k), 1);
        ctx.fill();
        prev = dist;
      });
      // Fire glow on the horizon.
      if (fireMax > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        const cw = W / N;
        for (let i = 0; i < N; i++) {
          if (fire[i] < 0.02) continue;
          const fl = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 9 + i * 1.7) + 0.1 * Math.sin(t * 23 + i);
          const a = Math.min(0.4, fire[i] * 0.3) * fl;
          const gh = H * 0.26;
          const gr = ctx.createLinearGradient(0, horizon - gh, 0, horizon + gh * 0.25);
          gr.addColorStop(0, rgba(C.signalDeep, 0));
          gr.addColorStop(0.65, rgba(C.signal, a * 0.6));
          gr.addColorStop(0.85, rgba(C.signalHot, a));
          gr.addColorStop(1, rgba(C.amber, 0));
          ctx.fillStyle = gr;
          ctx.fillRect(i * cw - cw * 1.5, horizon - gh, cw * 4, gh * 1.25);
        }
        ctx.globalCompositeOperation = 'source-over';
        // Smoke plumes rising from the brightest columns.
        let bi = 0;
        for (let i = 1; i < N; i++) if (fire[i] > fire[bi]) bi = i;
        const px = (bi / (N - 1)) * W;
        for (let j = 0; j < 4; j++) {
          const ph = reduced ? j / 4 : ((t * 0.05 + j / 4) % 1);
          const y = horizon - H * 0.08 - ph * H * 0.45;
          const r = W * (0.08 + ph * 0.22);
          const gr = ctx.createRadialGradient(px + ph * W * 0.12, y, 0, px + ph * W * 0.12, y, r);
          gr.addColorStop(0, rgba(C.ink400, 0.3 * (1 - ph) * Math.min(1, fireMax * 1.5)));
          gr.addColorStop(1, rgba(C.ink400, 0));
          ctx.fillStyle = gr;
          ctx.fillRect(px + ph * W * 0.12 - r, y - r, r * 2, r * 2);
        }
      }
      // Haze band over the horizon.
      const hz = ctx.createLinearGradient(0, horizon - H * 0.12, 0, horizon + H * 0.06);
      hz.addColorStop(0, rgba(C.ink500, 0));
      hz.addColorStop(0.6, rgba(C.ink500, 0.12 + smoke * 0.18));
      hz.addColorStop(1, rgba(C.ink500, 0));
      ctx.fillStyle = hz;
      ctx.fillRect(-20, horizon - H * 0.12, W + 40, H * 0.18);
      if (!social) {
        // Road: trapezoid to the vanishing point with a centre dash that streams while moving.
        const vx = W / 2, vy = horizon + 2, bot = H + 10;
        ctx.fillStyle = rgba(C.ink800, 0.9);
        ctx.beginPath(); ctx.moveTo(vx - 2, vy); ctx.lineTo(vx + 2, vy); ctx.lineTo(W * 0.92, bot); ctx.lineTo(W * 0.08, bot); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba(C.bone, 0.22);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(vx - 2, vy); ctx.lineTo(W * 0.12, bot); ctx.moveTo(vx + 2, vy); ctx.lineTo(W * 0.88, bot); ctx.stroke();
        const phase = moving && !reduced ? (t * 1.6) % 1 : 0.3;
        ctx.fillStyle = rgba(C.amber, 0.5);
        for (let j = 0; j < 9; j++) {
          const z = 1 + (j + 1 - phase) * 1.6;
          const y0 = vy + (bot - vy) / z, y1 = vy + (bot - vy) / (z + 0.7);
          const w0 = 3 / z;
          ctx.beginPath(); ctx.moveTo(vx - w0, y0); ctx.lineTo(vx + w0, y0); ctx.lineTo(vx + w0 * 0.7, y1); ctx.lineTo(vx - w0 * 0.7, y1); ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore();
      // Vignette + grain.
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, rgba(C.void, 0));
      vg.addColorStop(1, rgba(C.void, social ? 0.65 : 0.5));
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      if (social) {
        ctx.globalCompositeOperation = 'saturation';
        ctx.fillStyle = rgba(C.ink500, 0.75);
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }
      return { moving };
    }

    function dashHud(s: SimSnapshotB, feed: CameraFeed, t: number, moving: boolean) {
      const band = thumb ? 14 : 24;
      ctx.fillStyle = rgba(C.ink950, 0.92);
      ctx.beginPath();
      ctx.moveTo(0, H); ctx.lineTo(0, H - band); ctx.quadraticCurveTo(W / 2, H - band - (thumb ? 6 : 12), W, H - band); ctx.lineTo(W, H); ctx.closePath();
      ctx.fill();
      const pm = thumb ? 6 : 10;
      const blink = reduced || Math.floor(t * 1.4) % 2 === 0;
      txt(feed.label.toUpperCase(), pm, thumb ? 11 : 16, C.bone, thumb ? 7 : 9, 0.95);
      if (thumb) return;
      ctx.font = fontStr(9);
      setSpacing(ctx, '0.12em');
      const lw = ctx.measureText(feed.label.toUpperCase()).width;
      ctx.fillStyle = rgba(C.ember, blink ? 1 : 0.25);
      ctx.beginPath(); ctx.arc(pm + lw + 8, 12.5, 2.5, 0, Math.PI * 2); ctx.fill();
      txt('REC', pm + lw + 14, 16, C.bone, 8, 0.95);
      const spd = moving ? Math.round(38 + 6 * Math.sin(t * 0.4)) : 0;
      const hdg = Math.round(((feed.heading % 360) + 360) % 360);
      txt(`${pad(spd, 3)} KM/H · HDG ${pad(hdg, 3)}°`, pm, H - 8, C.boneDim, 8, 0.9);
      txt(`${zulu(s.clock)} · GRID ${gridRef(feed.pos)}`, W - pm, H - 8, C.boneDim, 8, 0.9, 'right');
    }

    function socialFrame(s: SimSnapshotB, feed: CameraFeed, t: number) {
      const sw = Math.min(W, H * (9 / 16) * 1.15);
      const x0 = (W - sw) / 2;
      ctx.fillStyle = rgba(C.ink950, 0.86);
      ctx.fillRect(0, 0, x0, H);
      ctx.fillRect(x0 + sw, 0, W - x0 - sw, H);
      ctx.strokeStyle = rgba(C.bone, 0.18);
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, 0.5, sw - 1, H - 1);
      const ago = Math.max(1, Math.round((s.t - (feed.capturedAt ?? s.t)) / 60));
      const px = thumb ? 6 : 8;
      txt(`SOCIAL · ${ago} MIN AGO · APPROX LOC`, x0 + 6, px + 6, C.bone, px, 0.95, 'left', true);
      if (!thumb) txt(feed.label.toUpperCase(), x0 + 6, px + 22, C.boneMute, 7, 0.9, 'left', true);
      // Clip scrub bar loops every 14 s.
      const p = reduced ? 0.4 : (t % 14) / 14;
      const by = H - (thumb ? 5 : 9);
      ctx.fillStyle = rgba(C.bone, 0.2);
      ctx.fillRect(x0 + 6, by, sw - 12, 2);
      ctx.fillStyle = rgba(C.bone, 0.85);
      ctx.fillRect(x0 + 6, by, (sw - 12) * p, 2);
    }

    function noSignal(t: number) {
      ctx.fillStyle = rgba(C.void, 1);
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < (thumb ? 80 : 240); i++) {
        const x = hash2(i, (t * 30) | 0) * W, y = hash2(i * 7, (t * 30) | 0) * H;
        ctx.fillStyle = rgba(C.boneMute, 0.25);
        ctx.fillRect(x, y, 2, 1);
      }
      txt('NO SIGNAL', W / 2, H / 2 + 3, C.boneMute, thumb ? 7 : 9, 0.9, 'center');
    }

    let raf = 0, last = 0, frameNo = 0;
    const frame = (nowMs: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      const fps = reduced ? FPS_REDUCED : thumb ? FPS_THUMB : FPS_FULL;
      if (nowMs - last < 1000 / fps - 2) return;
      last = nowMs;
      frameNo++;
      const t = nowMs / 1000;
      const s = engine.state;
      const feed = s.feeds.find((f) => f.id === feedRef.current);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!feed) { noSignal(t); return; }
      const seed = strHash(feed.id);
      if (feed.kind === 'drone' || feed.kind === 'satellite') {
        const pal = feed.kind === 'satellite' ? 'eo' : paletteFor(feed);
        const v = renderTop(s, feed, pal, t, seed);
        droneOverlay(s, feed, pal, v, t, frameNo, seed);
      } else {
        const social = feed.kind === 'social';
        const { moving } = renderForward(s, feed, t, social, seed);
        if (social) socialFrame(s, feed, t);
        else dashHud(s, feed, t, moving);
      }
    };

    const ro = new ResizeObserver(layout);
    ro.observe(root);
    const io = new IntersectionObserver((e) => { visible = e.some((x) => x.isIntersecting); });
    io.observe(root);
    layout();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mq.removeEventListener?.('change', onMq);
    };
  }, [engine, variant]);

  return (
    <div ref={rootRef} className={cn('absolute inset-0 overflow-hidden bg-void', className)} data-feed={feedId}>
      <canvas ref={canvasRef} className="block" aria-hidden />
      <div aria-hidden className="pointer-events-none absolute inset-0 fcc-scanlines opacity-40" />
    </div>
  );
}
