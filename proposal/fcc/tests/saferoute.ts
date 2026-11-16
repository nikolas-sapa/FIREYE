import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Geo, Projection } from '../src/console/contracts';
import { createBus } from '../src/console/bus';
import { fieldEtaAt, type SpreadField } from '../src/console/agents/spread';
import { loadScenario } from '../src/console/scenario';
import { consoleStore } from '../src/console/store';
import { Runtime } from '../src/console/world/runtime';
import { leaveBy, placeAlerts, residentAlertAt, wireAlerts } from '../src/console/ops/alerts';
import { BALANCED_TIME_CAP, buildRoadGraph, ETA_SAFETY_MARGIN_MIN, escapeRoutes, googleMapsDirectionsUrl, googleMapsEmbedUrl, mapsWaypointLimit, MATI_EXITS, pointInPolygon, polygonDistanceM, routeOptions, ROUTE_KINDS, steeringWaypoints, type RouteOption, type RouteOptions, type Road } from '../src/console/ops/geo/evac';
import { parseLocation, residentEstimateAt, residentRouteOptions, routingHazardAt } from '../src/console/ops/geo/saferoute';
import { routeDirections } from '../src/console/ops/ResidentRoute';

const osm = JSON.parse(readFileSync('public/data/mati/osm.json', 'utf8')) as { roads: Road[] };
const manifest = JSON.parse(readFileSync('public/data/mati/manifest.json', 'utf8')) as { places: { id: string; name: string; pos: Geo }[] };
const { bbox } = JSON.parse(readFileSync('public/data/mati/raster.json', 'utf8')) as { bbox: number[] };
const place = (id: string) => manifest.places.find((p) => p.id === id)!.pos;
const square = (p: Geo, d: number): Geo[] => [
  { lon: p.lon - d, lat: p.lat - d }, { lon: p.lon + d, lat: p.lat - d },
  { lon: p.lon + d, lat: p.lat + d }, { lon: p.lon - d, lat: p.lat + d },
];
const burning = square(place('ignition'), 0.002);
const predicted = square({ lon: 23.962, lat: 38.035 }, 0.0015);
const caution = square(place('ignition'), 0.006);
const hazard = { blocked: [burning, predicted], caution: [caution] };
const graph = buildRoadGraph(osm.roads);
for (const id of ['neos-voutzas', 'nea-makri', 'kokkino-limanaki']) {
  const routes = escapeRoutes(graph, place(id), hazard, MATI_EXITS);
  assert.ok(routes.length > 0, `${id}: routes exist`);
  for (const route of routes) {
    for (let i = 0; i < route.path.length; i++) {
      const p = route.path[i], prev = route.path[Math.max(0, i - 1)];
      const midpoint = { lon: (p.lon + prev.lon) / 2, lat: (p.lat + prev.lat) / 2 };
      for (const blocked of hazard.blocked) {
        assert.ok(!pointInPolygon(p, blocked), `${id}: clear node`);
        assert.ok(!pointInPolygon(midpoint, blocked), `${id}: clear midpoint`);
      }
    }
    const wp = steeringWaypoints(route.path);
    assert.ok(wp.length <= 3 && wp.length > 0);
    assert.ok(wp.every((p) => route.path.includes(p)));
    assert.equal(steeringWaypoints(route.path, 20).length, 9);
  }
  const clear = escapeRoutes(graph, place(id), hazard, MATI_EXITS, { clearanceM: 500 });
  const minDistance = (path: Geo[]) => Math.min(...path.map((p) => Math.min(...hazard.blocked.map((poly) => polygonDistanceM(p, poly)))));
  assert.ok(minDistance(clear[0].path) + 0.01 >= minDistance(routes[0].path), `${id}: clearance never lower`);
}
assert.deepEqual(escapeRoutes(graph, place('ignition'), hazard, MATI_EXITS), []);
assert.deepEqual(escapeRoutes(buildRoadGraph([]), place('mati'), hazard, MATI_EXITS), []);
assert.deepEqual(escapeRoutes(graph, place('mati'), hazard, []), []);
console.log('SAFEROUTE routing: 3 real origins, zero blocked nodes/midpoints, clearance non-decreasing; blocked/empty cases pass');

