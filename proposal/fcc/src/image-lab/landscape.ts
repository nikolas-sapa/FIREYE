import { FuelClass } from '../console/contracts';
import { runTravelTime, SpreadSeeds, type SpreadWeather } from '../console/agents/spread';
import { GRID_IMAGE_PX, GRID_TILE_PX, type Bounds, type GridScene } from './grid';

/**
 * Landscape pipeline shared by the local server, the browser and tests:
 * CORINE land cover -> fuel classes, Terrarium elevation, hourly weather, optional AI review, spread.
 * Pure functions only; no network or DOM access.
 */
export const LANDSCAPE_SCHEMA = 'fcc-landscape-v1';
/** Model cells per side. 10.24 km / 256 = 40 m ground cells, the console's sim cell size. */
export const MODEL_SIDE = 256;
export const MODEL_CELLS = MODEL_SIDE * MODEL_SIDE;
/** Image pixels per model cell along one axis (1,024 px source / 256). */
export const PX_PER_CELL = GRID_IMAGE_PX / MODEL_SIDE;
export const SPREAD_HORIZON_MIN = 360;
export const SPREAD_BANDS_MIN = [60, 180, 360] as const;
export const TERRAIN_ZOOM = 12;

export const LANDSCAPE_SOURCES = {
  corine: {
    id: 'clc2018', name: 'CORINE Land Cover 2018 (vector, 25 ha minimum mapping unit)',
    url: 'https://image.discomap.eea.europa.eu/arcgis/rest/services/Corine/CLC2018_WM/MapServer/0',
    license: 'Copernicus open data. © European Union, Copernicus Land Monitoring Service 2018, European Environment Agency (EEA)',
    note: 'Reference year 2018. About 100 m positional detail; patches under 25 ha are merged into neighbours.',
  },
  terrain: {
    id: 'terrarium', name: `Mapzen / AWS Terrain Tiles (Terrarium), zoom ${TERRAIN_ZOOM}`,
    url: 'https://registry.opendata.aws/terrain-tiles/',
    license: 'Open sources (SRTM, EU-DEM, GMTED and others); attribution per https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
    note: 'About 30 m source detail at this latitude, bilinearly resampled to 40 m cells.',
  },
  weather: {
    id: 'open-meteo', name: 'Open-Meteo Forecast API, hourly 10 m wind, gusts, 2 m temperature and humidity',
    url: 'https://open-meteo.com/en/docs',
    license: 'CC BY 4.0 (Open-Meteo.com)',
    note: 'Single grid point at the scene centre. Forecast, not observation; local terrain channelling is not resolved.',
  },
} as const;

export const FUEL_INFO: Record<FuelClass, { label: string; burns: boolean }> = {
  [FuelClass.None]: { label: 'Unmapped', burns: false },
  [FuelClass.Water]: { label: 'Water', burns: false },
  [FuelClass.Rock]: { label: 'Rock / bare', burns: false },
  [FuelClass.Grass]: { label: 'Grass / sparse', burns: true },
  [FuelClass.Shrub]: { label: 'Shrub / maquis', burns: true },
  [FuelClass.TimberLitter]: { label: 'Conifer litter', burns: true },
  [FuelClass.TimberUnderstory]: { label: 'Broadleaf / mixed forest', burns: true },
  [FuelClass.Urban]: { label: 'Built-up', burns: true },
  [FuelClass.Agriculture]: { label: 'Agriculture', burns: true },
};

/** Same CORINE mapping as the Mati scenario builder (scripts/fetch-mati.mjs), without its Mati-specific WUI refinement. */
export function clcToFuel(code: number): FuelClass {
  if (code >= 111 && code <= 133) return FuelClass.Urban;
  if (code === 141 || code === 142) return FuelClass.Grass;
  if (code >= 211 && code <= 244) return FuelClass.Agriculture;
  if (code === 311 || code === 313) return FuelClass.TimberUnderstory;
  if (code === 312) return FuelClass.TimberLitter;
  if (code === 321 || code === 333) return FuelClass.Grass;
  if (code === 322 || code === 323 || code === 324 || code === 334) return FuelClass.Shrub;
  if (code === 331 || code === 332 || code === 335) return FuelClass.Rock;
  if (code >= 411 && code <= 423) return FuelClass.Grass;
  if (code >= 511 && code <= 523) return FuelClass.Water;
  return FuelClass.None;
}

/* ------------------------------------------------------------------ geometry */

