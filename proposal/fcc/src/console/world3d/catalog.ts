import { MeshBuilder, hex, mix, scale, type Rgb } from './mesh';
import { TruthClass, Flag, type MeshArrays } from './types';

export type MaterialKind = 'veg' | 'grass' | 'rigid' | 'agent';

/**
 * One table entry per thing the world can contain. Geometry is procedural low-poly, built in code,
 * so a new object type is a single entry here plus a placement rule in the generator.
 * Flammability levels are illustrative labels for testing analysis, not fire-science measurements.
 */
export interface Archetype {
  id: string;
  label: string;
  cls: TruthClass;
  material: string;
  /** Base level index into FLAMMABILITY (0 none … 4 extreme). */
  flam: number;
  hazard?: 'pressurized-gas' | 'liquid-fuel' | 'aerosol' | 'flammable-liquid' | 'tyres' | 'plastics';
  kind: MaterialKind;
  /** Highest render tier the object is drawn at (0 near, 1 mid, 2 far). */
  maxTier: 0 | 1 | 2;
  shadow: boolean;
  /** Live-fuel curing sensitivity (seasonal yellowing and flammability gain). */
  sens: number;
  deciduous?: boolean;
  build: (lod: number) => MeshArrays;
  lodCount: number;
}

const C = {
  bark: hex(0x5b4636), barkGrey: hex(0x77706a), pine: hex(0x3a5a2b), pine2: hex(0x4b6c33), olive: hex(0x7f8c5f), cypress: hex(0x2c4628),
  carob: hex(0x3d5e2d), maquis: hex(0x4a5d33), phrygana: hex(0x8c9067), dryShrub: hex(0x8f7748), dead: hex(0x6e5c4a), grass: hex(0x6f8f3e),
  grassTip: hex(0xa3b25e), straw: hex(0xc8b07a), reed: hex(0x7d8f4a), litter: hex(0x6c5435), white: hex(0xebe6da), cream: hex(0xe2d1ae),
  tile: hex(0xb2603f), concrete: hex(0xbcb6a9), window: hex(0x28323c), door: hex(0x6b4b32), panel: hex(0x26364a), metal: hex(0x8b8f93),
  darkMetal: hex(0x3e4246), stone: hex(0xb4a88f), wood: hex(0x8a6a48), woodLight: hex(0xb08d60), tyre: hex(0x1d1d1d), glass: hex(0x2a3a48),
  lamp: hex(0xfff0c8), black: hex(0x1a1c1e), plastic: hex(0xe8e8e2), water: hex(0x3a9fc2), rust: hex(0x7c4a2c), cardboard: hex(0xae8957),
  skin: hex(0xc99a78), cloth: hex(0xffffff), pants: hex(0x3b4552), hair: hex(0x3a2c22), dog: hex(0x8a6a48), goat: hex(0x6e5a48), wool: hex(0xe4ddcc),
  cat: hex(0x9a8a78), bird: hex(0x4a4a4e), hay: hex(0xd2b56c), rock: hex(0x9c958a), rubble: hex(0xa59f94), orange: hex(0xe0812e), leafPink: hex(0xd77a9a),
};

const memo = new Map<string, MeshArrays>();
const lods = (fns: ((b: MeshBuilder) => number | void)[], windRef = 0, seed = 1) => (lod: number) => {
  const i = Math.min(fns.length - 1, lod);
  const b = new MeshBuilder(seed + i * 7);
  const w = fns[i](b);
  return b.build(typeof w === 'number' ? w : windRef);
};

/* ---------------------------------------------------------------- vegetation */

