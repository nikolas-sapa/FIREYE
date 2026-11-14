/**
 * Offscreen layer builders for the tactical map. Everything here is computed
 * once per world (terrain, fuel, contours) or re-rasterized when grid.version
 * changes (fire). Palette values are derived from design tokens.
 */
import { color, role } from '@ds';
import { CELL_M, CellState, Fuel, type Grid } from '@/sim/types';
import { createNoise2D, fbm, RELIEF_M } from '@/sim/terrain';

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mixRgb = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const rgba = (c: string | RGB, a: number) => {
  const [r, g, b] = typeof c === 'string' ? hexToRgb(c) : c;
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
};

export const C = {
  void: hexToRgb(color.void),
  ink950: hexToRgb(color.ink[950]),
  ink900: hexToRgb(color.ink[900]),
  ink800: hexToRgb(color.ink[800]),
  ink700: hexToRgb(color.ink[700]),
  ink600: hexToRgb(color.ink[600]),
  ink500: hexToRgb(color.ink[500]),
  ink400: hexToRgb(color.ink[400]),
  bone: hexToRgb(color.bone.DEFAULT),
  boneDim: hexToRgb(color.bone.dim),
  boneMute: hexToRgb(color.bone.mute),
  signal: hexToRgb(color.signal.DEFAULT),
  signalHot: hexToRgb(color.signal.hot),
  signalDeep: hexToRgb(color.signal.deep),
  ember: hexToRgb(color.ember),
  amber: hexToRgb(color.amber),
  phosphor: hexToRgb(color.phosphor),
  ice: hexToRgb(color.ice),
  violet: hexToRgb(color.violet),
  scar: hexToRgb(role.burnScar),
};

/** Satellite-imagery palette: desaturated ink tones nudged toward a hue. */
function terrainPalette(): RGB[] {
  const p: RGB[] = [];
  const dim = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
  p[Fuel.Water] = mixRgb(C.void, C.ice, 0.05);
  p[Fuel.Rock] = dim(mixRgb(C.ink600, C.amber, 0.03), 0.82);
  p[Fuel.Grass] = mixRgb(C.ink700, C.amber, 0.07);
  p[Fuel.Brush] = dim(mixRgb(mixRgb(C.ink700, C.amber, 0.04), C.phosphor, 0.025), 0.9);
  p[Fuel.Timber] = dim(mixRgb(C.ink700, C.phosphor, 0.035), 0.74);
  p[Fuel.Urban] = mixRgb(C.ink700, C.bone, 0.04);
  p[Fuel.Road] = p[Fuel.Grass];
  p[Fuel.Burnt] = C.scar;
  return p;
}

function blurField(src: Float32Array, w: number, h: number, passes: number): Float32Array {
  let a = src.slice();
  const b = new Float32Array(a.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            s += a[yy * w + xx]; n++;
          }
        }
        b[y * w + x] = s / n;
      }
    }
    a = b.slice();
  }
  return a;
}

