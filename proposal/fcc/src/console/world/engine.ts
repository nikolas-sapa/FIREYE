import type { Autonomy, Brief, BusEvent, ConsoleState, DirectorState, Geo, Ledger, Ms, RoleLens, ScenarioPack } from '../contracts';
import type { Bus } from '../bus';
import { buildContext, type ScenarioContext } from './context';
import { createRng } from './rng';
import type { Sim } from './sim';
import { MIN, clamp } from './geo';
import { createUnits, tickUnits } from './units';
import { createFeeds, updateFeeds, updateLive } from './feeds';
import { rebuildCoverage } from './coverage';
import { buildCatalog } from '../agents/catalog';
import { createPools, poolSnapshot, prefillFindings, tickFindings, tickReports, tickReveals, tickSwarm } from '../agents/swarm';
import { tickPredictions } from '../agents/predictions';
import { applyProjection, tickProjection } from '../agents/projection';
import { grade, itemMeta } from '../orchestrator/grade';
import { runRules } from '../orchestrator/rules';
import { tickActions, approve as approveAction, reject as rejectAction, undo as undoAction, editDraft as editActionDraft } from '../orchestrator/actions';
import { applyPending, emitDirective } from '../orchestrator/directives';
import { updateBrief, updateSuggestions } from '../orchestrator/brief';
import { ask as askQuestion, tickConversation } from '../orchestrator/conversation';
import { addNote, recordEvent } from '../orchestrator/notes';
import { say } from '../orchestrator/messages';
import { createRecon, tickRecon } from './recon';
import { initializeStations } from './drone-stations';

/** Scenario ms per fire re-render step (fireRev). */
export const FIRE_STEP_MS = 60_000;
/**
 * Fixed world step (scenario ms). The world advances only in whole steps, so its state at t never depends on
 * frame timing, playback speed or how a seek got there.
 */
export const WORLD_STEP_MS = 1000;
/** Sensing, agents, projection and tasking run on every fifth world step. */
const PERCEIVE_EVERY_MS = 5 * WORLD_STEP_MS;
/** Grade/rules refresh period (scenario ms). */
const GRADE_EVERY_MS = 30_000;
/** Agent time runs this many times faster than wall clock at the default speed so the job stream stays readable. */
export const AGENT_MAX_RATE = 20;
export const DEFAULT_SPEED = 60;
/** Fallback seed; each scenario script carries its own. */
export const DEFAULT_SEED = 20210816;

const ctxCache = new WeakMap<ScenarioPack, ScenarioContext>();
export function contextFor(pack: ScenarioPack): ScenarioContext {
  let c = ctxCache.get(pack);
  if (!c) {
    c = buildContext(pack);
    ctxCache.set(pack, c);
  }
  return c;
}

export function emptyLedger(): Ledger {
  return {
    footageReviewedS: 0,
    imagesAnalyzed: 0,
    articlesRead: 0,
    postsScreened: 0,
    satellitePasses: 0,
    radioMinutesTranscribed: 0,
    projectionsRun: 0,
    droneTasksIssued: 0,
    draftsWritten: 0,
    notificationsRelayed: 0,
    analystMinutesSaved: 0,
    entries: [],
  };
}

/** A bus facade that records the change log on the sim, then forwards to the shared bus. */
function recordingBus(target: Bus, getSim: () => Sim | null): Bus {
  return {
    subscribe: (fn) => target.subscribe(fn),
    publish: (e: BusEvent) => {
      const s = getSim();
      if (s) recordEvent(s, e);
      target.publish(e);
    },
    history: () => target.history(),
    since: (t) => target.since(t),
    clear: () => target.clear(),
    setMuted: (m) => target.setMuted(m),
  };
}

export interface CreateOpts {
  profile?: 'legacy' | 'recon';
  seed?: number;
  t?: Ms;
  speed?: number;
  paused?: boolean;
  settings?: ConsoleState['settings'];
  director?: DirectorState;
  intro?: boolean;
}

