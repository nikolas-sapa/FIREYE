import type { Action, ConsoleState, Feed, Finding, Geo, GradedItem, Projection, ScenarioPack, Unit } from '../../contracts';
import { circle, destination, distanceM, bearingDeg } from '../raster';

/** Dev-only mock of the dynamic console state, laid over the real scenario pack. */
export function mockState(pack: ScenarioPack, t: number, wallS: number) {
  const P = (id: string): Geo => pack.manifest.places.find((p) => p.id === id)?.pos ?? pack.manifest.center;
  const gf = P('grizzly-flats');
  const units: Unit[] = [];
  const trailOf = (fn: (k: number) => Geo) => Array.from({ length: 16 }, (_, i) => fn(-(16 - i) * 3));
  for (let i = 0; i < 6; i++) {
    const c = destination(gf, i * 60 + 20, 3500 + i * 600);
    const pos = (k: number): Geo => ({ ...destination(c, (wallS + k) * 6 + i * 50, 700), alt: 180 + i * 25 });
    units.push({
      id: `hawk-${i + 1}`, callsign: `HAWK-${i + 1}`, kind: 'drone', pos: pos(0), heading: ((wallS * 6 + i * 50 + 90) % 360),
      speedMps: 18, status: 'active', division: 'AIR', battery: 0.7, trail: trailOf(pos),
    });
  }
  const road = pack.roads.filter((r) => r.kind !== 'track' && r.coords.length > 8).sort((a, b) => distanceM(a.coords[0], gf) - distanceM(b.coords[0], gf));
  const engines: [string, string, Unit['kind']][] = [['e-41', 'E-41', 'engine'], ['e-52', 'E-52', 'engine'], ['d-3', 'DOZ-3', 'dozer'], ['m-12', 'M-12', 'ems']];
  engines.forEach(([id, cs, kind], i) => {
    const r = road[i % Math.max(1, road.length)];
    if (!r) return;
    const idx = Math.floor((wallS * 0.5 + i * 3) % (r.coords.length - 1));
    const a = r.coords[idx], b = r.coords[idx + 1];
    units.push({ id, callsign: cs, kind, pos: a, heading: bearingDeg(a, b), speedMps: 12, status: 'enroute', division: 'A', trail: r.coords.slice(Math.max(0, idx - 10), idx + 1) });
  });
  units.push({ id: 'crew-7', callsign: 'CREW-7', kind: 'crew', pos: destination(gf, 140, 1800), heading: 200, speedMps: 1, status: 'active', trail: [] });
  const heloPos = (k: number): Geo => ({ ...destination(gf, (wallS + k) * 3, 6000), alt: 300 });
  units.push({ id: 'h-1', callsign: 'H-301', kind: 'helo', pos: heloPos(0), heading: (wallS * 3 + 90) % 360, speedMps: 40, status: 'active', trail: trailOf(heloPos) });

  const findings: Finding[] = [
    { id: 'f-hikers', kind: 'human', label: '2 hikers · Capps Crossing trail', detail: '', pos: destination(P('capps-crossing'), 250, 1200), uncertaintyM: 450, confidence: 0.74, live: false, observedAt: t, halfLifeS: 900, freshness: 0.8, sourceIds: [], count: 2 },
    { id: 'f-horses', kind: 'animal', label: 'Horses · Miller Ranch', detail: '', pos: destination(gf, 200, 1500), uncertaintyM: 60, confidence: 0.88, live: true, observedAt: t, halfLifeS: 900, freshness: 1, sourceIds: [], count: 3 },
    { id: 'f-propane', kind: 'combustible', label: 'Propane tanks · residence', detail: '', pos: destination(gf, 300, 900), uncertaintyM: 40, confidence: 0.81, live: true, observedAt: t, halfLifeS: 900, freshness: 1, sourceIds: [] },
    { id: 'f-brush', kind: 'fuel', label: 'Dry brush · south aspect', detail: '', pos: destination(gf, 160, 3500), uncertaintyM: 600, confidence: 0.6, live: false, observedAt: t, halfLifeS: 1200, freshness: 0.45, sourceIds: [] },
    { id: 'f-school', kind: 'structure', label: 'School', detail: '', pos: P('indian-diggings-school'), uncertaintyM: 20, confidence: 0.95, live: false, observedAt: t, halfLifeS: 3600, freshness: 0.9, sourceIds: [] },
    { id: 'f-lake', kind: 'water', label: 'Jenkinson Lake · dip site', detail: '', pos: P('sly-park'), uncertaintyM: 30, confidence: 0.99, live: false, observedAt: t, halfLifeS: 3600, freshness: 1, sourceIds: [] },
    { id: 'f-cars', kind: 'vehicle', label: 'Abandoned vehicles · road', detail: '', pos: destination(gf, 30, 1200), uncertaintyM: 250, confidence: 0.55, live: false, observedAt: t, halfLifeS: 900, freshness: 0.3, sourceIds: [] },
  ];
  // Make HAWK-3 sit over the hikers so its nadir/oblique feed sees them.
  const h3 = units.find((u) => u.id === 'hawk-3')!;
  h3.pos = { ...destination(findings[0].pos, (wallS * 20) % 360, 220), alt: 220 };
  h3.heading = ((wallS * 20) + 90) % 360;

  const zone = (id: string, z: GradedItem['zone'], score: number): GradedItem => {
    const f = findings.find((x) => x.id === id)!;
    return { id, kind: 'finding', refId: id, cls: f.kind === 'human' || f.kind === 'animal' ? 'life' : 'hazard', title: f.label, body: '', score, factors: { severity: 1, exposure: 1, confidence: 1, freshness: 1, corroboration: 0, actionability: 0, novelty: 0, fatigue: 0, lens: 1 }, zone: z, reason: '', pos: f.pos, audiences: ['ic'], seen: false, dismissed: false, pinned: false, updatedAt: t };
  };
  const items: GradedItem[] = [zone('f-hikers', 'Z0_INTERRUPT', 91), zone('f-propane', 'Z3_FOCUS', 72), zone('f-horses', 'Z3_FOCUS', 66), zone('f-brush', 'Z4_AMBIENT', 40), zone('f-cars', 'Z4_AMBIENT', 38)];

  const feeds: Feed[] = [
    { id: 'feed-hawk-3', unitId: 'hawk-3', kind: 'uav-oblique', fx: 'eo', label: 'HAWK-3 · EO/IR gimbal', live: true, pose: { mode: 'orbit', target: findings[0].pos, rangeM: 520, pitchDeg: -40 }, relevance: 95, findingIds: ['f-hikers'] },
    { id: 'feed-hawk-1', unitId: 'hawk-1', kind: 'uav-nadir', fx: 'ir-ironbow', label: 'HAWK-1 · IR nadir', live: true, pose: { mode: 'unit' }, relevance: 70, findingIds: [] },
    { id: 'feed-hawk-2', unitId: 'hawk-2', kind: 'uav-oblique', fx: 'ir-whitehot', label: 'HAWK-2 · IR', live: true, pose: { mode: 'unit' }, relevance: 60, findingIds: [] },
    { id: 'feed-e41', unitId: 'e-41', kind: 'dash-cam', fx: 'eo', label: 'E-41 · Dash cam', live: true, pose: { mode: 'unit' }, relevance: 55, findingIds: ['f-propane'] },
    { id: 'feed-crew7', unitId: 'crew-7', kind: 'helmet-cam', fx: 'eo', label: 'CREW-7 · Helmet', live: true, pose: { mode: 'unit' }, relevance: 40, findingIds: [] },
    { id: 'feed-ridge-1', kind: 'ridge-cam', fx: 'eo', label: 'Ridge cam · Leek Spring', live: true, pose: { mode: 'fixed', pos: destination(gf, 40, 9000), headingDeg: 220, pitchDeg: -4 }, relevance: 50, findingIds: [] },
    { id: 'feed-sat', kind: 'satellite', fx: 'sat', label: 'VIIRS · NOAA-20 pass', live: false, pose: { mode: 'fixed', target: pack.manifest.center }, relevance: 30, findingIds: [] },
    { id: 'feed-social-1', kind: 'social', fx: 'phone', label: 'Social video · Grizzly Flats Rd', live: false, pose: { mode: 'fixed', pos: destination(gf, 250, 600), headingDeg: 120 }, relevance: 45, findingIds: [] },
  ];

  return { units, findings, items, feeds };
}

