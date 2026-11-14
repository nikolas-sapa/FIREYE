import type { Draft, Finding, Geo, Unit } from '../contracts';
import type { Sim } from '../world/sim';
import { MIN, compass, distanceM } from '../world/geo';

export function fmtGeo(g: Geo): string {
  return `${Math.abs(g.lat).toFixed(4)}° ${g.lat >= 0 ? 'N' : 'S'}, ${Math.abs(g.lon).toFixed(4)}° ${g.lon >= 0 ? 'E' : 'W'}`;
}

function namedRoads(sim: Sim, g: Geo, r: number, n: number): string[] {
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

function evacRoute(sim: Sim): { out: string; avoid: string } {
  const roads = sim.ctx.pack.roads;
  const gfRoad = roads.find((r) => /grizzly flat/i.test(r.name))?.name ?? 'the main road';
  const aukum = roads.find((r) => /mount aukum|mt\.? aukum/i.test(r.name))?.name;
  const ns = roads.find((r) => /north[- ]south/i.test(r.name))?.name;
  return {
    out: aukum ? `${gfRoad} west to ${aukum}, then north toward Pleasant Valley and US-50` : `${gfRoad} west toward Somerset, then north to US-50`,
    avoid: ns ? `${ns} and all roads south and east of town` : 'all roads south and east of town',
  };
}

const STAMP = 'SIMULATED · scenario built from public data; units, people and events are simulated.';

export function evacDraft(sim: Sim, type: 'ORDER' | 'WARNING', etaMin: number): Draft {
  const c = sim.ctx;
  const t = sim.t;
  const roads = namedRoads(sim, c.sites.gf, 1500, 4);
  const r = evacRoute(sim);
  const veh = sim.findings.find((f) => f.id === 'f-vehicles');
  const order = type === 'ORDER';
  const body = [
    `EL DORADO COUNTY · EVACUATION ${type} · ZONE EDC-GF-1`,
    `Issued ${c.fmtTime(t)} ${c.fmtDate(t)} · Caldor Fire Incident Command`,
    '',
    order ? 'An immediate threat to life exists. Leave now. Do not wait.' : 'A threat to life and property is possible. Prepare to leave now; leave immediately if you need extra time.',
    '',
    `Area: the ${c.gfName} community, including ${roads.length ? roads.join(', ') : 'all residences'} and connecting roads.`,
    `Route out: ${r.out}. Avoid ${r.avoid}.`,
    veh ? `Note: abandoned vehicles reported on ${c.sites.vehiclesRoadName}; law enforcement is clearing the lane.` : 'Law enforcement will staff traffic control on the route out.',
    'Shelter: Pollock Pines-Camino Community Center (simulated). Large animals: El Dorado County Fairgrounds (simulated).',
    '',
    `Projected fire arrival: about ${Math.round(etaMin)} min (Projection rev ${sim.projection?.rev ?? 1}).`,
    STAMP,
  ].join('\n');
  return {
    format: 'evac-notice',
    title: `Evacuation ${type} · EDC-GF-1 · ${c.gfName}`,
    body,
    fields: [
      { label: 'Zone', value: 'EDC-GF-1' },
      { label: 'Type', value: type },
      { label: 'Issued', value: c.fmtTime(t) },
      { label: 'Fire ETA', value: `${Math.round(etaMin)} min` },
      { label: 'Structures', value: String(c.structuresGF) },
      { label: 'Route out', value: r.out.split(',')[0] },
      { label: 'Shelter', value: 'Pollock Pines-Camino CC (sim.)' },
      { label: 'Authority', value: 'EDSO / CAL FIRE AEU (sim.)' },
    ],
  };
}

export function rescueDraft(sim: Sim, f: Finding, ems: Unit, drone: Unit | undefined, path: Geo[], etaMin: number): Draft {
  const c = sim.ctx;
  const roads = routeRoads(sim, path);
  const footM = path.length >= 2 ? Math.round(distanceM(path[path.length - 2], path[path.length - 1])) : 0;
  const body = [
    'RESCUE TASKING · LIFE SAFETY',
    `Issued ${c.fmtTime(sim.t)} ${c.fmtDate(sim.t)} · Caldor Fire Medical Unit`,
    '',
    `Subjects: ${f.count ?? 1} hikers (fictional), ambulatory per ${drone?.callsign ?? 'drone'} live video.`,
    `Location: ${fmtGeo(f.pos)} · ±${Math.round(f.uncertaintyM)} m · near ${c.nearestPlace(f.pos).name}.`,
    `Assigned: EMS ${ems.callsign} (ALS)${drone ? `, ${drone.callsign} overwatch (orbit 90 m AGL, EO/IR)` : ''}.`,
    `Approach: ${roads.length ? roads.join(' → ') : 'nearest road'}${footM > 80 ? `, last ~${footM} m on foot with drone guidance` : ''}.`,
    `Hazard: fire ETA about ${Math.round(etaMin)} min at the location.`,
    'Turnaround trigger: fire within 800 m of the team or ETA under 25 min.',
    `Egress: same route back to ${c.gfName} staging, then ${evacRoute(sim).out}.`,
    'Comms: Command / EMS tactical (simulated).',
    '',
    STAMP,
  ].join('\n');
  return {
    format: 'rescue',
    title: `Rescue tasking · ${f.count ?? 1} hikers`,
    body,
    fields: [
      { label: 'Subjects', value: `${f.count ?? 1} hikers (fictional)` },
      { label: 'Position', value: fmtGeo(f.pos) },
      { label: 'EMS', value: ems.callsign },
      { label: 'Overwatch', value: drone?.callsign ?? '—' },
      { label: 'Fire ETA', value: `${Math.round(etaMin)} min` },
      { label: 'Turnaround', value: 'Fire < 800 m or ETA < 25 min' },
    ],
  };
}

export function moveDraft(sim: Sim, units: Unit[], path: Geo[]): Draft {
  const c = sim.ctx;
  const roads = namedRoads(sim, c.sites.gf, 1200, 3);
  const body = [
    `STRUCTURE GROUP MOVE · ${c.gfName.toUpperCase()}`,
    `Issued ${c.fmtTime(sim.t)} · Operations`,
    '',
    `Group: ${units.map((u) => u.callsign).join(', ')} → ${c.gfName} structure defense.`,
    `Assignment: prep and defend structures along ${roads.length ? roads.join(', ') : 'the town roads'}; protect the evacuation route.`,
    'Safety zone: SZ-1, school ball field, 150 m radius.',
    'Window: now to +45 min. Disengage if fire is within 800 m of SZ-1 or ETA under 20 min; fall back to SZ-1.',
    `Route: ${routeRoads(sim, path).join(' → ') || 'via the main road'}.`,
    'Lookouts: HAWK-1 overhead, ridge camera 1. Comms: Div A tactical.',
    '',
    STAMP,
  ].join('\n');
  return {
    format: 'order',
    title: `Move structure group → ${c.gfName}`,
    body,
    fields: [
      { label: 'Units', value: units.map((u) => u.callsign).join(', ') },
      { label: 'Safety zone', value: 'SZ-1 · school ball field' },
      { label: 'Window', value: '0 to +45 min' },
      { label: 'Trigger', value: 'Fire < 800 m of SZ-1' },
    ],
  };
}

export function resourceDraft(sim: Sim, etaMin: number): Draft {
  const c = sim.ctx;
  const head = compass(sim.projection?.headDirDeg ?? 0);
  const body = [
    'RESOURCE ORDER · CALDOR FIRE',
    `Issued ${c.fmtTime(sim.t)} ${c.fmtDate(sim.t)} · Ordering via ECC (simulated)`,
    '',
    'Qty  Kind                    Type  Needed    Reporting location',
    `2    Engine (structure)      T1    ASAP      ${c.gfName} staging`,
    `1    VLAT (air tanker)       —     ${c.fmtTime(sim.t + 60 * MIN).split(' ')[0]}     Air attack · retardant line ${head} of ${c.gfName}`,
    '',
    `Justification: projection rev ${sim.projection?.rev ?? 1} puts the head into ${c.gfName} in about ${Math.round(etaMin)} min. Current structure group (E-42, CREW-7, DZ-2) cannot cover ${c.structuresGF} structures alone.`,
    'Request numbers: E-114, E-115, A-27 (simulated).',
    '',
    STAMP,
  ].join('\n');
  return {
    format: 'order',
    title: 'Resource order · 2 Type 1 engines + 1 VLAT',
    body,
    fields: [
      { label: 'Engines', value: '2 × Type 1 (structure)' },
      { label: 'Aircraft', value: '1 × VLAT' },
      { label: 'Report to', value: `${c.gfName} staging` },
      { label: 'Needed', value: 'ASAP' },
    ],
  };
}

export function radioDraft(sim: Sim, f: Finding, near: Unit[], etaMin: number): Draft {
  const c = sim.ctx;
  const list = near.map((u) => u.callsign).join(', ') || 'none';
  const body = [
    'RADIO SCRIPT · DIVISION ALPHA · HAZARD ADVISORY',
    '',
    '"Division Alpha, Caldor Command, hazard advisory."',
    `"Two residential propane tanks, about 500 gallon, at a residence on ${c.sites.propaneRoadName}, ${fmtGeo(f.pos)}."`,
    `"Spotted by Engine 41 dash camera at ${c.fmtTime(f.observedAt)}. Brush within 10 meters. Fire ETA about ${Math.round(etaMin)} minutes."`,
    `"Units within 1.5 km: ${list}. Engine 41, assess and isolate if safe. Keep a 100 meter standoff if venting or flame impingement."`,
    '"Do not commit to the structure if fire arrives before protection is in place. Acknowledge."',
    '',
    STAMP,
  ].join('\n');
  return {
    format: 'radio',
    title: 'Radio script · Div A propane hazard',
    body,
    fields: [
      { label: 'Channel', value: 'Div A tactical' },
      { label: 'To', value: list },
      { label: 'Hazard', value: '2 × propane ~500 gal' },
      { label: 'Fire ETA', value: `${Math.round(etaMin)} min` },
    ],
  };
}

export function sitrepDraft(sim: Sim, n: number): Draft {
  const c = sim.ctx;
  const t = sim.t;
  const p = sim.projection;
  const w = c.weatherAt(t);
  const acres = Math.round(c.acresAt(t));
  const count = (k: Unit['kind']) => sim.units.filter((u) => u.kind === k).length;
  const etaGF = p?.etaToPlaces[c.gfId];
  const gfText = etaGF === undefined ? 'not threatened' : etaGF <= t ? 'fire in the community' : `head ETA ${Math.round((etaGF - t) / MIN)} min`;
  const hikers = sim.findings.find((f) => f.kind === 'human');
  const decided = sim.actions.filter((a) => a.status === 'done' || a.status === 'executing' || a.status === 'approved').map((a) => a.title).slice(0, 5);
  const body = [
    `ICS-209 INCIDENT STATUS SUMMARY · REPORT ${n}`,
    `Caldor Fire (CA-ENF-024030) · ${c.fmtTime(t)} ${c.fmtDate(t)}`,
    '',
    `Size: ${acres.toLocaleString('en-US')} acres (VIIRS-derived replay) · Containment 0% (simulated)`,
    `Behavior: head ${compass(p?.headDirDeg ?? 0)} at ${Math.round(p?.rosMpm ?? 0)} m/min; ${p?.drivers[2] ?? ''}; spotting ${sim.findings.some((f) => f.kind === 'spot') ? 'observed' : 'not observed'}.`,
    `Threats: ${c.gfName} (${c.structuresGF} structures), ${gfText}; ${c.places.find((x) => x.kind === 'ranch')?.name ?? 'ranch'} livestock.`,
    `Life safety: ${hikers ? hikers.label.toLowerCase() : 'no people reported in the fire area'}.`,
    `Resources (simulated): ${count('engine')} engines, ${count('crew')} crews, ${count('dozer')} dozer, ${count('drone')} UAS, ${count('helo')} helicopter, ${count('tanker')} air tanker, ${count('ems')} ALS ambulances, ${count('law')} law unit.`,
    `Weather: wind ${Math.round(w.windDirDeg)}° ${Math.round(w.windKph)} kph gusts ${Math.round(w.gustKph)}, RH ${Math.round(w.rh)}%, ${Math.round(w.tempC)}°C.`,
    `Actions this period: ${decided.length ? decided.join('; ') : 'none'}.`,
    `Planned: structure defense in ${c.gfName}; hold the route out; continued UAS overwatch on the head.`,
    '',
    'Prepared by the Orchestrator (treq · reasoning-large) for IC review.',
    STAMP,
  ].join('\n');
  return {
    format: 'ics209',
    title: `ICS-209 sitrep · report ${n}`,
    body,
    fields: [
      { label: 'Acres', value: acres.toLocaleString('en-US') },
      { label: 'Containment', value: '0% (sim.)' },
      { label: 'ROS', value: `${Math.round(p?.rosMpm ?? 0)} m/min` },
      { label: 'Head', value: compass(p?.headDirDeg ?? 0) },
      { label: c.gfName, value: gfText },
      { label: 'Structures', value: String(c.structuresGF) },
    ],
  };
}
