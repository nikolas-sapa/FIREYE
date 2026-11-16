import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScenario } from '../src/console/scenario';
import { createBus } from '../src/console/bus';
import { Runtime } from '../src/console/world/runtime';
import { captureFrame, frameStatus, renderedFrame, validateFrameMetadata, type FrameMetadata } from '../src/console/world/frame-capture';

globalThis.fetch = (async (url: string | URL | Request) => {
  const file = resolve('public', `.${String(url)}`);
  assert.ok(file.startsWith(`${resolve('public')}/`));
  return new Response(readFileSync(file));
}) as typeof fetch;
const pack = await loadScenario('mati-2018');
const rt = new Runtime(pack, createBus());
const drones = rt.sim.units.filter(u => u.kind === 'drone');
assert.ok(drones.length >= 4);
for (const drone of drones) {
  const channels = rt.sim.feeds.filter(f => f.unitId === drone.id);
  const thermal = channels.filter(f => f.modality === 'thermal');
  const eo = channels.filter(f => f.modality === 'eo');
  assert.equal(thermal.length, 1, 'one registered thermal channel per drone');
  assert.equal(eo.length, 1, 'separate EO channel per drone');
  assert.notEqual(thermal[0].id, eo[0].id);
  assert.ok(channels.every(f => f.sourceKind === 'simulated' && f.synthetic === true && f.radiometric === false && f.calibration === null));
  assert.ok(channels.some(f => f.id === `feed-${drone.id}`), 'existing presentation ID survives');
}
assert.equal(new Set(rt.sim.feeds.map(f => f.id)).size, rt.sim.feeds.length);
console.log(`TH01: ${drones.length}/${drones.length} thermal and EO channels registered with distinct IDs PASS`);
let providerCalls = 0;
globalThis.fetch = (async () => { providerCalls++; throw new Error('Providers disabled'); }) as typeof fetch;
rt.sim.paused = false; rt.sim.speed = 1;
const before = rt.sim.t;
for (let i = 0; i < 600; i++) rt.tick(0.1);
assert.ok(Math.abs(rt.sim.t - before - 60000) < 1);
assert.equal(providerCalls, 0);
console.log('TH05: 600 actual Runtime ticks advance 60 simulation seconds with 0 provider calls PASS');

