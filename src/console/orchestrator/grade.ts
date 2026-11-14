import type { Action, Audience, FindingKind, GradedItem, Geo, ItemKind, ScoreFactors, Zone } from '../contracts';
import { ZONE_CAPACITY } from '../contracts';
import type { ItemMeta, Sim } from '../world/sim';
import { MIN, centroid, clamp, distanceM, round } from '../world/geo';
import { emitDirective } from './directives';
import { ACTIONABILITY, CLS_LABEL, RELIABILITY, SEVERITY, clsOf, etaMin, etaText, exposureOf, lensFor, type Cls } from './score';

interface Cand {
  id: string;
  kind: ItemKind;
  refId: string;
  cls: Cls;
  title: string;
  body: string;
  pos?: Geo;
  sev: number;
  exp: number;
  conf: number;
  fresh: number;
  corr: number;
  act: number;
  lens: number;
  audiences: Audience[];
  eta: number;
  nSources: number;
  live: boolean;
  z0: boolean;
  isAction: boolean;
  fkind?: FindingKind;
  bundleOf?: string[];
  bonus?: number;
  minScore?: number;
  forced?: Zone;
  note?: string;
  ref?: { conf: number; unc: number; eta: number };
}

const RANK: Record<Zone, number> = { Z0_INTERRUPT: 0, Z1_STAGE: 1, Z2_DECISION: 2, Z3_FOCUS: 3, Z4_AMBIENT: 4, Z5_LEDGER: 5 };

const AUD: Record<FindingKind, Audience[]> = {
  human: ['ic', 'ems', 'ops'],
  animal: ['ems', 'law'],
  combustible: ['ops'],
  spot: ['ops', 'air'],
  structure: ['ops'],
  vehicle: ['law', 'ops'],
  'road-block': ['law', 'ops'],
  fuel: ['ops'],
  smoke: ['air', 'ic'],
  water: ['air'],
};

const ACTION_BASE: Record<Action['kind'], number> = {
  rescue: 95,
  'evac-notice': 90,
  'move-group': 82,
  'resource-order': 70,
  'radio-script': 66,
  'retask-drone': 62,
  reproject: 55,
  sitrep: 48,
};

const ACTION_CLS: Record<Action['kind'], Cls> = {
  rescue: 'life',
  'evac-notice': 'life',
  'move-group': 'movement',
  'resource-order': 'movement',
  'retask-drone': 'movement',
  'radio-script': 'hazard',
  reproject: 'projection',
  sitrep: 'status',
};

export function itemMeta(sim: Sim, id: string): ItemMeta {
  let m = sim.imeta.get(id);
  if (!m) {
    m = { enteredReal: sim.realS, lastScore: -1, seen: false, seenAt: 0, dismissed: false, pinned: false, acked: false, changedAt: sim.t, published: false };
    sim.imeta.set(id, m);
  }
  return m;
}

/** Novelty (0..8) on material change since the user last saw the item; fatigue (0..15) after seen / dismissed. */
function noveltyFatigue(sim: Sim, m: ItemMeta, ref?: { conf: number; unc: number; eta: number }): { nov: number; fat: number } {
  if (ref) {
    if (m.ref) {
      const r = m.ref;
      const material =
        ref.conf >= r.conf + 0.15 ||
        ref.unc <= r.unc * 0.5 ||
        (Number.isFinite(ref.eta) && Number.isFinite(r.eta) && r.eta > 5 && ref.eta >= 0 && ref.eta <= r.eta * 0.7);
      if (material) {
        m.changedAt = sim.t;
        m.seen = false;
        m.ref = ref;
      }
    } else m.ref = ref;
  }
  const ageMin = (sim.t - m.changedAt) / MIN;
  const nov = m.seen ? 0 : 8 * Math.max(0, 1 - ageMin / 15);
  const fat = m.pinned ? 0 : m.dismissed ? 15 : m.seen ? Math.min(8, 4 + (sim.t - m.seenAt) / MIN / 5) : 0;
  return { nov, fat };
}

