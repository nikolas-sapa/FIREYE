import { ARCHETYPE, CATALOG } from '../catalog';
import { HeightField, LocalFrame, TILE_M } from '../frame';
import { hex, mix, srgbToLinear, MeshBuilder, type Rgb } from '../mesh';
import { Rng, hash2, valueNoise } from '../rng';
import { describeBuilding, type BuildingDescriptor } from './buildings';
import { cropRows, landscapeAt } from './landscape';
export { buildingScale } from './buildings';
import { Flag, TruthClass, type CuratedSite, type Detail, type DumpInfo, type DumpKind, type FarTerrain, type InstanceGroup, type MeshArrays, type TileData, type WorldSource } from '../types';

/* Deterministic tile generator. Pure function of (source, tile, detail); identical output in workers and tests. */

export interface GenContext {
  src: WorldSource;
  hf: HeightField;
  frame: LocalFrame;
  roadIdx: Map<number, number[]>;
  bldIdx: Map<number, number[]>;
  siteIdx: Map<number, CuratedSite[]>;
  image?: (x: number, z: number) => Rgb | null;
  building: (index: number) => BuildingDescriptor;
}

const ROAD_HW: Record<string, number> = { highway: 3.8, road: 2.3, track: 1.3 };
const MASK_M = 2, MASK_N = TILE_M / MASK_M;
const M_ROAD = 1, M_BUILD = 2, M_WATER = 4, M_TAKEN = 8, M_TRACK = 16, M_VERGE = 32;

export function createContext(src: WorldSource): GenContext {
  const hf = new HeightField(src.grid), frame = hf.frame;
  const key = (tx: number, tz: number) => tz * frame.tilesX + tx;
  const roadIdx = new Map<number, number[]>(), bldIdx = new Map<number, number[]>(), siteIdx = new Map<number, CuratedSite[]>();
  src.roads.forEach((r, ri) => {
    const seen = new Set<number>();
    for (let i = 0; i + 1 < r.pts.length / 2; i++) {
      const ax = r.pts[i * 2], az = r.pts[i * 2 + 1], bx = r.pts[i * 2 + 2], bz = r.pts[i * 2 + 3];
      const [t0x, t0z] = frame.tileOf(Math.min(ax, bx) - 12, Math.min(az, bz) - 12), [t1x, t1z] = frame.tileOf(Math.max(ax, bx) + 12, Math.max(az, bz) + 12);
      for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
        if (!frame.validTile(tx, tz)) continue;
        const k = key(tx, tz);
        if (seen.has(k)) continue;
        seen.add(k);
        let list = roadIdx.get(k); if (!list) roadIdx.set(k, list = []); list.push(ri);
      }
    }
  });
  // Indexed into every tile its footprint can reach; only the tile holding the centre places it.
  src.buildings.forEach((b, i) => {
    const [t0x, t0z] = frame.tileOf(b.x - 22, b.z - 22), [t1x, t1z] = frame.tileOf(b.x + 22, b.z + 22);
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
      if (!frame.validTile(tx, tz)) continue;
      const k = key(tx, tz); let list = bldIdx.get(k); if (!list) bldIdx.set(k, list = []); list.push(i);
    }
  });
  for (const s of src.sites) {
    const [tx, tz] = frame.tileOf(s.x, s.z), k = key(tx, tz);
    let list = siteIdx.get(k); if (!list) siteIdx.set(k, list = []); list.push(s);
  }
  let image: GenContext['image'];
  const im = src.imagery;
  if (im) {
    const lut = new Float32Array(256); for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
    const [w, s, e, n] = im.bbox;
    image = (x, z) => {
      const lon = frame.lon(x), lat = frame.lat(z);
      const fx = (lon - w) / (e - w) * im.width - 0.5, fy = (n - lat) / (n - s) * im.height - 0.5;
      if (fx < 0 || fy < 0 || fx >= im.width - 1 || fy >= im.height - 1) return null;
      const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, p = im.pixels, row = im.width * 4;
      const o = (y0 * im.width + x0) * 4;
      const c = (k: number) => {
        const a = p[o + k] * (1 - tx) + p[o + 4 + k] * tx, b = p[o + row + k] * (1 - tx) + p[o + row + 4 + k] * tx;
        return lut[Math.round(a * (1 - ty) + b * ty)];
      };
      return [c(0), c(1), c(2)];
    };
  }
  const buildings = new Map<number, BuildingDescriptor>();
  const building = (i: number) => {
    let descriptor = buildings.get(i);
    if (!descriptor) {
      const b = src.buildings[i], [tx, tz] = frame.tileOf(b.x, b.z), indices = new Set<number>();
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        for (const ri of roadIdx.get(key(tx + dx, tz + dz)) ?? []) indices.add(ri);
      }
      descriptor = describeBuilding(b, hf, [...indices].map(ri => src.roads[ri]));
      buildings.set(i, descriptor);
    }
    return descriptor;
  };
  return { src, hf, frame, roadIdx, bldIdx, siteIdx, image, building };
}

/* ---------------------------------------------------------------- instance accumulation */

interface GroupBuf { n: number; cap: number; m: Float32Array; c: Float32Array; p: Float32Array }
class Groups {
  private map = new Map<string, GroupBuf>();
  add(id: string, x: number, y: number, z: number, o: { ry?: number; rx?: number; rz?: number; s?: number; sx?: number; sy?: number; sz?: number; tint?: Rgb; phase?: number; sens?: number } = {}) {
    let g = this.map.get(id);
    if (!g) this.map.set(id, g = { n: 0, cap: 64, m: new Float32Array(64 * 16), c: new Float32Array(64 * 3), p: new Float32Array(64 * 4) });
    if (g.n === g.cap) {
      const cap = g.cap * 2, m = new Float32Array(cap * 16), c = new Float32Array(cap * 3), p = new Float32Array(cap * 4);
      m.set(g.m); c.set(g.c); p.set(g.p);
      Object.assign(g, { cap, m, c, p });
    }
    const s = o.s ?? 1, sx = (o.sx ?? 1) * s, sy = (o.sy ?? 1) * s, sz = (o.sz ?? 1) * s;
    const cy = Math.cos(o.ry ?? 0), syn = Math.sin(o.ry ?? 0), cx = Math.cos(o.rx ?? 0), sxn = Math.sin(o.rx ?? 0), cz = Math.cos(o.rz ?? 0), szn = Math.sin(o.rz ?? 0);
    // R = Ry · Rx · Rz
    const r00 = cy * cz + syn * sxn * szn, r01 = -cy * szn + syn * sxn * cz, r02 = syn * cx;
    const r10 = cx * szn, r11 = cx * cz, r12 = -sxn;
    const r20 = -syn * cz + cy * sxn * szn, r21 = syn * szn + cy * sxn * cz, r22 = cy * cx;
    const a = ARCHETYPE.get(id)!;
    const phase = o.phase ?? 0, sens = (o.sens ?? a.sens) + (a.deciduous ? 2 : 0);
    // Row 3 of each affine instance matrix carries (phase, sensitivity, class, id); materials restore it to (0, 0, 0, 1).
    const M = g.m, k = g.n * 16;
    M[k] = r00 * sx; M[k + 1] = r10 * sx; M[k + 2] = r20 * sx; M[k + 3] = phase;
    M[k + 4] = r01 * sy; M[k + 5] = r11 * sy; M[k + 6] = r21 * sy; M[k + 7] = sens;
    M[k + 8] = r02 * sz; M[k + 9] = r12 * sz; M[k + 10] = r22 * sz; M[k + 11] = a.cls;
    M[k + 12] = x; M[k + 13] = y; M[k + 14] = z; M[k + 15] = 0;
    const t = o.tint, c = g.n * 3;
    g.c[c] = t ? t[0] : 1; g.c[c + 1] = t ? t[1] : 1; g.c[c + 2] = t ? t[2] : 1;
    const p = g.n * 4;
    g.p[p] = phase; g.p[p + 1] = sens; g.p[p + 2] = a.cls; g.p[p + 3] = 0;
    g.n++;
  }
  finalize(): { groups: InstanceGroup[]; objectCount: number } {
    const groups: InstanceGroup[] = [];
    let next = 0;
    for (const a of CATALOG) {
      const g = this.map.get(a.id);
      if (!g) continue;
      const params = g.p.slice(0, g.n * 4), matrices = g.m.slice(0, g.n * 16);
      const objects = a.kind !== 'grass';
      const firstId = objects ? next : -1;
      for (let i = 0; i < g.n; i++) { const id = objects ? next++ : -1; params[i * 4 + 3] = id; matrices[i * 16 + 15] = id; }
      groups.push({ archetype: a.id, count: g.n, matrices, colors: g.c.slice(0, g.n * 3), params, firstId });
    }
    return { groups, objectCount: next };
  }
}

/* ---------------------------------------------------------------- palettes */

