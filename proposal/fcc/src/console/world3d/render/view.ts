import * as THREE from 'three';
import { ARCHETYPE, lodForTier, type Archetype } from '../catalog';
import { TILE_M, type HeightField } from '../frame';
import { TruthClass, type Detail, type InstanceGroup } from '../types';
import type { WorldMaterialSet } from './materials';
import { geometryFor, triangles } from './geometry';
import type { TileEntry, TileStore } from './store';

export interface ViewTile { entry: TileEntry; tier: number; d: number }
export interface ObjectRef { start: number; count: number; tileKey: string; archetype: string; group: InstanceGroup; indices?: Uint32Array }
interface Batch { mesh: THREE.InstancedMesh; capacity: number; archetype: Archetype; lod: number; tris: number }

const MAX_TILES = 40;
const box = new THREE.Box3(), frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), v = new THREE.Vector3();

/** One camera's view of the shared world: tile selection, LOD tiers and per-archetype instanced batches. */
export class WorldView {
  readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.5, 40000);
  readonly group = new THREE.Group();
  readonly mask: Uint8Array;
  tiles: ViewTile[] = [];
  objects: ObjectRef[] = [];
  objectCount = 0;
  settled = false;
  air = false;
  focus = new THREE.Vector3();
  private batches = new Map<string, Batch>();
  private signature = '';
  private built = '';
  private builtAt = -Infinity;
  private staged: ViewTile[] = [];
  private stagedFar = 1e6;
  private selection = '';
  private requests: { tx: number; tz: number; detail: Detail; priority: number }[] = [];
  private tiers = new Map<number, { tier: number; detail: Detail }>();
  revision = 0;
  rebuildMs = 0;
  tris = 0;
  draws = 0;

  constructor(readonly id: string, private hf: HeightField) {
    this.mask = new Uint8Array(hf.frame.tilesX * hf.frame.tilesZ);
    this.group.name = `view-${id}`;
    this.group.matrixAutoUpdate = false;
  }

  /** Request and pick tiles for the current camera. Cheap; runs every renderer step for visible views. */
  select(store: TileStore, viewH: number, thin: boolean, quota = MAX_TILES) {
    const cam = this.camera, f = this.hf.frame;
    const p = cam.position, q = cam.quaternion;
    const selection = `${Math.round(p.x / 2)},${Math.round(p.y / 2)},${Math.round(p.z / 2)},${Math.round(q.x * 2000)},${Math.round(q.y * 2000)},${Math.round(q.z * 2000)},${Math.round(q.w * 2000)},${cam.fov},${viewH},${thin},${quota},${store.revision}`;
    if (selection === this.selection) {
      for (const r of this.requests) store.want(r.tx, r.tz, r.detail, r.priority);
      return;
    }
    this.selection = selection; this.requests = [];
    cam.updateMatrixWorld();
    pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    const ground = this.hf.height(p.x, p.z), agl = p.y - ground;
    this.air = agl > (this.air ? 110 : 130);
    const R = this.air ? Math.min(3200, agl * 2.4 + 700) : 1500;
    const k = viewH / (2 * Math.tan(cam.fov * Math.PI / 360));
    const [t0x, t0z] = f.tileOf(p.x - R, p.z - R), [t1x, t1z] = f.tileOf(p.x + R, p.z + R);
    const candidates: { tx: number; tz: number; tier: number; d: number; detail: Detail }[] = [];
    for (let tz = Math.max(0, t0z); tz <= Math.min(f.tilesZ - 1, t1z); tz++) for (let tx = Math.max(0, t0x); tx <= Math.min(f.tilesX - 1, t1x); tx++) {
      const [x0, z0] = f.tileOrigin(tx, tz);
      const near = store.get(`${tx}/${tz}/near`), far = store.get(`${tx}/${tz}/far`), any = near ?? far;
      // Unloaded tiles use a sampled height range; a generous default box makes tiles look visible until they load, which thrashes the cache.
      const [y0, y1] = any ? [any.data.minY, any.data.maxY] : this.range(tx, tz);
      box.min.set(x0, y0 - 1, z0); box.max.set(x0 + TILE_M, y1, z0 + TILE_M);
      const d = box.distanceToPoint(p);
      if (d > R) continue;
      if (d > 0 && !frustum.intersectsBox(box)) continue;
      const ppm = k / Math.max(1, d);
      const prev = this.tiers.get(tz * f.tilesX + tx);
      const tier = ppm > (prev?.tier === 0 ? 7 : 9) ? 0 : ppm > (prev && prev.tier < 2 ? 1.05 : 1.35) ? 1 : 2;
      const detail: Detail = (tier === 0 || d < 60) && d < (prev?.detail === 'near' ? 185 : 145) && !this.air ? 'near' : 'far';
      candidates.push({ tx, tz, tier, d, detail });
    }
    // The quota keeps the union of all views' tiles inside the shared LRU cap, so views never evict each other's tiles.
    candidates.sort((a, b) => a.d - b.d);
    const picked: ViewTile[] = [];
    const tiers = new Map<number, { tier: number; detail: Detail }>();
    let missing = 0;
    // A near tile also keeps its far fallback cached, so it costs two cache slots.
    let cost = 0, taken = 0;
    for (const c of candidates) {
      const slots = c.detail === 'near' ? 2 : 1;
      if (taken >= MAX_TILES || cost + slots > quota) break;
      cost += slots; taken++;
      const near = store.get(`${c.tx}/${c.tz}/near`), far = store.get(`${c.tx}/${c.tz}/far`);
      const wanted = c.detail === 'near' ? near : far;
      // Rank-first priority: every camera gets its closest tiles before any camera gets distant ones.
      store.want(c.tx, c.tz, c.detail, taken * 1e5 + c.d);
      this.requests.push({ tx: c.tx, tz: c.tz, detail: c.detail, priority: taken * 1e5 + c.d });
      tiers.set(c.tz * f.tilesX + c.tx, c);
      const use = wanted ?? near ?? far;
      if (!wanted) missing++;
      if (use) { store.touch(use.key); picked.push({ entry: use, tier: c.tier, d: c.d }); }
    }
    this.tiers = tiers;
    this.staged = picked;
    const beyond = candidates[taken];
    this.stagedFar = Math.max(120, beyond ? beyond.d : R);
    this.settled = missing === 0 && store.ready;
    this.thin = thin;
    // Near-tile instances switch LOD by their own distance, so the camera's coarse position is part of the signature.
    this.lodRadius = 65 * viewH / 540;
    const cell = picked.some(t => t.tier === 0) ? `${Math.round(p.x / 40)},${Math.round(p.z / 40)},${Math.round(this.lodRadius)}` : '';
    this.signature = picked.map(t => `${t.entry.key}:${t.tier}`).sort().join('|') + (thin ? 't' : '') + cell;
    // Ground focus for shadows and agents: where the optical axis meets the terrain (bounded).
    cam.getWorldDirection(v);
    let dist = 40;
    for (let s = 10; s < 1200; s *= 1.25) { const x = p.x + v.x * s, y = p.y + v.y * s, z = p.z + v.z * s; if (y <= this.hf.height(x, z)) { dist = s; break; } dist = s; }
    this.focus.set(p.x + v.x * dist, 0, p.z + v.z * dist);
    this.focus.y = this.hf.height(this.focus.x, this.focus.z);
  }
  private thin = false;
  private static ranges = new WeakMap<HeightField, Map<number, [number, number]>>();
  private range(tx: number, tz: number): [number, number] {
    let cache = WorldView.ranges.get(this.hf);
    if (!cache) WorldView.ranges.set(this.hf, cache = new Map());
    const key = tz * this.hf.frame.tilesX + tx;
    let r = cache.get(key);
    if (!r) {
      const [x0, z0] = this.hf.frame.tileOrigin(tx, tz);
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) { const y = this.hf.height(x0 + i * 32, z0 + j * 32); lo = Math.min(lo, y); hi = Math.max(hi, y); }
      r = [lo - 4, hi + 18];
      cache.set(key, r);
    }
    return r;
  }
  private lodRadius = 90;
  objFar = 1e6;

  get dirty() { return this.signature !== this.built; }

  /** Rebuild instanced batches when the tile set or tiers changed (rate-limited by the caller). */
  rebuild(materials: WorldMaterialSet, now: number, force = false) {
    if (!this.dirty || (!force && now - this.builtAt < 280)) return false;
    if (!this.staged.length && this.tiles.length) return false;
    const start = performance.now();
    type Part = { g: InstanceGroup; n: number; tileKey: string; idx?: Uint32Array };
    const plan = new Map<string, { a: Archetype; lod: number; parts: Part[]; total: number }>();
    const put = (a: Archetype, lod: number, part: Part) => {
      const key = `${a.id}/${lod}`;
      let p = plan.get(key);
      if (!p) plan.set(key, p = { a, lod, parts: [], total: 0 });
      p.parts.push(part); p.total += part.n;
    };
    const cam = this.camera.position, r2 = this.lodRadius * this.lodRadius;
    for (const t of this.staged) for (const g of t.entry.data.groups) {
      const a = ARCHETYPE.get(g.archetype);
      if (!a || a.maxTier < t.tier) continue;
      if (a.kind === 'grass' && a.maxTier === 0) {
        // Thousands of sub-pixel blades elsewhere in a near tile do not contribute to coverage.
        // Keep every clump in the foreground, not an arbitrary fraction across the whole tile.
        const radius = this.thin ? 40 : 95, indices: number[] = [], M = g.matrices;
        for (let i = 0; i < g.count; i++) {
          const dx = M[i * 16 + 12] - cam.x, dz = M[i * 16 + 14] - cam.z;
          if (dx * dx + dz * dz < radius * radius) indices.push(i);
        }
        if (indices.length) put(a, 0, { g, n: indices.length, tileKey: t.entry.key, idx: Uint32Array.from(indices) });
        continue;
      }
      if (t.tier === 0 && a.lodCount > 1) {
        // Full geometry only near the camera; the rest of a near tile uses the next LOD.
        const near: number[] = [], far: number[] = [], M = g.matrices;
        for (let i = 0; i < g.count; i++) {
          const dx = M[i * 16 + 12] - cam.x, dz = M[i * 16 + 14] - cam.z;
          (dx * dx + dz * dz < r2 ? near : far).push(i);
        }
        if (near.length) put(a, 0, { g, n: near.length, tileKey: t.entry.key, idx: Uint32Array.from(near) });
        if (far.length) put(a, lodForTier(a, 1), { g, n: far.length, tileKey: t.entry.key, idx: Uint32Array.from(far) });
        continue;
      }
      // Keep canopy coverage on the wall: simplify the mesh rather than deleting 40% of the plants.
      const tier = this.thin && a.kind === 'veg' && a.lodCount > 2 ? Math.max(2, t.tier) : t.tier;
      put(a, lodForTier(a, tier), { g, n: g.count, tileKey: t.entry.key });
    }
    for (const [key, b] of this.batches) if (!plan.has(key)) { this.group.remove(b.mesh); b.mesh.dispose(); this.batches.delete(key); }
    const objects: ObjectRef[] = [];
    let nextId = 0;
    this.tris = 0;
    for (const t of this.staged) this.tris += t.entry.terrainTris + t.entry.roadTris;
    for (const [key, p] of plan) {
      let b = this.batches.get(key);
      if (!b || b.capacity < p.total) {
        if (b) { this.group.remove(b.mesh); b.mesh.dispose(); }
        const capacity = Math.max(16, 1 << Math.ceil(Math.log2(p.total * 1.15)));
        const kind = p.a.kind;
        const mesh = new THREE.InstancedMesh(geometryFor(p.a.id, p.lod), materials.get(kind), capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
        // Only full-detail batches cast: they are the ones inside the shadow camera, and the shadow pass is not culled per instance.
        const geo = mesh.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        // Ankle-high clutter is skipped too: its shadows are sub-pixel but each caster costs a draw.
        const silhouette = p.a.cls === TruthClass.Tree || p.a.cls === TruthClass.Structure || p.a.cls === TruthClass.Vehicle;
        mesh.userData.shadowCandidate = p.a.shadow && silhouette && p.lod === 0 && geo.boundingBox!.max.y > 0.7;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = materials.depth(kind);
        mesh.userData.archetype = p.a.id;
        this.group.add(mesh);
        b = { mesh, capacity, archetype: p.a, lod: p.lod, tris: triangles(mesh.geometry) };
        this.batches.set(key, b);
      }
      const M = b.mesh.instanceMatrix.array as Float32Array, C = b.mesh.instanceColor!.array as Float32Array;
      let o = 0;
      for (const part of p.parts) {
        if (part.idx) {
          const gm = part.g.matrices, gc = part.g.colors;
          for (let i = 0; i < part.n; i++) {
            const k = part.idx[i];
            M.set(gm.subarray(k * 16, k * 16 + 16), (o + i) * 16);
            C.set(gc.subarray(k * 3, k * 3 + 3), (o + i) * 3);
          }
        } else {
          M.set(part.g.matrices.subarray(0, part.n * 16), o * 16);
          C.set(part.g.colors.subarray(0, part.n * 3), o * 3);
        }
        if (part.g.firstId >= 0) {
          objects.push({ start: nextId, count: part.n, tileKey: part.tileKey, archetype: p.a.id, group: part.g, indices: part.idx });
          for (let i = 0; i < part.n; i++) M[(o + i) * 16 + 15] = nextId + i;
          nextId += part.n;
        }
        o += part.n;
      }
      b.mesh.count = p.total;
      b.mesh.instanceMatrix.clearUpdateRanges(); b.mesh.instanceMatrix.addUpdateRange(0, p.total * 16); b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.instanceColor!.clearUpdateRanges(); b.mesh.instanceColor!.addUpdateRange(0, p.total * 3); b.mesh.instanceColor!.needsUpdate = true;
      this.tris += b.tris * p.total;
    }
    // Instance batches are not individually culled by the shadow pass. Keep the nearest four
    // silhouette batches rather than paying for distant variants outside the small shadow camera.
    const casters: { mesh: THREE.InstancedMesh; distance: number }[] = [];
    for (const { mesh } of this.batches.values()) {
      mesh.castShadow = false;
      if (!mesh.userData.shadowCandidate) continue;
      let distance = Infinity;
      const m = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) {
        const dx = m[i * 16 + 12] - cam.x, dz = m[i * 16 + 14] - cam.z;
        distance = Math.min(distance, dx * dx + dz * dz);
      }
      casters.push({ mesh, distance });
    }
    casters.sort((a, b) => a.distance - b.distance).slice(0, 4).forEach(c => { c.mesh.castShadow = true; });
    this.objects = objects; this.objectCount = nextId;
    // Commit terrain, instance batches and background coverage as one coherent view.
    this.show(false);
    this.tiles = this.staged; this.objFar = this.stagedFar;
    this.mask.fill(0);
    for (const t of this.tiles) this.mask[t.entry.data.tz * this.hf.frame.tilesX + t.entry.data.tx] = 255;
    this.built = this.signature; this.builtAt = now; this.revision++;
    this.rebuildMs = performance.now() - start;
    this.draws = this.batches.size + this.tiles.length * 2;
    return true;
  }

  /** Object reference for a truth id (binary search over contiguous id ranges). */
  object(id: number): { ref: ObjectRef; index: number } | null {
    let lo = 0, hi = this.objects.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, r = this.objects[mid];
      if (id < r.start) hi = mid - 1; else if (id >= r.start + r.count) lo = mid + 1; else return { ref: r, index: id - r.start };
    }
    return null;
  }

  /** Show only this view's tiles; shared tile meshes are toggled per rendered view. */
  show(on: boolean) {
    for (const t of this.tiles) { t.entry.terrain.visible = on; if (t.entry.roads) t.entry.roads.visible = on; }
    this.group.visible = on;
  }

  meshes() { return [...this.batches.values()].map(b => b.mesh); }
  bytes() { let n = 0; for (const b of this.batches.values()) n += b.capacity * 19 * 4; return n; }

  dispose() {
    this.show(false);
    for (const b of this.batches.values()) b.mesh.dispose();
    this.batches.clear(); this.group.clear();
    this.tiles = []; this.staged = []; this.objects = []; this.objectCount = 0;
    this.mask.fill(0); this.signature = this.built = this.selection = ''; this.tiers.clear();
    this.settled = false; this.builtAt = -Infinity;
  }
}
