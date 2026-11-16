import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Geo } from '../src/console/contracts';
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
assert.equal(residentEstimateAt({ lon: 23.962, lat: 38.035 }, 20, entries, perimeters).eta, 10 + 60 * 60000);
assert.equal(residentEstimateAt({ lon: 23.957, lat: 38.043 }, 20, entries, perimeters).stage, 'prepare');
assert.equal(residentEstimateAt(place('nea-makri'), 20, entries, perimeters).eta, null);
console.log('SAFEROUTE custom resident: band-based ETA, prepare/shelter/monitor stages, unknown ETA without bands');

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