const P = {
  litter: hex(0x6f5a3e), soil: hex(0x8f7a5c), bare: hex(0xa39883), rock: hex(0xb2ab9d), grassDry: hex(0xa8996a), grassGreen: hex(0x6f8a45),
  field: hex(0xb7a676), sand: hex(0xd8c8a2), paved: hex(0x9d9890), dump: hex(0x6d6253), seabed: hex(0x6e8f8c), asphalt: hex(0x67676a),
  asphaltWorn: hex(0x85827c), dirt: hex(0xa08a6a), line: hex(0xe8e4d6),
};
const CARS: [Rgb, number][] = [[hex(0xeeeeee), 3.5], [hex(0xa9adb2), 2], [hex(0x1d1f22), 1], [hex(0x9a2a24), 0.8], [hex(0x2c4d8a), 1], [hex(0x5d6166), 1.2], [hex(0xc9b48c), 0.5]];
const BAGS: [Rgb, number][] = [[hex(0x1b1c1e), 6], [hex(0x2f5fa0), 1.5], [hex(0x3c6b3a), 1], [hex(0xdcdcd6), 1.5]];
const BOTTLES: [Rgb, number][] = [[hex(0x2f63b8), 6], [hex(0xe07a2a), 3], [hex(0x8d9196), 1]];
const CANS: [Rgb, number][] = [[hex(0xb3261e), 7], [hex(0x3d6b37), 2], [hex(0x1e1f20), 1]];
const DRUMS: [Rgb, number][] = [[hex(0x2f5d8c), 4], [hex(0xa3302a), 2], [hex(0x222426), 2], [hex(0x7c4a2c), 2]];
const FABRIC: [Rgb, number][] = [[hex(0x7d6a55), 2], [hex(0x4b5560), 2], [hex(0x8a3b35), 1], [hex(0x5f7046), 1], [hex(0xc9bfae), 1]];
const BRIGHT: [Rgb, number][] = [[hex(0xd23a2e), 1], [hex(0xe6c229), 1], [hex(0x2b74c8), 1], [hex(0xf2f2f2), 1], [hex(0x2a8a4a), 1]];
const tintFor = (id: string, r: Rng): Rgb | undefined => {
  switch (id) {
    case 'car': case 'pickup': return r.weighted(CARS);
    case 'trash-bag': return r.weighted(BAGS);
    case 'gas-bottle': return r.weighted(BOTTLES);
    case 'jerrycan': return r.weighted(CANS);
    case 'oil-drum': return r.weighted(DRUMS);
    case 'sofa': return r.weighted(FABRIC);
    case 'aerosol': case 'paint-can': case 'parasol': case 'plastic-sheet': return r.weighted(BRIGHT);
    default: return undefined;
  }
};
const vegTint = (r: Rng, k = 0.14): Rgb => { const b = 1 - k + r.next() * 2 * k, h = (r.next() - 0.5) * k; return [b * (1 + h), b, b * (1 - h)]; };

/** Correlated grove colour and independent crown/height variation, using the same inexpensive meshes. */
export function plantStyle(x: number, z: number, r: Rng, young = false) {
  const patch = valueNoise(x / 48, z / 48, 83);
  const light = r.range(0.78, 1.2) * (0.86 + patch * 0.28);
  const warm = (patch - 0.5) * 0.28 + r.range(-0.07, 0.07);
  const crown = young ? r.range(0.5, 0.8) : r.range(0.9, 1.5);
  return { sx: crown, sz: crown * r.range(0.88, 1.12), sy: young ? r.range(0.45, 0.75) : r.range(0.72, 1.32),
    tint: [light * (1 + warm), light, light * (1 - warm)] as Rgb };
}

/* ---------------------------------------------------------------- land-cover rules (CORINE 2018 codes) */

type Weights = readonly (readonly [string, number])[];
interface Cover { tree: number; trees: Weights; shrub: number; shrubs: Weights; grass: number; tall: number; forestFloor: boolean }
const NONE: Cover = { tree: 0, trees: [], shrub: 0, shrubs: [], grass: 0, tall: 0, forestFloor: false };
const COVER: Record<number, Cover> = {
  312: { tree: 0.5, trees: [['aleppo-pine', 0.82], ['pine-young', 0.08], ['carob', 0.07], ['cypress', 0.03]], shrub: 0.24, shrubs: [['maquis', 0.7], ['broom', 0.1], ['dry-shrub', 0.08], ['phrygana', 0.12]], grass: 0.14, tall: 0.2, forestFloor: true },
  311: { tree: 0.45, trees: [['carob', 0.6], ['aleppo-pine', 0.3], ['olive', 0.1]], shrub: 0.25, shrubs: [['maquis', 0.8], ['broom', 0.2]], grass: 0.15, tall: 0.2, forestFloor: true },
  313: { tree: 0.48, trees: [['aleppo-pine', 0.6], ['carob', 0.4]], shrub: 0.25, shrubs: [['maquis', 0.8], ['broom', 0.2]], grass: 0.15, tall: 0.2, forestFloor: true },
  324: { tree: 0.2, trees: [['aleppo-pine', 0.45], ['pine-young', 0.2], ['carob', 0.22], ['olive', 0.13]], shrub: 0.42, shrubs: [['maquis', 0.58], ['broom', 0.14], ['phrygana', 0.12], ['dry-shrub', 0.16]], grass: 0.35, tall: 0.35, forestFloor: false },
  323: { tree: 0.06, trees: [['carob', 0.6], ['aleppo-pine', 0.4]], shrub: 0.5, shrubs: [['maquis', 0.8], ['dry-shrub', 0.1], ['broom', 0.1]], grass: 0.3, tall: 0.3, forestFloor: false },
  322: { tree: 0.02, trees: [['aleppo-pine', 1]], shrub: 0.5, shrubs: [['maquis', 0.5], ['broom', 0.3], ['phrygana', 0.2]], grass: 0.3, tall: 0.3, forestFloor: false },
  333: { tree: 0.025, trees: [['aleppo-pine', 0.5], ['pine-young', 0.3], ['olive', 0.2]], shrub: 0.28, shrubs: [['phrygana', 0.55], ['maquis', 0.2], ['dry-shrub', 0.15], ['broom', 0.1]], grass: 0.6, tall: 0.3, forestFloor: false },
  321: { tree: 0.01, trees: [['olive', 1]], shrub: 0.08, shrubs: [['phrygana', 0.7], ['maquis', 0.3]], grass: 0.8, tall: 0.4, forestFloor: false },
  112: { tree: 0.11, trees: [['aleppo-pine', 0.5], ['olive', 0.18], ['cypress', 0.15], ['carob', 0.1], ['palm', 0.04], ['fig', 0.03]], shrub: 0.07, shrubs: [['maquis', 0.5], ['oleander', 0.4], ['dry-shrub', 0.1]], grass: 0.22, tall: 0.45, forestFloor: false },
  111: { tree: 0.03, trees: [['cypress', 0.4], ['olive', 0.3], ['palm', 0.3]], shrub: 0.03, shrubs: [['oleander', 1]], grass: 0.05, tall: 0.3, forestFloor: false },
  142: { tree: 0.09, trees: [['aleppo-pine', 0.5], ['cypress', 0.25], ['olive', 0.25]], shrub: 0.05, shrubs: [['oleander', 1]], grass: 0.5, tall: 0.1, forestFloor: false },
  242: { tree: 0.03, trees: [['olive', 0.8], ['fig', 0.1], ['aleppo-pine', 0.1]], shrub: 0.05, shrubs: [['maquis', 0.6], ['dry-shrub', 0.4]], grass: 0.45, tall: 0.5, forestFloor: false },
  243: { tree: 0.08, trees: [['olive', 0.5], ['aleppo-pine', 0.3], ['carob', 0.2]], shrub: 0.2, shrubs: [['maquis', 0.8], ['broom', 0.2]], grass: 0.45, tall: 0.4, forestFloor: false },
  221: { tree: 0.005, trees: [['olive', 1]], shrub: 0.02, shrubs: [['maquis', 1]], grass: 0.3, tall: 0.2, forestFloor: false },
  211: { tree: 0, trees: [], shrub: 0.01, shrubs: [['dry-shrub', 1]], grass: 0.7, tall: 0.5, forestFloor: false },
};
export const coverOf = (clc: number, fuel: number): Cover => COVER[clc] ?? (fuel === 5 || fuel === 6 ? COVER[312] : fuel === 4 ? COVER[324] : fuel === 3 ? COVER[321] : fuel === 8 ? COVER[242] : fuel === 7 ? COVER[112] : NONE);
const URBAN = (clc: number) => clc >= 111 && clc <= 142;

