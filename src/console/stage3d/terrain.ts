import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import { FuelClass, type ScenarioPack } from '../contracts';
import { RasterSampler } from './raster';

const DEG = Math.PI / 180;
const TILE = 33;

/**
 * Token-less terrain: a CustomHeightmapTerrainProvider fed from pack.elevation. Outside the scenario
 * bbox the surface eases to the mean elevation so the edge never smears.
 */
export function createHeightmapTerrain(s: RasterSampler): Cesium.CustomHeightmapTerrainProvider {
  const ts = new Cesium.GeographicTilingScheme();
  const [bw, bs, be, bn] = s.bbox;
  const pad = 0.25;
  return new Cesium.CustomHeightmapTerrainProvider({
    width: TILE,
    height: TILE,
    tilingScheme: ts,
    callback: (x, y, level) => {
      const r = ts.tileXYToRectangle(x, y, level);
      const west = r.west / DEG, east = r.east / DEG, south = r.south / DEG, north = r.north / DEG;
      const out = new Float32Array(TILE * TILE);
      if (east < bw - pad || west > be + pad || north < bs - pad || south > bn + pad) {
        out.fill(s.mean);
        return out;
      }
      for (let j = 0; j < TILE; j++) {
        const lat = north - (j / (TILE - 1)) * (north - south);
        for (let i = 0; i < TILE; i++) {
          const lon = west + (i / (TILE - 1)) * (east - west);
          out[j * TILE + i] = s.elevation(lon, lat);
        }
      }
      return out;
    },
  });
}

/* ------------------------------------------------------------------ offline relief composite */

type RGB = [number, number, number];
const toRgb = (hex: string): RGB => {
  const c = Cesium.Color.fromCssColorString(hex);
  return [c.red * 255, c.green * 255, c.blue * 255];
};
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Fuel colors are derived from design tokens (ink ramp tinted toward phosphor / amber / ice). */
function fuelPalette(): RGB[] {
  const ink9 = toRgb(ds.ink[900]), ink8 = toRgb(ds.ink[800]), ink7 = toRgb(ds.ink[700]), ink6 = toRgb(ds.ink[600]), ink5 = toRgb(ds.ink[500]);
  const ph = toRgb(ds.phosphor), am = toRgb(ds.amber), ic = toRgb(ds.ice), bo = toRgb(ds.bone.DEFAULT);
  const p: RGB[] = [];
  p[FuelClass.None] = mix(ink7, am, 0.08);
  p[FuelClass.Water] = mix(ink9, ic, 0.22);
  p[FuelClass.Rock] = mix(ink6, bo, 0.1);
  p[FuelClass.Grass] = mix(mix(ink6, am, 0.28), bo, 0.12);
  p[FuelClass.Shrub] = mix(mix(ink7, am, 0.16), ph, 0.08);
  p[FuelClass.TimberLitter] = mix(ink8, ph, 0.17);
  p[FuelClass.TimberUnderstory] = mix(ink9, ph, 0.15);
  p[FuelClass.Urban] = mix(ink5, bo, 0.08);
  p[FuelClass.Agriculture] = mix(mix(ink6, ph, 0.2), am, 0.12);
  return p;
}

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`imagery load failed: ${url}`));
    img.src = url;
  });
}

export interface Composite {
  url: string;
  rectangle: Cesium.Rectangle;
  width: number;
  height: number;
  /** "imagery" when pack.imagery was used, else "fuel" (procedural from fuel classes). */
  base: 'imagery' | 'fuel';
}

const compositeCache = new WeakMap<ScenarioPack, Promise<Composite>>();

/** Shared between the stage and the feed renderer (built once per pack). */
export function getComposite(pack: ScenarioPack, s: RasterSampler): Promise<Composite> {
  let p = compositeCache.get(pack);
  if (!p) {
    p = buildComposite(pack, s);
    compositeCache.set(pack, p);
  }
  return p;
}

/**
 * Bakes imagery (or fuel colors), hillshade, canopy texture, 40 m contours, roads, water and buildings into
 * one geographic image. CustomHeightmapTerrainProvider has no vertex normals, so relief must be baked.
 */