const aleppoPine = (b: MeshBuilder, lod: number) => {
  b.cyl(0.24, 0.13, 6.2, lod ? 4 : 6, C.bark, { rz: 0.06 }, Flag.Wood, { top: false });
  // Umbrella crown so distant pines read round from above, not as octahedron diamonds.
  if (lod >= 2) {
    b.blob(2.8, C.pine, { x: -0.55, y: 7, z: 0.25 }, Flag.Foliage, 0, 0.23, 0.48);
    b.blob(1.9, C.pine2, { x: 1.45, y: 6.45, z: -0.4 }, Flag.Foliage, 0, 0.2, 0.5);
    return;
  }
  b.cyl(0.08, 0.04, 2.6, 4, C.bark, { y: 4.8, rz: 0.75 }, Flag.Wood, { top: false });
  b.cyl(0.08, 0.04, 2.4, 4, C.bark, { y: 5.1, rz: -0.7, ry: 1.2 }, Flag.Wood, { top: false });
  const crowns: [number, number, number, number][] = lod ? [[0, 7.1, 0, 2.6], [1.7, 6.4, 0.6, 1.8]]
    : [[0, 7.3, 0, 2.3], [1.9, 6.6, 0.4, 1.7], [-1.6, 6.8, -0.8, 1.6], [0.4, 6.2, 1.8, 1.5], [-0.3, 8.1, -0.4, 1.4]];
  crowns.forEach(([x, y, z, r], i) => b.blob(r, i % 2 ? C.pine2 : C.pine, { x, y, z }, Flag.Foliage, lod ? 0 : 1, 0.25, 0.6));
};
const cypress = (b: MeshBuilder, lod: number) => {
  b.cyl(0.18, 0.12, 1.2, 4, C.bark, {}, Flag.Wood, { top: false });
  if (lod >= 2) { b.cyl(0.9, 0, 9, 4, C.cypress, { y: 0.8 }, Flag.Foliage); return; }
  b.cyl(1.05, 0.75, 4.2, lod ? 5 : 7, C.cypress, { y: 0.8 }, Flag.Foliage, { bottom: true });
  b.cyl(0.75, 0, 5.2, lod ? 5 : 7, C.cypress, { y: 5 }, Flag.Foliage, { top: false });
};
const olive = (b: MeshBuilder, lod: number) => {
  b.cyl(0.32, 0.2, 1.5, lod ? 4 : 6, C.barkGrey, { rz: 0.15 }, Flag.Wood, { top: false });
  if (lod >= 2) { b.blob(2.1, C.olive, { y: 2.8 }, Flag.Foliage, 0, 0.1, 0.65); return; }
  b.cyl(0.15, 0.1, 1.4, 4, C.barkGrey, { y: 1.3, rz: 0.6 }, Flag.Wood, { top: false });
  b.cyl(0.15, 0.1, 1.4, 4, C.barkGrey, { y: 1.3, rz: -0.6, ry: 2 }, Flag.Wood, { top: false });
  const cr: [number, number, number, number][] = lod ? [[0, 2.8, 0, 2.1]] : [[0.7, 2.7, 0.2, 1.4], [-0.8, 2.9, -0.3, 1.5], [0.1, 3.3, 0.6, 1.3], [0, 2.4, -0.9, 1.2]];
  cr.forEach(([x, y, z, r]) => b.blob(r, C.olive, { x, y, z }, Flag.Foliage, lod ? 0 : 1, 0.3, 0.7));
};
const broadleaf = (color: Rgb) => (b: MeshBuilder, lod: number) => {
  b.cyl(0.26, 0.18, 2.2, lod ? 4 : 6, C.bark, {}, Flag.Wood, { top: false });
  if (lod >= 2) { b.blob(2.6, color, { y: 3.6 }, Flag.Foliage, 0, 0.1, 0.8); return; }
  b.blob(2.4, color, { y: 3.8 }, Flag.Foliage, 1, 0.28, 0.85);
  if (!lod) { b.blob(1.6, scale(color, 1.1), { x: 1.4, y: 3.2, z: 0.5 }, Flag.Foliage, 1, 0.3); b.blob(1.5, scale(color, 0.92), { x: -1.2, y: 3.4, z: -0.6 }, Flag.Foliage, 1, 0.3); }
};
const citrus = (b: MeshBuilder, lod: number) => {
  b.cyl(0.12, 0.09, 1, 4, C.bark, {}, Flag.Wood, { top: false });
  b.blob(1.3, hex(0x2f5527), { y: 1.9 }, Flag.Foliage, lod ? 0 : 1, 0.2, 0.9);
  if (!lod) for (let i = 0; i < 6; i++) { const a = i * 1.1; b.blob(0.13, C.orange, { x: Math.cos(a) * 1.15, y: 1.6 + (i % 3) * 0.35, z: Math.sin(a) * 1.15 }, 0, 0, 0); }
};
const palm = (b: MeshBuilder, lod: number) => {
  b.cyl(0.25, 0.2, 6, lod ? 4 : 6, hex(0x7a6650), { rz: 0.05 }, Flag.Wood, { top: false });
  const n = lod ? 5 : 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    b.tri([0, 6, 0], [c * 3 - s * 0.5, 5.2, s * 3 + c * 0.5], [c * 3 + s * 0.5, 5.2, s * 3 - c * 0.5], hex(0x4f6e2f), Flag.Foliage);
    b.tri([0, 6, 0], [c * 3 + s * 0.5, 5.2, s * 3 - c * 0.5], [c * 3 - s * 0.5, 5.2, s * 3 + c * 0.5], hex(0x4f6e2f), Flag.Foliage);
  }
};
const shrub = (color: Rgb, n: number) => (b: MeshBuilder, lod: number) => {
  if (lod >= 1) { b.blob(0.9, color, { y: 0.55 }, Flag.Foliage, 0, 0.2, 0.75); return; }
  for (let i = 0; i < n; i++) {
    const a = i * 2.4, r = i ? 0.55 : 0;
    b.blob(0.75 - i * 0.08, i % 2 ? scale(color, 1.12) : color, { x: Math.cos(a) * r, y: 0.55 + (i % 2) * 0.2, z: Math.sin(a) * r }, Flag.Foliage, 1, 0.35, 0.8);
  }
};
const cushion = (b: MeshBuilder, lod: number) => {
  b.blob(0.5, C.phrygana, { y: 0.22 }, Flag.Foliage, lod ? 0 : 1, 0.35, 0.55);
  if (!lod) b.blob(0.32, mix(C.phrygana, hex(0x9a86a8), 0.3), { x: 0.4, y: 0.18, z: 0.2 }, Flag.Foliage, 0, 0.3, 0.6);
};
const deadShrub = (b: MeshBuilder, lod: number) => {
  if (lod) { b.blob(0.8, C.dryShrub, { y: 0.5 }, Flag.Foliage, 0, 0.3, 0.7); return; }
  for (let i = 0; i < 7; i++) b.cyl(0.03, 0.01, 1.1, 3, C.dead, { ry: i * 0.9, rz: 0.5 + (i % 3) * 0.15 }, Flag.Wood, { top: false });
  b.blob(0.65, C.dryShrub, { y: 0.55 }, Flag.Foliage, 1, 0.45, 0.7);
};
const snag = (b: MeshBuilder, lod: number) => {
  b.cyl(0.22, 0.06, 7, lod ? 4 : 5, hex(0x5a514a), { rz: 0.04 }, Flag.Wood, { top: false });
  if (lod) return;
  for (let i = 0; i < 4; i++) b.cyl(0.06, 0.01, 1.8, 3, hex(0x5a514a), { y: 3 + i * 1.1, ry: i * 1.9, rz: 0.9 }, Flag.Wood, { top: false });
};
const grassClump = (b: MeshBuilder) => {
  for (let i = 0; i < 6; i++) {
    const a = i * 2.39996, r = 0.08 + (i % 3) * 0.07;
    b.blade(Math.cos(a) * r, Math.sin(a) * r, 0.035, 0.38 + (i % 3) * 0.12, a, 0.1, C.grass, C.grassTip);
  }
  return 0.5;
};
const tallGrass = (b: MeshBuilder) => {
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996, r = 0.05 + (i % 4) * 0.08;
    b.blade(Math.cos(a) * r, Math.sin(a) * r, 0.03, 0.7 + (i % 3) * 0.25, a, 0.18, mix(C.grass, C.straw, 0.35), C.straw);
  }
  return 1;
};
const reeds = (b: MeshBuilder) => {
  for (let i = 0; i < 10; i++) { const a = i * 2.39996, r = 0.1 + (i % 4) * 0.12; b.blade(Math.cos(a) * r, Math.sin(a) * r, 0.05, 2.2 + (i % 3) * 0.6, a, 0.3, C.reed, C.straw); }
  return 3;
};
const vineRow = (b: MeshBuilder, lod: number) => {
  for (const x of [-2, 2]) b.box(0.08, 1.3, 0.08, C.wood, { x }, Flag.Wood);
  if (!lod) for (let i = 0; i < 5; i++) b.blob(0.42, hex(0x5d7a30), { x: -1.8 + i * 0.9, y: 0.95, z: 0 }, Flag.Foliage, 0, 0.3, 0.8);
  else b.box(4, 0.6, 0.6, hex(0x5d7a30), { y: 0.65 }, Flag.Foliage);
};
const litter = (b: MeshBuilder) => {
  const n = 7;
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r = 1.2 + ((i * 37) % 5) * 0.18; pts.push([Math.cos(a) * r, 0.04, Math.sin(a) * r]); }
  for (let i = 0; i < n; i++) b.tri([0, 0.05, 0], pts[(i + 1) % n], pts[i], C.litter, Flag.GroundLitter);
};
const log = (b: MeshBuilder) => { b.cyl(0.16, 0.12, 3.2, 5, C.dead, { rz: Math.PI / 2, x: 1.6, y: 0.14 }, Flag.Wood, { bottom: true }); };
const rock = (b: MeshBuilder) => { b.blob(0.6, C.rock, { y: 0.25 }, 0, 0, 0.35, 0.6); };

/* ---------------------------------------------------------------- structures */

