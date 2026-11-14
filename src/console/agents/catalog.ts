import type { FindingKind, Geo, Ms, SourceKind } from '../contracts';
import type { ScenarioContext } from '../world/context';
import type { LedgerCounters } from '../world/sim';

export interface FindingSpec {
  id: string;
  kind: FindingKind;
  label: string;
  detail: string;
  /** Reported position (may be approximate). */
  pos: Geo;
  /** Ground truth used by cameras; defaults to pos. */
  truePos?: Geo;
  uncertaintyM: number;
  confidence: number;
  count?: number;
  poolId: string;
  source: SourceKind;
  /** Further independent sources already corroborating the report. */
  extraSources?: SourceKind[];
  /** Interrupt-worthy on its own (e.g. a new ignition upwind of a community). */
  interrupt?: boolean;
  sourceLabel: string;
  sourceTitle: string;
  url?: string;
  /** Unit-proximity reveals only fire after `notBefore` (keeps scripted beats in order). */
  reveal: { at: Ms } | { unitId: string; radiusM: number; fallbackAt: Ms; notBefore?: Ms };
  halfLifeS: number;
  persistent?: boolean;
  confirmable?: boolean;
  place?: string;
  /** Feed the detection came from (bbox drawn in its frame). */
  feedId?: string;
  jobInput: string;
  minutes: number;
  counters?: Partial<LedgerCounters>;
  confirmDetail?: string;
}

/** Scripted intel for the active scenario (each scenario module owns its catalog). */
export function buildCatalog(ctx: ScenarioContext): FindingSpec[] {
  return ctx.script.catalog(ctx);
}
