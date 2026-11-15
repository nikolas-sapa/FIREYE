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
    this.worker.onerror = () => { this.failed = true; this.onChange?.(); };
    const msg: WorkerRequest = { type: 'init', source, imagery: imagery ? { ...imagery, maxWidth: 2048 } : undefined };
    this.worker.postMessage(msg);
  }

  private receive(msg: WorkerResponse) {
    if (msg.type === 'ready') { this.buildFar(msg.far); this.ready = true; this.imagery = msg.imagery; this.initMs = msg.ms; this.onChange?.(); this.dispatch(); return; }
    if (msg.type === 'error') { if (msg.id === undefined) this.failed = true; else this.inflight.delete(msg.id); this.onChange?.(); this.dispatch(); return; }
    const req = this.inflight.get(msg.id);
    this.inflight.delete(msg.id);
    if (req) { this.arrived.push(msg.tile); this.genMs.push(msg.tile.ms); if (this.genMs.length > 64) this.genMs.shift(); }
    this.dispatch();
    this.onChange?.();
  }

  private farChunks: { fine: THREE.Mesh; coarse: THREE.Mesh; bounds: [number, number, number, number] }[] = [];
  private buildFar(far: FarTerrain) {
    const mat = this.materials.get('far');
    const make = (m: FarTerrain['chunks'][number]['mesh']) => {
      const mesh = new THREE.Mesh(toGeometry(m), mat);
      mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.renderOrder = -2;
      mesh.userData.tris = triangles(mesh.geometry);
      this.farGroup.add(mesh);
      return mesh;
    };
    for (const c of far.chunks) this.farChunks.push({ fine: make(c.mesh), coarse: make(c.coarse), bounds: c.bounds });
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
    const e = this.entries.get(key);
    if (e) { e.used = this.frame; return; }
    const w = this.wanted.get(key);
    if (w && w.frame === this.frame) w.priority = Math.min(w.priority, priority);
    else if ([...this.inflight.values()].every(i => i.key !== key)) this.wanted.set(key, { key, tx, tz, detail, priority, frame: this.frame });
  }
  touch(key: string) { const e = this.entries.get(key); if (e) e.used = this.frame; return e; }
  get(key: string) { return this.entries.get(key); }
  get size() { return this.entries.size; }
  get pending() { return this.wanted.size + this.inflight.size + this.arrived.length; }

  beginFrame() { this.frame++; }

  /** Drop stale wishes and keep the generator busy with the closest needed tile. */
  dispatch() {
    if (!this.ready || this.failed) return;
    for (const [k, w] of this.wanted) if (this.frame - w.frame > 30 || this.entries.has(k)) this.wanted.delete(k);
    while (this.inflight.size < 2 && this.wanted.size) {
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

  /** Turn at most `budget` arrived tiles into GPU meshes this frame. */
  upload(budget = 2) {
    let n = 0;
    while (this.arrived.length && n < budget) {
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
      const entry: TileEntry = { key: data.key, data, terrain, roads, terrainTris: triangles(terrain.geometry), roadTris: roads ? triangles(roads.geometry) : 0, bytes, used: this.frame };
      this.entries.set(data.key, entry);
      this.group.add(terrain); if (roads) this.group.add(roads);
      this.onTile?.(entry);
      n++;
    }
    this.evict();
    return n;
  }

  private evict() {
    if (this.entries.size <= TILE_CACHE_CAP) return;
    const victims = [...this.entries.values()].filter(e => e.used < this.frame - 1).sort((a, b) => a.used - b.used);
    for (const e of victims) {
      if (this.entries.size <= TILE_CACHE_CAP) break;
      this.entries.delete(e.key);
      this.group.remove(e.terrain); e.terrain.geometry.dispose();
      if (e.roads) { this.group.remove(e.roads); e.roads.geometry.dispose(); }
      this.onEvict?.(e);
    }
  }

  bytes() { let b = 0; for (const e of this.entries.values()) b += e.bytes; return b; }

  dispose() {
    this.worker.terminate();
    for (const e of this.entries.values()) { e.terrain.geometry.dispose(); e.roads?.geometry.dispose(); }
    for (const m of this.farGroup.children) (m as THREE.Mesh).geometry.dispose();
    this.entries.clear(); this.wanted.clear(); this.inflight.clear(); this.arrived = [];
  }
}