function windows(b: MeshBuilder, w: number, d: number, floors: number, floorH: number) {
  const n = Math.max(1, Math.floor(w / 3)), z = d / 2 + 0.02, sx = w / 2 + 0.02;
  for (let f = 0; f < floors; f++) {
    const y = 0.9 + f * floorH;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n);
      b.quad([x - 0.5, y, z], [x + 0.5, y, z], [x + 0.5, y + 1.2, z], [x - 0.5, y + 1.2, z], C.window, Flag.Window);
      b.quad([x + 0.5, y, -z], [x - 0.5, y, -z], [x - 0.5, y + 1.2, -z], [x + 0.5, y + 1.2, -z], C.window, Flag.Window);
    }
    b.quad([sx, y, 0.6], [sx, y, -0.6], [sx, y + 1.2, -0.6], [sx, y + 1.2, 0.6], C.window, Flag.Window);
    b.quad([-sx, y, -0.6], [-sx, y, 0.6], [-sx, y + 1.2, 0.6], [-sx, y + 1.2, -0.6], C.window, Flag.Window);
  }
}
const houseFlat = (b: MeshBuilder, lod: number) => {
  const w = 10, d = 8, h = 6.2;
  b.box(w, h, d, C.white, {}, Flag.Paint, { top: C.concrete, sideFlag: Flag.Paint });
  if (lod >= 2) return;
  windows(b, w, d, 2, 3);
  b.box(w + 0.6, 0.18, 2, C.concrete, { y: 3, z: d / 2 + 1 });
  b.box(0.08, 1, 2, C.metal, { y: 3.18, z: d / 2 + 1, x: w / 2 + 0.25 });
  b.box(1.1, 2.1, 0.08, C.door, { z: d / 2 + 0.03, x: -2.5 });
  // Rooftop solar water heater, ubiquitous on Greek flat roofs.
  b.box(2, 0.08, 1.4, C.panel, { y: h + 0.5, x: 2, rx: -0.5 });
  b.cyl(0.3, 0.3, 1.9, 6, C.plastic, { y: h + 0.95, x: 3, z: -0.7, rz: Math.PI / 2 }, 0, { bottom: true });
  if (!lod) b.box(w, 0.9, 0.12, C.white, { y: h, z: d / 2 - 0.06 }, Flag.Paint);
};
const houseTiled = (b: MeshBuilder, lod: number) => {
  const w = 9, d = 7.5, h = 3.4;
  b.box(w, h, d, C.cream, {}, Flag.Paint, { sideFlag: Flag.Paint });
  if (lod < 2) { windows(b, w, d, 1, 3); b.box(1.1, 2.1, 0.08, C.door, { z: d / 2 + 0.03, x: 1.5 }); }
  b.hip(w, d, 2.2, C.tile, { y: h });
  if (!lod) { b.box(3.6, 0.15, 2.6, C.wood, { y: 2.6, z: d / 2 + 1.3, x: -2 }, Flag.Wood); for (const x of [-3.6, -0.4]) b.box(0.12, 2.6, 0.12, C.wood, { x, z: d / 2 + 2.4 }, Flag.Wood); }
};
const apartments = (b: MeshBuilder, lod: number) => {
  const w = 16, d = 11, h = 10.5;
  b.box(w, h, d, C.white, {}, Flag.Paint, { top: C.concrete, sideFlag: Flag.Paint });
  if (lod >= 2) return;
  windows(b, w, d, 3, 3.3);
  for (let f = 1; f < 4; f++) b.box(w + 0.4, 0.16, 1.6, C.concrete, { y: f * 3.3, z: d / 2 + 0.8 });
  if (!lod) for (let i = 0; i < 3; i++) b.box(1.8, 0.08, 1.2, C.panel, { y: h + 0.4, x: -5 + i * 3.5, rx: -0.5 });
};
const chapel = (b: MeshBuilder, lod: number) => {
  b.box(5, 4, 8, C.white, {}, 0);
  b.gable(5, 8, 1.6, C.tile, { y: 4, ry: Math.PI / 2 }, C.white);
  if (lod < 2) { b.box(1.5, 2.5, 1.5, C.white, { z: 4.6 }); b.hip(1.5, 1.5, 0.9, C.tile, { y: 2.5, z: 4.6 }); b.box(1, 2, 0.06, C.door, { z: 4.04, y: 0 }); }
};
const shed = (b: MeshBuilder) => { b.box(3.5, 2.3, 2.6, C.metal, {}, 0); b.box(3.8, 0.1, 3, hex(0x7c8084), { y: 2.3, rx: 0.08 }); b.box(0.9, 1.9, 0.05, C.darkMetal, { z: 1.31 }); };
const greenhouse = (b: MeshBuilder) => { b.box(8, 2.2, 20, hex(0xd6ded9), {}, 0); b.gable(8, 20, 1.3, hex(0xe2e8e4), { y: 2.2, ry: Math.PI / 2 }); };
const warehouse = (b: MeshBuilder, lod: number) => { b.box(20, 7, 14, hex(0xa9adae), {}, 0, { top: hex(0x8e9396) }); if (lod < 2) b.box(5, 4.5, 0.1, C.darkMetal, { z: 7.05 }); };
const wall = (b: MeshBuilder) => { b.box(1, 1.3, 0.3, C.stone, {}, 0); };
const fence = (b: MeshBuilder) => { b.box(0.06, 1.5, 0.06, C.darkMetal, { x: -0.5 }); b.box(1, 1.3, 0.02, hex(0x6f7377), { y: 0.15 }); };
const woodFence = (b: MeshBuilder) => { for (const y of [0.35, 0.95]) b.box(1, 0.12, 0.05, C.wood, { y }, Flag.Wood); b.box(0.09, 1.2, 0.09, C.wood, { x: -0.5 }, Flag.Wood); };
const pool = (b: MeshBuilder) => { b.box(8.6, 0.2, 4.6, C.white, {}, 0); b.box(8, 0.03, 4, C.water, { y: 0.2 }, 0); };
const powerPole = (b: MeshBuilder, lod: number) => {
  b.cyl(0.13, 0.1, 9, lod ? 4 : 6, hex(0x5e4a38), {}, Flag.Wood);
  b.box(1.8, 0.12, 0.12, hex(0x5e4a38), { y: 8.3 }, Flag.Wood);
  if (!lod) for (const x of [-0.8, 0, 0.8]) b.cyl(0.05, 0.05, 0.2, 4, C.white, { x, y: 8.42 });
};
const streetLamp = (b: MeshBuilder, lod: number) => {
  b.cyl(0.07, 0.05, 6, lod ? 4 : 6, hex(0x6c7075), {});
  b.box(1.3, 0.08, 0.08, hex(0x6c7075), { y: 6, x: 0.6 });
  b.box(0.5, 0.14, 0.25, C.lamp, { y: 5.86, x: 1.15 }, Flag.Lamp);
};

/* ---------------------------------------------------------------- vehicles and props */

