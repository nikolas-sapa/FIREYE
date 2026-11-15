import type { BBox, Geo, Ms, RasterMeta, ScenarioId, ScenarioManifest, ScenarioPack } from '../contracts';

/* ------------------------------------------------------------------ scenario registry */

export interface ScenarioEntry {
  id: ScenarioId;
  name: string;
  short: string;
  /** Directory under public/data/. */
  dir: string;
  tz: string;
  /** Minutes east of UTC for display (EEST = 180, PDT = -420). */
  utcOffsetMin: number;
}

export const SCENARIOS: ScenarioEntry[] = [
  { id: 'mati-2018', name: 'Mati fire, Attica', short: 'Mati 2018', dir: 'mati', tz: 'EEST', utcOffsetMin: 180 },
  { id: 'caldor-2021', name: 'Caldor Fire', short: 'Caldor 2021', dir: 'caldor', tz: 'PDT', utcOffsetMin: -420 },
];

export const DEFAULT_SCENARIO: ScenarioId = 'mati-2018';

/** Scenario from the `?scenario=` URL parameter, else DEFAULT_SCENARIO. Unknown ids fall back to the default. */
export function currentScenarioId(): ScenarioId {
  if (typeof window === 'undefined') return DEFAULT_SCENARIO;
  const q = new URLSearchParams(window.location.search).get('scenario');
  return SCENARIOS.some((s) => s.id === q) ? (q as ScenarioId) : DEFAULT_SCENARIO;
}

/** Registry entry for the active (or given) scenario. */
export function scenarioEntry(id?: ScenarioId | null): ScenarioEntry | undefined {
  const want = id ?? currentScenarioId();
  return SCENARIOS.find((s) => s.id === want);
}

/** Reloads the page on another scenario, keeping the other query parameters except `beat`. */
export function switchScenario(id: ScenarioId): void {
  const url = new URL(window.location.href);
  url.searchParams.set('scenario', id);
  url.searchParams.delete('beat');
  window.location.assign(url.toString());
}

/** Display name of a pack: manifest name, else the registry name. */
export function scenarioName(pack: ScenarioPack | null): string {
  return pack?.manifest.name ?? scenarioEntry(pack?.manifest.id)?.name ?? 'Scenario';
}

/* ------------------------------------------------------------------ manifest extras */

/** Extra fields present in public/data/<dir>/manifest.json beyond ScenarioManifest (additive). */
export interface ScenarioManifestExtras {
  /** Minutes east of UTC for the display timezone (PDT = -420, EEST = 180). */
  tzOffsetMin: number;
  /** Ignition time and position. Mati also lists alternative documented ignition times. */
  ignition: { t: Ms; pos: Geo; alternatives?: { t: Ms; label: string; source: string; url: string; used?: boolean }[] };
  /** Full data range. arrival < 0 means burned before manifest.start. */
  dataStart: Ms;
  dataEnd: Ms;
  replayNote: string;
  /** Dated NASA GIBS overlays (true colour JPEG + thermal anomalies PNG). */
  imageryExtra: { url: string; bbox: BBox; date: string; source: string; width: number; height: number }[];
  /** Main offline mosaic; mirrored onto ScenarioPack.imagery. */
  imagery: NonNullable<ScenarioPack['imagery']>;
  hotspotMode: 'firms' | 'feds' | 'synth' | 'none';
  /** Suggested scenario time to start a short demo (Mati: 16:38 EEST, just before the 199 call). */
  recommendedT0: Ms;
  /** Active-edge window (minutes) for fireFieldAt; see geo.activeEdgeMs. */
  activeEdgeMin: number;
  /** Mati: anchors that map the spread model onto documented clock times. */
  calibration: { id: string; t: Ms; modelT: number; used: boolean; note?: string }[];
  /** Mati: EFFIS final burnt-area reference. */
  effis: { id: string; areaHa: number; fireDate: string; rasterHa: number };
  notes: string[];
  generatedAt: string;
}
export type CaldorManifestExtras = ScenarioManifestExtras;
export type ScenarioManifestFull = ScenarioManifest & Partial<ScenarioManifestExtras>;
export type CaldorManifest = ScenarioManifestFull;

