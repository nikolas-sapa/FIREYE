import type { GradedItem } from '../contracts';
import type { Sim } from '../world/sim';
import { MIN, compass, distanceM, fmtDur } from '../world/geo';
import { enqueue } from '../agents/swarm';
import { addNote } from './notes';
import { pushMessage, replaceMessage } from './messages';
import { etaMin, etaText } from './score';
import { reconSummary } from '../world/recon';

const THINK_S = 1.2;

/** User question: a "thinking" bubble now, a state-aware answer ~1.2 s (wall clock) later. */
export function ask(sim: Sim, text: string): void {
  const q = text.trim();
  if (!q) return;
  pushMessage(sim, { role: 'user', text: q });
  addNote(sim, 'user', `IC asked: "${q}"`);
  const m = pushMessage(sim, { role: 'orchestrator', text: 'Checking the live picture', thinking: true });
  sim.replies.push({ id: m.id, due: sim.realS + THINK_S, question: q });
  enqueue(sim, 'pool-orchestrator', {
    input: `Answer IC question · "${q.length > 48 ? `${q.slice(0, 45)}...` : q}"`,
    minutes: 3,
    durS: THINK_S,
    text: (a) => `${a} answered an IC question from the live picture`,
  });
}

export function tickConversation(sim: Sim): void {
  if (!sim.replies.length) return;
  const due = sim.replies.filter((r) => sim.realS >= r.due);
  if (!due.length) return;
  sim.replies = sim.replies.filter((r) => sim.realS < r.due);
  for (const r of due) {
    const { text, refs } = answer(sim, r.question);
    replaceMessage(sim, r.id, { text, refs, thinking: false });
  }
}

interface Reply {
  text: string;
  refs?: string[];
}

const lc = (s: string) => s.toLowerCase();
const short = (s: string) => s.split('·')[0].trim().toLowerCase();

const CALLSIGN = /\b(hawk|e|crew|dz|m|so|h|t)[- ]?(\d{1,3})\b/i;

export function answer(sim: Sim, raw: string): Reply {
  const q = raw.toLowerCase();
  if (sim.recon) {
    if (/dispatch|evac|approve|reject|crew|engine|helicopter|tanker/.test(q)) return { text: 'I only coordinate simulated drone reconnaissance. I do not dispatch ground units, aircraft or public advisories.' };
    if (/project|spread|advanc|faster/.test(q)) return projection(sim);
    if (/chang|alert|new fire/.test(q)) {
      const alerts = sim.recon.events.filter(e => e.severity === 'alert' || e.severity === 'critical').slice(-3);
      return { text: alerts.map(e => e.title).join('\n') || 'No important fire changes detected at this time.' };
    }
    return { text: reconSummary(sim) };
  }
  const cs = raw.match(CALLSIGN);
  if (/\bwhy\b/.test(q)) return why(sim, q);
  if (cs) {
    const id = `${cs[1].toLowerCase()}-${cs[2]}`;
    const u = sim.units.find((x) => x.id === id);
    if (u) return unitStatus(sim, u.id);
  }
  const mins = Number(q.match(/(\d+)\s*(min|minute)/)?.[1] ?? (/\bhour\b/.test(q) ? 60 : 10));
  if (/chang|happen|new|update|last \d+|since/.test(q)) return whatChanged(sim, mins);
  if (/who|people|hiker|evac|at risk|life|resident|animal|horse/.test(q)) return whoAtRisk(sim);
  if (/crew|where should|engine|resource|deploy|send|dozer|units?\b/.test(q)) return crews(sim);
  if (/wind|weather|humid|\brh\b|temp|gust/.test(q)) return weather(sim);
  if (/project|eta|when|reach|spread|head|forecast/.test(q)) return projection(sim);
  if (/agent|ledger|work|saved|swarm|analy|done/.test(q)) return agents(sim);
  if (/biggest|worst|top|priorit|important|risk|threat|concern/.test(q)) return biggestRisk(sim);
  const b = sim.brief;
  return { text: `${b.headline}. ${b.bullets.join(' ')} Ask me about risks, crews, a callsign, the projection or what changed.` };
}

function whatChanged(sim: Sim, mins: number): Reply {
  const since = sim.t - mins * MIN;
  const notes = sim.notes.filter((n) => n.at >= since && n.kind !== 'user');
  const order = ['interrupt', 'confirm', 'finding', 'projection', 'decided', 'proposed', 'notify', 'settings'];
  const picked = notes
    .slice()
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.at - a.at)
    .filter((n, i, arr) => arr.findIndex((x) => x.text === n.text) === i)
    .slice(0, 6)
    .sort((a, b) => a.at - b.at);
  const saved = sim.ledger.entries.filter((e) => e.at >= since).reduce((s, e) => s + e.minutesSaved, 0);
  if (!picked.length) return { text: `Nothing material in the last ${mins} minutes. ${sim.brief.headline}.` };
  const lines = picked.map((n) => `${sim.ctx.fmtTime(n.at).slice(0, 5)} ${n.text}`);
  const refs = picked.map((n) => n.ref).filter((r): r is string => !!r && !r.includes(':'));
  return {
    text: `In the last ${mins} minutes (scenario time):\n${lines.map((l) => `• ${l}`).join('\n')}\nThe agents saved about ${Math.round(saved)} analyst minutes in that window.`,
    refs,
  };
}