const car = (b: MeshBuilder, lod: number, abandoned = false) => {
  const body = abandoned ? C.rust : C.cloth;
  b.box(4.2, 0.75, 1.75, body, { y: 0.32 }, abandoned ? 0 : Flag.Paint);
  b.box(2.3, 0.62, 1.6, abandoned ? hex(0x5e3a24) : C.glass, { y: 1.07, x: -0.2 }, abandoned ? 0 : Flag.Glass);
  if (lod) return;
  b.box(2.24, 0.06, 1.62, body, { y: 1.69, x: -0.2 }, abandoned ? 0 : Flag.Paint);
  for (const [x, z] of [[1.35, 0.8], [-1.35, 0.8], [1.35, -0.8], [-1.35, -0.8]]) b.cyl(0.32, 0.32, 0.22, 7, C.tyre, { x, z: z + (z > 0 ? -0.11 : -0.11), y: 0.32, rx: Math.PI / 2 }, 0, { bottom: true });
};
const pickup = (b: MeshBuilder, lod: number) => {
  b.box(5, 0.8, 1.85, C.cloth, { y: 0.4 }, Flag.Paint);
  b.box(1.9, 0.75, 1.75, C.glass, { y: 1.2, x: 0.9 }, Flag.Glass);
  if (lod) return;
  b.box(1.86, 0.06, 1.77, C.cloth, { y: 1.95, x: 0.9 }, Flag.Paint);
  for (const [x, z] of [[1.6, 0.82], [-1.6, 0.82], [1.6, -0.82], [-1.6, -0.82]]) b.cyl(0.36, 0.36, 0.24, 7, C.tyre, { x, z: z - 0.12, y: 0.36, rx: Math.PI / 2 }, 0, { bottom: true });
};
const lpgTank = (b: MeshBuilder) => {
  b.cyl(0.55, 0.55, 2.4, 8, C.plastic, { rz: Math.PI / 2, x: 1.2, y: 0.85 }, 0, { bottom: true });
  for (const x of [-0.7, 0.7]) b.box(0.15, 0.4, 0.9, C.darkMetal, { x });
  b.cyl(0.1, 0.1, 0.25, 5, C.darkMetal, { y: 1.35 });
};
const gasBottle = (b: MeshBuilder) => {
  b.cyl(0.15, 0.15, 0.5, 8, C.cloth, {}, Flag.Paint, { bottom: true });
  b.cyl(0.15, 0.06, 0.08, 8, C.cloth, { y: 0.5 }, Flag.Paint);
  b.cyl(0.03, 0.03, 0.08, 4, C.metal, { y: 0.58 });
  b.cyl(0.1, 0.1, 0.04, 6, C.darkMetal, { y: 0.0 });
};
const campCanister = (b: MeshBuilder) => { b.cyl(0.055, 0.055, 0.1, 7, hex(0x3a68b8), {}, 0, { bottom: true }); b.cyl(0.02, 0.02, 0.03, 4, C.metal, { y: 0.1 }); };
const jerrycan = (b: MeshBuilder) => { b.box(0.35, 0.45, 0.17, C.cloth, {}, Flag.Paint); b.box(0.2, 0.04, 0.04, C.cloth, { y: 0.47 }, Flag.Paint); b.cyl(0.025, 0.025, 0.06, 4, C.darkMetal, { y: 0.45, x: 0.12 }); };
const aerosol = (b: MeshBuilder) => { b.cyl(0.03, 0.03, 0.19, 6, C.cloth, {}, Flag.Paint, { bottom: true }); b.cyl(0.015, 0.015, 0.02, 4, C.white, { y: 0.19 }); };
const paintCan = (b: MeshBuilder) => { b.cyl(0.12, 0.12, 0.2, 7, C.metal, {}, 0, { bottom: true }); b.cyl(0.121, 0.121, 0.08, 7, C.cloth, { y: 0.06 }, Flag.Paint, { top: false }); };
const drum = (b: MeshBuilder) => { b.cyl(0.29, 0.29, 0.88, 8, C.cloth, {}, Flag.Paint, { bottom: true }); for (const y of [0.29, 0.58]) b.cyl(0.3, 0.3, 0.03, 8, C.darkMetal, { y }, 0, { top: false }); };
const tyre = (b: MeshBuilder) => { b.ring(0.3, 0.1, 8, C.tyre); };
const tyreStack = (b: MeshBuilder) => { for (let i = 0; i < 4; i++) b.ring(0.3, 0.1, 8, C.tyre, { y: i * 0.2, x: (i % 2) * 0.04 }); };
const pallet = (b: MeshBuilder) => { for (let i = 0; i < 5; i++) b.box(0.1, 0.02, 1.2, C.woodLight, { y: 0.12, x: -0.5 + i * 0.25 }, Flag.Wood); for (const z of [-0.5, 0, 0.5]) b.box(1.2, 0.1, 0.1, C.woodLight, { z }, Flag.Wood); };
const mattress = (b: MeshBuilder) => { b.box(1.9, 0.2, 1.4, hex(0xe0dacb), {}, 0); b.box(1.9, 0.02, 0.15, hex(0x7a8fb0), { y: 0.2 }); };
const cardboard = (b: MeshBuilder) => { b.box(0.6, 0.45, 0.45, C.cardboard, {}, 0); };
const bag = (b: MeshBuilder) => { b.blob(0.3, C.cloth, { y: 0.24 }, Flag.Paint, 0, 0.35, 0.8); b.cyl(0.05, 0.01, 0.12, 4, C.cloth, { y: 0.45 }, Flag.Paint); };
const sofa = (b: MeshBuilder) => { b.box(1.9, 0.45, 0.85, C.cloth, {}, Flag.Paint); b.box(1.9, 0.5, 0.2, C.cloth, { y: 0.45, z: -0.33 }, Flag.Paint); for (const x of [-0.85, 0.85]) b.box(0.2, 0.25, 0.85, C.cloth, { y: 0.45, x }, Flag.Paint); };
const fridge = (b: MeshBuilder) => { b.box(0.7, 1.7, 0.7, C.plastic, {}, 0); b.box(0.04, 0.4, 0.04, C.metal, { y: 1, z: 0.36, x: 0.25 }); };
const rubble = (b: MeshBuilder) => { for (let i = 0; i < 5; i++) b.blob(0.4 - i * 0.04, C.rubble, { x: (i % 3) * 0.4 - 0.4, y: 0.12, z: (i % 2) * 0.4 - 0.2 }, 0, 0, 0.5, 0.6); };
const branches = (b: MeshBuilder) => {
  for (let i = 0; i < 8; i++) b.cyl(0.05, 0.02, 2.2, 3, C.dead, { ry: i * 0.8, rz: Math.PI / 2 - 0.15, x: -1 + (i % 3) * 0.4, y: 0.1 + (i % 4) * 0.12 }, Flag.Wood);
  b.blob(0.8, C.dryShrub, { y: 0.4 }, Flag.Foliage, 1, 0.5, 0.55);
  b.blob(0.6, mix(C.dryShrub, C.pine, 0.4), { x: 0.7, y: 0.35 }, Flag.Foliage, 0, 0.4, 0.6);
};
const bottles = (b: MeshBuilder) => { for (let i = 0; i < 4; i++) b.cyl(0.035, 0.035, 0.24, 5, i % 2 ? hex(0x6fa8c0) : hex(0x3c7a3c), { rz: Math.PI / 2, x: i * 0.2, z: (i % 3) * 0.15, y: 0.035, ry: i }); };
const plasticSheet = (b: MeshBuilder) => { b.quad([-1, 0.03, -0.8], [1, 0.05, -0.9], [1.1, 0.08, 0.8], [-0.9, 0.03, 0.9], hex(0x3c6aa8), Flag.Paint); };
const woodpile = (b: MeshBuilder, lod: number) => {
  if (lod) { b.box(2, 1, 0.8, C.wood, {}, Flag.Wood); return; }
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6 - r; i++) b.cyl(0.11, 0.11, 0.8, 5, i % 2 ? C.wood : C.woodLight, { rx: Math.PI / 2, x: -0.6 + i * 0.24 + r * 0.12, y: 0.11 + r * 0.2, z: 0.4 }, Flag.Wood, { bottom: true });
};
const bbq = (b: MeshBuilder) => { b.box(0.9, 0.3, 0.5, C.darkMetal, { y: 0.75 }); for (const [x, z] of [[-0.4, -0.2], [0.4, -0.2], [-0.4, 0.2], [0.4, 0.2]]) b.box(0.04, 0.75, 0.04, C.darkMetal, { x, z }); };
const patio = (b: MeshBuilder) => {
  b.cyl(0.5, 0.5, 0.04, 8, C.plastic, { y: 0.72 }); b.cyl(0.04, 0.04, 0.72, 4, C.plastic, {});
  for (let i = 0; i < 3; i++) { const a = i * 2.1; b.box(0.45, 0.45, 0.45, C.plastic, { x: Math.cos(a) * 0.95, z: Math.sin(a) * 0.95, ry: -a }); b.box(0.45, 0.45, 0.05, C.plastic, { x: Math.cos(a) * 1.15, y: 0.45, z: Math.sin(a) * 1.15, ry: -a + Math.PI / 2 }); }
};
const parasol = (b: MeshBuilder) => { b.cyl(0.03, 0.03, 2.2, 4, C.plastic, {}); b.cyl(1.3, 0, 0.5, 8, C.cloth, { y: 1.85 }, Flag.Paint, { bottom: true }); };
const wheelieBin = (b: MeshBuilder) => { b.box(0.6, 1, 0.7, hex(0x2f6b3f), {}, 0); b.box(0.64, 0.06, 0.74, hex(0x285c36), { y: 1 }); };
const dumpster = (b: MeshBuilder) => { b.box(1.35, 1.15, 1.05, hex(0x2d6a3e), { y: 0.15 }); b.box(1.4, 0.08, 1.1, hex(0x244f30), { y: 1.3, rx: 0.06 }); for (const x of [-0.55, 0.55]) b.cyl(0.08, 0.08, 0.15, 5, C.tyre, { x }); };
const waterTank = (b: MeshBuilder) => { for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) b.box(0.08, 1.2, 0.08, C.darkMetal, { x, z }); b.cyl(0.7, 0.7, 1.3, 8, C.black, { y: 1.2 }); };
const hayBale = (b: MeshBuilder) => { b.cyl(0.65, 0.65, 1.2, 9, C.hay, { rz: Math.PI / 2, x: 0.6, y: 0.65 }, 0, { bottom: true }); };

