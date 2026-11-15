import type { Draft, Finding, Geo, Unit } from '../../contracts';
import { FuelClass } from '../../contracts';
import type { ScenarioContext } from '../../world/context';
import type { Sim } from '../../world/sim';
import { MIN, destination, distanceM } from '../../world/geo';
import { sendTo, unitById } from '../../world/units';
import { ops } from '../../world/engine';
import { propose } from '../../orchestrator/actions';
import { STAMP, fmtGeo, namedRoads } from '../../orchestrator/drafts';
import type { FindingSpec } from '../../agents/catalog';
import { fieldMinAt, gridIndex, runSpread, type SpreadField } from '../../agents/spread';
import { DEMO_LENGTH_S, ackInterrupts, remindAfter, remindKinds, type BeatDef } from '../beats';
import type { EvacType, ScenarioScript, UnitSpec } from './types';

/**
 * Mati fire replay (East Attica, 23 Jul 2018). The units and their assignments, the people at the beach and
 * every rescue are simulated. Real reports from the pack are ingested at their real times as untrusted sources;
 * the human toll appears only through the pack's sourced facts.
 */

const ZONE = 'Neos Voutzas / Mati';
/** Evacuation ORDER trigger: modelled head ETA to the zone (min). No WARNING stage for a wind-driven run this fast. */
const ORDER_MIN = 150;
const MARATHONOS = /marath|μαραθ/i;

function placeName(ctx: ScenarioContext, re: RegExp, fallback: string): string {
  return ctx.places.find((p) => re.test(p.id) || re.test(p.name))?.name ?? fallback;
}

/** English (transliterated) labels only: OSM names in Greek script fall back to the English form. */
function latin(s: string | undefined, fallback: string): string {
  return s && /^[\u0000-\u024F\s]+$/.test(s) ? s : fallback;
}

function names(ctx: ScenarioContext) {
  return {
    voutzas: placeName(ctx, /voutz/i, 'Neos Voutzas'),
    rafina: placeName(ctx, /rafina/i, 'Rafina'),
    beach: placeName(ctx, /kokkino|limanaki/i, 'Kokkino Limanaki'),
    marathonos: latin(ctx.names.marathonos, 'Marathonos Ave'),
    jam: latin(ctx.names.jamRoad, 'the coastal street'),
  };
}

function evacDraft(sim: Sim, type: EvacType, etaMin: number): Draft {
  const c = sim.ctx;
  const n = names(c);
  const t = sim.t;
  const roads = namedRoads(sim, c.sites.primary, 1200, 4);
  const sms = `112 · Fire moving fast toward ${n.voutzas} and ${c.primaryName}. Leave now: drive south on ${n.marathonos} to ${n.rafina}. If the road is blocked, go on foot to the open beach. Follow police directions.`;
  const body = [
    `EAST ATTICA · EVACUATION ${type} · ${ZONE.toUpperCase()} (SIMULATED)`,
    `Issued ${c.fmtTime(t)} ${c.fmtDate(t)} · Unified command (simulated)`,
    '',
    'An immediate threat to life exists. The fire is wind-driven and moving toward the coast. Leave now. Do not wait to protect property.',
    '',
    `Area: ${n.voutzas}, ${c.primaryName} and all streets between ${n.marathonos} and the sea${roads.length ? `, including ${roads.join(', ')}` : ''}.`,
    `Route out: south on ${n.marathonos} toward ${n.rafina}. Do not drive north or into the narrow coastal streets.`,
    `If you cannot drive out: walk to the open beach and the water's edge, away from trees and parked cars. Coast Guard boats will be directed to the shore.`,
    `Assembly: ${n.rafina} port (simulated). EKAB ambulances at the port.`,
    '',
    `112 cell-broadcast text (draft): "${sms}"`,
    '',
    `Projected fire arrival in ${c.primaryName}: about ${Math.round(etaMin)} min (Projection rev ${sim.projection?.rev ?? 1}, independent spread model).`,
    STAMP,
  ].join('\n');
  return {
    format: 'evac-notice',
    title: `Evacuation ${type} · ${ZONE} + 112 message`,
    body,
    fields: [
      { label: 'Zone', value: ZONE },
      { label: 'Type', value: type },
      { label: 'Issued', value: c.fmtTime(t) },
      { label: 'Fire ETA', value: `${Math.round(etaMin)} min` },
      { label: 'Structures', value: String(c.structuresPrimary) },
      { label: 'Route out', value: `South · ${n.marathonos} → ${n.rafina}` },
      { label: '112 message', value: sms },
      { label: 'Authority', value: 'Civil Protection / Hellenic Police (sim.)' },
    ],
  };
}

