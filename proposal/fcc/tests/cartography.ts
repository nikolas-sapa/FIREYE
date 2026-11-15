import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ScenarioPack } from '../src/console/contracts';
import { loadScenario } from '../src/console/scenario';
import { cellToGeo, elevationAt } from '../src/console/scenario/geo';
import { RasterSampler } from '../src/console/stage3d/raster';
import { formatMeters, patternLod, scaleDistance, terrainMaxLevel, terrainRefinementError, CONTEXT_CONTOURS_SOURCE } from '../src/console/stage3d/cartography';
import { readVectorTile } from '../src/console/stage3d/vector-tile';

const fixture = {
  raster: { w: 3, h: 2, bbox: [10, 20, 13, 22], cellM: 20 },
  elevation: new Float32Array([0, 100, 200, 300, 400, 500]),
} as unknown as ScenarioPack;
const sampler = new RasterSampler(fixture);
assert.equal(sampler.demElevation(10.5, 21.5), 0, 'northwest cell centre');
assert.equal(sampler.demElevation(12.5, 20.5), 500, 'southeast cell centre');
assert.equal(sampler.demElevation(11, 21), 200, 'bilinear centre of four cells');
assert.equal(sampler.inside(10, 20), true);
assert.equal(sampler.inside(9.999, 20), false);
assert.equal(sampler.cellIndex(13.001, 21), -1);
const isolated = new RasterSampler(fixture);
sampler.datumOffset = 52;
assert.equal(isolated.elevation(11, 21), 200, 'per-view calibration is isolated');
assert.equal(sampler.demElevation(11, 21), 200, 'datum never changes DEM');
assert.equal(sampler.elevation(11, 21), 252);
const invalid = new RasterSampler({ ...fixture, elevation: new Float32Array([NaN, -32768, 200, 300, 400, 500]) });
assert.equal(invalid.demElevation(10.5, 21.5), 350, 'nodata uses valid mean, not a spike');

for (const cellM of [20, 40]) {
  let previous = 0;
  for (let n = 0; n <= 10000; n++) {
    const mpp = 0.01 * 2 ** (n / 500);
    const lod = patternLod(mpp, cellM);
    assert.ok(lod.spacing >= cellM);
    assert.ok(lod.spacing >= previous);
    assert.ok(lod.blend >= 0 && lod.blend <= 1);
    assert.ok(Number.isFinite(lod.spacing));
    previous = lod.spacing;
    const scale = scaleDistance(mpp);
    assert.ok(scale / mpp >= 39.99 && scale / mpp <= 100.01, 'scale remains 40–100 CSS px');
  }
  for (let n = 1; n < 14; n++) {
    const minimum = patternLod(0, cellM).spacing;
    const mpp = minimum * 2 ** n / 12;
    const a = patternLod(mpp * (1 - 1e-8), cellM), b = patternLod(mpp, cellM);
    assert.equal(a.spacing * 2, b.spacing, 'nested intervals at every boundary');
    assert.ok(a.blend > 0.99999 && b.blend < 0.00001, 'crossfade endpoints join continuously');
  }
}
assert.equal(scaleDistance(0), 0);
assert.equal(scaleDistance(NaN), 0);
assert.equal(formatMeters(400), '400 M');
assert.equal(formatMeters(1600), '1.6 KM');
assert.ok(!CONTEXT_CONTOURS_SOURCE.includes('sampler2D'), 'streamed globe material reserves no imagery texture slots');
assert.ok(!CONTEXT_CONTOURS_SOURCE.includes('texture(relief,'), 'no hidden relief sampler at high-LOD multi-image leaves');

const root = resolve(process.cwd(), 'public');
globalThis.fetch = (async (url: string | URL | Request) => {
  const path = resolve(root, `.${String(url)}`);
  assert.ok(path.startsWith(`${root}/`));
  try { return new Response(readFileSync(path), { status: 200 }); }
  catch { return new Response(null, { status: 404 }); }
}) as typeof fetch;

