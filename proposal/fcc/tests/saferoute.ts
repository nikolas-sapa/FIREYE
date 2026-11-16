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
import { buildRoadGraph, escapeRoutes, googleMapsDirectionsUrl, googleMapsEmbedUrl, MATI_EXITS, pointInPolygon, polygonDistanceM, steeringWaypoints, type Road } from '../src/console/ops/geo/evac';
import { parseLocation, residentEstimateAt, routingHazardAt } from '../src/console/ops/geo/saferoute';

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
const at20 = { blocked: [predicted, burning], caution: [caution] };
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
  console.log('F01 resident ETA: 5 presets x 3 paused/seek states; coordinate and map/GPS storage paths match ETA/leave-by exactly (0 ms); missing/future/outside/horizon/burned cases PASS');
} finally {
  globalThis.fetch = originalFetch;
  consoleStore.runtime = null;
}