const entries = [
  { t: 10, bands: [{ horizonMin: 60, polygon: predicted }, { horizonMin: 180, polygon: caution }] },
  { t: 30, bands: [{ horizonMin: 60, polygon: square(place('neos-voutzas'), 0.02) }] },
];
const perimeters = [{ t: 5, polygon: [burning] }, { t: 25, polygon: [caution] }];
const at20 = { blocked: [predicted, burning], caution: [caution], fire: [burning] };
assert.deepEqual(routingHazardAt(20, entries, perimeters), at20);
assert.equal(routingHazardAt(0, entries, perimeters), null);
assert.deepEqual(routingHazardAt(20, entries.slice().reverse(), perimeters.slice().reverse()), at20);
console.log('SAFEROUTE clock: latest issued projection and known perimeter only; future entries excluded');
assert.equal(residentEstimateAt(place('ignition'), 20, entries, perimeters).stage, 'shelter');
assert.equal(residentEstimateAt(predicted[0], 20, [], []).stage, 'monitor');
assert.equal(residentEstimateAt({ lon: 23.962, lat: 38.035 }, 20, entries, perimeters).eta, null);
assert.equal(residentEstimateAt({ lon: 23.957, lat: 38.043 }, 20, entries, perimeters).stage, 'monitor');
assert.equal(residentEstimateAt(place('nea-makri'), 20, entries, perimeters).eta, null);
console.log('SAFEROUTE custom resident: shelter policy unchanged; band-only/empty estimates remain unavailable');

const origin = { lat: 38.123456, lon: 23.987654 };
const destination = { lat: 38.234567, lon: 24.123456 };
const waypoints = [{ lat: 38.15, lon: 24 }, { lat: 38.2, lon: 24.1 }];
const url = new URL(googleMapsDirectionsUrl({ origin, destination, waypoints }));
assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
assert.deepEqual(Object.fromEntries(url.searchParams), { api: '1', origin: '38.12346,23.98765', destination: '38.23457,24.12346', travelmode: 'driving', waypoints: '38.15000,24.00000|38.20000,24.10000' });
assert.ok(!new URL(googleMapsDirectionsUrl({ origin, destination })).searchParams.has('waypoints'));
assert.equal(new URL(googleMapsDirectionsUrl({ origin, destination, travelmode: 'walking' })).searchParams.get('travelmode'), 'walking');
const embed = new URL(googleMapsEmbedUrl({ origin, destination, waypoints }, 'test key&only'));
assert.equal(embed.searchParams.get('key'), 'test key&only');
assert.equal(embed.searchParams.get('mode'), 'driving');
assert.equal(embed.searchParams.get('waypoints'), url.searchParams.get('waypoints'));
assert.deepEqual(steeringWaypoints([]), []);
assert.deepEqual(steeringWaypoints([origin]), []);
assert.deepEqual(steeringWaypoints([origin, ...waypoints, destination], 0), []);
assert.deepEqual(steeringWaypoints([origin, origin, origin]), []);
console.log('SAFEROUTE Maps: exact five-decimal encoded fields, empty waypoints omitted, embed key encoded, <=3 on-path points');
{
  // F08: a thin caution strip crossed by a long edge whose midpoint lies far outside it.
  const a = { lon: 23.92, lat: 38.02 }, b = { lon: 23.94, lat: 38.02 };
  const g = buildRoadGraph([{ id: 'w', name: 'Test Rd', kind: 'primary', coords: [a, b] }]);
  const exit = [{ id: 'east', label: 'East', pos: b }];
  const strip = (w: number, e: number): Geo[] => [{ lon: w, lat: 38.019 }, { lon: e, lat: 38.019 }, { lon: e, lat: 38.021 }, { lon: w, lat: 38.021 }];
  const run = (caution: Geo[][], opts = {}) => escapeRoutes(g, a, { blocked: [], caution }, exit, opts)[0]!;
  const clear = run([]);
  assert.equal(clear.cautionM, 0);
  for (const [w, e] of [[23.921, 23.922], [23.9215, 23.92152], [23.938, 23.94]] as const) {
    const r = run([strip(w, e)]);
    const widthM = (e - w) * 111320 * Math.cos(38.02 * Math.PI / 180);
    assert.ok(r.cautionM > 0, `thin caution ${w}-${e} counted`);
    assert.ok(r.cautionM <= Math.max(widthM, clear.lengthM / Math.ceil(clear.lengthM / 20)) + 25, `caution ${r.cautionM.toFixed(0)} m bounded by strip width ${widthM.toFixed(0)} m`);
    assert.ok(run([strip(w, e)], { clearanceM: 500 }).cautionM > 0);
  }
  // A strip near but not touching the road is not counted.
  assert.equal(run([[{ lon: 23.925, lat: 38.03 }, { lon: 23.926, lat: 38.03 }, { lon: 23.926, lat: 38.031 }, { lon: 23.925, lat: 38.031 }]]).cautionM, 0);
  const full = run([strip(23.91, 23.95)]);
  assert.ok(Math.abs(full.cautionM - full.lengthM) < 1, 'fully covered edge counts whole length');
  console.log(`SAFEROUTE caution: thin/long-edge crossings counted (${run([strip(23.921, 23.922)]).cautionM.toFixed(0)} m of ${clear.lengthM.toFixed(0)} m), disjoint 0, full edge = length`);
}