function findingCands(sim: Sim): Map<string, Cand> {
  const out = new Map<string, Cand>();
  for (const f of sim.findings) {
    const fm = sim.fmeta.get(f.id);
    if (!fm) continue;
    const cls = clsOf(f.kind);
    const eta = etaMin(sim, f.pos, f.uncertaintyM);
    const exp = exposureOf(eta, f.kind);
    const rel = Math.max(...fm.sourceKinds.map((k) => RELIABILITY[k] ?? 0.8));
    const kinds = new Set(fm.sourceKinds);
    out.set(f.id, {
      id: f.id,
      kind: 'finding',
      refId: f.id,
      cls,
      title: f.label,
      body: f.detail,
      pos: f.pos,
      sev: fm.resolved ? 0.15 : SEVERITY[f.kind],
      exp,
      conf: f.confidence * rel,
      fresh: f.freshness,
      corr: Math.min(10, (kinds.size - 1) * 5),
      act: fm.resolved ? 0 : ACTIONABILITY[f.kind],
      lens: lensFor(sim.settings.lens, cls, f.kind, fm.sourceKinds),
      audiences: AUD[f.kind],
      eta,
      nSources: kinds.size,
      live: f.live,
      // A spot fire the main front has already reached is no longer an imminent, separate hazard.
      z0: !fm.resolved && (f.kind === 'human' || (cls === 'hazard' && exp >= 0.85 && (f.kind === 'combustible' || (f.kind === 'spot' && eta > 0)))),
      isAction: false,
      fkind: f.kind,
      ref: { conf: f.confidence, unc: f.uncertaintyM, eta },
    });
  }
  return out;
}

function rawScore(c: Cand, nov: number, fat: number): { score: number; factors: ScoreFactors } {
  const base = clamp(100 * c.sev * c.exp * c.conf * c.fresh * c.lens, 0, 100);
  let score = clamp(base + c.corr + c.act + nov - fat + (c.bonus ?? 0), 0, 100);
  if (c.minScore !== undefined) score = Math.max(score, c.minScore - fat);
  return {
    score: Math.round(score),
    factors: {
      severity: round(c.sev, 2),
      exposure: round(c.exp, 2),
      confidence: round(c.conf, 2),
      freshness: round(c.fresh, 2),
      corroboration: round(c.corr, 1),
      actionability: round(c.act, 1),
      novelty: round(nov, 1),
      fatigue: round(fat, 1),
      lens: round(c.lens, 2),
    },
  };
}

function bundle(sim: Sim, fc: Map<string, Cand>): Cand[] {
  const elig = sim.findings.filter((f) => {
    const fm = sim.fmeta.get(f.id);
    return fm && !fm.resolved && !f.live && f.kind !== 'human' && f.kind !== 'combustible' && f.kind !== 'spot' && !itemMeta(sim, f.id).pinned;
  });
  const parent = elig.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < elig.length; i++) {
    for (let j = i + 1; j < elig.length; j++) {
      if (distanceM(elig[i].pos, elig[j].pos) <= 400) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, string[]>();
  elig.forEach((f, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(f.id);
    else groups.set(r, [f.id]);
  });
  const out: Cand[] = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.sort();
    const members = ids.map((id) => fc.get(id)!).filter(Boolean);
    const top = members.reduce((a, b) => (b.sev * b.exp * b.conf > a.sev * a.exp * a.conf ? b : a));
    const place = ids.map((id) => sim.fmeta.get(id)?.place).find(Boolean) ?? sim.ctx.nearestPlace(top.pos!).name;
    const placeName = place
      .toLowerCase()
      .split(' ')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    const pos = centroid(members.map((m) => m.pos!));
    out.push({
      ...top,
      id: `bundle-${ids[0]}`,
      kind: 'bundle',
      title: `${ids.length} findings at ${placeName}`,
      body: members.map((m) => m.title).join(' · '),
      pos,
      bundleOf: ids,
      bonus: 2 * (ids.length - 1),
      audiences: [...new Set(members.flatMap((m) => m.audiences))],
      corr: Math.min(10, top.corr + 2 * (ids.length - 1)),
      act: Math.max(...members.map((m) => m.act)),
      z0: false,
      ref: undefined,
    });
    for (const m of members) {
      m.forced = 'Z5_LEDGER';
      m.note = `bundled into "${ids.length} findings at ${placeName}"`;
    }
  }
  return out;
}

