import type { FindingKind, GradedItem, Geo, RoleLens, SourceKind } from '../contracts';
import type { Sim } from '../world/sim';
import { modelEtaMin } from '../agents/projection';

export type Cls = GradedItem['cls'];

/** Severity: life 1.0, animal .85, explosive/combustible .75, structure .6, fuel .4, info .15. */
export const SEVERITY: Record<FindingKind, number> = {
  human: 1,
  animal: 0.85,
  combustible: 0.75,
  spot: 0.7,
  structure: 0.6,
  vehicle: 0.5,
  'road-block': 0.5,
  fuel: 0.4,
  smoke: 0.15,
  water: 0.15,
};

/** Source reliability multiplies model confidence. */
export const RELIABILITY: Record<SourceKind, number> = {
  web: 0.85,
  social: 0.8,
  satellite: 0.95,
  'drone-cam': 1,
  'ground-cam': 0.97,
  'fixed-cam': 0.95,
  radio: 0.9,
  weather: 1,
  terrain: 0.9,
  aircraft: 0.95,
};

/** Points (0..10) when a concrete action exists for the kind of finding. */
export const ACTIONABILITY: Record<FindingKind, number> = {
  human: 10,
  animal: 6,
  combustible: 10,
  spot: 10,
  structure: 4,
  vehicle: 6,
  'road-block': 6,
  fuel: 3,
  smoke: 0,
  water: 2,
};

export function clsOf(kind: FindingKind): Cls {
  if (kind === 'human' || kind === 'animal') return 'life';
  if (kind === 'fuel') return 'fuel';
  if (kind === 'smoke' || kind === 'water') return 'status';
  return 'hazard';
}

/**
 * Minutes until the fire reaches `pos` according to the current projection (never the replay's future).
 * 0 = inside the active edge, -1 = burned long ago, Infinity = not reached within the model horizon.
 */
export function etaMin(sim: Sim, pos: Geo, uncM: number): number {
  return modelEtaMin(sim, pos, uncM);
}

/** Exposure from minutes to impact: <30 min 1.0 ... >6 h 0.1. */
export function exposureOf(eta: number, kind?: FindingKind): number {
  const life = kind === 'human' || kind === 'animal';
  if (eta < 0) return life ? 0.9 : 0.3;
  // Life-safety floor: people or animals anywhere inside the +3H band count as highly exposed.
  if (life && eta <= 180) return Math.max(0.85, exposureBase(eta));
  return exposureBase(eta);
}

function exposureBase(eta: number): number {
  if (!Number.isFinite(eta)) return 0.1;
  if (eta <= 30) return 1;
  if (eta <= 60) return 1 - ((eta - 30) / 30) * 0.15;
  if (eta <= 180) return 0.85 - ((eta - 60) / 120) * 0.35;
  if (eta <= 360) return 0.5 - ((eta - 180) / 180) * 0.25;
  return Math.max(0.1, 0.25 - ((eta - 360) / 360) * 0.15);
}

export function etaText(eta: number): string {
  if (eta < 0) return 'inside the burned area';
  if (eta === 0) return 'at the active edge';
  if (!Number.isFinite(eta)) return 'outside the projection';
  const m = Math.round(eta);
  if (eta <= 60) return `in +1H band (ETA ${m} min)`;
  if (eta <= 180) return `in +3H band (ETA ${m} min)`;
  if (eta <= 360) return `in +6H band (ETA ${Math.round(eta / 60)} h)`;
  return `beyond +6H (ETA ${Math.round(eta / 60)} h)`;
}

/** Role lens: ic balanced; ops hazards & movements x1.2; air drone/aircraft/spot x1.25; ems life x1.3, fuel x0.6. */
export function lensFor(lens: RoleLens, cls: Cls, kind?: FindingKind, sources: SourceKind[] = []): number {
  switch (lens) {
    case 'ic':
      return 1;
    case 'ops':
      return cls === 'hazard' || cls === 'movement' ? 1.2 : 1;
    case 'air':
      return kind === 'spot' || kind === 'smoke' || sources.includes('drone-cam') || sources.includes('aircraft') ? 1.25 : cls === 'status' ? 0.9 : 1;
    case 'ems':
      return cls === 'life' ? 1.3 : cls === 'fuel' ? 0.6 : 1;
  }
}

export const CLS_LABEL: Record<Cls, string> = {
  life: 'Life',
  hazard: 'Hazard',
  fuel: 'Fuel',
  movement: 'Movement',
  projection: 'Projection',
  status: 'Info',
};