function rerouteDraft(sim: Sim, f: Finding): Draft {
  const c = sim.ctx;
  const n = names(c);
  const sms = `112 · ${n.jam} is blocked. Do not drive toward the coast road. Leave south on ${n.marathonos} to ${n.rafina}, or walk to the beach. Follow police directions.`;
  const body = [
    `EAST ATTICA · EVACUATION ROUTE UPDATE · ${ZONE.toUpperCase()} (SIMULATED)`,
    `Issued ${c.fmtTime(sim.t)} ${c.fmtDate(sim.t)} · Unified command (simulated)`,
    '',
    `Blocked: ${n.jam} near ${fmtGeo(f.pos)} (traffic jam, dash camera ${c.fmtTime(f.observedAt)}).`,
    `Use instead: ${n.marathonos} south to ${n.rafina}. Police to hold traffic out of the coastal streets.`,
    'On foot: go to the open beach; boats are being directed to the shore.',
    '',
    `112 update (draft): "${sms}"`,
    '',
    STAMP,
  ].join('\n');
  return {
    format: 'evac-notice',
    title: `Evacuation route update · avoid ${n.jam}`,
    body,
    fields: [
      { label: 'Blocked', value: n.jam },
      { label: 'Use', value: `${n.marathonos} → ${n.rafina}` },
      { label: '112 update', value: sms },
      { label: 'Traffic control', value: 'ELAS-1 (sim.)' },
    ],
  };
}

function rescueDraft(sim: Sim, f: Finding, boat: Unit, drone: Unit | undefined, path: Geo[], etaMin: number): Draft {
  const c = sim.ctx;
  const n = names(c);
  const boats = sim.ctx.script.plans.rescue.unitIds.map((id) => unitById(sim, id)?.callsign).filter(Boolean).join(', ') || boat.callsign;
  const km = path.length >= 2 ? (distanceM(path[0], path[path.length - 1]) / 1000).toFixed(1) : '?';
  const body = [
    'MARITIME RESCUE TASKING · LIFE SAFETY',
    `Issued ${c.fmtTime(sim.t)} ${c.fmtDate(sim.t)} · Coast Guard / EKAB (simulated)`,
    '',
    `Subjects: about ${f.count ?? 10} people (fictional) at the water's edge, ${n.beach}; ambulatory per ${drone?.callsign ?? 'drone'} live video.`,
    `Location: ${fmtGeo(f.pos)} · ±${Math.round(f.uncertaintyM)} m.`,
    `Assigned: Coast Guard ${boats}${drone ? `, ${drone.callsign} overwatch (orbit 90 m AGL, EO/IR through smoke)` : ''}.`,
    `Approach: by sea from ${n.rafina} port, ~${km} km; land-side road is blocked.`,
    `Hazard: fire at the shoreline in about ${Math.round(etaMin)} min; heavy smoke, poor visibility, onshore embers.`,
    `Egress: back to ${n.rafina} port; EKAB ambulances meet the boats.`,
    'Comms: Coast Guard VHF / EKAB (simulated).',
    '',
    STAMP,
  ].join('\n');
  return {
    format: 'rescue',
    title: `Maritime rescue · ${n.beach}`,
    body,
    fields: [
      { label: 'Subjects', value: `~${f.count ?? 10} people (fictional)` },
      { label: 'Position', value: fmtGeo(f.pos) },
      { label: 'Boats', value: boats },
      { label: 'Overwatch', value: drone?.callsign ?? '—' },
      { label: 'Fire ETA', value: `${Math.round(etaMin)} min` },
      { label: 'Egress', value: `${n.rafina} port` },
    ],
  };
}

function moveDraft(sim: Sim, units: Unit[], path: Geo[]): Draft {
  const c = sim.ctx;
  const n = names(c);
  void path;
  const body = [
    `ENGINE GROUP MOVE · ${n.marathonos.toUpperCase()} EVACUATION CORRIDOR`,
    `Issued ${c.fmtTime(sim.t)} · Operations (simulated)`,
    '',
    `Group: ${units.map((u) => u.callsign).join(', ')} → ${n.marathonos} between ${n.voutzas} and ${c.primaryName}.`,
    'Assignment: keep the evacuation corridor open and protect people leaving; no offensive attack on the head in this wind.',
    `Safety zone: ${n.rafina} port. Disengage if the fire front is within 500 m of the corridor.`,
    '',
    STAMP,
  ].join('\n');
  return {
    format: 'order',
    title: `Move engine group → ${n.marathonos} corridor`,
    body,
    fields: [
      { label: 'Units', value: units.map((u) => u.callsign).join(', ') },
      { label: 'Safety zone', value: `${n.rafina} port` },
      { label: 'Trigger', value: 'Front < 500 m of corridor' },
    ],
  };
}

