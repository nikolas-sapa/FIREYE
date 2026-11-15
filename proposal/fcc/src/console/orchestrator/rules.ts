import type { Finding, Unit } from '../contracts';
import type { Sim } from '../world/sim';
import { MIN, distanceM } from '../world/geo';
import { roadRoute, unitById } from '../world/units';
import { propose } from './actions';
import { emitDirective } from './directives';
import { sitrepDraft } from './drafts';
import { etaMin } from './score';

function has(sim: Sim, kind: string, itemId?: string): boolean {
  return sim.actions.some((a) => a.kind === kind && (itemId === undefined || a.itemId === itemId) && a.status !== 'undone');
}

function freeDrones(sim: Sim): Unit[] {
  return sim.units.filter((u) => u.kind === 'drone' && !u.taskId);
}

function proposeRetask(sim: Sim, f: Finding, preferId?: string): void {
  const free = freeDrones(sim).sort((a, b) => distanceM(a.pos, f.pos) - distanceM(b.pos, f.pos));
  if (!free.length) return;
  const pref = preferId ? free.find((u) => u.id === preferId && distanceM(u.pos, f.pos) < 9000) : undefined;
  const d = pref ?? free[0];
  const km = distanceM(d.pos, f.pos) / 1000;
  const what = f.label.split('·')[0].trim().toLowerCase();
  propose(sim, {
    kind: 'retask-drone',
    title: `Retask ${d.callsign} → confirm ${what}`,
    summary: `${d.callsign} can confirm ${what} on live video. It is ${km.toFixed(1)} km away (~${Math.max(1, Math.round((km * 1000) / 18 / 60))} min) and leaves a low-interest sweep cell.`,
    risk: 'low',
    audiences: ['air'],
    unitIds: [d.id],
    target: { lon: f.pos.lon, lat: f.pos.lat },
    route: [{ lon: d.pos.lon, lat: d.pos.lat }, { lon: f.pos.lon, lat: f.pos.lat }],
    itemId: f.id,
  });
}

function proposeRescue(sim: Sim, f: Finding): void {
  const plan = sim.ctx.script.plans.rescue;
  const approach = plan.approach?.(sim, f) ?? f.pos;
  const byDist = (a: Unit, b: Unit) => distanceM(a.pos, approach) - distanceM(b.pos, approach);
  let rescuers = plan.unitIds.map((id) => unitById(sim, id)).filter((u): u is Unit => !!u && !u.taskId);
  if (!rescuers.length) rescuers = sim.units.filter((u) => plan.kinds.includes(u.kind) && !u.taskId && !!sim.umeta.get(u.id)?.marine === !!plan.marine).sort(byDist).slice(0, 1);
  const lead = rescuers[0];
  if (!lead) return;
  const overwatch = sim.actions.find((a) => a.kind === 'retask-drone' && a.itemId === f.id);
  const drone = overwatch ? unitById(sim, overwatch.unitIds[0]) : undefined;
  const path = plan.marine ? [{ lon: lead.pos.lon, lat: lead.pos.lat }, approach] : roadRoute(sim.ctx, lead.pos, approach);
  const eta = etaMin(sim, f.pos, f.uncertaintyM);
  const place = sim.ctx.nearestPlace(f.pos).name;
  const ids = rescuers.map((u) => u.id);
  if (drone) ids.push(drone.id);
  propose(sim, {
    kind: 'rescue',
    title: plan.title(f, place),
    summary: plan.summary(lead, drone, eta),
    risk: 'high',
    audiences: ['ems', 'ops', 'ic'],
    unitIds: ids,
    target: { lon: approach.lon, lat: approach.lat },
    route: path,
    window: { startMin: 0, endMin: Math.max(10, Math.round(eta - 25)) },
    trigger: 'Turn around if fire is within 800 m or ETA under 25 min',
    safetyZone: plan.safety(sim.ctx),
    draft: plan.draft(sim, f, lead, drone, path, eta),
    itemId: f.id,
  });
}

function proposeHazard(sim: Sim, f: Finding): void {
  const plan = sim.ctx.script.plans.hazard;
  if (!plan) return;
  const near = sim.units.filter((u) => !['drone', 'helo', 'tanker'].includes(u.kind) && distanceM(u.pos, f.pos) <= 1500);
  const eta = etaMin(sim, f.pos, f.uncertaintyM);
  const list = near.map((u) => u.callsign).join(', ') || 'no units';
  emitDirective(sim, {
    kind: 'notify',
    audiences: ['ops'],
    message: `Hazard for ${list} only: ${f.label}`,
    reason: `Only units within 1.5 km are affected (${near.length}); nobody else is interrupted.`,
    itemId: f.id,
  });
  propose(sim, {
    kind: 'radio-script',
    title: plan.title,
    summary: `Hazard advisory for the ${near.length} units within 1.5 km (${list}). Fire ETA about ${Math.round(eta)} min.`,
    risk: 'low',
    audiences: ['ops'],
    unitIds: near.map((u) => u.id),
    target: { lon: f.pos.lon, lat: f.pos.lat },
    draft: plan.draft(sim, f, near, eta),
    itemId: f.id,
  });
}