export function createSim(pack: ScenarioPack, target: Bus, opts: CreateOpts = {}): Sim {
  const ctx = contextFor(pack);
  const seed = opts.seed ?? ctx.script.seed ?? DEFAULT_SEED;
  const rng = createRng(seed);
  const profile = opts.profile ?? 'legacy';
  const t = clamp(opts.t ?? (profile === 'recon' ? ctx.start : ctx.T0), ctx.start, ctx.end);
  const created = createUnits(ctx, rng, t);
  const units = profile === 'recon' ? created.units.filter(u => u.kind === 'drone') : created.units;
  const umeta = new Map([...created.umeta].filter(([id]) => units.some(u => u.id === id)));
  let ref: Sim | null = null;
  const brief: Brief = { headline: 'Building the picture', bullets: [], changed: [], at: t };
  const sim: Sim = {
    profile, recon: profile === 'recon' ? createRecon() : null,
    ctx,
    bus: recordingBus(target, () => ref),
    rng,
    t,
    carryMs: 0,
    perceivedAt: t,
    speed: opts.speed ?? DEFAULT_SPEED,
    paused: opts.paused ?? false,
    realS: 0,
    agentS: 0,
    units,
    umeta,
    findings: [],
    fmeta: new Map(),
    feeds: [],
    projection: null,
    projField: null,
    projMs: [],
    predictions: [],
    predRt: new Map(),
    reportsSeen: new Set(),
    projWeather: null,
    projHead: null,
    projCenter: null,
    shiftApplied: ctx.tShift !== null && t >= ctx.tShift,
    intelPending: null,
    lastIntelProj: 0,
    items: [],
    imeta: new Map(),
    actions: [],
    pools: createPools(),
    jobs: [],
    ledger: emptyLedger(),
    messages: [],
    brief,
    briefFacts: null,
    briefDirty: true,
    suggestions: [],
    directives: [],
    pending: [],
    stage: { mode: 'globe', dimmed: false, highlight: [] },
    coverage: [],
    settings: opts.settings ?? { autonomy: 'assist', lens: 'ic', holdLayout: false, tokens: { cesium: false, google: false } },
    director: opts.director ?? { enabled: false, beat: 0, beats: [], elapsedS: 0, captions: true },
    fireRev: 0,
    catalog: buildCatalog(ctx),
    revealed: new Set(),
    touched: new Set(),
    cues: new Set(),
    replies: [],
    seq: 0,
    timers: { grade: 0, brief: t, proj: t, sitrep: t + 120 * MIN, orch: 0, briefReal: 0, cov: t + 10 * MIN },
    gradeDirty: true,
    version: 0,
    notes: [],
    fireStep: Math.floor(t / FIRE_STEP_MS),
    fireReal: 0,
  };
  ref = sim;
  if (sim.recon) initializeStations(sim);
  sim.feeds = createFeeds(sim);
  prefillFindings(sim);
  tickReports(sim, true);
  applyProjection(sim, 'initial');
  updateFeeds(sim);
  grade(sim);
  if (sim.recon) tickRecon(sim); else runRules(sim);
  updateBrief(sim, true);
  updateSuggestions(sim);
  if (opts.intro !== false) {
    say(sim, sim.recon ? 'Coordinating simulated drone reconnaissance from two stations. Prioritising high-sensitivity terrain and camera blind spots. Movement commands and important fire changes appear beneath FIREYE.' : ctx.script.intro(sim));
  }
  return sim;
}

function gradeStep(sim: Sim, scheduled: boolean): void {
  sim.gradeDirty = false;
  if (scheduled) sim.timers.grade = sim.t + GRADE_EVERY_MS;
  grade(sim);
  if (!sim.recon) runRules(sim);
}

/** Advances the world by one fixed step; everything here reads scenario time only. */
function worldStep(sim: Sim, dStep: Ms): void {
  sim.t += dStep;
  tickUnits(sim, dStep / 1000);
  if (sim.t - sim.perceivedAt < PERCEIVE_EVERY_MS - 1e-3 && sim.t < sim.ctx.end) return;
  const dScen = sim.t - sim.perceivedAt;
  sim.perceivedAt = sim.t;
  const dAgent = (dScen / 1000) * (AGENT_MAX_RATE / DEFAULT_SPEED);
  sim.agentS += dAgent;
  tickReveals(sim);
  tickSwarm(sim, dScen, dAgent);
  tickProjection(sim);
  tickPredictions(sim);
  if (sim.recon) {
    tickRecon(sim);
    for (const u of sim.units) { u.trail = []; u.route = undefined; }
  } else tickActions(sim);
  updateFeeds(sim);
  updateLive(sim);
  tickReports(sim);
  tickFindings(sim, (id) => !!sim.imeta.get(id)?.pinned);
  if (sim.t >= sim.timers.cov) {
    sim.timers.cov = sim.t + 10 * MIN;
    rebuildCoverage(sim);
  }
  if (sim.t >= sim.timers.grade || (sim.gradeDirty && !sim.recon)) gradeStep(sim, true);
}

