import assert from 'node:assert/strict';
import type { ScenarioPack } from '../src/console/contracts';
import { clc2018 } from '../src/console/scenario/load';
import { AGENT_ID_BASE, AgentSim } from '../src/console/world3d/agents/sim';
import { ARCHETYPE, CATALOG } from '../src/console/world3d/catalog';
import { computeEnv, type EnvInput } from '../src/console/world3d/env';
import { rate } from '../src/console/world3d/flammability';
import { TILE_M } from '../src/console/world3d/frame';
import { curatedSites } from '../src/console/world3d/gen/sites';
import { buildSource } from '../src/console/world3d/gen/source';
import { coverOf, createContext, generateTile } from '../src/console/world3d/gen/tile';
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
  assert.ok(src.grid.clc, 'CORINE land cover is available for the Mati pack');
  assert.equal(src.sites.length, 6, 'one curated analysis dump per default feed');

  // Determinism: the same tile from two independent contexts is identical.
  const [cx, cz] = frame.tileOf(frame.x(23.955), frame.z(38.047));
  const other = make();
  for (const [dx, dz, detail] of [[0, 0, 'near'], [1, -1, 'near'], [-2, 1, 'far']] as const) {
    assert.deepEqual(strip(generateTile(ctx, cx + dx, cz + dz, detail)), strip(generateTile(other, cx + dx, cz + dz, detail)), 'tile generation is deterministic');
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
