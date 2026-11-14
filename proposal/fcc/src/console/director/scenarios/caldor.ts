import type { Draft, Finding, Geo, Unit } from '../../contracts';
import type { ScenarioContext } from '../../world/context';
import type { Sim } from '../../world/sim';
import { MIN, bearingDeg, compass, destination, distanceM } from '../../world/geo';
import { sendTo, unitById } from '../../world/units';
import { ops } from '../../world/engine';
import { say } from '../../orchestrator/messages';
import { STAMP, fmtGeo, namedRoads, routeRoads } from '../../orchestrator/drafts';
import type { FindingSpec } from '../../agents/catalog';
import { DEMO_LENGTH_S, DEMO_QUESTION, ackInterrupts, remindAfter, remindKinds, type BeatDef } from '../beats';
import type { EvacType, ScenarioScript, UnitSpec } from './types';

/**
 * Caldor Fire replay (El Dorado County, CA, 16-17 Aug 2021). Story anchors are derived from the real pack;
 * the hikers, horses and the ranch/trailhead are fictional and flagged as such.
 */

const ZONE = 'EDC-GF-1';
/** Evacuation triggers on the modelled head ETA to the primary community (min). */
const WARNING_MIN = 240;
const ORDER_MIN = 180;

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

function evacDraft(sim: Sim, type: EvacType, etaMin: number): Draft {
  const c = sim.ctx;
  const t = sim.t;
  const roads = namedRoads(sim, c.sites.primary, 1500, 4);
  const r = evacRoute(sim);
  const veh = sim.findings.find((f) => f.id === 'f-vehicles');
  const order = type === 'ORDER';
  const body = [
    `EL DORADO COUNTY · EVACUATION ${type} · ZONE ${ZONE}`,
    `Issued ${c.fmtTime(t)} ${c.fmtDate(t)} · Caldor Fire Incident Command`,
    '',
    order ? 'An immediate threat to life exists. Leave now. Do not wait.' : 'A threat to life and property is possible. Prepare to leave now; leave immediately if you need extra time.',
    '',
    `Area: the ${c.primaryName} community, including ${roads.length ? roads.join(', ') : 'all residences'} and connecting roads.`,
    `Route out: ${r.out}. Avoid ${r.avoid}.`,
    veh ? `Note: abandoned vehicles reported on ${c.names.vehiclesRoad}; law enforcement is clearing the lane.` : 'Law enforcement will staff traffic control on the route out.',
    'Shelter: Pollock Pines-Camino Community Center (simulated). Large animals: El Dorado County Fairgrounds (simulated).',
    '',
    `Projected fire arrival: about ${Math.round(etaMin)} min (Projection rev ${sim.projection?.rev ?? 1}).`,
    STAMP,
  ].join('\n');
  return {
    format: 'evac-notice',
    title: `Evacuation ${type} · ${ZONE} · ${c.primaryName}`,
    body,
    fields: [
      { label: 'Zone', value: ZONE },
      { label: 'Type', value: type },
      { label: 'Issued', value: c.fmtTime(t) },
      { label: 'Fire ETA', value: `${Math.round(etaMin)} min` },
      { label: 'Structures', value: String(c.structuresPrimary) },
      { label: 'Route out', value: r.out.split(',')[0] },
      { label: 'Shelter', value: 'Pollock Pines-Camino CC (sim.)' },
      { label: 'Authority', value: 'EDSO / CAL FIRE AEU (sim.)' },
    ],
  };
}

