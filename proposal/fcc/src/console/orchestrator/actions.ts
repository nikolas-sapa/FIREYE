import type { Action, ActionKind, Draft } from '../contracts';
import type { Sim } from '../world/sim';
import { nid } from '../world/sim';
import { MIN, destination, distanceM } from '../world/geo';
import { orbitUnit, resumePatrol, sendTo, unitById } from '../world/units';
import { rebuildCoverage } from '../world/coverage';
import { addLedger, enqueue } from '../agents/swarm';
import { requestProjection } from '../agents/projection';
import { emitDirective } from './directives';
import { say } from './messages';

export type ProposeInput = Omit<Action, 'id' | 'status' | 'proposedAt' | 'requiresApproval' | 'decidedBy'>;

const DRAFT_MIN: Partial<Record<ActionKind, number>> = { 'evac-notice': 20, sitrep: 25, 'radio-script': 8, 'resource-order': 10, rescue: 12, 'move-group': 10 };

/** Low-risk actions may auto-execute in Act autonomy; high-risk ones always wait for approval. */
export function propose(sim: Sim, inp: ProposeInput): Action {
  const autonomy = sim.settings.autonomy;
  const requiresApproval = inp.risk === 'high' || autonomy !== 'act';
  const draft: Draft | undefined = autonomy === 'advise' ? undefined : inp.draft;
  const a: Action = { ...inp, draft, id: nid(sim, 'act'), status: 'proposed', proposedAt: sim.t, requiresApproval };
  sim.actions = [a, ...sim.actions];
  sim.bus.publish({ type: 'action.proposed', at: sim.t, action: a });
  if (draft) {
    enqueue(sim, 'pool-orchestrator', {
      input: `Draft · ${draft.title}`,
      minutes: DRAFT_MIN[a.kind] ?? 5,
      counters: { draftsWritten: 1 },
      durS: 4,
      text: (ag) => `${ag} drafted ${draft.title}`,
    });
  }
  if (requiresApproval) emitDirective(sim, { kind: 'requestDecision', actionId: a.id, reason: a.summary });
  else execute(sim, a.id, 'orchestrator');
  sim.gradeDirty = true;
  sim.briefDirty = true;
  return a;
}

function patch(sim: Sim, id: string, p: Partial<Action>): Action | undefined {
  let out: Action | undefined;
  sim.actions = sim.actions.map((a) => {
    if (a.id !== id) return a;
    out = { ...a, ...p };
    return out;
  });
  return out;
}

function decide(sim: Sim, id: string, status: Action['status'], by: 'user' | 'orchestrator'): Action | undefined {
  const a = patch(sim, id, { status, decidedBy: by });
  if (a) sim.bus.publish({ type: 'action.decided', at: sim.t, actionId: id, status, by });
  sim.gradeDirty = true;
  sim.briefDirty = true;
  return a;
}

export function findAction(sim: Sim, id: string): Action | undefined {
  return sim.actions.find((a) => a.id === id);
}

export function approve(sim: Sim, id: string, by: 'user' | 'orchestrator' = 'user'): void {
  const a = findAction(sim, id);
  if (!a || a.status !== 'proposed') return;
  decide(sim, id, 'approved', by);
  execute(sim, id, by);
}

export function reject(sim: Sim, id: string): void {
  const a = findAction(sim, id);
  if (!a || a.status !== 'proposed') return;
  decide(sim, id, 'rejected', 'user');
  say(sim, `Understood, I will not ${a.title.charAt(0).toLowerCase()}${a.title.slice(1)}. I will keep watching the situation.`, [id]);
}

export function editDraft(sim: Sim, id: string, body: string): void {
  const a = findAction(sim, id);
  if (!a?.draft) return;
  patch(sim, id, { draft: { ...a.draft, body } });
}

function releaseDrone(sim: Sim, unitId: string): void {
  const u = unitById(sim, unitId);
  const m = sim.umeta.get(unitId);
  if (!u || !m) return;
  u.taskId = undefined;
  u.route = undefined;
  m.plan = { mode: 'hold' };
  m.altAGL = 120;
  rebuildCoverage(sim);
}

