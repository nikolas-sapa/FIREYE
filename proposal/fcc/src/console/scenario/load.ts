import type { BBox, Geo, Ms, RasterMeta, ScenarioManifest, ScenarioPack } from '../contracts';

/** Extra fields present in public/data/caldor/manifest.json beyond ScenarioManifest (additive). */
export interface CaldorManifestExtras {
  /** Minutes east of UTC for the display timezone (PDT = -420). */
  tzOffsetMin: number;
  /** Ignition (IRWIN discovery time and initial lat/lon). */
  ignition: { t: Ms; pos: Geo };
  /** Full data range: ignition -> last FEDS perimeter. arrival < 0 means burned before manifest.start. */
  dataStart: Ms;
  dataEnd: Ms;
  replayNote: string;
  /** Dated NASA GIBS overlays (VIIRS true colour JPEG + thermal anomalies PNG) for Aug 16-18 2021. */
  imageryExtra: { url: string; bbox: BBox; date: string; source: string; width: number; height: number }[];
  /** Main offline mosaic; mirrored onto ScenarioPack.imagery. */
  imagery: NonNullable<ScenarioPack['imagery']>;
  hotspotMode: 'firms' | 'feds' | 'synth';
  notes: string[];
  generatedAt: string;
}
export type CaldorManifest = ScenarioManifest & Partial<CaldorManifestExtras>;

/** Places may carry `fictional: true` and an `osm` / `note` provenance string. */
export type CaldorPlace = ScenarioManifest['places'][number] & { fictional?: boolean; osm?: string; note?: string };

/** Final (Sept 2021) official perimeter, outside the replay window; reference/ghost only. */
export interface FinalPerimeter { t: Ms; acres: number; polygon: Geo[][] }

const finalPerimeters = new WeakMap<ScenarioPack, FinalPerimeter | null>();
const rawFbfm40 = new WeakMap<ScenarioPack, Uint8Array>();

function base(): string {
  const b = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${b.replace(/\/$/, '')}/data/caldor/`;
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`loadScenario: ${res.status} ${url}`);
  return res;
}
const json = async <T>(file: string): Promise<T> => (await fetchOk(base() + file)).json() as Promise<T>;
const bin = async (file: string): Promise<ArrayBuffer> => (await fetchOk(base() + file)).arrayBuffer();

/** Rebase a /data/caldor/... URL onto the configured Vite base path. */
function assetUrl(u: string): string {
  return u.startsWith('/data/caldor/') ? base() + u.slice('/data/caldor/'.length) : u;
}

let pending: Promise<ScenarioPack> | null = null;

/** Loads the Caldor scenario pack from /data/caldor/* (cached; concurrent callers share one fetch). */
export function loadScenario(): Promise<ScenarioPack> {
  if (!pending) {
    pending = doLoad().catch((e) => {
      pending = null;
      throw e;
    });
  }
  return pending;
}

async function doLoad(): Promise<ScenarioPack> {
  type PerFile = { perimeters: ScenarioPack['perimeters']; final: FinalPerimeter | null };
  type OsmFile = Pick<ScenarioPack, 'roads' | 'buildings' | 'water'>;
  const [manifest, raster, elev, fuel, fb, arrival, per, hot, wx, osm] = await Promise.all([
    json<CaldorManifest>('manifest.json'),
    json<RasterMeta>('raster.json'),
    bin('elevation.bin'),
    bin('fuel.bin'),
    bin('fbfm40.bin').catch(() => null),
    bin('arrival.bin'),
    json<PerFile>('perimeters.json'),
    json<{ hotspots: ScenarioPack['hotspots'] }>('hotspots.json'),
    json<{ weather: ScenarioPack['weather'] }>('weather.json'),
    json<OsmFile>('osm.json'),
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
    perimeters: per.perimeters.map((p) => ({ t: p.t, acres: p.acres, polygon: p.polygon })),
    hotspots: hot.hotspots,
    weather: wx.weather,
    roads: osm.roads,
    buildings: osm.buildings,
    water: osm.water,
    imagery: manifest.imagery ? { ...manifest.imagery, url: assetUrl(manifest.imagery.url) } : undefined,
  };
  finalPerimeters.set(pack, per.final ?? null);
  if (fb) rawFbfm40.set(pack, new Uint8Array(fb, 0, n));
  return pack;
}

/** Typed access to the manifest extras (ignition, data range, GIBS overlays, notes). */
export function scenarioExtras(pack: ScenarioPack): Partial<CaldorManifestExtras> {
  return pack.manifest as CaldorManifest;
}

export function finalPerimeter(pack: ScenarioPack): FinalPerimeter | null {
  return finalPerimeters.get(pack) ?? null;
}

/** Raw LANDFIRE FBFM40 code per cell (0 = no data), if loaded. */
export function fbfm40(pack: ScenarioPack): Uint8Array | null {
  return rawFbfm40.get(pack) ?? null;
}

/** Place by id from the manifest. */
export function placeById(pack: ScenarioPack, id: string): CaldorPlace | undefined {
  return (pack.manifest.places as CaldorPlace[]).find((p) => p.id === id);
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