const meta: FrameMetadata = {
  version: 'fcc-local-frame.v1', frame_id: 'frame-1', feed_id: 'feed-1', asset_id: 'drone-1',
  evidence_id: 'evidence-1', source_snapshot_id: 'snapshot-1', source_revision: 0, capture_epoch: 1,
  modality: 'thermal', source_kind: 'simulated', synthetic: true, radiometric: false, calibration: null,
  captured_at: '2026-11-15T08:00:00Z', capture_time_status: 'known', received_at: null,
  scenario_time_ms: pack.manifest.start, sim_tick: null, source_position: null,
  location_uncertainty_m: null, rendered_at_ms: 10, width_px: 2, height_px: 1,
  display_transform: 'ir-whitehot',
};
assert.equal(validateFrameMetadata(meta).ok, true);
for (let i = 0; i < 25; i++) {
  for (const bad of [
    { ...meta, captured_at: i % 2 ? '2026-02-30T12:00:00Z' : 'not UTC' },
    { ...meta, scenario_time_ms: i % 2 ? NaN : Infinity },
    { ...meta, modality: `unknown-${i}` },
    { ...meta, feed_id: '' },
  ]) assert.equal(validateFrameMetadata(bad).ok, false);
}
for (let i = 0; i < 10; i++) {
  assert.equal(validateFrameMetadata({ ...meta, captured_at: null, capture_time_status: 'unknown', scenario_time_ms: null }).ok, true);
}
assert.equal(validateFrameMetadata({ ...meta, temperatureC: 42 }).ok, false, 'non-radiometric metadata never accepts Celsius');
assert.equal(validateFrameMetadata({ ...meta, radiometric: true }).ok, false);
assert.equal(validateFrameMetadata({ ...meta, captured_at: null }).ok, false);
assert.equal(validateFrameMetadata({ ...meta, received_at: 'invalid' }).ok, false);
assert.equal(frameStatus(meta, { simTime: pack.manifest.start + 3001, nowMs: 10, connected: true }), 'stale');
assert.equal(frameStatus(meta, { simTime: pack.manifest.start - 1, nowMs: 10, connected: true }), 'stale');
assert.equal(frameStatus(meta, { simTime: pack.manifest.start, nowMs: 3011, connected: true }), 'stale');
assert.equal(frameStatus(meta, { simTime: pack.manifest.start, nowMs: 10, connected: false }), 'unavailable');
assert.equal(frameStatus(null, { simTime: 0, nowMs: 0, connected: true }), 'unavailable');
console.log('TH02/03: 100 invalid records rejected, 10 explicit-unknown records accepted; stale/future/disconnect states PASS');

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
const canvas = { width: 2, height: 1, toBlob: (done: BlobCallback) => done(new Blob([png], { type: 'image/png' })) } as HTMLCanvasElement;
const channel = rt.sim.feeds.find(f => f.modality === 'thermal')!;
const stamped = renderedFrame({ ...channel, fx: 'eo' }, canvas, pack.manifest.start, 10)!;
const fractional = renderedFrame(channel, canvas, pack.manifest.start + 0.75, 10)!;
assert.equal(frameStatus(fractional, { simTime: pack.manifest.start + 0.75, nowMs: 10, connected: true }), 'available', 'millisecond serialization cannot round a just-copied frame into the future');
assert.equal(stamped.modality, 'thermal', 'EO display transform never changes source channel modality');
assert.equal(stamped.display_transform, 'eo');
assert.equal(stamped.received_at, null);
assert.ok(Object.isFrozen(stamped));
assert.equal(renderedFrame({ ...channel, live: false }, canvas, pack.manifest.start, 11), undefined);
assert.equal(renderedFrame({ ...channel, modality: undefined }, canvas, pack.manifest.start, 11), undefined);
assert.equal(renderedFrame(channel, canvas, pack.manifest.start, 12)!.source_revision, fractional.source_revision + 1);
for (let i = 0; i < 20; i++) {
  const captured = await captureFrame(canvas, { ...meta, frame_id: `frame-${i}`, evidence_id: `evidence-${i}` });
  assert.equal(captured.metadata.frame_id, `frame-${i}`);
  assert.equal(captured.metadata.received_at, null, 'local capture is not backend receipt');
  assert.equal(captured.metadata.modality, 'thermal');
  assert.deepEqual(new Uint8Array(await captured.pixels.arrayBuffer()), png, 'preserve encoded original bytes');
  assert.match(captured.content_hash, /^sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(captured), /findingIds|truePos|objects|classes|confidence|temperature|arrival|detections/);
}
await assert.rejects(captureFrame(canvas, { ...meta, findingIds: ['planted-answer'] } as FrameMetadata), /metadata/i);
await assert.rejects(captureFrame({ ...canvas, dataset: { truthOverlay: 'true' } } as unknown as HTMLCanvasElement, meta), /truth/i);
await assert.rejects(captureFrame({ ...canvas, width: 3 } as HTMLCanvasElement, meta), /dimension/i);
await assert.rejects(captureFrame({ ...canvas, toBlob: (done: BlobCallback) => done(null) } as HTMLCanvasElement, meta), /encode/i);
let release: BlobCallback = () => {};
const slow = { ...canvas, toBlob: (done: BlobCallback) => { release = done; } } as HTMLCanvasElement;
const pending = captureFrame(slow, meta);
await assert.rejects(captureFrame(slow, meta), /progress/i);
release(new Blob([png], { type: 'image/png' })); await pending;
const realTimeout = globalThis.setTimeout;
try {
  globalThis.setTimeout = ((fn: TimerHandler) => { queueMicrotask(() => { if (typeof fn === 'function') fn(); }); return 0; }) as typeof setTimeout;
  await assert.rejects(captureFrame(slow, meta), /timed out/i);
  await assert.rejects(captureFrame(slow, meta), /progress/i, 'ambiguous timeout keeps the physical encode slot reserved');
} finally { globalThis.setTimeout = realTimeout; }
release(new Blob([png], { type: 'image/png' }));
await captureFrame(canvas, meta);
console.log('TH03/04: 20 bounded opt-in captures preserve identity/hash/pixels, no truth fields, concurrent capture rejected PASS');
