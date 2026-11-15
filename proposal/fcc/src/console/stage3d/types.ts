import type {
  Action, ConsoleState, Directive, Feed, Finding, GradedItem, Ms, Projection, ScenarioPack, Unit,
} from '../contracts';

/** The slice of console state the 3D stage and feed renderer consume. */
export interface StageSnapshot {
  /** Monitoring disables reconstruction effects and replay-derived perimeters. */
  dataMode?: 'replay' | 'monitoring';
  pack: ScenarioPack | null;
  t: Ms;
  paused: boolean;
  /** Scenario seconds per real second. */
  speed?: number;
  units: Unit[];
  findings: Finding[];
  feeds: Feed[];
  projection: Projection | null;
  items: GradedItem[];
  actions: Action[];
  coverage: ConsoleState['coverage'];
  stage: ConsoleState['stage'];
  directives: Directive[];
  fireRev: number;
}

export type StageKey = keyof StageSnapshot;

export interface StageCapabilities {
  cesium: boolean;
  google: boolean;
}

/** Imagery/terrain source actually in use (may fall back at runtime when a token path fails). */
export type StageBasemap = 'google-3d' | 'ion-world' | 'offline';
