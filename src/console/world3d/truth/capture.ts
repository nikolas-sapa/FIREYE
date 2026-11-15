import { ARCHETYPE } from '../catalog';
import type { WorldEnv } from '../env';
import { rate, rateSurface, flammabilityCode } from '../flammability';
import { FLAMMABILITY, TruthClass, type Flammability } from '../types';

export const TRUTH_W = 480, TRUTH_H = 270;

export interface TruthObject {
  id: number;
  archetype: string;
  label: string;
  cls: TruthClass;
  material: string;
  flammability: Flammability;
  hazard?: string;
  /** Pixel bounding box [x0, y0, x1, y1] in the 480×270 mask, y down. */
  bbox: [number, number, number, number];
  pixels: number;
  distanceM: number;
  position: [number, number, number];
}
export interface TruthCapture {
  feedId: string;
  width: number;
  height: number;
  /** TruthClass per pixel, row 0 = top. */
  classes: Uint8Array;
  /** Index into FLAMMABILITY per pixel. */
  flammability: Uint8Array;
  objects: TruthObject[];
  classPixels: Partial<Record<keyof typeof TruthClass, number>>;
  env: Pick<WorldEnv, 't' | 'curing' | 'dryness' | 'wet' | 'leaf' | 'season'>;
  camera: { position: [number, number, number]; lon: number; lat: number; altM: number; headingDeg: number; pitchDeg: number; fovDeg: number };
  note: string;
}

export interface ObjectResolver { (id: number): { archetype: string; position: [number, number, number] } | null }

/** Decode an RGBA8 ID pass (bottom-up from readPixels): rgb = 24-bit object id (0xffffff none), a = class. */
export function decodeTruth(feedId: string, rgba: Uint8Array, w: number, h: number, resolve: ObjectResolver, env: TruthCapture['env'], camera: TruthCapture['camera']): TruthCapture {
  const classes = new Uint8Array(w * h), flam = new Uint8Array(w * h);
  const objects = new Map<number, TruthObject>();
  const surfaceCache = new Map<number, number>();
  const grass = flammabilityCode(rate('grass', env).level);
  const counts = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    const row = (h - 1 - y) * w;
    for (let x = 0; x < w; x++) {
      const o = (row + x) * 4, i = y * w + x;
      const cls = rgba[o + 3];
      classes[i] = cls;
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
      const id = rgba[o] | (rgba[o + 1] << 8) | (rgba[o + 2] << 16);
      if (id !== 0xffffff) {
        let ob = objects.get(id);
        if (!ob) {
          const r = resolve(id), a = r ? ARCHETYPE.get(r.archetype) : undefined;
          if (!r || !a) { flam[i] = 0; continue; }
          const rt = rate(a.id, env);
          const dx = r.position[0] - camera.position[0], dy = r.position[1] - camera.position[1], dz = r.position[2] - camera.position[2];
          ob = { id, archetype: a.id, label: a.label, cls: a.cls, material: a.material, flammability: rt.level, hazard: rt.hazard, bbox: [x, y, x, y], pixels: 0, distanceM: Math.hypot(dx, dy, dz), position: r.position };
          objects.set(id, ob);
        }
        ob.pixels++;
        if (x < ob.bbox[0]) ob.bbox[0] = x; if (x > ob.bbox[2]) ob.bbox[2] = x;
        if (y < ob.bbox[1]) ob.bbox[1] = y; if (y > ob.bbox[3]) ob.bbox[3] = y;
        flam[i] = flammabilityCode(ob.flammability);
      } else if (cls === TruthClass.Grass) flam[i] = grass;
      else {
        let f = surfaceCache.get(cls);
        if (f === undefined) { f = flammabilityCode(rateSurface(cls, env).level); surfaceCache.set(cls, f); }
        flam[i] = f;
      }
    }
  }
  const classPixels: TruthCapture['classPixels'] = {};
  for (const [c, n] of counts) { const name = TruthClass[c] as keyof typeof TruthClass | undefined; if (name) classPixels[name] = n; }
  return {
    feedId, width: w, height: h, classes, flammability: flam,
    objects: [...objects.values()].sort((a, b) => b.pixels - a.pixels), classPixels, env, camera,
    note: 'Simulated ground truth for a procedural world: classes and flammability labels describe generated stand-ins derived from land cover, not measured vegetation or real objects. Levels: ' + FLAMMABILITY.join(', ') + '.',
  };
}

/** Debug colours for class masks (linear-free sRGB bytes). */
export const CLASS_COLORS: Partial<Record<TruthClass, [number, number, number]>> = {
  [TruthClass.Sky]: [120, 160, 220], [TruthClass.Water]: [30, 80, 170], [TruthClass.Bare]: [170, 150, 120], [TruthClass.GrassGround]: [200, 190, 90],
  [TruthClass.Litter]: [140, 90, 40], [TruthClass.Sand]: [230, 210, 160], [TruthClass.Paved]: [150, 150, 150], [TruthClass.Road]: [70, 70, 75], [TruthClass.Track]: [160, 120, 80],
  [TruthClass.Field]: [210, 200, 120], [TruthClass.DumpGround]: [120, 60, 120], [TruthClass.Tree]: [20, 110, 30], [TruthClass.Shrub]: [90, 150, 40], [TruthClass.Grass]: [240, 230, 60],
  [TruthClass.DeadVegetation]: [150, 90, 30], [TruthClass.Crop]: [140, 200, 80], [TruthClass.Structure]: [230, 230, 230], [TruthClass.Fence]: [180, 120, 200], [TruthClass.Utility]: [250, 180, 0],
  [TruthClass.Vehicle]: [0, 200, 220], [TruthClass.EmergencyVehicle]: [0, 120, 255], [TruthClass.Aircraft]: [200, 255, 255], [TruthClass.FuelContainer]: [255, 0, 0], [TruthClass.CombustibleDebris]: [255, 120, 0], [TruthClass.NonCombustibleDebris]: [120, 120, 160],
  [TruthClass.Furniture]: [255, 120, 200], [TruthClass.Person]: [255, 255, 0], [TruthClass.Animal]: [255, 0, 255],
};
export const FLAM_COLORS: [number, number, number][] = [[40, 40, 48], [60, 140, 70], [230, 200, 60], [240, 120, 30], [230, 20, 20]];
