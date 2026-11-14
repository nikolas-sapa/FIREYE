import type { Geo, Ms, ScenarioId, ScenarioManifest, ScenarioPack } from '../contracts';
import { arrivalAtGeo, cellToGeo, elevationAt, inBounds, weatherAt as packWeatherAt } from '../scenario';
import { MIN, angDiff, arrivalIdx, bearingDeg, destination, distanceM, scanRadius } from './geo';
import type { ScenarioScript } from '../director/scenarios/types';
import { scriptFor } from '../director/scenarios';

export type Weather = ScenarioPack['weather'][number];
export type Place = ScenarioManifest['places'][number] & { fictional?: boolean };

/** Anchor points every scenario has; scenario scripts add their own story sites by key. */
export interface CoreSites {
  /** Primary community (the evacuation zone the story revolves around). */
  primary: Geo;
  ignition: Geo;
  fireCenterT0: Geo;
  /** Ground staging area for EMS / rescue returns. */
  staging: Geo;
  /** Safety zone / refuge for crews. */
  refuge: Geo;
  /** Helicopter water source. */
  water: Geo;
}
export type Sites = CoreSites & Record<string, Geo>;

export interface RidgeSite { id: string; name: string; pos: Geo }

/** Pack-derived helpers handed to scenario scripts while the context is being built. */
export interface SiteHelpers {
  pack: ScenarioPack;
  places: Place[];
  find(re: RegExp): Place | undefined;
  primary: Place;
  tPrimary: Ms;
  T0: Ms;
  ignition: Geo;
  fireCenterT0: Geo;
  /** Nearest raster cell to `target` within r whose replay arrival is in [tMin, tMax] (story placement only). */
  pickCell(target: Geo, r: number, tMin: Ms, tMax: Ms, avoid?: (g: Geo) => boolean): Geo;
  nearestRoadPoint(g: Geo, maxM: number, nameRe?: RegExp): Geo | null;
  roadNamesNear(g: Geo, r: number): string[];
  buildingsNear(g: Geo, r: number): number;
  nearestPlace(g: Geo): Place;
  arrivalNear(g: Geo, r: number): number;
  /** Highest terrain per bearing sector around `center` between minM and maxM. */
  highPoints(center: Geo, sectors: [number, number][], minM: number, maxM: number): { pos: Geo; elev: number }[];
  /** Nearest water (FuelClass.Water) cell to g within maxM, or null. */
  nearestWater(g: Geo, maxM: number): Geo | null;
}

