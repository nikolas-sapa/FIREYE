import type { Geo, Ms, ScenarioManifest, ScenarioPack } from '../contracts';
import { arrivalAtGeo, cellToGeo, elevationAt, inBounds, weatherAt as packWeatherAt } from '../scenario';
import { MIN, angDiff, arrivalIdx, bearingDeg, centroid, destination, distanceM, scanRadius } from './geo';

export type Weather = ScenarioPack['weather'][number];
export type Place = ScenarioManifest['places'][number] & { fictional?: boolean };

/** Story anchor points, derived from the real pack (arrival raster, OSM, manifest places). */
export interface Sites {
  gf: Geo;
  trailhead: Geo;
  ranch: Geo;
  lake: Geo;
  ignition: Geo;
  fireCenterT0: Geo;
  hikers: Geo;
  hikersReported: Geo;
  spot: Geo;
  spotReported: Geo;
  propane: Geo;
  propaneRoad: Geo;
  propaneRoadName: string;
  school: Geo;
  vehicles: Geo;
  vehiclesRoadName: string;
  powerline: Geo;
  powerlineRoadName: string;
  brush: Geo;
  staging: Geo;
  pollock: Geo;
  slyPark: Geo;
}

export interface RidgeSite { id: string; name: string; pos: Geo }

export interface ScenarioContext {
  pack: ScenarioPack;
  start: Ms;
  end: Ms;
  tzLabel: string;
  tzOffsetMin: number;
  /** First fire arrival within 600 m of Grizzly Flats. */
  tGF: Ms;
  /** Demo Director t=0 (tGF - 150 min). */
  T0: Ms;
  /** When the Projection agent ingests the evening wind shift (T0 + 60 min). */
  tShift: Ms;
  shiftFrom: Weather;
  shiftTo: Weather;
  places: Place[];
  gfId: string;
  gfName: string;
  /** Min arrival (abs ms, Infinity = never) within 600 m of each place. */
  placeArr: Record<string, number>;
  sites: Sites;
  ridge: RidgeSite[];
  structuresGF: number;
  weatherAt(t: Ms): Weather;
  acresAt(t: Ms): number;
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
  const m = pack.manifest as ScenarioManifest & { tzOffsetMin?: number; ignition?: { t: Ms; pos: Geo } };
  const start = m.start;
  const end = m.end;
  const tzOffsetMin = m.tzOffsetMin ?? -420;
  const places: Place[] = m.places.slice();
  const find = (re: RegExp): Place | undefined => places.find((p) => re.test(p.id) || re.test(p.name));
  const ensure = (re: RegExp, p: Place): Place => {
    const f = find(re);
    if (f) return f;
    places.push(p);
    return p;
  };
  const gfP = ensure(/^grizzly[- ]flats?$/i, { id: 'grizzly-flats', name: 'Grizzly Flats', pos: { lon: -120.52742, lat: 38.63629 }, kind: 'town' });
  const gf = gfP.pos;

  const finite = pack.arrival.filter((v) => v === v);
  finite.sort();
  const { w: W, bbox } = pack.raster;
  const midLat = (bbox[1] + bbox[3]) / 2;
  const cellAcres = (((bbox[2] - bbox[0]) / W) * 111320 * Math.cos((midLat * Math.PI) / 180) * ((bbox[3] - bbox[1]) / pack.raster.h) * 110574) / 4046.8564;

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

  const placeArr: Record<string, number> = {};
  for (const p of places) placeArr[p.id] = inBounds(pack, p.pos) ? arrivalNear(p.pos, 600) : Infinity;
  let tGF = placeArr[gfP.id];
  if (!Number.isFinite(tGF)) tGF = start + (end - start) * 0.3;
  const T0 = Math.max(start, tGF - 150 * MIN);
  const tShift = T0 + 60 * MIN;

  const weatherAt = (t: Ms): Weather => packWeatherAt(pack, t);
  const shiftFrom = weatherAt(tShift);
  let shiftTo = shiftFrom;
  let bestTurn = 0;
  for (const s of pack.weather) {
    if (s.t <= tShift || s.t > tShift + 5 * 60 * MIN) continue;
    const turn = Math.abs(angDiff(shiftFrom.windDirDeg, s.windDirDeg));
    if (turn > bestTurn) {
      bestTurn = turn;
      shiftTo = s;
    }
  }

  // Ignition and fire centroid at T0.
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
  ignition = ignition ?? destination(gf, 190, 5500);
  const fireCenterT0 = sn ? cellToGeo(pack, sx / sn, sy / sn) : ignition;

