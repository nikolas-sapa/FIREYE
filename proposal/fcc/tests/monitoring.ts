import assert from 'node:assert/strict';
import './wildfire-fatalities';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { createMonitoringMiddleware, fetchCase2024, imageUrl, limitedResponse, result, validBurnedGeometry, type MonitoringConfig } from '../server/monitoring';
import { contextPack, distanceKm, iso, legacyEntry, parseFirms, parseForecast, parseMetar, sanitizeCameras } from '../src/console/monitoring/model';
import { loadResource, readSaved, writeSaved } from '../src/console/monitoring/resources';
import { loadScenario } from '../src/console/scenario/load';
import { CAMERAS } from '../src/console/monitoring/cameras';
import { archiveCrop } from '../src/console/stage3d/feeds/archive-camera';
import { checkMonitoringFeeds } from './monitoring-feeds';
import { checkWorld3d } from './world3d';

assert.deepEqual(archiveCrop(4000, 3000, 2, 0), { x: 980, y: 1065, width: 2040, height: 1020 });
for (const [w, h] of [[4096, 3454], [3840, 4035], [384, 216]]) for (const aspect of [0.56, 1, 16 / 9, 3.5]) {
  for (let s = 0; s <= 144; s++) {
    const crop = archiveCrop(w, h, aspect, s * 2, s % 7, { x: (s % 11) / 10, y: (s % 13) / 12 });
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0);
    assert.ok(crop.x + crop.width <= w + 1e-9 && crop.y + crop.height <= h + 1e-9, 'no empty or invented pixels around camera crops');
  }
}
assert.notDeepEqual(archiveCrop(4000, 3000, 16 / 9, 0), archiveCrop(4000, 3000, 16 / 9, 3), 'demo frames actually move');

const csv = 'latitude,longitude,acq_date,acq_time,confidence,frp\n38.04,23.98,2026-11-14,52,n,12.4\n0,0,2026-11-14,1200,h,3\n38,24,2026-11-14,,n,\n38,24,2026-02-30,1000,n,4';
const detections = parseFirms(csv, 'NOAA-20');
assert.equal(detections.length, 1);
assert.equal(detections[0].observedAt, '2026-11-14T00:52:00.000Z');
assert.equal(detections[0].frp, 12.4);
assert.equal(parseFirms(csv.split('\n')[0], 'NOAA-21').length, 0);
assert.throws(() => parseFirms('HTTP error', 'NOAA-20'));
assert.equal(iso('2024-08-12T09:05:00'), '2024-08-12T09:05:00.000Z');
assert.equal(iso('2024-08-12T12:05:00+03:00'), '2024-08-12T09:05:00.000Z');
const forecast = parseForecast({ properties: { timeseries: [{ time: '2026-11-14T12:00:00Z', data: { instant: { details: { wind_speed: 10, wind_from_direction: 270, air_temperature: 22 } } } }] } });
assert.equal(forecast[0].windKph, 36); assert.equal(forecast[0].gustKph, null); assert.equal(forecast[0].humidity, null);
assert.throws(() => parseForecast({}));
const metar = parseMetar([{ obsTime: 1794657600, icaoId: 'LGAV', lat: 37.936, lon: 23.945, wspd: 10, wdir: 'VRB', temp: null }]);
assert.equal(metar[0].windKph, 18.52); assert.equal(metar[0].windFromDeg, null); assert.equal(metar[0].gustKph, null); assert.equal(metar[0].tempC, null);
assert.equal(parseMetar([{ obsTime: Infinity }]).length, 0);
assert.equal(distanceKm({ lon: 0, lat: 0 }, { lon: 0, lat: 1 }).toFixed(1), '111.2');
for (const q of ['?mode=replay', '?scenario=caldor-2021', '?beat=3']) assert.ok(legacyEntry(q));
for (const q of ['', '?view=mati', '?mode=monitoring']) assert.equal(legacyEntry(q), false);
assert.equal(sanitizeCameras([{ ...CAMERAS[0], image: 'https://media.example/?secret=x', player: 'https://player.example' }])[0].image, undefined);
assert.ok(new Set(CAMERAS.map(c => c.url)).size >= 6);
assert.ok(CAMERAS.filter(c => c.pos).length >= 4);

