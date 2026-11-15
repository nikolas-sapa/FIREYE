import assert from 'node:assert/strict';
import { FuelClass } from '../src/console/contracts';
import { randomGridScene } from '../src/image-lab/grid';
import {
  FuelOrigin, MODEL_CELLS, MODEL_SIDE, LANDSCAPE_SCHEMA, PX_PER_CELL, REVIEW_INPUT_PX, REVIEW_CLASSES, SPREAD_BANDS_MIN, blendOutputs, clcToFuel, classifyReview,
  featherWeight, fromBase64, fuseFuel, overlapAgreement, stitchReviews, landscapeExport, modelGrid, rasterizeRings, reviewCrop, reviewPrompt, runLandscapeSpread, weatherFor,
  type WeatherSeries, type WindChoice,
} from '../src/image-lab/landscape';

// CORINE mapping matches the Mati builder's classes.
assert.deepEqual([112, 211, 312, 311, 323, 333, 332, 512, 999].map(clcToFuel), [
  FuelClass.Urban, FuelClass.Agriculture, FuelClass.TimberLitter, FuelClass.TimberUnderstory, FuelClass.Shrub,
  FuelClass.Grass, FuelClass.Rock, FuelClass.Water, FuelClass.None]);

const scene = randomGridScene('landscape', () => 0.5);
const grid = modelGrid(scene);
assert.ok(Math.abs(grid.cellM - 40) < 1e-6, 'Ground cells are 40 m like the console sim');

// Rasterizing the scene's own bounds covers every cell; a west-half box covers exactly half.
const { lonOf, latOf } = await import('../src/image-lab/landscape');
const [w, s, e, n] = scene.bounds;
const box = (a: number, b: number) => [[[lonOf(a), latOf(s)], [lonOf(b), latOf(s)], [lonOf(b), latOf(n)], [lonOf(a), latOf(n)], [lonOf(a), latOf(s)]]];
const clc = new Uint16Array(MODEL_CELLS);
rasterizeRings(box(w, e), clc, 1, scene.bounds);
assert.ok(clc.every(v => v === 1));
clc.fill(0);
rasterizeRings(box(w, (w + e) / 2), clc, 2, scene.bounds);
assert.equal(clc.filter(v => v === 2).length, MODEL_CELLS / 2);
assert.equal(clc[MODEL_SIDE * 10 + 127], 2);
assert.equal(clc[MODEL_SIDE * 10 + 128], 0);

// Halo crops stay inside the 1,024 px image and keep each cell at its true position.
assert.deepEqual(reviewCrop(0), { x: 0, y: 0, size: 576, cellX: 0, cellY: 0 });
assert.deepEqual(reviewCrop(3), { x: 448, y: 448, size: 576, cellX: 64, cellY: 64 });
for (const label of ['NW', 'NE', 'SW', 'SE']) {
  const prompt = reviewPrompt(label);
  assert.ok(prompt.includes(`${label} cell`));
  for (const c of REVIEW_CLASSES) assert.ok(prompt.includes(c.hex));
  // Color words in the prompt leaked into outputs as extra classes in the Crete study (v3, v4).
  assert.doesNotMatch(prompt, /\b(green|olive|brown|black|white|tan|amber|blue|grey|gray)\b/i, 'Prompt names colors only by hex');
}
console.log('CORINE mapping, scene raster, 40 m grid, halo crops and fixed review prompt PASS');

// Palette gate.
const rgba = (fn: (x: number, y: number) => readonly number[]) => {
  const out = new Uint8ClampedArray(REVIEW_INPUT_PX * REVIEW_INPUT_PX * 4);
  for (let y = 0; y < REVIEW_INPUT_PX; y++) for (let x = 0; x < REVIEW_INPUT_PX; x++) {
    const [r, g, b] = fn(x, y), o = (y * REVIEW_INPUT_PX + x) * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
  }
  return out;
};
const [V, N] = REVIEW_CLASSES.map(c => c.rgb);
const allV = classifyReview(0, rgba(() => [V[0] - 20, V[1] + 10, V[2] + 15]));
assert.ok(allV.accepted && allV.offPalette === 0 && allV.counts[0] === 512 * 512);
assert.ok(Math.abs(allV.shares[0] - 1) < 1e-5);
const green = classifyReview(0, rgba(x => x < 120 ? [40, 140, 40] : V));
assert.ok(!green.accepted && green.offPalette > 0.15, 'Off-palette greens fail the gate');
assert.ok(classifyReview(0, rgba(x => x < 60 ? [40, 140, 40] : V)).accepted, 'About 10% off-palette passes');
// The halo margin is excluded from shares: for SE (index 3), columns 0-63 of the output are the neighbour.
const se = classifyReview(3, rgba(x => x < 64 ? N : V));
assert.equal(se.counts[1], 0);
assert.throws(() => classifyReview(0, new Uint8ClampedArray(16)));

