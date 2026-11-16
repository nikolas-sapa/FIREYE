import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MATI_EXITS, NO_EXIT_ZONES, alertStage, buildRoadGraph, distanceM, escapeRoutes, googleMapsDirectionsUrl, googleMapsEmbedUrl, leaveBy, nearestNode, pointInPolygon, residentsNear, steeringWaypoints, summarizeRoads,
} from './evac.ts';
import type { Hazard, Road } from './evac.ts';

type Geo = { lon: number; lat: number; alt?: number };

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const osm = JSON.parse(readFileSync(resolve(root, 'public/data/mati/osm.json'), 'utf8')) as { roads: Road[]; buildings: { pos: Geo; kind: string }[] };
const manifest = JSON.parse(readFileSync(resolve(root, 'public/data/mati/manifest.json'), 'utf8')) as { places: { id: string; name: string; pos: Geo }[] };

let failures = 0;
function check(ok: boolean, msg: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
}
const mapsOrigin = { lat: 38.123456, lon: 23.987654 };
const mapsDestination = { lat: 38.234567, lon: 24.123456 };
const mapsWaypoints = [{ lat: 38.15, lon: 24 }, { lat: 38.2, lon: 24.1 }];
const maps = new URL(googleMapsDirectionsUrl({ origin: mapsOrigin, destination: mapsDestination, waypoints: mapsWaypoints }));
check(maps.origin + maps.pathname === 'https://www.google.com/maps/dir/' && maps.searchParams.get('api') === '1', 'Maps directions endpoint and api=1');
check(maps.searchParams.get('origin') === '38.12346,23.98765' && maps.searchParams.get('destination') === '38.23457,24.12346', 'Maps coordinates at five decimals');
check(maps.searchParams.get('waypoints') === '38.15000,24.00000|38.20000,24.10000' && maps.searchParams.get('travelmode') === 'driving', 'Maps waypoints and default driving mode');
check(!new URL(googleMapsDirectionsUrl({ origin: mapsOrigin, destination: mapsDestination })).searchParams.has('waypoints'), 'Maps empty waypoints omitted');
check(new URL(googleMapsEmbedUrl({ origin: mapsOrigin, destination: mapsDestination }, 'fixture&key')).searchParams.get('key') === 'fixture&key', 'Maps embed key URL encoded');
const steeringPath = Array.from({ length: 21 }, (_, i) => ({ lat: 38.02 + i * 0.001, lon: 23.98 }));
check(steeringWaypoints(steeringPath).length === 3 && steeringWaypoints(steeringPath, 20).length === 9 && steeringWaypoints(steeringPath, 20).every((p) => steeringPath.includes(p)), 'Steering defaults to 3, clamps to 9, stays on path');
check(steeringWaypoints([]).length === 0, 'Empty path has no steering waypoints');
function place(id: string): Geo {
  const p = manifest.places.find((x) => x.id === id);
  if (!p) throw new Error(`missing place ${id}`);
  return p.pos;
}
function circle(center: Geo, radiusM: number, n = 32): Geo[] {
  const out: Geo[] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push({ lon: center.lon + dLon * Math.cos(a), lat: center.lat + dLat * Math.sin(a) });
  }
  return out;
}
function roadsNear(p: Geo): string {
  const names = new Set<string>();
  for (const r of osm.roads) if (r.name && r.coords.some((c) => distanceM(c, p) < 30)) names.add(`${r.name} (${r.kind})`);
  return [...names].join(', ') || '(unnamed)';
}

const t0 = performance.now();
const g = buildRoadGraph(osm.roads);
const buildMs = performance.now() - t0;
console.log(`graph: ${g.lon.length} nodes, ${g.edgeCount} edges, built in ${buildMs.toFixed(1)} ms`);
check(buildMs < 1500, `graph built < 1500 ms (${buildMs.toFixed(1)})`);

