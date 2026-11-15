import { ARCHETYPE, type Archetype } from './catalog';
import type { WorldEnv } from './env';
import { FLAMMABILITY, TruthClass, type Flammability } from './types';

export interface Rating { level: Flammability; score: number; hazard?: Archetype['hazard'] }

const level = (s: number): Flammability => s < 0.12 ? 'none' : s < 0.35 ? 'low' : s < 0.6 ? 'moderate' : s < 0.82 ? 'high' : 'extreme';
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Ground-truth label for analysis tests. Live vegetation follows seasonal curing and the dryness index,
 * dead fuels respond to wetting, and pressurized/liquid fuel containers are always extreme hazards.
 * Illustrative only, not a fuel-moisture model.
 */
export function rateArchetype(a: Archetype, env: Pick<WorldEnv, 'curing' | 'dryness' | 'wet' | 'leaf'>): Rating {
  if (a.kind === 'agent' || a.flam === 0) return { level: 'none', score: 0 };
  if (a.hazard === 'pressurized-gas' || a.hazard === 'liquid-fuel' && a.cls === TruthClass.FuelContainer || a.hazard === 'aerosol') return { level: 'extreme', score: 1, hazard: a.hazard };
  let s = a.flam / 4;
  if (a.sens > 0) s += a.sens * (env.curing * 0.3 + env.dryness * 0.2 - (1 - env.curing) * 0.25) * (a.deciduous ? env.leaf : 1);
  else if (a.cls === TruthClass.DeadVegetation || a.cls === TruthClass.Litter || a.cls === TruthClass.CombustibleDebris) s += env.dryness * 0.12 - 0.08;
  s -= env.wet * 0.2;
  return { level: level(clamp(s)), score: clamp(s), hazard: a.hazard };
}

export function rate(id: string, env: Pick<WorldEnv, 'curing' | 'dryness' | 'wet' | 'leaf'>): Rating {
  const a = ARCHETYPE.get(id);
  return a ? rateArchetype(a, env) : { level: 'none', score: 0 };
}

/** Ground-cover truth classes (terrain surfaces). */
export function rateSurface(cls: TruthClass, env: Pick<WorldEnv, 'curing' | 'dryness' | 'wet'>): Rating {
  const base = cls === TruthClass.GrassGround ? 0.2 + env.curing * 0.45 + env.dryness * 0.15
    : cls === TruthClass.Litter ? 0.55 + env.dryness * 0.2
      : cls === TruthClass.Field ? 0.25 + env.curing * 0.4
        : cls === TruthClass.DumpGround ? 0.45 : 0;
  const s = clamp(base - env.wet * 0.25);
  return { level: base ? level(s) : 'none', score: base ? s : 0 };
}
export const flammabilityCode = (f: Flammability) => FLAMMABILITY.indexOf(f);
