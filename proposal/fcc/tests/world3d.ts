import assert from 'node:assert/strict';
import type { ScenarioPack } from '../src/console/contracts';
import { clc2018 } from '../src/console/scenario/load';
import { AGENT_ID_BASE, AgentSim } from '../src/console/world3d/agents/sim';
import { ARCHETYPE, CATALOG } from '../src/console/world3d/catalog';
import { computeEnv, environmentTime, type EnvInput } from '../src/console/world3d/env';
import { cropRows, landscapeAt } from '../src/console/world3d/gen/landscape';
import { rate } from '../src/console/world3d/flammability';
import { TILE_M } from '../src/console/world3d/frame';
import { curatedSites } from '../src/console/world3d/gen/sites';
import { buildSource } from '../src/console/world3d/gen/source';
import { buildingScale, contextMesh, coverOf, createContext, generateFar, generateTile, plantStyle } from '../src/console/world3d/gen/tile';
import { Rng } from '../src/console/world3d/rng';
import { decodeTruth } from '../src/console/world3d/truth/capture';
import { FLAMMABILITY, TruthClass, type TileData } from '../src/console/world3d/types';
import { sunPosition } from '../src/console/stage3d/sun';

const HALF_WIDTH = { highway: 3.8, road: 2.3, track: 1.3 } as const;
const VEG = new Set([TruthClass.Tree, TruthClass.Shrub, TruthClass.Grass]);
const strip = (t: TileData) => ({ ...t, ms: 0 });

