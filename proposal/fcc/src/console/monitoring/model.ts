import type { BBox, Geo, ScenarioPack } from '../contracts';

export type ViewId = 'current' | 'mati' | 'attica2024';
export type DataClass = 'observation' | 'forecast' | 'reanalysis' | 'historical' | 'static';
export interface SourceResult<T> {
  source: string;
  url: string;
  attribution: string;
  dataClass: DataClass;
  fetchedAt: string;
  observedAt?: string;
  note: string;
  data: T;
}
export interface Detection {
  id: string; lon: number; lat: number; observedAt: string;
  satellite: string; confidence: string; frp: number | null;
}
export interface Weather {
  time: string; tempC: number | null; humidity: number | null;
  windKph: number | null; windFromDeg: number | null; gustKph: number | null;
  precipitationMm?: number | null;
}
export interface Station extends Weather { id: string; name: string; lon: number; lat: number; raw: string }
export interface Camera {
  id: string; name: string; provider: string; url: string; pos?: Geo;
  locationNote: string; note: string; image?: string; player?: string;
}
export interface PolygonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };
}
export interface GeometryCollection { type: 'FeatureCollection'; features: PolygonFeature[] }
export interface Mapping {
  code: string; name: string; acquiredAt: string; publishedAt: string;
  burnedHa: number | null; geometry: GeometryCollection;
}
export const GREECE: BBox = [19, 34.5, 30, 42];
export const ATTICA: BBox = [23.55, 37.85, 24.15, 38.35];
export const VIEWS: Record<ViewId, { name: string; short: string; date?: string; center: Geo; bbox: BBox; note: string }> = {
  current: { name: 'Current Attica', short: 'Current', center: { lon: 23.98, lat: 38.04 }, bbox: ATTICA,
    note: 'Public observations and forecasts. No integrated evacuation or road-closure feed.' },
  mati: { name: 'Mati · 23 July 2018', short: 'Mati 2018', date: '2018-07-23', center: { lon: 23.98, lat: 38.04 }, bbox: [23.87, 37.98, 24.05, 38.10],
    note: 'Historical case study. Final burned area is a post-event assessment, not an observed moving front. FIRMS passes are later than the main afternoon run.' },
  attica2024: { name: 'Attica / Varnavas · August 2024', short: 'Attica 2024', date: '2024-08-12', center: { lon: 23.93, lat: 38.12 }, bbox: [23.78, 37.98, 24.05, 38.28],
    note: 'Historical case study · Copernicus EMSR746. Mapped burned area is dated to satellite acquisition, not ignition.' },
};

export function inside(lon: number, lat: number, b: BBox) {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}
export function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
}
export function iso(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}
export function parseFirms(csv: string, satellite: string, bbox = GREECE): Detection[] {
  const lines = csv.trim().split(/\r?\n/);
  const headers = (lines.shift() ?? '').replace(/^\uFEFF/, '').split(',').map(s => s.trim());
  if (!['latitude', 'longitude', 'acq_date', 'acq_time'].every(h => headers.includes(h))) throw new Error('Unexpected FIRMS CSV schema');
  return lines.flatMap((line) => {
    const values = line.split(',');
    const field = (key: string) => (values[headers.indexOf(key)] ?? '').trim();
    const lat = finite(field('latitude')), lon = finite(field('longitude'));
    const rawTime = field('acq_time'), time = rawTime ? rawTime.padStart(4, '0') : '';
    const observedAt = /^\d{4}$/.test(time) ? iso(`${field('acq_date')}T${time.slice(0, 2)}:${time.slice(2)}:00Z`) : undefined;
    if (lat === null || lon === null || !inside(lon, lat, bbox) || !observedAt || observedAt.slice(0, 10) !== field('acq_date')) return [];
    return [{ id: `${satellite}-${lon}-${lat}-${observedAt}`, lon, lat, observedAt,
      satellite, confidence: field('confidence') || 'unknown', frp: finite(field('frp')) }];
  });
}
export function parseForecast(raw: unknown): Weather[] {
  const r = raw as { properties?: { timeseries?: { time: string; data: { instant: { details: Record<string, unknown> }; next_1_hours?: { details?: { precipitation_amount?: number } } } }[] } };
  if (!Array.isArray(r?.properties?.timeseries)) throw new Error('Unexpected forecast schema');
  return r.properties.timeseries.slice(0, 48).flatMap(s => {
    const time = iso(s.time), d = s.data?.instant?.details;
    return !time || !d ? [] : [{ time, tempC: finite(d.air_temperature), humidity: finite(d.relative_humidity),
      windKph: finite(d.wind_speed) === null ? null : Number(d.wind_speed) * 3.6,
      windFromDeg: finite(d.wind_from_direction), gustKph: finite(d.wind_speed_of_gust) === null ? null : Number(d.wind_speed_of_gust) * 3.6,
      precipitationMm: finite(s.data.next_1_hours?.details?.precipitation_amount) }];
  });
}
export function parseMetar(raw: unknown): Station[] {
  if (!Array.isArray(raw)) throw new Error('Unexpected METAR schema');
  return raw.flatMap((r: Record<string, unknown>) => {
    const ms = typeof r.obsTime === 'number' ? r.obsTime * 1000 : NaN;
    const time = Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : iso(r.reportTime);
    const lat = finite(r.lat), lon = finite(r.lon);
    if (!time || lat === null || lon === null) return [];
    const wind = finite(r.wspd), gust = finite(r.wgst);
    return [{ id: String(r.icaoId), name: String(r.name ?? r.icaoId), lat, lon, time,
      tempC: finite(r.temp), humidity: null, windKph: wind === null ? null : wind * 1.852,
      gustKph: gust === null ? null : gust * 1.852, windFromDeg: finite(r.wdir), raw: String(r.rawOb ?? '') }];
  });
}

/** Never pass reconstructed arrivals, simulated findings, or historical weather into a current scene. */
export function contextPack(pack: ScenarioPack): ScenarioPack {
  return { ...pack, manifest: { ...pack.manifest, places: pack.manifest.places.filter(p => p.id !== 'ignition' && !(p as { fictional?: boolean }).fictional && !/\bmodel\b/i.test(p.name)) },
    arrival: new Float32Array(pack.raster.w * pack.raster.h).fill(Infinity),
    perimeters: [], hotspots: [], weather: [], checkpoints: [], reports: [], facts: [], imagery: undefined };
}
export function legacyEntry(search: string): boolean {
  const q = new URLSearchParams(search);
  return q.get('mode') === 'replay' || q.has('scenario') || q.has('beat');
}
export function sanitizeCameras(cameras: Camera[]): Camera[] {
  return cameras.map(({ image: _image, player: _player, ...camera }) => camera);
}
export function distanceKm(a: Geo, b: Geo) {
  const r = Math.PI / 180, p = (b.lat - a.lat) * r, q = (b.lon - a.lon) * r;
  return 12742 * Math.asin(Math.sqrt(Math.sin(p / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(q / 2) ** 2));
}