function resourceDraft(sim: Sim, etaMin: number): Draft {
  const c = sim.ctx;
  const n = names(c);
  const body = [
    `RESOURCE REQUEST · ${ZONE.toUpperCase()}`,
    `Issued ${c.fmtTime(sim.t)} ${c.fmtDate(sim.t)} · Unified command (simulated)`,
    '',
    'Qty  Kind                         Needed   Reporting location',
    `2    Coast Guard patrol boats      ASAP     ${n.rafina} port → shoreline ${c.primaryName}`,
    `4    EKAB ambulances               ASAP     ${n.rafina} port`,
    `2    Fishing / tourist boats (vol.) ASAP    ${n.rafina} port`,
    '',
    `Justification: modelled fire arrival in ${c.primaryName} in about ${Math.round(etaMin)} min with a wind-driven run to the sea; people may be cut off at the shore.`,
    STAMP,
  ].join('\n');
  return {
    format: 'order',
    title: 'Resource request · boats + EKAB to Rafina port',
    body,
    fields: [
      { label: 'Boats', value: '2 Coast Guard + 2 volunteer' },
      { label: 'EKAB', value: '4 ambulances' },
      { label: 'Report to', value: `${n.rafina} port` },
    ],
  };
}

/** Land cells next to the sea within `r` m of `near`: the modelled time the fire reaches the coast. */
export function coastMinutes(f: SpreadField, near: Geo, r: number): number {
  const g = f.grid;
  const c = gridIndex(g, near);
  if (c < 0) return Infinity;
  const cx = c % g.gw;
  const cy = (c / g.gw) | 0;
  const rx = Math.ceil(r / g.dxM);
  const ry = Math.ceil(r / g.dyM);
  let best = Infinity;
  for (let y = Math.max(1, cy - ry); y <= Math.min(g.gh - 2, cy + ry); y++) {
    for (let x = Math.max(1, cx - rx); x <= Math.min(g.gw - 2, cx + rx); x++) {
      const i = y * g.gw + x;
      if (g.fuel[i] === FuelClass.Water) continue;
      if (g.fuel[i - 1] !== FuelClass.Water && g.fuel[i + 1] !== FuelClass.Water && g.fuel[i - g.gw] !== FuelClass.Water && g.fuel[i + g.gw] !== FuelClass.Water) continue;
      if (f.t[i] < best) best = f.t[i];
    }
  }
  return best;
}

function sourced(ctx: ScenarioContext, re: RegExp): { text: string; by: string } | null {
  const f = ctx.pack.facts?.find((x) => re.test(`${x.label} ${x.value} ${x.source}`));
  if (f) return { text: `${f.label}: ${f.value}`, by: f.source };
  const r = ctx.pack.reports?.find((x) => re.test(`${x.summary} ${x.publisher}`));
  return r ? { text: r.summary, by: r.publisher } : null;
}