/** Generator, environment, agent and ground-truth invariants for the procedural monitoring world (docs/WORLD3D.md). */
export function checkWorld3d(pack: ScenarioPack) {
  const make = () => {
    const src = buildSource(pack, clc2018(pack), { scar: { lon: 23.952, lat: 38.04, r: 950 } });
    const ctx = createContext(src);
    src.sites = curatedSites(lon => ctx.frame.x(lon), lat => ctx.frame.z(lat));
    return createContext(src);
  };
  const ctx = make(), { frame, hf, src } = ctx;
  const rows = (bounds: [number, number, number, number]) => {
    const points: string[] = [];
    cropRows(bounds, 7, 7, 0.31, (x, z) => points.push(`${x.toFixed(6)},${z.toFixed(6)}`));
    return points.sort();
  };
  assert.deepEqual([...rows([-256, 0, 0, 256]), ...rows([0, 0, 256, 256])].sort(), rows([-256, 0, 256, 256]), 'crop rows continue across tile boundaries without duplicates or direction changes');
  assert.deepEqual(landscapeAt(256 - 1e-8, 93), landscapeAt(256 - 1e-8, 93));
  assert.ok(Math.abs(landscapeAt(256 - 1e-5, 93).trees - landscapeAt(256 + 1e-5, 93).trees) < 1e-4, 'stand/clearing field is continuous across tile edges');
  const clock = { live: false, advance: false, timeMs: 1234 };
  assert.equal(environmentTime(clock, 60000, 999999), 1234, 'paused FIREYE lighting does not drift');
  assert.equal(environmentTime({ ...clock, timeMs: 4321 }, 100, 999999), 4321, 'a seek supplies the exact new environment time');
  assert.equal(environmentTime({ ...clock, advance: true }, 100, 999999), 1334, 'historical monitoring still advances in real time');
  assert.equal(environmentTime({ ...clock, live: true }, 100, 999999), 999999, 'current monitoring follows wall time');
  assert.ok(src.grid.clc, 'CORINE land cover is available for the Mati pack');
  assert.equal(src.sites.length, 6, 'one curated analysis dump per default feed');

  // Determinism: the same tile from two independent contexts is identical.
  const [cx, cz] = frame.tileOf(frame.x(23.955), frame.z(38.047));
  const solidPixels = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < solidPixels.length; i += 4) solidPixels.set([80, 95, 60, 255], i);
  const surfaceCtx = createContext({ ...src, roads: [], buildings: [], sites: [], imagery: { width: 8, height: 8, bbox: src.grid.bbox, pixels: solidPixels } });
  const nearSurface = generateTile(surfaceCtx, cx, cz, 'near').terrain;
  const farSurface = generateTile(surfaceCtx, cx, cz, 'far').terrain;
  for (let j = 1; j < 16; j++) for (let i = 1; i < 16; i++) for (let c = 0; c < 3; c++) {
    assert.ok(Math.abs(nearSurface.color[((j * 3) * 49 + i * 3) * 3 + c] - farSurface.color[((j * 2) * 33 + i * 2) * 3 + c]) < 1e-5,
      'near/far surfaces use the same imagery/palette mixture at shared vertices');
  }
  const other = make();
  for (const [dx, dz, detail] of [[0, 0, 'near'], [1, -1, 'near'], [-2, 1, 'far']] as const) {
    assert.deepEqual(strip(generateTile(ctx, cx + dx, cz + dz, detail)), strip(generateTile(other, cx + dx, cz + dz, detail)), 'tile generation is deterministic');
  }
  const widths: number[] = [], heights: number[] = [], tints: number[] = [];
  for (let i = 0; i < 256; i++) {
    const p = plantStyle(120, 160, new Rng(i, 83));
    widths.push(p.sx); heights.push(p.sy); tints.push(p.tint[0] / p.tint[1]);
    assert.ok(p.sx >= 0.9 && p.sx <= 1.5 && p.sy >= 0.72 && p.sy <= 1.32, 'bounded crown and height variation');
    const b = buildingScale('house-flat', new Rng(i, 17));
    assert.ok(b.sx > 0.7 && b.sx < 1.4 && b.sz > 0.7 && b.sz < 1.4 && b.sy > 0.5 && b.sy < 1.5, 'bounded building scales');
  }
  assert.ok(Math.max(...widths) - Math.min(...widths) > 0.5 && Math.max(...heights) - Math.min(...heights) > 0.5, 'plants vary in crown spread and height independently');
  assert.ok(Math.max(...tints) - Math.min(...tints) > 0.1, 'foliage varies in hue, not only brightness');
  const detailed = generateTile(ctx, cx, cz, 'near'), distant = generateTile(ctx, cx, cz, 'far');
  for (const g of distant.groups) {
    const near = detailed.groups.find(n => n.archetype === g.archetype)!;
    assert.deepEqual(g.matrices, near.matrices, 'object positions and sizes agree across terrain detail levels');
    assert.deepEqual(g.colors, near.colors, 'object colours agree across terrain detail levels');
  }
  const [bx, bz] = frame.tileOrigin(cx, cz);
  const bounds: [number, number, number, number] = [bx, bz, bx + TILE_M, bz + TILE_M];
  const context = contextMesh(ctx, bounds);
  assert.deepEqual(context, contextMesh(other, bounds), 'distant silhouettes are deterministic');
  assert.ok(context.position.length > 0 && context.position.every(Number.isFinite), 'distant silhouettes populate the tile');
  assert.ok(context.params.every((v, i) => i % 4 !== 2 || v === TruthClass.Tree || v === TruthClass.Structure), 'distant context contains only labelled canopy/buildings');
  assert.ok(context.params.some((v, i) => i % 4 === 2 && v === TruthClass.Tree), 'vegetated source block includes aggregate crowns');
  const sourceBuilding = src.buildings.find(p => !hf.isWater(p.x, p.z))!;
  const bi = src.buildings.indexOf(sourceBuilding), descriptor = ctx.building(bi);
  assert.equal(ctx.building(bi), descriptor, 'building descriptor is cached across detailed tiles and context generation');
  const { local: localA, ...descA } = descriptor, { local: localB, ...descB } = other.building(bi);
  assert.deepEqual(descA, descB, 'descriptor fields are deterministic');
  assert.deepEqual(localA(4, 5), localB(4, 5));
  const [btx, btz] = frame.tileOf(sourceBuilding.x, sourceBuilding.z);
  const btile = generateTile(ctx, btx, btz, 'far');
  const bg = btile.groups.find(g => g.archetype === descriptor.id)!;
  let buildingIndex = -1;
  for (let i = 0; i < bg.count; i++) if (Math.abs(bg.matrices[i * 16 + 12] - sourceBuilding.x) < 0.01 && Math.abs(bg.matrices[i * 16 + 14] - sourceBuilding.z) < 0.01) buildingIndex = i;
  assert.ok(buildingIndex >= 0);
  const offset = buildingIndex * 16;
  assert.ok(Math.abs(bg.matrices[offset] - Math.cos(descriptor.ry) * descriptor.sx) < 1e-5, 'detailed orientation and footprint use the shared descriptor');
  assert.ok(Math.abs(bg.matrices[offset + 13] - descriptor.y) < 1e-3, 'detailed base uses the shared slope-supported height');
  const builtContext = contextMesh(ctx, [sourceBuilding.x - 40, sourceBuilding.z - 40, sourceBuilding.x + 40, sourceBuilding.z + 40]);
  assert.ok(builtContext.params.some((v, i) => i % 4 === 2 && v === TruthClass.Structure), 'source building produces a labelled distant structure');
  for (let i = 0; i < context.params.length; i += 4) {
    assert.equal(context.params[i + 3], -1, 'aggregate context is not an individually identified object');
    if (context.params[i + 2] !== TruthClass.Tree) continue;
    const x = context.params[i], z = context.params[i + 1];
    assert.ok(x >= bx && x <= bx + TILE_M && z >= bz && z <= bz + TILE_M, 'crown pivots remain in their source block');
    assert.ok(!hf.isWater(x, z) && coverOf(hf.clcAt(x, z), hf.fuelAt(x, z)).tree > 0, 'aggregate canopy respects water and land cover');
  }
  // Small fixture catches uninitialized skirt vertices that pull every chunk's bounds toward the origin.
  const small = createContext({ ...src, buildings: [], sites: [], grid: { ...src.grid, fuel: new Uint8Array(src.grid.fuel.length), clc: null } });
  const far = generateFar(small, 400, 0, 4);
  for (const c of far.chunks) for (const mesh of [c.mesh, c.coarse]) {
    for (let i = 0; i < mesh.position.length; i += 3) {
      assert.ok(mesh.position[i] >= c.bounds[0] - 0.01 && mesh.position[i] <= c.bounds[2] + 0.01
        && mesh.position[i + 2] >= c.bounds[1] - 0.01 && mesh.position[i + 2] <= c.bounds[3] + 0.01, 'every far/skirt vertex stays inside its chunk culling bounds');
    }
  }

  // Generate a block of tiles around Mati plus every curated site.
  const keys = new Set<string>();
  for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) keys.add(`${cx + dx},${cz + dz}`);
  for (const s of src.sites) { const [tx, tz] = frame.tileOf(s.x, s.z); keys.add(`${tx},${tz}`); }
  const tiles: TileData[] = [];
  for (const k of keys) { const [tx, tz] = k.split(',').map(Number); if (frame.validTile(tx, tz)) tiles.push(generateTile(ctx, tx, tz, 'near')); }

  let veg = 0, trees = 0, shrubs = 0, grass = 0;
  const badVeg: string[] = [];
  for (const t of tiles) {
    const [x0, z0] = frame.tileOrigin(t.tx, t.tz);
    const roads = src.roads.filter(r => { for (let i = 0; i < r.pts.length; i += 2) if (r.pts[i] > x0 - 40 && r.pts[i] < x0 + TILE_M + 40 && r.pts[i + 1] > z0 - 40 && r.pts[i + 1] < z0 + TILE_M + 40) return true; return false; });
    const roadDist = (x: number, z: number) => {
      let best = Infinity;
      for (const r of roads) for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const ax = r.pts[i], az = r.pts[i + 1], dx = r.pts[i + 2] - ax, dz = r.pts[i + 3] - az, l2 = dx * dx + dz * dz || 1;
        const s = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        best = Math.min(best, Math.hypot(x - ax - dx * s, z - az - dz * s) - HALF_WIDTH[r.kind]);
      }
      return best;
    };
    const blds = src.buildings.filter(b => b.x > x0 - 30 && b.x < x0 + TILE_M + 30 && b.z > z0 - 30 && b.z < z0 + TILE_M + 30);
    for (const g of t.groups) {
      const a = ARCHETYPE.get(g.archetype);
      assert.ok(a, `generated archetype ${g.archetype} is in the catalog`);
      if (!VEG.has(a.cls) || g.archetype === 'reeds') continue;
      for (let i = 0; i < g.count; i++) {
        const x = g.matrices[i * 16 + 12], z = g.matrices[i * 16 + 14];
        veg++;
        if (a.cls === TruthClass.Tree) trees++; else if (a.cls === TruthClass.Shrub) shrubs++; else grass++;
        const cov = coverOf(hf.clcAt(x, z), hf.fuelAt(x, z));
        const where = `${g.archetype} at ${x.toFixed(1)},${z.toFixed(1)} clc ${hf.clcAt(x, z)}`;
        if (hf.isWater(x, z)) badVeg.push(`${where} on water`);
        // The 2 m placement mask allows a stem to touch the paved edge, not to stand on the carriageway.
        if (roadDist(x, z) < -0.25) badVeg.push(`${where} on a road ${roadDist(x, z).toFixed(2)}`);
        const bb = blds.find(b => Math.hypot(b.x - x, b.z - z) < 2); if (bb) badVeg.push(`${where} on a building ${JSON.stringify(bb)} water ${hf.isWater(bb.x, bb.z)}`);
        const allowed = a.cls === TruthClass.Tree ? cov.tree > 0 : a.cls === TruthClass.Shrub ? cov.shrub > 0 || g.archetype === 'dry-shrub' : true;
        if (!allowed) badVeg.push(`${where} outside vegetated land cover`);
      }
    }
  }
  assert.deepEqual(badVeg, [], `vegetation respects roads, water, buildings and land cover (${badVeg.length} violations)`);
  assert.ok(trees > 5000 && shrubs > 20000 && grass > 100000, `rich vegetation near Mati (trees ${trees}, shrubs ${shrubs}, grass ${grass})`);

  // Dumps: curated sites always carry canisters; random dumps are occasional, a minority carry canisters.
  const dumps = tiles.flatMap(t => t.dumps ?? []);
  const curated = dumps.filter(d => d.curated), random = dumps.filter(d => !d.curated);
  assert.equal(curated.length, 6, 'every curated site produced a dump');
  for (const d of curated) assert.ok(d.canisters >= 2 && d.canisters <= 5 && d.items >= 12, `curated ${d.kind} dump has 2–5 canisters and enough items (${d.items}/${d.canisters})`);
  for (const d of dumps) assert.ok(d.items <= 40 && d.canisters <= 5, 'dump size is bounded');
  const share = random.length / tiles.length, withGas = random.filter(d => d.canisters > 0).length / Math.max(1, random.length);
  assert.ok(share > 0.03 && share < 0.3, `random dumps are occasional (${(share * 100).toFixed(1)}% of tiles)`);
  assert.ok(random.length >= 10 && withGas > 0.12 && withGas < 0.55, `about a third of random dumps hold canisters (${(withGas * 100).toFixed(0)}% of ${random.length})`);
  const canisterIds = new Set(CATALOG.filter(a => a.hazard === 'pressurized-gas').map(a => a.id));
  assert.ok(canisterIds.size >= 2 && tiles.some(t => t.groups.some(g => canisterIds.has(g.archetype))), 'pressurized gas canisters are generated');

  // Environment: season and sun follow the selected time.
  const base = (timeMs: number): EnvInput => ({ view: 'mati', timeMs, live: false, lat: 38.04, lon: 23.978, weather: { tempC: null, rh: null, windKph: null, windFromDeg: null, gustKph: null, precipMm: null, source: 'test' } });
  const july = computeEnv(base(Date.UTC(2018, 6, 23, 14))), nov = computeEnv(base(Date.UTC(2018, 10, 15, 12)));
  assert.ok(july.curing > 0.9 && nov.curing < 0.5 && july.season === 'summer' && nov.season === 'autumn', 'July Mati is cured, November is greener');
  assert.ok(july.dryness > nov.dryness && rate('grass', july).score > rate('grass', nov).score, 'grass flammability falls from July to November');
  for (const t of [Date.UTC(2018, 6, 23, 3), Date.UTC(2018, 6, 23, 10), Date.UTC(2018, 6, 23, 17, 30), Date.UTC(2024, 7, 12, 19), Date.UTC(2026, 10, 15, 8)]) {
    const e = computeEnv(base(t)), s = sunPosition(t, 38.04, 23.978);
    assert.ok(Math.abs(e.sunEl - s.elDeg) < 1e-9, 'environment sun elevation matches stage3d/sun.ts');
    assert.ok(Math.abs(Math.hypot(...e.sunDir) - 1) < 1e-6, 'sun direction is a unit vector');
  }
  const noon = computeEnv(base(Date.UTC(2018, 6, 23, 10, 30))), night = computeEnv(base(Date.UTC(2018, 6, 23, 0)));
  assert.ok(noon.sunEl > 60 && noon.daylight > 0.95 && night.sunEl < -18 && night.night > 0.95, 'day and night follow the clock');
  assert.ok(computeEnv(base(Date.UTC(2018, 6, 23, 10)), { hour: 2 }).night > 0.95, 'debug hour override');
  const rainy = computeEnv(base(Date.UTC(2018, 10, 15, 12)), { precipMm: 3 });
  assert.ok(rainy.rain > 0.5 && rainy.wet > 0.5 && rainy.visibilityKm < nov.visibilityKm, 'rain wets and hazes the world');
  assert.ok(july.assumed.includes('temperature') && computeEnv({ ...base(0), weather: { ...base(0).weather, tempC: 30 } }).assumed.indexOf('temperature') < 0, 'missing weather is reported as assumed');

  // Agents: populate from generated spawns and stay on walkable, in-bounds ground.
  const sim = new AgentSim(hf);
  const near = tiles.filter(t => Math.abs(t.tx - cx) <= 2 && Math.abs(t.tz - cz) <= 2);
  const fx = frame.x(23.955), fz = frame.z(38.047);
  sim.populate({ id: 'test-ground', x: fx, z: fz, r: 220, air: false }, near.map(t => t.spawns));
  sim.populate({ id: 'test-air', x: fx + 150, z: fz - 100, r: 500, air: true }, near.map(t => t.spawns));
  const species = new Set(sim.agents.map(a => a.species));
  assert.ok(sim.agents.length > 10 && species.has('person') && species.has('bird'), `agents spawn (${sim.agents.length}: ${[...species].join(', ')})`);
  for (const [i, daylight] of [[0, 1], [1, 0.02], [2, 1]] as const) {
    for (let s = 0; s < 600; s++) sim.update(0.1, { daylight, rain: i === 2 ? 0.6 : 0, windMs: 3 });
    for (const a of sim.agents) {
      if (a.species === 'bird') { assert.ok(a.y > 5 || !a.visible, 'birds fly'); continue; }
      if (!a.visible) continue;
      assert.ok(sim.walkable(a.x, a.z, a.species), `${a.species} stays on walkable ground in bounds`);
      assert.ok(Number.isFinite(a.y) && Math.abs(a.y - hf.height(a.x, a.z)) < 0.01, 'agents stand on the terrain');
    }
  }
  assert.ok(sim.agents.filter(a => a.species === 'person' && a.visible).length < sim.agents.filter(a => a.species === 'person').length || !species.has('person'), 'some people go indoors at night or in rain');

  // Ground truth: catalog classes are stable codes and decode round-trips.
  const codes = new Set(Object.values(TruthClass).filter(v => typeof v === 'number'));
  for (const a of CATALOG) {
    assert.ok(codes.has(a.cls), `${a.id} truth class is a TruthClass`);
    assert.ok(a.flam >= 0 && a.flam < FLAMMABILITY.length, `${a.id} flammability level`);
    if (a.hazard) assert.ok(a.flam >= 2, `${a.id} hazard is at least moderately flammable`);
  }
  const w = 8, h = 4, rgba = new Uint8Array(w * h * 4);
  const ids = [7, 0xffffff, AGENT_ID_BASE + 3];
  const probe = CATALOG.find(a => a.hazard === 'pressurized-gas')!;
  for (let p = 0; p < w * h; p++) {
    const id = p < 8 ? ids[0] : p < 24 ? ids[1] : ids[2];
    rgba.set([id & 255, (id >> 8) & 255, (id >> 16) & 255, p < 8 ? probe.cls : p < 24 ? TruthClass.Litter : TruthClass.Person], p * 4);
  }
  const cap = decodeTruth('test', rgba, w, h, id => id === 7 ? { archetype: probe.id, position: [1, 2, 3] } : id === AGENT_ID_BASE + 3 ? { archetype: 'person', position: [0, 0, 0] } : null,
    { t: july.t, curing: july.curing, dryness: july.dryness, wet: july.wet, leaf: july.leaf, season: july.season },
    { position: [0, 10, 0], lon: 23.95, lat: 38.04, altM: 10, headingDeg: 0, pitchDeg: -10, fovDeg: 60 });
  assert.equal(cap.classes.length, w * h);
  assert.equal(cap.classes[(h - 1) * w], probe.cls, 'row 0 of the WebGL buffer is the bottom of the mask');
  const canister = cap.objects.find(o => o.archetype === probe.id);
  assert.ok(canister && canister.cls === probe.cls && canister.hazard === 'pressurized-gas' && canister.pixels === 8, 'object ids resolve to catalog labels and hazards');
  assert.ok(cap.classPixels.Litter === 16 && cap.classPixels.Person === 8, 'class pixel counts');
  assert.ok(cap.flammability.every(v => v < FLAMMABILITY.length), 'per-pixel flammability codes');

  console.log(`World3D: determinism, vegetation placement (${veg} plants on ${tiles.length} tiles), dumps (${random.length} random, ${(withGas * 100).toFixed(0)}% with canisters), seasons, sun, agents (${sim.agents.length}) and ground truth PASS`);
}