/** Hillshaded, fuel-tinted base imagery at `R` px per cell. */
export function buildTerrainCanvas(grid: Grid, R = 5): HTMLCanvasElement {
  const { w, h, fuel } = grid;
  const el = blurField(grid.elevation, w, h, 1);
  const W = w * R, H = h * R;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const pal = terrainPalette();
  // Per-cell color + water weight, softened once so fuel patches read as imagery, not tiles.
  const N = w * h;
  let field = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const c = pal[fuel[i]];
    field[i * 4] = c[0]; field[i * 4 + 1] = c[1]; field[i * 4 + 2] = c[2]; field[i * 4 + 3] = fuel[i] === Fuel.Water ? 1 : 0;
  }
  {
    const out = new Float32Array(N * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const water = fuel[i] === Fuel.Water;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        // Keep shorelines crisp: water and land do not bleed into each other.
        if ((fuel[j] === Fuel.Water) !== water) continue;
        const k = dx === 0 && dy === 0 ? 2 : 1;
        out[i * 4] += field[j * 4] * k; out[i * 4 + 1] += field[j * 4 + 1] * k; out[i * 4 + 2] += field[j * 4 + 2] * k;
        n += k;
      }
      out[i * 4] /= n; out[i * 4 + 1] /= n; out[i * 4 + 2] /= n; out[i * 4 + 3] = field[i * 4 + 3];
    }
    field = out;
  }
  const mottle = createNoise2D(911);
  const sample = (fx: number, fy: number) => {
    const gx = Math.min(Math.max(fx - 0.5, 0), w - 1.001), gy = Math.min(Math.max(fy - 0.5, 0), h - 1.001);
    const x0 = gx | 0, y0 = gy | 0, tx = gx - x0, ty = gy - y0;
    const i = y0 * w + x0;
    return (el[i] * (1 - tx) + el[i + 1] * tx) * (1 - ty) + (el[i + w] * (1 - tx) + el[i + w + 1] * tx) * ty;
  };
  // Light from the north-west, 42° altitude.
  const L = [-0.53, -0.53, 0.66];
  const zf = (RELIEF_M / CELL_M) * 2.4;
  for (let py = 0; py < H; py++) {
    const fy = (py + 0.5) / R;
    for (let px = 0; px < W; px++) {
      const fx = (px + 0.5) / R;
      const e = sample(fx, fy);
      const dzdx = (sample(fx + 0.5, fy) - sample(fx - 0.5, fy)) * zf;
      const dzdy = (sample(fx, fy + 0.5) - sample(fx, fy - 0.5)) * zf;
      const nl = 1 / Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = Math.max(0, (-dzdx * L[0] - dzdy * L[1] + L[2]) * nl);

      // Bilinear blend of the 4 surrounding cell colors.
      const gx = Math.min(Math.max(fx - 0.5, 0), w - 1.001), gy = Math.min(Math.max(fy - 0.5, 0), h - 1.001);
      const x0 = gx | 0, y0 = gy | 0, tx = gx - x0, ty = gy - y0;
      const i = y0 * w + x0;
      const ws0 = (1 - tx) * (1 - ty), ws1 = tx * (1 - ty), ws2 = (1 - tx) * ty, ws3 = tx * ty;
      const a0 = i * 4, a1 = (i + 1) * 4, a2 = (i + w) * 4, a3 = (i + w + 1) * 4;
      const r = field[a0] * ws0 + field[a1] * ws1 + field[a2] * ws2 + field[a3] * ws3;
      const g = field[a0 + 1] * ws0 + field[a1 + 1] * ws1 + field[a2 + 1] * ws2 + field[a3 + 1] * ws3;
      const b = field[a0 + 2] * ws0 + field[a1 + 2] * ws1 + field[a2 + 2] * ws2 + field[a3 + 2] * ws3;
      const water = field[a0 + 3] * ws0 + field[a1 + 3] * ws1 + field[a2 + 3] * ws2 + field[a3 + 3] * ws3;
      const m = (fbm(mottle, fx / 4, fy / 4, 3) - 0.5) * 0.22;
      const grain = ((((px * 73856093) ^ (py * 19349663)) >>> 0) % 1000) / 1000 - 0.5;
      const land = (0.28 + 0.95 * shade) * (0.78 + 0.34 * e) * (1 + m + grain * 0.07);
      const wet = 0.95 + grain * 0.04 + m * 0.3;
      const k = land * (1 - water) + wet * water;
      const o = (py * W + px) * 4;
      d[o] = r * k; d[o + 1] = g * k; d[o + 2] = b * k; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Categorical fuel-model overlay at 1 px per cell (draw with smoothing off). */
export function buildFuelCanvas(grid: Grid): HTMLCanvasElement {
  const { w, h, fuel, dryness } = grid;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const col: Record<number, [RGB, number]> = {
    [Fuel.Grass]: [C.amber, 0.22], [Fuel.Brush]: [C.signalHot, 0.24], [Fuel.Timber]: [C.phosphor, 0.2],
    [Fuel.Urban]: [C.bone, 0.28], [Fuel.Rock]: [C.ink400, 0.3], [Fuel.Water]: [C.ice, 0.22], [Fuel.Road]: [C.bone, 0.12],
  };
  for (let i = 0; i < w * h; i++) {
    const e = col[fuel[i]];
    if (!e) continue;
    const [c, a] = e;
    const o = i * 4;
    const dry = fuel[i] === Fuel.Grass || fuel[i] === Fuel.Brush || fuel[i] === Fuel.Timber ? 0.5 + dryness[i] * 0.8 : 1;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = Math.min(255, a * dry * 255);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Marching-squares contour paths in cell coordinates. */
export function buildContours(grid: Grid, levels = 25): { minor: Path2D; major: Path2D } {
  const { w, h } = grid;
  const el = blurField(grid.elevation, w, h, 2);
  const minor = new Path2D(), major = new Path2D();
  for (let li = 1; li < levels; li++) {
    const lv = li / levels;
    const path = li % 5 === 0 ? major : minor;
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const a = el[y * w + x], b = el[y * w + x + 1], c = el[(y + 1) * w + x + 1], dd = el[(y + 1) * w + x];
        const idx = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (dd > lv ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const ox = x + 0.5, oy = y + 0.5;
        const T = () => [ox + (lv - a) / (b - a), oy] as const;
        const Rr = () => [ox + 1, oy + (lv - b) / (c - b)] as const;
        const B = () => [ox + (lv - dd) / (c - dd), oy + 1] as const;
        const Lf = () => [ox, oy + (lv - a) / (dd - a)] as const;
        const seg = (p: readonly [number, number], q: readonly [number, number]) => { path.moveTo(p[0], p[1]); path.lineTo(q[0], q[1]); };
        switch (idx) {
          case 1: case 14: seg(Lf(), B()); break;
          case 2: case 13: seg(B(), Rr()); break;
          case 3: case 12: seg(Lf(), Rr()); break;
          case 4: case 11: seg(T(), Rr()); break;
          case 5: seg(Lf(), T()); seg(B(), Rr()); break;
          case 6: case 9: seg(T(), B()); break;
          case 7: case 8: seg(Lf(), T()); break;
          case 10: seg(T(), Rr()); seg(Lf(), B()); break;
        }
      }
    }
  }
  return { minor, major };
}

/** Small diagonal hatch tile for pattern fills. */
export function buildHatch(c: RGB, alpha: number, size = 7): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.strokeStyle = rgba(c, alpha);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, size); ctx.lineTo(size, 0);
  ctx.moveTo(-1, 1); ctx.lineTo(1, -1);
  ctx.moveTo(size - 1, size + 1); ctx.lineTo(size + 1, size - 1);
  ctx.stroke();
  return cv;
}

export interface FireRaster {
  canvas: HTMLCanvasElement;
  img: ImageData;
  bloom: HTMLCanvasElement;
  bloomImg: ImageData;
  bloomSmall: HTMLCanvasElement;
  front: Path2D;
  hash: Float32Array;
}

export function createFireRaster(w: number, h: number): FireRaster {
  const mk = (cw: number, ch: number) => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const canvas = mk(w, h), bloom = mk(w, h), bloomSmall = mk(Math.ceil(w / 3), Math.ceil(h / 3));
  const hash = new Float32Array(w * h);
  for (let i = 0; i < hash.length; i++) hash[i] = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
  return {
    canvas, bloom, bloomSmall,
    img: canvas.getContext('2d')!.createImageData(w, h),
    bloomImg: bloom.getContext('2d')!.createImageData(w, h),
    front: new Path2D(),
    hash,
  };
}

/** Re-rasterize fire state into the raster canvases. `time` drives flicker (seconds). */
export function rasterFire(grid: Grid, fr: FireRaster, time: number, flicker: boolean, rebuildFront: boolean) {
  const { w, h, state, heat, retardant, fuel } = grid;
  const d = fr.img.data, bd = fr.bloomImg.data;
  const scar = C.scar, deep = C.signalDeep, sig = C.signal, hot = C.signalHot, amb = C.amber, sup = mixRgb(C.ink800, C.ice, 0.08);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const s = state[i];
    bd[o + 3] = 0;
    if (s === CellState.Unburnt) {
      const r = retardant[i];
      if (r > 0.12 && fuel[i] !== Fuel.Water) {
        d[o] = deep[0]; d[o + 1] = deep[1] * 0.7; d[o + 2] = deep[2] * 0.9; d[o + 3] = Math.min(150, r * 150);
      } else d[o + 3] = 0;
      continue;
    }
    const hv = fr.hash[i];
    if (s === CellState.Burnt) {
      const k = 0.8 + hv * 0.35;
      d[o] = scar[0] * k; d[o + 1] = scar[1] * k; d[o + 2] = scar[2] * k; d[o + 3] = 225;
      continue;
    }
    if (s === CellState.Suppressed) {
      d[o] = sup[0]; d[o + 1] = sup[1]; d[o + 2] = sup[2]; d[o + 3] = 220;
      continue;
    }
    // Burning.
    const f = flicker ? 0.8 + 0.2 * Math.sin(time * (7 + hv * 9) + hv * 40) : 1;
    const t = Math.min(1, Math.pow(heat[i] * (0.7 + hv * 0.5), 1.5) * f);
    let c: RGB;
    if (t < 0.45) c = mixRgb(deep, sig, t / 0.45);
    else if (t < 0.8) c = mixRgb(sig, hot, (t - 0.45) / 0.35);
    else c = mixRgb(hot, amb, (t - 0.8) / 0.2);
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 120 + t * 135;
    bd[o] = c[0]; bd[o + 1] = c[1]; bd[o + 2] = c[2]; bd[o + 3] = 60 + t * 160;
  }
  fr.canvas.getContext('2d')!.putImageData(fr.img, 0, 0);
  fr.bloom.getContext('2d')!.putImageData(fr.bloomImg, 0, 0);
  const sctx = fr.bloomSmall.getContext('2d')!;
  sctx.clearRect(0, 0, fr.bloomSmall.width, fr.bloomSmall.height);
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(fr.bloom, 0, 0, fr.bloomSmall.width, fr.bloomSmall.height);

  if (rebuildFront) {
    const p = new Path2D();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (state[i] !== CellState.Burning) continue;
        if (x > 0 && state[i - 1] === CellState.Unburnt) { p.moveTo(x, y); p.lineTo(x, y + 1); }
        if (x < w - 1 && state[i + 1] === CellState.Unburnt) { p.moveTo(x + 1, y); p.lineTo(x + 1, y + 1); }
        if (y > 0 && state[i - w] === CellState.Unburnt) { p.moveTo(x, y); p.lineTo(x + 1, y); }
        if (y < h - 1 && state[i + w] === CellState.Unburnt) { p.moveTo(x, y + 1); p.lineTo(x + 1, y + 1); }
      }
    }
    fr.front = p;
  }
}