// Fusion modes.
const base = new Uint8Array(MODEL_CELLS).fill(FuelClass.Rock);
const half = MODEL_SIDE / 2;
const set = (x: number, y: number, f: FuelClass) => { base[y * MODEL_SIDE + x] = f; };
set(1, 0, FuelClass.Agriculture); set(2, 0, FuelClass.Shrub); set(3, 0, FuelClass.Urban); set(4, 0, FuelClass.Water);
const shares = new Float32Array(half * half * 3);
for (let i = 0; i < half * half; i++) shares[i * 3] = 1; // vegetation everywhere
shares[2 * 3] = 0; shares[2 * 3 + 1] = 1;              // exposed at (2,0)
shares[3 * 3] = 0; shares[3 * 3 + 1] = 1;              // exposed at (3,0), urban
const review = { index: 0, offPalette: 0, accepted: true, shares, counts: [0, 0, 0] as [number, number, number] };
const b = fuseFuel(base, [review], 'base');
assert.deepEqual(b.fuel, base, 'CORINE-only mode never changes fuel');
assert.equal(b.disagree[0], 1);
assert.equal(b.disagree[2], 1, 'Shrub seen as exposed is a disagreement');
assert.equal(b.disagree[3], 0, 'Built-up seen as exposed is not');
assert.equal(b.disagree[4], 1, 'Water seen as vegetation is a disagreement');
const add = fuseFuel(base, [review], 'add');
assert.equal(add.fuel[0], FuelClass.Shrub); assert.equal(add.origin[0], FuelOrigin.AiAdded);
assert.equal(add.fuel[1], FuelClass.Agriculture); assert.equal(add.fuel[2], FuelClass.Shrub);
assert.equal(add.fuel[4], FuelClass.Water, 'Water never becomes fuel');
assert.ok([...add.fuel].every((f, i) => f === base[i] || (base[i] === FuelClass.Rock && f === FuelClass.Shrub)), 'Add mode only adds');
const full = fuseFuel(base, [review], 'full');
assert.equal(full.fuel[1], FuelClass.Shrub); assert.equal(full.origin[1], FuelOrigin.AiChanged);
assert.equal(full.fuel[2], FuelClass.Rock); assert.equal(full.origin[2], FuelOrigin.AiRemoved);
assert.equal(full.fuel[3], FuelClass.Urban);
assert.deepEqual(fuseFuel(base, [{ ...review, accepted: false }], 'full').fuel, base, 'Rejected reviews change nothing');
assert.equal(fuseFuel(base, [review], 'add').fuel[half], FuelClass.Rock, 'NW review only touches the NW cell');
console.log('Palette gate (tolerance, halo exclusion) and CORINE-only / add / full fusion rules PASS');