/** One engine tick. `dtReal` is wall-clock seconds (virtual during fast-forward). */
export function stepSim(sim: Sim, dtReal: number): void {
  const dt = Math.max(0, dtReal);
  sim.realS += dt;
  if (!sim.paused && sim.t < sim.ctx.end) {
    sim.carryMs += dt * sim.speed * 1000;
    while (sim.t < sim.ctx.end && sim.carryMs >= WORLD_STEP_MS - 1e-3) {
      sim.carryMs = Math.max(0, sim.carryMs - WORLD_STEP_MS);
      worldStep(sim, Math.min(WORLD_STEP_MS, sim.ctx.end - sim.t));
    }
    if (sim.t >= sim.ctx.end) {
      sim.paused = true;
      sim.carryMs = 0;
    }
    const step = Math.floor(sim.t / FIRE_STEP_MS);
    if (step !== sim.fireStep && sim.realS - sim.fireReal >= 0.25) {
      sim.fireStep = step;
      sim.fireReal = sim.realS;
      sim.fireRev++;
    }
  }
  // Recon items are display-only and legacy rules only run here on user operations while paused.
  if (sim.gradeDirty && (sim.recon || sim.paused)) gradeStep(sim, false);
  updateBrief(sim);
  if (sim.realS >= sim.timers.orch) {
    sim.timers.orch = sim.realS + 1;
    updateSuggestions(sim);
  }
  tickConversation(sim);
  sim.version++;
}

/** Advances scenario time to `toT` with virtual wall-clock steps (deterministic; used by seek and the Director). */
export function fastForward(sim: Sim, toT: Ms, opts: { speed?: number; dtReal?: number; onStep?: (sim: Sim, dtReal: number) => void } = {}): void {
  const speed = opts.speed ?? Math.max(sim.speed, 60);
  const dtReal = opts.dtReal ?? 0.5;
  const saved = { speed: sim.speed, paused: sim.paused };
  sim.speed = speed;
  sim.paused = false;
  let guard = 0;
  while (sim.t + sim.carryMs < toT - 1e-3 && guard++ < 20000) {
    const need = (toT - sim.t - sim.carryMs) / 1000 / speed;
    const d = Math.min(dtReal, need);
    stepSim(sim, d);
    opts.onStep?.(sim, d);
    if (sim.t >= sim.ctx.end) break;
  }
  sim.speed = saved.speed;
  sim.paused = saved.paused;
  sim.fireRev++;
}

/* ------------------------------------------------------------------ user operations */

