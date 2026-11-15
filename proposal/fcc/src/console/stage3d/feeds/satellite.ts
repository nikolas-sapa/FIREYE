import type { BBox, Geo, ScenarioPack } from '../../contracts';
import { scenarioExtras } from '../../scenario/load';

const DEG = Math.PI / 180;

export interface SatScene {
  /** True when pixels are real archived imagery (never true for a synthetic render). */
  real: boolean;
  /** Short source line for the HUD, e.g. "VIIRS SNPP · TRUE COLOUR". */
  sensor: string;
  /** Acquisition date (YYYY-MM-DD) or the base mosaic's date text. */
  date: string;
  /** Overpass time in ms when known (or a nominal one, see `nominal`). */
  passT?: number;
  /** Pass time is the sensor's nominal equator crossing, not a per-scene timestamp. */
  nominal: boolean;
  /** Full attribution. */
  source: string;
  /** Pre-fire base mosaic rather than a dated scene. */
  base: boolean;
}

interface Img { url: string; bbox: BBox; date: string; source: string; t?: number; overpassT?: number }

const images = new Map<string, Promise<HTMLImageElement | null>>();
function loadImg(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = url;
    });
    images.set(url, p);
  }
  return p;
}

const isTrue = (i: Img) => /truecolor|true_color|corrected/i.test(i.url + i.source);
const isThermalImg = (i: Img) => /thermal|anomal|fire/i.test(i.url + i.source) && !isTrue(i);

/**
 * Nominal local solar overpass times of the sun-synchronous imagers: Terra descends at about 10:30,
 * Aqua, Suomi NPP and NOAA-20 ascend at about 13:30.
 */
function nominalPass(date: string, lon: number, source: string): number {
  const d = Date.parse(`${date}T00:00:00Z`);
  const lst = /Terra|Sentinel-2|Landsat/i.test(source) ? 10.5 : 13.5;
  return d + (lst - lon / 15) * 3600e3;
}

function sensorOf(source: string): string {
  if (/VIIRS_SNPP/i.test(source)) return 'VIIRS SNPP';
  if (/VIIRS_NOAA20/i.test(source)) return 'VIIRS NOAA-20';
  if (/MODIS_Terra/i.test(source)) return 'MODIS TERRA';
  if (/MODIS_Aqua/i.test(source)) return 'MODIS AQUA';
  if (/Sentinel-2/i.test(source)) return 'SENTINEL-2';
  if (/Landsat/i.test(source)) return 'LANDSAT';
  return source.split(/[ ,(]/)[0].toUpperCase();
}

/**
 * Picks the real image the satellite feed may show at replay time t: the latest dated true-colour scene
 * whose overpass is not in the future, plus its thermal-anomaly layer, else the pre-fire base mosaic.
 * Returns null when the pack has no imagery (the feed then says it is a synthetic render).
 */
export function pickSatScene(pack: ScenarioPack, t: number): { scene: SatScene; trueImg: Img; thermal?: Img } | null {
  const ex = (scenarioExtras(pack).imageryExtra ?? []) as Img[];
  const lon = (pack.manifest.center ?? { lon: (pack.raster.bbox[0] + pack.raster.bbox[2]) / 2 }).lon;
  const passOf = (i: Img) => i.overpassT ?? i.t ?? nominalPass(i.date, lon, i.source);
  let best: Img | null = null;
  for (const i of ex) if (isTrue(i) && passOf(i) <= t && (!best || passOf(i) > passOf(best))) best = i;
  if (best) {
    const exact = best.overpassT !== undefined || best.t !== undefined;
    const thermal = ex.find((i) => isThermalImg(i) && i.date === best!.date);
    return {
      scene: { real: true, sensor: `${sensorOf(best.source)} · TRUE COLOUR`, date: best.date, passT: passOf(best), nominal: !exact, source: best.source, base: false },
      trueImg: best,
      thermal,
    };
  }
  const im = pack.imagery;
  if (!im) return null;
  return {
    scene: { real: true, sensor: `${sensorOf(im.source)} · BASE MOSAIC`, date: im.date ?? '', nominal: false, source: im.source, base: true },
    trueImg: { url: im.url, bbox: im.bbox, date: im.date ?? '', source: im.source },
  };
}

/**
 * Draws the real scene, cropped to a footprint centred on `c`, into `out`. Pixels outside the image
 * stay dark (no data) rather than being invented. Resolves false while images are still loading.
 */
export async function drawSatScene(out: HTMLCanvasElement, pick: NonNullable<ReturnType<typeof pickSatScene>>, c: Geo, footprintM: number): Promise<boolean> {
  const [a, th] = await Promise.all([loadImg(pick.trueImg.url), pick.thermal ? loadImg(pick.thermal.url) : Promise.resolve(null)]);
  if (!a) return false;
  const g = out.getContext('2d')!;
  const W = out.width, H = out.height;
  const b = pick.trueImg.bbox;
  const mLon = 111320 * Math.cos(c.lat * DEG), mLat = 110540;
  const imgWm = (b[2] - b[0]) * mLon;
  const fw = Math.min(footprintM, imgWm);
  const fh = (fw * H) / W;
  const dLon = fw / mLon, dLat = fh / mLat;
  const { west, north } = cropOrigin(c, b, dLon, dLat);
  g.fillStyle = 'black';
  g.fillRect(0, 0, W, H);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const place = (img: HTMLImageElement, bb: BBox) => {
    const x = ((bb[0] - west) / dLon) * W, y = ((north - bb[3]) / dLat) * H;
    const w = ((bb[2] - bb[0]) / dLon) * W, h = ((bb[3] - bb[1]) / dLat) * H;
    g.drawImage(img, x, y, w, h);
  };
  place(a, b);
  if (th && pick.thermal) place(th, pick.thermal.bbox);
  return true;
}

/** Crop centred on `c`, shifted to stay inside the image where the image is large enough. */
function cropOrigin(c: Geo, b: BBox, dLon: number, dLat: number) {
  const fit = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  const west = fit(c.lon - dLon / 2, b[0], b[2] - dLon);
  const north = fit(c.lat + dLat / 2, b[1] + dLat, b[3]);
  return { west, north };
}

/** Map a geo position into the sat frame (normalised 0..1), matching drawSatScene's crop. */
export function satProject(p: Geo, c: Geo, footprintM: number, pick: NonNullable<ReturnType<typeof pickSatScene>>, aspect: number): { x: number; y: number; mPerUnit: number } {
  const b = pick.trueImg.bbox;
  const mLon = 111320 * Math.cos(c.lat * DEG), mLat = 110540;
  const fw = Math.min(footprintM, (b[2] - b[0]) * mLon);
  const fh = fw / aspect;
  const { west, north } = cropOrigin(c, b, fw / mLon, fh / mLat);
  return { x: ((p.lon - west) * mLon) / fw, y: ((north - p.lat) * mLat) / fh, mPerUnit: fw };
}
