import { labRequest, pollLab, type PreparedImage } from './client';
import { GRID_COUNT, GRID_IMAGE_PX, GRID_TILE_PX, type GridScene } from './grid';
import {
  MODEL_SIDE, REVIEW_INPUT_PX, baseFuel, blendOutputs, classifyReview, decodeFloat32, decodeUint16, reviewCrop,
  type LandscapePayload, type ReviewCell, type WeatherSeries,
} from './landscape';
import { LAB_API, type LabResult } from './protocol';

/** One paid generation for a cell. A retry is a new attempt; an attempt is never regenerated. */
export interface GridAttempt {
  jobId?: string;
  requestId?: string;
  result?: LabResult;
  review?: ReviewCell;
}
export interface GridTileRun {
  index: number;
  /** The exact 512 px cell, for display and stitching. */
  source: PreparedImage;
  /** The cell plus a 64 px overlap margin: the image actually sent for review. */
  halo: string;
  /** Whole scene at 512 px, sent with every cell so all four are judged on one scale. */
  context: string;
  status: string;
  attempts: GridAttempt[];
  /** True once an attempt passed the palette gate or the retry budget is spent. */
  done?: boolean;
  error?: string;
}
export interface GridSettings { model: string; retries: number }

/** The attempt whose output a cell uses: the first accepted one, otherwise the least off-palette. */
export function bestAttempt(tile: GridTileRun): number | undefined {
  let best: number | undefined;
  tile.attempts.forEach((attempt, i) => {
    const review = attempt.review;
    if (!review) return;
    const current = best === undefined ? undefined : tile.attempts[best].review!;
    if (!current || (!current.accepted && (review.accepted || review.offPalette < current.offPalette))) best = i;
  });
  return best;
}
export async function splitSatellite(blob: Blob, scene: GridScene): Promise<GridTileRun[]> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth !== GRID_IMAGE_PX || image.naturalHeight !== GRID_IMAGE_PX) {
      throw new Error('Satellite provider returned the wrong dimensions. No analysis was submitted.');
    }
    const draw = (sx: number, sy: number, size: number, out: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = out;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable.');
      context.drawImage(image, sx, sy, size, size, 0, 0, out, out);
      return canvas.toDataURL('image/png');
    };
    const context = draw(0, 0, GRID_IMAGE_PX, GRID_TILE_PX);
    return scene.tiles.map(cell => {
      const halo = reviewCrop(cell.index);
      return { index: cell.index, status: 'Ready', attempts: [], context, halo: draw(halo.x, halo.y, halo.size, halo.size), source: {
        dataUrl: draw(cell.crop[0], cell.crop[1], GRID_TILE_PX, GRID_TILE_PX), name: `${scene.region}-${cell.label}.png`,
        width: GRID_TILE_PX, height: GRID_TILE_PX, originalWidth: GRID_TILE_PX, originalHeight: GRID_TILE_PX,
      } };
    });
  } finally { URL.revokeObjectURL(url); }
}

/**
 * Runs all four cells at once. Each cell submits, polls and palette-gates its output in the browser;
 * a rejected output is regenerated as a new attempt until one passes or the retry budget is spent.
 * Accepted jobs are polled again, never regenerated. Network and provider failures are not retried
 * automatically: the cell stops with an error, and calling this again resumes the same attempt.
 */
