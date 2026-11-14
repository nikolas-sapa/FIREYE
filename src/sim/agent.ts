/**
 * Mock AI agent. A scripted-but-reactive generator of intelligence: ingests
 * (video, imagery, news, sensors, radio, satellite) move through
 * queued -> analyzing -> processed, then derive markers, insights and
 * recommendations. Reactive rules watch the fire and raise alerts / proposals.
 */
import { CELL_M, Fuel, type IngestItem, type IngestType, type Insight, type Marker, type Recommendation, type SimSnapshot, type Unit, type Vec, type WorldMeta } from './types';
import { gridRef } from './terrain';
import { pointInPolygon } from './forecast';

export type RecTaskKind = 'retardant-line' | 'water' | 'protect' | 'extract' | 'reposition' | 'scan';
export interface RecTask { kind: RecTaskKind; key: string; markerId?: string }

export interface FireStats {
  head: Vec;
  centroid: Vec;
  burning: number;
  acres: number;
  rosMpm: number;
  radius: number;
}

/** What the agent needs from the engine. */
export interface AgentHost {
  readonly state: SimSnapshot;
  readonly world: WorldMeta;
  rand(): number;
  nextId(prefix: string): string;
  fire(): FireStats;
  /** Distance (cells) from p to the nearest burning cell; Infinity when none. */
  fireDistance(p: Vec): number;
  findCell(near: Vec, radius: number, pred: (i: number) => boolean): Vec | null;
  ignite(p: Vec): boolean;
  setWind(dirDeg: number, speedKph: number): void;
  setRedFlag(on: boolean): void;
  setHumidity(pct: number): void;
  requestForecast(reason: 'intel' | 'wind' | 'periodic'): void;
  readonly lastForecastReason: 'intel' | 'wind' | 'periodic' | 'init';
  addIngest(item: IngestItem): void;
  replaceIngest(item: IngestItem): void;
  addMarker(m: Marker, persons?: number): void;
  updateMarker(id: string, patch: Partial<Marker>, persons?: number): void;
  addInsight(i: Omit<Insight, 'id' | 'at'>): Insight;
  addRecommendation(r: Omit<Recommendation, 'id' | 'at' | 'status'>, task: RecTask): Recommendation | null;
  /** True when a pending or accepted (not yet completed) rec with this key exists. */
  hasRec(key: string): boolean;
  unit(id: string): Unit | undefined;
  etaMin(unitIds: string[], target: Vec): number;
  structuresIn(poly: Vec[]): number;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass16 = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
const km = (cells: number) => ((cells * CELL_M) / 1000).toFixed(1);
const ac = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(0));
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

interface ScriptEvent {
  at: number;
  type: IngestType;
  source: string | ((h: AgentHost) => string);
  title: string | ((h: AgentHost) => string);
  summary: string | ((h: AgentHost) => string);
  tags: string[];
  done?: (h: AgentHost, item: IngestItem) => void;
}

interface Pending { item: IngestItem; analyzeAt: number; doneAt: number; done?: (h: AgentHost, item: IngestItem) => void }

/** A point between the fire head and the town, `f` of the way toward town. */
function between(h: AgentHost, f: number): Vec {
  const head = h.fire().head;
  const t = h.world.town;
  const tgt = { x: t.x0 + 1, y: t.y1 - 1 };
  return { x: head.x + (tgt.x - head.x) * f, y: head.y + (tgt.y - head.y) * f };
}

function downwind(h: AgentHost, from: Vec, cells: number): Vec {
  const to = ((h.state.wind.dirDeg + 180) * Math.PI) / 180;
  return { x: from.x + Math.sin(to) * cells, y: from.y - Math.cos(to) * cells };
}

