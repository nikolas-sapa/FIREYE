import type {
  Action,
  AgentJob,
  Brief,
  ConsoleState,
  Directive,
  DirectorState,
  Feed,
  Finding,
  GradedItem,
  Geo,
  Ledger,
  Message,
  Ms,
  PredictionCheck,
  Projection,
  SourceKind,
  Unit,
  Zone,
} from '../contracts';
import type { Bus } from '../bus';
import type { Rng } from './rng';
import type { ScenarioContext } from './context';
import type { FindingSpec } from '../agents/catalog';
import type { PoolDef } from '../agents/pools';
import type { BriefFacts } from '../orchestrator/brief';
import type { SpreadField } from '../agents/spread';

export type Plan =
  | { mode: 'hold' }
  | { mode: 'path'; path: Geo[]; i: number; after: 'hold' | 'patrol' }
  | { mode: 'sweep'; cellId: string; legs: Geo[]; i: number }
  | { mode: 'orbit'; center: Geo; radiusM: number; ang: number }
  | { mode: 'wander'; anchor: Geo; radiusM: number; target: Geo }
  | { mode: 'circuit'; pts: Geo[]; i: number };

export interface UnitMeta {
  plan: Plan;
  patrol: Geo[];
  home: Geo;
  nextTrailT: Ms;
  altAGL: number;
  cruise: number;
  /** Temporary speed for timed moves (arrive by a deadline). */
  override?: number;
  holdUntil: Ms;
  phase: number;
  /** Moves in straight lines over water (boats). */
  marine?: boolean;
  helmetCam?: boolean;
}

export interface FindingMeta {
  specId?: string;
  truePos: Geo;
  confirmable: boolean;
  confirmed: boolean;
  confirmQueued: boolean;
  resolved: boolean;
  persistent: boolean;
  poolId: string;
  place?: string;
  sourceKinds: SourceKind[];
  random: boolean;
  rescueStart?: Ms;
  /** Scripted interrupt-worthy finding (e.g. a new ignition in the WUI). */
  interrupt?: boolean;
}

export interface ItemMeta {
  zone?: Zone;
  enteredReal: number;
  lastScore: number;
  seen: boolean;
  seenAt: Ms;
  dismissed: boolean;
  pinned: boolean;
  acked: boolean;
  changedAt: Ms;
  ref?: { conf: number; unc: number; eta: number };
  published: boolean;
}

export type LedgerCounters = Omit<Ledger, 'entries' | 'analystMinutesSaved'>;

export interface JobRt {
  job: AgentJob;
  durS: number;
  leftS: number;
  minutes: number;
  counters: Partial<LedgerCounters>;
  text: (agent: string, findings: number) => string;
  onDone?: (sim: Sim, job: AgentJob) => string[] | void;
}

export interface PoolRt {
  def: PoolDef;
  acc: number;
  srcAcc: Record<string, number>;
  sinceEmit: number;
  queue: JobRt[];
  running: JobRt[];
  workers: number;
  starting: number[];
  idleS: number;
  durations: number[];
  completions: number[];
  seq: number;
}

/** Plain-language log of notable events (fed from bus events) for "what changed" answers. */
export interface Note {
  at: Ms;
  kind: 'finding' | 'confirm' | 'projection' | 'proposed' | 'decided' | 'notify' | 'interrupt' | 'settings' | 'user';
  text: string;
  ref?: string;
}

export interface Sim {
  ctx: ScenarioContext;
  bus: Bus;
  rng: Rng;
  t: Ms;
  speed: number;
  paused: boolean;
  /** Wall-clock seconds the engine has stepped (dwell timers, thinking delays). */
  realS: number;
  /** Agent-time seconds (scenario time clamped to 20x real so the job stream stays readable). */
  agentS: number;
  units: Unit[];
  umeta: Map<string, UnitMeta>;
  findings: Finding[];
  fmeta: Map<string, FindingMeta>;
  feeds: Feed[];
  projection: Projection | null;
  /** Latest modelled arrival field (independent of the replay truth after its issue time). */
  projField: SpreadField | null;
  /** Recent projection compute times (ms). */
  projMs: number[];
  predictions: PredictionCheck[];
  predRt: Map<string, { mask: Uint8Array; base: Uint8Array; rev: number }>;
  /** Real pack reports already ingested. */
  reportsSeen: Set<string>;
  projWeather: { dir: number; kph: number } | null;
  projHead: Geo | null;
  projCenter: Geo | null;
  shiftApplied: boolean;
  intelPending: string | null;
  lastIntelProj: Ms;
  items: GradedItem[];
  imeta: Map<string, ItemMeta>;
  actions: Action[];
  pools: PoolRt[];
  jobs: AgentJob[];
  ledger: Ledger;
  messages: Message[];
  brief: Brief;
  briefFacts: BriefFacts | null;
  briefDirty: boolean;
  suggestions: string[];
  directives: Directive[];
  pending: Directive[];
  stage: ConsoleState['stage'];
  coverage: ConsoleState['coverage'];
  settings: ConsoleState['settings'];
  director: DirectorState;
  fireRev: number;
  catalog: FindingSpec[];
  revealed: Set<string>;
  touched: Set<string>;
  cues: Set<string>;
  replies: { id: string; due: number; question: string }[];
  seq: number;
  /** grade/orch/briefReal: wall-clock seconds (sim.realS); brief/proj/sitrep/cov: scenario ms. */
  timers: { grade: number; brief: Ms; proj: Ms; sitrep: Ms; orch: number; briefReal: number; cov: Ms };
  notes: Note[];
  fireStep: number;
  fireReal: number;
  gradeDirty: boolean;
  version: number;
}

export function nid(sim: Sim, prefix: string): string {
  sim.seq += 1;
  return `${prefix}-${sim.seq}`;
}