  const trailhead = find(/trailhead|cosumnes-ridge/i)?.pos ?? destination(gf, 165, 2900);
  const hikers = pickCell(trailhead, 1400, T0 + 75 * MIN, T0 + 105 * MIN);
  const spot = pickCell(destination(gf, 200, 2000), 2600, T0 + 70 * MIN, T0 + 90 * MIN, (g) => distanceM(g, hikers) < 900);
  const ranch = places.find((p) => p.kind === 'ranch')?.pos ?? destination(gf, 70, 3600);
  const lakeWater = pack.water.find((w) => /jenkinson/i.test(w.name ?? ''));
  const lake = lakeWater ? centroid(lakeWater.polygon) : find(/jenkinson/i)?.pos ?? { lon: -120.553, lat: 38.7245 };

  let propane: Geo | null = null;
  {
    const target = destination(gf, 170, 500);
    let bd = Infinity;
    for (const b of pack.buildings) {
      if (distanceM(b.pos, gf) > 1600) continue;
      const a = arrivalAtGeo(pack, b.pos);
      if (a < tGF - 10 * MIN || a > tGF + 45 * MIN) continue;
      const d = distanceM(b.pos, target);
      if (d < bd) {
        bd = d;
        propane = { lon: b.pos.lon, lat: b.pos.lat };
      }
    }
  }
  const propaneP = propane ?? pickCell(destination(gf, 170, 500), 1500, tGF - 10 * MIN, tGF + 45 * MIN);
  const propaneRoad = nearestRoadPoint(propaneP, 500) ?? propaneP;
  const vehT = destination(gf, 290, 1400);
  const vehicles = nearestRoadPoint(vehT, 2500, /grizzly flat/i) ?? nearestRoadPoint(vehT, 1500) ?? vehT;
  const plT = destination(gf, 30, 1800);
  const powerline = nearestRoadPoint(plT, 2500, /sciaroni|shingle mill/i) ?? nearestRoadPoint(plT, 1500) ?? plT;
  const stT = destination(gf, 330, 900);

  const sites: Sites = {
    gf,
    trailhead,
    ranch,
    lake,
    ignition,
    fireCenterT0,
    hikers,
    hikersReported: destination(hikers, 300, 220),
    spot,
    spotReported: destination(spot, 60, 140),
    propane: propaneP,
    propaneRoad,
    propaneRoadName: roadNamesNear(propaneP, 300)[0] ?? 'Grizzly Flat Road',
    school: destination(gf, 20, 300),
    vehicles,
    vehiclesRoadName: roadNamesNear(vehicles, 60)[0] ?? 'Grizzly Flat Road',
    powerline,
    powerlineRoadName: roadNamesNear(powerline, 60)[0] ?? 'Sciaroni Road',
    brush: pickCell(destination(gf, 210, 1600), 2500, tGF - 60 * MIN, tGF + 60 * MIN),
    staging: nearestRoadPoint(stT, 1200) ?? stT,
    pollock: find(/pollock/i)?.pos ?? { lon: -120.5866, lat: 38.7613 },
    slyPark: find(/^sly[- ]park$/i)?.pos ?? { lon: -120.5846, lat: 38.7213 },
  };

  // Two ridge cameras on the highest terrain north and east of Grizzly Flats.
  const ridge: RidgeSite[] = [];
  {
    const best: { e: number; g: Geo | null }[] = [{ e: -Infinity, g: null }, { e: -Infinity, g: null }];
    scanRadius(pack, gf, 14000, 5, (x, y, i, d) => {
      if (d < 3000) return;
      const g = cellToGeo(pack, x, y);
      const b = bearingDeg(gf, g);
      const k = b >= 300 || b < 40 ? 0 : b >= 60 && b < 150 ? 1 : -1;
      if (k < 0) return;
      const e = pack.elevation[i];
      if (e > best[k].e) best[k] = { e, g };
    });
    best.forEach((b, k) => {
      const g = b.g ?? destination(gf, k ? 100 : 0, 7000);
      const pl = nearestPlace(g);
      ridge.push({ id: `ridge-${k + 1}`, name: `RIDGE CAM ${k + 1} · ${pl.name.toUpperCase()} ${Math.round(b.e > 0 ? b.e : elevationAt(pack, g))} M`, pos: g });
    });
  }

  const fmtTime = (t: Ms): string => `${new Date(t + tzOffsetMin * MIN).toISOString().slice(11, 16)} ${m.tz}`;
  const fmtDate = (t: Ms): string => {
    const d = new Date(t + tzOffsetMin * MIN);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };

  return {
    pack,
    start,
    end,
    tzLabel: m.tz,
    tzOffsetMin,
    tGF,
    T0,
    tShift,
    shiftFrom,
    shiftTo,
    places,
    gfId: gfP.id,
    gfName: gfP.name,
    placeArr,
    sites,
    ridge,
    structuresGF: buildingsNear(gf, 2500),
    weatherAt,
    acresAt: (t) => {
      const rel = t - start;
      let lo = 0;
      let hi = finite.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (finite[mid] <= rel) lo = mid + 1;
        else hi = mid;
      }
      return lo * cellAcres;
    },
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