const R = 6378137;
export const mercX = (lon: number) => R * lon * Math.PI / 180;
export const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
export const lonOf = (x: number) => x / R * 180 / Math.PI;
export const latOf = (y: number) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;

export interface ModelGrid {
  side: number;
  /** EPSG:3857 bounds shared with the satellite image. Row 0 is north. */
  bounds: Bounds;
  /** Ground metres per cell at the scene centre (Mercator scale corrected). */
  cellM: number;
  cellHa: number;
}

export function modelGrid(scene: Pick<GridScene, 'bounds' | 'center'>): ModelGrid {
  const [w, , e] = scene.bounds;
  const cellM = (e - w) / MODEL_SIDE * Math.cos(scene.center.lat * Math.PI / 180);
  return { side: MODEL_SIDE, bounds: scene.bounds, cellM, cellHa: cellM * cellM / 10_000 };
}

export function cellLonLat(grid: ModelGrid, index: number): { lon: number; lat: number } {
  const [w, , e, n] = grid.bounds;
  const size = (e - w) / grid.side;
  return { lon: lonOf(w + (index % grid.side + 0.5) * size), lat: latOf(n - (Math.floor(index / grid.side) + 0.5) * size) };
}

/** Even-odd scanline fill of lon/lat rings into a side x side raster (cell centres). */
export function rasterizeRings(rings: number[][][], out: Uint16Array, value: number, bounds: Bounds, side = MODEL_SIDE) {
  const [w, s, e, n] = bounds;
  const toX = (lon: number) => (mercX(lon) - w) / (e - w) * side;
  const toY = (lat: number) => (n - mercY(lat)) / (n - s) * side;
  const edges: [number, number, number, number][] = [];
  let yMin = Infinity, yMax = -Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const edge: [number, number, number, number] = [toX(ring[j][0]), toY(ring[j][1]), toX(ring[i][0]), toY(ring[i][1])];
      edges.push(edge);
      yMin = Math.min(yMin, edge[1], edge[3]); yMax = Math.max(yMax, edge[1], edge[3]);
    }
  }
  const xs: number[] = [];
  for (let y = Math.max(0, Math.floor(yMin)); y < Math.min(side, Math.ceil(yMax) + 1); y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (const [x1, y1, x2, y2] of edges) {
      if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) xs.push(x1 + (cy - y1) / (y2 - y1) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5));
      const b = Math.min(side - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) out[y * side + x] = value;
    }
  }
}

/** Terrarium tiles covering the scene at TERRAIN_ZOOM, row-major from the north-west. */
export function terrainTiles(bounds: Bounds, zoom = TERRAIN_ZOOM) {
  const world = 2 * Math.PI * R, size = world / 2 ** zoom;
  const tx = (x: number) => Math.floor((x + world / 2) / size);
  const ty = (y: number) => Math.floor((world / 2 - y) / size);
  const [w, s, e, n] = bounds;
  const tiles: { z: number; x: number; y: number }[] = [];
  for (let y = ty(n); y <= ty(s); y++) for (let x = tx(w); x <= tx(e); x++) tiles.push({ z: zoom, x, y });
  return { tiles, x0: tx(w), y0: ty(n), columns: tx(e) - tx(w) + 1, rows: ty(s) - ty(n) + 1, tileM: size, world };
}

/** Bilinear resample of decoded Terrarium RGB tiles (in terrainTiles order) to model cell centres. */
export function resampleTerrain(bounds: Bounds, rgbTiles: Uint8Array[], zoom = TERRAIN_ZOOM, side = MODEL_SIDE): Float32Array {
  const layout = terrainTiles(bounds, zoom);
  if (rgbTiles.length !== layout.tiles.length || rgbTiles.some(t => t.length !== 256 * 256 * 3)) throw new Error('Terrain tile set is incomplete.');
  const TW = layout.columns * 256, TH = layout.rows * 256;
  const mosaic = new Float32Array(TW * TH);
  rgbTiles.forEach((rgb, k) => {
    const ox = (k % layout.columns) * 256, oy = Math.floor(k / layout.columns) * 256;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const p = (y * 256 + x) * 3;
      mosaic[(oy + y) * TW + ox + x] = rgb[p] * 256 + rgb[p + 1] + rgb[p + 2] / 256 - 32768;
    }
  });
  const [w, , e, n] = bounds;
  const cell = (e - w) / side, px = layout.tileM / 256;
  const originX = layout.x0 * layout.tileM - layout.world / 2, originY = layout.world / 2 - layout.y0 * layout.tileM;
  const out = new Float32Array(side * side);
  for (let y = 0; y < side; y++) {
    const py = Math.min(TH - 2, Math.max(0, (originY - (n - (y + 0.5) * cell)) / px - 0.5));
    const iy = Math.floor(py), fy = py - iy;
    for (let x = 0; x < side; x++) {
      const pxx = Math.min(TW - 2, Math.max(0, (w + (x + 0.5) * cell - originX) / px - 0.5));
      const ix = Math.floor(pxx), fx = pxx - ix;
      const a = mosaic[iy * TW + ix], b = mosaic[iy * TW + ix + 1], c = mosaic[(iy + 1) * TW + ix], d = mosaic[(iy + 1) * TW + ix + 1];
      out[y * side + x] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
  }
  return out;
}

