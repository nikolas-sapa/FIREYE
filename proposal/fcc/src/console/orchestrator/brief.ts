import type { Action, Brief, Ms } from '../contracts';
import type { Sim } from '../world/sim';
import { MIN, compass } from '../world/geo';
import { reconSummary } from '../world/recon';
import { isResidentMode, RESIDENT_SUGGESTIONS } from './conversation';

/** Facts captured with each published brief; the next brief lists what differs ("changed"). */
export interface BriefFacts {
  at: Ms;
  acres: number;
  rev: number;
  gfEtaMin: number | null;
  windDir: number;
  findings: Record<string, string>;
  actions: Record<string, Action['status']>;
  interrupt: string | null;
}

function gfEta(sim: Sim): number | null {
  const e = sim.projection?.etaToPlaces[sim.ctx.primaryId];
  if (e === undefined) return null;
  return Math.max(0, (e - sim.t) / MIN);
}

function collect(sim: Sim): BriefFacts {
  const findings: Record<string, string> = {};
  for (const f of sim.findings) {
    const fm = sim.fmeta.get(f.id);
    if (fm?.random) continue;
    findings[f.id] = `${fm?.confirmed ? 'confirmed' : 'reported'}|${fm?.resolved ? 'resolved' : 'open'}|${f.label}`;
  }
  const actions: Record<string, Action['status']> = {};
  for (const a of sim.actions) actions[a.id] = a.status;
  return {
    at: sim.t,
    acres: Math.round(sim.ctx.areaAt(sim.t)),
    rev: sim.projection?.rev ?? 0,
    gfEtaMin: gfEta(sim),
    windDir: Math.round(sim.ctx.weatherAt(sim.t).windDirDeg),
    findings,
    actions,
    interrupt: sim.items.find((i) => i.zone === 'Z0_INTERRUPT')?.title ?? null,
  };
}

const lc = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const title = (s: string) => s.split('·')[0].trim().toLowerCase();

function diff(sim: Sim, a: BriefFacts, b: BriefFacts): string[] {
  const out: string[] = [];
  if (b.interrupt && b.interrupt !== a.interrupt) out.push(`Interrupt: ${lc(b.interrupt)}`);
  for (const [id, v] of Object.entries(b.findings)) {
    const [state, res, label] = v.split('|');
    const prev = a.findings[id];
    if (!prev) out.push(`New: ${label.toLowerCase()}`);
    else {
      const [ps, pr] = prev.split('|');
      if (state === 'confirmed' && ps !== 'confirmed') out.push(`Confirmed live: ${title(label)}`);
      else if (res === 'resolved' && pr !== 'resolved') out.push(`Resolved: ${label.toLowerCase()}`);
    }
  }
  if (b.rev !== a.rev) {
    const eta = b.gfEtaMin !== null && b.gfEtaMin > 0 ? `; ${sim.ctx.primaryName} ETA ${Math.round(b.gfEtaMin)} min` : '';
    const was = a.gfEtaMin !== null && a.gfEtaMin > 0 && b.gfEtaMin !== null && Math.abs(a.gfEtaMin - b.gfEtaMin) >= 10 ? ` (was ${Math.round(a.gfEtaMin)})` : '';
    out.push(`Projection rev ${b.rev}${eta}${was}`);
  }
  if (Math.abs(((b.windDir - a.windDir + 540) % 360) - 180) >= 30) out.push(`Wind now ${b.windDir}° (was ${a.windDir}°)`);
  for (const [id, st] of Object.entries(b.actions)) {
    const prev = a.actions[id];
    if (prev === st) continue;
    const act = sim.actions.find((x) => x.id === id);
    if (!act) continue;
    if (!prev && st === 'proposed') out.push(`Proposed: ${lc(act.title)}`);
    else if (st === 'approved' || st === 'executing' || st === 'done') {
      if (prev === 'proposed' || !prev) out.push(`${act.decidedBy === 'orchestrator' ? 'Auto-executed' : 'Approved'}: ${lc(act.title)}`);
    } else if (st === 'rejected') out.push(`Rejected: ${lc(act.title)}`);
    else if (st === 'undone') out.push(`Undone: ${lc(act.title)}`);
  }
  const grown = b.acres - a.acres;
  const unit = sim.ctx.script.areaUnit;
  if (grown >= (unit === 'ha' ? 40 : 100)) out.push(`Fire grew ${grown.toLocaleString('en-US')} ${unit}`);
  return out.slice(0, 5);
}

