import * as THREE from 'three';
import type { WorkerRequest, WorkerResponse } from '../gen/worker';
import type { Detail, FarTerrain, TileData, WorldSource } from '../types';
import type { WorldMaterialSet } from './materials';
import { toGeometry, triangles } from './geometry';

export const TILE_CACHE_CAP = 64;

export interface TileEntry {
  key: string;
  data: TileData;
  terrain: THREE.Mesh;
  roads: THREE.Mesh | null;
  terrainTris: number;
  roadTris: number;
  bytes: number;
  used: number;
}

interface Request { key: string; tx: number; tz: number; detail: Detail; priority: number; frame: number }

/** Owns the generator worker, the request queue and a capped LRU of generated tiles (CPU arrays + GPU meshes). */
export class TileStore {
  readonly group = new THREE.Group();
  readonly farGroup = new THREE.Group();
  private worker: Worker;
  private entries = new Map<string, TileEntry>();
  private wanted = new Map<string, Request>();
  private inflight = new Map<number, Request>();
  private arrived: TileData[] = [];
  private nextId = 1;
  private frame = 0;
  private dead = false;
  private pinned = new Set<string>();
  private demand = new Set<string>();
  revision = 0;
  farBytes = 0;
  uploadMs = 0;
  ready = false;
  failed = false;
  imagery = false;
  genMs: number[] = [];
  initMs = 0;
  onChange: (() => void) | null = null;
  onTile: ((entry: TileEntry) => void) | null = null;
  onEvict: ((entry: TileEntry) => void) | null = null;