interface Ground { base: Rgb; flag: number; cls: TruthClass; img: number }
/** Land-cover ground class and colour, shared by near tiles and the far terrain so both agree at tile edges. */
function landGround(ctx: GenContext, x: number, z: number, nz: number, nz2: number): Ground {
  const hf = ctx.hf;
  // A small domain warp keeps land-cover raster cell edges from reading as blocks from the air.
  const wx = x + (valueNoise(x / 31, z / 31, 41) - 0.5) * 34, wz = z + (valueNoise(x / 31, z / 31, 43) - 0.5) * 34;
  const clc = hf.clcAt(wx, wz), fuel = hf.fuelAt(wx, wz), dem = hf.dem(x, z);
  if (dem < -0.4 || fuel === 1) return { base: P.seabed, flag: Flag.GroundWater, cls: TruthClass.Water, img: 0.2 };
  if (dem < 2.2 && (hf.isWater(x + 25, z) || hf.isWater(x, z + 25) || hf.isWater(x - 25, z) || hf.isWater(x, z - 25))) return { base: P.sand, flag: Flag.GroundSand, cls: TruthClass.Sand, img: 0.3 };
  if (coverOf(clc, fuel).forestFloor) return { base: mix(P.litter, P.soil, landscapeAt(x, z).clearing * 0.55), flag: Flag.GroundLitter, cls: TruthClass.Litter, img: 0.45 };
  if (clc === 333 || fuel === 2) {
    const g = nz > 0.55;
    return g ? { base: mix(P.grassDry, P.bare, nz2 * 0.5), flag: Flag.GroundGrass, cls: TruthClass.GrassGround, img: 0.5 } : { base: mix(P.bare, P.rock, nz2), flag: Flag.GroundBare, cls: TruthClass.Bare, img: 0.5 };
  }
  if (clc === 211 || clc === 242 || clc === 221 || clc === 243) return { base: mix(P.field, P.soil, nz2 * 0.4), flag: Flag.GroundField, cls: TruthClass.Field, img: 0.45 };
  if (URBAN(clc)) {
    const stand = landscapeAt(x, z).canopy;
    if (clc === 112 && stand > 0.56) return { base: mix(P.litter, P.grassDry, (1 - stand) * 0.65), flag: Flag.GroundLitter, cls: TruthClass.Litter, img: 0.45 };
    const g = nz < 0.78;
    return g ? { base: mix(P.grassDry, P.soil, nz2 * 0.5), flag: Flag.GroundGrass, cls: TruthClass.GrassGround, img: 0.55 } : { base: mix(P.paved, P.soil, nz2 * 0.6), flag: Flag.GroundPaved, cls: TruthClass.Paved, img: 0.55 };
  }
  return { base: mix(P.grassDry, P.soil, nz2 * 0.45), flag: Flag.GroundGrass, cls: TruthClass.GrassGround, img: 0.5 };
}
/** Imagery colour, box-filtered over the vertex footprint so bright sub-cell lines do not alias into dotted rows. */
function imageAt(ctx: GenContext, x: number, z: number, r: number): Rgb | null {
  const c = ctx.image?.(x, z);
  if (!c || r < 3) return c ?? null;
  let n = 1; const acc = [c[0], c[1], c[2]];
  for (const [ox, oz] of [[-r, -r], [r, -r], [-r, r], [r, r]]) { const s = ctx.image!(x + ox, z + oz); if (s) { acc[0] += s[0]; acc[1] += s[1]; acc[2] += s[2]; n++; } }
  return [acc[0] / n, acc[1] / n, acc[2] / n] as Rgb;
}
function groundColour(ctx: GenContext, g: Ground, x: number, z: number, v: number, out: Float32Array, o: number, footprint = 0) {
  const im = imageAt(ctx, x, z, footprint * 0.5);
  const c = im ? mix(g.base, [im[0] * 1.15, im[1] * 1.15, im[2] * 1.15], g.img) : g.base;
  // Broad soil/vegetation colour patches survive the transition from 3D plants to the far terrain.
  // This is illustrative surface variation, not an extra measured land-cover layer.
  const patch = valueNoise(x / 38, z / 38, 67) - 0.5;
  const organic = g.flag === Flag.GroundGrass || g.flag === Flag.GroundLitter || g.flag === Flag.GroundField;
  const k = organic ? 1 + patch * 0.38 : 1 + patch * 0.14;
  out[o] = c[0] * v * k * (1 + patch * 0.12);
  out[o + 1] = c[1] * v * k;
  out[o + 2] = c[2] * v * k * (1 - patch * 0.12);
}

/* ---------------------------------------------------------------- dumps */

const DUMP_ITEMS: Record<DumpKind, Weights> = {
  household: [['trash-bag', 8], ['cardboard', 4], ['mattress', 1.2], ['sofa', 0.8], ['fridge', 0.5], ['pallet', 1.5], ['bottles', 2], ['plastic-sheet', 1.5], ['paint-can', 1], ['aerosol', 1.2], ['tyre', 0.8], ['patio-set', 0.3]],
  mixed: [['trash-bag', 5], ['cardboard', 2], ['tyre', 2], ['pallet', 2], ['mattress', 0.8], ['sofa', 0.5], ['oil-drum', 1], ['jerrycan', 0.8], ['paint-can', 1], ['branch-pile', 1], ['woodpile', 0.4], ['bottles', 1.5], ['plastic-sheet', 1], ['fridge', 0.4]],
  green: [['branch-pile', 6], ['trash-bag', 1], ['pallet', 1], ['cardboard', 0.5], ['woodpile', 0.5]],
  tyres: [['tyre', 6], ['tyre-stack', 3], ['oil-drum', 1], ['jerrycan', 0.5], ['trash-bag', 0.5]],
  construction: [['rubble', 6], ['pallet', 2], ['plastic-sheet', 2], ['paint-can', 2], ['cardboard', 1], ['oil-drum', 0.5], ['trash-bag', 1]],
};
const CANISTERS: Weights = [['gas-bottle', 3], ['camp-canister', 3], ['jerrycan', 2], ['aerosol', 2]];
const HEIGHT_OF: Record<string, number> = { 'trash-bag': 0.48, cardboard: 0.45, pallet: 0.14, mattress: 0.2, tyre: 0.2, 'plastic-sheet': 0.05 };

/* ---------------------------------------------------------------- generator */

