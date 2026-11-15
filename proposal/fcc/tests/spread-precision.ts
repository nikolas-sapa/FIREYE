import assert from 'node:assert/strict';
import type { BBox, ScenarioPack } from '../src/console/contracts';
import { FuelClass } from '../src/console/contracts';
import { fineFuelMoisture, headRos, runSpread } from '../src/console/agents/spread';

const weather = { windKph: 0, windDirDeg: 0, tempC: 30, rh: 20 };
const moisture = fineFuelMoisture(weather.tempC, weather.rh);
const grassRate = Math.fround(headRos(FuelClass.Grass, 0, moisture)[0]);
const dx = grassRate * 0.50001151;

/** Synthetic flat test geometry, not an observed incident or calibrated spread fixture. */
function fixture(w: number, h = 1, cellX = dx, cellY = 0.110574, fuel?: Uint8Array): ScenarioPack {
  const bbox: BBox = [0, -h * cellY / 110574 / 2, w * cellX / 111320, h * cellY / 110574 / 2];
  const arrival = new Float32Array(w * h).fill(Infinity);
  arrival[0] = 0;
  return {
    manifest: { id: 'precision-fixture', name: 'Synthetic precision fixture', disclaimer: 'Synthetic test only',
      bbox, center: { lon: bbox[2] / 2, lat: 0 }, start: 0, end: 86400000, tz: 'UTC', places: [], sources: [] },
    raster: { w, h, bbox, cellM: cellX }, fuel: fuel ?? new Uint8Array(w * h).fill(FuelClass.Grass),
    elevation: new Float32Array(w * h), arrival,
    perimeters: [], hotspots: [], weather: [], roads: [], buildings: [], water: [],
  };
}

const corridor = fixture(20);
let first: number[] | undefined;
for (let repeat = 0; repeat < 10; repeat++) {
  const arrivals = [...runSpread(corridor, 0, () => weather, 10.00023).t];
  assert.equal(arrivals.filter(Number.isFinite).length, 20, 'FP01: all 20 corridor cells must be reached');
  assert.ok(Math.abs(arrivals[19] - 9.50021869) <= 0.0001, 'FP01: published final-arrival control');
  assert.ok(arrivals.every((value, i) => Number.isFinite(value) && (!i || value >= arrivals[i - 1])));
  if (first) assert.deepEqual(arrivals, first, 'FP01: ten bit-identical arrival arrays');
  first = arrivals;
}
console.log(`FP01 PASS: 20/20 cells, ten identical runs, last ${first![19]} min`);

// Independent O(V²) scan-priority shortest paths. No production Heap, stored grid, or Float32 accumulation.
// The published stencil connects offsets with squared lengths 1, 2 and 5; flat zero-wind edges use destination fuel ROS.
function reference(pack: ScenarioPack, cellX: number, cellY: number) {
  const { w, h } = pack.raster, distance = new Float64Array(w * h).fill(Infinity);
  const visited = new Uint8Array(w * h);
  distance[0] = 0;
  let improvedQueued = 0;
  for (let step = 0; step < distance.length; step++) {
    let i = -1;
    for (let j = 0; j < distance.length; j++) if (!visited[j] && (i < 0 || distance[j] < distance[i])) i = j;
    if (i < 0 || !Number.isFinite(distance[i])) break;
    visited[i] = 1;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      if (![1, 2, 5].includes(ox * ox + oy * oy)) continue;
      const x = i % w + ox, y = Math.floor(i / w) + oy;
      if (x < 0 || x >= w || y < 0 || y >= h) continue;
      const j = y * w + x, rate = Math.fround(headRos(pack.fuel[j], 0, moisture)[0]);
      if (!rate || visited[j]) continue;
      const candidate = distance[i] + Math.hypot(ox * cellX, oy * cellY) / rate;
      if (candidate < distance[j]) {
        if (Number.isFinite(distance[j])) improvedQueued++;
        distance[j] = candidate;
      }
    }
  }
  return { distance, improvedQueued };
}

const fuels = Uint8Array.from({ length: 42 }, (_, i) => [3, 4, 5, 6, 7, 8][(i * 7 + Math.floor(i / 7) * 3) % 6]);
const graph = fixture(7, 6, 7.31, 11.29, fuels);
const expected = reference(graph, 7.31, 11.29), actual = runSpread(graph, 0, () => weather, 10000).t;
assert.ok(expected.improvedQueued > 0, 'FP02: graph must improve previously queued routes');
let worst = 0;
for (let i = 0; i < actual.length; i++) {
  assert.ok(Number.isFinite(expected.distance[i]) && Number.isFinite(actual[i]));
  worst = Math.max(worst, Math.abs(actual[i] - expected.distance[i]));
}
assert.ok(worst <= 0.0001, `FP02: independent shortest-path error ${worst} min exceeds 0.0001`);
console.log(`FP02 PASS: ${expected.improvedQueued} improved queued routes, ${actual.length} cells, worst error ${worst} min`);

const blocked = fixture(20);
blocked.fuel.fill(FuelClass.Water, 8, 12);
const blockedField = runSpread(blocked, 0, () => weather, 100);
assert.ok([...blockedField.t.slice(8)].every(t => t === Infinity), 'FP03: no propagation through/beyond blocked corridor');
const noSeed = fixture(20);
noSeed.arrival.fill(Infinity);
assert.ok([...runSpread(noSeed, 0, () => weather, 100).t].every(t => t === Infinity), 'FP03: no seeds reach no cells');
const short = runSpread(fixture(20), 0, () => weather, 1.1).t;
assert.equal([...short].filter(Number.isFinite).length, 3);
assert.ok([...short].every(t => t === Infinity || t <= 1.1), 'FP03: no stored arrivals beyond horizon');
console.log('FP03 PASS: blocked corridor, no seeds and short-horizon controls');