const root = resolve(process.cwd(), 'public');
const fileFetch = (async (url: string | URL | Request) => {
  const path = resolve(root, `.${url}`);
  assert.ok(path.startsWith(`${root}/`));
  try { return new Response(readFileSync(path)); } catch { return new Response(null, { status: 404 }); }
}) as typeof fetch;
const originalFetch = globalThis.fetch;
globalThis.fetch = fileFetch;
const pack = await loadScenario('mati-2018');
globalThis.fetch = originalFetch;
await checkMonitoringFeeds(pack);
checkWorld3d(pack);
const safe = contextPack(pack);
assert.notEqual(safe, pack); assert.equal(safe.elevation, pack.elevation);
assert.ok(safe.arrival.every(n => n === Infinity)); assert.ok(pack.arrival.some(Number.isFinite));
for (const field of ['hotspots', 'perimeters', 'weather', 'checkpoints', 'reports', 'facts'] as const) assert.equal(safe[field]?.length, 0);
assert.equal(safe.imagery, undefined);
assert.ok(!safe.manifest.places.some(p => /pefka|trailhead|model/i.test(p.name)));
const mapping = JSON.parse(readFileSync(resolve(root, 'data/monitoring/attica2024.json'), 'utf8'));
const detail = JSON.parse(readFileSync(resolve(root, 'data/monitoring/attica-detail-2020.json'), 'utf8'));
assert.equal(detail.width, 3840); assert.equal(detail.height, 4035);
assert.match(detail.license, /CC BY-NC-SA/); assert.match(detail.note, /Not a 2024 or current/);
assert.equal(readFileSync(resolve(root, 'data/monitoring/attica-detail-2020.jpg'))[0], 255);
assert.equal(mapping.data.burnedHa, 8594.2);
assert.equal(mapping.data.acquiredAt, '2024-08-12T09:05:00.000Z');
assert.equal(mapping.data.geometry.features.length, 46);
assert.ok(validBurnedGeometry(mapping.data.geometry));
assert.equal(validBurnedGeometry({ type: 'FeatureCollection', features: [] }), false);
assert.equal(validBurnedGeometry({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { notation: 'AOI' }, geometry: mapping.data.geometry.features[0].geometry }] }), false);
assert.ok(mapping.data.geometry.features.every((f: { properties: { notation: string } }) => f.properties.notation === 'Burnt area'));
assert.ok(readdirSync(resolve(root, 'data/monitoring')).reduce((n, file) => n + statSync(resolve(root, 'data/monitoring', file)).size, 0) < 5 * 1024 * 1024);
assert.ok(imageUrl('gibs', 'mati', '2018-07-23').includes('VIIRS_SNPP_'));
assert.ok(imageUrl('gibs', 'current', '2026-11-15').includes('VIIRS_NOAA20_'));
assert.throws(() => imageUrl('gibs', 'mati', '2024-02-30'));
assert.ok(imageUrl('danger', 'current', '2026-11-15').includes('ecmwf.fwi'));
await assert.rejects(limitedResponse(new Response(new Uint8Array(11)), 10), /size limit/);
await assert.rejects(limitedResponse(new Response('failure', { status: 503 })), /HTTP 503/);

function request(middleware: ReturnType<typeof createMonitoringMiddleware>, path: string, options: { host?: string; origin?: string | string[]; method?: string; remote?: string; site?: string | string[]; mode?: string; dest?: string; rawHeaders?: string[] } = {}) {
  return new Promise<{ status: number; body: string; headers: Record<string, string> }>((resolve, reject) => {
    let status = 0, headers: Record<string, string>;
    const req = { url: path, method: options.method ?? 'GET', headers: { host: options.host ?? 'localhost:4177', origin: options.origin,
      'sec-fetch-site': options.site, 'sec-fetch-mode': options.mode, 'sec-fetch-dest': options.dest }, rawHeaders: options.rawHeaders,
      socket: { remoteAddress: options.remote ?? '127.0.0.1' } } as IncomingMessage;
    const res = { writeHead(s: number, h: Record<string, string>) { status = s; headers = h; }, end(bytes: Uint8Array) { resolve({ status, headers, body: new TextDecoder().decode(bytes) }); } } as unknown as ServerResponse;
    void middleware(req, res, () => reject(new Error('Unexpected next'))).catch(reject);
  });
}
// Regressions exercise the production boundary with fake provider responses, never paid traffic.
const privateKey = 'private-example-key', echo = 'ECHO_CHECK_123';
let malformedCalls = 0, leakedReplies = 0, malformedFailures = 0;
const malformed = createMonitoringMiddleware(() => ({ windyKey: privateKey, contact: 'https://example.org/project' }), (async () => {
  const body = [echo, `{"key":"${privateKey}","echo":"${echo}"`, `https://provider.example/?key=${privateKey}&echo=${echo}`][malformedCalls++ % 3];
  return new Response(body);
}) as typeof fetch);
for (let i = 0; i < 20; i++) {
  const reply = await request(malformed, `/api/monitor/${['cameras', 'forecast', 'metar', 'case2024'][i % 4]}`);
  if (reply.status === 503) malformedFailures++;
  if (reply.body.includes(echo) || reply.body.includes(privateKey) || reply.body.includes('provider.example')) leakedReplies++;
}
let crossSiteCalls = 0, crossSiteRejected = 0;
const crossSite = createMonitoringMiddleware(() => ({ windyKey: privateKey }), (async () => { crossSiteCalls++; return Response.json({ webcams: [] }); }) as typeof fetch);
for (let i = 0; i < 20; i++) {
  const reply = await request(crossSite, '/api/monitor/cameras', { site: 'cross-site', mode: 'navigate', dest: 'document' });
  if (reply.status === 403) crossSiteRejected++;
}
assert.deepEqual({ malformedFailures, leakedReplies, crossSiteRejected, crossSiteCalls },
  { malformedFailures: 20, leakedReplies: 0, crossSiteRejected: 20, crossSiteCalls: 0 });