function catalog(ctx: ScenarioContext): FindingSpec[] {
  const S = ctx.sites;
  const n = names(ctx);
  const ign = ctx.tDetect - 2 * MIN;
  const crossT = Math.min(ctx.end - MIN, Math.max(ign + 30 * MIN, ctx.arrivalNear(S.marathonos, 200)));
  const beachT = beachAnchor(ctx);
  return [
    {
      id: 'f-danger',
      kind: 'fuel',
      label: 'FIRE DANGER CATEGORY 4 (VERY HIGH) · EAST ATTICA',
      detail: 'Civil Protection daily fire-risk map for today: category 4 of 5 for Attica. Dry Aleppo pine and shrub on the eastern slopes of Penteli, strong west winds forecast.',
      pos: destination(S.ignition, 120, 2500),
      uncertaintyM: 3000,
      confidence: 0.9,
      poolId: 'pool-extract',
      source: 'web',
      sourceLabel: 'Civil Protection',
      sourceTitle: 'Daily fire-risk map',
      reveal: { at: ctx.T0 - 40 * MIN },
      halfLifeS: 3600,
      persistent: true,
      jobInput: 'Extract fire-risk map · Attica',
      minutes: 5,
      counters: { articlesRead: 1 },
    },
    {
      id: 'f-structures',
      kind: 'structure',
      label: `${ctx.structuresPrimary} STRUCTURES · ${ctx.primaryName.toUpperCase()}`,
      detail: `OpenStreetMap building footprints within 1.5 km of ${ctx.primaryName}. Dense low-rise houses under pine canopy, narrow streets running down to the sea.`,
      pos: S.primary,
      uncertaintyM: 900,
      confidence: 0.95,
      count: ctx.structuresPrimary,
      poolId: 'pool-extract',
      source: 'web',
      sourceLabel: 'OpenStreetMap',
      sourceTitle: `${ctx.primaryName} building inventory`,
      url: 'https://www.openstreetmap.org',
      reveal: { at: ctx.T0 - 30 * MIN },
      halfLifeS: 3600,
      persistent: true,
      place: ctx.primaryName,
      jobInput: `Structure inventory · ${ctx.primaryName}`,
      minutes: 15,
      counters: { articlesRead: 1 },
    },
    {
      id: 'f-ignition',
      kind: 'spot',
      label: 'NEW FIRE · DAOU PENTELI · WIND-DRIVEN',
      detail: `Penteli ridge camera: new smoke column above Daou, laid flat by the west wind. A public social clip from the same area shows flames in pine and shrub. Ignition time from the pack: ${ctx.fmtTime(ign)}.`,
      pos: destination(S.ignition, 80, 150),
      truePos: S.ignition,
      uncertaintyM: 400,
      confidence: 0.85,
      poolId: 'pool-fixed',
      source: 'fixed-cam',
      extraSources: ['social'],
      sourceLabel: 'Penteli ridge camera + social clip',
      sourceTitle: 'New smoke origin',
      reveal: { at: ctx.tDetect },
      halfLifeS: 1800,
      persistent: true,
      interrupt: true,
      feedId: 'feed-ridge-1',
      jobInput: 'Penteli ridge cam frames + social clip · new smoke origin',
      minutes: 4,
      counters: { imagesAnalyzed: 12, postsScreened: 1 },
    },
    {
      id: 'f-crossing',
      kind: 'smoke',
      label: `CROWN FIRE · CROSSING ${n.marathonos.toUpperCase()}`,
      detail: `Drone sweep: active crown fire with heavy ember shower crossing ${n.marathonos} near ${n.voutzas}.`,
      pos: S.marathonos,
      uncertaintyM: 300,
      confidence: 0.85,
      poolId: 'pool-drone',
      source: 'drone-cam',
      sourceLabel: 'Drone sweep',
      sourceTitle: 'Coverage sweep frame',
      reveal: { at: crossT },
      halfLifeS: 900,
      jobInput: 'Sweep frames · fire behaviour',
      minutes: 3,
      counters: { imagesAnalyzed: 30 },
    },
    {
      id: 'f-jam',
      kind: 'road-block',
      label: `TRAFFIC JAM · ${n.jam.toUpperCase()} · BLOCKED`,
      detail: 'RAF-11 dash cam: cars stopped bumper to bumper in a narrow street toward the coast, smoke drifting across. Grounding DINO: "car" x14, no movement over 40 s.',
      pos: S.jam,
      uncertaintyM: 60,
      confidence: 0.85,
      count: 14,
      poolId: 'pool-ground',
      source: 'ground-cam',
      sourceLabel: 'RAF-11 dash cam',
      sourceTitle: 'Dash cam detection',
      reveal: { unitId: 'raf-11', radiusM: 300, fallbackAt: crossT + 3 * MIN, notBefore: crossT },
      halfLifeS: 900,
      feedId: 'feed-raf-11',
      jobInput: 'RAF-11 dash cam · 0m 40s · traffic + obstruction',
      minutes: 3,
      counters: { footageReviewedS: 40 },
    },
    {
      id: 'f-beach',
      kind: 'human',
      label: `~12 PEOPLE · ${n.beach.toUpperCase()} SHORE (FICTIONAL)`,
      detail: 'Public social clip: a group at the water line under heavy smoke, the road behind them blocked. Location from the shoreline and a beach sign (approximate). People are fictional.',
      pos: destination(S.beach, 300, 180),
      truePos: S.beach,
      uncertaintyM: 400,
      confidence: 0.6,
      count: 12,
      poolId: 'pool-social',
      source: 'social',
      sourceLabel: 'Social video',
      sourceTitle: '"Smoke everywhere, we are at the sea" (public post)',
      reveal: { at: beachT + 0.5 * MIN },
      halfLifeS: 900,
      confirmable: true,
      place: n.beach,
      jobInput: 'Social clip · 0m 25s · geolocate + people count',
      minutes: 4,
      counters: { postsScreened: 1 },
      confirmDetail: 'about twelve people standing in shallow water, no visible injuries. Florence-2 labels: person x12 (0.88).',
    },
  ];
}

