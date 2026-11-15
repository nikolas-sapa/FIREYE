import type { IncomingMessage, ServerResponse } from 'node:http';
import { ATTICA, GREECE, VIEWS, inside, iso, parseFirms, parseForecast, parseMetar } from '../src/console/monitoring/model';
import type { Camera, GeometryCollection, Mapping, SourceResult, ViewId } from '../src/console/monitoring/model';

export interface MonitoringConfig { firmsKey?: string; windyKey?: string; contact?: string }
const API = '/api/monitor';
const MAX_BYTES = 20 * 1024 * 1024;
const CACHE_BYTES = 40 * 1024 * 1024;
// Per middleware instance: at most 20 new Windy discoveries in any rolling minute.
// Failed attempts consume capacity too; pending-request sharing does not start a new discovery.
const CAMERA_CALL_LIMIT = 20;
const CAMERA_CALL_WINDOW_MS = 60000;
class MonitoringError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
function parseProviderJson(bytes: Uint8Array): any {
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new MonitoringError('Provider returned unreadable JSON'); }
}
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const geometryBase = 'https://rapidmapping-viewer.s3.eu-west-1.amazonaws.com/EMSR746/AOI01/DEL_PRODUCT/';
export const CASE_GEOMETRY = `${geometryBase}EMSR746_AOI01_DEL_PRODUCT_observedEventA_v1.json`;
export const CASE_API = 'https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code=EMSR746';

export function validBurnedGeometry(raw: unknown): raw is GeometryCollection {
  const g = raw as GeometryCollection;
  if (g?.type !== 'FeatureCollection' || !Array.isArray(g.features) || !g.features.length) return false;
  return g.features.every(f => {
    if (!f || f.type !== 'Feature' || f.properties?.notation !== 'Burnt area' || !f.geometry) return false;
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    return polygons.length > 0 && polygons.every(rings => Array.isArray(rings) && rings.length > 0 && rings.every(ring =>
      Array.isArray(ring) && ring.length >= 4 && ring.every(p => Array.isArray(p) && p.length >= 2
        && Number.isFinite(p[0]) && Number.isFinite(p[1]) && inside(p[0], p[1], [19, 34.5, 30, 42]))
      && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]));
  });
}

export function result<T>(source: string, url: string, attribution: string, dataClass: SourceResult<T>['dataClass'], note: string, data: T, observedAt?: string): SourceResult<T> {
  return { source, url, attribution, dataClass, fetchedAt: new Date().toISOString(), note, data, ...(observedAt ? { observedAt } : {}) };
}
export async function limitedResponse(response: Response, limit = MAX_BYTES): Promise<Uint8Array> {
  if (!response.ok) throw new MonitoringError(`Provider returned HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > limit) throw new MonitoringError('Provider response exceeds size limit');
  const reader = response.body?.getReader();
  if (!reader) throw new MonitoringError('Empty provider response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new MonitoringError('Provider response exceeds size limit');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}
export async function fetchCase2024(fetcher: typeof fetch = fetch): Promise<SourceResult<Mapping>> {
  const json = async (url: string) => parseProviderJson(await limitedResponse(await fetcher(url, { signal: AbortSignal.timeout(25000), redirect: 'error' })));
  const [raw, geometry] = await Promise.all([json(CASE_API), json(CASE_GEOMETRY)]);
  const activation = raw.results?.find((a: { code: string }) => a.code === 'EMSR746');
  const product = activation?.aois?.flatMap((a: { products: Record<string, unknown>[] }) => a.products)
    .find((p: { type: string; monitoring: boolean }) => p.type === 'DEL' && !p.monitoring);
  if (!product || !validBurnedGeometry(geometry)) {
    throw new MonitoringError('Unexpected Copernicus mapping schema');
  }
  const acquiredAt = iso(product.images?.[0]?.acquisitionTime), publishedAt = iso(product.version?.deliveryTime);
  if (!acquiredAt || !publishedAt) throw new MonitoringError('Missing mapping dates');
  return result('Copernicus EMS · EMSR746', CASE_API, 'Copernicus Emergency Management Service (© 2024 European Union), EMSR746', 'historical',
    'Initial delineation from Sentinel-2 on 12 August 2024. Burned area, not an active front; later assessments differ.',
    { code: 'EMSR746', name: String(activation.name), acquiredAt, publishedAt,
      burnedHa: typeof product.stats?.['Burnt area']?.None?.total === 'number' ? product.stats['Burnt area'].None.total : null,
      geometry: geometry as GeometryCollection }, acquiredAt);
}

export function imageUrl(kind: 'gibs' | 'danger' | 'legend', view: ViewId, date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date) throw new MonitoringError('Invalid imagery date');
  if (kind === 'gibs') {
    const historic = date < '2026-11-02';
    const layer = historic ? 'VIIRS_SNPP_CorrectedReflectance_TrueColor' : 'VIIRS_NOAA20_CorrectedReflectance_TrueColor';
    return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: layer, STYLES: '',
      FORMAT: 'image/jpeg', SRS: 'EPSG:4326', BBOX: VIEWS[view].bbox.join(','), WIDTH: '1024', HEIGHT: '768', TIME: date,
    })}`;
  }
  return `https://maps.effis.emergency.copernicus.eu/gwis?${new URLSearchParams(kind === 'legend' ? {
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetLegendGraphic', LAYER: 'ecmwf.fwi', FORMAT: 'image/png',
  } : {
    SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: 'ecmwf.fwi', STYLES: '', FORMAT: 'image/png',
    TRANSPARENT: 'TRUE', SRS: 'EPSG:4326', BBOX: ATTICA.join(','), WIDTH: '1024', HEIGHT: '768', TIME: date,
  })}`;
}