export function generateTile(ctx: GenContext, tx: number, tz: number, detail: Detail): TileData {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { hf, frame, src } = ctx;
  const tileKey = tz * frame.tilesX + tx;
  const [x0, z0] = frame.tileOrigin(tx, tz);
  const inTile = (x: number, z: number) => x >= x0 && x < x0 + TILE_M && z >= z0 && z < z0 + TILE_M;
  const mask = new Uint8Array(MASK_N * MASK_N);
  const mi = (x: number, z: number) => { const i = Math.floor((x - x0) / MASK_M), j = Math.floor((z - z0) / MASK_M); return i < 0 || j < 0 || i >= MASK_N || j >= MASK_N ? -1 : j * MASK_N + i; };
  const m = (x: number, z: number) => { const i = mi(x, z); return i < 0 ? 0 : mask[i]; };
  const mark = (x: number, z: number, r: number, bit: number) => {
    const rc = Math.ceil(r / MASK_M);
    const ci = Math.floor((x - x0) / MASK_M), cj = Math.floor((z - z0) / MASK_M);
    for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < 0 || j < 0 || i >= MASK_N || j >= MASK_N) continue;
      const dx = x0 + (i + 0.5) * MASK_M - x, dz = z0 + (j + 0.5) * MASK_M - z;
      if (dx * dx + dz * dz <= r * r + 1) mask[j * MASK_N + i] |= bit;
    }
  };
  const free = (x: number, z: number, bits = M_ROAD | M_BUILD | M_WATER | M_TAKEN) => inTile(x, z) && (m(x, z) & bits) === 0;
  const G = new Groups();
  const roads = (ctx.roadIdx.get(tileKey) ?? []).map(i => src.roads[i]);

  // Water and roads into the mask.
  for (let j = 0; j < MASK_N; j++) for (let i = 0; i < MASK_N; i++) {
    if (hf.isWater(x0 + (i + 0.5) * MASK_M, z0 + (j + 0.5) * MASK_M)) mask[j * MASK_N + i] |= M_WATER;
  }
  for (const r of roads) {
    const hw = ROAD_HW[r.kind];
    for (let i = 0; i + 1 < r.pts.length / 2; i++) {
      const ax = r.pts[i * 2], az = r.pts[i * 2 + 1], bx = r.pts[i * 2 + 2], bz = r.pts[i * 2 + 3];
      if (Math.max(ax, bx) < x0 - 8 || Math.min(ax, bx) > x0 + TILE_M + 8 || Math.max(az, bz) < z0 - 8 || Math.min(az, bz) > z0 + TILE_M + 8) continue;
      const len = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(len / 1.5));
      for (let s = 0; s <= steps; s++) {
        const x = ax + (bx - ax) * s / steps, z = az + (bz - az) * s / steps;
        mark(x, z, hw + 1, M_ROAD | (r.kind === 'track' ? M_TRACK : 0));
        mark(x, z, hw + 5, M_VERGE);
      }
    }
  }

  /* ------------------------------------------------ buildings and yards */
  const homes: number[] = [], nodes: number[] = [], pasture: number[] = [];
  for (const bi of ctx.bldIdx.get(tileKey) ?? []) {
    const b = src.buildings[bi];
    if (hf.isWater(b.x, b.z)) continue;
    const r = new Rng(b.id, 29);
    const desc = ctx.building(bi), { id, w, d, sx, sz, sy, ry, y, low, local, tint, phase } = desc;
    for (let lz = -d / 2 - 1; lz <= d / 2 + 1; lz += 1.5) for (let lx = -w / 2 - 1; lx <= w / 2 + 1; lx += 1.5) { const [cx, cz] = local(lx * sx, lz * sz); mark(cx, cz, 1, M_BUILD); }
    if (!inTile(b.x, b.z)) continue;
    G.add(id, b.x, y, b.z, { ry, sx, sy, sz, tint, phase });
    if (y - low > 0.35) G.add('foundation', b.x, low - 0.1, b.z, { ry, sx: w * sx, sy: y - low + 0.12, sz: d * sz });
    if (id === 'greenhouse' || id === 'warehouse' || id === 'chapel') continue;
    const [hx, hz] = local(0, d * sz / 2 + 2);
    homes.push(hx, hz); nodes.push(hx, hz);
    if (id === 'shed') continue;
    // Yard props in the building's frame: +z faces the road.
    const tryPut = (aid: string, lx: number, lz: number, opts: Parameters<Groups['add']>[4] = {}, rad = 0.8) => {
      const [px, pz] = local(lx, lz);
      if (!free(px, pz)) return false;
      G.add(aid, px, hf.height(px, pz), pz, { ry: ry + (opts.ry ?? 0), tint: opts.tint ?? tintFor(aid, r), ...opts, ...(opts.ry !== undefined ? { ry: ry + opts.ry } : {}) });
      mark(px, pz, rad, M_TAKEN);
      return true;
    };
    const W = w * sx / 2, D = d * sz / 2;
    if (r.chance(0.55)) tryPut(r.chance(0.82) ? 'car' : 'pickup', r.range(-W, W), D + r.range(2.5, 4), { ry: Math.PI / 2 + (r.chance(0.5) ? Math.PI : 0) }, 2.2);
    if (r.chance(0.36)) tryPut('wheelie-bin', W + 1, D + 1.5, { ry: r.range(-0.3, 0.3) }, 0.6);
    if (r.chance(0.35)) tryPut('gas-bottle', r.chance(0.5) ? W + 0.45 : -W - 0.45, r.range(-D, D), { ry: r.range(0, 6) }, 0.3);
    if (r.chance(0.12)) tryPut('lpg-tank', -W - 2.5, -D + 1, { ry: Math.PI / 2 }, 1.6);
    if (r.chance(0.18)) tryPut('woodpile', W + 1.5, -D - 1.2, { ry: r.range(-0.2, 0.2) }, 1.2);
    if (r.chance(0.22)) tryPut('bbq', -W + 1, -D - 2.5, { ry: r.range(0, 6) }, 0.6);
    if (r.chance(0.3)) { const ok = tryPut('patio-set', W - 2, -D - 3.5, { ry: r.range(0, 6) }, 1.5); if (ok && r.chance(0.4)) tryPut('parasol', W - 2, -D - 3.5, { ry: r.range(0, 6) }, 0); }
    if (r.chance(0.08)) tryPut('water-tank', -W - 1.5, D - 1.5, { ry: 0 }, 1);
    if (id !== 'apartments' && r.chance(0.07)) tryPut('pool', 0, -D - 6.5, { ry: 0 }, 5);
    if (r.chance(0.08)) for (let i = r.int(1, 3); i > 0; i--) { const it = r.weighted([['tyre', 2], ['pallet', 2], ['cardboard', 2], ['gas-bottle', 1], ['paint-can', 1], ['trash-bag', 2]] as const); tryPut(it, -W - r.range(1, 3), -D - r.range(0, 4), { ry: r.range(0, 6), tint: tintFor(it, r) }, 0.4); }
    // Perimeter along the road side.
    const edge = r.next();
    if (edge < 0.62) {
      const wid = edge < 0.45 ? 'wall' : edge < 0.55 ? 'fence' : 'wood-fence';
      for (let lx = -W - 2.5; lx < W + 2.5; lx += 1) { const [px, pz] = local(lx + 0.5, D + 1.6); if (free(px, pz, M_ROAD | M_WATER)) G.add(wid, px, hf.height(px, pz) - 0.05, pz, { ry: ry }); }
    }
    for (let i = r.int(2, 5); i > 0; i--) {
      const sp = r.weighted([['olive', 0.3], ['aleppo-pine', 0.25], ['cypress', 0.2], ['citrus', 0.15], ['palm', 0.05], ['fig', 0.05]] as const);
      const ang = r.range(0, Math.PI * 2), dist = Math.max(W, D) + r.range(2, 7);
      tryPut(sp, Math.cos(ang) * dist, Math.sin(ang) * dist - 1, { ry: r.range(0, 6), ...plantStyle(b.x, b.z, r), phase: r.next() }, 2);
    }
    if (r.chance(0.35)) for (let lx = -W; lx < W; lx += 1.6) tryPut('oleander', lx, D + 0.9, { ry: r.range(0, 6), s: r.range(0.8, 1.1), tint: vegTint(r), phase: r.next() }, 0.5);
  }

  /* ------------------------------------------------ road furniture */
  for (let ri = 0; ri < roads.length; ri++) {
    const road = roads[ri], hw = ROAD_HW[road.kind], rr = new Rng(Math.round(road.cum[road.cum.length - 1] * 10), road.pts.length, ri < 0 ? 1 : 0);
    const side = hash2(Math.round(road.pts[0]), Math.round(road.pts[1]), 3) < 0.5 ? 1 : -1;
    const along = (step: number, offset: number, fn: (x: number, z: number, ux: number, uz: number, s: number, h: number) => void) => {
      for (let i = 0; i + 1 < road.pts.length / 2; i++) {
        const ax = road.pts[i * 2], az = road.pts[i * 2 + 1], bx = road.pts[i * 2 + 2], bz = road.pts[i * 2 + 3];
        const c0 = road.cum[i], c1 = road.cum[i + 1], len = c1 - c0;
        if (len < 0.01) continue;
        const ux = (bx - ax) / len, uz = (bz - az) / len;
        for (let s = Math.ceil((c0 + offset) / step) * step - offset; s < c1; s += step) {
          const f = (s - c0) / len, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
          if (!inTile(x, z)) continue;
          fn(x, z, ux, uz, s, hash2(Math.round(s * 10), Math.round(road.cum[road.cum.length - 1]), 9));
        }
      }
    };
    const urbanAt = (x: number, z: number) => URBAN(hf.clcAt(x, z));
    if (road.kind !== 'track' && rr.chance(0.75)) along(42, 0, (x, z, ux, uz) => {
      const px = x - uz * (hw + 1.3) * side, pz = z + ux * (hw + 1.3) * side;
      if (free(px, pz)) { G.add('power-pole', px, hf.height(px, pz), pz, { ry: Math.atan2(-uz, ux) }); mark(px, pz, 0.6, M_TAKEN); }
    });
    if (road.kind !== 'track') along(31, 11, (x, z, ux, uz) => {
      if (!urbanAt(x, z)) return;
      const px = x + uz * (hw + 0.9) * side, pz = z - ux * (hw + 0.9) * side;
      if (free(px, pz)) { G.add('street-lamp', px, hf.height(px, pz), pz, { ry: Math.atan2(-uz, ux) + (side > 0 ? 0 : Math.PI) - Math.PI / 2 }); mark(px, pz, 0.5, M_TAKEN); }
    });
    along(6, 2, (x, z, ux, uz, s, h) => {
      if (h > (road.kind === 'track' ? 0.07 : 0.045)) return;
      const r = new Rng(Math.round(s * 7), ri, tileKey), off = (hw + r.range(0.4, 3.5)) * (r.chance(0.5) ? 1 : -1);
      const px = x - uz * off, pz = z + ux * off;
      if (!free(px, pz)) return;
      const it = r.weighted([['bottles', 4], ['trash-bag', 2.5], ['cardboard', 1], ['plastic-sheet', 1], ['tyre', 0.5], ['aerosol', 0.4], ['camp-canister', 0.25]] as const);
      G.add(it, px, hf.height(px, pz), pz, { ry: r.range(0, 6), tint: tintFor(it, r), rx: it === 'aerosol' || it === 'camp-canister' ? Math.PI / 2 : 0 });
    });
    if (road.kind !== 'track') along(165, 40, (x, z, ux, uz, s, h) => {
      if (!urbanAt(x, z) || h > 0.65) return;
      const r = new Rng(Math.round(s), ri, 77), off = (hw + 1.4) * -side;
      const px = x - uz * off, pz = z + ux * off, ry = Math.atan2(-uz, ux);
      if (!free(px, pz)) return;
      for (let i = 0; i < 2; i++) { const qx = px + ux * (i * 1.6 - 0.8), qz = pz + uz * (i * 1.6 - 0.8); G.add('dumpster', qx, hf.height(qx, qz), qz, { ry }); }
      mark(px, pz, 2, M_TAKEN);
      for (let i = r.int(0, 4); i > 0; i--) {
        const qx = px + ux * r.range(-2.5, 2.5) - uz * r.range(-0.5, 1.2) * -side, qz = pz + uz * r.range(-2.5, 2.5) + ux * r.range(-0.5, 1.2) * -side;
        const it = r.weighted([['trash-bag', 4], ['cardboard', 2], ['bottles', 1], ['pallet', 0.5]] as const);
        G.add(it, qx, hf.height(qx, qz), qz, { ry: r.range(0, 6), tint: tintFor(it, r) });
      }
    });
    if (road.kind !== 'track') along(14, 5, (x, z, ux, uz, s, h) => {
      if (!urbanAt(x, z) || h > 0.13) return;
      const off = (hw + 0.6) * (h < 0.065 ? 1 : -1), px = x - uz * off, pz = z + ux * off;
      if (!free(px, pz, M_BUILD | M_WATER | M_TAKEN)) return;
      const r = new Rng(Math.round(s * 3), ri, 31);
      G.add(r.chance(0.85) ? 'car' : 'pickup', px, hf.height(px, pz), pz, { ry: Math.atan2(-uz, ux) + (r.chance(0.5) ? Math.PI : 0), tint: r.weighted(CARS) });
      mark(px, pz, 2.4, M_TAKEN);
    });
    along(15, 0, (x, z) => { if (m(x, z) & M_ROAD) nodes.push(x, z); });
  }

  /* ------------------------------------------------ dumps */
  const dumps: { x: number; z: number; r: number }[] = [], dumpInfo: DumpInfo[] = [];
  const placeDump = (cx: number, cz: number, kind: DumpKind, seed: number, canisters: boolean, curated: boolean) => {
    const r = new Rng(seed, 5);
    const R = curated ? r.range(3.5, 5.5) : r.range(2.8, 5.8);
    dumps.push({ x: cx, z: cz, r: R + 1.2 });
    const stack = new Map<number, number>();
    // 12–40 primary items (more on curated sets), plus 1–5 pressurized canisters when present.
    const n = Math.min(40, Math.round(R * R * r.range(0.75, 1.0)) + (curated ? 10 : 6));
    const info: DumpInfo = { x: cx, z: cz, r: R, kind, curated, items: 0, canisters: 0 };
    if (inTile(cx, cz)) dumpInfo.push(info);
    const put = (it: string, canister = false) => {
      for (let tries = 0; tries < 10; tries++) {
        const a = r.range(0, Math.PI * 2), d = Math.abs(r.gauss()) * R * 0.55;
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (!free(x, z, M_ROAD | M_BUILD | M_WATER)) continue;
        const key = Math.floor(x * 1.6) * 7919 + Math.floor(z * 1.6);
        const base = stack.get(key) ?? 0, lying = /aerosol|camp-canister|paint-can|gas-bottle|jerrycan|oil-drum/.test(it) && r.chance(0.4);
        const y = hf.height(x, z) + (base && r.chance(0.6) ? base : 0);
        G.add(it, x, y - 0.02, z, { ry: r.range(0, 6), rx: lying ? Math.PI / 2 : r.range(-0.12, 0.12), rz: r.range(-0.1, 0.1), tint: tintFor(it, r), s: r.range(0.85, 1.15) });
        stack.set(key, Math.min(1.2, base + (HEIGHT_OF[it] ?? 0.3)));
        if (canister) info.canisters++; else info.items++;
        return;
      }
    };
    for (let i = 0; i < n; i++) put(r.weighted(DUMP_ITEMS[kind]));
    if (canisters) for (let i = r.int(curated ? 2 : 1, curated ? 5 : 4); i > 0; i--) put(r.weighted(CANISTERS), true);
    if (kind === 'mixed' && r.chance(0.18)) { const a = r.range(0, 6), x = cx + Math.cos(a) * (R + 2), z = cz + Math.sin(a) * (R + 2); if (free(x, z)) G.add('abandoned-car', x, hf.height(x, z) - 0.15, z, { ry: r.range(0, 6), rz: r.range(-0.05, 0.05) }); }
    mark(cx, cz, R, M_TAKEN);
  };
  for (const s of ctx.siteIdx.get(tileKey) ?? []) {
    // Nudge the site (spiral, up to ~25 m) until its whole footprint is clear of roads, buildings and water.
    const clear = (x: number, z: number) => free(x, z) && [0, 1, 2, 3, 4, 5].every(k => free(x + 3.5 * Math.cos(k * 1.047), z + 3.5 * Math.sin(k * 1.047), M_ROAD | M_BUILD | M_WATER));
    let x = s.x, z = s.z;
    for (let k = 1; k <= 40 && !clear(x, z); k++) { const a = k * 2.4, d = 0.65 * k; x = s.x + d * Math.cos(a); z = s.z + d * Math.sin(a); }
    placeDump(x, z, s.kind, s.seed, true, true);
  }
  {
    const r = new Rng(tx, tz, 991);
    const hasTrack = roads.some(rd => rd.kind === 'track');
    const urbanShare = URBAN(hf.clcAt(x0 + 128, z0 + 128)) ? 1 : 0;
    const p = hasTrack ? 0.3 : roads.length ? (urbanShare ? 0.06 : 0.15) : 0.02;
    if (r.chance(p) && roads.length) {
      const pool = hasTrack ? roads.filter(rd => rd.kind === 'track') : roads;
      for (let attempt = 0; attempt < 8; attempt++) {
        const rd = r.pick(pool), i = r.int(0, rd.pts.length / 2 - 2);
        const f = r.next(), ax = rd.pts[i * 2], az = rd.pts[i * 2 + 1], bx = rd.pts[i * 2 + 2], bz = rd.pts[i * 2 + 3];
        const len = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / len, uz = (bz - az) / len, off = r.range(7, 18) * (r.chance(0.5) ? 1 : -1);
        const x = ax + (bx - ax) * f - uz * off, z = az + (bz - az) * f + ux * off;
        if (!free(x, z) || hf.slope(x, z) > 0.45) continue;
        const kind = r.weighted([['household', 0.35], ['mixed', 0.3], ['green', 0.15], ['tyres', 0.1], ['construction', 0.1]] as const);
        placeDump(x, z, kind, Math.floor(r.next() * 1e9), r.chance(0.32), false);
        break;
      }
    }
  }

  /* ------------------------------------------------ vegetation */
  const scar = src.scar;
  const inScar = (x: number, z: number) => scar ? Math.hypot(x - scar.x, z - scar.z) < scar.r : false;
  const canopy = (x: number, z: number) => {
    const c = ctx.image?.(x, z);
    if (!c) return 0.5;
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return Math.min(1, Math.max(0, (0.07 - l) / 0.05));
  };
  const scatter = (cell: number, seed: number, fn: (x: number, z: number, r: Rng) => void) => {
    const n = TILE_M / cell;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const r = new Rng(tx * n + i, tz * n + j, seed);
      fn(x0 + (i + r.next()) * cell, z0 + (j + r.next()) * cell, r);
    }
  };
  scatter(5, 101, (x, z, r) => {
    const clc = hf.clcAt(x, z), cov = coverOf(clc, hf.fuelAt(x, z));
    if (!cov.tree || !free(x, z)) return;
    if (clc === 242 && valueNoise(x / 90, z / 90, 4) > 0.5) return; // orchard patches handled below
    const patch = landscapeAt(x, z).trees;
    const k = (clc === 112 || cov.forestFloor || clc === 324 ? 0.65 + 0.95 * canopy(x, z) : 1) * patch;
    const scarK = inScar(x, z) ? 0.35 : 1;
    if (!r.chance(cov.tree * k * scarK * 1.18)) return;
    const sp = r.weighted(cov.trees);
    G.add(sp, x, hf.height(x, z) - 0.1, z, { ry: r.range(0, 6.28), ...plantStyle(x, z, r, sp === 'pine-young'), phase: r.next() });
    mark(x, z, 1, M_TAKEN);
  });
  // Olive groves in rows (CLC 242 patches).
  {
    cropRows([x0, z0, x0 + TILE_M, z0 + TILE_M], 7, 7, 0.31, (x, z) => {
      if (hf.clcAt(x, z) !== 242 || valueNoise(x / 90, z / 90, 4) <= 0.5 || !free(x, z)) return;
      const r = new Rng(Math.round(x * 3), Math.round(z * 3), 43);
      if (r.chance(0.12)) return;
      G.add('olive', x, hf.height(x, z) - 0.1, z, { ry: r.range(0, 6), s: r.range(0.7, 1), tint: vegTint(r), phase: r.next() });
      mark(x, z, 1.5, M_TAKEN);
    });
  }
  // Vineyard rows (CLC 221).
  {
    const ang = 0.48;
    cropRows([x0, z0, x0 + TILE_M, z0 + TILE_M], 2.6, 4.4, ang, (x, z) => {
      if (hf.clcAt(x, z) !== 221 || !free(x, z)) return;
      G.add('vine-row', x, hf.height(x, z), z, { ry: -ang, tint: vegTint(new Rng(Math.round(x), Math.round(z))), phase: hash2(Math.round(x), Math.round(z)) });
    });
  }
  scatter(3, 202, (x, z, r) => {
    const clc = hf.clcAt(x, z), cov = coverOf(clc, hf.fuelAt(x, z));
    if (!cov.shrub || !free(x, z)) return;
    const sc = inScar(x, z);
    const land = landscapeAt(x, z);
    if (!r.chance(cov.shrub * (sc ? 1.25 : 1.18) * land.shrubs * (cov.forestFloor ? 0.55 + land.clearing * 0.75 : 1)) || hf.slope(x, z) > 1.1) return;
    let sp = r.weighted(cov.shrubs);
    if (sc && r.chance(0.25)) sp = 'dry-shrub';
    G.add(sp, x, hf.height(x, z) - 0.05, z, { ry: r.range(0, 6.28), ...plantStyle(x, z, r), sy: r.range(0.6, 1.45), phase: r.next() });
  });
  scatter(8, 303, (x, z, r) => {
    if (!inScar(x, z) || !free(x, z) || !r.chance(0.22)) return;
    G.add('snag', x, hf.height(x, z) - 0.1, z, { ry: r.range(0, 6), s: r.range(0.6, 1.1), rz: r.range(-0.12, 0.12) });
  });
  scatter(6, 404, (x, z, r) => {
    const clc = hf.clcAt(x, z), cov = coverOf(clc, hf.fuelAt(x, z));
    if (!free(x, z)) return;
    if ((cov.forestFloor || clc === 112 && canopy(x, z) > 0.5) && r.chance(0.32)) G.add('needle-litter', x, hf.height(x, z), z, { ry: r.range(0, 6), s: r.range(0.7, 1.6) });
    else if ((clc === 333 || clc === 324) && r.chance(clc === 333 ? 0.12 : 0.04)) G.add('rock', x, hf.height(x, z) - 0.1, z, { ry: r.range(0, 6), s: r.range(0.5, 1.8), sy: r.range(0.6, 1.2) });
  });
  scatter(12, 505, (x, z, r) => {
    const clc = hf.clcAt(x, z);
    if (!free(x, z)) return;
    if ((clc === 312 || clc === 324 || inScar(x, z)) && r.chance(inScar(x, z) ? 0.25 : 0.1)) G.add('fallen-log', x, hf.height(x, z), z, { ry: r.range(0, 6), s: r.range(0.6, 1.3) });
    if ((clc === 211 || clc === 242) && r.chance(0.035)) G.add('hay-bale', x, hf.height(x, z), z, { ry: r.range(0, 6) });
    if ((clc === 333 || clc === 321 || clc === 324 || clc === 211) && r.chance(0.15)) pasture.push(x, z);
  });
  scatter(2, 606, (x, z, r) => {
    // CLC inland marsh/peat only. Proximity to the Aegean is not evidence of reed habitat.
    if (hf.clcAt(x, z) !== 411 && hf.clcAt(x, z) !== 412) return;
    if (!free(x, z) || !r.chance(0.35)) return;
    let wet = false;
    for (let k = 0; k < 6 && !wet; k++) wet = hf.isWater(x + Math.cos(k) * 14, z + Math.sin(k) * 14);
    if (wet && hf.dem(x, z) > 0.4) G.add('reeds', x, hf.height(x, z), z, { ry: r.range(0, 6), s: r.range(0.7, 1.2), phase: r.next() });
  });
  if (detail === 'near') {
    scatter(2.1, 707, (x, z, r) => {
      const bits = m(x, z);
      if (!inTile(x, z) || bits & (M_ROAD | M_BUILD | M_WATER)) return;
      const clc = hf.clcAt(x, z), cov = coverOf(clc, hf.fuelAt(x, z));
      const verge = bits & M_VERGE ? 0.35 : 0, dump = dumps.some(d => Math.hypot(x - d.x, z - d.z) < d.r + 2) ? 0.3 : 0;
      const p = Math.min(0.95, cov.grass * (0.55 + 0.9 * valueNoise(x / 14, z / 14, 21)) * (cov.forestFloor ? 0.4 + landscapeAt(x, z).clearing : 1) + verge + dump);
      if (!r.chance(p)) return;
      const tall = r.chance(cov.tall + verge * 0.6 + dump);
      G.add(tall ? 'tall-grass' : 'grass', x, hf.height(x, z) - 0.03, z, { ry: r.range(0, 6.28), sx: r.range(1.4, 2.5), sz: r.range(1.4, 2.5), sy: r.range(0.7, 1.5), tint: vegTint(r, 0.28), phase: r.next() });
    });
  }

  /* ------------------------------------------------ terrain mesh */
  // The source DEM is ~20 m. A 5.3 m near mesh resolves its relief and the bounded
  // visual micro-relief without spending most cold generation time on redundant vertices.
  const step = detail === 'near' ? TILE_M / 48 : 8, n = Math.round(TILE_M / step) + 1;
  const vCount = n * n + 4 * n;
  const position = new Float32Array(vCount * 3), color = new Float32Array(vCount * 3), meta = new Float32Array(vCount * 2), params = new Float32Array(vCount * 4);
  let minY = Infinity, maxY = -Infinity;
  const surface = (x: number, z: number, out: Float32Array, o: number): [number, number] => {
    const nz = valueNoise(x / 11, z / 11, 3), nz2 = valueNoise(x / 3.3, z / 3.3, 5);
    const bits = m(Math.min(x, x0 + TILE_M - 0.01), Math.min(z, z0 + TILE_M - 0.01));
    let g = landGround(ctx, x, z, nz, nz2);
    // Keep the imagery/palette mixture identical at every detail level. Changing
    // the mixture here produces visible 256 m squares as near tiles replace far ones.
    const shore = g.cls === TruthClass.Water || g.cls === TruthClass.Sand;
    if (!shore && dumps.some(d => Math.hypot(x - d.x, z - d.z) < d.r)) g = { base: mix(P.dump, P.soil, nz2 * 0.5), flag: Flag.GroundDump, cls: TruthClass.DumpGround, img: 0.15 };
    else if (!shore && bits & M_BUILD) g = { base: mix(P.paved, P.soil, nz2 * 0.3), flag: Flag.GroundPaved, cls: TruthClass.Paved, img: 0.35 };
    groundColour(ctx, g, x, z, 0.9 + nz2 * 0.2, out, o, step);
    return [g.flag, g.cls];
  };
  const tmp = new Float32Array(3);
  const vert = (vi: number, x: number, z: number, drop = 0) => {
    const y = hf.height(x, z) - drop;
    position[vi * 3] = x; position[vi * 3 + 1] = y; position[vi * 3 + 2] = z;
    if (!drop) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const [flag, cls] = surface(x, z, tmp, 0);
    color.set(tmp, vi * 3);
    meta[vi * 2 + 1] = flag;
    params[vi * 4 + 2] = cls; params[vi * 4 + 3] = -1;
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vert(j * n + i, x0 + i * step, z0 + j * step);
  // Skirts hide cracks between neighbouring tiles of different resolution and the far terrain.
  const edges: [number, number][][] = [[], [], [], []];
  for (let i = 0; i < n; i++) { edges[0].push([i, 0]); edges[1].push([n - 1, i]); edges[2].push([n - 1 - i, n - 1]); edges[3].push([0, n - 1 - i]); }
  const index: number[] = [];
  for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    if ((i + j) % 2) index.push(a, c, b, b, c, d); else index.push(a, c, d, a, d, b);
  }
  edges.forEach((edge, e) => edge.forEach(([i, j], k) => {
    const vi = n * n + e * n + k;
    // Deep enough to meet the 40 m far mesh, which can sit several metres under convex terrain.
    vert(vi, x0 + i * step, z0 + j * step, detail === 'near' ? 6 : 14);
    if (k + 1 < edge.length) { const top = j * n + i, [ni, nj] = edge[k + 1], top2 = nj * n + ni; index.push(top, vi + 1, vi, top, top2, vi + 1); }
  }));
  const terrain: MeshArrays = { position, color, meta, params, index: new Uint32Array(index) };

  /* ------------------------------------------------ road ribbons */
  const rp: number[] = [], rc: number[] = [], rm: number[] = [], rpar: number[] = [];
  const clip = (ax: number, az: number, bx: number, bz: number): [number, number] | null => {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dz = bz - az;
    for (const [p, q] of [[-dx, ax - x0], [dx, x0 + TILE_M - ax], [-dz, az - z0], [dz, z0 + TILE_M - az]]) {
      if (Math.abs(p) < 1e-9) { if (q < 0) return null; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    return [t0, t1];
  };
  const rvert = (x: number, y: number, z: number, col: Rgb, flag: number, cls: number) => { rp.push(x, y, z); rc.push(col[0], col[1], col[2]); rm.push(0, flag); rpar.push(0, 0, cls, -1); };
  // Height of the tile's own terrain mesh (bilinear over its grid) so coarse tiles never bury road ribbons.
  const meshH = (x: number, z: number) => {
    const gx = Math.max(0, Math.min(n - 1.001, (x - x0) / step)), gz = Math.max(0, Math.min(n - 1.001, (z - z0) / step));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, P0 = position;
    const h = (ii: number, jj: number) => P0[((jj * n) + ii) * 3 + 1];
    return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fz) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fz;
  };
  const ribbon = (ax: number, az: number, bx: number, bz: number, hw: number, lift: number, col: Rgb, flag: number, cls: number, ext: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const ux = (bx - ax) / len, uz = (bz - az) / len, nx = -uz, nzv = ux;
    const sx = ax - ux * ext, sz = az - uz * ext, L = len + 2 * ext, steps = Math.max(1, Math.ceil(L / 3));
    for (let s = 0; s < steps; s++) {
      const f0 = s / steps * L, f1 = (s + 1) / steps * L;
      const pts = [[f0, -hw], [f0, 0], [f0, hw], [f1, -hw], [f1, 0], [f1, hw]].map(([f, o]) => {
        const x = sx + ux * f + nx * o, z = sz + uz * f + nzv * o;
        return [x, Math.max(hf.height(x, z), meshH(x, z)) + lift, z];
      });
      const k = 0.92 + 0.12 * hash2(Math.round(sx + f0), Math.round(sz), 77);
      const cc: Rgb = [col[0] * k, col[1] * k, col[2] * k];
      for (const [a, b, c] of [[0, 1, 3], [1, 4, 3], [1, 2, 4], [2, 5, 4]]) {
        rvert(pts[a][0], pts[a][1], pts[a][2], cc, flag, cls); rvert(pts[b][0], pts[b][1], pts[b][2], cc, flag, cls); rvert(pts[c][0], pts[c][1], pts[c][2], cc, flag, cls);
      }
    }
  };
  for (const road of roads) {
    const hw = ROAD_HW[road.kind];
    const col = road.kind === 'track' ? P.dirt : road.kind === 'highway' ? P.asphalt : P.asphaltWorn;
    const flag = road.kind === 'track' ? Flag.Track : Flag.Road, cls = road.kind === 'track' ? TruthClass.Track : TruthClass.Road;
    for (let i = 0; i + 1 < road.pts.length / 2; i++) {
      const ax = road.pts[i * 2], az = road.pts[i * 2 + 1], bx = road.pts[i * 2 + 2], bz = road.pts[i * 2 + 3];
      const c = clip(ax, az, bx, bz);
      if (!c || c[1] - c[0] < 1e-6) continue;
      const px = ax + (bx - ax) * c[0], pz = az + (bz - az) * c[0], qx = ax + (bx - ax) * c[1], qz = az + (bz - az) * c[1];
      ribbon(px, pz, qx, qz, hw, 0.09, col, flag, cls, c[0] > 0 ? 0 : hw * 0.6);
      if (road.kind === 'highway' && detail === 'near') {
        const len = Math.hypot(qx - px, qz - pz), ux = (qx - px) / len, uz = (qz - pz) / len, c0 = road.cum[i] + c[0] * (road.cum[i + 1] - road.cum[i]);
        for (let s = Math.ceil(c0 / 9) * 9 - c0; s + 4 < len; s += 9) ribbon(px + ux * s, pz + uz * s, px + ux * (s + 4), pz + uz * (s + 4), 0.07, 0.11, P.line, Flag.Road, cls, 0);
      }
    }
  }
  // Roads join the terrain mesh (one draw per tile); the terrain shader biases road vertices toward the camera instead of polygon offset.
  let ground = terrain;
  if (rp.length) {
    const tv = terrain.position.length / 3, rv = rp.length / 3, total = tv + rv;
    const cat = (a: Float32Array, b: number[], k: number) => { const o = new Float32Array(total * k); o.set(a); o.set(b, tv * k); return o; };
    const index = new Uint32Array(terrain.index!.length + rv);
    index.set(terrain.index!);
    for (let i = 0; i < rv; i++) index[terrain.index!.length + i] = tv + i;
    ground = { position: cat(terrain.position, rp, 3), color: cat(terrain.color, rc, 3), meta: cat(terrain.meta, rm, 2), params: cat(terrain.params, rpar, 4), index };
  }

  const { groups, objectCount } = G.finalize();
  for (const g of groups) for (let i = 0; i < g.count; i++) maxY = Math.max(maxY, g.matrices[i * 16 + 13] + 14);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    key: `${tx}/${tz}/${detail}`, tx, tz, detail, minY: Number.isFinite(minY) ? minY : 0, maxY: Number.isFinite(maxY) ? maxY : 10,
    terrain: ground, roads: null, groups, objectCount, dumps: dumpInfo,
    spawns: { homes: new Float32Array(homes), nodes: new Float32Array(nodes), pasture: new Float32Array(pasture) },
    ms: t1 - t0,
  };
}