async function buildComposite(pack: ScenarioPack, s: RasterSampler): Promise<Composite> {
  const { w, h, bbox } = pack.raster;
  const midLat = (bbox[1] + bbox[3]) / 2;
  const groundW = (bbox[2] - bbox[0]) * 111320 * Math.cos(midLat * DEG);
  const groundH = (bbox[3] - bbox[1]) * 110540;
  const W = Math.min(3780, Math.max(2048, Math.round(w * 4)));
  const H = Math.min(3780, Math.round((W * groundH) / groundW));

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;

  // 1. Base color.
  let base: Composite['base'] = 'fuel';
  if (pack.imagery) {
    try {
      const img = await loadImage(pack.imagery.url);
      const ib = pack.imagery.bbox;
      const x0 = ((ib[0] - bbox[0]) / (bbox[2] - bbox[0])) * W;
      const x1 = ((ib[2] - bbox[0]) / (bbox[2] - bbox[0])) * W;
      const y0 = ((bbox[3] - ib[3]) / (bbox[3] - bbox[1])) * H;
      const y1 = ((bbox[3] - ib[1]) / (bbox[3] - bbox[1])) * H;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0);
      base = 'imagery';
    } catch {
      base = 'fuel';
    }
  }
  if (base === 'fuel') {
    const pal = fuelPalette();
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const sctx = small.getContext('2d')!;
    const id = sctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const c = pal[pack.fuel[i]] ?? pal[0];
      id.data[i * 4] = c[0];
      id.data[i * 4 + 1] = c[1];
      id.data[i * 4 + 2] = c[2];
      id.data[i * 4 + 3] = 255;
    }
    sctx.putImageData(id, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
  }

  // 2. Hillshade at raster resolution (sun NW 315°, 38° altitude, z-factor 1.6).
  const shade = new Float32Array(w * h);
  const cell = pack.raster.cellM || groundW / w;
  const zen = (90 - 38) * DEG, az = 315 * DEG, zf = 1.6;
  const E = (x: number, y: number) => s.elevation(...cellLL(s, x, y));
  const elevGrid = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) elevGrid[y * w + x] = E(x, y);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(h - 1, y + 1);
      const dzdx = ((elevGrid[y * w + xr] - elevGrid[y * w + xl]) / ((xr - xl) * cell)) * zf;
      const dzdy = ((elevGrid[yd * w + x] - elevGrid[yu * w + x]) / ((yd - yu) * cell)) * zf;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      // ESRI hillshade convention: dzdy is measured toward the south (image rows).
      const aspect = Math.atan2(dzdy, -dzdx);
      const azMath = (360 - az / DEG + 90) * DEG;
      const v = Math.cos(zen) * Math.cos(slope) + Math.sin(zen) * Math.sin(slope) * Math.cos(azMath - aspect);
      shade[y * w + x] = Math.max(0, v);
    }
  }

  // 3. Per-pixel: shade × base × canopy grain, contours, edge falloff.
  const img = ctx.getImageData(0, 0, W, H);
  const px = img.data;
  const prevBand = new Int16Array(W);
  const bone = toRgb(ds.bone.DEFAULT);
  const edgePx = Math.round(W * 0.012);
  const sx = w / W, sy = h / H;
  for (let py = 0; py < H; py++) {
    let cy = (py + 0.5) * sy - 0.5;
    if (cy < 0) cy = 0; else if (cy > h - 1) cy = h - 1;
    const y0 = Math.floor(cy), y1 = Math.min(h - 1, y0 + 1), ty = cy - y0;
    let leftBand = -9999;
    const edgeY = Math.min(py, H - 1 - py);
    for (let pxx = 0; pxx < W; pxx++) {
      let cx = (pxx + 0.5) * sx - 0.5;
      if (cx < 0) cx = 0; else if (cx > w - 1) cx = w - 1;
      const x0 = Math.floor(cx), x1 = Math.min(w - 1, x0 + 1), tx = cx - x0;
      const i00 = y0 * w + x0, i10 = y0 * w + x1, i01 = y1 * w + x0, i11 = y1 * w + x1;
      const e = (elevGrid[i00] * (1 - tx) + elevGrid[i10] * tx) * (1 - ty) + (elevGrid[i01] * (1 - tx) + elevGrid[i11] * tx) * ty;
      const sh = (shade[i00] * (1 - tx) + shade[i10] * tx) * (1 - ty) + (shade[i01] * (1 - tx) + shade[i11] * tx) * ty;
      const fuel = pack.fuel[(ty < 0.5 ? y0 : y1) * w + (tx < 0.5 ? x0 : x1)];
      const n = hash2(pxx, py);
      let grain = 1;
      if (fuel === FuelClass.TimberLitter || fuel === FuelClass.TimberUnderstory) {
        const n2 = hash2(pxx >> 1, py >> 1);
        grain = 0.72 + 0.4 * n2 * n2 + 0.08 * n;
      } else if (fuel === FuelClass.Shrub) grain = 0.86 + 0.22 * hash2(pxx >> 1, py >> 1);
      else grain = 0.94 + 0.1 * n;
      const light = (0.28 + 1.05 * sh) * grain;
      const o = (py * W + pxx) * 4;
      let r = px[o] * light, g = px[o + 1] * light, b = px[o + 2] * light;
      const band = Math.floor(e / 40);
      if ((leftBand !== -9999 && band !== leftBand) || (py > 0 && band !== prevBand[pxx])) {
        const k = band % 5 === 0 ? 0.26 : 0.1;
        r += (bone[0] - r) * k; g += (bone[1] - g) * k; b += (bone[2] - b) * k;
      }
      leftBand = band;
      prevBand[pxx] = band;
      const edge = Math.min(edgeY, pxx, W - 1 - pxx);
      if (edge < edgePx) {
        const k = edge / edgePx;
        const f = 0.15 + 0.85 * k * k;
        r *= f; g *= f; b *= f;
      }
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 4. Vector detail.
  const X = (lon: number) => ((lon - bbox[0]) / (bbox[2] - bbox[0])) * W;
  const Y = (lat: number) => ((bbox[3] - lat) / (bbox[3] - bbox[1])) * H;
  const css = (hexStr: string, a: number) => {
    const c = toRgb(hexStr);
    return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  };
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const wtr of pack.water) {
    if (wtr.polygon.length < 3) continue;
    ctx.beginPath();
    wtr.polygon.forEach((p, i) => (i ? ctx.lineTo(X(p.lon), Y(p.lat)) : ctx.moveTo(X(p.lon), Y(p.lat))));
    ctx.closePath();
    ctx.fillStyle = css(ds.ink[950], 0.85);
    ctx.fill();
    ctx.strokeStyle = css(ds.ice, 0.35);
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  const roadStyle = {
    highway: { a: 0.42, w: 2.6, dash: [] as number[] },
    road: { a: 0.26, w: 1.4, dash: [] as number[] },
    track: { a: 0.16, w: 1, dash: [4, 4] },
  };
  for (const kind of ['track', 'road', 'highway'] as const) {
    const st = roadStyle[kind];
    ctx.strokeStyle = css(ds.bone.DEFAULT, st.a);
    ctx.lineWidth = st.w;
    ctx.setLineDash(st.dash);
    ctx.beginPath();
    for (const r of pack.roads) {
      if (r.kind !== kind || r.coords.length < 2) continue;
      r.coords.forEach((p, i) => (i ? ctx.lineTo(X(p.lon), Y(p.lat)) : ctx.moveTo(X(p.lon), Y(p.lat))));
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = css(ds.bone.DEFAULT, 0.38);
  for (const b of pack.buildings) {
    const x = X(b.pos.lon), y = Y(b.pos.lat);
    ctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);
  }

  // Wrap in a dark margin: edge texels get clamped outward by the globe, so they must match the base color.
  const mx = Math.round(W * 0.04), my = Math.round(H * 0.04);
  const out = document.createElement('canvas');
  out.width = W + mx * 2;
  out.height = H + my * 2;
  const octx = out.getContext('2d')!;
  octx.fillStyle = ds.ink[950];
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(cv, mx, my);
  const dLon = ((bbox[2] - bbox[0]) * mx) / W, dLat = ((bbox[3] - bbox[1]) * my) / H;
  const blob: Blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.92));
  const url = URL.createObjectURL(blob);
  return {
    url,
    rectangle: Cesium.Rectangle.fromDegrees(bbox[0] - dLon, bbox[1] - dLat, bbox[2] + dLon, bbox[3] + dLat),
    width: out.width,
    height: out.height,
    base,
  };
}