export function undo(sim: Sim, id: string): void {
  const a = findAction(sim, id);
  if (!a || !(a.status === 'executing' || a.status === 'done' || a.status === 'approved')) return;
  if (a.kind === 'retask-drone') for (const u of a.unitIds) releaseDrone(sim, u);
  else if (a.kind === 'move-group' || a.kind === 'rescue') for (const u of a.unitIds) resumePatrol(sim, u);
  decide(sim, id, 'undone', 'user');
  say(sim, `Undone: ${a.title}. ${a.kind === 'retask-drone' ? 'The drone is back on its coverage sweep.' : 'Units return to their previous assignment.'}`, [id]);
}

function execute(sim: Sim, id: string, by: 'user' | 'orchestrator'): void {
  const a = findAction(sim, id);
  if (!a) return;
  const cs = (uid: string) => unitById(sim, uid)?.callsign ?? uid;
  switch (a.kind) {
    case 'retask-drone': {
      const did = a.unitIds[0];
      const u = unitById(sim, did);
      if (u && a.target) {
        orbitUnit(sim, did, a.target, 140);
        u.taskId = a.id;
        sim.coverage = sim.coverage.map((c) => (c.unitId === did ? { ...c, unitId: undefined } : c));
      }
      addLedger(sim, 'ORCH', `Tasked ${cs(did)}: ${a.title}`, 2, { droneTasksIssued: 1 });
      decide(sim, id, 'executing', by);
      if (by === 'orchestrator') say(sim, `I retasked ${cs(did)} to ${a.summary.split('.')[0].replace(/^.*?confirm/i, 'confirm').trim() || 'the report'}. Low risk, so I did it in Act mode · Undo`, [id]);
      break;
    }
    case 'rescue': {
      const ems = a.unitIds[0];
      const u = unitById(sim, ems);
      if (u && a.target) {
        const path = sendTo(sim, ems, a.target, { road: true, after: 'hold', speed: 16 });
        u.taskId = a.id;
        patch(sim, id, { route: path });
      }
      decide(sim, id, 'executing', by);
      say(sim, `Rescue tasking sent: ${cs(ems)} is rolling, ${a.unitIds[1] ? `${cs(a.unitIds[1])} stays overhead.` : ''}`, [id]);
      break;
    }
    case 'move-group': {
      const center = a.safetyZone?.center ?? a.target ?? sim.ctx.sites.gf;
      a.unitIds.forEach((uid, k) => {
        const u = unitById(sim, uid);
        if (!u) return;
        u.taskId = a.id;
        sendTo(sim, uid, destination(center, k * 120, 120 + k * 60), { road: true, after: 'hold', speed: u.kind === 'dozer' ? 8 : 14 });
      });
      decide(sim, id, 'executing', by);
      break;
    }
    case 'evac-notice': {
      emitDirective(sim, { kind: 'notify', audiences: ['public', 'law'], message: `${a.title} issued (simulated)`, reason: a.summary, itemId: a.itemId });
      sendTo(sim, 'so-5', sim.ctx.sites.gf, { road: true, after: 'patrol' });
      decide(sim, id, 'done', by);
      say(sim, `${a.title} is out to the public alert channel and law enforcement (simulated). SO-5 is moving to traffic control.`, [id]);
      break;
    }
    case 'radio-script': {
      emitDirective(sim, { kind: 'notify', audiences: ['ops'], message: 'Div A hazard advisory transmitted', reason: a.summary, itemId: a.itemId });
      decide(sim, id, 'done', by);
      break;
    }
    case 'resource-order': {
      decide(sim, id, 'done', by);
      say(sim, 'Resource order transmitted to the ordering manager (simulated): 2 Type 1 engines and 1 VLAT.', [id]);
      break;
    }
    case 'sitrep': {
      decide(sim, id, 'done', by);
      say(sim, `${a.title} filed for the IC (simulated).`, [id]);
      break;
    }
    case 'reproject': {
      requestProjection(sim, 'new intel', [a.summary], true);
      decide(sim, id, 'done', by);
      if (by === 'orchestrator') say(sim, 'New intel changes the picture, so I asked the Projection agent for a new run · Undo', [id]);
      break;
    }
  }
}

