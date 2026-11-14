import type { FindingKind, Geo, Ms, SourceKind } from '../contracts';
import type { ScenarioContext } from '../world/context';
import type { LedgerCounters } from '../world/sim';
import { MIN, destination } from '../world/geo';

export interface FindingSpec {
  id: string;
  kind: FindingKind;
  label: string;
  detail: string;
  /** Reported position (may be approximate). */
  pos: Geo;
  /** Ground truth used by cameras; defaults to pos. */
  truePos?: Geo;
  uncertaintyM: number;
  confidence: number;
  count?: number;
  poolId: string;
  source: SourceKind;
  sourceLabel: string;
  sourceTitle: string;
  url?: string;
  /** Unit-proximity reveals only fire after `notBefore` (keeps scripted beats in order). */
  reveal: { at: Ms } | { unitId: string; radiusM: number; fallbackAt: Ms; notBefore?: Ms };
  halfLifeS: number;
  persistent?: boolean;
  confirmable?: boolean;
  place?: string;
  /** Feed the detection came from (bbox drawn in its frame). */
  feedId?: string;
  jobInput: string;
  minutes: number;
  counters?: Partial<LedgerCounters>;
  confirmDetail?: string;
}

/**
 * Scripted intel for the Caldor replay (positions derived from the real pack). People and animals are
 * fictional; the trailhead and ranch are fictional places flagged in the manifest.
 */
export function buildCatalog(ctx: ScenarioContext): FindingSpec[] {
  const S = ctx.sites;
  const T0 = ctx.T0;
  const at = (min: number) => ({ at: T0 + min * MIN });
  const trailName = (ctx.places.find((p) => p.kind === 'trailhead')?.name ?? 'Cosumnes Ridge Trailhead').toUpperCase();
  const ranchName = (ctx.places.find((p) => p.kind === 'ranch')?.name ?? 'Bear Hollow Ranch').toUpperCase();
  const gfName = ctx.gfName.toUpperCase();
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
      pos: S.lake,
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
      label: `${ctx.structuresGF} STRUCTURES · ${gfName}`,
      detail: `OpenStreetMap building footprints within 2.5 km of ${ctx.gfName} (current snapshot). Residential, mostly wood-frame, single access road west.`,
      pos: S.gf,
      uncertaintyM: 900,
      confidence: 0.95,
      count: ctx.structuresGF,
      poolId: 'pool-extract',
      source: 'web',
      sourceLabel: 'OpenStreetMap',
      sourceTitle: `${ctx.gfName} building inventory`,
      url: 'https://www.openstreetmap.org',
      reveal: at(-20),
      halfLifeS: 1200,
      persistent: true,
      place: ctx.gfName,
      jobInput: `Structure inventory · ${ctx.gfName}`,
      minutes: 15,
      counters: { articlesRead: 1 },
    },
    {
      id: 'f-school',
      kind: 'structure',
      label: `SCHOOL · ${gfName} (CLOSED, AFTER HOURS)`,
      detail: 'Elementary school campus. Summer schedule, no students on site; ball field usable as a temporary refuge area.',
      pos: S.school,
      uncertaintyM: 80,
      confidence: 0.9,
      poolId: 'pool-extract',
      source: 'web',
      sourceLabel: 'Firecrawl',
      sourceTitle: 'School district calendar',
      reveal: at(3),
      halfLifeS: 1200,
      persistent: true,
      place: ctx.gfName,
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
      label: `3 ABANDONED VEHICLES · ${S.vehiclesRoadName.toUpperCase()}`,
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
      label: `2 PROPANE TANKS · RESIDENCE ON ${S.propaneRoadName.toUpperCase()}`,
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
      label: `DOWNED POWER LINE · ${S.powerlineRoadName.toUpperCase()}`,
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