function rescueDraft(sim: Sim, f: Finding, ems: Unit, drone: Unit | undefined, path: Geo[], etaMin: number): Draft {
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
    `Egress: same route back to ${c.primaryName} staging, then ${evacRoute(sim).out}.`,
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

function moveDraft(sim: Sim, units: Unit[], path: Geo[]): Draft {
  const c = sim.ctx;
  const roads = namedRoads(sim, c.sites.primary, 1200, 3);
  const body = [
    `STRUCTURE GROUP MOVE · ${c.primaryName.toUpperCase()}`,
    `Issued ${c.fmtTime(sim.t)} · Operations`,
    '',
    `Group: ${units.map((u) => u.callsign).join(', ')} → ${c.primaryName} structure defense.`,
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
    title: `Move structure group → ${c.primaryName}`,
    body,
    fields: [
      { label: 'Units', value: units.map((u) => u.callsign).join(', ') },
      { label: 'Safety zone', value: 'SZ-1 · school ball field' },
      { label: 'Window', value: '0 to +45 min' },
      { label: 'Trigger', value: 'Fire < 800 m of SZ-1' },
    ],
  };
}

function resourceDraft(sim: Sim, etaMin: number): Draft {
  const c = sim.ctx;
  const head = compass(sim.projection?.headDirDeg ?? 0);
  const body = [
    'RESOURCE ORDER · CALDOR FIRE',
    `Issued ${c.fmtTime(sim.t)} ${c.fmtDate(sim.t)} · Ordering via ECC (simulated)`,
    '',
    'Qty  Kind                    Type  Needed    Reporting location',
    `2    Engine (structure)      T1    ASAP      ${c.primaryName} staging`,
    `1    VLAT (air tanker)       —     ${c.fmtTime(sim.t + 60 * MIN).split(' ')[0]}     Air attack · retardant line ${head} of ${c.primaryName}`,
    '',
    `Justification: projection rev ${sim.projection?.rev ?? 1} puts the head into ${c.primaryName} in about ${Math.round(etaMin)} min. Current structure group (E-42, CREW-7, DZ-2) cannot cover ${c.structuresPrimary} structures alone.`,
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
      { label: 'Report to', value: `${c.primaryName} staging` },
      { label: 'Needed', value: 'ASAP' },
    ],
  };
}