/** Rough projection bands from the arrival raster: star polygons around the active fire. */
export function mockProjection(pack: ScenarioPack, t: number, rev: number, previous?: Projection['bands']): Projection {
  const tRel = t - pack.manifest.start;
  const { w, h, bbox } = pack.raster;
  const dLon = (bbox[2] - bbox[0]) / w, dLat = (bbox[3] - bbox[1]) / h;
  let cx = 0, cy = 0, n = 0;
  for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { const a = pack.arrival[y * w + x]; if (a <= tRel) { cx += x; cy += y; n++; } }
  cx /= n || 1; cy /= n || 1;
  const c: Geo = { lon: bbox[0] + (cx + 0.5) * dLon, lat: bbox[3] - (cy + 0.5) * dLat };
  const bands = ([60, 180, 360] as const).map((hm, i) => {
    const lim = tRel + hm * 60000;
    const rays = new Float32Array(90);
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
      const a = pack.arrival[y * w + x];
      if (!(a <= lim)) continue;
      const g = { lon: bbox[0] + (x + 0.5) * dLon, lat: bbox[3] - (y + 0.5) * dLat };
      const b = Math.floor(bearingDeg(c, g) / 4) % 90;
      const d = distanceM(c, g);
      if (d > rays[b]) rays[b] = d;
    }
    const poly: Geo[] = [];
    for (let k = 0; k < 90; k++) {
      const r = (rays[k] * 0.6 + rays[(k + 89) % 90] * 0.2 + rays[(k + 1) % 90] * 0.2) + 300 + i * 400;
      poly.push(destination(c, k * 4 + 2, r));
    }
    return { horizonMin: hm, polygon: poly, confidence: 0.85 - i * 0.2 };
  });
  return { rev, issuedAt: t, bands, headDirDeg: 45, rosMpm: 30, drivers: [], previous, etaToPlaces: {} };
}