function topItem(sim: Sim): GradedItem | undefined {
  return sim.items.find((i) => i.zone === 'Z0_INTERRUPT') ?? sim.items.filter((i) => i.kind !== 'action' && !i.dismissed)[0];
}

function biggestRisk(sim: Sim): Reply {
  const it = topItem(sim);
  if (!it) return { text: 'No graded risks yet; the agents are still building the picture.' };
  const next = sim.items.filter((i) => i.id !== it.id && i.kind !== 'action' && i.zone !== 'Z5_LEDGER').slice(0, 2);
  const tail = next.length ? ` Next: ${next.map((n) => `${short(n.title)} (${n.score})`).join(', ')}.` : '';
  return { text: `${it.title} is the top item at score ${it.score}. ${it.reason}.${tail}`, refs: [it.id, ...next.map((n) => n.id)] };
}

function whoAtRisk(sim: Sim): Reply {
  const lines: string[] = [];
  const refs: string[] = [];
  for (const f of sim.findings) {
    if (f.kind !== 'human' && f.kind !== 'animal') continue;
    const fm = sim.fmeta.get(f.id);
    const st = fm?.resolved ? 'safe' : fm?.confirmed ? 'confirmed on live video' : `reported, ±${Math.round(f.uncertaintyM)} m, unconfirmed`;
    lines.push(`${f.label} (${st}), fire ${etaText(etaMin(sim, f.pos, f.uncertaintyM))}`);
    refs.push(f.id);
  }
  const p = sim.projection;
  const eta = p?.etaToPlaces[sim.ctx.primaryId];
  if (eta !== undefined) {
    const m = Math.round((eta - sim.t) / MIN);
    const evac = sim.actions.find((a) => a.kind === 'evac-notice' && a.status !== 'rejected' && a.status !== 'undone');
    const evacText = evac ? `${evac.title.split('·')[0].trim()} ${evac.status === 'proposed' ? 'drafted, waiting for approval' : 'issued'}` : 'no evacuation notice yet';
    lines.push(`${sim.ctx.primaryName}: ${sim.ctx.structuresPrimary} structures, ${m > 0 ? `head ETA ${m} min` : 'fire in the community'}; ${evacText}`);
  }
  if (!lines.length) return { text: 'No people or animals are reported in the projected fire path right now.' };
  return { text: `At risk now:\n${lines.map((l) => `• ${l}`).join('\n')}\nAll people in this scenario are fictional.`, refs };
}

function crews(sim: Sim): Reply {
  const lines: string[] = [];
  const mg = sim.actions.find((a) => a.kind === 'move-group' && a.status !== 'rejected' && a.status !== 'undone');
  if (mg) lines.push(`${mg.title} (${mg.status}). ${mg.safetyZone ? `Safety zone ${mg.safetyZone.label}. ` : ''}${mg.trigger ?? ''}`);
  const prop = sim.findings.find((f) => f.kind === 'combustible');
  if (prop) {
    const near = sim.units.filter((u) => !['drone', 'helo', 'tanker'].includes(u.kind) && distanceM(u.pos, prop.pos) <= 1500).map((u) => u.callsign);
    lines.push(`Keep ${near.length ? near.join(', ') : 'nearby units'} clear of ${short(prop.label)}; it is ${etaText(etaMin(sim, prop.pos, prop.uncertaintyM))}.`);
  }
  const head = sim.projHead;
  if (head) {
    const free = sim.units.filter((u) => (u.kind === 'engine' || u.kind === 'crew' || u.kind === 'dozer') && !u.taskId);
    if (free.length) lines.push(`${free.map((u) => u.callsign).join(', ')} are uncommitted; best use is holding the ${compass((sim.projection?.headDirDeg ?? 0) + 90)} flank and the route out of ${sim.ctx.primaryName}.`);
  }
  const rescue = sim.actions.find((a) => a.kind === 'rescue');
  if (rescue) lines.push(`${rescue.title}: ${rescue.status}.`);
  if (!lines.length) return { text: 'No moves recommended yet; crews are holding their divisions while the projection firms up.' };
  return { text: lines.join('\n'), refs: [mg?.id, rescue?.id].filter((x): x is string => !!x) };
}