/* ---------------------------------------------------------------- agents (limb code + pivot/10 in aMeta.x) */

const limb = (code: number, pivot: number) => code + Math.min(0.999, pivot / 10);
function agentMesh(fn: (part: (code: number, pivot: number, draw: (b: MeshBuilder) => void) => void) => void): MeshArrays {
  const parts: MeshArrays[] = [];
  fn((code, pivot, draw) => { const b = new MeshBuilder(code + 3); draw(b); const m = b.build(0); for (let i = 0; i < m.meta.length; i += 2) m.meta[i] = limb(code, pivot); parts.push(m); });
  const n = parts.reduce((s, p) => s + p.position.length, 0);
  const out: MeshArrays = { position: new Float32Array(n), color: new Float32Array(n), meta: new Float32Array((n / 3) * 2), params: new Float32Array(0) };
  let o = 0;
  for (const p of parts) { out.position.set(p.position, o); out.color.set(p.color, o); out.meta.set(p.meta, (o / 3) * 2); o += p.position.length; }
  return out;
}
const person = () => agentMesh(part => {
  part(1, 0.95, b => b.box(0.15, 0.92, 0.16, C.pants, { x: -0.1 }));
  part(2, 0.95, b => b.box(0.15, 0.92, 0.16, C.pants, { x: 0.1 }));
  part(0, 0, b => { b.box(0.42, 0.58, 0.24, C.cloth, { y: 0.92 }, Flag.Paint); b.box(0.22, 0.24, 0.22, C.skin, { y: 1.52 }); b.box(0.24, 0.07, 0.24, C.hair, { y: 1.74 }); b.box(0.08, 0.06, 0.08, C.skin, { y: 1.5 }); });
  part(3, 1.45, b => b.box(0.11, 0.6, 0.12, C.cloth, { x: -0.27, y: 0.88 }, Flag.Paint));
  part(4, 1.45, b => b.box(0.11, 0.6, 0.12, C.cloth, { x: 0.27, y: 0.88 }, Flag.Paint));
});
const quadruped = (len: number, h: number, body: Rgb, head: Rgb, opts: { horns?: boolean; wool?: boolean; tail?: boolean } = {}) => () => agentMesh(part => {
  const leg = h * 0.55, w = len * 0.32;
  part(1, leg, b => { b.box(0.08 * len, leg, 0.08 * len, head, { x: -w / 2, z: len * 0.38 }); b.box(0.08 * len, leg, 0.08 * len, head, { x: w / 2, z: -len * 0.38 }); });
  part(2, leg, b => { b.box(0.08 * len, leg, 0.08 * len, head, { x: w / 2, z: len * 0.38 }); b.box(0.08 * len, leg, 0.08 * len, head, { x: -w / 2, z: -len * 0.38 }); });
  part(0, 0, b => {
    if (opts.wool) b.blob(len * 0.45, body, { y: leg + h * 0.18 }, 0, 1, 0.25, 0.8);
    else b.box(w, h * 0.38, len * 0.92, body, { y: leg });
    b.box(w * 0.7, h * 0.3, len * 0.28, head, { y: leg + h * 0.32, z: len * 0.55 });
    if (opts.horns) for (const x of [-0.05, 0.05]) b.cyl(0.02, 0, 0.18, 3, C.barkGrey, { x, y: leg + h * 0.62, z: len * 0.5, rx: -0.6 });
  });
  if (opts.tail) part(9, leg + h * 0.3, b => b.box(0.05, 0.05, len * 0.35, body, { y: leg + h * 0.3, z: -len * 0.62, rx: -0.5 }));
});
const bird = () => agentMesh(part => {
  part(0, 0, b => { b.box(0.08, 0.07, 0.26, C.bird, {}); b.cyl(0.02, 0, 0.06, 3, hex(0xc8a040), { z: 0.13, y: 0.03, rx: Math.PI / 2 }); });
  part(7, 0.05, b => { b.tri([0, 0.05, 0.06], [-0.32, 0.05, -0.02], [0, 0.05, -0.08], C.bird); b.tri([0, 0.05, 0.06], [0, 0.05, -0.08], [-0.32, 0.05, -0.02], C.bird); });
  part(8, 0.05, b => { b.tri([0, 0.05, 0.06], [0, 0.05, -0.08], [0.32, 0.05, -0.02], C.bird); b.tri([0, 0.05, 0.06], [0.32, 0.05, -0.02], [0, 0.05, -0.08], C.bird); });
});

/* ---------------------------------------------------------------- emergency units (forward = +x) */

