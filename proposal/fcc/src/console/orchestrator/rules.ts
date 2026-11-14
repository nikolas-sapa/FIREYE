import type { Finding, Unit } from '../contracts';
import type { Sim } from '../world/sim';
import { MIN, distanceM } from '../world/geo';
import { roadRoute, unitById } from '../world/units';
import { propose } from './actions';
import { emitDirective } from './directives';
import { evacDraft, moveDraft, radioDraft, rescueDraft, resourceDraft, sitrepDraft } from './drafts';
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
  const ems = unitById(sim, 'm-12') && !unitById(sim, 'm-12')?.taskId ? unitById(sim, 'm-12')! : sim.units.filter((u) => u.kind === 'ems' && !u.taskId).sort((a, b) => distanceM(a.pos, f.pos) - distanceM(b.pos, f.pos))[0];
  if (!ems) return;
  const overwatch = sim.actions.find((a) => a.kind === 'retask-drone' && a.itemId === f.id);
  const drone = overwatch ? unitById(sim, overwatch.unitIds[0]) : undefined;
  const path = roadRoute(sim.ctx, ems.pos, f.pos);
  const eta = etaMin(sim, f.pos, f.uncertaintyM);
  const place = sim.ctx.nearestPlace(f.pos).name;
  propose(sim, {
    kind: 'rescue',
    title: `Rescue · ${f.count ?? 2} hikers near ${place}`,
    summary: `${ems.callsign} to the trailhead with ${drone?.callsign ?? 'drone'} overwatch. Fire ETA about ${Math.round(eta)} min at their position.`,
    risk: 'high',
    audiences: ['ems', 'ops', 'ic'],
    unitIds: drone ? [ems.id, drone.id] : [ems.id],
    target: { lon: f.pos.lon, lat: f.pos.lat },
    route: path,
    window: { startMin: 0, endMin: Math.max(10, Math.round(eta - 25)) },
    trigger: 'Turn around if fire is within 800 m or ETA under 25 min',
    safetyZone: { center: sim.ctx.sites.staging, radiusM: 150, label: `${sim.ctx.gfName} staging` },
    draft: rescueDraft(sim, f, ems, drone, path, eta),
    itemId: f.id,
  });
}

function proposeRadio(sim: Sim, f: Finding): void {
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
    title: 'Radio script · Div A propane hazard',
    summary: `Hazard advisory for the ${near.length} units within 1.5 km (${list}). Fire ETA about ${Math.round(eta)} min.`,
    risk: 'low',
    audiences: ['ops'],
    unitIds: near.map((u) => u.id),
    target: { lon: f.pos.lon, lat: f.pos.lat },
    draft: radioDraft(sim, f, near, eta),
    itemId: f.id,
  });
}

/** Turns graded intel into proposed work (drafts, tasks). Runs after each grading pass. */
export function runRules(sim: Sim): void {
  const score = new Map(sim.items.map((i) => [i.refId, i.score]));
  for (const f of sim.findings) {
    const fm = sim.fmeta.get(f.id);
    if (!fm || fm.resolved) continue;
    if (f.kind === 'human') {
      if (!fm.confirmed && !has(sim, 'retask-drone', f.id) && (score.get(f.id) ?? 0) >= 25) proposeRetask(sim, f, 'hawk-3');
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
    } else if (f.kind === 'combustible' && !has(sim, 'radio-script', f.id)) proposeRadio(sim, f);
  }

  const p = sim.projection;
  const gf = sim.ctx.gfId;
  const eta = p?.etaToPlaces[gf];
  if (p && eta !== undefined && eta > sim.t) {
    const m = (eta - sim.t) / MIN;
    const hasType = (type: string) => sim.actions.some((a) => a.kind === 'evac-notice' && a.title.includes(type) && a.status !== 'undone' && a.status !== 'rejected');
    if (m <= 120 && !hasType('ORDER')) {
      propose(sim, {
        kind: 'evac-notice',
        title: `Evacuation ORDER · Zone EDC-GF-1 (${sim.ctx.gfName})`,
        summary: `Head projected to reach ${sim.ctx.gfName} in ${Math.round(m)} min (rev ${p.rev}). ${sim.ctx.structuresGF} structures; one road out.`,
        risk: 'high',
        audiences: ['public', 'law', 'ic'],
        unitIds: ['so-5'],
        target: sim.ctx.sites.gf,
        window: { startMin: 0, endMin: Math.round(m) },
        trigger: 'Projected head ETA under 120 min',
        draft: evacDraft(sim, 'ORDER', m),
        itemId: 'proj-head',
      });
      if (!has(sim, 'move-group')) {
        const ids = ['e-42', 'crew-7', 'dz-2'];
        const units = ids.map((id) => unitById(sim, id)).filter((u): u is Unit => !!u);
        const lead = units[0];
        const path = lead ? roadRoute(sim.ctx, lead.pos, sim.ctx.sites.school) : [];
        propose(sim, {
          kind: 'move-group',
          title: `Move structure group → ${sim.ctx.gfName}`,
          summary: `${units.map((u) => u.callsign).join(', ')} to structure defense before the head arrives in ${Math.round(m)} min. Safety zone SZ-1.`,
          risk: 'high',
          audiences: ['ops'],
          unitIds: units.map((u) => u.id),
          route: path,
          target: sim.ctx.sites.school,
          window: { startMin: 0, endMin: 45 },
          safetyZone: { center: sim.ctx.sites.school, radiusM: 150, label: 'SZ-1 · school ball field' },
          trigger: 'Disengage if fire is within 800 m of SZ-1 or ETA under 20 min',
          draft: moveDraft(sim, units, path),
          itemId: 'proj-head',
        });
      }
      if (!has(sim, 'resource-order')) {
        propose(sim, {
          kind: 'resource-order',
          title: 'Resource order · 2 Type 1 engines + 1 VLAT',
          summary: `Structure group alone cannot cover ${sim.ctx.structuresGF} structures; a VLAT line ahead of the head buys time.`,
          risk: 'high',
          audiences: ['ic', 'ops', 'air'],
          unitIds: [],
          target: sim.ctx.sites.gf,
          draft: resourceDraft(sim, m),
          itemId: 'proj-head',
        });
      }
    } else if (m <= 150 && !hasType('ORDER') && !hasType('WARNING')) {
      propose(sim, {
        kind: 'evac-notice',
        title: `Evacuation WARNING · Zone EDC-GF-1 (${sim.ctx.gfName})`,
        summary: `Head projected to reach ${sim.ctx.gfName} in ${Math.round(m)} min (rev ${p.rev}).`,
        risk: 'high',
        audiences: ['public', 'law', 'ic'],
        unitIds: ['so-5'],
        target: sim.ctx.sites.gf,
        trigger: 'Projected head ETA under 150 min',
        draft: evacDraft(sim, 'WARNING', m),
        itemId: 'proj-head',
      });
    }
  }

  if (sim.t >= sim.timers.sitrep) {
    const n = sim.actions.filter((a) => a.kind === 'sitrep').length + 1;
    sim.timers.sitrep = sim.t + 120 * MIN;
    propose(sim, {
      kind: 'sitrep',
      title: `ICS-209 sitrep · ${sim.ctx.fmtTime(sim.t)}`,
      summary: 'Scheduled status summary for the IC, built from the live picture.',
      risk: 'low',
      audiences: ['ic'],
      unitIds: [],
      draft: sitrepDraft(sim, n),
    });
  }
}
