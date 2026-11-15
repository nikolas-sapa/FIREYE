import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createImageLabMiddleware } from '../server/image-lab';
import { gridCells, randomGridScene, imageryUrl, GRID_REGIONS, GRID_SOURCE, type GridScene } from '../src/image-lab/grid';
import { bestAttempt, processGrid, type GridTileRun } from '../src/image-lab/grid-client';
import { DEFAULT_GRID_PROMPT, LAB_PALETTE } from '../src/image-lab/prompt';
import { deflateSync } from 'node:zlib';
import { MODEL_CELLS, MODEL_SIDE, decodeFloat32, decodeUint16, reviewPrompt, type LandscapePayload, type ReviewCell, type WeatherSeries } from '../src/image-lab/landscape';
import { LAB_API, LAB_MODELS, type LabResult } from '../src/image-lab/protocol';

assert.deepEqual(gridCells([0, 0, 1024, 1024]).map(cell => ({ label: cell.label, crop: cell.crop, bounds: cell.bounds })), [
  { label: 'NW', crop: [0, 0, 512, 512], bounds: [0, 512, 512, 1024] },
  { label: 'NE', crop: [512, 0, 512, 512], bounds: [512, 512, 1024, 1024] },
  { label: 'SW', crop: [0, 512, 512, 512], bounds: [0, 0, 512, 512] },
  { label: 'SE', crop: [512, 512, 512, 512], bounds: [512, 0, 1024, 512] },
]);
for (let i = 0; i < GRID_REGIONS.length; i++) {
  for (const edge of [0, 0.5, 1]) {
    const values = [(i + 0.5) / GRID_REGIONS.length, edge, edge];
    const scene = randomGridScene('geometry', () => values.shift()!);
    assert.equal(scene.region, GRID_REGIONS[i].name);
    assert.ok(scene.center.lat > 34 && scene.center.lat < 42);
    assert.ok(scene.center.lon > 19 && scene.center.lon < 27);
    assert.equal(scene.tiles.length, 4);
    const [w, s, e, n] = scene.bounds;
    const sumArea = scene.tiles.reduce((sum, cell) => sum + (cell.bounds[2] - cell.bounds[0]) * (cell.bounds[3] - cell.bounds[1]), 0);
    assert.ok(Math.abs(sumArea / ((e - w) * (n - s)) - 1) < 1e-12);
    assert.equal(scene.tiles[0].bounds[2], scene.tiles[1].bounds[0]);
    assert.equal(scene.tiles[0].bounds[1], scene.tiles[2].bounds[3]);
    assert.ok(Math.abs((e - w) * Math.cos(scene.center.lat * Math.PI / 180) - 10240) < 1e-6);
    const url = new URL(imageryUrl(scene));
    assert.equal(url.origin, 'https://tiles.maps.eox.at');
    assert.equal(url.searchParams.get('LAYERS'), 's2cloudless-2020_3857');
    assert.equal(url.searchParams.get('WIDTH'), '1024');
    assert.equal(url.searchParams.get('HEIGHT'), '1024');
    assert.equal(url.searchParams.get('SRS'), 'EPSG:3857');
  }
}
for (const item of LAB_PALETTE) assert.ok(DEFAULT_GRID_PROMPT.includes(item.hex));
assert.equal(GRID_SOURCE.license, 'CC BY-NC-SA 4.0');
assert.match(DEFAULT_GRID_PROMPT, /10 m native/);
console.log('Fixed 2×2 geometry, row order, no gaps/overlap, sampling extremes and historical provenance PASS');