export async function processGrid(
  scene: GridScene, tiles: GridTileRun[], settings: GridSettings, signal: AbortSignal,
  update: (tile: GridTileRun) => void,
  submit = (index: number, tile: GridTileRun, attempt: number) => labRequest<{ jobId: string; requestId: string }>(`/grid/${scene.id}/tile/${index}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ model: settings.model, resolution: '1K', image: tile.halo, context: tile.context, attempt, retries: settings.retries }),
  }),
  poll = pollLab,
  review = (index: number, attempt: number) => readReview(scene.id, index, attempt, signal),
) {
  if (tiles.length !== GRID_COUNT || tiles.some((tile, i) => tile.index !== i)) throw new Error('Exactly four ordered cells are required.');
  const total = settings.retries + 1;
  await Promise.all(tiles.map(async initial => {
    if (initial.done || signal.aborted) return;
    let tile: GridTileRun = { ...initial, attempts: [...initial.attempts], error: undefined };
    const put = (patch: Partial<GridTileRun>) => { tile = { ...tile, ...patch }; update(tile); };
    const patchAttempt = (n: number, patch: GridAttempt) => {
      const attempts = [...tile.attempts];
      attempts[n] = { ...attempts[n], ...patch };
      put({ attempts });
    };
    try {
      while (!signal.aborted) {
        if (!tile.attempts.length) patchAttempt(0, {});
        const n = tile.attempts.length - 1;
        const label = `Attempt ${n + 1} of ${total}`;
        if (!tile.attempts[n].jobId) {
          put({ status: `${label} · submitting` });
          patchAttempt(n, await submit(tile.index, tile, n));
        }
        if (!tile.attempts[n].result) {
          put({ status: `${label} · queued` });
          const result = await poll(tile.attempts[n].jobId!, signal, state => {
            put({ status: `${label} · ${state.status === 'IN_QUEUE' ? 'queued' : state.status === 'IN_PROGRESS' ? 'analyzing' : 'complete'}` });
          });
          patchAttempt(n, { result });
        }
        if (!tile.attempts[n].review) {
          put({ status: `${label} · checking palette` });
          patchAttempt(n, { review: await review(tile.index, n) });
        }
        if (tile.attempts[n].review!.accepted || n >= settings.retries) {
          const best = tile.attempts[bestAttempt(tile)!].review!;
          put({ done: true, status: best.accepted ? `Accepted · attempt ${tile.attempts.findIndex(a => a.review === best) + 1} of ${total}`
            : `Rejected after ${n + 1} ${n ? 'attempts' : 'attempt'}` });
          return;
        }
        if (signal.aborted) return;
        patchAttempt(n + 1, {});
      }
    } catch (error) {
      if (signal.aborted) return;
      put({ status: 'Needs attention', error: error instanceof Error ? error.message : 'Could not process this cell.' });
    }
  }));
}
export async function stitchImages(sources: string[], size = GRID_TILE_PX): Promise<Blob> {
  if (sources.length !== GRID_COUNT) throw new Error('All four images are required for a stitched export.');
  const images = await Promise.all(sources.map(async src => {
    const image = new Image();
    image.src = src;
    await image.decode();
    if (image.naturalWidth !== image.naturalHeight) throw new Error('A tile changed aspect ratio. Inspect it separately; a stitched export would distort its geometry.');
    return image;
  }));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  images.forEach((image, index) => context.drawImage(image, index % 2 * size, Math.floor(index / 2) * size, size, size));
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'));
}

/**
 * Places each halo output at its true scene position and feather-blends the shared overlaps into one
 * 1,024 px image. Returns the PNG and the four exact 512 px cells of it (undefined where no output exists).
 */
export async function blendedMosaic(pixels: (Uint8ClampedArray | undefined)[]): Promise<{ blob: Blob; cells: (string | undefined)[] }> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = GRID_IMAGE_PX;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.putImageData(new ImageData(blendOutputs(pixels), GRID_IMAGE_PX, GRID_IMAGE_PX), 0, 0);
  const cells = [0, 1, 2, 3].map(index => {
    if (!pixels[index]) return undefined;
    const cell = document.createElement('canvas');
    cell.width = cell.height = GRID_TILE_PX;
    cell.getContext('2d')!.drawImage(canvas, index % 2 * GRID_TILE_PX, Math.floor(index / 2) * GRID_TILE_PX, GRID_TILE_PX, GRID_TILE_PX, 0, 0, GRID_TILE_PX, GRID_TILE_PX);
    return cell.toDataURL('image/png');
  });
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('PNG export failed.')), 'image/png'));
  return { blob, cells };
}

/**
 * Reads a completed review output through the same-origin proxy, resamples it to the halo size with
 * nearest-neighbour sampling (no new blended colors), and applies the palette gate.
 */
export async function readReview(sceneId: string, index: number, attempt: number, signal?: AbortSignal): Promise<ReviewCell> {
  const response = await fetch(outputUrl(sceneId, index, attempt), { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Could not load this review output.');
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    if (Math.abs(bitmap.width - bitmap.height) > 1) throw new Error('The review output is not square, so it cannot be registered to the cell.');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = REVIEW_INPUT_PX;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas is unavailable.');
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, REVIEW_INPUT_PX, REVIEW_INPUT_PX);
    const pixels = context.getImageData(0, 0, REVIEW_INPUT_PX, REVIEW_INPUT_PX).data;
    return { ...classifyReview(index, pixels), pixels };
  } finally { bitmap.close(); }
}

export const outputUrl = (sceneId: string, index: number, attempt: number) => `${LAB_API}/grid/${sceneId}/output/${index}/${attempt}`;

export interface LoadedLandscape {
  clc: Uint16Array;
  fuel: Uint8Array;
  elevation: Float32Array;
  polygons: number;
  sources: LandscapePayload['sources'];
}

/** Keyless land cover and terrain through the local proxy. Never touches fal. */
export async function loadLandscape(sceneId: string, signal?: AbortSignal): Promise<LoadedLandscape> {
  const payload = await labRequest<LandscapePayload>(`/grid/${sceneId}/landscape`, { signal, cache: 'no-store' });
  if (payload.side !== MODEL_SIDE) throw new Error('Landscape grid has an unexpected size.');
  const clc = decodeUint16(payload.clc), elevation = decodeFloat32(payload.elevation);
  return { clc, fuel: baseFuel(clc), elevation, polygons: payload.polygons, sources: payload.sources };
}

export async function loadWeather(sceneId: string, signal?: AbortSignal): Promise<WeatherSeries> {
  const series = await labRequest<WeatherSeries>(`/grid/${sceneId}/weather`, { signal, cache: 'no-store' });
  if (!Array.isArray(series.hours) || !series.hours.length) throw new Error('The weather forecast is empty.');
  return series;
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
