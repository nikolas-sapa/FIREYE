import type { BusEvent } from '../contracts';
import type { Note, Sim } from '../world/sim';
import { MIN, compass } from '../world/geo';

const CAP = 300;

export function addNote(sim: Sim, kind: Note['kind'], text: string, ref?: string): void {
  sim.notes.push({ at: sim.t, kind, text, ref });
  if (sim.notes.length > CAP) sim.notes.splice(0, sim.notes.length - CAP);
}

const has = (sim: Sim, kind: Note['kind'], ref: string) => sim.notes.some((n) => n.kind === kind && n.ref === ref);
const lastEta = new WeakMap<Sim, number>();

/** Turns bus events into the plain-language change log used by the brief and conversation. */
export function recordEvent(sim: Sim, e: BusEvent): void {
  switch (e.type) {
    case 'analysis.finding': {
      const f = e.finding;
      const fm = sim.fmeta.get(f.id);
      if (fm?.random) break;
      if (!has(sim, 'finding', f.id)) {
        const src = fm?.sourceKinds[0]?.replace('-', ' ') ?? 'agent';
        addNote(sim, 'finding', `New ${src} finding: ${f.label.toLowerCase()}`, f.id);
      } else if (fm?.confirmed && !has(sim, 'confirm', f.id)) {
        addNote(sim, 'confirm', `Confirmed live: ${f.label.toLowerCase()}`, f.id);
      } else if (fm?.resolved && !has(sim, 'confirm', `${f.id}:resolved`)) {
        addNote(sim, 'confirm', `Resolved: ${f.label.toLowerCase()}`, `${f.id}:resolved`);
      }
      break;
    }
    case 'projection.updated': {
      const p = e.projection;
      const eta = p.etaToPlaces[sim.ctx.primaryId];
      const m = eta !== undefined ? Math.round((eta - e.at) / MIN) : null;
      const prev = lastEta.get(sim);
      let etaText = '';
      if (m !== null && m > 0) {
        etaText = `; ${sim.ctx.primaryName} ETA ${m} min`;
        if (prev !== undefined && Math.abs(prev - m) >= 10) etaText += ` (was ${prev})`;
        lastEta.set(sim, m);
      }
      const why = p.drivers.find((d) => d.startsWith('Wind shift')) ? ' after the wind shift' : '';
      addNote(sim, 'projection', `Projection rev ${p.rev}${why}: head ${compass(p.headDirDeg)} at ${Math.round(p.rosMpm)} m/min${etaText}`, `proj-${p.rev}`);
      break;
    }
    case 'action.proposed':
      if (e.action.requiresApproval) addNote(sim, 'proposed', `Proposed for approval: ${e.action.title}`, e.action.id);
      break;
    case 'action.decided': {
      const a = sim.actions.find((x) => x.id === e.actionId);
      if (!a) break;
      const key = `${e.actionId}:${e.status}`;
      if (has(sim, 'decided', key)) break;
      if (e.status === 'approved') addNote(sim, 'decided', `Approved by ${e.by === 'user' ? 'the IC' : 'the Orchestrator'}: ${a.title}`, key);
      else if ((e.status === 'executing' || e.status === 'done') && !has(sim, 'decided', `${e.actionId}:approved`) && !has(sim, 'decided', `${e.actionId}:executing`))
        addNote(sim, 'decided', `Orchestrator executed (low risk): ${a.title}`, key);
      else if (e.status === 'rejected') addNote(sim, 'decided', `Rejected: ${a.title}`, key);
      else if (e.status === 'undone') addNote(sim, 'decided', `Undone: ${a.title}`, key);
      break;
    }
    case 'ui.directive': {
      const d = e.directive;
      if (d.kind === 'notify') addNote(sim, 'notify', `Notified ${d.audiences.map((x) => x.toUpperCase()).join(', ')}: ${d.message}`, d.id);
      break;
    }
    case 'orchestrator.graded': {
      const it = e.item;
      if (it.zone === 'Z0_INTERRUPT' && it.prevZone !== 'Z0_INTERRUPT' && it.prevZone !== undefined) addNote(sim, 'interrupt', `Interrupt raised: ${it.title.toLowerCase()}`, it.id);
      else if (it.zone === 'Z0_INTERRUPT' && it.prevZone === undefined && !has(sim, 'interrupt', it.id)) addNote(sim, 'interrupt', `Interrupt raised: ${it.title.toLowerCase()}`, it.id);
      break;
    }
    default:
      break;
  }
}