const checkOptions = (label: string, o: RouteOptions | null, blockedPolys: Geo[][]) => {
  assert.ok(o, `${label}: options exist`);
  const { fastest, balanced, safest } = o;
  assert.ok(balanced.timeMin <= fastest.timeMin * BALANCED_TIME_CAP + 1e-9, `${label}: balanced ${balanced.timeMin.toFixed(1)} <= cap ${(fastest.timeMin * BALANCED_TIME_CAP).toFixed(1)} min`);
  assert.ok(fastest.timeMin <= balanced.timeMin + 1e-9 && fastest.timeMin <= safest.timeMin + 1e-9, `${label}: fastest has min time`);
  assert.ok(safest.riskM <= balanced.riskM + 1e-9 && balanced.riskM <= fastest.riskM + 1e-9, `${label}: risk safest ${safest.riskM.toFixed(0)} <= balanced ${balanced.riskM.toFixed(0)} <= fastest ${fastest.riskM.toFixed(0)}`);
  for (const kind of ROUTE_KINDS) {
    const r: RouteOption = o[kind];
    assert.equal(r.kind, kind);
    assert.ok(r.why.length > 10 && !r.why.includes('undefined') && !r.why.includes('NaN'), `${label}: ${kind} why '${r.why}'`);
    for (let i = 0; i < r.path.length; i++) {
      const mid = { lon: (r.path[i].lon + r.path[Math.max(0, i - 1)].lon) / 2, lat: (r.path[i].lat + r.path[Math.max(0, i - 1)].lat) / 2 };
      for (const poly of blockedPolys) assert.ok(!pointInPolygon(r.path[i], poly) && !pointInPolygon(mid, poly), `${label}: ${kind} never enters blocked/perimeter`);
    }
  }
  return o;
};
for (const id of ['neos-voutzas', 'nea-makri', 'kokkino-limanaki', 'mati']) {
  const t0 = performance.now();
  const o = checkOptions(id, routeOptions(graph, place(id), { ...hazard, fire: [burning] }, MATI_EXITS, { places: manifest.places }), hazard.blocked);
  console.log(`SAFEROUTE options ${id}: fastest ${o.fastest.timeMin.toFixed(1)} min/${o.fastest.exit.id}, balanced ${o.balanced.timeMin.toFixed(1)} min/${o.balanced.exit.id} (${o.balanced.why}), safest ${o.safest.timeMin.toFixed(1)} min/${o.safest.exit.id} · ${(performance.now() - t0).toFixed(0)} ms`);
}
{
  // Two-road ladder: the straight road crosses predicted spread; a short northern detour avoids it.
  const A = { lon: 23.9, lat: 38.0 }, B = { lon: 23.93, lat: 38.0 };
  const n1 = { lon: 23.905, lat: 38.002 }, n2 = { lon: 23.925, lat: 38.002 };
  const straight = [A, { lon: 23.905, lat: 38.0 }, { lon: 23.915, lat: 38.0 }, { lon: 23.925, lat: 38.0 }, B];
  const g = buildRoadGraph([
    { id: 's', name: 'Coast Rd', kind: 'road', coords: straight },
    { id: 'n', name: 'Ridge Rd', kind: 'road', coords: [{ lon: 23.905, lat: 38.0 }, n1, { lon: 23.915, lat: 38.002 }, n2, { lon: 23.925, lat: 38.0 }] },
  ]);
  const exit = [{ id: 'east', label: 'East', pos: B }];
  const spread = square({ lon: 23.915, lat: 37.9995 }, 0.0012);
  const places = [{ name: 'Testville', pos: { lon: 23.915, lat: 37.999 } }];
  const o = checkOptions('ladder', routeOptions(g, A, { blocked: [], caution: [spread], fire: [] }, exit, { places }), []);
  assert.ok(o.fastest.cautionM > 100, 'fastest crosses predicted spread');
  assert.equal(o.balanced.cautionM, 0, 'balanced avoids predicted spread');
  assert.ok(o.balanced.extraMin >= 0 && o.balanced.timeMin < o.fastest.timeMin * 1.25, 'small detour');
  assert.ok(o.balanced.why.startsWith('Avoids the predicted spread near Testville;') && /\+\d+ min vs fastest|no extra time/.test(o.balanced.why), o.balanced.why);
  assert.ok(o.balanced.path.some((p) => p.lat > 38.0015), 'balanced uses the detour');
  // Fire ETA field: the straight road is reached 3 min from now; fastest must not pass it either.
  const etaMinAt = (p: Geo) => (Math.abs(p.lat - 38.0) < 0.0005 && p.lon > 23.906 && p.lon < 23.924 ? 3 : null);
  const timed = checkOptions('ladder-eta', routeOptions(g, A, { blocked: [], caution: [], fire: [] }, exit, { etaMinAt }), []);
  for (const kind of ROUTE_KINDS) assert.ok(timed[kind].path.every((p) => etaMinAt(p) === null), `${kind} avoids edges the fire reaches before the resident (+margin)`);
  assert.equal(timed.marginMin, 15);
  // Fire reaches only the interior of a straight-road edge (no node there): still excluded.
  const interior = (p: Geo) => (Math.abs(p.lon - 23.91) < 0.0004 && Math.abs(p.lat - 38.0) < 0.0003 ? 3 : null);
  const mid = routeOptions(g, A, { blocked: [], caution: [], fire: [] }, exit, { etaMinAt: interior })!;
  for (const kind of ROUTE_KINDS) assert.ok(!mid[kind].path.some((p, i) => i > 0 && p.lat < 38.0005 && mid[kind].path[i - 1].lat < 38.0005 && Math.min(p.lon, mid[kind].path[i - 1].lon) < 23.91 && Math.max(p.lon, mid[kind].path[i - 1].lon) > 23.91), `${kind} avoids an edge whose interior the fire reaches first`);
  assert.equal(mid.marginMin, ETA_SAFETY_MARGIN_MIN);
  // Minimum fire distance is measured along road segments, not only at nodes.
  const nearEdge = square({ lon: 23.91, lat: 37.9985 }, 0.0005);
  const fd = routeOptions(g, A, { blocked: [], caution: [], fire: [nearEdge] }, exit)!;
  assert.ok(fd.fastest.minFireM! < 150, `min fire distance on straight road ${fd.fastest.minFireM?.toFixed(0)} m`);
  // Fire arrives after the resident would pass but inside the 15-min margin: still excluded.
  const inMargin = routeOptions(g, A, { blocked: [], caution: [], fire: [] }, exit, { etaMinAt: (p) => (etaMinAt(p) === null ? null : 10) })!;
  for (const kind of ROUTE_KINDS) assert.ok(inMargin[kind].path.every((p) => etaMinAt(p) === null), `${kind} keeps ${ETA_SAFETY_MARGIN_MIN} min ahead of modeled fire`);
  assert.equal(inMargin.marginMin, ETA_SAFETY_MARGIN_MIN);
  // Every road inside the margin: margin drops to 0 (surfaced in the UI) but fire must still arrive after the resident passes.
  const tightEta = routeOptions(g, A, { blocked: [], caution: [], fire: [] }, exit, { etaMinAt: () => 10 })!;
  assert.equal(tightEta.marginMin, 0);
  assert.ok(tightEta.fastest.timeMin < 10);
  assert.equal(routeOptions(g, A, { blocked: [], caution: [], fire: [] }, exit, { etaMinAt: () => 0.2 }), null, 'fire reaches every road before the resident: no route');
  // Late fire arrival (well after passing) leaves the straight road usable.
  assert.ok(routeOptions(g, A, { blocked: [], caution: [], fire: [] }, exit, { etaMinAt: (p) => (etaMinAt(p) === null ? null : 300) })!.fastest.path.every((p) => p.lat < 38.001));
  // Balanced respects a tight cap even when the detour is safer.
  const tight = routeOptions(g, A, { blocked: [], caution: [spread], fire: [] }, exit, { places, capRatio: 1.0001 })!;
  assert.ok(tight.balanced.timeMin <= tight.fastest.timeMin * 1.0001 + 1e-9 && tight.safest.cautionM === 0);
  // Google hand-off carries the chosen route's on-path waypoints, origin = resident, driving.
  for (const mobile of [false, true]) {
    const d = routeDirections(A, o.balanced, mobile);
    const url = new URL(googleMapsDirectionsUrl(d));
    const wp = url.searchParams.get('waypoints')!.split('|');
    assert.ok(wp.length >= 1 && wp.length <= mapsWaypointLimit(mobile));
    assert.deepEqual(wp, steeringWaypoints(o.balanced.path, mapsWaypointLimit(mobile)).map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`));
    assert.ok(wp.some((w) => Number(w.split(',')[0]) > 38.0015), 'waypoints follow the detour');
    assert.equal(url.searchParams.get('origin'), '38.00000,23.90000');
    assert.equal(url.searchParams.get('travelmode'), 'driving');
  }
  console.log(`SAFEROUTE balanced: fastest crosses ${o.fastest.cautionM.toFixed(0)} m spread, balanced 0 m (+${o.balanced.extraMin} min); ETA-reached edges excluded; cap honoured; Maps URL carries chosen waypoints`);
}
const longPath = routeOptions(graph, place('neos-voutzas'), hazard, MATI_EXITS)!.balanced.path;
assert.equal(steeringWaypoints(longPath, mapsWaypointLimit(false)).length, 9);

assert.deepEqual(parseLocation('38.04, 23.98', [], [], bbox), { name: 'Custom location', pos: { lat: 38.04, lon: 23.98 } });
for (const p of manifest.places) {
  const result = parseLocation(p.name.toUpperCase(), manifest.places, osm.roads, bbox);
  if (p.pos.lon >= bbox[0] && p.pos.lon <= bbox[2] && p.pos.lat >= bbox[1] && p.pos.lat <= bbox[3]) assert.ok('pos' in result);
}
const greekRoad = osm.roads.find((r) => r.name === 'Αρριανού')!;
assert.ok(greekRoad);
for (const query of ['ΑΡΡΙΑΝΟΥ', 'Αρριανού', 'arrianou']) {
  const result = parseLocation(query, [], osm.roads, bbox);
  assert.ok('pos' in result && greekRoad.coords.includes(result.pos));
}
assert.deepEqual(parseLocation('Νέος Βουτζάς', manifest.places, [], bbox), { name: 'Neos Voutzas', pos: place('neos-voutzas') });
assert.ok('error' in parseLocation('0, 0', manifest.places, osm.roads, bbox));
assert.ok('error' in parseLocation('unknown nonexistent road', manifest.places, osm.roads, bbox));
assert.ok('error' in parseLocation('', manifest.places, osm.roads, bbox));
assert.ok('error' in parseLocation('NaN, Infinity', manifest.places, osm.roads, bbox));
console.log('SAFEROUTE location: coordinates, manifest places, Greek/Latin accent-insensitive roads; empty/unknown/outside rejected');

const originalFetch = globalThis.fetch;
const root = resolve('public');
globalThis.fetch = (async (url: string | URL | Request) => {
  const path = resolve(root, `.${String(url)}`);
  assert.ok(path.startsWith(`${root}/`));
  return new Response(readFileSync(path));
}) as typeof fetch;
try {
  const pack = await loadScenario('mati-2018');
  consoleStore.runtime = new Runtime(pack, createBus());
  wireAlerts();
  const at1723 = Date.parse('2018-07-23T17:23:00+03:00');
  for (const t of [at1723, at1723 + 37 * 60000, at1723]) {
    consoleStore.api.seek(t);
    consoleStore.api.setPaused(true);
    const presetAlerts = placeAlerts(pack, t);
    for (const id of ['mati', 'neos-voutzas', 'kokkino-limanaki', 'argyra-akti', 'nea-makri']) {
      const preset = presetAlerts.find((p) => p.id === id)!;
      const result = parseLocation(`${preset.pos.lat},${preset.pos.lon}`, pack.manifest.places, [], bbox);
      assert.ok('pos' in result);
      const custom = residentAlertAt(pack, t, result.pos);
      assert.equal(custom.eta, preset.eta, `${id}: coordinate-entry ETA equals preset`);
      assert.equal(custom.etaMin, preset.etaMin, `${id}: countdown equals preset`);
      if (preset.eta !== null) assert.equal(leaveBy(custom.eta!, 45), leaveBy(preset.eta, 45));
      // Map and GPS selections use this same custom lat,lon storage representation.
      const stored = `custom:${preset.pos.lat},${preset.pos.lon}`;
      const restored = parseLocation(stored.slice(7), [], [], bbox);
      assert.ok('pos' in restored);
      assert.equal(residentAlertAt(pack, t, restored.pos).eta, preset.eta, `${id}: map/GPS custom ETA equals preset`);
    }
    const mati = presetAlerts.find((p) => p.id === 'mati')!;
    assert.notEqual(mati.eta, null, 'Mati has a finite ETA at the regression times');
    assert.equal(residentAlertAt(pack, t, { lat: 0, lon: 0 }).eta, null, 'outside field has no ETA');
    const field: SpreadField = consoleStore.runtime.sim.projField!;
    const projection: Projection = consoleStore.runtime.sim.projection!;
    assert.equal(field.issuedAt, projection.issuedAt);
    const current = { t: projection.issuedAt, bands: projection.bands, field };
    assert.equal(residentEstimateAt(mati.pos, projection.issuedAt - 1, [current], []).eta, null, 'future field excluded');
    const unreachable = { ...field, t: new Float32Array(field.t.length).fill(Infinity) };
    assert.equal(fieldEtaAt(unreachable, mati.pos), null, 'outside model horizon has no ETA');
    const burned = { ...field, t: new Float32Array(field.t.length) };
    const observed = residentEstimateAt(mati.pos, t, [{ ...current, field: burned }], []);
    assert.equal(observed.eta, field.issuedAt, 'observed burn retains zero-minute model arrival');
    assert.equal(observed.etaMin, 0, 'past arrival countdown clamps to zero');
    const clear = residentEstimateAt(mati.pos, t, [{ ...current, bands: [] }], []);
    assert.equal(clear.stage, clear.etaMin! <= 60 ? 'leave' : clear.etaMin! <= 180 ? 'prepare' : 'monitor');
    const blocked = residentEstimateAt(mati.pos, t, [current], [{ t: 0, polygon: [square(mati.pos, 0.001)] }]);
    assert.equal(blocked.stage, 'shelter', 'blocked origin still shelters regardless of model ETA');
  }
  {
    consoleStore.api.seek(at1723);
    consoleStore.api.setPaused(true);
    const pr = consoleStore.runtime.sim.projection!;
    const entry: Parameters<typeof residentRouteOptions>[3][number] = { t: pr.issuedAt, bands: pr.bands, field: consoleStore.runtime.sim.projField! };
    const late = residentRouteOptions(graph, place('kokkino-limanaki'), at1723, [entry], pack.perimeters, MATI_EXITS, pack.manifest.places, at1723 + 6 * 3600000);
    assert.equal(late, null, 'departing after modeled fire arrival at the origin: no route');
  }
  for (const t of [at1723, at1723 + 37 * 60000]) {
    consoleStore.api.seek(t);
    consoleStore.api.setPaused(true);
    const field = consoleStore.runtime.sim.projField!;
    const projection = consoleStore.runtime.sim.projection!;
    const perim = pack.perimeters.filter((p) => p.t <= t).sort((a, b) => b.t - a.t)[0];
    for (const id of ['neos-voutzas', 'nea-makri', 'kokkino-limanaki']) {
      const t0 = performance.now();
      const o = residentRouteOptions(graph, place(id), t, [{ t: projection.issuedAt, bands: projection.bands, field }], pack.perimeters, MATI_EXITS, pack.manifest.places);
      if (!o) { console.log(`SAFEROUTE real ${id}: no safe road route (legacy escapeRoutes: ${escapeRoutes(graph, place(id), routingHazardAt(t, [{ t: projection.issuedAt, bands: projection.bands }], pack.perimeters)!, MATI_EXITS).length})`); continue; }
      checkOptions(`real ${id}`, o, [...(perim?.polygon ?? []), ...projection.bands.filter((b) => b.horizonMin === 60).map((b) => b.polygon)]);
      console.log(`SAFEROUTE real ${new Date(t).toISOString().slice(11, 16)}Z ${id}: balanced ${o.balanced.exit.id} ${o.balanced.timeMin.toFixed(1)} min +${o.balanced.extraMin} · fire ${o.balanced.minFireM?.toFixed(0)} m · ${o.balanced.why} · fastest ${o.fastest.exit.id} ${o.fastest.timeMin.toFixed(1)} · safest ${o.safest.exit.id} ${o.safest.timeMin.toFixed(1)} · ${(performance.now() - t0).toFixed(0)} ms`);
    }
  }
  console.log('F01 resident ETA: 5 presets x 3 paused/seek states; coordinate and map/GPS storage paths match ETA/leave-by exactly (0 ms); missing/future/outside/horizon/burned cases PASS');
} finally {
  globalThis.fetch = originalFetch;
  consoleStore.runtime = null;
}