function cellLL(s: RasterSampler, x: number, y: number): [number, number] {
  const g = s.cellGeo(x, y);
  return [g.lon, g.lat];
}

/** NASA GIBS VIIRS true color for the replay date: keyless regional context outside the bbox. */
export function createGibsContext(date: string): Cesium.WebMapTileServiceImageryProvider {
  return new Cesium.WebMapTileServiceImageryProvider({
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/250m/{TileMatrix}/{TileRow}/{TileCol}.jpg`,
    layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSetID: '250m',
    maximumLevel: 8,
    tileWidth: 512,
    tileHeight: 512,
    // GIBS EPSG:4326 level-0 tiles span 288° (512 px × 0.5625°/px) from the top-left corner (-180, 90).
    tilingScheme: new Cesium.GeographicTilingScheme({
      numberOfLevelZeroTilesX: 2,
      numberOfLevelZeroTilesY: 1,
      rectangle: Cesium.Rectangle.fromDegrees(-180, -198, 396, 90),
    }),
    credit: new Cesium.Credit('NASA GIBS · VIIRS SNPP'),
  });
}

/* ------------------------------------------------------------------ close-range surface detail */

function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/**
 * Procedural imagery overlay for close views (drone / dash / helmet cameras): tree crowns, shrub and
 * grass grain in metric world space, keyed by fuel class. Only shown from terrain level ~12 down, so
 * the 10 m/px relief composite does not smear into a flat colour at 200 m altitude.
 */
export function createDetailLayer(pack: ScenarioPack, s: RasterSampler): Cesium.ImageryLayer {
  const tilingScheme = new Cesium.GeographicTilingScheme();
  const size = 256;
  const lat0 = (s.bbox[1] + s.bbox[3]) / 2;
  const mLon = 111320 * Math.cos(lat0 * DEG), mLat = 110540;
  const ink = toRgb(ds.void), bone = toRgb(ds.bone.DEFAULT);
  const rect = Cesium.Rectangle.fromDegrees(s.bbox[0], s.bbox[1], s.bbox[2], s.bbox[3]);
  const provider = {
    tilingScheme,
    tileWidth: size,
    tileHeight: size,
    minimumLevel: 0,
    maximumLevel: 19,
    rectangle: rect,
    tileDiscardPolicy: undefined,
    errorEvent: new Cesium.Event(),
    credit: undefined,
    proxy: undefined,
    hasAlphaChannel: true,
    ready: true,
    readyPromise: Promise.resolve(true),
    getTileCredits: () => undefined,
    pickFeatures: () => undefined,
    requestImage: (x: number, y: number, level: number) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      if (level < 12) return Promise.resolve(c);
      const r = tilingScheme.tileXYToRectangle(x, y, level);
      const g = c.getContext('2d')!;
      const img = g.createImageData(size, size);
      const d = img.data;
      const w = (r.east - r.west) / DEG, h = (r.north - r.south) / DEG;
      const west = r.west / DEG, north = r.north / DEG;
      for (let py = 0; py < size; py++) {
        const lat = north - ((py + 0.5) / size) * h;
        const my = lat * mLat;
        for (let px = 0; px < size; px++) {
          const lon = west + ((px + 0.5) / size) * w;
          const idx = s.cellIndex(lon, lat);
          const o = (py * size + px) * 4;
          if (idx < 0) { d[o + 3] = 0; continue; }
          const fuel = pack.fuel[idx];
          const mx = lon * mLon;
          let dark = 0, light = 0;
          if (fuel === FuelClass.TimberLitter || fuel === FuelClass.TimberUnderstory) {
            const n = vnoise(mx / 6.5, my / 6.5) * 0.7 + vnoise(mx / 2.1, my / 2.1) * 0.3;
            dark = Math.max(0, (n - 0.42) * 1.6) * 0.75;
            light = Math.max(0, (0.3 - n) * 1.2) * 0.25;
          } else if (fuel === FuelClass.Shrub) {
            const n = vnoise(mx / 2.6, my / 2.6);
            dark = Math.max(0, (n - 0.5) * 1.4) * 0.5;
            light = Math.max(0, (0.25 - n)) * 0.3;
          } else if (fuel === FuelClass.Grass || fuel === FuelClass.Agriculture || fuel === FuelClass.None) {
            const n = hash2(Math.floor(mx * 1.5), Math.floor(my * 1.5));
            dark = n > 0.7 ? (n - 0.7) * 0.9 : 0;
            light = n < 0.12 ? (0.12 - n) * 1.6 : 0;
          } else if (fuel === FuelClass.Rock) {
            const n = vnoise(mx / 1.3, my / 1.3);
            dark = Math.max(0, n - 0.6) * 0.6;
          }
          if (light > dark) {
            d[o] = bone[0]; d[o + 1] = bone[1]; d[o + 2] = bone[2]; d[o + 3] = Math.min(255, light * 255);
          } else {
            d[o] = ink[0]; d[o + 1] = ink[1]; d[o + 2] = ink[2]; d[o + 3] = Math.min(255, dark * 255);
          }
        }
      }
      g.putImageData(img, 0, 0);
      return Promise.resolve(c);
    },
  };
  return new Cesium.ImageryLayer(provider as unknown as Cesium.ImageryProvider, { minimumTerrainLevel: 12, rectangle: rect });
}