function unitStatus(sim: Sim, id: string): Reply {
  const u = sim.units.find((x) => x.id === id)!;
  const m = sim.umeta.get(id);
  const task = u.taskId ? sim.actions.find((a) => a.id === u.taskId) : undefined;
  const near = sim.ctx.nearestPlace(u.pos);
  const dist = (distanceM(u.pos, near.pos) / 1000).toFixed(1);
  const what = task
    ? `on task "${task.title}" (${task.status})`
    : m?.plan.mode === 'sweep'
      ? `sweeping coverage cell ${m.plan.cellId.replace('cov-', '')}`
      : m?.plan.mode === 'path'
        ? 'moving on its patrol route'
        : m?.plan.mode === 'orbit'
          ? 'orbiting a target'
          : u.status;
  const extra = [u.battery !== undefined ? `battery ${Math.round(u.battery * 100)}%` : '', u.water !== undefined ? `water ${Math.round(u.water * 100)}%` : ''].filter(Boolean).join(', ');
  const feed = sim.feeds.find((f) => f.unitId === id);
  const sees = feed?.findingIds.map((fid) => sim.findings.find((f) => f.id === fid)?.label).filter(Boolean) ?? [];
  return {
    text: `${u.callsign} is ${what}, ${dist} km from ${near.name}${extra ? `, ${extra}` : ''}.${sees.length ? ` In view: ${sees.map((s) => lc(s!)).join('; ')}.` : ''}`,
    refs: task ? [task.id] : undefined,
  };
}

function why(sim: Sim, q: string): Reply {
  const words = q.replace(/[^a-z0-9 -]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !['why', 'this', 'that', 'screen', 'there', 'seeing', 'showing'].includes(w));
  let best: GradedItem | undefined;
  let bs = 0;
  for (const it of sim.items) {
    const t = it.title.toLowerCase();
    const s = words.reduce((n, w) => (t.includes(w) ? n + 1 : n), 0);
    if (s > bs) {
      bs = s;
      best = it;
    }
  }
  const it = best ?? topItem(sim);
  if (!it) return { text: 'Nothing is being promoted right now.' };
  const f = it.factors;
  const terms = [
    `severity ${f.severity}`,
    `exposure ${f.exposure}`,
    `confidence ${f.confidence}`,
    `freshness ${f.freshness}`,
    f.corroboration ? `+${f.corroboration} corroboration` : '',
    f.actionability ? `+${f.actionability} actionability` : '',
    f.novelty >= 1 ? `+${f.novelty} novelty` : '',
    f.fatigue >= 1 ? `-${f.fatigue} fatigue` : '',
    f.lens !== 1 ? `lens ×${f.lens}` : '',
  ].filter(Boolean);
  return { text: `${it.title} scores ${it.score}: ${terms.join(', ')}. ${it.reason}.`, refs: [it.id] };
}

function weather(sim: Sim): Reply {
  const c = sim.ctx;
  const w = c.weatherAt(sim.t);
  const ahead = c.weatherAt(sim.t + 120 * MIN);
  const shift = c.tShift !== null && !sim.shiftApplied && c.shiftTo.t > sim.t ? ` The archive shows the wind turning to ${Math.round(c.shiftTo.windDirDeg)}° by ${c.fmtTime(c.shiftTo.t)}; the projection will be re-run when that is ingested.` : '';
  return {
    text: `Now: wind ${Math.round(w.windDirDeg)}° ${compass(w.windDirDeg)} ${Math.round(w.windKph)} kph, gusts ${Math.round(w.gustKph)}, RH ${Math.round(w.rh)}%, ${Math.round(w.tempC)}°C. In 2 h: ${Math.round(ahead.windDirDeg)}° ${Math.round(ahead.windKph)} kph, RH ${Math.round(ahead.rh)}%.${shift} Source: ${c.script.weatherSource}.`,
  };
}

function projection(sim: Sim): Reply {
  const p = sim.projection;
  if (!p) return { text: 'The first projection is still running.' };
  const etas = Object.entries(p.etaToPlaces)
    .filter(([, t]) => t > sim.t)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([id, t]) => `${sim.ctx.places.find((x) => x.id === id)?.name ?? id} ${Math.round((t - sim.t) / MIN)} min`);
  const age = Math.round((sim.t - p.issuedAt) / MIN);
  return {
    text: `Projection rev ${p.rev} (${age} min old): head ${compass(p.headDirDeg)} at ${Math.round(p.rosMpm)} m/min. ETAs: ${etas.join(', ') || 'no places threatened inside 6 h'}. Drivers: ${p.drivers.slice(0, 3).join('; ')}.`,
    refs: ['proj-head'],
  };
}

function agents(sim: Sim): Reply {
  const L = sim.ledger;
  const running = sim.pools.reduce((n, p) => n + p.running.length, 0);
  const workers = sim.pools.reduce((n, p) => n + p.workers, 0);
  return {
    text: `So far the swarm reviewed ${fmtDur(L.footageReviewedS)} of video, analyzed ${L.imagesAnalyzed} images, read ${L.articlesRead} articles, screened ${L.postsScreened} posts, processed ${L.satellitePasses} satellite passes, transcribed ${Math.round(L.radioMinutesTranscribed)} radio minutes, ran ${L.projectionsRun} projections and wrote ${L.draftsWritten} drafts. That is about ${Math.round(L.analystMinutesSaved)} analyst minutes (${(L.analystMinutesSaved / 60).toFixed(1)} h). ${running} jobs running on ${workers} boxd workers right now.`,
  };
}