const beacon = (b: MeshBuilder, x: number, y: number, w: number) => {
  b.box(0.22, 0.14, w * 0.42, hex(0xff2a1a), { x, y, z: w * 0.27 }, Flag.Beacon);
  b.box(0.22, 0.14, w * 0.42, hex(0x2a5cff), { x, y, z: -w * 0.27 }, Flag.Beacon);
};
const wheels = (b: MeshBuilder, xs: number[], z: number, r: number) => {
  for (const x of xs) for (const s of [1, -1]) b.cyl(r, r, 0.3, 7, C.tyre, { x, z: s * z - 0.15, y: r, rx: Math.PI / 2 }, 0, { bottom: true });
};
const fireEngine = (b: MeshBuilder, lod: number) => {
  const red = hex(0xb0221c), white = hex(0xe8e6e0);
  b.box(5.4, 2.3, 2.45, red, { x: -1.1, y: 0.75 });
  b.box(0.1, 0.18, 2.47, white, { x: -1.1, y: 1.5 });
  b.box(2.2, 2.0, 2.45, red, { x: 2.7, y: 0.75 });
  b.box(0.06, 0.8, 2.1, C.glass, { x: 3.81, y: 1.7 }, Flag.Glass);
  if (lod) return;
  b.box(4.6, 0.12, 0.5, C.metal, { x: -1.1, y: 3.05, z: 0.7 });
  b.box(4.6, 0.12, 0.5, C.metal, { x: -1.1, y: 3.05, z: -0.7 });
  b.box(2.3, 0.5, 0.06, C.darkMetal, { x: -1.6, y: 1.3, z: 1.25 });
  b.box(2.3, 0.5, 0.06, C.darkMetal, { x: -1.6, y: 1.3, z: -1.25 });
  beacon(b, 3.2, 2.75, 2.2);
  wheels(b, [2.6, -1.0, -2.6], 1.1, 0.5);
};
const emsVan = (b: MeshBuilder, lod: number) => {
  const yellow = hex(0xe6c51f), white = hex(0xf2f1ec);
  b.box(3.8, 2.2, 2.1, white, { x: -0.7, y: 0.45 });
  b.box(3.84, 0.28, 2.14, yellow, { x: -0.7, y: 1.1 });
  b.box(1.6, 1.4, 2.0, white, { x: 1.9, y: 0.45 });
  b.box(0.06, 0.6, 1.8, C.glass, { x: 2.71, y: 1.15 }, Flag.Glass);
  if (lod) return;
  beacon(b, 1.3, 2.65, 1.9);
  wheels(b, [1.9, -1.8], 0.92, 0.38);
};
const policeCar = (b: MeshBuilder, lod: number) => {
  const white = hex(0xf0f0ee), blue = hex(0x1e3f8a);
  b.box(4.5, 0.75, 1.8, white, { y: 0.32 });
  b.box(4.52, 0.2, 1.82, blue, { y: 0.6 });
  b.box(2.4, 0.62, 1.65, C.glass, { y: 1.07, x: -0.2 }, Flag.Glass);
  if (lod) return;
  b.box(2.3, 0.06, 1.66, white, { y: 1.69, x: -0.2 });
  beacon(b, -0.2, 1.75, 1.3);
  wheels(b, [1.4, -1.4], 0.85, 0.32);
};
const dozer = (b: MeshBuilder, lod: number) => {
  const yellow = hex(0xd9a21b);
  b.box(4.2, 0.9, 0.7, C.black, { z: 1.15 });
  b.box(4.2, 0.9, 0.7, C.black, { z: -1.15 });
  b.box(3.4, 1.3, 1.7, yellow, { y: 0.7 });
  b.box(1.6, 1.4, 1.5, yellow, { x: -0.6, y: 2.0 });
  b.box(0.3, 1.5, 3.8, C.darkMetal, { x: 2.7, y: 0.05 });
  if (lod) return;
  b.box(1.5, 0.9, 1.52, C.glass, { x: -0.6, y: 2.3 }, Flag.Glass);
  beacon(b, -0.6, 3.42, 1.0);
};
const helicopter = (b: MeshBuilder, lod: number) => {
  const red = hex(0xc8321e), white = hex(0xe8e6e0);
  b.blob(1.6, red, { y: 1.9, sx: 2.3, sz: 0.85 }, 0, lod ? 0 : 1, 0.05, 1);
  b.box(6.5, 0.45, 0.4, white, { x: -5.6, y: 2.3 });
  b.box(0.9, 1.5, 0.12, red, { x: -8.8, y: 2.3 });
  for (let i = 0; i < 4; i++) b.box(5.2, 0.08, 0.3, C.darkMetal, { y: 3.7, ry: 0.4 + i * Math.PI / 2, x: Math.cos(0.4 + i * Math.PI / 2) * 2.6, z: -Math.sin(0.4 + i * Math.PI / 2) * 2.6 });
  if (lod) return;
  b.box(1.4, 0.9, 1.3, C.glass, { x: 2.3, y: 1.8 }, Flag.Glass);
  b.box(3.4, 0.1, 0.12, C.darkMetal, { y: 0.1, z: 1.0 });
  b.box(3.4, 0.1, 0.12, C.darkMetal, { y: 0.1, z: -1.0 });
};
const airTanker = (b: MeshBuilder, lod: number) => {
  const yellow = hex(0xe8c22a), red = hex(0xc22a1e);
  b.box(19, 2.6, 2.5, yellow, { y: 0.4 });
  b.box(19.04, 0.5, 2.54, red, { y: 0.4 });
  b.box(2.6, 4.0, 0.2, yellow, { x: -8.4, y: 2.5 });
  b.box(3.2, 0.25, 28, yellow, { x: 1, y: 3.4 });
  b.box(2.4, 0.2, 8, yellow, { x: -8.6, y: 6.2 });
  if (lod) return;
  for (const z of [-4.5, 4.5]) b.cyl(0.7, 0.6, 3.6, 6, red, { x: 3.2, y: 2.9, z, rz: -Math.PI / 2 });
  b.box(1.6, 0.8, 2.1, C.glass, { x: 8.2, y: 2.4 }, Flag.Glass);
};
const quadDrone = (b: MeshBuilder) => {
  b.box(0.36, 0.14, 0.36, hex(0x2a2c30), { y: 0.05 });
  b.box(1.1, 0.04, 0.06, hex(0x3a3c40), { y: 0.12, ry: Math.PI / 4 });
  b.box(1.1, 0.04, 0.06, hex(0x3a3c40), { y: 0.12, ry: -Math.PI / 4 });
  for (const [x, z] of [[0.39, 0.39], [-0.39, 0.39], [0.39, -0.39], [-0.39, -0.39]]) b.cyl(0.2, 0.2, 0.01, 6, hex(0x9aa0a6), { x, z, y: 0.15 });
  b.box(0.06, 0.06, 0.06, hex(0xff2a1a), { x: 0.2, y: 0.02 }, Flag.Beacon);
};
/* ---------------------------------------------------------------- table */