/** Places may carry `fictional: true` and an `osm` / `note` provenance string. */
export type ScenarioPlace = ScenarioManifest['places'][number] & { fictional?: boolean; osm?: string; note?: string };
export type CaldorPlace = ScenarioPlace;

/** Final official perimeter (Caldor: Sept 2021 CAL FIRE; Mati: EFFIS burnt area). Reference/ghost only. */
export interface FinalPerimeter { t: Ms; acres: number; polygon: Geo[][]; ha?: number; source?: string }

/** Perimeter entry as stored in perimeters.json; Mati perimeters carry provenance flags. */
export type PackPerimeter = ScenarioPack['perimeters'][number] & { ha?: number; synthesized?: boolean; source?: string; slot?: string };

const finalPerimeters = new WeakMap<ScenarioPack, FinalPerimeter | null>();
const rawFbfm40 = new WeakMap<ScenarioPack, Uint8Array>();
const rawClc = new WeakMap<ScenarioPack, Uint16Array>();

/* ------------------------------------------------------------------ loading */

function dataRoot(): string {
  const b = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${b.replace(/\/$/, '')}/data/`;
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`loadScenario: ${res.status} ${url}`);
  return res;
}

const pending = new Map<ScenarioId, Promise<ScenarioPack>>();

/**
 * Loads a scenario pack from /data/<dir>/* (cached per id; concurrent callers share one fetch).
 * Without an id, uses `?scenario=` (default 'mati-2018').
 */
export function loadScenario(id?: ScenarioId): Promise<ScenarioPack> {
  const want = id ?? currentScenarioId();
  const entry = SCENARIOS.find((s) => s.id === want);
  if (!entry) return Promise.reject(new Error(`loadScenario: unknown scenario ${want}`));
  let p = pending.get(entry.id);
  if (!p) {
    p = doLoad(entry).catch((e) => {
      pending.delete(entry.id);
      throw e;
    });
    pending.set(entry.id, p);
  }
  return p;
}

async function doLoad(entry: ScenarioEntry): Promise<ScenarioPack> {
  const dir = `${dataRoot()}${entry.dir}/`;
  const json = async <T>(file: string): Promise<T> => (await fetchOk(dir + file)).json() as Promise<T>;
  const bin = async (file: string): Promise<ArrayBuffer> => (await fetchOk(dir + file)).arrayBuffer();
  const prefix = `/data/${entry.dir}/`;
  const assetUrl = (u: string): string => (u.startsWith(prefix) ? dir + u.slice(prefix.length) : u);

  type PerFile = { perimeters: PackPerimeter[]; final: FinalPerimeter | null };
  type OsmFile = Pick<ScenarioPack, 'roads' | 'buildings' | 'water'>;
  const [manifest, raster, elev, fuel, fb, clc, arrival, per, hot, wx, osm, cps, reps, facts] = await Promise.all([
    json<ScenarioManifestFull>('manifest.json'),
    json<RasterMeta>('raster.json'),
    bin('elevation.bin'),
    bin('fuel.bin'),
    entry.dir === 'caldor' ? bin('fbfm40.bin').catch(() => null) : Promise.resolve(null),
    entry.dir === 'mati' ? bin('clc2018.bin').catch(() => null) : Promise.resolve(null),
    bin('arrival.bin'),
    json<PerFile>('perimeters.json'),
    json<{ hotspots: ScenarioPack['hotspots'] }>('hotspots.json'),
    json<{ weather: ScenarioPack['weather'] }>('weather.json'),
    json<OsmFile>('osm.json'),
    json<{ checkpoints: NonNullable<ScenarioPack['checkpoints']> }>('checkpoints.json').catch(() => null),
    json<{ reports: NonNullable<ScenarioPack['reports']> }>('reports.json').catch(() => null),
    json<{ facts: NonNullable<ScenarioPack['facts']> }>('facts.json').catch(() => null),
  ]);
  const n = raster.w * raster.h;
  const e16 = new Int16Array(elev, 0, n);
  const elevation = new Float32Array(n);
  for (let i = 0; i < n; i++) elevation[i] = e16[i];
  if (manifest.imageryExtra) manifest.imageryExtra = manifest.imageryExtra.map((im) => ({ ...im, url: assetUrl(im.url) }));
  const pack: ScenarioPack = {
    manifest,
    raster: { w: raster.w, h: raster.h, bbox: raster.bbox, cellM: raster.cellM },
    elevation,
    fuel: new Uint8Array(fuel, 0, n),
    arrival: new Float32Array(arrival, 0, n),
    perimeters: per.perimeters.map((p) => ({ ...p, t: p.t, acres: p.acres, polygon: p.polygon })),
    hotspots: hot.hotspots,
    weather: wx.weather,
    roads: osm.roads,
    buildings: osm.buildings,
    water: osm.water,
    imagery: manifest.imagery ? { ...manifest.imagery, url: assetUrl(manifest.imagery.url) } : undefined,
    ...(cps ? { checkpoints: cps.checkpoints } : {}),
    ...(reps ? { reports: reps.reports } : {}),
    ...(facts ? { facts: facts.facts } : {}),
  };
  finalPerimeters.set(pack, per.final ?? null);
  if (fb) rawFbfm40.set(pack, new Uint8Array(fb, 0, n));
  if (clc) rawClc.set(pack, new Uint16Array(clc, 0, n));
  return pack;
}

/* ------------------------------------------------------------------ accessors */

/** Typed access to the manifest extras (ignition, data range, GIBS overlays, notes). */
export function scenarioExtras(pack: ScenarioPack): Partial<ScenarioManifestExtras> {
  return pack.manifest as ScenarioManifestFull;
}

/** Display timezone offset in minutes east of UTC (manifest, else registry, else 0). */
export function tzOffsetMin(pack: ScenarioPack): number {
  return scenarioExtras(pack).tzOffsetMin ?? scenarioEntry(pack.manifest.id)?.utcOffsetMin ?? 0;
}

export function finalPerimeter(pack: ScenarioPack): FinalPerimeter | null {
  return finalPerimeters.get(pack) ?? null;
}

/** Raw LANDFIRE FBFM40 code per cell (Caldor only; 0 = no data), if loaded. */
export function fbfm40(pack: ScenarioPack): Uint8Array | null {
  return rawFbfm40.get(pack) ?? null;
}

/** Raw CORINE Land Cover 2018 Code_18 per cell (Mati only; 0 = none), if loaded. */
export function clc2018(pack: ScenarioPack): Uint16Array | null {
  return rawClc.get(pack) ?? null;
}

/** Place by id from the manifest. */
export function placeById(pack: ScenarioPack, id: string): ScenarioPlace | undefined {
  return (pack.manifest.places as ScenarioPlace[]).find((p) => p.id === id);
}

/** Documented checkpoint by id (Mati: 'ignition', 'neos-voutzas', 'marathonos', 'coast-mati', ...). */
export function checkpointById(pack: ScenarioPack, id: string): NonNullable<ScenarioPack['checkpoints']>[number] | undefined {
  return pack.checkpoints?.find((c) => c.id === id);
}

/** Weather sample nearest to absolute time t (linear interpolation between hourly samples). */
export function weatherAt(pack: ScenarioPack, t: Ms): ScenarioPack['weather'][number] {
  const w = pack.weather;
  if (!w.length) return { t, windKph: 0, windDirDeg: 0, gustKph: 0, tempC: 20, rh: 30 };
  if (t <= w[0].t) return w[0];
  if (t >= w[w.length - 1].t) return w[w.length - 1];
  let lo = 0, hi = w.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (w[m].t <= t) lo = m; else hi = m; }
  const a = w[lo], b = w[hi], f = (t - a.t) / (b.t - a.t);
  const dd = ((b.windDirDeg - a.windDirDeg + 540) % 360) - 180;
  return {
    t,
    windKph: a.windKph + (b.windKph - a.windKph) * f,
    windDirDeg: (a.windDirDeg + dd * f + 360) % 360,
    gustKph: a.gustKph + (b.gustKph - a.gustKph) * f,
    tempC: a.tempC + (b.tempC - a.tempC) * f,
    rh: a.rh + (b.rh - a.rh) * f,
  };
}