const SCRIPT: ScriptEvent[] = [
  {
    at: 150, type: 'radio', source: 'CMD NET', tags: ['CMD NET', 'INITIAL'],
    title: 'Initial report · smoke column vic. FS 12N',
    summary: 'ECC relays multiple 911 callers reporting a dark column west of FS 12N, south of the Bear Creek bench.',
    done: (h) => h.addInsight({
      kind: 'status', confidence: 0.6, title: 'Incident opened · HOLLOW FIRE',
      body: `Watch started. Ignition fixed at GRID ${gridRef(h.world.ignition)} from caller triangulation. Awaiting orbital and aerial confirmation.`,
    }),
  },
  {
    at: 330, type: 'satellite', source: 'GOES-18 ABI', tags: ['GOES-18', 'FDC', 'HOTSPOT'],
    title: 'FDC hotspot · FRP 38 MW',
    summary: 'Fire Detection & Characterization pixel flagged 2 km east of Bear Creek. 3.9 µm channel near saturation.',
    done: (h, it) => h.addInsight({
      kind: 'analysis', confidence: 0.78, refs: [it.id], title: 'Orbital confirmation of ignition',
      body: `GOES-18 FDC pixel agrees with the caller fix within 380 m. Radiative power is consistent with a grass/brush head fire at GRID ${gridRef(h.world.ignition)}.`,
    }),
  },
  {
    at: 450, type: 'radio', source: 'E-41 · CMD NET', tags: ['E-41', 'SIZE-UP'],
    title: 'E-41 on scene · anchoring at HWY 49',
    summary: (h) => `"Approx ${ac(h.fire().acres)} acres, rapid rate of spread in grass, wind out of the WSW. Anchoring heel at HWY 49, requesting air attack."`,
    done: (h, it) => h.addInsight({
      kind: 'status', confidence: 0.9, refs: [it.id], title: 'First resource on scene',
      body: 'E-41 anchored at the heel on HWY 49. Air attack requested; HAWK-1 and HAWK-2 launched from Helibase.',
    }),
  },
  {
    at: 560, type: 'video', source: 'HAWK-1 EO/IR', tags: ['HAWK-1', 'EO/IR', 'PERIMETER'],
    title: 'Size-up orbit · 4K EO + LWIR · 92 s',
    summary: '360° orbit at 120 m AGL over the head. Plume leaning ENE, flame lengths 2–4 m at the head.',
    done: (h, it) => {
      const f = h.fire();
      const p = h.findCell(downwind(h, f.head, 22), 14, (i) => h.state.grid.fuel[i] === Fuel.Brush && h.state.grid.dryness[i] > 0.62);
      const derived: string[] = [];
      if (p) {
        const dry = Math.round(h.state.grid.dryness[Math.floor(p.y) * h.state.grid.w + Math.floor(p.x)] * 100);
        const id = h.nextId('mk');
        h.addMarker({ id, kind: 'fuel', pos: p, label: `DRY CHAPARRAL · ${dry}%`, severity: 'high', confidence: 0.81, sourceId: it.id, detectedAt: h.state.t,
          detail: `Continuous chamise/manzanita bed downwind of the head, dryness index ${dry}%. Expect a run when the head arrives.` });
        derived.push(id);
      }
      it.derived = derived;
      h.addInsight({
        kind: 'analysis', confidence: 0.84, refs: [it.id, ...derived], title: 'Head running ENE into brush',
        body: `Perimeter extracted from HAWK-1 orbit: ${ac(f.acres)} ac, head at GRID ${gridRef(f.head)} moving ${compass16(h.state.wind.dirDeg + 180)} at ~${Math.round(f.rosMpm)} m/min. Continuous dry chaparral ahead${p ? ` at GRID ${gridRef(p)}` : ''}.`,
      });
    },
  },
  {
    at: 650, type: 'radio', source: 'ATGS · AIR NET', tags: ['AIR ATTACK', 'T-910'],
    title: 'Air attack: T-910 loaded, H-2 on bucket',
    summary: 'ATGS reports T-910 loaded with 3,000 gal Phos-Chek at Air Attack Base. H-2 cycling Cedar Reservoir.',
    done: (h, it) => {
      const tgt = between(h, 0.45);
      h.addRecommendation({
        title: 'Commit T-910: retardant line SW of Pine Hollow', priority: 'P1', unitIds: ['t-910'], target: tgt,
        etaMin: h.etaMin(['t-910'], tgt), impact: '-22% spread toward Pine Hollow',
        rationale: `Head is aligned with the town on the current WSW wind. A 800 m line across GRID ${gridRef(tgt)} intercepts the run before it reaches the trail corridor.`,
      }, { kind: 'retardant-line', key: 'tanker-line' });
      const ridge = h.world.roads.find((r) => r.id === 'ridge')!.points;
      const anchor = ridge.reduce((best, p) => (dist(p, tgt) < dist(best, tgt) ? p : best), ridge[0]);
      h.addRecommendation({
        title: 'Reposition E-41 to Ridge Rd anchor point', priority: 'P2', unitIds: ['e-41'], target: anchor,
        etaMin: h.etaMin(['e-41'], anchor), impact: 'Secures right flank; +6% containment',
        rationale: `Heel is holding on HWY 49. Moving E-41 to GRID ${gridRef(anchor)} gives a road anchor for the line between the head and Pine Hollow.`,
      }, { kind: 'reposition', key: 'e41-ridge' });
      it.derived = [];
    },
  },
  {
    at: 760, type: 'sensor', source: 'PINE HOLLOW RAWS', tags: ['RAWS', 'WIND', 'RH'],
    title: (h) => `Wind ${compass16(h.state.wind.dirDeg)} ${Math.round(h.state.wind.speedKph)} kph G ${Math.round(h.state.wind.gustKph)} · RH ${Math.round(h.state.weather.humidityPct)}%`,
    summary: 'Remote automated weather station, 10-minute average. Fuel moisture 10-h at 4%.',
    done: (h) => h.requestForecast('intel'),
  },
  {
    at: 840, type: 'image', source: 'HAWK-2 LWIR', tags: ['HAWK-2', 'LWIR', 'PERSONS'],
    title: 'Thermal still · Hollow Trailhead lot',
    summary: 'Two warm signatures beside one vehicle at the trailhead lot. Imaged at 140 m AGL, 640×512 LWIR.',
    done: (h, it) => {
      const id = 'mk-trailhead';
      const p = { x: h.world.trailhead.x + 0.6, y: h.world.trailhead.y - 0.4 };
      h.addMarker({ id, kind: 'human', pos: p, label: '2 PERSONS · TRAILHEAD', severity: 'critical', confidence: 0.87, sourceId: it.id, detectedAt: h.state.t,
        detail: 'Two adults with one vehicle at the Hollow Trailhead lot, directly in the projected path of the head.' }, 2);
      it.derived = [id];
      const d = h.fireDistance(p);
      h.addInsight({
        kind: 'alert', confidence: 0.87, refs: [it.id, id], title: 'Persons detected in fire path',
        body: `HAWK-2 LWIR: 2 persons at Hollow Trailhead (GRID ${gridRef(p)}), ${km(d)} km ahead of the front. Trail egress toward Pine Hollow crosses the projected +3H band.`,
      });
      h.addRecommendation({
        title: 'H-2 extract 2 persons at Hollow Trailhead', priority: 'P1', unitIds: ['h-2'], target: p,
        etaMin: h.etaMin(['h-2'], p), impact: '-2 persons at risk',
        rationale: 'Ground egress is uphill through dry chaparral toward the head. Hoist extraction is faster and keeps the trail clear for crews.',
      }, { kind: 'extract', key: `extract-${id}`, markerId: id });
    },
  },
  {
    at: 1150, type: 'news', source: 'NWS SACRAMENTO', tags: ['NWS', 'RED FLAG'],
    title: 'Red Flag Warning in effect until 2000 PDT',
    summary: 'Gusty WSW winds 25–40 kph with RH 8–14% across the western slope. Any new starts will spread rapidly.',
    done: (h, it) => {
      h.setRedFlag(true);
      h.addInsight({
        kind: 'alert', confidence: 0.95, refs: [it.id], title: 'Red Flag Warning active',
        body: 'NWS Red Flag through 2000 PDT. Spread model adjusted: +12% head ROS, spotting distance up to 400 m. Forecast revised.',
      });
      h.requestForecast('intel');
    },
  },
  {
    at: 1450, type: 'image', source: 'HAWK-3 MSI', tags: ['HAWK-3', 'MULTISPECTRAL', 'FUEL'],
    title: 'Fuel bed classification pass · trail corridor',
    summary: 'Multispectral strip along Hollow Trail. NDVI and SWIR indicate cured chaparral with dead fuel load > 30%.',
    done: (h, it) => {
      const trail = h.world.roads.find((r) => r.id === 'trail')!.points;
      const near = trail[Math.floor(trail.length * 0.55)];
      const p = h.findCell(near, 10, (i) => h.state.grid.fuel[i] === Fuel.Brush && h.state.grid.dryness[i] > 0.6 && h.state.grid.state[i] === 0);
      if (!p) return;
      const id = h.nextId('mk');
      h.addMarker({ id, kind: 'fuel', pos: p, label: 'CURED BRUSH · TRAIL', severity: 'high', confidence: 0.76, sourceId: it.id, detectedAt: h.state.t,
        detail: 'Cured chaparral with high dead fuel load along Hollow Trail. Likely ember receptor for spot fires.' });
      it.derived = [id];
      h.addInsight({
        kind: 'analysis', confidence: 0.76, refs: [it.id, id], title: 'High-receptivity fuel on trail corridor',
        body: `HAWK-3 multispectral: cured brush at GRID ${gridRef(p)} with >30% dead load. Treat as a spot-fire receptor; forecast weights updated.`,
      });
      h.requestForecast('intel');
    },
  },
  {
    at: 1750, type: 'news', source: 'KCRA 3 NEWS', tags: ['NEWS', 'EVACUATION'],
    title: 'KCRA 3: Evacuation warning issued for Pine Hollow',
    summary: 'County OES issued an evacuation warning for Pine Hollow and Ridge Rd. Shelter at Cedar Valley High School.',
    done: (h, it) => {
      const t = h.world.town;
      const id = 'mk-town';
      const p = { x: t.x0 + 1.5, y: t.y1 - 1.5 };
      const n = h.world.buildings.filter((b) => b.x >= t.x0 && b.x <= t.x1 && b.y >= t.y0 && b.y <= t.y1).length;
      h.addMarker({ id, kind: 'structure', pos: p, label: `PINE HOLLOW · ${n} STRUCT`, severity: 'high', confidence: 0.98, sourceId: it.id, detectedAt: h.state.t,
        detail: `${n} structures in Pine Hollow. SW edge is the first exposure on the current wind.` });
      it.derived = [id];
      h.addInsight({
        kind: 'status', confidence: 0.92, refs: [it.id, id], title: 'Evacuation warning · Pine Hollow',
        body: `County OES warning confirmed via KCRA 3. ${n} structures in town; SW edge (GRID ${gridRef(p)}) is first exposure. Structure protection proposed.`,
      });
      const tgt = { x: t.x0 - 1, y: t.y1 - 2 };
      h.addRecommendation({
        title: 'Structure protection: E-17, E-22, DZ-1 to Pine Hollow SW edge', priority: 'P1', unitIds: ['e-17', 'e-22', 'dz-1'], target: tgt,
        etaMin: h.etaMin(['e-17', 'e-22', 'dz-1'], tgt), impact: `Protects ${n} structures; -30% ember exposure`,
        rationale: 'Town sits inside the +6H band. Prepping a dozer line and wet line on the SW edge now preserves options before the head arrives.',
      }, { kind: 'protect', key: 'protect-town' });
    },
  },
  {
    at: 2050, type: 'video', source: 'HAWK-2 EO/IR', tags: ['HAWK-2', 'SPOT FIRE'],
    title: 'Spot fire ahead of main front · 38 s',
    summary: 'New smoke and IR signature ~400 m downwind of the head. Approx. 0.2 acres and growing.',
    done: (h, it) => {
      const f = h.fire();
      const base = downwind(h, f.head, 9 + h.rand() * 3);
      const p = h.findCell(base, 6, (i) => h.state.grid.state[i] === 0 && (h.state.grid.fuel[i] === Fuel.Brush || h.state.grid.fuel[i] === Fuel.Grass));
      if (!p) return;
      h.ignite(p);
      h.ignite({ x: p.x + 1, y: p.y });
      const id = h.nextId('mk');
      h.addMarker({ id, kind: 'spot', pos: p, label: 'SPOT FIRE · 0.2 AC', severity: 'critical', confidence: 0.93, sourceId: it.id, detectedAt: h.state.t,
        detail: 'Ember-cast spot fire ahead of the main front. Will merge with the head within the hour if unchecked.' });
      it.derived = [id];
      h.addInsight({
        kind: 'alert', confidence: 0.93, refs: [it.id, id], title: 'Spot fire ahead of front',
        body: `HAWK-2 confirms a spot fire at GRID ${gridRef(p)}, ${km(dist(p, f.head))} km downwind of the head. Early bucket work keeps it from establishing.`,
      });
      h.addRecommendation({
        title: 'H-2 bucket drops on spot fire', priority: 'P1', unitIds: ['h-2'], target: p,
        etaMin: h.etaMin(['h-2'], p), impact: 'Prevents a second head; -15% ROS',
        rationale: 'Spot is small and isolated. Three bucket cycles from Cedar Reservoir should knock it down before it merges.',
      }, { kind: 'water', key: `water-${id}`, markerId: id });
      h.requestForecast('intel');
    },
  },
  {
    at: 2600, type: 'radio', source: 'E-17 · CMD NET', tags: ['E-17', 'STRUCTURES', 'PERSONS'],
    title: 'E-17: residents sheltering on Ridge Rd',
    summary: '"Six structures on lower Ridge Rd, at least four residents refusing to leave. Requesting law enforcement."',
    done: (h, it) => {
      const s = { x: 164.5, y: 65.5 };
      const sid = 'mk-ridge-struct';
      h.addMarker({ id: sid, kind: 'structure', pos: s, label: 'RIDGE RD · 6 STRUCT', severity: 'med', confidence: 0.9, sourceId: it.id, detectedAt: h.state.t,
        detail: 'Six rural structures on lower Ridge Rd with heavy brush clearance deficits.' });
      const hid = 'mk-ridge-persons';
      h.addMarker({ id: hid, kind: 'human', pos: { x: 166.8, y: 62.6 }, label: '4 RESIDENTS · RIDGE RD', severity: 'high', confidence: 0.64, sourceId: it.id, detectedAt: h.state.t,
        detail: 'Radio report of four residents sheltering in place. Not yet confirmed by imagery.' }, 4);
      it.derived = [sid, hid];
      h.addInsight({
        kind: 'analysis', confidence: 0.64, refs: [it.id, sid, hid], title: 'Unconfirmed persons on Ridge Rd',
        body: `Radio-only report (E-17) of 4 residents sheltering at GRID ${gridRef({ x: 166.8, y: 62.6 })}. Confidence 64% pending imagery. HAWK-4 confirmation orbit proposed.`,
      });
      h.addRecommendation({
        title: 'Task HAWK-4 to confirm Ridge Rd residents', priority: 'P3', unitIds: ['hawk-4'], target: { x: 166.8, y: 62.6 },
        etaMin: h.etaMin(['hawk-4'], { x: 166.8, y: 62.6 }), impact: 'Raises detection confidence to >90%',
        rationale: 'Radio reports are unverified. A 5-minute LWIR orbit confirms count and location before committing ground resources.',
      }, { kind: 'scan', key: 'scan-ridge', markerId: hid });
    },
  },
  {
    at: 3200, type: 'sensor', source: 'PINE HOLLOW RAWS', tags: ['RAWS', 'WIND SHIFT'],
    title: 'Wind shift · SW 31 kph G 46',
    summary: 'Pre-frontal shift: wind veering from WSW to SW and strengthening. Gusts to 46 kph.',
    done: (h, it) => {
      h.setWind(228, 31);
      h.addInsight({
        kind: 'alert', confidence: 0.82, refs: [it.id], title: 'Wind shift · head realigning NE',
        body: 'RAWS shows SW 31 kph G 46. Head realigns toward the Pine Hollow SW edge and Ridge Rd. Forecast bands recomputed; expect +20% ROS for 60–90 min.',
      });
      h.requestForecast('wind');
    },
  },
  {
    at: 3800, type: 'satellite', source: 'VIIRS · NOAA-21', tags: ['VIIRS', 'PERIMETER'],
    title: 'VIIRS 375 m pass · perimeter update',
    summary: (h) => `${Math.max(8, Math.round(h.fire().burning / 12))} active fire pixels. Perimeter agreement with drone mosaic 94%.`,
    done: (h, it) => {
      const f = h.fire();
      h.addInsight({
        kind: 'analysis', confidence: 0.9, refs: [it.id], title: 'Orbital perimeter matches drone mosaic',
        body: `VIIRS pass agrees with HAWK mosaic at 94%. ${ac(f.acres)} ac, head at GRID ${gridRef(f.head)}. No new detections outside the main perimeter.`,
      });
      h.requestForecast('intel');
    },
  },
  {
    at: 4400, type: 'news', source: 'CAL FIRE · AMADOR-EL DORADO', tags: ['CAL FIRE', 'UPDATE'],
    title: (h) => `Hollow Fire: ${ac(h.fire().acres)} acres, ${Math.round(h.state.metrics.containmentPct)}% contained`,
    summary: 'Unit update: evacuation warning remains for Pine Hollow. Air resources assigned: 1 VLAT request pending.',
  },
  {
    at: 5200, type: 'image', source: 'HAWK-4 EO', tags: ['HAWK-4', 'HAZARD'],
    title: 'Hazard survey · Pine Hollow SW edge',
    summary: 'High-res EO mosaic of SW town edge. Two 500-gal propane tanks and overhead lines identified.',
    done: (h, it) => {
      const t = h.world.town;
      const id = h.nextId('mk');
      const p = { x: t.x0 + 3.5, y: t.y1 - 0.5 };
      h.addMarker({ id, kind: 'hazard', pos: p, label: 'PROPANE · 2×500 GAL', severity: 'high', confidence: 0.91, sourceId: it.id, detectedAt: h.state.t,
        detail: 'Two residential propane tanks adjacent to the SW block. BLEVE hazard; keep engines upwind.' });
      it.derived = [id];
      h.addInsight({
        kind: 'alert', confidence: 0.91, refs: [it.id, id], title: 'Propane hazard at SW block',
        body: `HAWK-4 identified 2×500 gal propane at GRID ${gridRef(p)}. Engines should stage upwind; added to structure protection briefing.`,
      });
    },
  },
  {
    at: 9000, type: 'sensor', source: 'PINE HOLLOW RAWS', tags: ['RAWS', 'RH RECOVERY'],
    title: 'Wind easing · WSW 19 kph · RH 17%',
    summary: 'Evening transition. Winds easing, relative humidity recovering.',
    done: (h, it) => {
      h.setWind(252, 19);
      h.setHumidity(17);
      h.addInsight({
        kind: 'forecast', confidence: 0.8, refs: [it.id], title: 'Burn window closing',
        body: 'Winds easing to WSW 19 kph and RH recovering to 17%. Expect head ROS to fall ~35% over the next 2 h. Good window for direct attack on the right flank.',
      });
      h.requestForecast('wind');
    },
  },
];