// Seamless stitching. Feather weights of the four halos sum to 1 at every scene pixel.
const SCENE = 1024;
let worst = 0;
for (let y = 0; y < SCENE; y++) for (let x = 0; x < SCENE; x++) {
  worst = Math.max(worst, Math.abs([0, 1, 2, 3].reduce((sum, c) => sum + featherWeight(c, x, y), 0) - 1));
  if (x < 448 && y < 448) assert.equal(featherWeight(0, x, y), 1);
}
assert.ok(worst < 1e-9, `Feather weights sum to 1 (worst error ${worst})`);
assert.ok(Math.abs(featherWeight(0, 511, 0) - featherWeight(1, 512, 0)) < 1e-9, 'The cross-fade is symmetric about the cut');
// Registration: cut every halo from one scene-wide truth; stitching must reproduce the truth exactly.
const truthLabel = (x: number, y: number) => ((x >> 5) + (y >> 6)) % 3;
const scenePx = (fn: (x: number, y: number) => readonly number[]) => [0, 1, 2, 3].map(i => {
  const c = reviewCrop(i);
  return rgba((x, y) => fn(c.x + x, c.y + y));
});
const truthOutputs = scenePx((x, y) => REVIEW_CLASSES[truthLabel(x, y)].rgb);
const truthReviews = truthOutputs.map((px, i) => classifyReview(i, px));
const stitched = stitchReviews(truthReviews);
for (let m = 0; m < MODEL_CELLS; m++) {
  const k = truthLabel((m % MODEL_SIDE) * PX_PER_CELL, Math.floor(m / MODEL_SIDE) * PX_PER_CELL);
  assert.ok(stitched.covered[m] === 1 && Math.abs(stitched.shares[m * 3 + k] - 1) < 1e-5, `Model cell ${m} lands on its true label`);
}
assert.deepEqual(overlapAgreement(truthReviews), { 'NW|NE': 1, 'SW|SE': 1, 'NW|SW': 1, 'NE|SE': 1 });
const blended = blendOutputs(truthOutputs);
for (let y = 0; y < SCENE; y += 7) for (let x = 0; x < SCENE; x += 7) {
  const o = (y * SCENE + x) * 4, want = REVIEW_CLASSES[truthLabel(x, y)].rgb;
  assert.deepEqual([blended[o], blended[o + 1], blended[o + 2], blended[o + 3]], [...want, 255], `Blended mosaic pixel ${x},${y} is registered`);
}
// Disagreeing neighbours cross-fade across the shared overlap instead of switching at the cut.
const [Vr, Nr] = [REVIEW_CLASSES[0].rgb, REVIEW_CLASSES[1].rgb];
const split = [classifyReview(0, rgba(() => Vr)), classifyReview(1, rgba(() => Nr)), classifyReview(2, rgba(() => Vr)), classifyReview(3, rgba(() => Nr))];
assert.deepEqual(overlapAgreement(split)['NW|NE'], 0);
const fade = stitchReviews(split);
const vAt = (mx: number) => fade.shares[(10 * MODEL_SIDE + mx) * 3];
assert.equal(vAt(111), 1); assert.ok(Math.abs(vAt(144)) < 1e-6, 'Outside the overlap band the owner decides');
for (let mx = 112; mx < 144; mx++) assert.ok(vAt(mx) < vAt(mx - 1) + 1e-6, 'Vegetation share falls monotonically across the band');
assert.ok(Math.abs(vAt(127) + vAt(128) - 1) < 0.02, 'The two outputs weigh evenly at the cut');
assert.ok(vAt(127) - vAt(128) < 0.05, `No step at the cut (${vAt(127).toFixed(3)} → ${vAt(128).toFixed(3)})`);
const mixRow = blendOutputs(split.map((_, i) => rgba(() => i % 2 ? Nr : Vr)));
const red = (x: number) => mixRow[(40 * SCENE + x) * 4];
assert.equal(red(447), Vr[0]); assert.equal(red(576), Nr[0]);
assert.ok(Math.abs(red(511) - red(512)) <= 2, 'Blended image has no visible seam');
// A rejected neighbour drops out: the accepted cell keeps its own labels up to the cut and the neighbour stays unreviewed.
const half_rejected = stitchReviews([split[0], { ...split[1], accepted: false }]);
assert.equal(half_rejected.shares[(10 * MODEL_SIDE + 127) * 3], 1);
assert.equal(half_rejected.covered[10 * MODEL_SIDE + 128], 0);
assert.equal(fuseFuel(base, [split[0], { ...split[1], accepted: false }], 'add').fuel[10 * MODEL_SIDE + 127], FuelClass.Shrub);
console.log(`Seamless stitching: weights sum to 1, halo registration exact, overlap cross-fade (cut ${vAt(127).toFixed(2)} / ${vAt(128).toFixed(2)}), rejected neighbours drop out PASS`);

// Weather selection.
const hour = (h: number, kph: number) => ({ t: h * 3600000, windKph: kph, gustKph: kph * 2, windDirDeg: 270, tempC: 30, rh: 20 });
const series: WeatherSeries = { source: 'open-meteo', hours: [hour(0, 10), hour(1, 20), hour(2, 30)] };
const choice: WindChoice = { mode: 'forecast', startHour: 1, useGusts: false, manual: { windKph: 5, windDirDeg: 0, tempC: 20, rh: 50 } };
assert.equal(weatherFor(series, choice)(0).windKph, 20);
assert.equal(weatherFor(series, choice)(5).windKph, 30, 'Past the forecast end the last hour persists');
assert.equal(weatherFor(series, { ...choice, useGusts: true })(0).windKph, 40);
assert.deepEqual(weatherFor(series, { ...choice, mode: 'manual' })(3), choice.manual);
assert.deepEqual(weatherFor(undefined, choice)(0), choice.manual, 'No forecast falls back to manual');