/** Withdraws proposals that no longer make sense (intel expired or resolved, superseded drafts). */
function withdrawStale(sim: Sim): void {
  let latestSitrep = '';
  for (const a of sim.actions) if (a.kind === 'sitrep' && !latestSitrep) latestSitrep = a.id;
  const order = sim.actions.some((a) => a.kind === 'evac-notice' && a.title.includes('ORDER') && a.status !== 'rejected' && a.status !== 'undone');
  for (const a of sim.actions) {
    if (a.status !== 'proposed') continue;
    let why = '';
    if (a.itemId && a.itemId !== 'proj-head') {
      const f = sim.findings.find((x) => x.id === a.itemId);
      const fm = sim.fmeta.get(a.itemId);
      if (!f) why = 'the report it was based on has expired';
      else if (fm?.resolved) why = 'the situation is resolved';
      else if (a.kind === 'retask-drone' && fm?.confirmed) why = 'it is already confirmed';
    }
    if (!why && a.kind === 'sitrep' && a.id !== latestSitrep) why = 'a newer sitrep replaces it';
    if (!why && a.kind === 'evac-notice' && a.title.includes('WARNING') && order) why = 'the ORDER supersedes it';
    if (!why && a.kind === 'retask-drone' && sim.t - a.proposedAt > 30 * MIN) why = 'it was not approved within 30 min';
    if (why) {
      decide(sim, a.id, 'rejected', 'orchestrator');
      say(sim, `Withdrawn: ${a.title}, because ${why}.`, [a.id]);
    }
  }
}

/** Follows executing actions until they complete. */
export function tickActions(sim: Sim): void {
  withdrawStale(sim);
  for (const a of sim.actions) {
    if (a.kind === 'retask-drone' && (a.status === 'executing' || a.status === 'done')) {
      const did = a.unitIds[0];
      const u = unitById(sim, did);
      if (!u || u.taskId !== a.id) continue;
      const f = sim.findings.find((x) => x.id === a.itemId);
      const fm = a.itemId ? sim.fmeta.get(a.itemId) : undefined;
      if (a.status === 'executing' && fm?.confirmed) decide(sim, a.id, 'done', 'orchestrator');
      const stale = !f || !fm || fm.resolved || (f.kind !== 'human' && fm.confirmed && sim.t - a.proposedAt > 15 * MIN) || (!fm.confirmed && sim.t - a.proposedAt > 30 * MIN);
      if (stale) releaseDrone(sim, did);
    } else if (a.kind === 'rescue' && a.status === 'executing') {
      const ems = unitById(sim, a.unitIds[0]);
      const m = ems ? sim.umeta.get(ems.id) : undefined;
      const f = sim.findings.find((x) => x.id === a.itemId);
      const fm = a.itemId ? sim.fmeta.get(a.itemId) : undefined;
      if (!ems || !m || !f || !fm || !a.target) continue;
      if (m.plan.mode === 'hold' && distanceM(ems.pos, a.target) < 600) {
        fm.rescueStart ??= sim.t;
        if (sim.t - fm.rescueStart >= 6 * MIN) {
          fm.resolved = true;
          f.label = `${f.count ?? 2} HIKERS · SAFE WITH EMS ${ems.callsign}`;
          f.detail = `${ems.callsign} reached the hikers at ${sim.ctx.fmtTime(fm.rescueStart)}; both ambulatory, walked out to the ambulance. Simulated.`;
          sim.bus.publish({ type: 'analysis.finding', at: sim.t, finding: { ...f } });
          decide(sim, a.id, 'done', 'orchestrator');
          addLedger(sim, 'ORCH', `Rescue complete: ${f.label}`, 0);
          say(sim, `${ems.callsign} has the hikers. Both are walking out with the crew; ${a.unitIds[1] ? `${unitById(sim, a.unitIds[1])?.callsign} is released back to its sweep.` : ''}`, [a.id, f.id]);
          ems.taskId = undefined;
          sendTo(sim, ems.id, sim.ctx.sites.staging, { road: true, after: 'hold' });
        }
      }
    } else if (a.kind === 'move-group' && a.status === 'executing') {
      const arrived = a.unitIds.every((uid) => {
        const m = sim.umeta.get(uid);
        return !m || m.plan.mode !== 'path';
      });
      if (arrived) {
        decide(sim, a.id, 'done', 'orchestrator');
        for (const uid of a.unitIds) {
          const u = unitById(sim, uid);
          if (u) u.taskId = undefined;
        }
      }
    }
  }
}
