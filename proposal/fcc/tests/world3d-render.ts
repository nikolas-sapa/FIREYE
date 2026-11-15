import assert from 'node:assert/strict';
import { HeightField } from '../src/console/world3d/frame';
import type { WorkerRequest, WorkerResponse } from '../src/console/world3d/gen/worker';
import { createWorldMaterials, createWorldUniforms } from '../src/console/world3d/render/materials';
import { TileStore, TILE_CACHE_CAP } from '../src/console/world3d/render/store';
import { WorldView } from '../src/console/world3d/render/view';
import { disposeArchetypeGeometry } from '../src/console/world3d/render/geometry';
import { Flag, TruthClass, type TileData, type WorldSource } from '../src/console/world3d/types';

class TestWorker {
  static latest: TestWorker;
  messages: WorkerRequest[] = [];
  onmessage: ((e: { data: WorkerResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor() { TestWorker.latest = this; }
  postMessage(m: WorkerRequest) { this.messages.push(m); }
  terminate() { this.terminated = true; }
  reply(data: WorkerResponse) { this.onmessage?.({ data }); }
}

function tile(tx: number, tz: number): TileData {
  const matrix = new Float32Array(16);
  matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;
  matrix[11] = TruthClass.Structure; matrix[12] = tx * 256; matrix[13] = 10; matrix[14] = tz * 256;
  return { key: `${tx}/${tz}/far`, tx, tz, detail: 'far', minY: 10, maxY: 30, ms: 1, roads: null,
    terrain: { position: new Float32Array([tx * 256, 10, tz * 256, tx * 256 + 256, 10, tz * 256, tx * 256, 10, tz * 256 + 256]),
      color: new Float32Array(9).fill(0.5), meta: new Float32Array([0, Flag.GroundBare, 0, Flag.GroundBare, 0, Flag.GroundBare]),
      params: new Float32Array(12), index: new Uint32Array([0, 2, 1]) },
    groups: [{ archetype: 'house-flat', count: 1, matrices: matrix, colors: new Float32Array([1, 1, 1]), params: new Float32Array(4), firstId: 0 }],
    objectCount: 1, spawns: { homes: new Float32Array(0), nodes: new Float32Array(0), pasture: new Float32Array(0) } };
}

export function checkWorld3dRendering() {
  const original = globalThis.Worker;
  globalThis.Worker = TestWorker as unknown as typeof Worker;
  const materials = createWorldMaterials(createWorldUniforms());
  const source: WorldSource = { grid: { w: 8, h: 8, center: { lon: 24, lat: 38 }, bbox: [24, 38, 24.008, 38.008],
    elevation: new Float32Array(64).fill(10), fuel: new Uint8Array(64).fill(5), clc: null }, roads: [], buildings: [], sites: [] };
  const stores: TileStore[] = [];
  const make = () => {
    const store = new TileStore(source, undefined, materials), worker = TestWorker.latest;
    worker.reply({ type: 'ready', far: { chunks: [], tilesX: 3, tilesZ: 4, xMin: 0, zMin: 0 }, imagery: false, ms: 0 });
    stores.push(store);
    return { store, worker };
  };
  const load = (store: TileStore, worker: TestWorker, tx: number, tz: number) => {
    store.want(tx, tz, 'far', 0); store.dispatch();
    const request = worker.messages.filter((m): m is Extract<WorkerRequest, { type: 'tile' }> => m.type === 'tile').at(-1)!;
    worker.reply({ type: 'tile', id: request.id, tile: tile(tx, tz) });
    store.upload(1);
  };
  try {
    const { store, worker } = make();
    for (let i = 0; i < TILE_CACHE_CAP; i++) load(store, worker, i, 0);
    store.pin(Array.from({ length: TILE_CACHE_CAP }, (_, i) => `${i}/0/far`));
    load(store, worker, TILE_CACHE_CAP, 0);
    assert.equal(store.size, TILE_CACHE_CAP, 'all displayed tiles are pinned and the cache never exceeds its cap');
    assert.equal(store.get(`${TILE_CACHE_CAP}/0/far`), undefined, 'arrived work waits rather than disposing a displayed tile');
    store.pin(Array.from({ length: TILE_CACHE_CAP - 1 }, (_, i) => `${i + 1}/0/far`));
    store.upload(1);
    assert.equal(store.size, TILE_CACHE_CAP);
    assert.equal(store.get('0/0/far'), undefined);
    assert.ok(store.get(`${TILE_CACHE_CAP}/0/far`), 'releasing a pin allows bounded replacement');
    store.beginFrame(); store.want(100, 0, 'far', 0);
    store.beginFrame(); store.want(101, 0, 'far', 0); store.dispatch();
    assert.ok(!worker.messages.some(m => m.type === 'tile' && m.tx === 100), 'obsolete queued work is not submitted');
    const count = store.size;
    store.dispose();
    worker.reply({ type: 'tile', id: 123, tile: tile(123, 0) });
    assert.equal(store.size, 0); assert.ok(count > 0 && worker.terminated, 'teardown ignores late worker messages');

    const stale = make();
    stale.store.want(0, 0, 'far', 0); stale.store.dispatch();
    const request = stale.worker.messages.at(-1)! as Extract<WorkerRequest, { type: 'tile' }>;
    stale.store.beginFrame(); stale.store.beginFrame(); stale.store.beginFrame();
    stale.worker.reply({ type: 'tile', id: request.id, tile: tile(0, 0) });
    assert.equal(stale.store.pending, 0, 'obsolete in-flight arrivals are discarded');
    stale.store.want(1, 0, 'far', 0); stale.store.dispatch();
    const renewed = stale.worker.messages.at(-1)! as Extract<WorkerRequest, { type: 'tile' }>;
    for (let i = 0; i < 4; i++) { stale.store.beginFrame(); stale.store.want(1, 0, 'far', 0); }
    stale.worker.reply({ type: 'tile', id: renewed.id, tile: tile(1, 0) });
    assert.equal(stale.store.upload(1), 1, 'still-needed work remains valid across slow worker replies');
    const failed = make();
    failed.worker.onerror?.();
    const sent = failed.worker.messages.length;
    failed.store.want(0, 0, 'far', 0); failed.store.dispatch();
    assert.ok(failed.store.failed);
    assert.equal(failed.worker.messages.length, sent, 'a failed worker receives no more requests');

    const next = make(), hf = new HeightField(source.grid), f = hf.frame;
    for (let z = 0; z < f.tilesZ; z++) for (let x = 0; x < f.tilesX; x++) load(next.store, next.worker, x, z);
    const view = new WorldView('test', hf);
    const [x, z] = f.tileOrigin(1, 1);
    view.camera.position.set(x + 128, 180, z + 128);
    view.camera.lookAt(x + 128, 10, z - 200);
    view.select(next.store, 540, false, 2);
    assert.equal(view.tiles.length, 0); assert.ok(view.mask.every(v => v === 0), 'selection cannot mask context before batches exist');
    assert.ok(view.rebuild(materials, 0, true));
    const before = view.tiles.map(t => t.entry.key), mask = view.mask.slice(), oldTiles = [...view.tiles];
    view.show(true);
    view.camera.lookAt(x + 128, 10, z + 500);
    view.select(next.store, 540, false, 2);
    assert.deepEqual(view.tiles.map(t => t.entry.key), before);
    assert.deepEqual(view.mask, mask, 'previous terrain, objects and mask stay committed together');
    assert.equal(view.rebuild(materials, 100), false, 'rate-limited rebuild keeps the coherent previous view');
    assert.ok(view.rebuild(materials, 400));
    assert.notDeepEqual(view.tiles.map(t => t.entry.key), before);
    for (const t of oldTiles) assert.equal(t.entry.terrain.visible, false, 'replaced terrain is hidden on commit');
    for (const t of view.tiles) assert.equal(view.mask[t.entry.data.tz * f.tilesX + t.entry.data.tx], 255);
    const rev = view.revision;
    view.select(next.store, 540, false, 2); assert.equal(view.rebuild(materials, 800), false);
    assert.equal(view.revision, rev, 'unchanged camera/detail does not reupload instance buffers');
    assert.ok(view.bytes() > 0);
    view.dispose(); assert.equal(view.tiles.length, 0); assert.ok(view.mask.every(v => v === 0)); assert.equal(view.bytes(), 0);
    console.log('World3D rendering: atomic detail/mask commits, pinned 64-tile cache, stale work, stable uploads and teardown PASS');
  } finally {
    for (const store of stores) store.dispose();
    materials.dispose(); disposeArchetypeGeometry(); globalThis.Worker = original;
  }
}
