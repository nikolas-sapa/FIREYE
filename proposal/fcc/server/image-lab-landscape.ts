import { inflateSync } from 'node:zlib';
import type { GridScene } from '../src/image-lab/grid';
import {
  MODEL_CELLS, MODEL_SIDE, encodeArray, rasterizeRings, resampleTerrain, terrainTiles, lonOf, latOf,
  type LandscapePayload, type WeatherSeries,
} from '../src/image-lab/landscape';

/** Keyless public sources. Fixed hosts only; no credentials are ever attached. */
const CORINE_QUERY = 'https://image.discomap.eea.europa.eu/arcgis/rest/services/Corine/CLC2018_WM/MapServer/0/query';
const TERRAIN_ROOT = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const WEATHER_ROOT = 'https://api.open-meteo.com/v1/forecast';
const MAX_PAGES = 10;

export class SourceError extends Error {}

async function download(fetcher: typeof fetch, url: string, kind: 'json' | 'png', limit: number): Promise<Buffer> {
  let response: Response;
  try { response = await fetcher(url, { signal: AbortSignal.timeout(60000), redirect: 'error' }); }
  catch { throw new SourceError('unreachable'); }
  const type = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
  const typeOk = kind === 'png' ? type === 'image/png' : type === 'application/json' || type === 'application/geo+json' || type === 'text/plain';
  if (!response.ok || !typeOk) throw new SourceError(`HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new SourceError('empty');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > limit) { await reader.cancel(); throw new SourceError('too large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

/** Minimal 8-bit non-interlaced PNG decoder (same as scripts/fetch-mati.mjs) returning RGB. */
export function decodePng(buf: Buffer): { w: number; h: number; rgb: Uint8Array } {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new SourceError('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  let palette: Buffer | null = null;
  const idat: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (depth !== 8 || interlace || !ch || !w || !h || w * h > 4096 * 4096 || (ctype === 3 && !palette)) throw new SourceError('unsupported PNG');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  if (raw.length < h * (stride + 1)) throw new SourceError('truncated PNG');
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[dst + i - ch] : 0;
      const b = y > 0 ? px[dst - stride + i] : 0;
      const c = i >= ch && y > 0 ? px[dst - stride + i - ch] : 0;
      let v = raw[src + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + i] = v & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    if (ctype === 3) { const p = px[i] * 3; rgb[i * 3] = palette![p]; rgb[i * 3 + 1] = palette![p + 1]; rgb[i * 3 + 2] = palette![p + 2]; }
    else if (ch <= 2) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i * ch];
    else { rgb[i * 3] = px[i * ch]; rgb[i * 3 + 1] = px[i * ch + 1]; rgb[i * 3 + 2] = px[i * ch + 2]; }
  }
  return { w, h, rgb };
}

type Ring = number[][];
function polygonsOf(geometry: unknown): Ring[][] {
  if (!geometry || typeof geometry !== 'object') return [];
  const g = geometry as { type?: string; coordinates?: unknown };
  const valid = (rings: unknown): rings is Ring[] => Array.isArray(rings) && rings.every(ring => Array.isArray(ring) &&
    ring.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])));
  if (g.type === 'Polygon' && valid(g.coordinates)) return [g.coordinates];
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) return g.coordinates.filter(valid);
  return [];
}

export async function buildLandscape(scene: GridScene, fetcher: typeof fetch): Promise<LandscapePayload> {
  const [w, s, e, n] = scene.bounds;
  const fetchedAt = new Date().toISOString();
  const clc = new Uint16Array(MODEL_CELLS);
  let polygons = 0;
  // Query in WGS84 like the Mati builder; rings are projected to the scene's Web Mercator grid when rasterized.
  const envelope = [lonOf(w), latOf(s), lonOf(e), latOf(n)].map(v => v.toFixed(6)).join(',');
  for (let page = 0, offset = 0; ; page++) {
    if (page >= MAX_PAGES) throw new SourceError('too many land-cover pages');
    const query = new URLSearchParams({ where: '1=1', geometry: envelope, geometryType: 'esriGeometryEnvelope', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: 'Code_18', returnGeometry: 'true', outSR: '4326',
      maxAllowableOffset: '0.00005', geometryPrecision: '6', resultOffset: String(offset), resultRecordCount: '1000', f: 'geojson' });
    let data: { features?: unknown[]; exceededTransferLimit?: boolean; properties?: { exceededTransferLimit?: boolean } };
    try { data = JSON.parse((await download(fetcher, `${CORINE_QUERY}?${query}`, 'json', 32 * 1024 * 1024)).toString('utf8')); }
    catch (error) { throw error instanceof SourceError ? error : new SourceError('invalid land-cover JSON'); }
    const features = Array.isArray(data.features) ? data.features : null;
    if (!features) throw new SourceError('land-cover response has no features');
    for (const feature of features as { properties?: { Code_18?: unknown }; geometry?: unknown }[]) {
      const code = Number(feature.properties?.Code_18);
      if (!Number.isInteger(code) || code < 111 || code > 999) continue;
      for (const rings of polygonsOf(feature.geometry)) rasterizeRings(rings, clc, code, scene.bounds);
      polygons++;
    }
    const more = data.exceededTransferLimit || data.properties?.exceededTransferLimit;
    if (!features.length || (features.length < 1000 && !more)) break;
    offset += features.length;
  }
  if (!polygons) throw new SourceError('no land-cover polygons for this scene');

  const layout = terrainTiles(scene.bounds);
  if (layout.tiles.length > 16) throw new SourceError('terrain tile budget exceeded');
  const rgbTiles = await Promise.all(layout.tiles.map(async tile => {
    const png = decodePng(await download(fetcher, `${TERRAIN_ROOT}/${tile.z}/${tile.x}/${tile.y}.png`, 'png', 2 * 1024 * 1024));
    if (png.w !== 256 || png.h !== 256) throw new SourceError('unexpected terrain tile size');
    return png.rgb;
  }));
  const elevation = resampleTerrain(scene.bounds, rgbTiles);
  let lo = Infinity, hi = -Infinity, mapped = 0;
  for (const v of elevation) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (const code of clc) if (code) mapped++;
  return {
    side: MODEL_SIDE, clc: encodeArray(clc), elevation: encodeArray(elevation), polygons,
    sources: [
      { id: 'clc2018', fetchedAt, detail: `${polygons} polygons rasterized to ${MODEL_SIDE} x ${MODEL_SIDE} cells; ${(mapped / MODEL_CELLS * 100).toFixed(1)}% mapped` },
      { id: 'terrarium', fetchedAt, detail: `${layout.tiles.length} tiles at zoom ${layout.tiles[0].z}; elevation ${Math.round(lo)} to ${Math.round(hi)} m` },
    ],
  };
}

const HOURLY = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'temperature_2m', 'relative_humidity_2m'] as const;

export async function fetchWeather(scene: GridScene, fetcher: typeof fetch): Promise<WeatherSeries> {
  const query = new URLSearchParams({ latitude: scene.center.lat.toFixed(4), longitude: scene.center.lon.toFixed(4),
    hourly: HOURLY.join(','), wind_speed_unit: 'kmh', timezone: 'GMT', forecast_hours: '48', past_hours: '0' });
  let data: { latitude?: number; longitude?: number; elevation?: number; hourly?: Record<string, unknown[]> };
  try { data = JSON.parse((await download(fetcher, `${WEATHER_ROOT}?${query}`, 'json', 1024 * 1024)).toString('utf8')); }
  catch (error) { throw error instanceof SourceError ? error : new SourceError('invalid weather JSON'); }
  const hourly = data.hourly;
  const times = hourly?.time;
  if (!hourly || !Array.isArray(times) || !HOURLY.every(k => Array.isArray(hourly[k]) && hourly[k].length === times.length)) {
    throw new SourceError('weather response is missing hourly fields');
  }
  const num = (k: (typeof HOURLY)[number], i: number) => { const v = hourly[k][i]; return typeof v === 'number' && Number.isFinite(v) ? v : NaN; };
  const hours = times.flatMap((time, i) => {
    const t = Date.parse(`${String(time)}:00Z`);
    const h = { t, windKph: num('wind_speed_10m', i), windDirDeg: num('wind_direction_10m', i), gustKph: num('wind_gusts_10m', i),
      tempC: num('temperature_2m', i), rh: num('relative_humidity_2m', i) };
    const ok = Number.isFinite(t) && h.windKph >= 0 && h.windKph < 300 && h.windDirDeg >= 0 && h.windDirDeg <= 360 &&
      h.gustKph >= 0 && h.gustKph < 400 && h.tempC > -60 && h.tempC < 60 && h.rh >= 0 && h.rh <= 100;
    return ok ? [h] : [];
  });
  if (hours.length < 7) throw new SourceError('weather forecast is too short');
  return { source: 'open-meteo', fetchedAt: new Date().toISOString(), hours: hours.slice(0, 48),
    point: { lat: Number(data.latitude), lon: Number(data.longitude), elevationM: typeof data.elevation === 'number' ? data.elevation : undefined } };
}
