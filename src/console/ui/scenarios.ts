import type { ScenarioId, ScenarioPack } from '../contracts';
import { SCENARIOS, currentScenarioId } from '../scenario';
export { SCENARIOS, currentScenarioId, DEFAULT_SCENARIO } from '../scenario';
export type { ScenarioEntry } from '../scenario';

/** Registry entry for the active (or given) scenario. */
export function scenarioEntry(id?: ScenarioId | null) {
  const want = id ?? currentScenarioId();
  return SCENARIOS.find((s) => s.id === want);
}

/** Reloads the console on another scenario, keeping the other query parameters except `beat`. */
export function switchScenario(id: ScenarioId) {
  const url = new URL(window.location.href);
  url.searchParams.set('scenario', id);
  url.searchParams.delete('beat');
  window.location.assign(url.toString());
}

/** Display name of a pack: manifest name, else the registry name. */
export function scenarioName(pack: ScenarioPack | null) {
  const name = pack?.manifest.name ?? scenarioEntry(pack?.manifest.id)?.name ?? 'Scenario';
  return name.replace(/\s+replay$/i, '');
}