export function baseFuel(clc: Uint16Array): Uint8Array {
  const fuel = new Uint8Array(clc.length);
  for (let i = 0; i < clc.length; i++) fuel[i] = clcToFuel(clc[i]);
  return fuel;
}

/* ------------------------------------------------------------------ AI review */

export const REVIEW_PROMPT_VERSION = 'fcc-landcover-review-v5';
export const REVIEW_HALO_PX = 64;
export const REVIEW_INPUT_PX = GRID_TILE_PX + REVIEW_HALO_PX;
/** A cell's review counts only if at most this share of its pixels is off the three-color palette. */
export const REVIEW_MAX_OFF_PALETTE = 0.15;
/** Max RGB distance from a palette color; farther pixels are off-palette and count as uncertain. */
export const REVIEW_COLOR_TOLERANCE = 45;
export const REVIEW_CLASSES = [
  { id: 'V', label: 'Visible vegetation cover', rgb: [255, 184, 0], hex: '#FFB800' },
  { id: 'N', label: 'Exposed surface or water', rgb: [92, 200, 255], hex: '#5CC8FF' },
  { id: 'U', label: 'Uncertain or mixed', rgb: [146, 146, 152], hex: '#929298' },
] as const;
export enum Review { V = 0, N = 1, U = 2 }

/** Halo crop for a 2x2 cell: the cell plus REVIEW_HALO_PX of each interior neighbour. */
export function reviewCrop(index: number): { x: number; y: number; size: number; cellX: number; cellY: number } {
  const col = index % 2, row = Math.floor(index / 2);
  const x = col ? GRID_IMAGE_PX - REVIEW_INPUT_PX : 0, y = row ? GRID_IMAGE_PX - REVIEW_INPUT_PX : 0;
  return { x, y, size: REVIEW_INPUT_PX, cellX: col * GRID_TILE_PX - x, cellY: row * GRID_TILE_PX - y };
}

export function reviewPrompt(label: string): string {
  return `Convert IMAGE 1 into a three-class visible land-cover mask for review. IMAGE 1 is the ${label} cell of a fixed 2 by 2 grid, with a narrow overlap margin, cut from a historical 2020 Sentinel-2 cloudless RGB mosaic of inland Greece, about 10 metres per native pixel. It is not current imagery and the mask is not a wildfire-risk map or a fire forecast.

IMAGE 2 is a downscaled view of the whole landscape that IMAGE 1 belongs to. Use IMAGE 2 only to judge what counts as dark or bright in this scene, so that every cell is judged on the same absolute scale. Never draw IMAGE 2, never include its extent, and never copy its layout. The output frame is exactly IMAGE 1.

Geometry is the highest priority. The output must overlay IMAGE 1 pixel for pixel: same north-up orientation, square frame, positions, sizes and shapes of valleys, ridges, fields, villages and water. Do not crop, zoom, rotate, shift, mirror, add margins or redraw terrain.

The output uses exactly three flat, opaque sRGB colors, given only as hex codes:
V = #FFB800
N = #5CC8FF
U = #929298
There are only three classes. Dense canopy, sparse canopy, forest and shrub are all the same class V and get exactly #FFB800; there is no darker or lighter version of any class. Do not reproduce any color from IMAGE 1. Any pixel that is not one of the three hex codes is invalid.

V (#FFB800), clearly visible vegetation cover: the dark, finely mottled texture of tree or dense shrub canopy (maquis), dark ribbons of vegetation along stream valleys, and dark vegetated patches on slopes, including small dark patches scattered across open terrain when they are clearly canopy. Mark the full connected extent of those patches. Do not infer species, moisture, dead fuel or flammability.

N (#5CC8FF), clearly exposed non-vegetated surface: open water such as lakes, reservoirs and sea, and bright, smooth bare rock and limestone slopes where no dark canopy texture is visible. Thin roads and tracks are not separate N areas.

U (#929298), everything else: smooth light fields and terraces, sparse speckled low vegetation mixed with soil or rock, villages and buildings, deep shadow, and any area you cannot classify with confidence. U is not safe or low risk.

Apply exactly the same absolute rule everywhere. Do not rebalance classes per cell, do not try to make the cell look varied, and do not fill a cell with one class unless the evidence really is uniform. Follow major visible boundaries at the native resolution; do not invent individual bushes or tiny noise polygons smaller than about 3 native pixels.

Output nothing but the mask: no source texture, transparency, shading, gradients, outlines, hatching, text, labels, legend, frame, grid lines, arrows or watermark. Every pixel must be exactly #FFB800, #5CC8FF or #929298.`;
}