/** Low-resolution terrain (default 40 m) for the whole pack plus a fogged margin, split into frustum-cullable chunks. */
export function generateFar(ctx: GenContext, step = 40, margin = 5000, block = 120): FarTerrain {
  const { frame, hf } = ctx;
  const xa = frame.xMin - margin, za = frame.zMin - margin, xb = frame.xMax + margin, zb = frame.zMax + margin;
  const nx = Math.ceil((xb - xa) / step) + 1, nz = Math.ceil((zb - za) / step) + 1;
  const land = hex(0x9a8e70), forest = hex(0x4f5a38), urban = hex(0xb3aa98), sea = P.seabed;
  const H = new Float32Array(nx * nz), Cc = new Float32Array(nx * nz * 3), F = new Uint8Array(nx * nz), K = new Uint8Array(nx * nz);
  const acc = new Float32Array(3), one = new Float32Array(3), q = step / 4;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = xa + i * step, z = za + j * step, v = j * nx + i;
    const inside = x >= frame.xMin && x <= frame.xMax && z >= frame.zMin && z <= frame.zMax;
    const y = (inside ? hf.height(x, z) : hf.dem(x, z)) - 0.6;
    H[v] = y;
    const water = y < -0.5;
    if (inside && !water) {
      // Average four near-tile ground samples so the coarse mesh matches the tiles' mean colour.
      acc.fill(0);
      let g: Ground | null = null;
      for (const [ox, oz] of [[-q, -q], [q, -q], [-q, q], [q, q]]) {
        const sx = x + ox, sz = z + oz;
        g = landGround(ctx, sx, sz, valueNoise(sx / 11, sz / 11, 3), valueNoise(sx / 3.3, sz / 3.3, 5));
        groundColour(ctx, g, sx, sz, 1, one, 0, q * 2);
        acc[0] += one[0] / 4; acc[1] += one[1] / 4; acc[2] += one[2] / 4;
      }
      Cc.set(acc, v * 3); F[v] = g!.flag; K[v] = g!.cls;
      continue;
    }
    const fuel = hf.fuelAt(x, z), clc = hf.clcAt(x, z);
    const c: Rgb = water ? sea : fuel === 5 || fuel === 6 ? forest : URBAN(clc) ? urban : land;
    Cc[v * 3] = c[0]; Cc[v * 3 + 1] = c[1]; Cc[v * 3 + 2] = c[2];
    F[v] = water ? Flag.GroundWater : Flag.GroundGrass; K[v] = water ? TruthClass.Water : TruthClass.GrassGround;
  }
  const chunks: FarTerrain['chunks'] = [];
  /** Grid patch [bi, bi + w) × [bj, bj + h) sampled every `stride` vertices, optionally with skirts hiding LOD cracks. */
  const patch = (bi: number, bj: number, w: number, h: number, stride: number, skirt: number): MeshArrays => {
    const cols: number[] = [], rows: number[] = [];
    for (let i = 0; i < w - 1; i += stride) cols.push(bi + i); cols.push(bi + w - 1);
    for (let j = 0; j < h - 1; j += stride) rows.push(bj + j); rows.push(bj + h - 1);
    const cw = cols.length, ch = rows.length, ring = skirt > 0 ? 2 * (cw + ch) - 4 : 0, n = cw * ch + ring;
    const position = new Float32Array(n * 3), color = new Float32Array(n * 3), meta = new Float32Array(n * 2), params = new Float32Array(n * 4);
    const put = (v: number, gi: number, gj: number, drop: number) => {
      const s = gj * nx + gi;
      position[v * 3] = xa + gi * step; position[v * 3 + 1] = H[s] - drop; position[v * 3 + 2] = za + gj * step;
      color[v * 3] = Cc[s * 3]; color[v * 3 + 1] = Cc[s * 3 + 1]; color[v * 3 + 2] = Cc[s * 3 + 2];
      meta[v * 2 + 1] = F[s]; params[v * 4 + 2] = K[s]; params[v * 4 + 3] = -1;
    };
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) put(j * cw + i, cols[i], rows[j], 0);
    const index: number[] = [];
    for (let j = 0; j + 1 < ch; j++) for (let i = 0; i + 1 < cw; i++) {
      const p = j * cw + i, q = p + 1, r = p + cw, s = r + 1;
      index.push(p, r, q, q, r, s);
    }
    if (ring) {
      const edge: [number, number][] = [];
      for (let i = 0; i < cw; i++) edge.push([i, 0]);
      for (let j = 1; j < ch; j++) edge.push([cw - 1, j]);
      for (let i = cw - 2; i >= 0; i--) edge.push([i, ch - 1]);
      for (let j = ch - 2; j >= 0; j--) edge.push([0, j]);
      const base = cw * ch;
      edge.forEach(([i, j], k) => put(base + k, cols[i], rows[j], skirt));
      for (let k = 0; k < edge.length; k++) {
        const k2 = (k + 1) % edge.length, t1 = edge[k][1] * cw + edge[k][0], t2 = edge[k2][1] * cw + edge[k2][0];
        index.push(t1, base + k, base + k2, t1, base + k2, t2);
      }
    }
    return { position, color, meta, params, index: new Uint32Array(index) };
  };
  for (let bj = 0; bj < nz - 1; bj += block) for (let bi = 0; bi < nx - 1; bi += block) {
    const w = Math.min(block, nx - 1 - bi) + 1, h = Math.min(block, nz - 1 - bj) + 1;
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const y = H[(bj + j) * nx + bi + i]; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const bounds: [number, number, number, number] = [xa + bi * step, za + bj * step, xa + (bi + w - 1) * step, za + (bj + h - 1) * step];
    chunks.push({ mesh: patch(bi, bj, w, h, 1, 0),
      coarse: patch(bi, bj, w, h, 4, 40), minY, maxY, bounds });
  }
  // Context uses smaller culling blocks, only inside the source bounds. The 5 km terrain margin needs no objects.
  const context: MeshArrays[] = [], contextM = 2560;
  for (let z = frame.zMin; z < frame.zMax; z += contextM) for (let x = frame.xMin; x < frame.xMax; x += contextM) {
    const m = contextMesh(ctx, [x, z, Math.min(frame.xMax, x + contextM), Math.min(frame.zMax, z + contextM)]);
    if (m.position.length) context.push(m);
  }
  return { chunks, context, tilesX: frame.tilesX, tilesZ: frame.tilesZ, xMin: frame.xMin, zMin: frame.zMin };
}

