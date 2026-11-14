import type { ScenarioId } from '../../contracts';
import type { ScenarioScript } from './types';
import { caldor } from './caldor';
import { mati } from './mati';

export type { ScenarioScript, ScenarioPlans, UnitSpec } from './types';

export const SCRIPTS: Record<string, ScenarioScript> = { [caldor.id]: caldor, [mati.id]: mati };

/** Scenario script selected by pack.manifest.id (unknown packs fall back to the Caldor script). */
export function scriptFor(id: ScenarioId | undefined): ScenarioScript {
  return (id && SCRIPTS[id]) || caldor;
}