export interface ReviewCell {
  index: number;
  /** Fraction of the full output (halo included) that is off-palette. */
  offPalette: number;
  accepted: boolean;
  /** Per model cell inside this 2x2 cell: [V, N, U] fractions, length (MODEL_SIDE / 2)^2 * 3. */
  shares: Float32Array;
  counts: [number, number, number];
  /** Labels for the whole halo output (REVIEW_INPUT_PX square, row-major), used to blend shared edges. */
  labels?: Uint8Array;
  /** The resampled RGBA output itself, for the blended mosaic and PNG export. Never exported to JSON. */
  pixels?: Uint8ClampedArray;
}

/**
 * Classifies an RGBA review output already resampled to REVIEW_INPUT_PX (nearest neighbour), crops the cell,
 * and aggregates labels to model cells. Off-palette pixels count as U and against the gate.
 */
export function classifyReview(index: number, rgba: Uint8ClampedArray | Uint8Array, size = REVIEW_INPUT_PX): ReviewCell {
  if (size !== REVIEW_INPUT_PX || rgba.length !== size * size * 4) throw new Error('Review output must be resampled to the halo size.');
  const labels = new Uint8Array(size * size);
  let off = 0;
  const tol = REVIEW_COLOR_TOLERANCE ** 2;
  for (let i = 0; i < labels.length; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    let best = Review.U, bestD = Infinity;
    REVIEW_CLASSES.forEach((c, k) => {
      const d = (r - c.rgb[0]) ** 2 + (g - c.rgb[1]) ** 2 + (b - c.rgb[2]) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    });
    if (bestD > tol) { best = Review.U; off++; }
    labels[i] = best;
  }
  const crop = reviewCrop(index), half = MODEL_SIDE / 2;
  const shares = new Float32Array(half * half * 3);
  const counts: [number, number, number] = [0, 0, 0];
  const per = 1 / (PX_PER_CELL * PX_PER_CELL);
  for (let y = 0; y < GRID_TILE_PX; y++) for (let x = 0; x < GRID_TILE_PX; x++) {
    const label = labels[(crop.cellY + y) * size + crop.cellX + x];
    counts[label]++;
    shares[(Math.floor(y / PX_PER_CELL) * half + Math.floor(x / PX_PER_CELL)) * 3 + label] += per;
  }
  const offPalette = off / labels.length;
  return { index, offPalette, accepted: offPalette <= REVIEW_MAX_OFF_PALETTE, shares, counts, labels };
}

/* ------------------------------------------------------------------ seamless stitching */

/** Pixel origin of a cell's halo output in the 1,024 px scene. */
export function reviewOrigin(index: number): { x: number; y: number } {
  const crop = reviewCrop(index);
  return { x: crop.x, y: crop.y };
}

/**
 * Feather weight of a cell's halo output at scene pixel (x, y). Neighbouring halos share a 128 px band
 * centred on each cut line; inside it the weight ramps linearly from 1 to 0 across the band, so the two
 * (or, at the centre, four) outputs cross-fade and their weights always sum to 1. Outside the band the
 * owning cell has weight 1 and its neighbours 0.
 */
export function featherWeight(index: number, x: number, y: number): number {
  const ramp = (v: number, second: boolean) => {
    const lo = GRID_IMAGE_PX - REVIEW_INPUT_PX, hi = REVIEW_INPUT_PX;
    const first = v < lo ? 1 : v >= hi ? 0 : (hi - (v + 0.5)) / (hi - lo);
    return second ? 1 - first : first;
  };
  return ramp(x, index % 2 === 1) * ramp(y, index >= 2);
}

