/**
 * The Orchestrator: grades every finding, projection change and movement into
 * an OrchAlert (score 0..100) and decides where it shows (tier 0..3). It keeps
 * the dock calm (one interrupt at a time, a small focus budget), proposes group
 * movements from the projection, relays to field audiences and answers questions.
 */
import type {
  AlertClass, AlertTier, Audience, MovementProposal, Observation, OrchAlert, OrchMessage, OrchestratorState, Vec,
} from './types';
import { BAND_LABEL, bandIndex, clamp, etaMin, km, type BHost } from './hostB';
import type { Intel, ObsMeta } from './intel';
import { compass16 } from './agent';
import { gridRef } from './terrain';

export const TIER_MIN = { interrupt: 85, focus: 60, ambient: 35 } as const;
const TIER_BAND: Record<AlertTier, [number, number]> = {
  0: [TIER_MIN.interrupt, 100], 1: [TIER_MIN.focus, TIER_MIN.interrupt - 1], 2: [TIER_MIN.ambient, TIER_MIN.focus - 1], 3: [0, TIER_MIN.ambient - 1],
};
export function tierForScore(score: number): AlertTier {
  return score >= TIER_MIN.interrupt ? 0 : score >= TIER_MIN.focus ? 1 : score >= TIER_MIN.ambient ? 2 : 3;
}

const CLASS_BASE: Record<AlertClass, number> = { life: 72, hazard: 58, movement: 60, fuel: 40, projection: 44, status: 12 };
/** Max focus (tier 1) alerts in the dock at once; the rest wait at tier 2. */
const FOCUS_BUDGET = 4;
/** Minimum sim seconds between two interrupts (60 real s at 1x). */
const INTERRUPT_COOLDOWN = 2700;
const ALERT_CAP = 80;
const MSG_CAP = 40;
const REPLY_DELAY = 1.2;