for (const id of ['mati-2018', 'caldor-2021'] as const) {
  const pack = await loadScenario(id);
  const s = new RasterSampler(pack);
  let worst = 0;
  for (let y = 0; y < s.h; y += 23) for (let x = 0; x < s.w; x += 29) {
    // Independent scenario geo API, plus direct source values at cell centres.
    const p = cellToGeo(pack, x, y);
    assert.ok(Math.abs(s.demElevation(p.lon, p.lat) - pack.elevation[y * s.w + x]) < 1e-5);
    for (const k of [0, 0.25, 0.5, 0.75]) {
      const q = cellToGeo(pack, Math.min(s.w - 1, x + k), Math.min(s.h - 1, y + k));
      worst = Math.max(worst, Math.abs(s.demElevation(q.lon, q.lat) - elevationAt(pack, q)));
    }
  }
  assert.ok(worst < 1e-8);
  const maxLevel = terrainMaxLevel(s.cellM, (s.bbox[1] + s.bbox[3]) / 2);
  assert.equal(maxLevel, id === 'mati-2018' ? 15 : 14);
  const nominal = Math.PI * 6378137 * Math.cos((s.bbox[1] + s.bbox[3]) * Math.PI / 360) / (32 * 2 ** maxLevel);
  assert.ok(nominal <= s.cellM && nominal > s.cellM / 2, 'refinement stops at source-useful sampling');
  assert.equal(terrainRefinementError(maxLevel - 1, maxLevel, 12), 12);
  for (const level of [maxLevel, maxLevel + 1, maxLevel + 10]) {
    const error = terrainRefinementError(level, maxLevel, 12);
    assert.ok(error > 0 && error <= 0.001, 'finite SSE stop sentinel');
    // Cesium ImageryLayer.js uses round(log2(levelZeroSpacing/error)) | 0, then clamps.
    const spacing = 2 * Math.PI * 6378137 * Math.cos(s.bbox[1] * Math.PI / 180) / 256;
    assert.equal(Math.min(16, Math.round(Math.log2(spacing / error)) | 0), 16, 'leaf terrain keeps detailed imagery, never world z0');
  }
  console.log(`${id}: DEM orientation/source samples, independent interpolation (worst ${worst.toExponential(2)} m), bounded LOD ${maxLevel} PASS`);
}
// MVT 2.1 specification commands: MoveTo (25,17), LineTo (34,17),(34,31), ClosePath.
// The attribute table deliberately follows the feature to exercise protobuf field ordering.
const uint = (n: number): number[] => n < 128 ? [n] : [(n % 128) + 128, ...uint(Math.floor(n / 128))];
const bytes = (tag: number, data: number[]) => [tag, ...uint(data.length), ...data];
const str = (s: string) => [...new TextEncoder().encode(s)];
const feature = [...bytes(18, [0, 0]), 24, 3, ...bytes(34, [9, 50, 34, 18, 18, 0, 0, 28, 15])];
const layer = [...bytes(10, str('water')), ...bytes(18, feature), ...bytes(26, str('name')), ...bytes(34, bytes(10, str('Lake'))), 40, ...uint(4096), 120, 2];
const encoded = Uint8Array.from(bytes(26, layer));
const decoded = readVectorTile(encoded.buffer);
assert.equal(decoded[0].name, 'water');
assert.equal(decoded[0].extent, 4096);
assert.equal(decoded[0].features[0].properties.name, 'Lake');
assert.deepEqual(decoded[0].features[0].paths, [[[25, 17], [34, 17], [34, 31], [25, 17]]]);
for (const broken of [[26, 100, 0], [26, 128], [15], [26, 2, 40, 0]]) {
  assert.throws(() => readVectorTile(Uint8Array.from(broken).buffer));
}
assert.throws(() => readVectorTile(new ArrayBuffer(8 * 1024 * 1024 + 1)));
assert.deepEqual(readVectorTile(new ArrayBuffer(0)), []);
console.log('Cartography: 20,002 pattern/scale samples, nested boundaries, nodata, datum isolation and MVT specification fixture/malformed inputs PASS');