const ownerOf = (x: number, y: number) => (y >= GRID_TILE_PX ? 2 : 0) + (x >= GRID_TILE_PX ? 1 : 0);

/**
 * Stitches per-cell review labels into one scene-wide field. A pixel is reviewed only if its owning cell
 * is included; there, every included cell whose halo covers the pixel votes with its feather weight, so
 * shared edges blend instead of switching at a hard seam. Returns per-model-cell [V, N, U] shares, a coverage
 * mask, and each covered model cell's owning review index.
 */
export function stitchReviews(reviews: (ReviewCell | undefined)[], include: (review: ReviewCell) => boolean = r => r.accepted) {
  const used = [0, 1, 2, 3].map(i => {
    const r = reviews[i];
    return r && r.index === i && include(r) ? r : undefined;
  });
  const shares = new Float32Array(MODEL_CELLS * 3);
  const covered = new Uint8Array(MODEL_CELLS);
  const owner = new Int8Array(MODEL_CELLS).fill(-1);
  const per = 1 / (PX_PER_CELL * PX_PER_CELL);
  const origins = [0, 1, 2, 3].map(reviewOrigin);
  const votes = [0, 0, 0];
  for (let y = 0; y < GRID_IMAGE_PX; y++) for (let x = 0; x < GRID_IMAGE_PX; x++) {
    const own = ownerOf(x, y), mine = used[own];
    if (!mine) continue;
    const m = Math.floor(y / PX_PER_CELL) * MODEL_SIDE + Math.floor(x / PX_PER_CELL);
    covered[m] = 1; owner[m] = own;
    if (!mine.labels) {
      // Legacy cell without halo labels: spread its own-cell shares evenly over the model cell.
      const half = MODEL_SIDE / 2, mx = Math.floor(x / PX_PER_CELL) % half, my = Math.floor(y / PX_PER_CELL) % half;
      for (let k = 0; k < 3; k++) shares[m * 3 + k] += mine.shares[(my * half + mx) * 3 + k] * per;
      continue;
    }
    votes[0] = votes[1] = votes[2] = 0;
    let sum = 0;
    for (let c = 0; c < 4; c++) {
      const r = used[c];
      if (!r?.labels) continue;
      const w = featherWeight(c, x, y);
      if (w <= 0) continue;
      votes[r.labels[(y - origins[c].y) * REVIEW_INPUT_PX + x - origins[c].x]] += w;
      sum += w;
    }
    for (let k = 0; k < 3; k++) shares[m * 3 + k] += votes[k] / sum * per;
  }
  return { shares, covered, owner };
}

/** Share of shared-overlap pixels on which two neighbouring outputs give the same label (both halo frames). */
export function overlapAgreement(reviews: (ReviewCell | undefined)[]) {
  const lo = GRID_IMAGE_PX - REVIEW_INPUT_PX, hi = REVIEW_INPUT_PX;
  const pairs: [string, number, number, [number, number, number, number]][] = [
    ['NW|NE', 0, 1, [lo, hi, 0, hi]], ['SW|SE', 2, 3, [lo, hi, lo, GRID_IMAGE_PX]],
    ['NW|SW', 0, 2, [0, hi, lo, hi]], ['NE|SE', 1, 3, [lo, GRID_IMAGE_PX, lo, hi]],
  ];
  const out: Record<string, number> = {};
  for (const [name, a, b, [x0, x1, y0, y1]] of pairs) {
    const ra = reviews[a]?.labels, rb = reviews[b]?.labels;
    if (!ra || !rb) continue;
    const oa = reviewOrigin(a), ob = reviewOrigin(b);
    let same = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      n++;
      if (ra[(y - oa.y) * REVIEW_INPUT_PX + x - oa.x] === rb[(y - ob.y) * REVIEW_INPUT_PX + x - ob.x]) same++;
    }
    out[name] = same / n;
  }
  return out;
}

/**
 * Feather-blends the raw (resampled) RGBA outputs into one 1,024 px scene image. Pixels whose owning cell
 * has no output stay transparent; neighbours without an output drop out of the blend.
 */