/** Scenario time the maritime rescue beat starts: shortly before the documented arrival at the sea, if known. */
function beachAnchor(ctx: ScenarioContext): number {
  const ign = ctx.tDetect - 2 * MIN;
  const cp = (ctx.pack.checkpoints ?? []).filter((c) => /sea|coast|shore|beach/i.test(`${c.id} ${c.label}`)).sort((a, b) => a.t - b.t)[0];
  const t = cp ? cp.t - 10 * MIN : ign + 100 * MIN;
  return Math.min(ctx.end - 30 * MIN, Math.max(ign + 60 * MIN, t));
}

function units(ctx: ScenarioContext): UnitSpec[] {
  const S = ctx.sites;
  const road = (g: Geo): Geo => ctx.nearestRoadPoint(g, 1500) ?? g;
  const mid = { lon: (S.primary.lon + S.ignition.lon) / 2, lat: (S.primary.lat + S.ignition.lat) / 2 };
  const corridor = [S.marathonos, destination(S.marathonos, 0, 1200), destination(S.marathonos, 180, 1200), S.voutzas].map(road);
  const town = [S.primary, destination(S.primary, 250, 700), destination(S.primary, 20, 800), S.voutzas].map(road);
  const specs: UnitSpec[] = [];
  for (let i = 1; i <= 6; i++) specs.push({ id: `uav-${i}`, callsign: `AETOS-${i}`, kind: 'drone', division: 'AIR', pos: destination(mid, 40 + i * 50, 1500 + i * 300), alt: 120 });
  specs.push(
    { id: 'raf-11', callsign: 'RAF-11', kind: 'engine', division: 'A', pos: road(S.rafinaStation), patrol: town },
    { id: 'raf-12', callsign: 'RAF-12', kind: 'engine', division: 'A', pos: road(destination(S.rafinaStation, 0, 300)), patrol: corridor },
    { id: 'nmk-21', callsign: 'NMK-21', kind: 'engine', division: 'A', pos: road(S.neaMakriStation), patrol: corridor },
    { id: 'pen-31', callsign: 'PEN-31', kind: 'engine', division: 'Z', pos: road(S.penteliStation), patrol: [S.penteliStation, destination(S.ignition, 90, 1500), destination(S.ignition, 180, 1500)].map(road) },
    { id: 'emak-1', callsign: 'EMAK-1', kind: 'crew', division: 'A', pos: road(S.voutzas), plan: { mode: 'wander', anchor: road(S.voutzas), radiusM: 200, target: road(S.voutzas) }, helmetCam: true },
    { id: 'ekab-1', callsign: 'EKAB-1', kind: 'ems', division: 'EMS', pos: S.staging },
    { id: 'ekab-2', callsign: 'EKAB-2', kind: 'ems', division: 'EMS', pos: road(destination(S.staging, 90, 300)) },
    { id: 'elas-1', callsign: 'ELAS-1', kind: 'law', pos: road(destination(S.marathonos, 180, 600)), patrol: corridor },
    { id: 'pls-602', callsign: 'PLS-602', kind: 'law', pos: S.port, marine: true, cruise: 14 },
    { id: 'pls-614', callsign: 'PLS-614', kind: 'law', pos: destination(S.port, 60, 150), marine: true, cruise: 14 },
    { id: 'h-51', callsign: 'H-51', kind: 'helo', division: 'AIR', pos: S.water, alt: 250, plan: { mode: 'circuit', pts: [S.water, S.fireCenterT0], i: 1 } },
    { id: 'cl-21', callsign: 'CL-21', kind: 'tanker', division: 'AIR', pos: destination(S.fireCenterT0, 0, 4000), alt: 500, plan: { mode: 'orbit', center: S.fireCenterT0, radiusM: 4000, ang: 0 } },
  );
  return specs;
}