type Procedural = (h: AgentHost) => Omit<ScriptEvent, 'at'> | null;

const PROCEDURAL: Procedural[] = [
  (h) => {
    const n = 1 + Math.floor(h.rand() * 4);
    const f = h.fire();
    return {
      type: 'video', source: `HAWK-${n} EO/IR`, tags: [`HAWK-${n}`, 'EO/IR', 'PERIMETER'],
      title: 'Perimeter mosaic update · 60 s', summary: 'Automated orbit clip. Perimeter re-extracted and merged with the common operating picture.',
      done: (hh, it) => hh.addInsight({
        kind: 'analysis', confidence: 0.86, refs: [it.id], title: 'Perimeter re-extracted',
        body: `${ac(hh.fire().acres)} ac. Head at GRID ${gridRef(hh.fire().head)}, ROS ${Math.round(hh.fire().rosMpm)} m/min. Change since last mosaic: +${ac(Math.max(0, hh.fire().acres - f.acres) + 4)} ac.`,
      }),
    };
  },
  (h) => {
    const w = h.state.wind;
    const nd = w.dirDeg + (h.rand() - 0.5) * 12;
    const ns = Math.max(10, w.speedKph + (h.rand() - 0.5) * 6);
    return {
      type: 'sensor', source: 'PINE HOLLOW RAWS', tags: ['RAWS', 'WIND'],
      title: `Wind ${compass16(nd)} ${Math.round(ns)} kph · RH ${Math.round(h.state.weather.humidityPct)}%`,
      summary: 'Remote automated weather station, 10-minute average.',
      done: (hh) => { hh.setWind(nd, ns); hh.requestForecast('intel'); },
    };
  },
  (h) => ({
    type: 'satellite', source: 'GOES-18 ABI', tags: ['GOES-18', 'FDC'],
    title: `FDC update · FRP ${Math.round(40 + h.fire().burning * 0.35)} MW`,
    summary: 'Five-minute CONUS scan. Radiative power trend consistent with the drone-derived perimeter.',
  }),
  (h) => {
    const units = h.state.units.filter((u) => u.status === 'active');
    const u = units[Math.floor(h.rand() * units.length)];
    if (!u) return null;
    const lines = [
      `"${u.callsign}, holding at GRID ${gridRef(u.pos)}. Fire behavior moderating on our flank."`,
      `"${u.callsign}, line is holding at GRID ${gridRef(u.pos)}. Continuing to mop up."`,
      `"${u.callsign}, observing spotting 100 m out. Picking it up."`,
    ];
    return {
      type: 'radio', source: `${u.callsign} · TAC 2`, tags: [u.callsign, 'RADIO'],
      title: `${u.callsign} status · GRID ${gridRef(u.pos)}`, summary: lines[Math.floor(h.rand() * lines.length)],
    };
  },
  (h) => {
    const f = h.fire();
    const p = h.findCell(downwind(h, f.head, 10 + h.rand() * 14), 12, (i) => h.state.grid.state[i] === 0 && h.state.grid.fuel[i] !== Fuel.Water);
    if (!p) return null;
    const hazards = [
      { label: 'POWERLINE · 69 KV', detail: 'PG&E 69 kV transmission span crossing the projected path. Request de-energization.' },
      { label: 'STOCK POND · WATER', detail: 'Stock pond suitable for helicopter dip within 1.5 km of the head.', kind: 'water' as const },
      { label: 'ABANDONED VEHICLE', detail: 'Vehicle at road pullout; occupants not observed.', kind: 'poi' as const },
    ];
    const z = hazards[Math.floor(h.rand() * hazards.length)];
    const n = 1 + Math.floor(h.rand() * 4);
    return {
      type: 'image', source: `HAWK-${n} EO`, tags: [`HAWK-${n}`, 'DETECTION'],
      title: `Detection · ${z.label}`, summary: z.detail,
      done: (hh, it) => {
        const id = hh.nextId('mk');
        hh.addMarker({ id, kind: z.kind ?? 'hazard', pos: p, label: z.label, detail: z.detail, severity: z.kind ? 'low' : 'med', confidence: 0.7 + hh.rand() * 0.25, sourceId: it.id, detectedAt: hh.state.t });
        it.derived = [id];
      },
    };
  },
  (h) => ({
    type: 'news', source: h.rand() > 0.5 ? 'KCRA 3 NEWS' : 'SAC BEE', tags: ['NEWS', 'UPDATE'],
    title: `Hollow Fire grows to ${ac(h.fire().acres)} acres`,
    summary: `Crews and aircraft continue to work the fire east of Bear Creek. Containment ${Math.round(h.state.metrics.containmentPct)}%.`,
  }),
];