export const ops = {
  setAutonomy(sim: Sim, a: Autonomy) {
    if (sim.settings.autonomy === a) return;
    sim.settings = { ...sim.settings, autonomy: a };
    addNote(sim, 'settings', `Autonomy set to ${a.toUpperCase()}`);
    sim.gradeDirty = true;
  },
  setLens(sim: Sim, l: RoleLens) {
    if (sim.settings.lens === l) return;
    sim.settings = { ...sim.settings, lens: l };
    addNote(sim, 'settings', `Role lens switched to ${l.toUpperCase()}; items re-ranked`);
    sim.gradeDirty = true;
    sim.briefDirty = true;
  },
  setHoldLayout(sim: Sim, h: boolean) {
    if (sim.settings.holdLayout === h) return;
    sim.settings = { ...sim.settings, holdLayout: h };
    if (!h) sim.pending = [];
    addNote(sim, 'settings', h ? 'Layout held: directives become suggestions' : 'Layout released');
  },
  approve(sim: Sim, id: string, by: 'user' | 'orchestrator' = 'user') {
    approveAction(sim, id, by);
  },
  reject(sim: Sim, id: string) {
    rejectAction(sim, id);
  },
  undo(sim: Sim, id: string) {
    undoAction(sim, id);
  },
  editDraft(sim: Sim, id: string, body: string) {
    editActionDraft(sim, id, body);
  },
  ask(sim: Sim, text: string) {
    askQuestion(sim, text);
  },
  dismiss(sim: Sim, id: string) {
    const m = itemMeta(sim, id);
    m.dismissed = true;
    m.acked = true;
    if (!m.seen) {
      m.seen = true;
      m.seenAt = sim.t;
    }
    sim.gradeDirty = true;
  },
  pin(sim: Sim, id: string) {
    const m = itemMeta(sim, id);
    m.pinned = !m.pinned;
    if (m.pinned) m.dismissed = false;
    sim.gradeDirty = true;
  },
  markSeen(sim: Sim, id: string) {
    const m = itemMeta(sim, id);
    if (m.seen) return;
    m.seen = true;
    m.seenAt = sim.t;
    sim.gradeDirty = true;
  },
  acknowledge(sim: Sim, id: string) {
    const m = itemMeta(sim, id);
    m.acked = true;
    if (!m.seen) {
      m.seen = true;
      m.seenAt = sim.t;
    }
    const it = sim.items.find((i) => i.id === id);
    if (it) addNote(sim, 'user', `IC acknowledged: ${it.title.toLowerCase()}`, id);
    sim.gradeDirty = true;
  },
  promoteFeed(sim: Sim, feedId: string | null) {
    if (feedId) {
      const f = sim.feeds.find((x) => x.id === feedId);
      emitDirective(sim, { kind: 'promoteFeed', feedId, reason: `Selected by the user${f ? ` · ${f.label}` : ''}` }, true);
    } else sim.stage = { ...sim.stage, mode: 'globe', feedId: undefined };
  },
  focus(sim: Sim, target: Geo, rangeM?: number) {
    emitDirective(sim, { kind: 'focusStage', target: { lon: target.lon, lat: target.lat }, rangeM: rangeM ?? 3000, pitchDeg: -40, reason: 'Selected by the user' }, true);
  },
  applyDirective(sim: Sim, id: string) {
    applyPending(sim, id);
  },
};

/* ------------------------------------------------------------------ snapshot */

/**
 * Builds the immutable ConsoleState. Fast slices (clock, units, feeds, stage, directives) refresh on every
 * call; `heavy` slices (findings, items, pools, jobs, ledger, messages, brief) only when `heavy` is true,
 * so UI panels re-render at about half the world rate.
 */
export function snapshot(sim: Sim, prev: ConsoleState | null, heavy: boolean, pack: ScenarioPack): ConsoleState {
  const keep = <K extends keyof ConsoleState>(k: K, next: ConsoleState[K]): ConsoleState[K] => (prev && prev[k] === next ? prev[k] : next);
  const h = heavy || !prev || !prev.ready;
  return {
    ready: true,
    pack,
    clock: prev && prev.clock.t === sim.t && prev.clock.speed === sim.speed && prev.clock.paused === sim.paused ? prev.clock : { t: sim.t, speed: sim.speed, paused: sim.paused },
    units: sim.units.map((u) => ({ ...u, pos: { ...u.pos } })),
    findings: h ? sim.findings.map((f) => ({ ...f })) : prev!.findings,
    feeds: sim.feeds.map((f) => ({ ...f, pose: { ...f.pose } })),
    projection: keep('projection', sim.projection),
    items: h ? keep('items', sim.items) : prev!.items,
    actions: keep('actions', sim.actions),
    pools: h ? poolSnapshot(sim) : prev!.pools,
    jobs: h ? keep('jobs', sim.jobs) : prev!.jobs,
    ledger: h ? keep('ledger', sim.ledger) : prev!.ledger,
    messages: keep('messages', sim.messages),
    brief: h ? keep('brief', sim.brief) : prev!.brief,
    suggestions: keep('suggestions', sim.suggestions),
    directives: keep('directives', sim.directives),
    stage: keep('stage', sim.stage),
    coverage: keep('coverage', sim.coverage),
    settings: keep('settings', sim.settings),
    director: prev && sameDirector(prev.director, sim.director) ? prev.director : { ...sim.director },
    fireRev: sim.fireRev,
    scenarioId: pack.manifest.id,
    predictions: keep('predictions', sim.predictions),
    recon: sim.recon ? { tasks: sim.recon.tasks, events: sim.recon.events, stations: sim.recon.stations, drones: sim.recon.drones.map(d => ({ ...d })) } : undefined,
  };
}

function sameDirector(a: DirectorState, b: DirectorState): boolean {
  return a.enabled === b.enabled && a.beat === b.beat && a.beats === b.beats && a.captions === b.captions && Math.abs(a.elapsedS - b.elapsedS) < 0.2;
}