function beats(ctx: ScenarioContext): BeatDef[] {
  const S = ctx.sites;
  const n = names(ctx);
  const ign = ctx.tDetect - 2 * MIN;
  // The same independent model the Projection agent runs at detection time.
  const field = runSpread(ctx.pack, ctx.tDetect, (t) => ctx.weatherAt(t), 360);
  const toRoad = fieldMinAt(field, S.marathonos, 300);
  const toSea = coastMinutes(field, S.primary, 4000);
  const toZone = fieldMinAt(field, S.voutzas ?? S.primary, 600);
  const fmtM = (m: number) => (Number.isFinite(m) && m >= 0 ? `about ${Math.round(m)} min` : 'beyond the 6 h horizon');
  const w = ctx.weatherAt(ctx.tDetect);
  const warn = sourced(ctx, /warning|warned|alert/i);
  const crossT = Math.min(ctx.end - MIN, Math.max(ign + 30 * MIN, ctx.arrivalNear(S.marathonos, 200)));
  const beachT = beachAnchor(ctx);
  const facts = (ctx.pack.facts ?? []).slice(0, 3).map((f) => `${f.label}: ${f.value} (${f.source})`);
  return [
    {
      id: 'calm',
      at: 0,
      title: 'Calm monitoring, high fire danger',
      caption: `${ctx.fmtTime(ctx.T0)}, ${ctx.fmtDate(ctx.T0)}, East Attica. Fire danger is category 4 (very high) and a strong west wind is blowing. A large fire at Kineta, about 50 km west, is drawing aircraft and crews away. Six drones and the agent pools watch the slopes of Penteli above ${n.voutzas} and ${ctx.primaryName}.`,
      speed: 30,
      enter: (h) => {
        ops.setAutonomy(h.sim, 'assist');
        ops.setLens(h.sim, 'ic');
        ops.setHoldLayout(h.sim, false);
      },
    },
    {
      id: 'ignition',
      at: 20,
      title: 'Ignition at Daou Penteli',
      caption: `${ctx.fmtTime(ign)}: a fire starts at Daou Penteli. Simulated ridge-camera and social detections raise the only Z0 interrupt. The prototype spread model (reconstructed issue-time seed, DEM, fuel, ${Math.round(w.windKph)} km/h ${Math.round(w.windDirDeg)}° wind, archived future weather as a perfect forecast) puts the head at ${n.marathonos} in ${fmtM(toRoad)} and at the sea in ${fmtM(toSea)}. Its timing against the sourced checkpoints is scored as the replay runs; it has no ember spotting.`,
      speed: 30,
      anchor: ctx.tDetect,
      enter: (h) => ops.setAutonomy(h.sim, 'act'),
    },
    {
      id: 'evac',
      at: 60,
      title: `Evacuation ORDER · ${ZONE}`,
      caption: `The modelled head reaches ${n.voutzas} in ${fmtM(toZone)}, inside the prototype ${ORDER_MIN} min policy trigger. The Orchestrator drafts a simulated evacuation ORDER and modern 112 message, not a reconstruction of 2018 warning capability. Routes are unvalidated. Review the draft and click Approve; the Director never approves it for you.${warn ? ` Historical context: ${warn.text} (${warn.by}).` : ''}`,
      speed: 20,
      enter: (h) => ackInterrupts(h.sim),
      watch: (h, s, _once, mark) => remindAfter(h.sim, s, mark, (a) => (a.kind === 'evac-notice' ? 6 : a.kind === 'move-group' ? 9 : a.kind === 'resource-order' ? 12 : -1)),
    },
    {
      id: 'crossing',
      at: 100,
      title: `Crown fire crosses ${n.marathonos}`,
      caption: `The crown fire crosses ${n.marathonos}. RAF-11's dash cam finds cars stuck in ${n.jam} toward the coast; the Orchestrator drafts a route update that keeps traffic out of the coastal streets and sends ELAS-1 to hold the junction.`,
      speed: 15,
      anchor: crossT,
      enter: (h) => {
        const sim = h.sim;
        ackInterrupts(sim);
        remindKinds(sim, ['evac-notice', 'move-group', 'resource-order']);
        if (!sim.revealed.has('f-jam')) sendTo(sim, 'raf-11', S.jam, { road: true, after: 'hold', arriveBy: sim.t + 2 * MIN });
      },
      watch: (h, s, _once, mark) => remindAfter(h.sim, s, mark, (a) => (a.kind === 'evac-notice' ? 6 : -1)),
    },
    {
      id: 'sea',
      at: 130,
      title: 'Coast Guard boats to the shore',
      caption: `A social clip shows people at the water line at ${n.beach} (fictional). AETOS confirms them live, the Orchestrator raises the interrupt and drafts a maritime rescue: Coast Guard boats from ${n.rafina} port, EKAB at the quay. Prediction checks are scored live as the clock passes their target times.`,
      speed: 30,
      anchor: beachT,
      enter: (h) => {
        ackInterrupts(h.sim);
        remindKinds(h.sim, ['evac-notice']);
      },
      watch: (h, s, _once, mark) => remindAfter(h.sim, s, mark, (a) => (a.kind === 'rescue' ? 4 : -1)),
    },
    {
      id: 'summary',
      at: 160,
      title: 'Ledger and the facts',
      caption: `Simulated work in three minutes. Area scores compare against reconstructed spread; checkpoint errors compare against sourced times. No operational forecast or measured time savings.${facts.length ? ` Historical context: ${facts.join('; ')}.` : ''} Units, people and events in this tour are simulated.`,
      speed: 10,
      enter: (h) => ackInterrupts(h.sim),
      watch: (h, s, once) => {
        if (s >= DEMO_LENGTH_S - 160 && once('end')) h.sim.paused = true;
      },
    },
  ];
}

