import { valueNoise } from '../rng';

/** Continuous stand/clearing pattern, independent of tile ownership and render detail. */
export function landscapeAt(x: number, z: number) {
  const stand = valueNoise(x / 105, z / 105, 57);
  const patch = valueNoise(x / 29, z / 29, 59);
  const canopy = Math.max(0.12, Math.min(1, (stand - 0.24) * 2.4));
  return { canopy, trees: 0.24 + 1.38 * canopy,
    shrubs: 0.5 + 0.9 * patch, clearing: 1 - canopy };
}

/** World-anchored agricultural lattice; adjacent tiles enumerate the same uncut rows. */
export function cropRows(bounds: [number, number, number, number], across: number, along: number, angle: number,
  put: (x: number, z: number) => void) {
  const [x0, z0, x1, z1] = bounds, c = Math.cos(angle), s = Math.sin(angle);
  const corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]];
  const us = corners.map(([x, z]) => x * c + z * s), vs = corners.map(([x, z]) => -x * s + z * c);
  for (let j = Math.floor(Math.min(...vs) / across); j <= Math.ceil(Math.max(...vs) / across); j++) {
    for (let i = Math.floor(Math.min(...us) / along); i <= Math.ceil(Math.max(...us) / along); i++) {
      const u = i * along, v = j * across, x = u * c - v * s, z = u * s + v * c;
      if (x >= x0 && x < x1 && z >= z0 && z < z1) put(x, z);
    }
  }
}