function projectionCand(sim: Sim): Cand | null {
  const p = sim.projection;
  if (!p) return null;
  const t = sim.t;
  const c = sim.ctx;
  let placeId = c.gfId;
  let eta = p.etaToPlaces[placeId];
  if (eta === undefined || eta <= t) {
    let best: string | null = null;
    for (const pl of c.places) {
      if (pl.kind !== 'town' && pl.kind !== 'hamlet' && pl.kind !== 'ranch') continue;
      const e = p.etaToPlaces[pl.id];
      if (e !== undefined && e > t && (best === null || e < p.etaToPlaces[best])) best = pl.id;
    }
    if (best) {
      placeId = best;
      eta = p.etaToPlaces[best];
    }
  }
  const place = c.places.find((x) => x.id === placeId)!;
  const inside = eta === undefined || eta <= t;
  const m = inside ? 0 : (eta - t) / MIN;
  const age = (t - p.issuedAt) / MIN;
  return {
    id: 'proj-head',
    kind: 'projection',
    refId: `proj-rev-${p.rev}`,
    cls: 'projection',
    title: inside ? `Fire is in ${place.name}` : `Head reaches ${place.name} in ${Math.round(m)} min`,
    body: `Projection rev ${p.rev}: ${p.drivers.slice(0, 3).join(' · ')}`,
    pos: place.pos,
    sev: place.kind === 'town' ? 0.9 : 0.6,
    exp: exposureOf(m),
    conf: m <= 60 ? 0.8 : 0.6,
    fresh: Math.pow(0.5, age / 40),
    corr: 0,
    act: m <= 180 ? 10 : 4,
    lens: lensFor(sim.settings.lens, 'projection'),
    audiences: ['ic', 'ops', 'law'],
    eta: m,
    nSources: 3,
    live: false,
    z0: false,
    isAction: false,
    ref: { conf: 1, unc: 1, eta: m },
  };
}

function statusCands(sim: Sim): Cand[] {
  const out: Cand[] = [];
  const w = sim.ctx.weatherAt(sim.t);
  const base = { kind: 'status' as const, cls: 'status' as const, corr: 0, act: 0, lens: lensFor(sim.settings.lens, 'status'), audiences: ['ic', 'air'] as Audience[], nSources: 1, live: false, z0: false, isAction: false, fresh: 1 };
  if (w.gustKph >= 30 && w.rh <= 25) {
    out.push({ ...base, id: 'st-redflag', refId: 'st-redflag', title: `RED FLAG CONDITIONS · GUSTS ${Math.round(w.gustKph)} KPH · RH ${Math.round(w.rh)}%`, body: 'NWS Sacramento red flag criteria met (Open-Meteo archive + NWS alerts).', sev: 0.4, exp: 1, conf: 1, eta: Infinity });
  }
  if (sim.shiftApplied) {
    const a = sim.ctx.shiftFrom;
    const b = sim.ctx.shiftTo;
    out.push({ ...base, id: 'st-windshift', refId: 'st-windshift', title: `WIND SHIFT · ${Math.round(a.windDirDeg)}° → ${Math.round(b.windDirDeg)}° BY ${sim.ctx.fmtTime(b.t)}`, body: 'Evening wind shift from the Open-Meteo archive, ingested by the weather agent.', sev: 0.5, exp: 0.9, conf: 1, eta: Infinity, act: 4 });
  }
  return out;
}

function actionCands(sim: Sim, byId: Map<string, { c: Cand; score: number }>): Cand[] {
  const out: Cand[] = [];
  for (const a of sim.actions) {
    if (a.status !== 'proposed' || !a.requiresApproval) continue;
    const linked = a.itemId ? byId.get(a.itemId) : undefined;
    const l = linked?.c;
    const cls = ACTION_CLS[a.kind];
    out.push({
      id: a.id,
      kind: 'action',
      refId: a.id,
      cls,
      title: a.title,
      body: a.summary,
      pos: a.target,
      sev: l?.sev ?? 0.7,
      exp: l?.exp ?? 0.8,
      conf: l?.conf ?? 0.9,
      fresh: 1,
      corr: l?.corr ?? 0,
      act: 10,
      lens: lensFor(sim.settings.lens, cls),
      audiences: a.audiences,
      eta: l?.eta ?? Infinity,
      nSources: l?.nSources ?? 1,
      live: false,
      z0: false,
      isAction: true,
      minScore: Math.max(ACTION_BASE[a.kind], linked?.score ?? 0),
    });
  }
  return out;
}