export interface ScenarioContext {
  id: ScenarioId;
  script: ScenarioScript;
  pack: ScenarioPack;
  start: Ms;
  end: Ms;
  tzLabel: string;
  tzOffsetMin: number;
  /** First replay arrival within 600 m of the primary community (story timing only, never the projection). */
  tPrimary: Ms;
  /** Demo Director t=0. */
  T0: Ms;
  /** Earliest time the Projection agent runs (fire detected). */
  tDetect: Ms;
  /** When the Projection agent ingests the later forecast (null = hourly forecast from the start). */
  tShift: Ms | null;
  shiftFrom: Weather;
  shiftTo: Weather;
  places: Place[];
  primaryId: string;
  primaryName: string;
  /** Min replay arrival (abs ms, Infinity = never) within 600 m of each place (story timing only). */
  placeArr: Record<string, number>;
  sites: Sites;
  /** Road and site names resolved from the pack. */
  names: Record<string, string>;
  ridge: RidgeSite[];
  structuresPrimary: number;
  weatherAt(t: Ms): Weather;
  /** Burned area at t in the scenario's display unit (acres or ha). */
  areaAt(t: Ms): number;
  areaText(t: Ms): string;
  arrivalAt(g: Geo): number;
  arrivalNear(g: Geo, r: number): number;
  elevAt(g: Geo): number;
  nearestPlace(g: Geo): Place;
  roadNamesNear(g: Geo, r: number): string[];
  nearestRoadPoint(g: Geo, maxM: number, nameRe?: RegExp): Geo | null;
  buildingsNear(g: Geo, r: number): number;
  fmtTime(t: Ms): string;
  fmtDate(t: Ms): string;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function buildContext(pack: ScenarioPack): ScenarioContext {
  const script = scriptFor(pack.manifest.id);
  const m = pack.manifest as ScenarioManifest & { tzOffsetMin?: number; ignition?: { t: Ms; pos: Geo } };
  const start = m.start;
  const end = m.end;
  const tzOffsetMin = m.tzOffsetMin ?? script.tzOffsetMin;
  const places: Place[] = m.places.slice();
  const find = (re: RegExp): Place | undefined => places.find((p) => re.test(p.id) || re.test(p.name));
  const primary = find(script.primary.match) ?? (places.push(script.primary.fallback), script.primary.fallback);
  const pc = primary.pos;

  const finite = pack.arrival.filter((v) => v === v);
  finite.sort();
  const { w: W, bbox } = pack.raster;
  const midLat = (bbox[1] + bbox[3]) / 2;
  const cellHa = (((bbox[2] - bbox[0]) / W) * 111320 * Math.cos((midLat * Math.PI) / 180) * ((bbox[3] - bbox[1]) / pack.raster.h) * 110574) / 10_000;
  const cellArea = script.areaUnit === 'acres' ? cellHa * 2.4710538 : cellHa;

  const arrivalNear = (g: Geo, r: number): number => {
    let best = Infinity;
    scanRadius(pack, g, r, 1, (_x, _y, i) => {
      const a = arrivalIdx(pack, i);
      if (a < best) best = a;
    });
    return best;
  };
  const roadNamesNear = (g: Geo, r: number): string[] => {
    const hits: { name: string; d: number }[] = [];
    for (const road of pack.roads) {
      if (!road.name) continue;
      let dm = Infinity;
      for (const c of road.coords) {
        const d = distanceM(g, c);
        if (d < dm) dm = d;
      }
      if (dm <= r) hits.push({ name: road.name, d: dm });
    }
    hits.sort((a, b) => a.d - b.d);
    return [...new Set(hits.map((h) => h.name))];
  };
  const nearestRoadPoint = (g: Geo, maxM: number, nameRe?: RegExp): Geo | null => {
    let best: Geo | null = null;
    let bd = maxM;
    for (const road of pack.roads) {
      if (nameRe && !nameRe.test(road.name ?? '')) continue;
      for (const c of road.coords) {
        const d = distanceM(g, c);
        if (d < bd) {
          bd = d;
          best = { lon: c.lon, lat: c.lat };
        }
      }
    }
    return best;
  };
  const buildingsNear = (g: Geo, r: number): number => pack.buildings.reduce((n, b) => (distanceM(g, b.pos) <= r ? n + 1 : n), 0);
  const nearestPlace = (g: Geo): Place => {
    let best = places[0];
    let bd = Infinity;
    for (const p of places) {
      const d = distanceM(g, p.pos);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };
  const pickCell = (target: Geo, r: number, tMin: Ms, tMax: Ms, avoid?: (g: Geo) => boolean): Geo => {
    let best: Geo | null = null;
    let bd = Infinity;
    scanRadius(pack, target, r, 2, (x, y, i, d) => {
      const a = arrivalIdx(pack, i);
      if (a < tMin || a > tMax || d >= bd) return;
      const g = cellToGeo(pack, x, y);
      if (avoid && avoid(g)) return;
      bd = d;
      best = g;
    });
    return best ?? target;
  };
  const highPoints = (center: Geo, sectors: [number, number][], minM: number, maxM: number) => {
    const best = sectors.map(() => ({ elev: -Infinity, pos: null as Geo | null }));
    scanRadius(pack, center, maxM, 5, (x, y, i, d) => {
      if (d < minM) return;
      const g = cellToGeo(pack, x, y);
      const b = bearingDeg(center, g);
      const k = sectors.findIndex(([a, z]) => (a <= z ? b >= a && b < z : b >= a || b < z));
      if (k < 0) return;
      const e = pack.elevation[i];
      if (e > best[k].elev) best[k] = { elev: e, pos: g };
    });
    return best.map((b, k) => ({ pos: b.pos ?? destination(center, sectors[k][0], (minM + maxM) / 2), elev: b.pos ? b.elev : 0 }));
  };
  const nearestWater = (g: Geo, maxM: number): Geo | null => {
    let best: Geo | null = null;
    let bd = Infinity;
    scanRadius(pack, g, maxM, 2, (x, y, i, d) => {
      if (pack.fuel[i] !== 1 || d >= bd) return;
      bd = d;
      best = cellToGeo(pack, x, y);
    });
    return best;
  };

  const placeArr: Record<string, number> = {};
  for (const p of places) placeArr[p.id] = inBounds(pack, p.pos) ? arrivalNear(p.pos, 600) : Infinity;
  let tPrimary = placeArr[primary.id];
  if (!Number.isFinite(tPrimary)) tPrimary = start + (end - start) * 0.3;
  const { T0, tShift, tDetect } = script.timeline({ start, end, tPrimary, ignitionT: m.ignition?.t });

  const weatherAt = (t: Ms): Weather => packWeatherAt(pack, t);
  const shiftFrom = weatherAt(tShift ?? T0);
  let shiftTo = shiftFrom;
  if (tShift !== null) {
    let bestTurn = 0;
    for (const s of pack.weather) {
      if (s.t <= tShift || s.t > tShift + 5 * 60 * MIN) continue;
      const turn = Math.abs(angDiff(shiftFrom.windDirDeg, s.windDirDeg));
      if (turn > bestTurn) {
        bestTurn = turn;
        shiftTo = s;
      }
    }
  }

  // Ignition and the fire centroid at T0 (observed state at T0; the ignition point if nothing has burned yet).
  let ignition = m.ignition?.pos;
  let sx = 0;
  let sy = 0;
  let sn = 0;
  {
    let minA = Infinity;
    let minI = -1;
    const rel = T0 - start;
    for (let y = 0; y < pack.raster.h; y += 3) {
      for (let x = 0; x < W; x += 3) {
        const i = y * W + x;
        const a = pack.arrival[i];
        if (!(a === a)) continue;
        if (a < minA) {
          minA = a;
          minI = i;
        }
        if (a <= rel) {
          sx += x;
          sy += y;
          sn++;
        }
      }
    }
    if (!ignition && minI >= 0) ignition = cellToGeo(pack, minI % W, Math.floor(minI / W));
  }
  ignition = ignition ?? destination(pc, 190, 5500);
  const fireCenterT0 = sn ? cellToGeo(pack, sx / sn, sy / sn) : ignition;

  const helpers: SiteHelpers = {
    pack,
    places,
    find,
    primary,
    tPrimary,
    T0,
    ignition,
    fireCenterT0,
    pickCell,
    nearestRoadPoint,
    roadNamesNear,
    buildingsNear,
    nearestPlace,
    arrivalNear,
    highPoints,
    nearestWater,
  };
  const extra = script.sites(helpers);
  const sites: Sites = { ...extra, primary: pc, ignition, fireCenterT0 };
  const names = script.names?.(helpers, sites) ?? {};
  const ridge = script.cams(helpers, sites);

  const fmtTime = (t: Ms): string => `${new Date(t + tzOffsetMin * MIN).toISOString().slice(11, 16)} ${m.tz}`;
  const fmtDate = (t: Ms): string => {
    const d = new Date(t + tzOffsetMin * MIN);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };
  const areaAt = (t: Ms): number => {
    const rel = t - start;
    let lo = 0;
    let hi = finite.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (finite[mid] <= rel) lo = mid + 1;
      else hi = mid;
    }
    return lo * cellArea;
  };

  return {
    id: m.id,
    script,
    pack,
    start,
    end,
    tzLabel: m.tz,
    tzOffsetMin,
    tPrimary,
    T0,
    tDetect,
    tShift,
    shiftFrom,
    shiftTo,
    places,
    primaryId: primary.id,
    primaryName: primary.name,
    placeArr,
    sites,
    names,
    ridge,
    structuresPrimary: buildingsNear(pc, script.primary.radiusM ?? 2500),
    weatherAt,
    areaAt,
    areaText: (t) => `${Math.round(areaAt(t)).toLocaleString('en-US')} ${script.areaUnit}`,
    arrivalAt: (g) => arrivalAtGeo(pack, g),
    arrivalNear,
    elevAt: (g) => elevationAt(pack, g),
    nearestPlace,
    roadNamesNear,
    nearestRoadPoint,
    buildingsNear,
    fmtTime,
    fmtDate,
  };
}