type Def = Omit<Archetype, 'build' | 'lodCount' | 'kind' | 'maxTier' | 'shadow' | 'sens'> & Partial<Pick<Archetype, 'kind' | 'maxTier' | 'shadow' | 'sens'>> & { b: (b: MeshBuilder, lod: number) => number | void; n?: number; wind?: number };
const T = TruthClass;
const DEFS: Def[] = [
  { id: 'aleppo-pine', label: 'Aleppo pine', cls: T.Tree, material: 'resinous conifer, needle crown', flam: 3, kind: 'veg', maxTier: 2, sens: 0.35, b: aleppoPine, n: 3, wind: 9 },
  { id: 'pine-young', label: 'Young Aleppo pine', cls: T.Tree, material: 'resinous conifer sapling', flam: 3, kind: 'veg', maxTier: 1, sens: 0.4, b: (b, l) => { aleppoPine(b, Math.max(1, l)); }, n: 3, wind: 9 },
  { id: 'cypress', label: 'Italian cypress', cls: T.Tree, material: 'dense conifer foliage', flam: 2, kind: 'veg', maxTier: 2, sens: 0.2, b: cypress, n: 3, wind: 10 },
  { id: 'olive', label: 'Olive tree', cls: T.Tree, material: 'evergreen broadleaf, low resin', flam: 1, kind: 'veg', maxTier: 2, sens: 0.15, b: olive, n: 3, wind: 4 },
  { id: 'carob', label: 'Carob / holm oak', cls: T.Tree, material: 'evergreen broadleaf', flam: 2, kind: 'veg', maxTier: 2, sens: 0.15, b: broadleaf(C.carob), n: 3, wind: 6 },
  { id: 'fig', label: 'Fig tree', cls: T.Tree, material: 'deciduous broadleaf', flam: 1, kind: 'veg', maxTier: 2, sens: 0.1, deciduous: true, b: broadleaf(hex(0x5e7f37)), n: 3, wind: 6 },
  { id: 'citrus', label: 'Citrus tree', cls: T.Tree, material: 'irrigated evergreen broadleaf', flam: 1, kind: 'veg', maxTier: 1, sens: 0.05, b: citrus, n: 2, wind: 3 },
  { id: 'palm', label: 'Palm', cls: T.Tree, material: 'fibrous fronds, dead skirt', flam: 2, kind: 'veg', maxTier: 2, sens: 0.2, b: palm, n: 2, wind: 7 },
  { id: 'maquis', label: 'Maquis shrub (kermes oak, mastic)', cls: T.Shrub, material: 'dense evergreen sclerophyll', flam: 3, kind: 'veg', maxTier: 1, sens: 0.45, b: shrub(C.maquis, 4), n: 2, wind: 2 },
  { id: 'oleander', label: 'Oleander hedge', cls: T.Shrub, material: 'irrigated ornamental shrub', flam: 1, kind: 'veg', maxTier: 1, sens: 0.05, b: shrub(mix(hex(0x3f6a33), C.leafPink, 0.15), 3), n: 2, wind: 2 },
  { id: 'broom', label: 'Spanish broom', cls: T.Shrub, material: 'fine twigs, seasonal flowers', flam: 3, kind: 'veg', maxTier: 1, sens: 0.6, b: shrub(hex(0x6f7d34), 3), n: 2, wind: 2 },
  { id: 'phrygana', label: 'Phrygana cushion (thyme, sage)', cls: T.Shrub, material: 'aromatic low shrub, volatile oils', flam: 3, kind: 'veg', maxTier: 1, sens: 0.6, b: cushion, n: 2, wind: 1 },
  { id: 'dry-shrub', label: 'Dead / drought-killed shrub', cls: T.DeadVegetation, material: 'dead fine fuel', flam: 4, kind: 'veg', maxTier: 1, sens: 0, b: deadShrub, n: 2, wind: 1.5 },
  { id: 'snag', label: 'Standing dead pine (2009 burn scar)', cls: T.DeadVegetation, material: 'dead standing wood', flam: 2, kind: 'rigid', maxTier: 2, sens: 0, b: snag, n: 2 },
  { id: 'grass', label: 'Annual grass clump', cls: T.Grass, material: 'fine herbaceous fuel', flam: 2, kind: 'grass', maxTier: 0, shadow: false, sens: 1, b: grassClump },
  { id: 'tall-grass', label: 'Tall wild oats / weeds', cls: T.Grass, material: 'fine herbaceous fuel, tall', flam: 3, kind: 'grass', maxTier: 0, shadow: false, sens: 1, b: tallGrass },
  { id: 'reeds', label: 'Giant reed (Arundo)', cls: T.Grass, material: 'dense tall cane', flam: 3, kind: 'grass', maxTier: 1, shadow: true, sens: 0.5, b: reeds },
  { id: 'vine-row', label: 'Vine row', cls: T.Crop, material: 'irrigated deciduous crop', flam: 1, kind: 'veg', maxTier: 1, sens: 0.2, deciduous: true, b: vineRow, n: 2, wind: 1.3 },
  { id: 'needle-litter', label: 'Pine needle litter', cls: T.Litter, material: 'dead surface fuel bed', flam: 3, kind: 'rigid', maxTier: 0, shadow: false, b: litter },
  { id: 'fallen-log', label: 'Fallen log', cls: T.DeadVegetation, material: 'dead coarse woody fuel', flam: 2, kind: 'rigid', maxTier: 0, b: log },
  { id: 'rock', label: 'Limestone boulder', cls: T.NonCombustibleDebris, material: 'rock', flam: 0, kind: 'rigid', maxTier: 1, b: rock },

  { id: 'house-flat', label: 'Flat-roof concrete house', cls: T.Structure, material: 'reinforced concrete, timber/plastic fittings', flam: 1, maxTier: 2, b: houseFlat, n: 3 },
  { id: 'foundation', label: 'Simulated masonry foundation', cls: T.Structure, material: 'concrete', flam: 0, maxTier: 2, shadow: false, b: b => b.box(1, 1, 1, C.concrete, {}, Flag.Paint) },
  { id: 'house-tiled', label: 'Tiled-roof house', cls: T.Structure, material: 'masonry, timber roof frame, pergola', flam: 2, maxTier: 2, b: houseTiled, n: 3 },
  { id: 'apartments', label: 'Apartment block', cls: T.Structure, material: 'reinforced concrete', flam: 1, maxTier: 2, b: apartments, n: 3 },
  { id: 'chapel', label: 'Chapel', cls: T.Structure, material: 'masonry, tiled roof', flam: 1, maxTier: 2, b: chapel, n: 3 },
  { id: 'shed', label: 'Metal shed', cls: T.Structure, material: 'sheet metal, stored contents', flam: 2, maxTier: 1, b: shed },
  { id: 'greenhouse', label: 'Greenhouse', cls: T.Structure, material: 'polyethylene film on frame', flam: 3, hazard: 'plastics', maxTier: 2, b: greenhouse },
  { id: 'warehouse', label: 'Warehouse / workshop', cls: T.Structure, material: 'steel frame, stored goods', flam: 2, maxTier: 2, b: warehouse, n: 3 },
  { id: 'wall', label: 'Stone wall segment', cls: T.Fence, material: 'stone', flam: 0, maxTier: 1, b: wall },
  { id: 'fence', label: 'Chain-link fence segment', cls: T.Fence, material: 'steel mesh', flam: 0, maxTier: 0, b: fence },
  { id: 'wood-fence', label: 'Timber fence segment', cls: T.Fence, material: 'dry timber', flam: 3, maxTier: 0, b: woodFence },
  { id: 'pool', label: 'Swimming pool', cls: T.Structure, material: 'water', flam: 0, maxTier: 1, shadow: false, b: pool },
  { id: 'power-pole', label: 'Timber power pole', cls: T.Utility, material: 'treated timber, overhead line', flam: 2, maxTier: 2, b: powerPole, n: 2 },
  { id: 'street-lamp', label: 'Street lamp', cls: T.Utility, material: 'steel', flam: 0, maxTier: 1, b: streetLamp, n: 2 },
  { id: 'water-tank', label: 'Plastic water tank', cls: T.Utility, material: 'polyethylene', flam: 2, hazard: 'plastics', maxTier: 1, b: waterTank },

  { id: 'car', label: 'Parked car', cls: T.Vehicle, material: 'vehicle: fuel tank, tyres, plastics', flam: 3, hazard: 'liquid-fuel', maxTier: 1, b: (b, l) => car(b, l), n: 2 },
  { id: 'pickup', label: 'Pickup truck', cls: T.Vehicle, material: 'vehicle: fuel tank, tyres, plastics', flam: 3, hazard: 'liquid-fuel', maxTier: 1, b: pickup, n: 2 },
  { id: 'abandoned-car', label: 'Abandoned car wreck', cls: T.Vehicle, material: 'rusted shell, seats, tyres', flam: 2, hazard: 'tyres', maxTier: 1, b: (b, l) => car(b, l, true), n: 2 },
  { id: 'lpg-tank', label: 'Domestic LPG tank', cls: T.FuelContainer, material: 'pressurized propane vessel', flam: 4, hazard: 'pressurized-gas', maxTier: 1, b: lpgTank },
  { id: 'gas-bottle', label: 'LPG gas bottle', cls: T.FuelContainer, material: 'pressurized butane/propane cylinder', flam: 4, hazard: 'pressurized-gas', maxTier: 0, b: gasBottle },
  { id: 'camp-canister', label: 'Camping gas canister', cls: T.FuelContainer, material: 'pressurized butane cartridge', flam: 4, hazard: 'pressurized-gas', maxTier: 0, b: campCanister },
  { id: 'jerrycan', label: 'Fuel jerrycan', cls: T.FuelContainer, material: 'petrol/diesel container', flam: 4, hazard: 'liquid-fuel', maxTier: 0, b: jerrycan },
  { id: 'aerosol', label: 'Aerosol can', cls: T.FuelContainer, material: 'pressurized propellant', flam: 4, hazard: 'aerosol', maxTier: 0, b: aerosol },
  { id: 'paint-can', label: 'Paint / solvent can', cls: T.FuelContainer, material: 'solvent residue', flam: 3, hazard: 'flammable-liquid', maxTier: 0, b: paintCan },
  { id: 'oil-drum', label: 'Oil drum', cls: T.FuelContainer, material: 'steel drum, oil residue', flam: 3, hazard: 'flammable-liquid', maxTier: 0, b: drum },
  { id: 'tyre', label: 'Discarded tyre', cls: T.CombustibleDebris, material: 'rubber', flam: 3, hazard: 'tyres', maxTier: 0, b: tyre },
  { id: 'tyre-stack', label: 'Tyre stack', cls: T.CombustibleDebris, material: 'rubber', flam: 3, hazard: 'tyres', maxTier: 0, b: tyreStack },
  { id: 'pallet', label: 'Wooden pallet', cls: T.CombustibleDebris, material: 'dry timber', flam: 3, maxTier: 0, b: pallet },
  { id: 'mattress', label: 'Mattress', cls: T.CombustibleDebris, material: 'foam, fabric', flam: 4, maxTier: 0, b: mattress },
  { id: 'cardboard', label: 'Cardboard box', cls: T.CombustibleDebris, material: 'paper', flam: 3, maxTier: 0, b: cardboard },
  { id: 'trash-bag', label: 'Garbage bag', cls: T.CombustibleDebris, material: 'plastic, mixed waste', flam: 3, hazard: 'plastics', maxTier: 0, b: bag },
  { id: 'sofa', label: 'Discarded sofa', cls: T.Furniture, material: 'foam upholstery, timber', flam: 4, maxTier: 0, b: sofa },
  { id: 'fridge', label: 'Discarded fridge', cls: T.NonCombustibleDebris, material: 'steel, insulation foam', flam: 1, maxTier: 0, b: fridge },
  { id: 'rubble', label: 'Construction rubble', cls: T.NonCombustibleDebris, material: 'concrete, brick', flam: 0, maxTier: 0, b: rubble },
  { id: 'branch-pile', label: 'Cut branches / green waste', cls: T.DeadVegetation, material: 'cured cut vegetation', flam: 4, maxTier: 1, b: branches, wind: 1.2 },
  { id: 'bottles', label: 'Bottle litter', cls: T.NonCombustibleDebris, material: 'glass, PET', flam: 1, maxTier: 0, shadow: false, b: bottles },
  { id: 'plastic-sheet', label: 'Plastic sheet', cls: T.CombustibleDebris, material: 'polyethylene film', flam: 3, hazard: 'plastics', maxTier: 0, shadow: false, b: plasticSheet },
  { id: 'woodpile', label: 'Firewood pile', cls: T.CombustibleDebris, material: 'seasoned timber', flam: 3, maxTier: 1, b: woodpile, n: 2 },
  { id: 'bbq', label: 'Barbecue grill', cls: T.Furniture, material: 'steel, charcoal', flam: 1, maxTier: 0, b: bbq },
  { id: 'patio-set', label: 'Plastic patio set', cls: T.Furniture, material: 'polypropylene', flam: 2, hazard: 'plastics', maxTier: 0, b: patio },
  { id: 'parasol', label: 'Parasol', cls: T.Furniture, material: 'fabric canopy', flam: 2, maxTier: 0, b: parasol },
  { id: 'wheelie-bin', label: 'Wheelie bin', cls: T.CombustibleDebris, material: 'HDPE bin, household waste', flam: 3, hazard: 'plastics', maxTier: 0, b: wheelieBin },
  { id: 'dumpster', label: 'Municipal waste container', cls: T.CombustibleDebris, material: 'HDPE container, mixed waste', flam: 3, hazard: 'plastics', maxTier: 1, b: dumpster },
  { id: 'hay-bale', label: 'Hay bale', cls: T.CombustibleDebris, material: 'cured hay', flam: 4, maxTier: 1, b: hayBale },

  { id: 'person', label: 'Person (simulated, fictional)', cls: T.Person, material: 'person', flam: 0, kind: 'agent', maxTier: 1, b: () => {} },
  { id: 'dog', label: 'Dog', cls: T.Animal, material: 'animal', flam: 0, kind: 'agent', maxTier: 1, b: () => {} },
  { id: 'cat', label: 'Cat', cls: T.Animal, material: 'animal', flam: 0, kind: 'agent', maxTier: 0, b: () => {} },
  { id: 'goat', label: 'Goat', cls: T.Animal, material: 'animal', flam: 0, kind: 'agent', maxTier: 1, b: () => {} },
  { id: 'sheep', label: 'Sheep', cls: T.Animal, material: 'animal', flam: 0, kind: 'agent', maxTier: 1, b: () => {} },
  { id: 'bird', label: 'Bird', cls: T.Animal, material: 'animal', flam: 0, kind: 'agent', maxTier: 1, shadow: false, b: () => {} },
  // Emergency response units and aircraft (FIREYE fleet proxies; drawn from live unit positions, never generated).
  { id: 'fire-engine', label: 'Fire engine (simulated unit)', cls: T.EmergencyVehicle, material: 'vehicle: diesel tank, water tank, hoses', flam: 2, hazard: 'liquid-fuel', maxTier: 2, b: fireEngine, n: 2 },
  { id: 'ems-van', label: 'Ambulance (simulated unit)', cls: T.EmergencyVehicle, material: 'vehicle: fuel tank, oxygen cylinders', flam: 2, hazard: 'liquid-fuel', maxTier: 2, b: emsVan, n: 2 },
  { id: 'police-car', label: 'Police car (simulated unit)', cls: T.EmergencyVehicle, material: 'vehicle: fuel tank, tyres, plastics', flam: 2, hazard: 'liquid-fuel', maxTier: 2, b: policeCar, n: 2 },
  { id: 'dozer', label: 'Bulldozer (simulated unit)', cls: T.EmergencyVehicle, material: 'tracked steel vehicle, diesel', flam: 1, maxTier: 2, b: dozer, n: 2 },
  { id: 'helicopter', label: 'Firefighting helicopter (simulated unit)', cls: T.Aircraft, material: 'aircraft, jet fuel', flam: 2, hazard: 'liquid-fuel', maxTier: 2, b: helicopter, n: 2 },
  { id: 'air-tanker', label: 'Amphibious water bomber (simulated unit)', cls: T.Aircraft, material: 'aircraft, water load, fuel', flam: 2, hazard: 'liquid-fuel', maxTier: 2, b: airTanker, n: 2 },
  { id: 'quad-drone', label: 'Survey drone (simulated unit)', cls: T.Aircraft, material: 'carbon frame, lithium battery', flam: 2, maxTier: 2, shadow: false, b: quadDrone },];