let key = '';
let imageMode: 'good' | 'type' | 'magic' | 'large' | 'network' = 'good';
let providerFail = false;
let hold: Promise<void> | undefined;
let entered: (() => void) | undefined;
let submissions = 0;
let sourceFail = false;
const sourceHits: Record<string, number> = {};
// 256 x 256 Terrarium tile at a constant 500 m: 500 + 32768 = 129 * 256 + 244.
const terrariumPng = (() => {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
    return Buffer.concat([head, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(256, 0); ihdr.writeUInt32BE(256, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(256 * (256 * 3 + 1));
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const o = y * (256 * 3 + 1) + 1 + x * 3; raw[o] = 129; raw[o + 1] = 244; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();
function corine(target: URL) {
  const [w, s, e, n] = target.searchParams.get('geometry')!.split(',').map(Number), mid = (w + e) / 2;
  const box = (a: number, b: number) => [[[a, s], [b, s], [b, n], [a, n], [a, s]]];
  return Response.json({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { Code_18: '323' }, geometry: { type: 'Polygon', coordinates: box(w, mid) } },
    { type: 'Feature', properties: { Code_18: '211' }, geometry: { type: 'MultiPolygon', coordinates: [box(mid, e)] } },
  ] }, { headers: { 'Content-Type': 'application/geo+json' } });
}
function forecast() {
  const time = Array.from({ length: 48 }, (_, h) => `2026-11-15T${String(h % 24).padStart(2, '0')}:00`);
  const fill = (v: number) => time.map(() => v);
  return Response.json({ latitude: 38, longitude: 22, elevation: 480, hourly: { time, wind_speed_10m: fill(25), wind_direction_10m: fill(315),
    wind_gusts_10m: fill(45), temperature_2m: fill(31), relative_humidity_2m: fill(22) } });
}
const providerBodies: Record<string, any>[] = [];
const jpegBytes = Buffer.from([255, 216, 255, 217]);
const jpeg = `data:image/jpeg;base64,${jpegBytes.toString('base64')}`;
const fetcher: typeof fetch = async (url, init = {}) => {
  const target = new URL(String(url));
  if (target.hostname !== 'queue.fal.run') {
    assert.equal(new Headers(init.headers).get('Authorization'), null, 'Never send FAL_KEY to imagery/media servers');
    assert.equal(init.redirect, 'error');
    sourceHits[target.hostname] = (sourceHits[target.hostname] ?? 0) + 1;
    if (target.hostname === 'image.discomap.eea.europa.eu') return sourceFail ? new Response('down', { status: 503 }) : corine(target);
    if (target.hostname === 's3.amazonaws.com') return new Response(terrariumPng, { headers: { 'Content-Type': 'image/png' } });
    if (target.hostname === 'api.open-meteo.com') return forecast();
    if (target.hostname === 'tiles.maps.eox.at') {
      if (imageMode === 'network') throw new Error('offline');
      if (imageMode === 'type') return new Response('xml error', { headers: { 'Content-Type': 'text/xml' } });
      if (imageMode === 'magic') return new Response('bad image', { headers: { 'Content-Type': 'image/jpeg' } });
      if (imageMode === 'large') return new Response(Buffer.alloc(8 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/jpeg' } });
    } else assert.equal(target.hostname, 'fal.media');
    return new Response(jpegBytes, { headers: { 'Content-Type': 'image/jpeg' } });
  }
  assert.equal(new Headers(init.headers).get('Authorization'), 'Key test-grid-key');
  if (init.method === 'POST') {
    submissions++;
    providerBodies.push(JSON.parse(String(init.body)));
    entered?.();
    await hold;
    if (providerFail) throw new Error('ambiguous network acceptance');
    return Response.json({ request_id: `grid-${submissions}` });
  }
  if (target.pathname.endsWith('/status')) return Response.json({ status: 'COMPLETED' });
  return Response.json({ images: [{ url: 'https://fal.media/grid-image.jpg' }], description: '' });
};
const middleware = createImageLabMiddleware(() => key, fetcher);
const server = createServer((req, res) => void middleware(req, res, () => { res.writeHead(404); res.end(); }));
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function request(path: string, body?: unknown) {
  const response = await fetch(`${origin}${LAB_API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const binary = response.headers.get('content-type')?.startsWith('image/');
  const data = binary ? Buffer.from(await response.arrayBuffer()) : await response.json();
  assert.ok(!JSON.stringify(data).includes('test-grid-key'));
  return { status: response.status, data };
}
const input = { model: LAB_MODELS[0].value, resolution: '1K', image: jpeg, context: jpeg };
try {
  const scene = (await request('/grid', {})).data as GridScene;
  const base = `/grid/${scene.id}`;
  assert.equal((await request(`${base}/imagery`)).status, 200, 'Imagery works without fal key');
  assert.equal(submissions, 0);
  for (const mode of ['type', 'magic', 'large', 'network'] as const) {
    imageMode = mode;
    assert.equal((await request(`${base}/imagery`)).status, 502);
  }
  imageMode = 'good';
  assert.equal((await request(`${base}/imagery`)).status, 200, 'Failed downloads release loading lock');
  assert.equal(submissions, 0);

  sourceFail = true;
  const down = await request(`${base}/landscape`);
  assert.equal(down.status, 502);
  assert.match(down.data.error, /No fal analysis/);
  sourceFail = false;
  const land = await request(`${base}/landscape`);
  assert.equal(land.status, 200, 'A failed source build is not cached');
  const payload = land.data as LandscapePayload;
  assert.equal(payload.side, MODEL_SIDE);
  assert.equal(payload.polygons, 2);
  const clc = decodeUint16(payload.clc), elevation = decodeFloat32(payload.elevation);
  assert.equal(clc[MODEL_SIDE * 128 + 10], 323);
  assert.equal(clc[MODEL_SIDE * 128 + 245], 211);
  assert.ok(clc.every(code => code === 323 || code === 211), 'Polygons covering the envelope map every cell');
  assert.ok(elevation.every(v => Math.abs(v - 500) < 1e-3));
  assert.equal(elevation.length, MODEL_CELLS);
  const hits = { ...sourceHits };
  assert.deepEqual((await request(`${base}/landscape`)).data, payload);
  assert.deepEqual(sourceHits, hits, 'Landscape is cached per scene');
  const weather = (await request(`${base}/weather`)).data as WeatherSeries;
  assert.equal(weather.hours.length, 48);
  assert.deepEqual([weather.hours[0].windKph, weather.hours[0].windDirDeg, weather.hours[0].gustKph], [25, 315, 45]);
  await request(`${base}/weather`);
  assert.equal(sourceHits['api.open-meteo.com'], 1, 'Weather is cached for ten minutes');
  assert.equal(submissions, 0, 'Landscape and weather never call fal');
  key = 'test-grid-key';
  assert.equal((await request(`${base}/tile/4`, input)).status, 400);
  assert.equal((await request(`${base}/tile/0`, { ...input, resolution: '4K' })).status, 400);
  assert.equal((await request(`${base}/tile/0`, { ...input, image: 'https://arbitrary.example/image' })).status, 400);
  assert.equal((await request(`${base}/tile/0`, { ...input, context: undefined })).status, 400, 'Context image is required');
  assert.equal(submissions, 0);
  const accepted: { jobId: string; requestId: string }[] = [];
  for (let i = 0; i < 4; i++) {
    const result = await request(`${base}/tile/${i}`, { ...input, prompt: 'client prompts are ignored' });
    assert.equal(result.status, 202);
    accepted.push(result.data);
    const repeat = await request(`${base}/tile/${i}`, input);
    assert.equal(repeat.status, 200);
    assert.deepEqual(repeat.data, result.data);
    if (i === 0) assert.equal((await request(`${base}/tile/1`, { ...input, model: LAB_MODELS[1].value })).status, 409);
    assert.equal((await request(`/${result.data.jobId}`)).status, 200);
  }
  assert.equal(submissions, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(providerBodies[i].resolution, '1K');
    assert.equal(providerBodies[i].num_images, 1);
    assert.equal(providerBodies[i].limit_generations, true);
    assert.deepEqual(providerBodies[i].image_urls, [jpeg, jpeg], 'Halo cell first, whole-scene context second');
    assert.equal(providerBodies[i].prompt, reviewPrompt(['NW', 'NE', 'SW', 'SE'][i]), 'Prompt is fixed server-side');
  }
  const outputs = await Promise.all([0, 1, 2, 3].map(i => request(`${base}/output/${i}`)));
  assert.ok(outputs.every(result => result.status === 200), 'All four output images may load concurrently');
  assert.equal(submissions, 4, 'Stitching is never a fifth generation');
  const recovered = await Promise.all([0, 1, 2, 3].map(i => request(`${base}/tile/${i}`, input)));
  recovered.forEach((result, i) => assert.deepEqual(result.data, accepted[i]));
  assert.equal(submissions, 4);

  const race = (await request('/grid', {})).data as GridScene;
  let release!: () => void;
  hold = new Promise<void>(resolve => { release = resolve; });
  const handshake = new Promise<void>(resolve => { entered = resolve; });
  const first = request(`/grid/${race.id}/tile/0`, input);
  await handshake;
  assert.equal((await request(`/grid/${race.id}/tile/0`, input)).status, 409);
  release(); await first; hold = undefined; entered = undefined;
  assert.equal(submissions, 5, 'Duplicate concurrent clicks produce one provider submission');
  assert.equal((await request(`/grid/${race.id}/tile/0`, input)).status, 200);
  providerFail = true;
  assert.equal((await request(`/grid/${race.id}/tile/1`, input)).status, 502);
  providerFail = false;
  assert.equal((await request(`/grid/${race.id}/tile/1`, input)).status, 409);
  assert.equal(submissions, 6, 'An ambiguous failure permanently reserves its slot');
  assert.equal((await request(`/grid/${race.id}/output/1`)).status, 409);
  // Automatic retries: ordered attempts, the previous output must exist, and the budget is locked and capped.
  const retry = (await request('/grid', {})).data as GridScene;
  const rbase = `/grid/${retry.id}/tile/0`;
  const at = (attempt: number, retries = 2) => request(rbase, { ...input, attempt, retries });
  assert.equal((await request(rbase, { ...input, attempt: 4, retries: 2 })).status, 400, 'Attempt above the server maximum');
  assert.equal((await at(0, 4)).status, 400, 'Retry budget above the server maximum');
  const first0 = await at(0);
  assert.equal(first0.status, 202);
  assert.equal((await at(1)).status, 409, 'A retry waits for the previous output');
  assert.equal((await request(`/${first0.data.jobId}`)).status, 200);
  assert.equal((await at(2)).status, 409, 'Attempts run in order');
  assert.equal((await at(1, 1)).status, 409, 'Retry budget is locked for the run');
  const second0 = await at(1);
  assert.equal(second0.status, 202);
  assert.deepEqual((await at(1)).data, second0.data, 'A repeated retry returns the same handle');
  await request(`/${second0.data.jobId}`);
  const third0 = await at(2);
  assert.equal(third0.status, 202);
  await request(`/${third0.data.jobId}`);
  assert.equal((await at(3)).status, 409, 'No attempt past the retry budget');
  for (const path of ['/output/0/0', '/output/0/1', '/output/0/2', '/output/0']) assert.equal((await request(`/grid/${retry.id}${path}`)).status, 200);
  assert.equal((await request(`/grid/${retry.id}/output/0/3`)).status, 409);
  assert.equal(submissions, 9, 'Three attempts for one cell are three provider submissions');

  // All four cells may hold a provider handshake at the same time.
  const together = (await request('/grid', {})).data as GridScene;
  let releaseAll!: () => void, inside = 0;
  hold = new Promise<void>(resolve => { releaseAll = resolve; });
  const allInside = new Promise<void>(resolve => { entered = () => { if (++inside === 4) resolve(); }; });
  const parallel = [0, 1, 2, 3].map(i => request(`/grid/${together.id}/tile/${i}`, { ...input, attempt: 0, retries: 0 }));
  await allInside;
  releaseAll();
  assert.ok((await Promise.all(parallel)).every(result => result.status === 202), 'Four concurrent cells are accepted');
  hold = undefined; entered = undefined;
  assert.equal(submissions, 13);  for (let i = 4; i < 6; i++) assert.equal((await request('/grid', {})).status, 201);
  assert.equal((await request('/grid', {})).status, 429);
  assert.equal(submissions, 13);
  console.log('No-key imagery and keyless landscape/weather (cached, failures not cached), size/type/network errors, exactly four 1K calls, deduplication, concurrent clicks, ordered capped retries, four concurrent cells, ambiguous failures and image exports PASS');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

const scene = randomGridScene('client');
const fresh = (): GridTileRun[] => [0, 1, 2, 3].map(index => ({
  index, status: 'Ready', attempts: [], halo: jpeg, context: jpeg,
  source: { dataUrl: jpeg, name: `${index}`, width: 512, height: 512, originalWidth: 512, originalHeight: 512 },
}));
let tiles = fresh();
const calls: string[] = [];
let active = 0, peak = 0, retrievalFails = true, submitFailsOnce = false;
const settings = { model: LAB_MODELS[0].value, retries: 2 };
const update = (next: GridTileRun) => { tiles = tiles.map(tile => tile.index === next.index ? next : tile); };
const submit = async (index: number, _tile: GridTileRun, attempt: number) => {
  calls.push(`${index}/${attempt}`);
  active++; peak = Math.max(peak, active);
  await new Promise(resolve => setTimeout(resolve, 5));
  active--;
  if (submitFailsOnce && index === 3 && attempt === 1) { submitFailsOnce = false; throw new Error('ambiguous'); }
  return { jobId: `job-${index}-${attempt}`, requestId: `request-${index}-${attempt}` };
};
const poll = async (id: string): Promise<LabResult> => {
  if (id === 'job-1-0' && retrievalFails) throw new Error('temporary retrieval failure');
  return { status: 'COMPLETED', requestId: id, images: [{ url: 'https://fal.media/result.png' }], description: '' };
};
// Off-palette share per cell and attempt: 0 passes at once, 2 passes on its first retry, 3 never passes.
const off = [[0.05], [0.1], [0.4, 0.12], [0.4, 0.3, 0.35]];
const review = async (index: number, attempt: number): Promise<ReviewCell> => ({
  index, offPalette: off[index][attempt], accepted: off[index][attempt] <= 0.15, shares: new Float32Array(0), counts: [0, 0, 0],
});
const run = (list = tiles, signal = new AbortController().signal) => processGrid(scene, list, settings, signal, update, submit, poll, review);
await run();
assert.equal(peak, 4, 'All four cells submit concurrently');
assert.deepEqual([...calls].sort(), ['0/0', '1/0', '2/0', '2/1', '3/0', '3/1', '3/2'], 'Only gate-rejected cells are retried, within budget');
assert.equal(tiles[1].done, undefined);
assert.equal(tiles[1].attempts[0].jobId, 'job-1-0', 'A retrieval failure must preserve the paid request handle');
assert.deepEqual(tiles.map(bestAttempt), [0, undefined, 1, 1]);
assert.match(tiles[2].status, /Accepted · attempt 2 of 3/);
assert.match(tiles[3].status, /Rejected after 3 attempts/);
retrievalFails = false;
await run();
assert.equal(calls.length, 7, 'Recovery polls the same job instead of regenerating');
assert.ok(tiles.every(tile => tile.done));
await run();
assert.equal(calls.length, 7);
await assert.rejects(() => processGrid(scene, tiles.slice(0, 3), settings, new AbortController().signal, update, submit, poll, review));
const aborted = new AbortController(); aborted.abort();
await run(fresh(), aborted.signal);
assert.equal(calls.length, 7);

// An ambiguous retry submission stops the cell; recovery asks for the same attempt again, never a new one.
tiles = fresh(); calls.length = 0; submitFailsOnce = true;
await run();
assert.equal(tiles[3].error, 'ambiguous');
await run();
assert.deepEqual(calls.filter(call => call.startsWith('3/')), ['3/0', '3/1', '3/1', '3/2']);
console.log('Concurrent client runner, gate-driven retries within budget, best-attempt choice, partial recovery, handle retention, four-tile guard and abort behavior PASS');
