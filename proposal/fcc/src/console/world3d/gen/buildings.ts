import type { HeightField } from '../frame';
import { hex, type Rgb } from '../mesh';
import { Rng } from '../rng';
import type { SourceBuilding, SourceRoad } from '../types';

const WALLS: readonly (readonly [Rgb, number])[] = [[hex(0xf1ede4), 6], [hex(0xe7d5b2), 2], [hex(0xdcbf8f), 1], [hex(0xe9cfc4), 0.5], [hex(0xd5dde0), 0.5]];
const DIMS: Record<string, [number, number, number]> = {
  'house-flat': [10, 8, 6.2], 'house-tiled': [9, 7.5, 3.4], apartments: [16, 11, 10.5],
  chapel: [5, 8, 4], shed: [3.5, 2.6, 2.3], greenhouse: [8, 20, 2.2], warehouse: [20, 14, 7],
};

export function buildingScale(id: string, r: Rng) {
  const s = id === 'greenhouse' || id === 'warehouse' ? r.range(0.8, 1.1) : r.range(0.82, 1.12);
  return { sx: s * r.range(0.9, 1.18), sz: s * r.range(0.88, 1.15), sy: s * r.range(0.68, 1.25) };
}

/** Generic, simulated shape at a source point. Shared by detailed buildings and distant proxies. */
export function describeBuilding(b: SourceBuilding, hf: HeightField, roads: SourceRoad[]) {
  const r = new Rng(b.id, 17), k = b.kind;
  const id = /church|chapel|temple/.test(k) ? 'chapel' : k === 'greenhouse' ? 'greenhouse'
    : /industrial|warehouse|commercial|retail|supermarket|service/.test(k) ? 'warehouse'
      : /hut|shed|garage|farm_auxiliary|stable|bunker|quonset/.test(k) ? 'shed'
        : /apartments|hotel|school|kindergarten|hospital|public/.test(k) || r.chance(0.07) ? 'apartments'
          : r.chance(0.58) ? 'house-flat' : 'house-tiled';
  const scale = buildingScale(id, r), [w, d, h] = DIMS[id];
  let bestD = 45, heading = r.range(0, Math.PI * 2);
  for (const road of roads) for (let i = 0; i + 3 < road.pts.length; i += 2) {
    const p = road.pts, dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], len2 = dx * dx + dz * dz;
    if (!len2) continue;
    const t = Math.max(0, Math.min(1, ((b.x - p[i]) * dx + (b.z - p[i + 1]) * dz) / len2));
    const rx = p[i] + t * dx - b.x, rz = p[i + 1] + t * dz - b.z, distance = Math.hypot(rx, rz);
    if (distance < bestD) { bestD = distance; heading = Math.abs(rx) + Math.abs(rz) > 0.1 ? Math.atan2(rx, rz) : Math.atan2(dx, dz); }
  }
  const ry = Math.round(heading / (Math.PI / 8)) * (Math.PI / 8) + r.range(-0.03, 0.03);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const local = (lx: number, lz: number): [number, number] => [b.x + lx * cy + lz * sy, b.z - lx * sy + lz * cy];
  let low = Infinity, high = -Infinity;
  for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) {
    const [x, z] = local(lx * scale.sx, lz * scale.sz), y = hf.height(x, z);
    low = Math.min(low, y); high = Math.max(high, y);
  }
  const tint = r.weighted(WALLS), phase = r.next(), y = high - 0.2;
  return { id, w, d, h, ...scale, ry, y, low: low - 0.2, tint, phase, local };
}
export type BuildingDescriptor = ReturnType<typeof describeBuilding>;