export function createMonitoringMiddleware(getConfig: () => MonitoringConfig, fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { bytes: Uint8Array; type: string; at: number; ttl: number }>();
  const pending = new Map<string, Promise<{ bytes: Uint8Array; type: string }>>();
  let totalBytes = 0;
  let cameraCalls: number[] = [];
  function keep(key: string, bytes: Uint8Array, type: string, ttl: number) {
    if (bytes.byteLength > CACHE_BYTES) return;
    const old = cache.get(key); if (old) totalBytes -= old.bytes.byteLength;
    cache.delete(key);
    while (totalBytes + bytes.byteLength > CACHE_BYTES && cache.size) {
      const first = cache.keys().next().value!;
      totalBytes -= cache.get(first)!.bytes.byteLength; cache.delete(first);
    }
    cache.set(key, { bytes, type, at: Date.now(), ttl }); totalBytes += bytes.byteLength;
  }
  async function remoteResponse(url: string, headers: Record<string, string> = {}) {
    return fetcher(url, { headers: { 'User-Agent': `FCC-hackathon/1.0 (${getConfig().contact || 'local presentation'})`, ...headers },
      redirect: 'error', signal: AbortSignal.timeout(25000) });
  }
  const remote = async (url: string, headers?: Record<string, string>) => limitedResponse(await remoteResponse(url, headers));
  const json = async (url: string, headers?: Record<string, string>) => parseProviderJson(await remote(url, headers));
  async function route(path: string, query: URLSearchParams): Promise<{ bytes: Uint8Array; type: string; ttl?: number }> {
    const config = getConfig();
    let value: unknown;
    let ttl: number | undefined;
    if (path === 'config') value = { firms: !!config.firmsKey, windy: !!config.windyKey, contact: !!config.contact };
    else if (path === 'firms') {
      const readings = await Promise.all([['NOAA-20', 'VIIRS_NOAA20_NRT', 'noaa-20', 'J1'], ['NOAA-21', 'VIIRS_NOAA21_NRT', 'noaa-21', 'J2']].map(async ([sat, source, dir, prefix]) => {
        const url = config.firmsKey
          // FIRMS day_range=1 resets at UTC midnight; request two dates, then filter rolling 24 h.
          ? `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(config.firmsKey)}/${source}/${GREECE.join(',')}/2`
          : `https://firms.modaps.eosdis.nasa.gov/data/active_fire/${dir}-viirs-c2/csv/${prefix}_VIIRS_C2_Global_24h.csv`;
        return parseFirms(new TextDecoder().decode(await remote(url)), sat);
      }));
      const now = Date.now();
      const data = [...new Map(readings.flat().filter(d => {
        const t = Date.parse(d.observedAt); return t >= now - 86400000 && t <= now;
      }).map(d => [d.id, d])).values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
      value = result('NASA FIRMS · NOAA-20/21', 'https://firms.modaps.eosdis.nasa.gov/', 'NASA FIRMS / LANCE', 'observation',
        'Greece-region bounding box (includes neighboring border areas) · last 24 hours. Nominal 375 m pixels; detections are thermal anomalies, not confirmed incidents. Global NRT may arrive up to ~3 hours after overpass. No detections does not mean safe.',
        data, data[0]?.observedAt);
    } else if (path === 'forecast') {
      if (!config.contact) throw new MonitoringError('Add FCC_APP_CONTACT (public project URL or application contact) to .env.local for MET Norway identification');
      const url = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=38.04&lon=23.98';
      const response = await remoteResponse(url);
      const expires = Date.parse(response.headers.get('expires') ?? '');
      const maxAge = response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1];
      ttl = /no-store|no-cache/.test(response.headers.get('cache-control') ?? '') ? 0
        : Math.max(0, Math.min(3600000, Number.isFinite(expires) ? expires - Date.now() : maxAge ? Number(maxAge) * 1000 : 600000));
      const raw = parseProviderJson(await limitedResponse(response));
      value = result('MET Norway · ECMWF forecast', url, 'MET Norway · CC BY 4.0', 'forecast',
        'Point forecast at Mati / East Attica. Global model approximately 9 km; not measured local forest wind.',
        parseForecast(raw), iso(raw.properties?.meta?.updated_at));
    } else if (path === 'metar') {
      const url = 'https://aviationweather.gov/api/data/metar?ids=LGAV,LGTG,LGEL&format=json';
      value = result('NOAA Aviation Weather · METAR', url, 'Aviation Weather Center / originating stations', 'observation',
        'Airport observations, not fire-site weather. Preserve variable wind and missing gusts.', parseMetar(await json(url)));
    } else if (path === 'case2024') value = await fetchCase2024(fetcher);
    else if (path === 'cameras') {
      if (!config.windyKey) throw new MonitoringError('Add WINDY_API_KEY to discover additional nearby webcams; curated provider links work without it');
      const now = Date.now();
      cameraCalls = cameraCalls.filter(at => now - at < CAMERA_CALL_WINDOW_MS);
      if (cameraCalls.length >= CAMERA_CALL_LIMIT) throw new MonitoringError('Camera discovery limit reached; wait before trying again', 429);
      cameraCalls.push(now);
      const url = 'https://api.windy.com/webcams/api/v3/webcams?nearby=38.05,23.98,45&limit=20&include=location,images,player,urls';
      const raw = await json(url, { 'x-windy-api-key': config.windyKey });
      if (!Array.isArray(raw.webcams)) throw new MonitoringError('Unexpected Windy webcam schema');
      const safeUrl = (v: unknown, allowed?: string) => {
        if (typeof v !== 'string') return undefined;
        try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && (!allowed || u.hostname === allowed) ? u.href : undefined; } catch { return undefined; }
      };
      const data: Camera[] = raw.webcams.flatMap((c: Record<string, any>) => {
        const lat = c.location?.latitude, lon = c.location?.longitude;
        const url = safeUrl(c.urls?.detail) ?? safeUrl(c.urls?.provider);
        if (typeof lat !== 'number' || typeof lon !== 'number' || !inside(lon, lat, [23.1, 37.5, 24.6, 38.6]) || !url) return [];
        return [{ id: `windy-${c.webcamId}`, name: String(c.title), provider: 'Windy Webcams / camera owner', url,
          pos: { lon, lat }, locationNote: 'Location supplied by Windy; not a calibrated camera pose',
          note: 'Current webcam imagery / timelapse, not 2018 footage. Capture time may be unknown. Recording rights unverified.',
          image: safeUrl(c.images?.current?.preview), player: safeUrl(c.player?.day, 'webcams.windy.com') }];
      });
      value = result('Windy Webcams', 'https://www.windy.com/webcams', 'Webcams provided by windy.com and camera owners', 'observation',
        'On-demand display only. Tokenized media expire; no local archives or recording permission implied.', data);
    } else if (path === 'image') {
      const kind = query.get('kind'), view = query.get('view') as ViewId, date = query.get('date') ?? '';
      if (!['gibs', 'danger', 'legend'].includes(kind ?? '') || !Object.prototype.hasOwnProperty.call(VIEWS, view)) throw new MonitoringError('Invalid imagery request');
      if (kind !== 'gibs' && view !== 'current') throw new MonitoringError('Current danger must not appear in a historical case');
      const url = imageUrl(kind as 'gibs' | 'danger' | 'legend', view, date);
      const bytes = await remote(url);
      const jpeg = bytes[0] === 255 && bytes[1] === 216;
      const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
      if (!jpeg && !png) throw new MonitoringError('Provider returned no usable imagery for this date');
      return { bytes, type: jpeg ? 'image/jpeg' : 'image/png' };
    } else throw new MonitoringError('Unknown monitoring endpoint');
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (bytes.byteLength > MAX_BYTES) throw new MonitoringError('Provider response exceeds size limit');
    return { bytes, type: 'application/json', ttl };
  }
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!(req.url ?? '').startsWith(`${API}/`)) return next();
    const send = (status: number, bytes: Uint8Array, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(bytes);
    };
    const error = (status: number, message: string) => send(status, new TextEncoder().encode(JSON.stringify({ error: message })));
    for (const name of ['host', 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']) {
      if (req.headers[name] !== undefined && typeof req.headers[name] !== 'string') return error(403, 'Localhost only');
      let count = 0;
      for (let i = 0; i < (req.rawHeaders?.length ?? 0); i += 2) if (req.rawHeaders[i].toLowerCase() === name) count++;
      if (count > 1) return error(403, 'Localhost only');
    }
    const host = req.headers.host ?? '';
    let origin: URL;
    try { origin = new URL(`http://${host}`); } catch { return error(403, 'Localhost only'); }
    if (!localHosts.has(origin.hostname) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')
      || (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`)) return error(403, 'Localhost only');
    // Originless CLI remains supported. Browser metadata must explicitly be local or direct navigation.
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return error(403, 'Localhost only');
    if (req.method !== 'GET') return error(405, 'GET only');
    const url = new URL(req.url!, origin), path = url.pathname.slice(API.length + 1);
    if (!['config', 'firms', 'forecast', 'metar', 'case2024', 'cameras', 'image'].includes(path)) return error(404, 'Unknown endpoint');
    const key = path === 'image' ? `${path}?${['kind', 'view', 'date'].map(k => url.searchParams.get(k) ?? '').join('|')}` : path;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < hit.ttl) return send(200, hit.bytes, hit.type);
    try {
      let work = pending.get(key);
      if (!work) {
        if (pending.size >= 8) return error(429, 'Too many requests; try again shortly');
        work = route(path, url.searchParams).then(r => {
          // Never cache ephemeral webcam URLs, configuration, or secrets.
          if (path !== 'cameras' && path !== 'config' && r.ttl !== 0) keep(key, r.bytes, r.type, r.ttl ?? (path === 'case2024' ? 3600000 : 600000));
          return r;
        }).finally(() => pending.delete(key));
        pending.set(key, work);
      }
      const r = await work; send(200, r.bytes, r.type);
    } catch (e) {
      // Provider bodies/URLs may contain keys; only our own bounded, safe messages leave this boundary.
      const m = e instanceof MonitoringError
        ? e.message : 'Provider unavailable or timed out; existing saved data has not been replaced';
      error(e instanceof MonitoringError ? e.status : 503, m);
    }
  };
}