function compose(sim: Sim): { headline: string; bullets: string[] } {
  if (sim.recon) return { headline: 'Coordinating drone reconnaissance', bullets: [reconSummary(sim)] };
  const c = sim.ctx;
  const t = sim.t;
  const p = sim.projection;
  const w = c.weatherAt(t);
  const area = c.areaText(t);
  const z0 = sim.items.find((i) => i.zone === 'Z0_INTERRUPT');
  const eta = gfEta(sim);
  let headline: string;
  if (z0) headline = `${z0.title.charAt(0)}${z0.title.slice(1).toLowerCase()} · needs acknowledgement`;
  else if (eta !== null && eta <= 0) headline = `Fire is in ${c.primaryName}; structure defense and evacuation in progress`;
  else if (eta !== null && eta <= 180) headline = `Head reaches ${c.primaryName} in about ${Math.round(eta)} min`;
  else headline = `${c.script.incident} at ${area}, head running ${compass(p?.headDirDeg ?? w.windDirDeg)}`;

  const people = sim.findings.filter((f) => f.kind === 'human' || f.kind === 'animal');
  const life = people.length
    ? people
        .map((f) => {
          const fm = sim.fmeta.get(f.id);
          const st = fm?.resolved ? 'safe' : fm?.confirmed ? 'confirmed live' : 'reported, unconfirmed';
          return `${f.label.split('·')[0].trim().toLowerCase()} (${st})`;
        })
        .join('; ')
    : 'no people reported in the fire path';
  const lifeB = `Life safety: ${life}.`;
  const fireB = `Fire: ${area}, head ${compass(p?.headDirDeg ?? 0)} at ${Math.round(p?.rosMpm ?? 0)} m/min; wind ${Math.round(w.windDirDeg)}° ${Math.round(w.windKph)} kph, RH ${Math.round(w.rh)}%${p ? ` (projection rev ${p.rev})` : ''}.`;
  const pending = sim.actions.filter((a) => a.status === 'proposed' && a.requiresApproval);
  const running = sim.actions.filter((a) => a.status === 'executing');
  const work = pending.length
    ? `${pending.length} decision${pending.length > 1 ? 's' : ''} waiting: ${pending
        .slice(0, 2)
        .map((a) => lc(a.title))
        .join('; ')}.`
    : running.length
      ? `In progress: ${running
          .slice(0, 2)
          .map((a) => lc(a.title))
          .join('; ')}.`
      : `No decisions waiting; ${sim.units.filter((u) => u.kind === 'drone').length} drones sweeping the front.`;
  return { headline, bullets: [lifeB, fireB, `Work: ${work}`] };
}

/** Rebuilds the brief when the picture changes (throttled to 2 s real) or every 5 scenario minutes. */
export function updateBrief(sim: Sim, force = false): void {
  const due = sim.t >= sim.timers.brief;
  if (!force && !due && !(sim.briefDirty && sim.realS >= sim.timers.briefReal)) return;
  sim.briefDirty = false;
  sim.timers.brief = sim.t + 5 * MIN;
  sim.timers.briefReal = sim.realS + 2;
  const { headline, bullets } = compose(sim);
  const facts = collect(sim);
  const changed = sim.briefFacts ? diff(sim, sim.briefFacts, facts) : [];
  const prev = sim.brief;
  const same = prev.headline === headline && prev.bullets.join('\n') === bullets.join('\n');
  if (same && !changed.length && !force) return;
  const brief: Brief = { headline, bullets, changed: changed.length ? changed : prev.changed, at: sim.t };
  if (changed.length || !sim.briefFacts) sim.briefFacts = facts;
  sim.brief = brief;
  sim.bus.publish({ type: 'brief.updated', at: sim.t, brief });
}

/** Contextual questions for the prompt chips. */
export function updateSuggestions(sim: Sim): void {
  if (isResidentMode()) {
    if (sim.suggestions.join('|') !== RESIDENT_SUGGESTIONS.join('|')) sim.suggestions = [...RESIDENT_SUGGESTIONS];
    return;
  }
  if (sim.recon) {
    const next = ['Which blind spots are being checked?', 'What changed in the fire projection?', 'What are the drones doing?'];
    if (sim.suggestions.join('|') !== next.join('|')) sim.suggestions = next;
    return;
  }
  const out: string[] = [];
  const z0 = sim.items.find((i) => i.zone === 'Z0_INTERRUPT');
  const top = z0 ?? sim.items.find((i) => i.zone === 'Z3_FOCUS');
  out.push('What changed in the last 10 minutes?');
  if (sim.findings.some((f) => (f.kind === 'human' || f.kind === 'animal') && !sim.fmeta.get(f.id)?.resolved)) out.push('Who is at risk right now?');
  if (top) out.push(`Why is "${top.title.split('·')[0].trim().toLowerCase()}" on screen?`);
  const eta = gfEta(sim);
  if (eta !== null && eta > 0) out.push(`When does the head reach ${sim.ctx.primaryName}?`);
  const tasked = sim.units.find((u) => u.kind === 'drone' && u.taskId);
  if (tasked) out.push(`Status of ${tasked.callsign}?`);
  if (sim.actions.some((a) => a.kind === 'move-group' || a.kind === 'evac-notice')) out.push('Where should crews go next?');
  out.push('What is the biggest risk?');
  out.push('What have the agents done?');
  const next = [...new Set(out)].slice(0, 4);
  if (next.join('|') !== sim.suggestions.join('|')) sim.suggestions = next;
}