export function blendOutputs(pixels: (Uint8ClampedArray | Uint8Array | undefined)[]): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(GRID_IMAGE_PX * GRID_IMAGE_PX * 4);
  const origins = [0, 1, 2, 3].map(reviewOrigin);
  for (let y = 0; y < GRID_IMAGE_PX; y++) for (let x = 0; x < GRID_IMAGE_PX; x++) {
    if (!pixels[ownerOf(x, y)]) continue;
    let r = 0, g = 0, b = 0, sum = 0;
    for (let c = 0; c < 4; c++) {
      const p = pixels[c];
      if (!p) continue;
      const w = featherWeight(c, x, y);
      if (w <= 0) continue;
      const o = ((y - origins[c].y) * REVIEW_INPUT_PX + x - origins[c].x) * 4;
      r += p[o] * w; g += p[o + 1] * w; b += p[o + 2] * w; sum += w;
    }
    const o = (y * GRID_IMAGE_PX + x) * 4;
    out[o] = Math.round(r / sum); out[o + 1] = Math.round(g / sum); out[o + 2] = Math.round(b / sum); out[o + 3] = 255;
  }
  return out;
}

export type FusionMode = 'base' | 'add' | 'full';
export enum FuelOrigin { Base = 0, AiAdded = 1, AiChanged = 2, AiRemoved = 3 }
export const V_MIN = 0.6;
export const N_MIN = 0.75;

/**
 * Combines the CORINE fuel with accepted review cells.
 * 'add' only turns non-burnable land (not water) into shrub where the review sees connected vegetation, so it can
 * add spread paths that the 25 ha CORINE patches miss but never removes one. 'full' also lets confident review
 * cells change agriculture to shrub and burnable land to rock; it can speed up or slow down the spread.
 * Disagreements are flagged in every mode, including 'base'.
 */
export function fuseFuel(base: Uint8Array, reviews: (ReviewCell | undefined)[], mode: FusionMode) {
  const fuel = base.slice();
  const origin = new Uint8Array(base.length);
  const disagree = new Uint8Array(base.length);
  let changed = 0, disagreements = 0, reviewed = 0;
  const { shares, covered } = stitchReviews(reviews);
  {
    for (let i = 0; i < MODEL_CELLS; i++) {
      if (!covered[i]) continue;
      const v = shares[i * 3], n = shares[i * 3 + 1];
      const f = base[i] as FuelClass, burns = FUEL_INFO[f].burns;
      reviewed++;
      if ((burns && f !== FuelClass.Urban && n >= N_MIN) || (!burns && f !== FuelClass.Water && v >= V_MIN) || (f === FuelClass.Water && v >= V_MIN)) {
        disagree[i] = 1; disagreements++;
      }
      if (mode === 'base') continue;
      if (!burns && f !== FuelClass.Water && v >= V_MIN) { fuel[i] = FuelClass.Shrub; origin[i] = FuelOrigin.AiAdded; changed++; }
      else if (mode === 'full' && f === FuelClass.Agriculture && v >= V_MIN) { fuel[i] = FuelClass.Shrub; origin[i] = FuelOrigin.AiChanged; changed++; }
      else if (mode === 'full' && burns && f !== FuelClass.Urban && n >= N_MIN) { fuel[i] = FuelClass.Rock; origin[i] = FuelOrigin.AiRemoved; changed++; }
    }
  }
  return { fuel, origin, disagree, changed, disagreements, reviewed };
}

/* ------------------------------------------------------------------ weather + spread */

export interface WeatherHour extends SpreadWeather { t: number; gustKph: number }
export interface WeatherSeries {
  source: 'open-meteo' | 'manual';
  fetchedAt?: string;
  point?: { lat: number; lon: number; elevationM?: number };
  hours: WeatherHour[];
}
export interface WindChoice {
  mode: 'forecast' | 'manual';
  /** Index into the forecast hours for the ignition hour. */
  startHour: number;
  useGusts: boolean;
  manual: SpreadWeather;
}

/** Weather for model hour h after ignition. Forecast hours past the end hold the last hour (persistence). */
export function weatherFor(series: WeatherSeries | undefined, choice: WindChoice): (hour: number) => SpreadWeather {
  if (choice.mode === 'manual' || !series?.hours.length) return () => choice.manual;
  return hour => {
    const w = series.hours[Math.min(series.hours.length - 1, choice.startHour + hour)];
    return { windKph: choice.useGusts ? Math.max(w.windKph, w.gustKph) : w.windKph, windDirDeg: w.windDirDeg, tempC: w.tempC, rh: w.rh };
  };
}