function proposeHeadWork(sim: Sim): void {
  const p = sim.projection;
  const plans = sim.ctx.script.plans;
  const evac = plans.evac;
  if (!p || !evac) return;
  let eta: number | undefined;
  for (const id of [sim.ctx.primaryId, ...(evac.zonePlaceIds ?? [])]) {
    const e = p.etaToPlaces[id];
    if (e !== undefined && (eta === undefined || e < eta)) eta = e;
  }
  if (eta === undefined || eta <= sim.t) return;
  const m = (eta - sim.t) / MIN;
  const hasType = (type: string) => sim.actions.some((a) => a.kind === 'evac-notice' && a.itemId === 'proj-head' && a.title.includes(type) && a.status !== 'undone' && a.status !== 'rejected');
  const ctx = sim.ctx;
  if (m <= evac.orderMin && !hasType('ORDER')) {
    propose(sim, {
      kind: 'evac-notice',
      title: evac.title('ORDER', ctx),
      summary: evac.summary('ORDER', m, p.rev, ctx),
      risk: 'high',
      audiences: ['public', 'law', 'ic'],
      unitIds: evac.unitIds,
      target: ctx.sites.primary,
      window: { startMin: 0, endMin: Math.round(m) },
      trigger: `Modelled head ETA under ${evac.orderMin} min`,
      draft: evac.draft(sim, 'ORDER', m),
      itemId: 'proj-head',
    });
    const mg = plans.moveGroup;
    if (mg && !has(sim, 'move-group')) {
      const units = mg.unitIds.map((id) => unitById(sim, id)).filter((u): u is Unit => !!u);
      const lead = units[0];
      const target = mg.target(ctx);
      const path = lead ? roadRoute(ctx, lead.pos, target) : [];
      propose(sim, {
        kind: 'move-group',
        title: mg.title(ctx),
        summary: `${units.map((u) => u.callsign).join(', ')} to structure defense before the head arrives in ${Math.round(m)} min. Safety zone ${mg.safetyLabel}.`,
        risk: 'high',
        audiences: ['ops'],
        unitIds: units.map((u) => u.id),
        route: path,
        target,
        window: { startMin: 0, endMin: 45 },
        safetyZone: { center: target, radiusM: 150, label: mg.safetyLabel },
        trigger: 'Disengage if fire is within 800 m of the safety zone or ETA under 20 min',
        draft: mg.draft(sim, units, path),
        itemId: 'proj-head',
      });
    }
    const rs = plans.resource;
    if (rs && !has(sim, 'resource-order')) {
      propose(sim, {
        kind: 'resource-order',
        title: rs.title,
        summary: rs.summary(sim),
        risk: 'high',
        audiences: ['ic', 'ops', 'air'],
        unitIds: [],
        target: ctx.sites.primary,
        draft: rs.draft(sim, m),
        itemId: 'proj-head',
      });
    }
  } else if (evac.warningMin > evac.orderMin && m <= evac.warningMin && !hasType('ORDER') && !hasType('WARNING')) {
    propose(sim, {
      kind: 'evac-notice',
      title: evac.title('WARNING', ctx),
      summary: evac.summary('WARNING', m, p.rev, ctx),
      risk: 'high',
      audiences: ['public', 'law', 'ic'],
      unitIds: evac.unitIds,
      target: ctx.sites.primary,
      trigger: `Modelled head ETA under ${evac.warningMin} min`,
      draft: evac.draft(sim, 'WARNING', m),
      itemId: 'proj-head',
    });
  }
}

/** Turns graded intel into proposed work (drafts, tasks). Runs after each grading pass. */
export function runRules(sim: Sim): void {
  const score = new Map(sim.items.map((i) => [i.refId, i.score]));
  const plans = sim.ctx.script.plans;
  for (const f of sim.findings) {
    const fm = sim.fmeta.get(f.id);
    if (!fm || fm.resolved) continue;
    if (f.kind === 'human') {
      if (!fm.confirmed && !has(sim, 'retask-drone', f.id) && (score.get(f.id) ?? 0) >= 25) proposeRetask(sim, f, plans.preferDroneId);
      if (fm.confirmed && !has(sim, 'rescue', f.id)) {
        proposeRescue(sim, f);
        emitDirective(sim, { kind: 'notify', audiences: ['ems', 'ops'], message: `Life safety: ${f.label} confirmed live; rescue tasking drafted`, reason: 'Confirmed people in the projected fire path', itemId: f.id });
      }
    } else if (f.kind === 'spot') {
      if (!fm.confirmed && !has(sim, 'retask-drone', f.id)) proposeRetask(sim, f);
      if (!has(sim, 'reproject', f.id)) {
        propose(sim, {
          kind: 'reproject',
          title: 'Re-run projection with the spot fire',
          summary: 'Spot fire ahead of the head is not in the current projection.',
          risk: 'low',
          audiences: ['ic', 'ops'],
          unitIds: [],
          target: { lon: f.pos.lon, lat: f.pos.lat },
          itemId: f.id,
        });
      }
    } else if (f.kind === 'combustible' && !has(sim, 'radio-script', f.id)) proposeHazard(sim, f);
    else if (f.kind === 'road-block' && plans.roadBlock) plans.roadBlock(sim, f);
  }

  proposeHeadWork(sim);

  if (sim.t >= sim.timers.sitrep) {
    const n = sim.actions.filter((a) => a.kind === 'sitrep').length + 1;
    sim.timers.sitrep = sim.t + 120 * MIN;
    propose(sim, {
      kind: 'sitrep',
      title: `${sim.ctx.script.sitrep?.title ?? 'Situation report'} · ${sim.ctx.fmtTime(sim.t)}`,
      summary: 'Scheduled status summary for the incident commander, built from the live picture.',
      risk: 'low',
      audiences: ['ic'],
      unitIds: [],
      draft: sitrepDraft(sim, n),
    });
  }
}