/** Distant aggregate canopy and buildings, batched without small-object detail. Not measured trees. */
export function contextMesh(ctx: GenContext, bounds: [number, number, number, number]): MeshArrays {
  const { hf, frame, src } = ctx, b = new MeshBuilder(71), classes: number[] = [];
  const origins = new Map<number, [number, number]>();
  const phases = new Map<number, number>();
  const [x0, z0, x1, z1] = bounds;
  const inside = (x: number, z: number) => x >= x0 && z >= z0 && x < x1 && z < z1;
  const label = (cls: TruthClass) => { while (classes.length < b.vertexCount) classes.push(cls); };
  const pitch = 28;
  for (let j = Math.ceil(Math.max(z0, frame.zMin) / pitch); j * pitch < Math.min(z1, frame.zMax); j++) {
    for (let i = Math.ceil(Math.max(x0, frame.xMin) / pitch); i * pitch < Math.min(x1, frame.xMax); i++) {
      const r = new Rng(i, j, 119), x = (i + r.next()) * pitch, z = (j + r.next()) * pitch;
      if (!inside(x, z) || hf.isWater(x, z)) continue;
      const cov = coverOf(hf.clcAt(x, z), hf.fuelAt(x, z));
      if (!cov.tree || !r.chance(cov.tree * 1.35 * landscapeAt(x, z).trees)) continue;
      // Keep coarse patches off source road/building corridors, just as in the detailed tiles.
      const [tx, tz] = frame.tileOf(x, z), key = tz * frame.tilesX + tx;
      if ((ctx.bldIdx.get(key) ?? []).some(k => Math.hypot(src.buildings[k].x - x, src.buildings[k].z - z) < 15)) continue;
      const onRoad = (ctx.roadIdx.get(key) ?? []).some(k => {
        const p = src.roads[k].pts;
        for (let q = 0; q + 3 < p.length; q += 2) {
          const dx = p[q + 2] - p[q], dz = p[q + 3] - p[q + 1];
          const t = Math.max(0, Math.min(1, ((x - p[q]) * dx + (z - p[q + 1]) * dz) / (dx * dx + dz * dz || 1)));
          if (Math.hypot(x - p[q] - dx * t, z - p[q + 1] - dz * t) < ROAD_HW[src.roads[k].kind] + 7) return true;
        }
        return false;
      });
      if (onRoad) continue;
      const y = hf.height(x, z), s = plantStyle(x, z, r), pine = cov.forestFloor;
      const tint = pine ? hex(0x52613a) : hex(0x79805a);
      const c: Rgb = [tint[0] * s.tint[0], tint[1] * s.tint[1], tint[2] * s.tint[2]];
      // Two-triangle aggregate crown. The far shader turns it toward the camera.
      const radius = r.range(3.5, 5.5) * s.sx * (pitch / 20), h = radius * 0.55 * s.sy, cy = y + (pine ? 6 : 3);
      const points: [number, number, number][] = [[x - radius, cy, z], [x, cy + h, z],
        [x + radius, cy, z], [x, cy - h, z]];
      const start = b.vertexCount;
      for (let k = 1; k < 3; k++) b.tri(points[0], points[k + 1], points[k], c, Flag.Foliage);
      label(TruthClass.Tree);
      // The origin is carried separately so each crown rotates in place, not around its chunk.
      for (let k = start; k < b.vertexCount; k++) origins.set(k, [x, z]);
    }
  }
  for (let bi = 0; bi < src.buildings.length; bi++) {
    const p = src.buildings[bi];
    if (!inside(p.x, p.z) || hf.isWater(p.x, p.z)) continue;
    const d = ctx.building(bi);
    const start = b.vertexCount;
    // Merge foundation and body into one silhouette. Roofline and orientation stay identical
    // to the detailed descriptor, without doubling every background building's triangle count.
    const base = d.low - 0.1, height = d.y + d.h * d.sy - base;
    const wall = hex(d.id === 'house-tiled' ? 0xe2d1ae : d.id === 'warehouse' ? 0xa9adae : d.id === 'shed' ? 0x8b8f93 : 0xebe6da);
    const tint: Rgb = [wall[0] * d.tint[0], wall[1] * d.tint[1], wall[2] * d.tint[2]];
    b.box(d.w * d.sx, height, d.d * d.sz, tint, { x: p.x, y: base, z: p.z, ry: d.ry }, Flag.Paint, { top: hex(0xbcb6a9) });
    const roof = { x: p.x, y: d.y + d.h * d.sy, z: p.z, ry: d.ry, sx: d.sx, sy: d.sy, sz: d.sz };
    if (d.id === 'house-tiled') b.hip(d.w, d.d, 2.2, hex(0xb2603f), roof);
    if (d.id === 'chapel' || d.id === 'greenhouse') b.gable(d.w, d.d, d.id === 'chapel' ? 1.6 : 1.3,
      hex(d.id === 'chapel' ? 0xb2603f : 0xe2e8e4), { ...roof, ry: d.ry + Math.PI / 2 });
    for (let i = start; i < b.vertexCount; i++) phases.set(i, d.phase);
    label(TruthClass.Structure);
  }
  const m = b.build();
  m.params = new Float32Array(classes.length * 4);
  classes.forEach((cls, i) => {
    const origin = origins.get(i);
    if (origin) { m.params[i * 4] = origin[0]; m.params[i * 4 + 1] = origin[1]; }
    else m.params[i * 4] = phases.get(i) ?? 0;
    m.params[i * 4 + 2] = cls; m.params[i * 4 + 3] = -1;
  });
  return m;
}