assert.ok(malformedCalls >= 20, '20 malformed provider responses exercised');
for (const prefix of ['Unexpected ', 'Add ', 'Missing ', 'Invalid ', 'Provider returned HTTP 503 ']) {
  const untrusted = createMonitoringMiddleware(() => ({ windyKey: privateKey }), (async () => { throw new Error(`${prefix}${echo} ${privateKey}`); }) as typeof fetch);
  const reply = await request(untrusted, '/api/monitor/cameras');
  assert.equal(reply.status, 503); assert.ok(!reply.body.includes(echo) && !reply.body.includes(privateKey), 'prefixes cannot confer error ownership');
}
for (const options of [{ site: 'same-site' }, { site: 'cross-site', origin: 'http://localhost:4177' },
  { site: ['same-origin', 'cross-site'] }, { site: 'same-origin, cross-site' }, { origin: ['http://localhost:4177'] },
  { site: 'same-origin', rawHeaders: ['Host', 'localhost:4177', 'Sec-Fetch-Site', 'same-origin', 'Sec-Fetch-Site', 'cross-site'] },
  { rawHeaders: ['Host', 'localhost:4177', 'Host', 'localhost:4177'] },
  { rawHeaders: ['Origin', 'http://localhost:4177', 'Origin', 'https://evil.example'] }]) {
  assert.equal((await request(crossSite, '/api/monitor/cameras', options)).status, 403, 'ambiguous or cross-site contexts fail closed');
}
assert.equal(crossSiteCalls, 0);
for (const options of [{}, { site: 'none', mode: 'navigate', dest: 'document' },
  { site: 'same-origin', origin: 'http://localhost:4177', mode: 'cors', dest: 'empty' }]) {
  assert.equal((await request(crossSite, '/api/monitor/cameras', options)).status, 200, 'originless CLI and legitimate same-origin contexts stay available');
}
const originalNow = Date.now;
let quotaNow = originalNow(), quotaCalls = 0;
Date.now = () => quotaNow;
try {
  const quota = createMonitoringMiddleware(() => ({ windyKey: privateKey }), (async () => { quotaCalls++; return Response.json({ webcams: [] }); }) as typeof fetch);
  for (let i = 0; i < 20; i++) {
    if (i === 10) quotaNow += 10000;
    assert.equal((await request(quota, '/api/monitor/cameras')).status, 200);
  }
  assert.equal(quotaCalls, 20);
  assert.equal((await request(quota, '/api/monitor/cameras')).status, 429); assert.equal(quotaCalls, 20, '21st discovery never reaches provider');
  quotaNow += 49999;
  assert.equal((await request(quota, '/api/monitor/cameras')).status, 429); assert.equal(quotaCalls, 20, 'window is rolling, not per clock minute');
  quotaNow++;
  for (let i = 0; i < 10; i++) assert.equal((await request(quota, '/api/monitor/cameras')).status, 200);
  assert.equal((await request(quota, '/api/monitor/cameras')).status, 429); assert.equal(quotaCalls, 30, 'only expired discoveries restore capacity');
  let failureCalls = 0;
  const failedQuota = createMonitoringMiddleware(() => ({ windyKey: privateKey }), (async () => { failureCalls++; throw new Error(`${echo} ${privateKey}`); }) as typeof fetch);
  for (let i = 0; i < 20; i++) assert.equal((await request(failedQuota, '/api/monitor/cameras')).status, 503);
  assert.equal((await request(failedQuota, '/api/monitor/cameras')).status, 429); assert.equal(failureCalls, 20, 'failed discoveries consume quota without refunds');
  quotaNow += 60000;
  assert.equal((await request(failedQuota, '/api/monitor/cameras')).status, 503); assert.equal(failureCalls, 21, 'rolling capacity recovers after one minute');
} finally { Date.now = originalNow; }
let calls = 0;
const config: MonitoringConfig = {};
const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
const freshCsv = `latitude,longitude,acq_date,acq_time,confidence,frp\n38.04,23.98,${oneHourAgo.slice(0, 10)},${oneHourAgo.slice(11, 16).replace(':', '')},n,12.4\n38.04,23.98,2020-01-01,1200,n,20`;
const middleware = createMonitoringMiddleware(() => config, (async () => { calls++; return new Response(freshCsv); }) as typeof fetch);
assert.equal((await request(middleware, '/api/monitor/config', { host: 'example.org' })).status, 403);
assert.equal((await request(middleware, '/api/monitor/config', { origin: 'https://evil.example' })).status, 403);
assert.equal((await request(middleware, '/api/monitor/config', { remote: '192.168.1.2' })).status, 403);
assert.equal((await request(middleware, '/api/monitor/config', { method: 'POST' })).status, 405);
assert.equal((await request(middleware, '/api/monitor/unknown')).status, 404);
assert.equal((await request(middleware, '/api/monitor/forecast')).status, 503);
assert.equal((await request(middleware, '/api/monitor/cameras')).status, 503);
assert.equal(calls, 0, 'missing keys/contact do not make external calls');
let weatherCalls = 0;
const metNo = createMonitoringMiddleware(() => ({ contact: 'https://example.org/project' }), (async (_url, init) => {
  weatherCalls++; assert.match(String((init?.headers as Record<string, string>)['User-Agent']), /example.org\/project/);
  return Response.json({ properties: { timeseries: [] } }, { headers: { 'Cache-Control': 'no-store' } });
}) as typeof fetch);
assert.equal((await request(metNo, '/api/monitor/forecast')).status, 200);
await request(metNo, '/api/monitor/forecast'); assert.equal(weatherCalls, 2, 'respect provider no-store');
const firms = await request(middleware, '/api/monitor/firms');
assert.equal(firms.status, 200); assert.equal(JSON.parse(firms.body).data.length, 2); assert.equal(calls, 2);
assert.equal(firms.headers['Cache-Control'], 'no-store');
await request(middleware, '/api/monitor/firms'); assert.equal(calls, 2, 'short-lived server cache');
// Exercise the real 20 MiB entry / 40 MiB cache gates, not scaled-down substitutes.
const largeImage = new Uint8Array(20 * 1024 * 1024); largeImage.set([137, 80, 78, 71]);
let imageCalls = 0;
const imageCache = createMonitoringMiddleware(() => ({}), (async () => { imageCalls++; return new Response(largeImage); }) as typeof fetch);
const imageRequest = (day: number) => request(imageCache, `/api/monitor/image?kind=gibs&view=current&date=2026-11-${String(day).padStart(2, '0')}`);
for (const day of [1, 2, 1]) assert.equal((await imageRequest(day)).status, 200);
assert.equal(imageCalls, 2, 'two maximum-size entries fit');
await imageRequest(3); await imageRequest(1);
assert.equal(imageCalls, 4, 'third 20 MiB entry evicts the oldest rather than exceeding 40 MiB');
config.firmsKey = 'private-example-key'; config.windyKey = 'private-example-key';
const midnight = createMonitoringMiddleware(() => config, (async url => {
  assert.ok(String(url).endsWith('/2'), 'query two UTC dates to avoid a false-empty result just after midnight');
  return new Response(freshCsv);
}) as typeof fetch);
assert.equal(JSON.parse((await request(midnight, '/api/monitor/firms')).body).data.length, 2, 'rolling 24 h excludes old records');
assert.ok(!(await request(middleware, '/api/monitor/config')).body.includes('private-example-key'));
const failure = createMonitoringMiddleware(() => config, (async () => { throw new Error('private-example-key'); }) as typeof fetch);
const failed = await request(failure, '/api/monitor/firms');
assert.equal(failed.status, 503); assert.ok(!failed.body.includes('private-example-key'));
assert.equal((await request(failure, '/api/monitor/image?kind=danger&view=mati&date=2018-07-23')).status, 503);
assert.equal((await request(failure, '/api/monitor/image?kind=gibs&view=__proto__&date=2026-11-15')).status, 503);
let release: (() => void) | undefined, pendingCalls = 0;
const pending = createMonitoringMiddleware(() => ({}), (async () => { pendingCalls++; await new Promise<void>(r => { release = r; }); return new Response('[]'); }) as typeof fetch);
const one = request(pending, '/api/monitor/metar'), two = request(pending, '/api/monitor/metar');
assert.equal(pendingCalls, 1); release!(); await Promise.all([one, two]);
let cameraRelease: (() => void) | undefined, sharedCameraCalls = 0;
const sharedCamera = createMonitoringMiddleware(() => config, (async () => {
  sharedCameraCalls++;
  if (sharedCameraCalls === 1) await new Promise<void>(r => { cameraRelease = r; });
  return Response.json({ webcams: [] });
}) as typeof fetch);
const cameraOne = request(sharedCamera, '/api/monitor/cameras'), cameraTwo = request(sharedCamera, '/api/monitor/cameras');
assert.equal(sharedCameraCalls, 1); cameraRelease!();
assert.deepEqual((await Promise.all([cameraOne, cameraTwo])).map(r => r.status), [200, 200]);
for (let i = 0; i < 19; i++) assert.equal((await request(sharedCamera, '/api/monitor/cameras')).status, 200);
assert.equal(sharedCameraCalls, 20, 'shared pending discovery consumes one quota slot and camera URLs remain uncached');
assert.equal((await request(sharedCamera, '/api/monitor/cameras')).status, 429); assert.equal(sharedCameraCalls, 20);
await assert.rejects(fetchCase2024((async url => new Response(JSON.stringify(String(url).includes('public-activations') ? { results: [] } : { type: 'FeatureCollection', features: [] }))) as typeof fetch), /schema/);