function roadBlock(sim: Sim, f: Finding): void {
  if (sim.actions.some((a) => a.itemId === f.id && a.kind === 'evac-notice')) return;
  const n = names(sim.ctx);
  propose(sim, {
    kind: 'evac-notice',
    title: `Evacuation route update · avoid ${n.jam}`,
    summary: `${f.label.toLowerCase()} on the way to the coast. Keep traffic on ${n.marathonos} south to ${n.rafina}; ELAS-1 to hold the junction.`,
    risk: 'high',
    audiences: ['public', 'law', 'ic'],
    unitIds: ['elas-1'],
    target: { lon: f.pos.lon, lat: f.pos.lat },
    trigger: 'Evacuation route blocked',
    draft: rerouteDraft(sim, f),
    itemId: f.id,
  });
}

export const mati: ScenarioScript = {
  id: 'mati-2018',
  incident: 'Mati fire',
  seed: 20180723,
  tzOffsetMin: 180,
  areaUnit: 'ha',
  primary: { match: /^mati$/i, fallback: { id: 'mati', name: 'Mati', pos: { lon: 24.0045, lat: 38.0455 }, kind: 'town' }, radiusM: 1500 },
  timeline: ({ start, end, ignitionT }) => {
    const ign = ignitionT && ignitionT >= start && ignitionT < end ? ignitionT : start + 30 * MIN;
    return { T0: Math.max(start, ign - 12 * MIN), tShift: null, tDetect: ign + 2 * MIN };
  },
  sites: (h) => {
    const p = h.primary.pos;
    const ig = h.ignition;
    const pick = (re: RegExp, fb: Geo) => h.find(re)?.pos ?? fb;
    const voutzas = pick(/voutz/i, destination(p, 280, 1700));
    const rafina = pick(/^rafina$/i, destination(p, 175, 2600));
    const beach = pick(/kokkino|limanaki/i, destination(p, 160, 1300));
    const port = h.nearestWater(rafina, 1500) ?? destination(rafina, 100, 400);
    const marathonos = h.nearestRoadPoint(destination(voutzas, 90, 600), 2500, MARATHONOS) ?? destination(voutzas, 90, 600);
    const coastT = destination(p, 120, 350);
    const water = h.nearestWater(p, 5000) ?? destination(p, 110, 1500);
    const jam = h.nearestRoadPoint(coastT, 900) ?? coastT;
    return {
      staging: h.nearestRoadPoint(rafina, 800) ?? rafina,
      refuge: port,
      water,
      voutzas,
      rafina,
      beach,
      beachSea: h.nearestWater(beach, 1200) ?? destination(beach, 110, 250),
      port,
      marathonos,
      jam,
      rafinaStation: rafina,
      neaMakriStation: pick(/nea[- ]?makri/i, destination(p, 340, 4500)),
      penteliStation: pick(/penteli/i, destination(ig, 250, 3000)),
    };
  },
  names: (h, s) => ({
    marathonos: latin(h.roadNamesNear(s.marathonos, 80).find((x) => MARATHONOS.test(x)), 'Marathonos Ave'),
    jamRoad: latin(h.roadNamesNear(s.jam, 60).find((x) => latin(x, '') !== ''), 'the coastal street'),
  }),
  cams: (h, s) => {
    const ig = h.ignition;
    const [pen] = h.highPoints(ig, [[200, 360]], 1200, 9000);
    const [east] = h.highPoints(s.rafinaStation, [[300, 60]], 2000, 9000);
    return [
      { id: 'ridge-1', name: `PENTELI RIDGE CAM · ${Math.round(pen.elev)} M`, pos: pen.pos },
      { id: 'ridge-2', name: `${h.nearestPlace(east.pos).name.toUpperCase()} HILL CAM · ${Math.round(east.elev)} M`, pos: east.pos },
    ];
  },
  units,
  catalog,
  beats,
  plans: {
    preferDroneId: 'uav-3',
    evac: {
      zonePlaceIds: ['neos-voutzas'],
      orderMin: ORDER_MIN,
      warningMin: 0,
      title: (type) => `Evacuation ${type} · ${ZONE}`,
      summary: (_type, m, rev, ctx) => `Modelled head reaches ${ctx.primaryName} in ${Math.round(m)} min (rev ${rev}); wind-driven run toward the sea. ${ctx.structuresPrimary} structures, narrow streets.`,
      unitIds: ['elas-1'],
      trafficUnitId: 'elas-1',
      draft: evacDraft,
      doneText: (title) => `${title} is out (simulated): 112 cell broadcast, police and municipal channels. ELAS-1 is moving to traffic control on Marathonos Ave.`,
    },
    moveGroup: {
      unitIds: ['raf-12', 'nmk-21', 'emak-1'],
      target: (ctx) => ctx.sites.marathonos,
      safetyLabel: 'Rafina port',
      title: () => 'Move engine group → Marathonos Ave corridor',
      draft: moveDraft,
    },
    resource: {
      title: 'Resource request · boats + EKAB to Rafina port',
      summary: (sim) => `People may be cut off at the shore of ${sim.ctx.primaryName}; boats and ambulances must be in place before the fire reaches the sea.`,
      draft: resourceDraft,
      doneText: 'Resource request transmitted (simulated): Coast Guard and volunteer boats plus four EKAB ambulances to Rafina port.',
    },
    rescue: {
      unitIds: ['pls-602', 'pls-614'],
      kinds: ['law'],
      marine: true,
      title: (f, place) => `Maritime rescue · ~${f.count ?? 10} people at ${place}`,
      summary: (u, d, eta) => `${u.callsign} and a second Coast Guard boat by sea from Rafina port, ${d?.callsign ?? 'drone'} overwatch through the smoke. Fire at the shore in about ${Math.round(eta)} min.`,
      approach: (sim) => sim.ctx.sites.beachSea,
      safety: (ctx) => ({ center: ctx.sites.port, radiusM: 200, label: 'Rafina port' }),
      draft: rescueDraft,
      doneLabel: (f, u) => `~${f.count ?? 10} PEOPLE · SAFE ON BOARD ${u.callsign}`,
      doneDetail: (_f, u, at) => `${u.callsign} reached the shore at ${at}; everyone taken on board and brought to Rafina port, EKAB waiting. Simulated.`,
      doneSay: (_f, u, released) => `${u.callsign} has everyone on board and is heading for Rafina port, where EKAB is waiting; ${released}`,
      returnTo: (ctx) => ctx.sites.port,
    },
    roadBlock,
  },
  satellite: { feedLabel: 'MSG SEVIRI · FIRE DETECTION (15 MIN)', frame: 'Meteosat SEVIRI fire frame', done: 'processed a Meteosat SEVIRI fire frame' },
  queries: ['Penteli fire', 'Mati fire evacuation', 'Rafina fire', 'Neos Voutzas fire', 'Hellenic Fire Service Attica', 'Kineta fire update'],
  socialTag: '#Mati #Rafina',
  radioChannels: ['Fire Service Attica ops', 'Police East Attica', 'Coast Guard VHF 16'],
  weatherSource: 'pack hourly weather',
  redFlag: 'Very high fire danger (category 4) with strong west winds (pack weather + Civil Protection map).',
  intro: (sim) =>
    `Monitoring East Attica from ${sim.ctx.fmtTime(sim.t)} ${sim.ctx.fmtDate(sim.t)}. Fire danger is category 4 and the wind is strong from the west; the Kineta fire to the west is drawing resources. ${sim.units.filter((u) => u.kind === 'drone').length} drones are on patrol and ${sim.pools.length} agent pools are ingesting web, social, camera, satellite, weather and radio sources. I will interrupt only for life safety or imminent hazards.`,
};