export interface Agent {
  update(): void;
  reset(): void;
}

export function createAgent(host: AgentHost): Agent {
  let scriptIdx = 0;
  let pending: Pending[] = [];
  let nextProcedural = 6300;
  let lastReactive = 0;
  let lastSitrep = 0;
  let lastForecastRev = -1;
  let lastForecastInsightT = -1e9;
  let lastTankerRec = 0;
  const flags = new Set<string>();

  function emit(ev: Omit<ScriptEvent, 'at'>) {
    const h = host;
    const val = <T,>(v: T | ((h: AgentHost) => T)) => (typeof v === 'function' ? (v as (h: AgentHost) => T)(h) : v);
    const item: IngestItem = {
      id: h.nextId('ing'), type: ev.type, source: val(ev.source), title: val(ev.title), summary: val(ev.summary),
      at: h.state.t, tags: ev.tags, status: 'queued',
    };
    h.addIngest(item);
    const lag = ev.type === 'video' ? 1.6 : ev.type === 'image' ? 1.2 : 1;
    pending.push({ item, analyzeAt: h.state.t + 15 + h.rand() * 15, doneAt: h.state.t + (55 + h.rand() * 45) * lag, done: ev.done });
  }

  function forecastInsight() {
    const st = host.state;
    if (st.forecast.length === 0) return;
    const town = host.world.town;
    const tp = { x: town.x0 + 1, y: town.y1 - 1 };
    const th = host.world.trailhead;
    const reach = (p: Vec) => st.forecast.find((b) => pointInPolygon(p, b.polygon));
    const rt = reach(tp), rh = reach(th);
    const b360 = st.forecast[st.forecast.length - 1];
    const structs = host.structuresIn(b360.polygon);
    const parts: string[] = [];
    if (rt) parts.push(`Pine Hollow SW edge inside +${rt.horizonMin / 60}H band`);
    else parts.push('Pine Hollow outside +6H band');
    if (rh) parts.push(`trailhead inside +${rh.horizonMin / 60}H`);
    host.addInsight({
      kind: 'forecast', confidence: st.forecast[1]?.confidence ?? 0.7,
      title: `Forecast rev ${st.forecastRev} · ${compass16(st.wind.dirDeg + 180)} run`,
      body: `${parts.join('; ')}. ${structs} structures within +6H (conf ${Math.round(b360.confidence * 100)}%). Model: elliptical spread on ${compass16(st.wind.dirDeg)} ${Math.round(st.wind.speedKph)} kph, ROS ${Math.round(host.fire().rosMpm)} m/min.`,
    });
  }

  function reactive() {
    const h = host;
    const st = h.state;
    const f = h.fire();
    const town = h.world.town;
    const tp = { x: town.x0 + 1, y: town.y1 - 1 };
    const dTown = h.fireDistance(tp);

    if (dTown < 45 && !flags.has('town-45')) {
      flags.add('town-45');
      h.addInsight({ kind: 'alert', confidence: 0.88, title: 'Front within 1.8 km of Pine Hollow',
        body: `Nearest active fire ${km(dTown)} km from the SW edge. At ${Math.round(f.rosMpm)} m/min the head reaches town in ~${Math.max(10, Math.round((dTown * CELL_M) / Math.max(f.rosMpm, 5)))} min.` });
      if (!h.hasRec('protect-town')) {
        const tgt = { x: town.x0 - 1, y: town.y1 - 2 };
        h.addRecommendation({
          title: 'Structure protection: E-17, E-22 to Pine Hollow SW edge', priority: 'P1', unitIds: ['e-17', 'e-22'], target: tgt,
          etaMin: h.etaMin(['e-17', 'e-22'], tgt), impact: 'Protects SW block; -25% ember exposure',
          rationale: 'Front is inside 2 km. Wet line and engine staging on the SW edge is the last line before structures.',
        }, { kind: 'protect', key: 'protect-town' });
      }
    }
    if (dTown < 20 && !flags.has('town-20')) {
      flags.add('town-20');
      h.addInsight({ kind: 'alert', confidence: 0.92, title: 'Recommend evacuation ORDER · Pine Hollow',
        body: `Front ${km(dTown)} km from structures. Upgrade warning to order and close HWY 49 at Ridge Rd.` });
    }

    for (const m of st.markers) {
      if (m.kind !== 'human' || m.severity === 'low') continue;
      const d = h.fireDistance(m.pos);
      const key = `extract-${m.id}`;
      if (d < 22 && !h.hasRec(key) && !flags.has(key)) {
        flags.add(key);
        h.addInsight({ kind: 'alert', confidence: m.confidence, refs: [m.id], title: `Persons threatened · ${m.label}`,
          body: `Active fire ${km(d)} km from ${m.label.toLowerCase()} at GRID ${gridRef(m.pos)}. Extraction proposed.` });
        h.addRecommendation({
          title: `H-2 extract ${m.label.split('·')[0].trim().toLowerCase()} at GRID ${gridRef(m.pos)}`, priority: 'P1', unitIds: ['h-2'], target: m.pos,
          etaMin: h.etaMin(['h-2'], m.pos), impact: 'Removes persons from fire path',
          rationale: 'Fire is inside the 1 km trigger distance. Hoist is the fastest egress.',
        }, { kind: 'extract', key, markerId: m.id });
      }
    }

    const tanker = h.unit('t-910');
    if (tanker && tanker.status === 'standby' && !h.hasRec('tanker-line') && st.t - lastTankerRec > 1500 && dTown < 70) {
      lastTankerRec = st.t;
      const tgt = between(h, 0.35);
      h.addRecommendation({
        title: `Re-commit T-910: retardant line at GRID ${gridRef(tgt)}`, priority: dTown < 35 ? 'P1' : 'P2', unitIds: ['t-910'], target: tgt,
        etaMin: h.etaMin(['t-910'], tgt), impact: '-18% spread toward Pine Hollow',
        rationale: `T-910 reloaded. Head at GRID ${gridRef(f.head)} is still aligned with the town; a second line ahead of the head buys ~40 min.`,
      }, { kind: 'retardant-line', key: 'tanker-line' });
    }

    const c = st.metrics.containmentPct;
    for (const m of [10, 25, 50, 75]) {
      const k = `cont-${m}`;
      if (c >= m && !flags.has(k)) {
        flags.add(k);
        h.addInsight({ kind: 'status', confidence: 0.85, title: `Containment ${m}%`, body: `Line construction and natural barriers now hold ${Math.round(c)}% of the perimeter.` });
      }
    }

    if (st.t - lastSitrep >= 1200) {
      lastSitrep = st.t;
      const active = st.units.filter((u) => u.status !== 'standby').length;
      h.addInsight({
        kind: 'status', confidence: 0.9, title: `SITREP · T+${Math.round(st.t / 60)} MIN`,
        body: `${ac(f.acres)} ac, ${Math.round(c)}% contained, head ROS ${Math.round(f.rosMpm)} m/min at GRID ${gridRef(f.head)}. ${active} units committed, ${st.metrics.structuresThreatened} structures threatened, ${st.metrics.personsAtRisk} persons at risk.`,
      });
    }
  }

  return {
    update() {
      const h = host;
      const t = h.state.t;
      while (scriptIdx < SCRIPT.length && SCRIPT[scriptIdx].at <= t) emit(SCRIPT[scriptIdx++]);
      if (t >= nextProcedural) {
        const gen = PROCEDURAL[Math.floor(h.rand() * PROCEDURAL.length)];
        const ev = gen(h);
        if (ev) emit(ev);
        nextProcedural = t + 420 + h.rand() * 420;
      }
      if (pending.length) {
        const keep: Pending[] = [];
        for (const p of pending) {
          if (t >= p.doneAt) {
            const item = { ...p.item, status: 'processed' as const };
            p.done?.(h, item);
            h.replaceIngest(item);
          } else {
            if (t >= p.analyzeAt && p.item.status === 'queued') {
              p.item = { ...p.item, status: 'analyzing' };
              h.replaceIngest(p.item);
            }
            keep.push(p);
          }
        }
        pending = keep;
      }
      if (h.state.forecastRev !== lastForecastRev) {
        lastForecastRev = h.state.forecastRev;
        const r = h.lastForecastReason;
        if (r !== 'init' && (r !== 'periodic' || t - lastForecastInsightT > 1800) && t - lastForecastInsightT > 600) {
          lastForecastInsightT = t;
          forecastInsight();
        }
      }
      if (t - lastReactive >= 60) {
        lastReactive = t;
        reactive();
      }
    },
    reset() {
      scriptIdx = 0;
      pending = [];
      nextProcedural = 6300;
      lastReactive = 0;
      lastSitrep = 0;
      lastForecastRev = -1;
      lastForecastInsightT = -1e9;
      lastTankerRec = 0;
      flags.clear();
    },
  };
}