  constructor(source: WorldSource, imagery: { url: string; bbox: [number, number, number, number] } | undefined, private materials: WorldMaterialSet) {
    this.group.name = 'tiles'; this.farGroup.name = 'far';
    this.worker = new Worker(new URL('../gen/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.receive(e.data);
    this.worker.onerror = this.worker.onmessageerror = () => { this.failed = true; this.onChange?.(); };
    const msg: WorkerRequest = { type: 'init', source, imagery: imagery ? { ...imagery, maxWidth: 2048 } : undefined };
    this.worker.postMessage(msg);
  }

  private receive(msg: WorkerResponse) {
    if (this.dead) return;
    if (msg.type === 'ready') { this.buildFar(msg.far); this.ready = true; this.imagery = msg.imagery; this.initMs = msg.ms; this.onChange?.(); this.dispatch(); return; }
    if (msg.type === 'error') { this.failed = true; this.onChange?.(); return; }
    const req = this.inflight.get(msg.id);
    this.inflight.delete(msg.id);
    if (req) {
      if (this.frame - req.frame <= 1) this.arrived.push(msg.tile);
      this.genMs.push(msg.tile.ms); if (this.genMs.length > 64) this.genMs.shift();
    }
    this.dispatch();
    this.onChange?.();
  }

  private farChunks: { fine: THREE.Mesh; coarse: THREE.Mesh; bounds: [number, number, number, number] }[] = [];
  private buildFar(far: FarTerrain) {
    const mat = this.materials.get('far');
    const make = (m: FarTerrain['chunks'][number]['mesh']) => {
      this.farBytes += meshBytes(m) + m.position.byteLength;
      const mesh = new THREE.Mesh(toGeometry(m), mat);
      // Distant crown impostors rotate around their centres by up to twelve metres.
      mesh.geometry.boundingSphere!.radius += 12;
      mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = -2;
      mesh.userData.tris = triangles(mesh.geometry);
      this.farGroup.add(mesh);
      return mesh;
    };
    for (const c of far.chunks) this.farChunks.push({ fine: make(c.mesh), coarse: make(c.coarse), bounds: c.bounds });
    for (const m of far.context ?? []) make(m);
  }

  /** Per-camera far-terrain LOD: full 40 m chunks nearby, the coarse skirted mesh beyond `fineM`. */
  farLod(x: number, z: number, fineM: number) {
    for (const c of this.farChunks) {
      const [x0, z0, x1, z1] = c.bounds;
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      const fine = dx * dx + dz * dz < fineM * fineM;
      c.fine.visible = fine; c.coarse.visible = !fine;
    }
  }

  /** Called by views each selection pass; lower priority value = sooner. */
  want(tx: number, tz: number, detail: Detail, priority: number) {
    const key = `${tx}/${tz}/${detail}`;
    this.demand.add(key);
    const e = this.entries.get(key);
    if (e) { e.used = this.frame; return; }
    const running = [...this.inflight.values()].find(i => i.key === key);
    if (running) { running.frame = this.frame; return; }
    if (this.arrived.some(t => t.key === key)) return;
    const w = this.wanted.get(key);
    if (w && w.frame === this.frame) w.priority = Math.min(w.priority, priority);
    else if ([...this.inflight.values()].every(i => i.key !== key)) this.wanted.set(key, { key, tx, tz, detail, priority, frame: this.frame });
  }
  touch(key: string) { const e = this.entries.get(key); if (e) e.used = this.frame; return e; }
  get(key: string) { return this.entries.get(key); }
  get size() { return this.entries.size; }
  get pending() { return this.wanted.size + this.inflight.size + this.arrived.length; }

  beginFrame() { this.frame++; this.demand.clear(); }
  pin(keys: Iterable<string>) { this.pinned = new Set(keys); }

  /** Drop stale wishes and keep the generator busy with the closest needed tile. */
  dispatch() {
    if (!this.ready || this.failed || this.dead) return;
    for (const [k, w] of this.wanted) if (w.frame !== this.frame || this.entries.has(k)) this.wanted.delete(k);
    while (this.inflight.size < 2 && this.arrived.length < 4 && this.wanted.size) {
      let best: Request | null = null;
      for (const w of this.wanted.values()) if ([...this.inflight.values()].every(i => i.key !== w.key) && (!best || w.priority < best.priority)) best = w;
      if (!best) break;
      this.wanted.delete(best.key);
      const id = this.nextId++;
      this.inflight.set(id, best);
      const msg: WorkerRequest = { type: 'tile', id, tx: best.tx, tz: best.tz, detail: best.detail };
      this.worker.postMessage(msg);
    }
  }

  /** Bounded CPU preparation. One indivisible tile may exceed the time slice. */
  upload(budget = 2, budgetMs = 4) {
    const start = performance.now();
    let n = 0;
    this.arrived = this.arrived.filter(t => this.demand.has(t.key));
    while (this.arrived.length && n < budget && (n === 0 || performance.now() - start < budgetMs)) {
      if (this.entries.size >= TILE_CACHE_CAP && !this.evictOne()) break;
      const data = this.arrived.shift()!;
      if (this.entries.has(data.key)) continue;
      const terrain = new THREE.Mesh(toGeometry(data.terrain), this.materials.get('terrain'));
      terrain.receiveShadow = true; terrain.matrixAutoUpdate = false; terrain.visible = false;
      const roads = data.roads ? new THREE.Mesh(toGeometry(data.roads), this.materials.get('road')) : null;
      if (roads) { roads.receiveShadow = true; roads.matrixAutoUpdate = false; roads.visible = false; }
      let bytes = 0;
      const add = (a: ArrayBufferView | undefined) => { bytes += a?.byteLength ?? 0; };
      for (const m of [data.terrain, data.roads]) if (m) { add(m.position); add(m.color); add(m.meta); add(m.params); add(m.index); bytes += m.position.byteLength; }
      for (const g of data.groups) { add(g.matrices); add(g.colors); add(g.params); }
      for (const a of Object.values(data.spawns)) add(a);
      const entry: TileEntry = { key: data.key, data, terrain, roads, terrainTris: triangles(terrain.geometry), roadTris: roads ? triangles(roads.geometry) : 0, bytes, used: this.frame };
      this.entries.set(data.key, entry);
      this.group.add(terrain); if (roads) this.group.add(roads);
      this.onTile?.(entry);
      this.revision++;
      n++;
    }
    this.uploadMs = performance.now() - start;
    return n;
  }

  private evictOne() {
    const e = [...this.entries.values()].filter(e => !this.pinned.has(e.key)).sort((a, b) => a.used - b.used)[0];
    if (e) {
      this.entries.delete(e.key);
      this.group.remove(e.terrain); e.terrain.geometry.dispose();
      if (e.roads) { this.group.remove(e.roads); e.roads.geometry.dispose(); }
      this.onEvict?.(e);
      this.revision++;
    }
    return !!e;
  }

  bytes() { let b = 0; for (const e of this.entries.values()) b += e.bytes; return b; }

  dispose() {
    this.dead = true;
    this.worker.terminate();
    for (const e of this.entries.values()) { e.terrain.geometry.dispose(); e.roads?.geometry.dispose(); }
    for (const m of this.farGroup.children) (m as THREE.Mesh).geometry.dispose();
    this.entries.clear(); this.wanted.clear(); this.inflight.clear(); this.arrived = [];
    this.pinned.clear(); this.group.clear(); this.farGroup.clear();
  }
}

function meshBytes(m: FarTerrain['chunks'][number]['mesh']) {
  return m.position.byteLength + m.color.byteLength + m.meta.byteLength + m.params.byteLength + (m.index?.byteLength ?? 0);
}