export function mockCoverage(pack: ScenarioPack): ConsoleState['coverage'] {
  const gf = pack.manifest.places.find((p) => p.id === 'grizzly-flats')!.pos;
  const out: ConsoleState['coverage'] = [];
  const s = 0.018;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const lon = gf.lon + i * s * 1.25, lat = gf.lat + j * s;
    out.push({ id: `cov-${i}-${j}`, polygon: [{ lon, lat }, { lon: lon + s * 1.25, lat }, { lon: lon + s * 1.25, lat: lat + s }, { lon, lat: lat + s }], interest: Math.random(), unitId: (i + j) % 3 === 0 ? 'hawk-1' : undefined });
  }
  return out;
}

export function mockActions(pack: ScenarioPack): Action[] {
  const gf = pack.manifest.places.find((p) => p.id === 'grizzly-flats')!.pos;
  const route = pack.roads.find((r) => r.kind === 'road' && r.coords.length > 10 && distanceM(r.coords[0], gf) < 6000)?.coords.slice(0, 30) ?? [gf, destination(gf, 300, 4000)];
  return [{
    id: 'act-move', kind: 'move-group', title: 'Move Division A to safety zone', summary: '', risk: 'high', requiresApproval: true, status: 'proposed', proposedAt: 0, audiences: ['ops'], unitIds: ['e-41'],
    route, safetyZone: { center: route[route.length - 1], radiusM: 450, label: 'SZ-2 · Meadow' },
  }];
}

export { circle };