const value = result('fixture', 'https://example.org', 'Fixture', 'observation', 'Known real-data shape', []);
const ok = await loadResource('firms', false, undefined, undefined, new AbortController().signal, (async () => Response.json(value)) as typeof fetch);
assert.equal(ok.value?.source, 'fixture');
const stale = await loadResource('firms', false, '/bundle.json', value, new AbortController().signal, (async () => { throw new Error('offline'); }) as typeof fetch);
assert.equal(stale.value, value); assert.equal(stale.error, 'offline');
const fallback = await loadResource('firms', false, '/bundle.json', undefined, new AbortController().signal,
  (async url => String(url).startsWith('/api') ? Response.json({ error: 'offline' }, { status: 503 }) : Response.json(value)) as typeof fetch);
assert.equal(fallback.saved, true); assert.match(fallback.error!, /bundled real/);
assert.match((await loadResource('forecast', true, undefined, undefined, new AbortController().signal)).error!, /No saved/);
const abort = new AbortController();
let complete: ((r: Response) => void) | undefined;
const obsolete = loadResource('firms', false, undefined, undefined, abort.signal, (async () => new Promise<Response>(r => { complete = r; })) as typeof fetch);
abort.abort(); complete!(Response.json(value));
await assert.rejects(obsolete, { name: 'AbortError' }, 'late response cannot commit after a view switch');
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), get length() { return storage.size; }, key: (i: number) => [...storage.keys()][i] }, configurable: true });
assert.ok(writeSaved('firms', value)); assert.deepEqual(readSaved('firms'), value);
assert.equal(writeSaved('cameras', value), false);
assert.equal(writeSaved('metar', { ...value, note: 'x'.repeat(2 * 1024 * 1024) }), false, '4 MB UTF-16 storage bound');
for (const file of ['MonitoringApp.tsx', 'MonitoringGlobe.tsx']) {
  const source = readFileSync(resolve('src/console/monitoring', file), 'utf8');
  assert.ok(!/from ['"].*(?:store|world\/runtime|agents\/)/.test(source), 'monitoring never imports old incident runtime');
}
console.log('Monitoring: source parsers/units, real historical fixtures, simulator isolation, localhost/secrets, caches, failure/stale/saved states, storage bounds and late-request cancellation PASS');
