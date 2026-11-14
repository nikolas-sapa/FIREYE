import type { Draft, Geo, Unit } from '../contracts';
import type { Sim } from '../world/sim';
import { MIN, compass } from '../world/geo';

/** Shared draft helpers; scenario-specific notices, orders and scripts live in director/scenarios/*. */

export function fmtGeo(g: Geo): string {
  return `${Math.abs(g.lat).toFixed(4)}° ${g.lat >= 0 ? 'N' : 'S'}, ${Math.abs(g.lon).toFixed(4)}° ${g.lon >= 0 ? 'E' : 'W'}`;
}

export function namedRoads(sim: Sim, g: Geo, r: number, n: number): string[] {
  return sim.ctx.roadNamesNear(g, r).filter((x) => !/^\d/.test(x)).slice(0, n);
}

/** Road names along a route, in travel order. */
export function routeRoads(sim: Sim, path: Geo[]): string[] {
  const out: string[] = [];
  const step = Math.max(1, Math.floor(path.length / 12));
  for (let i = 0; i < path.length; i += step) {
    const n = sim.ctx.roadNamesNear(path[i], 40)[0];
    if (n && !/^\d/.test(n) && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 4);
}

export const STAMP = 'SIMULATED · scenario built from public data; units, people and events are simulated.';

const KIND_LABEL: [Unit['kind'], string, string][] = [
  ['engine', 'engine', 'engines'],
  ['crew', 'crew', 'crews'],
  ['dozer', 'dozer', 'dozers'],
  ['drone', 'UAS', 'UAS'],
  ['helo', 'helicopter', 'helicopters'],
  ['tanker', 'air tanker', 'air tankers'],
  ['ems', 'ambulance', 'ambulances'],
  ['law', 'law / coast guard unit', 'law / coast guard units'],
];

export function sitrepDraft(sim: Sim, n: number): Draft {
  const c = sim.ctx;
  const t = sim.t;
  const p = sim.projection;
  const w = c.weatherAt(t);
  const area = c.areaText(t);
  const etaP = p?.etaToPlaces[c.primaryId];
  const pText = etaP === undefined ? 'not threatened within 6 h (model)' : etaP <= t ? 'fire in the community' : `modelled head ETA ${Math.round((etaP - t) / MIN)} min`;
  const people = sim.findings.filter((f) => f.kind === 'human');
  const decided = sim.actions.filter((a) => a.status === 'done' || a.status === 'executing' || a.status === 'approved').map((a) => a.title).slice(0, 5);
  const res = KIND_LABEL.map(([k, one, many]) => {
    const m = sim.units.filter((u) => u.kind === k).length;
    return m ? `${m} ${m === 1 ? one : many}` : '';
  }).filter(Boolean);
  const scored = sim.predictions.find((x) => x.status === 'scored');
  const body = [
    `${(c.script.sitrep?.header ?? 'INCIDENT SITUATION REPORT').toUpperCase()} · REPORT ${n}`,
    `${c.script.incident} · ${c.fmtTime(t)} ${c.fmtDate(t)}`,
    '',
    `Size: ${area} (replay of observed data) · Containment 0% (simulated)`,
    `Behavior: head ${compass(p?.headDirDeg ?? 0)} at ${Math.round(p?.rosMpm ?? 0)} m/min (model); ${p?.drivers[2] ?? ''}; spotting ${sim.findings.some((f) => f.kind === 'spot') ? 'observed' : 'not observed'}.`,
    `Threats: ${c.primaryName} (${c.structuresPrimary} structures), ${pText}.`,
    `Life safety: ${people.length ? people.map((f) => f.label.toLowerCase()).join('; ') : 'no people reported in the fire area'}.`,
    `Resources (simulated): ${res.join(', ')}.`,
    `Weather: wind ${Math.round(w.windDirDeg)}° ${Math.round(w.windKph)} kph gusts ${Math.round(w.gustKph)}, RH ${Math.round(w.rh)}%, ${Math.round(w.tempC)}°C.`,
    scored ? `Model check: +${scored.horizonMin} min projection scored IoU ${scored.iou?.toFixed(2)} against the observed fire.` : 'Model check: no projection scored yet.',
    `Actions this period: ${decided.length ? decided.join('; ') : 'none'}.`,
    `Planned: protect ${c.primaryName} and the routes out; continued UAS overwatch on the head.`,
    '',
    'Prepared by the Orchestrator (treq · reasoning-large) for IC review.',
    STAMP,
  ].join('\n');
  return {
    format: 'ics209',
    title: `${c.script.sitrep?.title ?? 'Situation report'} · report ${n}`,
    body,
    fields: [
      { label: 'Area', value: area },
      { label: 'Containment', value: '0% (sim.)' },
      { label: 'ROS', value: `${Math.round(p?.rosMpm ?? 0)} m/min` },
      { label: 'Head', value: compass(p?.headDirDeg ?? 0) },
      { label: c.primaryName, value: pText },
      { label: 'Structures', value: String(c.structuresPrimary) },
    ],
  };
}