console.log('\nexits:');
for (const e of MATI_EXITS) {
  const s = nearestNode(g, e.pos);
  console.log(`  ${e.id}  ${e.label}  ${e.pos.lon},${e.pos.lat}  snap ${distanceM(s, e.pos).toFixed(1)} m  roads: ${roadsNear(e.pos)}`);
}
for (const z of NO_EXIT_ZONES) console.log(`no-exit: ${z.id} ${z.label} ${z.center.lon},${z.center.lat} r=${z.radiusM} m`);

const voutzas = place('neos-voutzas');
const empty: Hazard = { blocked: [], caution: [] };
let t = performance.now();
const free = escapeRoutes(g, voutzas, empty, MATI_EXITS);
let ms = performance.now() - t;
console.log(`\nneos-voutzas, empty hazard (${ms.toFixed(1)} ms):`);
for (const r of free) console.log(`  ${r.exit.label}: ${(r.lengthM / 1000).toFixed(2)} km, ${r.path.length} pts, caution ${r.cautionM.toFixed(0)} m, ${r.roads.length} names\n    summary: ${summarizeRoads(r).join(' > ')}`);
check(free.length >= 2, `>= 2 exits reachable (${free.length})`);
check(free.every((r) => r.lengthM >= 1000 && r.lengthM <= 40000), 'each lengthM in [1000, 40000]');
check(free.every((r) => r.roads.length > 0), 'each route has named roads');
check(ms < 300, `escapeRoutes < 300 ms (${ms.toFixed(1)})`);
check(free.every((r) => { const n = summarizeRoads(r).length; return n > 0 && n <= 4; }), 'summarizeRoads length in [1, 4]');
const north = free.find((r) => r.exit.id === 'exit-north');
check(!!north && summarizeRoads(north).includes('Μαραθώνος'), 'north route summary contains Μαραθώνος');

const ignition = place('ignition');
const blockedPoly = circle(ignition, 1500);
const cautionCenter = { lon: ignition.lon + 1500 / (111_320 * Math.cos((ignition.lat * Math.PI) / 180)), lat: ignition.lat };
const hazard: Hazard = { blocked: [blockedPoly], caution: [circle(cautionCenter, 3500)] };
t = performance.now();
const hz = escapeRoutes(g, voutzas, hazard, MATI_EXITS);
ms = performance.now() - t;
console.log(`\nneos-voutzas, synthetic hazard (${ms.toFixed(1)} ms):`);
for (const r of hz) console.log(`  ${r.exit.label}: ${(r.lengthM / 1000).toFixed(2)} km, caution ${r.cautionM.toFixed(0)} m, ${r.roads.length} names\n    summary: ${summarizeRoads(r).join(' > ')}`);
check(hz.every((r) => { const n = summarizeRoads(r).length; return n > 0 && n <= 4; }), 'summarizeRoads length in [1, 4] under hazard');
check(hz.length >= 1, `>= 1 route under hazard (${hz.length})`);
const bad = hz.reduce((n, r) => n + r.path.filter((p) => pointInPolygon(p, blockedPoly)).length, 0);
check(bad === 0, `no path vertex inside blocked polygon (${bad})`);
check(ms < 300, `escapeRoutes < 300 ms under hazard (${ms.toFixed(1)})`);
const inside = escapeRoutes(g, ignition, hazard, MATI_EXITS);
check(inside.length === 0, `start inside blocked yields no route (${inside.length})`);

check(alertStage(null, false) === 'monitor', 'alertStage(null) = monitor');
check(alertStage(200, false) === 'monitor', 'alertStage(200) = monitor');
check(alertStage(120, false) === 'prepare', 'alertStage(120) = prepare');
check(alertStage(30, false) === 'leave', 'alertStage(30) = leave');
check(alertStage(30, true) === 'shelter', 'alertStage(inBlocked) = shelter');
check(leaveBy(3_600_000) === 900_000, 'leaveBy(60 min) = 15 min');

const residents = residentsNear(osm.buildings, voutzas, 800);
console.log(`\nresidentsNear(neos-voutzas, 800 m) = ${residents} (SIMULATED)`);
check(residents > 0, 'residentsNear > 0');

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