const AGENT_MESH: Record<string, () => MeshArrays> = {
  person, dog: quadruped(0.85, 0.6, C.dog, C.dog, { tail: true }), cat: quadruped(0.45, 0.28, C.cat, C.cat, { tail: true }),
  goat: quadruped(1, 0.8, C.goat, hex(0x4e4036), { horns: true, tail: true }), sheep: quadruped(1, 0.75, C.wool, hex(0x3a332c), { wool: true }), bird,
};

export const CATALOG: Archetype[] = DEFS.map(({ b, n, wind, ...d }) => ({
  kind: 'rigid', maxTier: 1, shadow: true, sens: 0, ...d,
  lodCount: n ?? 1,
  build: d.kind === 'agent' ? () => AGENT_MESH[d.id]() : lods(Array.from({ length: n ?? 1 }, (_, i) => (m: MeshBuilder) => b(m, i)), wind ?? 0, d.id.length),
}));
export const ARCHETYPE = new Map(CATALOG.map(a => [a.id, a]));
export const ARCHETYPE_INDEX = new Map(CATALOG.map((a, i) => [a.id, i]));

export function geometryOf(id: string, lod: number): MeshArrays {
  const a = ARCHETYPE.get(id);
  if (!a) throw new Error(`Unknown archetype ${id}`);
  const l = Math.min(a.lodCount - 1, lod), key = `${id}/${l}`;
  let m = memo.get(key);
  if (!m) { m = a.build(l); memo.set(key, m); }
  return m;
}
/** Geometry LOD used at render tier (0 near, 1 mid, 2 far). */
export function lodForTier(a: Archetype, tier: number) { return Math.min(a.lodCount - 1, tier); }