function zoneFor(score: number, c: Cand, m: ItemMeta): Zone {
  if (c.isAction) return 'Z2_DECISION';
  if (score >= 85 && c.z0 && !m.acked) return 'Z0_INTERRUPT';
  if (score >= 60) return 'Z3_FOCUS';
  if (score >= 35) return 'Z4_AMBIENT';
  return 'Z5_LEDGER';
}

function placement(zone: Zone, note?: string): string {
  const p: Record<Zone, string> = {
    Z0_INTERRUPT: 'Z0 interrupt: score ≥ 85 and life or imminent hazard',
    Z1_STAGE: 'Z1 stage',
    Z2_DECISION: 'Z2 decision queue: needs approval',
    Z3_FOCUS: 'Z3 focus: score 60-84, top 3',
    Z4_AMBIENT: 'Z4 ambient: score 35-59, map glyph only',
    Z5_LEDGER: 'Z5 log: score below 35',
  };
  return note ? `${p[zone].split(':')[0]}: ${note}` : p[zone];
}

function reasonFor(c: Cand, f: ScoreFactors, zone: Zone, note?: string): string {
  const bits: string[] = [CLS_LABEL[c.cls]];
  if (c.bundleOf) bits.push(`${c.bundleOf.length} findings within 400 m`);
  if (c.kind !== 'status') bits.push(etaText(c.eta));
  bits.push(`conf ${f.confidence.toFixed(2)}`);
  if (c.kind === 'finding' || c.kind === 'bundle') bits.push(`${c.nSources} source${c.nSources > 1 ? 's' : ''}`);
  if (c.live) bits.push('live');
  else if (f.freshness < 0.9 && c.kind !== 'action') bits.push(`freshness ${f.freshness.toFixed(2)}`);
  if (f.lens !== 1) bits.push(`lens ×${f.lens}`);
  if (f.novelty >= 1) bits.push('changed');
  if (f.fatigue >= 1) bits.push(f.fatigue >= 15 ? 'dismissed' : 'seen');
  return `${bits.join(' · ')} → ${placement(zone, note)}`;
}

function bestFeed(sim: Sim, refId: string, pos?: Geo): string | null {
  const live = sim.feeds.filter((f) => f.live && f.findingIds.includes(refId));
  const drone = live.find((f) => f.kind.startsWith('uav'));
  if (drone) return drone.id;
  if (live.length) return live[0].id;
  if (!pos) return null;
  let best: string | null = null;
  let bd = Infinity;
  for (const f of sim.feeds) {
    if (!f.kind.startsWith('uav') || !f.unitId) continue;
    const u = sim.units.find((x) => x.id === f.unitId);
    if (!u) continue;
    const d = distanceM(u.pos, pos);
    if (d < bd) {
      bd = d;
      best = f.id;
    }
  }
  return best;
}

function onEnter(sim: Sim, it: GradedItem, old: Zone | undefined): void {
  if (it.zone === 'Z0_INTERRUPT') {
    const reason = `Z0 interrupt · ${it.reason}`;
    if (it.pos) emitDirective(sim, { kind: 'focusStage', itemId: it.id, target: it.pos, rangeM: 1400, pitchDeg: -35, reason });
    const feed = bestFeed(sim, it.refId, it.pos);
    if (feed) {
      const label = sim.feeds.find((f) => f.id === feed)?.label ?? feed;
      emitDirective(sim, { kind: 'promoteFeed', itemId: it.id, feedId: feed, reason: `${label} has the best live view of ${it.title}` });
    }
    emitDirective(sim, { kind: 'highlight', itemId: it.id, ids: [it.refId], reason });
    emitDirective(sim, { kind: 'dimOthers', itemId: it.id, on: true, reason: 'Interrupt: everything else is dimmed until acknowledged' });
    emitDirective(sim, { kind: 'notify', audiences: it.audiences, message: `${it.title} · ${etaText(etaMin(sim, it.pos ?? sim.ctx.sites.gf, 0))}`, reason: it.reason, itemId: it.id });
  } else if (old === 'Z0_INTERRUPT') {
    emitDirective(sim, { kind: 'dimOthers', itemId: it.id, on: false, reason: 'Interrupt cleared' });
    emitDirective(sim, { kind: 'restoreStage', reason: 'Interrupt cleared; back to the overview' });
  }
}