function radioDraft(sim: Sim, f: Finding, near: Unit[], etaMin: number): Draft {
  const c = sim.ctx;
  const list = near.map((u) => u.callsign).join(', ') || 'none';
  const body = [
    'RADIO SCRIPT · DIVISION ALPHA · HAZARD ADVISORY',
    '',
    '"Division Alpha, Caldor Command, hazard advisory."',
    `"Two residential propane tanks, about 500 gallon, at a residence on ${c.names.propaneRoad}, ${fmtGeo(f.pos)}."`,
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

function catalog(ctx: ScenarioContext): FindingSpec[] {
  const S = ctx.sites;
  const T0 = ctx.T0;
  const at = (min: number) => ({ at: T0 + min * MIN });
  const trailName = (ctx.places.find((p) => p.kind === 'trailhead')?.name ?? 'Cosumnes Ridge Trailhead').toUpperCase();
  const ranchName = (ctx.places.find((p) => p.kind === 'ranch')?.name ?? 'Bear Hollow Ranch').toUpperCase();
  const gfName = ctx.primaryName.toUpperCase();
  return [
    {
      id: 'f-smoke',
      kind: 'smoke',
      label: 'PYROCUMULUS · COLUMN TOPS ~9 KM',
      detail: 'GOES-17 ABI band 7 + GIBS true color: deep convective column over the head, pyroCu capping. Expect long-range spotting downwind.',
      pos: destination(S.fireCenterT0, 20, 800),
      uncertaintyM: 1500,
      confidence: 0.9,
      poolId: 'pool-sat',
      source: 'satellite',
      sourceLabel: 'GOES-17 ABI',
      sourceTitle: 'GOES-17 fire/hot spot characterization frame',
      url: 'https://gibs.earthdata.nasa.gov',
      reveal: at(-50),
      halfLifeS: 2400,
      persistent: true,
      feedId: 'feed-sat',
      jobInput: 'GOES-17 ABI FDC frame · column detection',
      minutes: 6,
      counters: { satellitePasses: 1 },
    },
    {
      id: 'f-lake',
      kind: 'water',
      label: 'WATER SOURCE · JENKINSON LAKE (SLY PARK)',
      detail: 'Reservoir open to helicopter bucket dips; 25 min round trip for H-205 to the head. Source: El Dorado Irrigation District page + OSM water polygon.',
      pos: S.water,
      uncertaintyM: 300,
      confidence: 0.95,
      poolId: 'pool-extract',
      source: 'web',
      sourceLabel: 'Firecrawl',
      sourceTitle: 'Sly Park Recreation Area / Jenkinson Lake',
      url: 'https://www.eid.org',
      reveal: at(-45),
      halfLifeS: 1200,
      persistent: true,
      place: 'Jenkinson Lake',
      jobInput: 'Extract water sources near the incident · 2 pages',
      minutes: 6,
      counters: { articlesRead: 2 },
    },
    {
      id: 'f-brush',
      kind: 'fuel',
      label: `DRY BRUSH · SOUTH ASPECTS BELOW ${gfName}`,
      detail: 'LANDFIRE FBFM40 shrub and timber litter on 30-45% south-facing slopes; Prithvi burn-scar model shows no recent burn. 1-h fuel moisture estimated at 3%.',
      pos: S.brush,
      uncertaintyM: 450,
      confidence: 0.8,
      poolId: 'pool-sat',
      source: 'satellite',
      sourceLabel: 'NASA GIBS + LANDFIRE',
      sourceTitle: 'Fuel and aspect analysis',
      reveal: at(-30),
      halfLifeS: 2400,
      persistent: true,
      jobInput: 'Prithvi burn-scar + FBFM40 fuel scan · 6 tiles',
      minutes: 12,
      counters: { satellitePasses: 1 },
    },
    {
      id: 'f-structures',
      kind: 'structure',
      label: `${ctx.structuresPrimary} STRUCTURES · ${gfName}`,
      detail: `OpenStreetMap building footprints within 2.5 km of ${ctx.primaryName} (current snapshot). Residential, mostly wood-frame, single access road west.`,
      pos: S.primary,
      uncertaintyM: 900,
      confidence: 0.95,
      count: ctx.structuresPrimary,
      poolId: 'pool-extract',
      source: 'web',
      sourceLabel: 'OpenStreetMap',
      sourceTitle: `${ctx.primaryName} building inventory`,
      url: 'https://www.openstreetmap.org',
      reveal: at(-20),
      halfLifeS: 1200,
      persistent: true,
      place: ctx.primaryName,
      jobInput: `Structure inventory · ${ctx.primaryName}`,
      minutes: 15,
      counters: { articlesRead: 1 },
    },
    {
      id: 'f-school',
      kind: 'structure',
      label: `SCHOOL · ${gfName} (CLOSED, AFTER HOURS)`,
      detail: 'Elementary school campus. Summer schedule, no students on site; ball field usable as a temporary refuge area.',
      pos: S.refuge,
      uncertaintyM: 80,
      confidence: 0.9,
      poolId: 'pool-extract',
      source: 'web',
      sourceLabel: 'Firecrawl',
      sourceTitle: 'School district calendar',
      reveal: at(3),
      halfLifeS: 1200,
      persistent: true,
      place: ctx.primaryName,
      jobInput: 'Extract school / care facilities near the fire · 3 pages',
      minutes: 9,
      counters: { articlesRead: 3 },
    },
    {
      id: 'f-hikers',
      kind: 'human',
      label: `2 HIKERS · ${trailName}`,
      detail: 'Social clip posted 12 min ago shows two hikers on a ridge trail with the smoke column behind them. Location inferred from the trail sign and ridge line (approximate). People are fictional.',
      pos: S.hikersReported,
      truePos: S.hikers,
      uncertaintyM: 600,
      confidence: 0.55,
      count: 2,
      poolId: 'pool-social',
      source: 'social',
      sourceLabel: 'Social video',
      sourceTitle: '"Smoke getting close on the ridge trail" (public post)',
      reveal: at(20),
      halfLifeS: 900,
      confirmable: true,
      place: trailName,
      jobInput: 'Social clip · 0m 42s · geolocate + people count',
      minutes: 4,
      counters: { postsScreened: 1 },
      confirmDetail: 'two adults walking downhill on the trail, no visible injuries. Florence-2 labels: person x2 (0.93).',
    },
    {
      id: 'f-horses',
      kind: 'animal',
      label: `6 HORSES · ${ranchName}`,
      detail: 'Community post asks for trailers to move six horses; owner reports gate open and no trailer on site. Ranch is fictional.',
      pos: S.ranch,
      uncertaintyM: 250,
      confidence: 0.7,
      count: 6,
      poolId: 'pool-extract',
      source: 'web',
      sourceLabel: 'Firecrawl',
      sourceTitle: 'Large animal evacuation thread',
      reveal: at(34),
      halfLifeS: 1200,
      persistent: true,
      place: ranchName,
      jobInput: 'Extract large-animal requests · 2 posts',
      minutes: 6,
      counters: { articlesRead: 2 },
    },
    {
      id: 'f-barn',
      kind: 'structure',
      label: `BARN + HAY STORAGE · ${ranchName}`,
      detail: 'Barn with stacked hay on the north side of the ranch; heavy fuel load next to the paddock.',
      pos: destination(S.ranch, 20, 120),
      uncertaintyM: 120,
      confidence: 0.85,
      poolId: 'pool-extract',
      source: 'web',
      sourceLabel: 'OpenStreetMap',
      sourceTitle: 'Ranch structures',
      reveal: at(36),
      halfLifeS: 1200,
      persistent: true,
      place: ranchName,
      jobInput: 'Structure lookup · ranch parcel',
      minutes: 3,
      counters: { articlesRead: 1 },
    },
    {
      id: 'f-trailer',
      kind: 'vehicle',
      label: `HORSE TRAILER · ${ranchName} DRIVEWAY`,
      detail: 'Drone sweep frame: one stock trailer hitched to a pickup in the driveway, no movement.',
      pos: destination(S.ranch, 230, 140),
      uncertaintyM: 60,
      confidence: 0.75,
      poolId: 'pool-drone',
      source: 'drone-cam',
      sourceLabel: 'Drone sweep',
      sourceTitle: 'Coverage sweep frame',
      reveal: at(40),
      halfLifeS: 900,
      persistent: true,
      place: ranchName,
      jobInput: 'Sweep frames · vehicle detection',
      minutes: 2,
      counters: { imagesAnalyzed: 24 },
    },
    {
      id: 'f-spot',
      kind: 'spot',
      label: 'SPOT FIRE · ~700 M AHEAD OF THE HEAD',
      detail: 'Ridge camera: new smoke origin ahead of the main front, growing over three frames. Spot fire likely from the column.',
      pos: S.spotReported,
      truePos: S.spot,
      uncertaintyM: 300,
      confidence: 0.7,
      poolId: 'pool-fixed',
      source: 'fixed-cam',
      sourceLabel: 'Ridge camera',
      sourceTitle: 'Smoke origin detection',
      reveal: at(46),
      halfLifeS: 300,
      confirmable: true,
      feedId: 'feed-ridge-1',
      jobInput: 'Ridge cam frames · new smoke origin',
      minutes: 3,
      counters: { imagesAnalyzed: 12 },
      confirmDetail: 'IR shows an established spot fire, roughly 40 x 60 m, spreading upslope.',
    },
    {
      id: 'f-vehicles',
      kind: 'vehicle',
      label: `3 ABANDONED VEHICLES · ${ctx.names.vehiclesRoad.toUpperCase()}`,
      detail: 'Div A radio: three cars left on the shoulder, one partly blocking the lane. Possible choke point on the evacuation route.',
      pos: S.vehicles,
      uncertaintyM: 250,
      confidence: 0.6,
      count: 3,
      poolId: 'pool-radio',
      source: 'radio',
      sourceLabel: 'Div A tactical',
      sourceTitle: 'Radio transcript',
      reveal: at(66),
      halfLifeS: 900,
      jobInput: 'Div A tactical · 1m 10s audio · entity extraction',
      minutes: 3,
      counters: { radioMinutesTranscribed: 1.2 },
    },
    {
      id: 'f-propane',
      kind: 'combustible',
      label: `2 PROPANE TANKS · RESIDENCE ON ${ctx.names.propaneRoad.toUpperCase()}`,
      detail: 'E-41 dash cam: two residential propane tanks (~500 gal) about 20 m from a house, brush within 10 m. Grounding DINO: "propane tank" 0.91.',
      pos: S.propane,
      uncertaintyM: 20,
      confidence: 0.9,
      count: 2,
      poolId: 'pool-ground',
      source: 'ground-cam',
      sourceLabel: 'E-41 dash cam',
      sourceTitle: 'Dash cam detection',
      reveal: { unitId: 'e-41', radiusM: 260, fallbackAt: T0 + 101 * MIN, notBefore: T0 + 95 * MIN },
      halfLifeS: 300,
      feedId: 'feed-e-41',
      jobInput: 'E-41 dash cam · 0m 30s · hazard detection',
      minutes: 2,
      counters: { footageReviewedS: 30 },
    },
    {
      id: 'f-powerline',
      kind: 'road-block',
      label: `DOWNED POWER LINE · ${ctx.names.powerlineRoad.toUpperCase()}`,
      detail: 'Drone sweep: line across the road near a pole, arcing not visible. Road impassable until PG&E clears it.',
      pos: S.powerline,
      uncertaintyM: 80,
      confidence: 0.8,
      poolId: 'pool-drone',
      source: 'drone-cam',
      sourceLabel: 'Drone sweep',
      sourceTitle: 'Coverage sweep frame',
      reveal: at(112),
      halfLifeS: 600,
      jobInput: 'Sweep frames · road obstruction detection',
      minutes: 2,
      counters: { imagesAnalyzed: 18 },
    },
  ];
}

function units(ctx: ScenarioContext): UnitSpec[] {
  const S = ctx.sites;
  const gf = S.primary;
  const road = (g: Geo): Geo => ctx.nearestRoadPoint(g, 1500) ?? g;
  const divA = [gf, destination(gf, 180, 1500), destination(gf, 215, 2300), destination(gf, 120, 1100), destination(gf, 260, 1600)].map(road);
  const divZ = [destination(gf, 250, 4200), destination(gf, 230, 5200), destination(gf, 275, 3600)].map(road);
  const crew7 = destination(gf, 190, 1200);
  const crew12 = destination(gf, 240, 3300);
  const specs: UnitSpec[] = [];
  for (let i = 1; i <= 6; i++) specs.push({ id: `hawk-${i}`, callsign: `HAWK-${i}`, kind: 'drone', division: 'AIR', pos: destination(gf, 150 + i * 22, 2000 + i * 250), alt: 120 });
  specs.push(
    { id: 'e-41', callsign: 'E-41', kind: 'engine', division: 'A', pos: road(destination(gf, 200, 1800)), patrol: divA },
    { id: 'e-42', callsign: 'E-42', kind: 'engine', division: 'A', pos: road(gf), patrol: divA },
    { id: 'e-37', callsign: 'E-37', kind: 'engine', division: 'Z', pos: divZ[0], patrol: divZ },
    { id: 'dz-2', callsign: 'DZ-2', kind: 'dozer', division: 'A', pos: road(destination(gf, 220, 2500)), patrol: [destination(gf, 220, 2500), destination(gf, 200, 3000), destination(gf, 240, 2200)].map(road) },
    { id: 'crew-7', callsign: 'CREW-7', kind: 'crew', division: 'A', pos: crew7, plan: { mode: 'wander', anchor: crew7, radiusM: 220, target: crew7 }, helmetCam: true },
    { id: 'crew-12', callsign: 'CREW-12', kind: 'crew', division: 'Z', pos: crew12, plan: { mode: 'wander', anchor: crew12, radiusM: 220, target: crew12 } },
    { id: 'm-12', callsign: 'M-12', kind: 'ems', division: 'EMS', pos: S.staging },
    { id: 'm-14', callsign: 'M-14', kind: 'ems', division: 'EMS', pos: road(S.slyPark) },
    { id: 'so-5', callsign: 'SO-5', kind: 'law', pos: road(destination(gf, 300, 1200)), patrol: [gf, destination(gf, 300, 2800), destination(gf, 20, 1500)].map(road) },
    { id: 'h-205', callsign: 'H-205', kind: 'helo', division: 'AIR', pos: S.water, alt: 250, plan: { mode: 'circuit', pts: [S.water, S.fireCenterT0], i: 1 } },
    { id: 't-88', callsign: 'T-88', kind: 'tanker', division: 'AIR', pos: destination(S.fireCenterT0, 0, 4000), alt: 650, plan: { mode: 'orbit', center: S.fireCenterT0, radiusM: 4000, ang: 0 } },
  );
  return specs;
}

function beats(ctx: ScenarioContext): BeatDef[] {
  const T0 = ctx.T0;
  const acres = ctx.areaText(T0);
  const a = Math.round(ctx.shiftFrom.windDirDeg);
  const b = Math.round(ctx.shiftTo.windDirDeg);
  const road = ctx.names.propaneRoad;
  return [
    {
      id: 'calm',
      at: 0,
      title: 'Calm monitoring',
      caption: `${ctx.fmtTime(T0)}, ${ctx.fmtDate(T0)}. The Caldor Fire is about ${acres}. Six drones sweep the front while agent pools read web, social, camera, satellite, weather and radio sources. The ledger counts the analyst time the swarm saves.`,
      speed: 30,
      enter: (h) => {
        ops.setAutonomy(h.sim, 'assist');
        ops.setLens(h.sim, 'ic');
        ops.setHoldLayout(h.sim, false);
      },
    },
    {
      id: 'hikers',
      at: 20,
      title: 'Two hikers in the fire path',
      caption:
        'A public social clip shows two hikers on a ridge trail. The vision agent flags them with an approximate, fading ring. In Act mode the Orchestrator retasks HAWK-3 (low risk, undoable), promotes its feed, and once the people are confirmed live raises the only Z0 interrupt and drafts a rescue for EMS.',
      speed: 30,
      anchor: T0 + 18.5 * MIN,
      enter: (h) => ops.setAutonomy(h.sim, 'act'),
    },
    {
      id: 'windshift',
      at: 60,
      title: 'Wind shift and re-projection',
      caption: `The archived evening wind shift (${ctx.script.weatherSource}, ${a}° to ${b}°) reaches the Projection agent. Archived future weather stands in for a perfect forecast. The old bands stay as a ghost. Prototype policy drafts a WARNING below ${WARNING_MIN / 60} hours and an ORDER plus a structure-group move below ${ORDER_MIN / 60} hours to ${ctx.primaryName}. High-risk drafts wait for your approval click, even in this tour.`,
      speed: 10,
      anchor: T0 + 59 * MIN,
      enter: (h) => {
        ackInterrupts(h.sim);
        remindKinds(h.sim, ['rescue']);
      },
      watch: (h, s, _once, mark) => {
        remindAfter(h.sim, s, mark, (act) => act.kind === 'evac-notice' ? 6 : act.kind === 'move-group' ? 8 : -1);
      },
    },
    {
      id: 'propane',
      at: 100,
      title: 'Propane tanks, nearby units only',
      caption: `E-41's dash cam spots two propane tanks next to a house on ${road}. The hazard goes only to the units within 1.5 km instead of interrupting everyone. Switching the role lens to OPS re-ranks hazards and movements.`,
      speed: 10,
      anchor: T0 + 97 * MIN,
      enter: (h) => {
        const sim = h.sim;
        ackInterrupts(sim);
        remindKinds(sim, ['evac-notice', 'move-group', 'rescue']);
        const e41 = unitById(sim, 'e-41');
        if (e41 && !sim.revealed.has('f-propane')) sendTo(sim, 'e-41', sim.ctx.sites.propaneRoad, { road: true, after: 'hold', arriveBy: sim.t + 3 * MIN });
      },
      watch: (h, s, once, mark) => {
        const sim = h.sim;
        const u = unitById(sim, 'e-41');
        const m = sim.umeta.get('e-41');
        if (u && m && m.plan.mode === 'hold' && distanceM(u.pos, sim.ctx.sites.propane) < 400 && once('e41-face')) u.heading = bearingDeg(u.pos, sim.ctx.sites.propane);
        remindAfter(sim, s, mark, (a) => (a.kind === 'evac-notice' ? 6 : a.kind === 'move-group' ? 8 : a.kind === 'resource-order' ? 10 : -1));
        if (s >= 14 && once('lens-ops')) {
          ops.setLens(sim, 'ops');
          say(sim, 'Role lens set to OPS: hazards and movements are weighted ×1.2, so the propane hazard and the structure group move up.');
        }
      },
    },
    {
      id: 'question',
      at: 130,
      title: 'Ask the Orchestrator',
      caption: 'The IC asks a plain question. The answer is assembled from the bus events of the last ten scenario minutes, with links to the items it mentions. Prediction checks compare earlier projections with what the fire actually did.',
      speed: 10,
      enter: (h) => ackInterrupts(h.sim),
      watch: (h, s, once) => {
        if (s >= 1.5 && once('ask')) ops.ask(h.sim, DEMO_QUESTION);
      },
    },
    {
      id: 'summary',
      at: 160,
      title: 'Agent work ledger',
      caption: 'In about three minutes the swarm did hours of analyst work: footage reviewed, posts screened, projections run and scored, drafts written. Scenario built from public data; units, people and events are simulated.',
      speed: 10,
      watch: (h, s, once) => {
        if (s >= DEMO_LENGTH_S - 160 && once('end')) h.sim.paused = true;
      },
    },
  ];
}

export const caldor: ScenarioScript = {
  id: 'caldor-2021',
  incident: 'Caldor Fire',
  seed: 20210816,
  tzOffsetMin: -420,
  areaUnit: 'acres',
  primary: { match: /^grizzly[- ]flats?$/i, fallback: { id: 'grizzly-flats', name: 'Grizzly Flats', pos: { lon: -120.52742, lat: 38.63629 }, kind: 'town' } },
  timeline: ({ start, tPrimary }) => {
    const T0 = Math.max(start, tPrimary - 150 * MIN);
    return { T0, tShift: T0 + 60 * MIN, tDetect: start };
  },
  sites: (h) => {
    const gf = h.primary.pos;
    const { T0, tPrimary } = h;
    const trailhead = h.find(/trailhead|cosumnes-ridge/i)?.pos ?? destination(gf, 165, 2900);
    const hikers = h.pickCell(trailhead, 1400, T0 + 75 * MIN, T0 + 105 * MIN);
    const spot = h.pickCell(destination(gf, 200, 2000), 2600, T0 + 70 * MIN, T0 + 90 * MIN, (g) => distanceM(g, hikers) < 900);
    const ranch = h.places.find((p) => p.kind === 'ranch')?.pos ?? destination(gf, 70, 3600);
    const lakeWater = h.pack.water.find((w) => /jenkinson/i.test(w.name ?? ''));
    const lake = lakeWater ? lakeWater.polygon.reduce((a, p, _i, arr) => ({ lon: a.lon + p.lon / arr.length, lat: a.lat + p.lat / arr.length }), { lon: 0, lat: 0 }) : h.find(/jenkinson/i)?.pos ?? { lon: -120.553, lat: 38.7245 };
    let propane: Geo | null = null;
    {
      const target = destination(gf, 170, 500);
      let bd = Infinity;
      for (const b of h.pack.buildings) {
        if (distanceM(b.pos, gf) > 1600) continue;
        const a = h.arrivalNear(b.pos, 0);
        if (a < tPrimary - 10 * MIN || a > tPrimary + 45 * MIN) continue;
        const d = distanceM(b.pos, target);
        if (d < bd) {
          bd = d;
          propane = { lon: b.pos.lon, lat: b.pos.lat };
        }
      }
    }
    const propaneP = propane ?? h.pickCell(destination(gf, 170, 500), 1500, tPrimary - 10 * MIN, tPrimary + 45 * MIN);
    const vehT = destination(gf, 290, 1400);
    const plT = destination(gf, 30, 1800);
    const stT = destination(gf, 330, 900);
    return {
      staging: h.nearestRoadPoint(stT, 1200) ?? stT,
      refuge: destination(gf, 20, 300),
      water: lake,
      trailhead,
      ranch,
      hikers,
      hikersReported: destination(hikers, 300, 220),
      spot,
      spotReported: destination(spot, 60, 140),
      propane: propaneP,
      propaneRoad: h.nearestRoadPoint(propaneP, 500) ?? propaneP,
      vehicles: h.nearestRoadPoint(vehT, 2500, /grizzly flat/i) ?? h.nearestRoadPoint(vehT, 1500) ?? vehT,
      powerline: h.nearestRoadPoint(plT, 2500, /sciaroni|shingle mill/i) ?? h.nearestRoadPoint(plT, 1500) ?? plT,
      brush: h.pickCell(destination(gf, 210, 1600), 2500, tPrimary - 60 * MIN, tPrimary + 60 * MIN),
      pollock: h.find(/pollock/i)?.pos ?? { lon: -120.5866, lat: 38.7613 },
      slyPark: h.find(/^sly[- ]park$/i)?.pos ?? { lon: -120.5846, lat: 38.7213 },
    };
  },
  names: (h, s) => ({
    propaneRoad: h.roadNamesNear(s.propane, 300)[0] ?? 'Grizzly Flat Road',
    vehiclesRoad: h.roadNamesNear(s.vehicles, 60)[0] ?? 'Grizzly Flat Road',
    powerlineRoad: h.roadNamesNear(s.powerline, 60)[0] ?? 'Sciaroni Road',
  }),
  cams: (h) => {
    const gf = h.primary.pos;
    return h.highPoints(gf, [[300, 40], [60, 150]], 3000, 14000).map((b, k) => {
      const pl = h.nearestPlace(b.pos);
      return { id: `ridge-${k + 1}`, name: `RIDGE CAM ${k + 1} · ${pl.name.toUpperCase()} ${Math.round(b.elev > 0 ? b.elev : 0)} M`, pos: b.pos };
    });
  },
  units,
  catalog,
  beats,
  plans: {
    preferDroneId: 'hawk-3',
    evac: {
      orderMin: ORDER_MIN,
      warningMin: WARNING_MIN,
      title: (type, ctx) => `Evacuation ${type} · Zone ${ZONE} (${ctx.primaryName})`,
      summary: (type, m, rev, ctx) => `Head projected to reach ${ctx.primaryName} in ${Math.round(m)} min (rev ${rev}).${type === 'ORDER' ? ` ${ctx.structuresPrimary} structures; one road out.` : ''}`,
      unitIds: ['so-5'],
      trafficUnitId: 'so-5',
      draft: evacDraft,
      doneText: (title) => `${title} is out to the public alert channel and law enforcement (simulated). SO-5 is moving to traffic control.`,
    },
    moveGroup: {
      unitIds: ['e-42', 'crew-7', 'dz-2'],
      target: (ctx) => ctx.sites.refuge,
      safetyLabel: 'SZ-1 · school ball field',
      title: (ctx) => `Move structure group → ${ctx.primaryName}`,
      draft: moveDraft,
    },
    resource: {
      title: 'Resource order · 2 Type 1 engines + 1 VLAT',
      summary: (sim) => `Structure group alone cannot cover ${sim.ctx.structuresPrimary} structures; a VLAT line ahead of the head buys time.`,
      draft: resourceDraft,
      doneText: 'Resource order transmitted to the ordering manager (simulated): 2 Type 1 engines and 1 VLAT.',
    },
    rescue: {
      unitIds: ['m-12'],
      kinds: ['ems'],
      title: (f, place) => `Rescue · ${f.count ?? 2} hikers near ${place}`,
      summary: (u, d, eta) => `${u.callsign} to the trailhead with ${d?.callsign ?? 'drone'} overwatch. Fire ETA about ${Math.round(eta)} min at their position.`,
      safety: (ctx) => ({ center: ctx.sites.staging, radiusM: 150, label: `${ctx.primaryName} staging` }),
      draft: rescueDraft,
      doneLabel: (f, u) => `${f.count ?? 2} HIKERS · SAFE WITH EMS ${u.callsign}`,
      doneDetail: (_f, u, at) => `${u.callsign} reached the hikers at ${at}; both ambulatory, walked out to the ambulance. Simulated.`,
      doneSay: (_f, u, released) => `${u.callsign} has the hikers. Both are walking out with the crew; ${released}`,
      returnTo: (ctx) => ctx.sites.staging,
    },
    hazard: { title: 'Radio script · Div A propane hazard', transmitted: 'Div A hazard advisory transmitted', draft: radioDraft },
  },
  satellite: { feedLabel: 'GOES-17 · ABI FIRE/HOT SPOT (5 MIN)', frame: 'GOES-17 ABI FDC frame', done: 'processed a GOES-17 fire frame' },
  queries: ['Caldor Fire Grizzly Flats', 'Caldor Fire evacuation El Dorado County', 'CAL FIRE incident update Caldor', 'Caldor Fire road closures', 'Grizzly Flats fire', 'El Dorado County OES alerts'],
  socialTag: '#CaldorFire',
  radioChannels: ['Div Z tactical', 'Div A tactical', 'Air-to-ground'],
  weatherSource: 'Open-Meteo archive',
  sitrep: { title: 'ICS-209 sitrep', header: 'ICS-209 incident status summary' },
  redFlag: 'NWS Sacramento red flag criteria met (Open-Meteo archive + NWS alerts).',
  intro: (sim) =>
    `Monitoring the Caldor Fire replay from ${sim.ctx.fmtTime(sim.t)} ${sim.ctx.fmtDate(sim.t)}: ${sim.ctx.areaText(sim.t)}. ${sim.units.filter((u) => u.kind === 'drone').length} drones are sweeping the front and ${sim.pools.length} agent pools are ingesting web, social, camera, satellite, weather and radio sources. I will interrupt only for life safety or imminent hazards.`,
};