export interface SpreadResult {
  ignition: number;
  arrival: Float32Array;
  areasHa: Record<(typeof SPREAD_BANDS_MIN)[number], number>;
  /**
   * Main run: compass bearing from ignition to the centroid of the modelled area, and the farthest reach
   * along that bearing. The single farthest cell is not used; on the 16-neighbour stencil it sits on a
   * corner of the head, tens of degrees off the wind.
   */
  run: { distanceM: number; bearingDeg: number } | null;
  reachedEdge: boolean;
  computeMs: number;
}

export function runLandscapeSpread(grid: ModelGrid, fuel: Uint8Array, elevation: Float32Array, ignition: number,
  weather: (hour: number) => SpreadWeather, horizonMin = SPREAD_HORIZON_MIN): SpreadResult {
  if (ignition < 0 || ignition >= MODEL_CELLS) throw new Error('Ignition is outside the landscape.');
  if (!FUEL_INFO[fuel[ignition] as FuelClass]?.burns) throw new Error('The ignition cell is not burnable in this fuel map.');
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const seeds = new SpreadSeeds();
  seeds.push(ignition, 0);
  const arrival = runTravelTime({ gw: MODEL_SIDE, gh: MODEL_SIDE, dxM: grid.cellM, dyM: grid.cellM, fuel, elev: elevation, horizonMin, weatherAt: weather }, seeds);
  const areasHa = { 60: 0, 180: 0, 360: 0 };
  const ix = ignition % MODEL_SIDE, iy = Math.floor(ignition / MODEL_SIDE);
  let sx = 0, sy = 0, cells = 0, reachedEdge = false;
  for (let i = 0; i < arrival.length; i++) {
    const t = arrival[i];
    if (!(t <= horizonMin)) continue;
    for (const band of SPREAD_BANDS_MIN) if (t <= band) areasHa[band] += grid.cellHa;
    const x = i % MODEL_SIDE, y = Math.floor(i / MODEL_SIDE);
    if (x === 0 || y === 0 || x === MODEL_SIDE - 1 || y === MODEL_SIDE - 1) reachedEdge = true;
    sx += x - ix; sy += y - iy; cells++;
  }
  let run: SpreadResult['run'] = null;
  const norm = Math.hypot(sx, sy);
  if (cells > 1 && norm / cells > 0.5) {
    const ux = sx / norm, uy = sy / norm;
    let reach = 0;
    for (let i = 0; i < arrival.length; i++) {
      if (arrival[i] <= horizonMin) reach = Math.max(reach, (i % MODEL_SIDE - ix) * ux + (Math.floor(i / MODEL_SIDE) - iy) * uy);
    }
    run = { distanceM: reach * grid.cellM, bearingDeg: (Math.atan2(ux, -uy) * 180 / Math.PI + 360) % 360 };
  }
  return {
    ignition, arrival, areasHa, reachedEdge, run,
    computeMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}

/* ------------------------------------------------------------------ transport + export */

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
export function fromBase64(text: string): Uint8Array {
  const raw = atob(text), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const bytesOf = (view: ArrayBufferView) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
export const encodeArray = (view: Uint8Array | Uint16Array | Float32Array) => toBase64(bytesOf(view));
export function decodeUint16(text: string, length = MODEL_CELLS): Uint16Array {
  const bytes = fromBase64(text);
  if (bytes.length !== length * 2) throw new Error('Land-cover raster has the wrong size.');
  return new Uint16Array(bytes.buffer, bytes.byteOffset, length);
}
export function decodeFloat32(text: string, length = MODEL_CELLS): Float32Array {
  const bytes = fromBase64(text);
  if (bytes.length !== length * 4) throw new Error('Elevation raster has the wrong size.');
  const out = new Float32Array(bytes.buffer, bytes.byteOffset, length);
  if (out.some(v => !Number.isFinite(v) || v < -500 || v > 9000)) throw new Error('Elevation raster contains invalid values.');
  return out;
}

/** Wire format of GET /grid/{id}/landscape. */
export interface LandscapePayload {
  side: number;
  clc: string;
  elevation: string;
  polygons: number;
  sources: { id: string; fetchedAt: string; detail: string }[];
}

/** Arrival minutes as Uint16 (65535 = not reached within the horizon) for compact export. */
export function encodeArrival(arrival: Float32Array): string {
  const out = new Uint16Array(arrival.length);
  for (let i = 0; i < arrival.length; i++) out[i] = arrival[i] <= 65534 ? Math.round(arrival[i]) : 65535;
  return encodeArray(out);
}

export interface LandscapeExportInput {
  scene: GridScene;
  sources: LandscapePayload['sources'];
  baseFuel: Uint8Array;
  fused: ReturnType<typeof fuseFuel>;
  elevation: Float32Array;
  fusion: FusionMode;
  weather?: WeatherSeries;
  wind: WindChoice;
  review: {
    model?: string;
    retries?: number;
    tiles: {
      index: number; label: string; status: string; requestId?: string; review?: ReviewCell;
      /** Every paid attempt for the cell, in order; `review` and `requestId` describe the one in use. */
      attempts?: { requestId?: string; review?: ReviewCell }[];
    }[];
  };
  spread?: SpreadResult;
  notes?: string;
  imagery: { name: string; license: string; url: string };
}

export const LANDSCAPE_LIMITATIONS = [
  'Prototype minimum-travel-time spread. It is not a validated fire behaviour model and it does not model spotting, suppression, fuel moisture or fire-atmosphere coupling.',
  'On the Mati 2018 replay the same solver, from detection, reached sourced checkpoints from about 30 min early to about 20 min late and burned less than half the reconstructed area; treat times as rough, not as arrival forecasts.',
  'Fuel comes from CORINE 2018 (25 ha minimum mapping unit) mapped to nine coarse classes. Small patches, roads and recent burns are not represented.',
  'Wind is a single forecast point (or a manual value) applied uniformly; terrain channelling is not resolved.',
  'Above about 30 km/h the 16-direction solver under-represents the width and area of narrow wind-driven fires; head travel is still modelled at the full rate.',
  'AI review cells are generative image outputs gated only by palette compliance. They are not accuracy-checked and they change fuel only in the selected fusion mode.',
];

/** The fcc-landscape-v1 contract: everything needed to reproduce one spread run without the lab. */
export function landscapeExport(input: LandscapeExportInput) {
  const grid = modelGrid(input.scene);
  const { spread } = input;
  return {
    schema: LANDSCAPE_SCHEMA,
    createdAt: new Date().toISOString(),
    scene: { id: input.scene.id, region: input.scene.region, center: input.scene.center },
    grid: { side: grid.side, crs: 'EPSG:3857', bounds: grid.bounds, cellM: grid.cellM, rowOrder: 'north-first', encoding: 'base64 little-endian, row-major' },
    sources: { imagery: input.imagery, ...LANDSCAPE_SOURCES, fetched: input.sources },
    fuelClasses: FUEL_INFO,
    layers: {
      fuelBase: encodeArray(input.baseFuel),
      fuel: encodeArray(input.fused.fuel),
      fuelOrigin: encodeArray(input.fused.origin),
      disagree: encodeArray(input.fused.disagree),
      elevationM: encodeArray(input.elevation),
    },
    review: {
      promptVersion: REVIEW_PROMPT_VERSION, model: input.review.model, retries: input.review.retries, fusion: input.fusion,
      gate: { maxOffPalette: REVIEW_MAX_OFF_PALETTE, colorTolerance: REVIEW_COLOR_TOLERANCE, vMin: V_MIN, nMin: N_MIN },
      classes: REVIEW_CLASSES,
      changedCells: input.fused.changed, disagreeingCells: input.fused.disagreements,
      tiles: input.review.tiles.map(t => ({ index: t.index, label: t.label, status: t.status, requestId: t.requestId,
        offPalette: t.review?.offPalette, accepted: t.review?.accepted, pixelCounts: t.review?.counts,
        attempts: t.attempts?.map(a => ({ requestId: a.requestId, offPalette: a.review?.offPalette, accepted: a.review?.accepted })) })),
    },
    weather: { series: input.weather, choice: input.wind },
    spread: spread ? {
      ignition: { index: spread.ignition, ...cellLonLat(grid, spread.ignition) },
      horizonMin: SPREAD_HORIZON_MIN, bandsMin: SPREAD_BANDS_MIN, areasHa: spread.areasHa, run: spread.run,
      reachedEdge: spread.reachedEdge, arrivalMin: encodeArrival(spread.arrival), arrivalEncoding: 'uint16 minutes, 65535 = not reached',
    } : null,
    notes: input.notes ?? '',
    limitations: LANDSCAPE_LIMITATIONS,
  };
}