const AUD_LABEL: Record<Audience, string> = { fire: 'fire', ems: 'EMS', law: 'law', public: 'public' };
const list = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** Lowercase a leading article/word for mid-sentence use ("About 40 cattle" -> "about 40 cattle"), keeping acronyms. */
const lc = (s: string) => (s.length > 1 && /[a-z]/.test(s[1]) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export interface Orchestrator {
  seed(): void;
  reset(): void;
  /** Per sim step. */
  update(): void;
  /** Real-time tick (runs while paused) for chat reply latency. */
  tickReal(dtReal: number): void;
  ask(text: string): void;
  ack(id: string): void;
  approve(id: string): void;
  reject(id: string): void;
  events: {
    onNew(id: string): void;
    onConfirm(id: string, by: string, prevUncM: number): void;
    onResolve(id: string, note: string): void;
    onExpire(id: string): void;
    onLog(title: string, body: string): void;
  };
}

interface Rule {
  key: string;
  units: string[];
  when(): boolean;
  build(): Omit<MovementProposal, 'id' | 'at' | 'status'> | null;
  after: 'standby' | 'work';
  line?: boolean;
  group?: string;
  groupNote?: string;
}

interface MoveRt { mv: MovementProposal; rule: Rule; tag: string }

export function createOrchestrator(h: BHost, intel: () => Intel): Orchestrator {
  const alerts = new Map<string, OrchAlert>();
  let order: string[] = []; // creation order, oldest first
  let messages: OrchMessage[] = [];
  let interruptId: string | null = null;
  let lastInterruptAt = -1e9;
  let lastGradeT = -1e9;
  let lastRuleT = -1e9;
  let lastBriefT = -1e9;
  let lastSitrepT = -1e9;
  let lastForecastRev = -1;
  const projBand = new Map<string, number>();
  const moves = new Map<string, MoveRt>();
  const fired = new Set<string>();
  const firedGroups = new Set<string>();
  const habit = new Map<string, { key: string; since: number }>();
  let pending: { text: string; left: number } | null = null;
  let briefingLeft = 0;
  let msgId = 0;
  const firstSeen = new Map<string, number>();

  const s = () => h.state;
  const t = () => h.state.t;
  const zuluIn = (min: number) => h.zulu(t() + min * 60);

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------
  function say(text: string, refs?: string[], role: OrchMessage['role'] = 'orchestrator') {
    messages = [...messages, { id: `msg-${++msgId}`, at: t(), role, text, refs }].slice(-MSG_CAP);
    if (role === 'orchestrator') briefingLeft = Math.max(briefingLeft, 2);
    h.markDirty();
  }

  // ---------------------------------------------------------------------------
  // Alerts
  // ---------------------------------------------------------------------------
  function put(a: OrchAlert) {
    if (!alerts.has(a.id)) order.push(a.id);
    alerts.set(a.id, a);
  }

  function log(title: string, body: string, refs: string[] = [], pos?: Vec) {
    const id = h.nextId('al');
    put({ id, at: t(), cls: 'status', tier: 3, score: CLASS_BASE.status, title, body, why: 'Status · log only', pos, sourceIds: refs, notify: [], ack: true, updatedAt: t() });
  }

  function proximity(p: Vec) {
    const band = bandIndex(s(), p);
    const fd = h.fireDistance(p);
    const pb = band === 0 ? 20 : band === 1 ? 11 : band === 2 ? 3 : 0;
    const pf = fd < 6 ? 20 : fd < 15 ? 14 : fd < 30 ? 7 : 0;
    return { band, fd, prox: Math.max(pb, pf), far: band < 0 && fd > 40 };
  }

  function where(band: number, fd: number) {
    if (band >= 0) return `inside ${BAND_LABEL[band]} band`;
    if (Number.isFinite(fd)) return `${km(fd)} km from front`;
    return 'no active front';
  }

  function classOf(o: Observation): AlertClass {
    switch (o.kind) {
      case 'human': case 'animal': return 'life';
      case 'combustible': case 'spot': case 'structure': return 'hazard';
      case 'fuel': case 'water': return 'fuel';
      default: return 'status';
    }
  }

  function gradeObs(o: Observation, m: ObsMeta) {
    const cls = classOf(o);
    let base = CLASS_BASE[cls];
    if (o.kind === 'animal') base -= m.wildlife ? 30 : 6;
    if (o.kind === 'structure') base -= 10;
    if (o.kind === 'spot') base += 4;
    if (o.kind === 'water') base -= 30;
    if (o.kind === 'road-block') base += 26;
    if (o.sensitivity === 'decreased' && o.kind === 'fuel') base -= 22;
    if (o.sensitivity === 'increased') base += 4;
    const pos = o.confirmed ? m.truePos : o.pos;
    const px = proximity(pos);
    const prox = o.sensitivity === 'decreased' ? px.prox * 0.3 : px.prox;
    const conf = o.confidence * 8;
    const stale = o.live ? 0 : (1 - o.freshness) * 22;
    const src = Math.min(4, ((o.sources ?? 1) - 1) * 2);
    const rel = px.far ? -12 : 0;
    // Habituation: a non-life item that sits in focus unchanged for ~1 real minute drifts back to the map.
    const hkey = `${px.band}|${o.confirmed ? 1 : 0}|${o.sources ?? 1}`;
    const hab = habit.get(o.id);
    if (!hab || hab.key !== hkey) habit.set(o.id, { key: hkey, since: t() });
    const since = habit.get(o.id)!.since;
    const settle = cls === 'life' ? 0 : clamp((t() - since - 1500) / 1500, 0, 1) * 16;
    let score = clamp(Math.round(base + prox + conf - stale + src + rel - settle), 0, 100);
    // Interrupts are reserved for life safety: people, or animals at an exact (confirmed) position,
    // and only one interrupt per location group (e.g. a ranch with horses and an owner).
    const interruptible = cls === 'life' && (o.kind === 'human' || o.confirmed) && !(m.group && firedGroups.has(m.group) && !fired.has(`al-${o.id}`));
    if (!interruptible) score = Math.min(score, TIER_MIN.interrupt - 1);
    return { cls, score, ...px, pos, settled: settle > 4 };
  }

  function obsText(o: Observation, m: ObsMeta, g: ReturnType<typeof gradeObs>) {
    const life = g.cls === 'life';
    const inPath = g.band >= 0 && g.band <= 1;
    let title: string;
    if (o.kind === 'human') title = inPath ? `${m.noun} in projected path` : `${m.noun} at ${m.place}`;
    else if (o.kind === 'animal') title = inPath ? `${m.noun} in projected path` : `${m.noun} at ${m.place}`;
    else if (o.kind === 'spot') title = `Spot fire ahead of the front`;
    else if (o.kind === 'combustible') title = `${m.noun} at ${m.place}`;
    else if (o.kind === 'structure') title = `${m.noun} ${g.band >= 0 ? `inside ${BAND_LABEL[g.band]} projection` : 'on watch'}`;
    else if (o.kind === 'fuel') title = o.sensitivity === 'decreased' ? `${m.noun}: low fire risk` : `${m.noun} ahead of the head`;
    else if (o.kind === 'water') title = `${m.noun} available as ${m.place}`;
    else title = `${m.noun} on ${m.place}`;
    const ageMin = Math.round((t() - o.observedAt) / 60);
    const ago = ageMin < 1 ? 'just now' : `${ageMin} min ago`;
    const src = o.live ? `${o.sourceLabel} has eyes on it` : o.confirmed ? `Confirmed by ${m.confirmedBy ?? o.sourceLabel}, last seen ${ago}` : `${o.sourceLabel} report from ${ago}, ±${o.uncertaintyM} m`;
    const eta = etaMin(h, g.pos);
    const etaTxt = Number.isFinite(eta) && eta < 600 ? ` Fire ETA ~${Math.max(5, Math.round(eta / 5) * 5)} min.` : '';
    let act = '';
    if (!o.confirmed) {
      const cell = s().coverage.find((c) => g.pos.x >= c.x && g.pos.y >= c.y && g.pos.x < c.x + c.w && g.pos.y < c.y + c.h);
      const u = cell?.assignedUnitId ? s().units.find((x) => x.id === cell.assignedUnitId) : undefined;
      act = u ? ` ${u.callsign} is sweeping ${cell!.id} to confirm.` : ' Queued for drone confirmation.';
    } else if (life && inPath) act = ' Fire and EMS notified.';
    const body = `${src}.${etaTxt}${act}`;
    const label = { life: 'Life safety', hazard: o.kind === 'spot' ? 'Spot fire' : o.kind === 'structure' ? 'Structures' : 'Combustible', fuel: o.sensitivity === 'decreased' ? 'Low-risk fuel' : o.kind === 'water' ? 'Water source' : 'Fuel bed', movement: 'Movement', projection: 'Projection', status: 'Access' }[g.cls];
    const why = [label, where(g.band, g.fd), `conf ${o.confidence.toFixed(2)}`, plural(o.sources ?? 1, 'source'), o.live ? 'live' : o.confirmed ? '' : `${Math.round(o.freshness * 100)}% fresh`, g.settled ? 'relayed, no change' : '']
      .filter(Boolean).join(' · ');
    return { title, body, why };
  }

  function audiences(cls: AlertClass, tier: AlertTier, extra: { human?: boolean; band?: number; fd?: number; road?: boolean; town?: boolean }): Audience[] {
    if (tier === 3) return [];
    const band = extra.band ?? -1, fd = extra.fd ?? Infinity;
    switch (cls) {
      case 'life': {
        const a: Audience[] = ['fire', 'ems'];
        if ((band >= 0 && band <= 1) || fd < 20) a.push('law');
        if (extra.human && (band === 0 || fd < 10)) a.push('public');
        return a;
      }
      case 'hazard': return ['fire'];
      case 'fuel': return tier <= 1 ? ['fire'] : [];
      case 'movement': return extra.road ? ['fire', 'law'] : ['fire'];
      case 'projection': return extra.town ? ['fire', 'law', 'public'] : ['fire'];
      default: return [];
    }
  }

  /** Raw tier with 2-point hysteresis around the thresholds. */
  function hystTier(score: number, prev: AlertTier | undefined): AlertTier {
    const raw = tierForScore(score);
    if (prev === undefined || raw === prev) return raw;
    const edges = [TIER_MIN.interrupt, TIER_MIN.focus, TIER_MIN.ambient];
    for (const e of edges) if (Math.abs(score - e) < 2) return prev;
    return raw;
  }

  function gradeAll() {
    const st = s();
    const it = intel();
    // Observation alerts.
    for (const o of st.observations) {
      if (o.resolved) continue;
      const m = it.meta(o.id);
      if (!m) continue;
      if (!firstSeen.has(o.id)) firstSeen.set(o.id, t());
      const g = gradeObs(o, m);
      const txt = obsText(o, m, g);
      const id = `al-${o.id}`;
      const prev = alerts.get(id);
      const tier = hystTier(g.score, prev?.tier === 0 && prev.ack ? 1 : prev?.tier);
      put({
        id, at: prev?.at ?? t(), cls: g.cls, tier, score: g.score, title: txt.title, body: txt.body, why: txt.why,
        pos: { ...g.pos }, radiusCells: Math.max(1, o.uncertaintyM / 40), observationId: o.id,
        sourceIds: prev?.sourceIds ?? [], notify: audiences(g.cls, tier, { human: o.kind === 'human', band: g.band, fd: g.fd }),
        ack: prev?.ack ?? false, updatedAt: t(),
      });
    }
    // Projection alerts fade with age.
    for (const [key] of projBand) {
      const a = alerts.get(`al-proj-${key}`);
      if (!a || a.resolved) continue;
      const age = t() - a.at;
      const band = projBand.get(key)!;
      const conf = st.forecast[band]?.confidence ?? 0.5;
      const prox = band === 0 ? 20 : band === 1 ? 11 : 3;
      const score = clamp(Math.round(CLASS_BASE.projection + prox + conf * 8 - (1 - 0.5 ** (age / 1200)) * 40), 0, 100);
      const tier = hystTier(score, a.tier);
      put({ ...a, score, tier, notify: audiences('projection', tier, { town: key === 'town' && band === 0 }), updatedAt: t() });
    }
    // Movement alerts follow their proposal score.
    for (const { mv } of moves.values()) {
      const id = `al-${mv.id}`;
      const a = alerts.get(id);
      if (!a || a.resolved) continue;
      const age = (t() - mv.at) / 60;
      const urgency = age > mv.windowMin[1] * 0.6 ? 4 : 0;
      const score = clamp(mv.score + urgency, 0, 100);
      const tier = hystTier(score, a.tier);
      put({ ...a, score, tier, notify: audiences('movement', tier, { road: mv.route.length > 2 }) });
    }
    placeTiers();
  }

  /** Enforce one interrupt at a time (with cooldown) and the focus budget. */
  function placeTiers() {
    const act = order.map((id) => alerts.get(id)!).filter((a) => !a.resolved);
    // Acknowledged interrupts stay in focus.
    for (const a of act) if (a.tier === 0 && a.ack) alerts.set(a.id, { ...a, tier: 1 });
    const cands = order.map((id) => alerts.get(id)!).filter((a) => !a.resolved && a.tier === 0 && !a.ack);
    if (interruptId) {
      const cur = alerts.get(interruptId);
      if (!cur || cur.ack || cur.resolved || cur.tier !== 0) interruptId = null;
    }
    if (!interruptId && cands.length && t() - lastInterruptAt >= INTERRUPT_COOLDOWN) {
      const best = cands.slice().sort((a, b) => b.score - a.score)[0];
      interruptId = best.id;
      lastInterruptAt = t();
      fired.add(best.id);
      const g = best.observationId ? intel().meta(best.observationId)?.group : undefined;
      if (g) firedGroups.add(g);
      const aud = best.notify.map((x) => AUD_LABEL[x]);
      say(`Interrupt · ${best.title}. ${best.body} Relayed to ${list(aud)}.`, [best.id, ...(best.observationId ? [best.observationId] : [])]);
    }
    for (const a of cands) if (a.id !== interruptId) alerts.set(a.id, { ...alerts.get(a.id)!, tier: 1, queued: true });
    if (interruptId) { const a = alerts.get(interruptId)!; alerts.set(a.id, { ...a, queued: false }); }
    // Focus budget.
    const focus = order.map((id) => alerts.get(id)!).filter((a) => !a.resolved && a.tier === 1).sort((a, b) => b.score - a.score);
    focus.forEach((a, i) => {
      const held = i >= FOCUS_BUDGET;
      const queued = held || (a.score >= TIER_MIN.interrupt && !a.ack && a.id !== interruptId);
      alerts.set(a.id, { ...a, tier: held ? 2 : 1, queued, why: held && !a.why.includes('held') ? `${a.why} · held: dock full` : a.why });
    });
  }

  function publishAlerts() {
    placeTiers();
    // Trim: drop oldest resolved / tier-3 entries first.
    while (order.length > ALERT_CAP) {
      const k = order.findIndex((id) => { const a = alerts.get(id)!; return a.resolved || a.tier === 3; });
      const idx = k >= 0 ? k : 0;
      alerts.delete(order[idx]);
      order.splice(idx, 1);
    }
    const out: OrchAlert[] = [];
    // Placement (hysteresis, interrupt queue, dock budget, ack, resolve) can move an alert off its raw
    // band; the published score is clamped into its tier so tier === tierOf(score) always holds.
    for (let i = order.length - 1; i >= 0; i--) {
      const a = alerts.get(order[i])!;
      const [lo, hi] = TIER_BAND[a.tier];
      out.push(a.score < lo || a.score > hi ? { ...a, score: clamp(a.score, lo, hi) } : a);
    }
    s().alerts = out;
  }

  function resolveAlert(id: string, prefix: string, note: string) {
    const a = alerts.get(id);
    if (!a) return;
    put({ ...a, tier: 3, resolved: true, ack: true, queued: false, title: `${prefix} · ${a.title}`, body: note, notify: [], updatedAt: t() });
    if (interruptId === id) interruptId = null;
  }

  // ---------------------------------------------------------------------------
  // Projection
  // ---------------------------------------------------------------------------
  const ASSETS = () => {
    const w = h.world;
    return [
      { key: 'trailhead', name: 'Hollow Trailhead', p: w.trailhead },
      { key: 'town', name: 'the Pine Hollow SW edge', p: { x: w.town.x0 + 1, y: w.town.y1 - 1 } },
      { key: 'ridge', name: 'lower Ridge Rd', p: { x: 164, y: 68 } },
      { key: 'hwy', name: 'the HWY 49 corridor', p: { x: 146, y: 90 } },
    ];
  };

  function onForecast() {
    const st = s();
    for (const a of ASSETS()) {
      const b = bandIndex(st, a.p);
      const prev = projBand.has(a.key) ? projBand.get(a.key)! : -1;
      if (b >= 0 && (prev < 0 || b < prev)) {
        projBand.set(a.key, b);
        const id = `al-proj-${a.key}`;
        const eta = etaMin(h, a.p);
        const old = alerts.get(id);
        const hr = BAND_LABEL[b].slice(1);
        put({
          id, at: t(), cls: 'projection', tier: 2, score: CLASS_BASE.projection, title: `Projected path reaches ${a.name} within ${hr.replace('H', ' h')}`,
          body: `Projection rev ${st.forecastRev} puts ${a.name} inside the ${BAND_LABEL[b]} band on ${compass16(st.wind.dirDeg)} ${Math.round(st.wind.speedKph)} kph.${Number.isFinite(eta) && eta < 600 ? ` Front ETA ~${Math.round(eta / 5) * 5} min (${zuluIn(eta)}).` : ''}`,
          why: `Projection · ${BAND_LABEL[b]} band · conf ${(st.forecast[b]?.confidence ?? 0).toFixed(2)} · rev ${st.forecastRev}`,
          pos: { ...a.p }, radiusCells: 3, sourceIds: [], notify: ['fire'], ack: false, updatedAt: t(),
        });
        if (old) order = order.filter((x) => x !== id).concat(id);
      } else if (b < 0 && prev >= 0 && h.fireDistance(a.p) > 30) {
        projBand.delete(a.key);
        resolveAlert(`al-proj-${a.key}`, 'Cleared', `${cap(a.name)} is no longer inside the projected path (rev ${st.forecastRev}).`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Movements
  // ---------------------------------------------------------------------------
  const unit = (id: string) => s().units.find((u) => u.id === id);
  const centroid = (ids: string[]) => {
    const us = ids.map(unit).filter((u): u is NonNullable<typeof u> => !!u);
    const n = Math.max(1, us.length);
    return { x: us.reduce((a, u) => a + u.pos.x, 0) / n, y: us.reduce((a, u) => a + u.pos.y, 0) / n };
  };
  const obsBy = (key: string) => s().observations.find((o) => o.id === `obs-${key}` && !o.resolved);
  const alertOf = (key: string) => alerts.get(`al-obs-${key}`);
  const windowLabel = (w: [number, number]) => `${w[0] <= 0 ? 'NOW' : zuluIn(w[0])} → ${zuluIn(w[1])}`;

  function mk(p: { title: string; group: string; unitIds: string[]; to: Vec; window: [number, number]; zone: { center: Vec; radiusCells: number; label: string }; trigger: string; reason: string; score: number }): Omit<MovementProposal, 'id' | 'at' | 'status'> {
    const from = centroid(p.unitIds);
    return {
      title: p.title, group: p.group, unitIds: p.unitIds, from, to: { ...p.to }, route: h.roads.route(from, p.to),
      windowMin: p.window, safetyZone: p.zone, trigger: p.trigger, reason: p.reason, score: p.score, windowLabel: windowLabel(p.window),
    };
  }

  const RULES: Rule[] = [
    {
      key: 'stage-e22', units: ['e-22'], after: 'standby', when: () => true,
      build: () => {
        const town = { x: h.world.town.x0 + 1, y: h.world.town.y1 - 1 };
        const eta = etaMin(h, town);
        return mk({
          title: 'Stage E-22 at Pine Hollow school for structure defense', group: 'STRUCT GRP · E-22', unitIds: ['e-22'],
          to: { x: 170.2, y: 47.5 }, window: [0, 30], zone: { center: { x: 176, y: 45.5 }, radiusCells: 3, label: 'SCHOOL FIELD' },
          trigger: `+6H projection reaches the Pine Hollow SW edge${Number.isFinite(eta) && eta < 900 ? ` ~${zuluIn(eta)}` : ''}`,
          reason: 'The SW block is the first exposure on this wind. Staging now keeps HWY 49 clear for evacuation traffic later.', score: 66,
        });
      },
    },
    {
      key: 'diva-pullback', units: ['crew-7', 'crew-12', 'e-41'], after: 'standby', when: () => t() > 2400 && (s().wind.speedKph > 28 || h.fire().rosMpm > 42),
      build: () => mk({
        title: 'Pull DIV A back to the HWY 49 safety zone', group: 'DIV A · CREW-7, CREW-12, E-41', unitIds: ['crew-7', 'crew-12', 'e-41'],
        to: { x: 58, y: 109.6 }, window: [0, 15], zone: { center: { x: 58, y: 109.6 }, radiusCells: 4, label: 'BEAR CREEK TURNOUT' },
        trigger: `Wind ${compass16(s().wind.dirDeg)} ${Math.round(s().wind.speedKph)} kph G ${Math.round(s().wind.gustKph)}; +1H band overruns the flank line`,
        reason: 'Stronger wind pushes the flank across the current handline. The turnout is in the black with two escape routes.', score: 77,
      }),
    },
    {
      key: 'ranch-evac', units: ['e-17'], after: 'standby', group: 'ranch', groupNote: 'E-17 moved the Oak Ranch horses and resident out via HWY 49.',
      when: () => { const a = alertOf('horses') ?? alertOf('resident'); return !!a && !a.resolved && a.tier <= 2 && t() > 3000; },
      build: () => mk({
        title: 'Send E-17 to Oak Ranch to move horses and the resident out', group: 'E-17 · with CHP escort', unitIds: ['e-17'],
        to: { x: 104, y: 99 }, window: [0, 25], zone: { center: { x: 99.5, y: 104.5 }, radiusCells: 3, label: 'RANCH GATE · HWY 49' },
        trigger: `South flank reaches Oak Ranch ~${zuluIn(Math.min(240, etaMin(h, { x: 106, y: 97 })))}`,
        reason: 'Social video and a KCRA article place horses and their owner at the corral. Ground egress is open via HWY 49 now.', score: 72,
      }),
    },
    {
      key: 'e41-propane', units: ['e-41'], after: 'work', when: () => { const o = obsBy('propane'); return !!o && bandIndex(s(), o.pos) >= 0 && bandIndex(s(), o.pos) <= 1; },
      build: () => mk({
        title: 'Move E-41 to Miller Farm for propane protection', group: 'E-41', unitIds: ['e-41'],
        to: { x: 119.5, y: 68 }, window: [0, 20], zone: { center: { x: 141, y: 71 }, radiusCells: 3, label: 'IRRIGATED ORCHARD' },
        trigger: `+${bandIndex(s(), obsBy('propane')!.pos) === 0 ? '1' : '3'}H projection covers Miller Farm`,
        reason: 'Two 1000 gal tanks sit in the projected path. A wet line and clearance now avoid a BLEVE exposure later.', score: 70,
      }),
    },
    {
      key: 'dz1-ridge', units: ['dz-1'], after: 'standby', line: true,
      when: () => (h.world.roads.find((r) => r.id === 'ridge')?.points ?? []).some((p) => p.y > 52 && p.y < 84 && bandIndex(s(), p) >= 0),
      build: () => mk({
        title: 'Cut a DZ-1 contingency line along Ridge Rd', group: 'DZ-1', unitIds: ['dz-1'],
        to: { x: 166.8, y: 58 }, window: [0, 40], zone: { center: { x: 176, y: 45.5 }, radiusCells: 3, label: 'SCHOOL FIELD' },
        trigger: '+6H projection crosses Ridge Rd',
        reason: 'Ridge Rd is the last road break before Pine Hollow. A dozer line along it gives engines an anchor.', score: 64,
      }),
    },
    {
      key: 'crew7-reservoir', units: ['crew-7'], after: 'work', when: () => fired.has('mv:diva-pullback-done') && t() > 4800,
      build: () => mk({
        title: 'Reposition CREW-7 to anchor at Cedar Reservoir', group: 'CREW-7', unitIds: ['crew-7'],
        to: { x: 58, y: 123 }, window: [10, 45], zone: { center: { x: 58, y: 125.5 }, radiusCells: 3, label: 'RESERVOIR SHORE' },
        trigger: 'Heel holding at HWY 49; south flank still open',
        reason: 'Anchoring the heel at the reservoir closes the south flank with a natural barrier.', score: 61,
      }),
    },
  ];

  function propose(rule: Rule) {
    const body = rule.build();
    if (!body) return;
    const mv: MovementProposal = { ...body, id: h.nextId('mv'), at: t(), status: 'proposed' };
    moves.set(mv.id, { mv, rule, tag: mv.id });
    fired.add(`rule:${rule.key}`);
    put({
      id: `al-${mv.id}`, at: t(), cls: 'movement', tier: tierForScore(mv.score), score: mv.score, title: mv.title,
      body: `${mv.reason} Window ${mv.windowLabel}.`, why: `Movement · ${mv.group} · trigger: ${mv.trigger}`,
      pos: { ...mv.to }, radiusCells: mv.safetyZone.radiusCells, movementId: mv.id, sourceIds: [], notify: ['fire'], ack: false, updatedAt: t(),
    });
    publishMoves();
    return mv;
  }

  function publishMoves() {
    s().movements = [...moves.values()].map((m) => m.mv).sort((a, b) => b.at - a.at);
    h.markDirty();
  }

  function setMove(r: MoveRt, p: Partial<MovementProposal>) {
    r.mv = { ...r.mv, ...p };
    publishMoves();
  }

  function updateMoves() {
    let proposed = 0;
    for (const r of moves.values()) {
      if (r.mv.status === 'proposed') {
        proposed++;
        if (t() - r.mv.at > r.mv.windowMin[1] * 60) {
          setMove(r, { status: 'rejected' });
          resolveAlert(`al-${r.mv.id}`, 'Lapsed', `Window closed without a decision. ${r.mv.group} keeps its current assignment.`);
          fired.add(`mv:${r.rule.key}-done`);
        }
      } else if (r.mv.status === 'executing' || r.mv.status === 'approved') {
        if (r.mv.unitIds.every((u) => h.routeDone(u, r.tag))) {
          setMove(r, { status: 'done' });
          fired.add(`mv:${r.rule.key}-done`);
          log(`Movement complete · ${r.mv.title}`, `${r.mv.group} in position at ${r.mv.safetyZone.label}.`, [r.mv.id], r.mv.to);
          if (r.rule.group) intel().resolveGroup(r.rule.group, r.rule.groupNote ?? 'Cleared.');
        }
      }
    }
    for (const rule of RULES) {
      if (proposed >= 2) break;
      if (fired.has(`rule:${rule.key}`)) continue;
      const busy = [...moves.values()].some((m) => (m.mv.status === 'proposed' || m.mv.status === 'executing') && m.mv.unitIds.some((u) => rule.units.includes(u)));
      if (busy) continue;
      if (!rule.when()) continue;
      const mv = propose(rule);
      if (mv) {
        proposed++;
        say(`Proposal · ${mv.title}. ${mv.reason} Window ${mv.windowLabel}.`, [mv.id]);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Headline, brief, suggestions
  // ---------------------------------------------------------------------------
  function passed(p: Vec) {
    const g = s().grid;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = Math.floor(p.x) + dx, y = Math.floor(p.y) + dy;
      if (x >= 0 && y >= 0 && x < g.w && y < g.h && g.state[y * g.w + x] !== 0) n++;
    }
    return n >= 2;
  }

  function headTarget() {
    let best: { name: string; band: number } | null = null;
    for (const a of ASSETS()) {
      if (passed(a.p)) continue;
      const b = bandIndex(s(), a.p);
      if (b >= 0 && (!best || b < best.band)) best = { name: a.name.replace(/^the /, ''), band: b };
    }
    return best;
  }

  function updateBrief() {
    const st = s();
    const f = h.fire();
    const tgt = headTarget();
    const headline = `Head running ${compass16(st.wind.dirDeg + 180)} at ${Math.round(f.rosMpm)} m/min${tgt ? ` toward ${tgt.name}` : ''}`;
    const life = st.observations.filter((o) => !o.resolved && (o.kind === 'human' || o.kind === 'animal'));
    const lifeAlerts = life.map((o) => ({ o, a: alerts.get(`al-${o.id}`) })).filter((x) => x.a && x.a.tier <= 1).sort((a, b) => b.a!.score - a.a!.score);
    let b1: string;
    if (lifeAlerts.length) {
      const { o } = lifeAlerts[0];
      const m = intel().meta(o.id)!;
      const eta = etaMin(h, m.truePos);
      b1 = `${cap(m.noun)} at ${m.place}, ${o.confirmed ? `confirmed by ${m.confirmedBy}` : `unconfirmed (${o.sourceLabel})`}${Number.isFinite(eta) && eta < 600 ? `; fire ETA ~${Math.max(5, Math.round(eta / 5) * 5)} min` : ''}.${lifeAlerts.length > 1 ? ` ${lifeAlerts.length - 1} more life item${lifeAlerts.length > 2 ? 's' : ''} on watch.` : ''}`;
    } else b1 = life.length ? `${plural(life.length, 'life report')} on watch, none in the projected path.` : 'No people or animals reported in the projected path.';
    const haz = [...alerts.values()].filter((a) => !a.resolved && (a.cls === 'hazard' || a.cls === 'fuel') && a.tier <= 2).sort((a, b) => b.score - a.score)[0];
    const b2 = haz ? `${haz.title}; ${haz.notify.length ? `${list(haz.notify.map((x) => AUD_LABEL[x]))} notified` : 'on the map only'}.` : 'No combustible hazards inside the projected path.';
    const prop = [...moves.values()].filter((m) => m.mv.status === 'proposed').map((m) => m.mv);
    const exec = [...moves.values()].filter((m) => m.mv.status === 'executing').map((m) => m.mv);
    const b3 = prop.length
      ? `${plural(prop.length, 'movement')} awaiting approval: ${prop[0].title}.`
      : exec.length ? `${exec[0].group} moving: ${exec[0].title.toLowerCase()}.`
      : `${st.metrics.activeUnits} units committed · ${Math.round(st.metrics.containmentPct)}% contained.`;
    const cur = interruptId ? alerts.get(interruptId) : undefined;
    const sugg: string[] = [];
    if (cur && cur.observationId) {
      const m = intel().meta(cur.observationId);
      if (m) sugg.push(`What should we do about the ${m.noun.replace(/^\d+\s*/, '').replace(/^(a|an|the)\s+/i, '')}?`);
    }
    if (prop.length) sugg.push(`Why ${prop[0].title.split(' ').slice(0, 3).join(' ').toLowerCase()}?`);
    sugg.push('Where is the fire heading?');
    sugg.push('Who is at risk?');
    sugg.push('What changed in the last 30 minutes?');
    const busiest = st.coverage.filter((c) => c.assignedUnitId).sort((a, b) => b.interest - a.interest)[0];
    const bu = busiest ? unit(busiest.assignedUnitId!) : undefined;
    if (bu) sugg.push(`What is ${bu.callsign} seeing?`);
    const o: OrchestratorState = {
      status: pending ? 'analyzing' : briefingLeft > 0 ? 'briefing' : 'monitoring',
      headline, brief: [b1, b2, b3], messages, suggestions: [...new Set(sugg)].slice(0, 4),
    };
    st.orchestrator = o;
    h.markDirty();
  }

  // ---------------------------------------------------------------------------
  // Q&A
  // ---------------------------------------------------------------------------
  function answer(q: string): { text: string; refs?: string[] } {
    const st = s();
    const f = h.fire();
    const text = q.toLowerCase();
    const top = st.alerts.filter((a) => !a.resolved).sort((a, b) => b.score - a.score);
    const cs = text.match(/\b(hawk|e|crew|h|t|dz)[\s-]?(\d{1,3})\b/i);
    if (cs) {
      const id = `${cs[1].toLowerCase()}-${cs[2]}`;
      const u = unit(id);
      if (u) {
        const feed = st.feeds.find((x) => x.unitId === u.id);
        const cell = st.coverage.find((c) => c.assignedUnitId === u.id);
        const focus = feed?.focusObservationId ? st.observations.find((o) => o.id === feed.focusObservationId) : undefined;
        const mv = st.movements.find((m) => m.unitIds.includes(u.id) && (m.status === 'executing' || m.status === 'proposed'));
        const parts = [`${u.callsign} is ${u.status} at GRID ${gridRef(u.pos)}, heading ${compass16(u.heading)}.`];
        if (typeof u.battery === 'number') parts.push(`Battery ${Math.round(u.battery * 100)}%.`);
        if (typeof u.water === 'number') parts.push(`Water ${Math.round(u.water * 100)}%.`);
        if (cell) parts.push(`Sweeping coverage cell ${cell.id} (interest ${Math.round(cell.interest * 100)}).`);
        if (focus) parts.push(`In view: ${focus.label.toLowerCase()}${focus.live ? ', live' : ''}.`);
        else if (feed) parts.push('Nothing flagged in view right now.');
        if (mv) parts.push(`${mv.status === 'proposed' ? 'Proposed' : 'Executing'}: ${mv.title.toLowerCase()}.`);
        return { text: parts.join(' '), refs: [u.id, ...(focus ? [focus.id] : [])] };
      }
    }
    if (/(people|person|life|animal|hiker|resident|horse|cattle|evac|civilian|who is at risk|at risk)/.test(text)) {
      const life = st.observations.filter((o) => !o.resolved && (o.kind === 'human' || o.kind === 'animal'));
      if (!life.length) return { text: 'No people or animals are reported in the area right now. I will interrupt if a report lands in the projected path.' };
      const rows = life.map((o) => {
        const m = intel().meta(o.id)!;
        const a = alerts.get(`al-${o.id}`);
        const eta = etaMin(h, m.truePos);
        return { o, m, a, eta };
      }).sort((x, y) => (y.a?.score ?? 0) - (x.a?.score ?? 0)).slice(0, 4);
      const lines = rows.map((r) => `${cap(r.m.noun)} at ${r.m.place}: ${r.o.confirmed ? `confirmed by ${r.m.confirmedBy}` : `unconfirmed, ±${r.o.uncertaintyM} m`}${Number.isFinite(r.eta) && r.eta < 600 ? `, fire ETA ~${Math.max(5, Math.round(r.eta / 5) * 5)} min` : ''} (score ${r.a?.score ?? '–'}).`);
      const mv = st.movements.find((m) => m.status === 'proposed' && /ranch|hiker|resident/i.test(m.title));
      return { text: `${lines.join(' ')}${mv ? ` Recommended: ${mv.title.toLowerCase()}.` : ''}`, refs: rows.map((r) => r.o.id) };
    }
    if (/(risk|danger|threat|worst|priority|urgent|concern)/.test(text)) {
      if (!top.length) return { text: 'Nothing is scoring above ambient right now. The front is the main risk.' };
      const rows = top.slice(0, 3).map((a, i) => `${i + 1}) ${a.title} (score ${a.score}, ${a.why.split(' · ').slice(0, 2).join(', ').toLowerCase()})`);
      return { text: `Highest risk right now: ${rows.join('; ')}.`, refs: top.slice(0, 3).map((a) => a.id) };
    }
    if (/(move|where should|crew|force|position|stage|route|why|reposition|pull|dispatch|resources)/.test(text)) {
      const prop = st.movements.filter((m) => m.status === 'proposed');
      const ex = st.movements.filter((m) => m.status === 'executing');
      if (!prop.length && !ex.length) return { text: `No movements pending. ${st.metrics.activeUnits} units are committed; I will propose a move when the projection or a finding warrants one.` };
      const p = prop[0] ?? ex[0];
      return {
        text: `${p.status === 'proposed' ? 'I recommend' : 'In progress'}: ${p.title.toLowerCase()} (${p.group}). ${p.reason} Route ${p.route.length > 2 ? 'follows roads' : 'is cross-country'}, window ${p.windowLabel ?? `${p.windowMin[0]}–${p.windowMin[1]} min`}, safety zone ${p.safetyZone.label}. Trigger: ${p.trigger}.${prop.length > 1 ? ` ${prop.length - 1} more proposal waiting.` : ''}`,
        refs: [p.id],
      };
    }
    if (/(weather|wind|humid|rh\b|red flag|gust|temperature)/.test(text)) {
      const w = st.wind, wx = st.weather;
      return { text: `Wind ${compass16(w.dirDeg)} ${Math.round(w.speedKph)} kph gusting ${Math.round(w.gustKph)}, RH ${Math.round(wx.humidityPct)}%, ${Math.round(wx.tempC)}°C, fuel moisture ${wx.fuelMoisturePct.toFixed(0)}%.${wx.redFlag ? ' Red Flag Warning in effect.' : ''} That drives the head ${compass16(w.dirDeg + 180)} at ~${Math.round(f.rosMpm)} m/min.` };
    }
    if (/(projection|path|forecast|spread|heading|eta|reach|direction|going)/.test(text)) {
      const reach = ASSETS().map((a) => ({ a, b: bandIndex(st, a.p), eta: etaMin(h, a.p) })).filter((x) => x.b >= 0).sort((x, y) => x.b - y.b);
      const bands = st.forecast.map((b) => `${BAND_LABEL[[60, 180, 360].indexOf(b.horizonMin)]} ${Math.round(b.confidence * 100)}%`).join(', ');
      return {
        text: `Head running ${compass16(st.wind.dirDeg + 180)} at ${Math.round(f.rosMpm)} m/min from GRID ${gridRef(f.head)}. ${reach.length ? reach.map((r) => `${cap(r.a.name)} is inside ${BAND_LABEL[r.b]}${Number.isFinite(r.eta) && r.eta < 600 ? ` (ETA ~${zuluIn(r.eta)})` : ''}`).join('; ') + '.' : 'No named assets inside the projection.'} Projection rev ${st.forecastRev}, confidence ${bands}.`,
      };
    }
    if (/(summary|summar|brief|last|update|sitrep|changed|happen|status|overview)/.test(text)) {
      const since = t() - 1800;
      const fresh = st.alerts.filter((a) => a.at >= since && a.cls !== 'status' && !a.resolved);
      const conf = st.alerts.filter((a) => a.at >= since && a.cls === 'status' && /confirm/i.test(a.title)).length;
      const done = st.alerts.filter((a) => a.updatedAt !== undefined && a.updatedAt >= since && a.resolved).length;
      return {
        text: `${st.orchestrator.headline}. Last 30 min: ${plural(fresh.length, 'new item')}${fresh.length ? ` (${fresh.slice(0, 3).map((a) => a.title.toLowerCase()).join('; ')})` : ''}, ${plural(conf, 'drone confirmation')}, ${plural(done, 'item')} cleared. ${Math.round(f.acres)} ac, ${Math.round(st.metrics.containmentPct)}% contained.`,
        refs: fresh.slice(0, 3).map((a) => a.id),
      };
    }
    return { text: `I can brief you on risk, people and animals, forces and movements, weather, or the projected path. Right now: ${st.orchestrator.headline.toLowerCase()}.` };
  }

  // ---------------------------------------------------------------------------
  // Events from intel
  // ---------------------------------------------------------------------------
  const events: Orchestrator['events'] = {
    onNew() { lastGradeT = -1e9; },
    onConfirm(id, by, prevUncM) {
      const m = intel().meta(id);
      const o = s().observations.find((x) => x.id === id);
      if (!m || !o) return;
      log(`${by} confirmed ${lc(m.noun)}`, `Location fixed at GRID ${gridRef(m.truePos)}; uncertainty ±${prevUncM} m → ±20 m.`, [id], m.truePos);
      if (o.kind === 'human' || (o.kind === 'animal' && !m.wildlife)) say(`${by} confirms ${lc(m.noun)} at ${m.place}. Position is exact now.`, [id]);
      lastGradeT = -1e9;
    },
    onResolve(id, note) {
      resolveAlert(`al-${id}`, 'Cleared', note);
      const m = intel().meta(id);
      if (m && /human|animal/.test(s().observations.find((o) => o.id === id)?.kind ?? '')) say(note, [id]);
    },
    onExpire(id) {
      const a = alerts.get(`al-${id}`);
      if (a) resolveAlert(a.id, 'Aged out', `No new reports; the ${a.title.toLowerCase()} report faded below 5% freshness.`);
    },
    onLog(title, body) { log(title, body); },
  };

  return {
    events,
    seed() {
      const st = s();
      const f = h.fire();
      const pools = st.pools.length;
      gradeAll();
      onForecast();
      const mv = propose(RULES[0]);
      say(`Monitoring 8 input types across ${pools} agent pools: Firecrawl news, NASA FIRMS / Sentinel-2 / GOES-18, ${st.feeds.filter((x) => x.kind === 'vehicle').length} dash cams, ${st.units.filter((u) => u.kind === 'drone').length} drones, social video, NWS, USGS 3DEP and command radio.`);
      say(`Hollow Fire is ~${Math.round(f.acres)} ac, head running ${compass16(st.wind.dirDeg + 180)} at ${Math.round(f.rosMpm)} m/min. I will only interrupt you for life safety.`);
      const focus = [...alerts.values()].filter((a) => a.tier === 1 && a.cls !== 'movement').sort((a, b) => b.score - a.score)[0];
      say(`Needs attention: ${focus ? focus.title.toLowerCase() : 'nothing urgent'}${mv ? `, and a proposal to ${mv.title.charAt(0).toLowerCase()}${mv.title.slice(1)}` : ''}.`, [focus?.id, mv?.id].filter((x): x is string => !!x));
      lastForecastRev = st.forecastRev;
      lastSitrepT = t();
      placeTiers();
      publishAlerts();
      updateBrief();
    },
    reset() {
      alerts.clear(); order = []; messages = []; interruptId = null; lastInterruptAt = -1e9; lastGradeT = -1e9; lastRuleT = -1e9;
      lastBriefT = -1e9; lastSitrepT = -1e9; lastForecastRev = -1; projBand.clear(); moves.clear(); fired.clear(); firedGroups.clear(); habit.clear(); pending = null;
      briefingLeft = 0; msgId = 0; firstSeen.clear();
    },
    update() {
      const st = s();
      if (st.forecastRev !== lastForecastRev) { lastForecastRev = st.forecastRev; onForecast(); }
      if (t() - lastRuleT >= 60) { lastRuleT = t(); updateMoves(); }
      if (t() - lastGradeT >= 30) { lastGradeT = t(); gradeAll(); }
      if (t() - lastSitrepT >= 3600) {
        lastSitrepT = t();
        say(`Sitrep · ${st.orchestrator.headline}. ${st.orchestrator.brief.join(' ')}`);
      }
      publishAlerts();
      if (t() - lastBriefT >= 30) { lastBriefT = t(); updateBrief(); }
    },
    tickReal(dt) {
      if (briefingLeft > 0) {
        briefingLeft -= dt;
        if (briefingLeft <= 0) { s().orchestrator = { ...s().orchestrator, status: pending ? 'analyzing' : 'monitoring' }; h.markDirty(); }
      }
      if (!pending) return;
      pending.left -= dt;
      if (pending.left > 0) return;
      const q = pending.text;
      pending = null;
      const a = answer(q);
      say(a.text, a.refs);
      updateBrief();
    },
    ask(text) {
      const q = text.trim();
      if (!q) return;
      say(q, undefined, 'user');
      pending = { text: q, left: REPLY_DELAY };
      s().orchestrator = { ...s().orchestrator, messages, status: 'analyzing' };
      h.markDirty();
    },
    ack(id) {
      const a = alerts.get(id);
      if (!a || a.ack) return;
      put({ ...a, ack: true, tier: a.tier === 0 ? 1 : a.tier, queued: false });
      if (interruptId === id) interruptId = null;
      placeTiers();
      publishAlerts();
      updateBrief();
    },
    approve(id) {
      const r = moves.get(id);
      if (!r || r.mv.status !== 'proposed') return;
      setMove(r, { status: 'executing' });
      h.dispatch(r.mv.unitIds, r.mv.to, { after: r.rule.after, tag: r.tag, line: r.rule.line });
      resolveAlert(`al-${id}`, 'Approved', `${r.mv.group} dispatched along the proposed route to ${r.mv.safetyZone.label}.`);
      say(`Dispatched · ${r.mv.group}: ${r.mv.title.toLowerCase()}. Field units notified; I will report when they are in position.`, [id]);
      publishAlerts();
      updateBrief();
    },
    reject(id) {
      const r = moves.get(id);
      if (!r || r.mv.status !== 'proposed') return;
      setMove(r, { status: 'rejected' });
      fired.add(`mv:${r.rule.key}-done`);
      resolveAlert(`al-${id}`, 'Rejected', `${r.mv.group} keeps its current assignment.`);
      publishAlerts();
      updateBrief();
    },
  };
}