// Spread follows the wind on uniform flat shrub.
const shrub = new Uint8Array(MODEL_CELLS).fill(FuelClass.Shrub);
const flat = new Float32Array(MODEL_CELLS).fill(300);
const centre = 128 * MODEL_SIDE + 128;
const manual = (windDirDeg: number, windKph = 30) => () => ({ windKph, windDirDeg, tempC: 32, rh: 20 });
const westerly = runLandscapeSpread(grid, shrub, flat, centre, manual(270));
assert.ok(westerly.run && Math.abs(westerly.run.bearingDeg - 90) < 3, `West wind drives the head east (got ${westerly.run?.bearingDeg})`);
const northerly = runLandscapeSpread(grid, shrub, flat, centre, manual(0));
assert.ok(northerly.run && Math.abs(northerly.run.bearingDeg - 180) < 3);
assert.ok(SPREAD_BANDS_MIN.every((band, k) => k === 0 || westerly.areasHa[band] >= westerly.areasHa[SPREAD_BANDS_MIN[k - 1]]));
assert.ok(runLandscapeSpread(grid, shrub, flat, centre, manual(270, 50)).areasHa[60] > runLandscapeSpread(grid, shrub, flat, centre, manual(270, 5)).areasHa[60]);
const calm = runLandscapeSpread(grid, shrub, flat, centre, manual(0, 0));
assert.ok(calm.run === null || calm.run.distanceM < 200, 'No wind on flat ground has no main run direction');
// Upslope runs faster: a ramp rising to the north pulls the calm-wind run north.
const ramp = new Float32Array(MODEL_CELLS).map((_, i) => 2000 - Math.floor(i / MODEL_SIDE) * 8);
const uphill = runLandscapeSpread(grid, shrub, ramp, centre, manual(0, 0));
assert.ok(uphill.run && (uphill.run.bearingDeg < 5 || uphill.run.bearingDeg > 355), `Calm fire runs upslope (got ${uphill.run?.bearingDeg})`);
assert.equal(westerly.arrival[centre], 0);
assert.throws(() => runLandscapeSpread(grid, base, flat, 5, manual(0)), /not burnable/);
// A water barrier stops the spread.
const moat = shrub.slice();
for (let y = 0; y < MODEL_SIDE; y++) for (let x = 140; x < 150; x++) moat[y * MODEL_SIDE + x] = FuelClass.Water;
const blocked = runLandscapeSpread(grid, moat, flat, centre, manual(270, 60));
for (let y = 0; y < MODEL_SIDE; y++) assert.ok(!(blocked.arrival[y * MODEL_SIDE + 160] <= 360));
console.log(`Weather selection, wind-driven spread, monotonic bands and fuel barriers PASS (${westerly.computeMs.toFixed(1)} ms per run)`);

// Export contract.
const fused = fuseFuel(shrub, [], 'add');
const record = landscapeExport({ scene, sources: [], baseFuel: shrub, fused, elevation: flat, fusion: 'add', weather: series, wind: choice,
  review: { model: 'm', tiles: [{ index: 0, label: 'NW', status: 'Complete', requestId: 'r', review: allV }] }, spread: westerly,
  imagery: { name: 'x', license: 'y', url: 'z' } });
const round = JSON.parse(JSON.stringify(record));
assert.equal(round.schema, LANDSCAPE_SCHEMA);
assert.equal(fromBase64(round.layers.fuel).length, MODEL_CELLS);
assert.equal(fromBase64(round.layers.elevationM).length, MODEL_CELLS * 4);
const arrival = new Uint16Array(fromBase64(round.spread.arrivalMin).buffer);
assert.equal(arrival[centre], 0);
assert.ok(arrival.some(v => v === 65535));
assert.equal(round.review.tiles[0].accepted, true);
const withPixels = landscapeExport({ scene, sources: [], baseFuel: shrub, fused, elevation: flat, fusion: 'add', weather: series, wind: choice,
  review: { tiles: [{ index: 0, label: 'NW', status: 'Complete', review: { ...truthReviews[0], pixels: truthOutputs[0] } }] }, imagery: { name: 'x', license: 'y', url: 'z' } });
assert.ok(!/"(labels|pixels)"/.test(JSON.stringify(withPixels)), 'Halo labels and pixels stay out of the export');
assert.ok(round.limitations.length >= 3);
assert.ok(Math.abs(round.spread.ignition.lat - scene.center.lat) < 0.01);
console.log(`${LANDSCAPE_SCHEMA} export round-trips rasters, arrival, review gate and ignition (${(JSON.stringify(record).length / 1024).toFixed(0)} KiB) PASS`);