/** The attention engine: score every item, place it in a zone within the screen budget, emit directives. */
export function grade(sim: Sim): void {
  const t = sim.t;
  const fc = findingCands(sim);
  const bundles = bundle(sim, fc);
  const cands: Cand[] = [...fc.values(), ...bundles];
  const pc = projectionCand(sim);
  if (pc) cands.push(pc);
  cands.push(...statusCands(sim));

  const scored = new Map<string, { c: Cand; score: number; factors: ScoreFactors }>();
  for (const c of cands) {
    const m = itemMeta(sim, c.id);
    const { nov, fat } = noveltyFatigue(sim, m, c.ref);
    const r = rawScore(c, nov, fat);
    scored.set(c.id, { c, ...r });
  }
  for (const c of actionCands(sim, scored)) {
    const m = itemMeta(sim, c.id);
    const { nov, fat } = noveltyFatigue(sim, m);
    scored.set(c.id, { c, ...rawScore(c, nov, fat) });
  }

  // Desired zone: hysteresis ±5, 8 s minimum dwell, Z0 sticks until acknowledged.
  const desired = new Map<string, { zone: Zone; note?: string }>();
  for (const [id, s] of scored) {
    const m = itemMeta(sim, id);
    const c = s.c;
    let zone: Zone;
    if (c.forced) zone = c.forced;
    else if (m.zone === 'Z0_INTERRUPT' && !m.acked && c.z0) zone = 'Z0_INTERRUPT';
    else if (!m.zone || m.zone === 'Z5_LEDGER' && s.score >= 85 && c.z0) zone = zoneFor(s.score, c, m);
    else {
      const up = zoneFor(s.score - 5, c, m);
      const down = zoneFor(s.score + 5, c, m);
      zone = RANK[up] < RANK[m.zone] ? up : RANK[down] > RANK[m.zone] ? down : m.zone;
      if (c.isAction) zone = 'Z2_DECISION';
      if (zone === 'Z2_DECISION' && !c.isAction) zone = zoneFor(s.score, c, m);
    }
    let note = c.note;
    if (m.zone && zone !== m.zone && zone !== 'Z0_INTERRUPT' && m.zone !== 'Z0_INTERRUPT' && !c.isAction && !c.forced && sim.realS - m.enteredReal < 8) {
      zone = m.zone;
      note = note ?? 'holding for the 8 s minimum dwell';
    }
    if (m.zone === 'Z0_INTERRUPT' && zone !== 'Z0_INTERRUPT' && !m.acked && c.z0) zone = 'Z0_INTERRUPT';
    if (m.pinned && RANK[zone] > 3 && !c.forced) zone = 'Z3_FOCUS';
    if (m.dismissed && RANK[zone] < 4 && !c.isAction) zone = 'Z4_AMBIENT';
    desired.set(id, { zone, note });
  }

  // Capacity: Z0 1 (others queue), Z2 3, Z3 3, Z4 40.
  const inZone = (z: Zone) =>
    [...desired.entries()]
      .filter(([, d]) => d.zone === z)
      .map(([id]) => id)
      .sort((a, b) => {
        const ma = itemMeta(sim, a);
        const mb = itemMeta(sim, b);
        if (z === 'Z0_INTERRUPT' && (ma.zone === z) !== (mb.zone === z)) return ma.zone === z ? -1 : 1;
        if (z === 'Z3_FOCUS' && ma.pinned !== mb.pinned) return ma.pinned ? -1 : 1;
        return scored.get(b)!.score - scored.get(a)!.score;
      });
  const z0 = inZone('Z0_INTERRUPT');
  z0.slice(ZONE_CAPACITY.Z0_INTERRUPT).forEach((id) => desired.set(id, { zone: 'Z3_FOCUS', note: 'queued behind the current interrupt' }));
  const z2 = inZone('Z2_DECISION');
  z2.slice(ZONE_CAPACITY.Z2_DECISION).forEach((id, k) => desired.set(id, { zone: 'Z4_AMBIENT', note: `decision queued (#${ZONE_CAPACITY.Z2_DECISION + k + 1})` }));
  const z3 = inZone('Z3_FOCUS');
  z3.slice(ZONE_CAPACITY.Z3_FOCUS).forEach((id) => desired.set(id, { zone: 'Z4_AMBIENT', note: desired.get(id)?.note ?? 'Focus is full (top 3 only)' }));
  const z4 = inZone('Z4_AMBIENT');
  z4.slice(ZONE_CAPACITY.Z4_AMBIENT).forEach((id) => desired.set(id, { zone: 'Z5_LEDGER', note: 'ambient budget full' }));

  const items: GradedItem[] = [];
  const entered: { it: GradedItem; old?: Zone }[] = [];
  for (const [id, s] of scored) {
    const m = itemMeta(sim, id);
    const d = desired.get(id)!;
    const c = s.c;
    const old = m.zone;
    if (old !== d.zone) {
      m.zone = d.zone;
      m.enteredReal = sim.realS;
    }
    const it: GradedItem = {
      id,
      kind: c.kind,
      refId: c.refId,
      cls: c.cls,
      title: c.title,
      body: c.body,
      score: s.score,
      factors: s.factors,
      zone: d.zone,
      prevZone: old !== d.zone ? old : undefined,
      reason: reasonFor(c, s.factors, d.zone, d.note),
      pos: c.pos,
      bundleOf: c.bundleOf,
      audiences: c.audiences,
      seen: m.seen,
      dismissed: m.dismissed,
      pinned: m.pinned,
      updatedAt: t,
    };
    items.push(it);
    if (old !== d.zone) entered.push({ it, old });
    if (!m.published || old !== d.zone || Math.abs(s.score - m.lastScore) >= 3) {
      m.published = true;
      m.lastScore = s.score;
      sim.bus.publish({ type: 'orchestrator.graded', at: t, item: it });
    }
  }
  // Items that disappeared while in Z0 still need the stage restored.
  for (const [id, m] of sim.imeta) {
    if (m.zone === 'Z0_INTERRUPT' && !scored.has(id)) {
      m.zone = undefined;
      emitDirective(sim, { kind: 'dimOthers', itemId: id, on: false, reason: 'Interrupt resolved' });
      emitDirective(sim, { kind: 'restoreStage', reason: 'Interrupt resolved; back to the overview' });
    } else if (!scored.has(id)) m.zone = undefined;
  }
  items.sort((a, b) => b.score - a.score);
  sim.items = items;
  for (const e of entered) onEnter(sim, e.it, e.old);

  // Re-projection that materially changes an ETA earns a camera move.
  const p = sim.projection;
  const pi = items.find((i) => i.id === 'proj-head');
  if (p && pi && pi.factors.novelty >= 7 && p.rev > 1 && !sim.cues.has(`projfocus-${p.rev}`)) {
    sim.cues.add(`projfocus-${p.rev}`);
    const head = sim.projHead ?? sim.ctx.sites.gf;
    const target = pi.pos ? { lon: (head.lon + pi.pos.lon) / 2, lat: (head.lat + pi.pos.lat) / 2 } : head;
    emitDirective(sim, { kind: 'focusStage', itemId: pi.id, target, rangeM: 9000, pitchDeg: -50, reason: `Projection rev ${p.rev}: ${pi.title}` });
  }

  // Feed relevance: what is in view, linked items, and what is tasked.
  const scoreByFinding = new Map<string, number>();
  for (const it of items) if (it.kind === 'finding') scoreByFinding.set(it.refId, it.score);
  for (const it of items) if (it.kind === 'bundle') for (const id of it.bundleOf ?? []) scoreByFinding.set(id, Math.max(scoreByFinding.get(id) ?? 0, it.score));
  for (const f of sim.feeds) {
    let rel = f.kind === 'ridge-cam' ? 20 : f.kind === 'satellite' ? 12 : f.kind === 'social' ? 22 : 8;
    if (f.live) rel += 4;
    for (const id of f.findingIds) rel = Math.max(rel, 20 + (scoreByFinding.get(id) ?? 0) * 0.75);
    const u = f.unitId ? sim.units.find((x) => x.id === f.unitId) : undefined;
    if (u?.taskId) rel += 15;
    if (sim.stage.mode === 'feed' && sim.stage.feedId === f.id) rel = 100;
    f.relevance = Math.round(clamp(rel, 0, 100));
  }
}
