import { useMemo, useSyncExternalStore } from 'react';
import * as Cesium from 'cesium';
import { color, role } from '@ds';
import type { Geo, Ms, ScenarioPack } from '../contracts';
import { consoleStore, useConsoleSelector } from '../store';
import { residentEstimateAt, routingHazardAt } from './geo/saferoute';
import {
  MATI_EXITS, NO_EXIT_ZONES, alertStage, buildRoadGraph, distanceM, escapeRoutes,
  leaveBy, pointInPolygon, residentsNear, summarizeRoads,
  type AlertStage, type EscapeRoute, type Hazard,
} from './geo/evac';

/* ------------------------------------------------------------------ osm + road graph (lazy) */

export interface OsmData { roads: { id: string; name?: string; kind: string; coords: Geo[] }[]; buildings: { pos: Geo; kind: string }[]; water: { polygon: Geo[] }[] }
type Graph = ReturnType<typeof buildRoadGraph>;

let osm: OsmData | null = null;
let graph: Graph | null = null;
let loading = false;
let attempts = 0;
let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((fn) => fn()); };

export const getOsm = () => osm;
export const getGraph = () => graph;

export const osmStatus = () => ({ loading, osm: !!osm, graph: !!graph });

/** Fetch /data/mati/osm.json once and build the road graph off the critical path. */
export function ensureOsm() {
  if (loading || osm || typeof window === 'undefined') return;
  loading = true;
  void fetch(`${import.meta.env?.BASE_URL ?? '/'}data/mati/osm.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`osm ${r.status}`))))
    .then((d: OsmData) => {
      osm = d;
      const build = () => { graph = buildRoadGraph(d.roads); loading = false; bump(); };
      const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
      if (ric) ric(build, { timeout: 2000 }); else window.setTimeout(build, 0);
      bump();
    })
    .catch((e) => {
      loading = false;
      console.warn('[ops] osm load failed', e);
      if (attempts++ < 8) window.setTimeout(ensureOsm, 5000); // retry while the console is open
    });
}

/* ------------------------------------------------------------------ projection revision log */

interface RevEntry {
  t: Ms;
  rev: number;
  bands: { horizonMin: number; polygon: Geo[] }[];
  etaToPlaces: Record<string, Ms>;
}
const revLog: RevEntry[] = [];
let wired = false;

function hazardOf(e: RevEntry | null): Hazard {
  const band = (h: number) => e?.bands.find((b) => b.horizonMin === h)?.polygon;
  const wrap = (p?: Geo[]) => (p && p.length >= 3 ? [p] : []);
  return { blocked: wrap(band(60)), caution: wrap(band(180)) };
}

export function hazardAt(pack: ScenarioPack | null, t: Ms): Hazard {
  return routingHazardAt(t, revLog, pack?.perimeters ?? []) ?? { blocked: [], caution: [] };
}

export const residentAlertAt = (pack: ScenarioPack | null, t: Ms, pos: Geo) => residentEstimateAt(pos, t, revLog, pack?.perimeters ?? []);

function ingest() {
  const s = consoleStore.get();
  const p = s.projection;
  const t = s.clock.t;
  let changed = false;
  // On backward scrub, drop entries that are now "future" so everything stays a pure function of t.
  while (revLog.length && revLog[revLog.length - 1]!.t > t) { revLog.pop(); changed = true; }
  if (!p || p.issuedAt > t || revLog[revLog.length - 1]?.rev === p.rev) return changed;
  revLog.push({ t: p.issuedAt, rev: p.rev, bands: p.bands.map((b) => ({ horizonMin: b.horizonMin, polygon: b.polygon })), etaToPlaces: { ...p.etaToPlaces } });
  revLog.sort((a, b) => a.t - b.t);
  if (revLog.length > 120) revLog.shift();
  return true;
}

export function wireAlerts() {
  if (wired) return;
  wired = true;
  consoleStore.subscribe(() => { if (ingest()) bump(); });
}

const entryAt = (t: Ms): RevEntry | null => {
  let hit: RevEntry | null = null;
  for (const e of revLog) { if (e.t <= t) hit = e; else break; }
  return hit;
};

/* ------------------------------------------------------------------ per-place alert state */

export interface PlaceAlert { id: string; name: string; pos: Geo; eta: Ms | null; etaMin: number | null; inBlocked: boolean; stage: AlertStage; residents: number }

function placesOf(pack: ScenarioPack | null) {
  return pack?.manifest.places ?? [];
}

/** Place alert states at sim time t (pure over revLog). */
export function placeAlerts(pack: ScenarioPack | null, t: Ms): PlaceAlert[] {
  const e = entryAt(t);
  const out: PlaceAlert[] = [];
  for (const p of placesOf(pack)) {
    const eta = e?.etaToPlaces[p.id] ?? null;
    const etaMin = eta == null ? null : Math.max(0, Math.round((eta - t) / 60000));
    const blocked = e ? hazardOf(e).blocked.some((poly) => pointInPolygon(p.pos, poly)) : false;
    out.push({ id: p.id, name: p.name.toUpperCase(), pos: p.pos, eta, etaMin, inBlocked: blocked, stage: alertStage(etaMin, blocked), residents: osm ? residentsNear(osm.buildings, p.pos, 900) : 0 });
  }
  return out;
}

export const STAGE_RANK: Record<AlertStage, number> = { monitor: 0, prepare: 1, leave: 2, shelter: 3 };

/** First sim-time each place reached each stage (pure over revLog entries <= t). */
export function transitions(pack: ScenarioPack | null, t: Ms): { placeId: string; stage: 'prepare' | 'leave' | 'shelter'; t: Ms }[] {
  const seen = new Set<string>();
  const out: { placeId: string; stage: 'prepare' | 'leave' | 'shelter'; t: Ms }[] = [];
  for (const e of revLog) {
    if (e.t > t) break;
    const h = hazardOf(e);
    for (const p of placesOf(pack)) {
      const eta = e.etaToPlaces[p.id] ?? null;
      const etaMin = eta == null ? null : Math.max(0, Math.round((eta - e.t) / 60000));
      const blocked = h.blocked.some((poly) => pointInPolygon(p.pos, poly));
      const stage = alertStage(etaMin, blocked);
      for (const want of ['prepare', 'leave', 'shelter'] as const) {
        const key = `${p.id}:${want}`;
        if (!seen.has(key) && STAGE_RANK[stage] >= STAGE_RANK[want]) {
          seen.add(key);
          out.push({ placeId: p.id, stage: want, t: e.t });
        }
      }
    }
  }
  return out;
}

export interface AlertFeedRow { t: Ms; stage: AlertStage; place: string; text: string }
export function alertFeed(pack: ScenarioPack | null, t: Ms): AlertFeedRow[] {
  const residents = new Map(placeAlerts(pack, t).map((p) => [p.id, p.residents]));
  return transitions(pack, t).map((x) => {
    const n = residents.get(x.placeId) ?? 0;
    const m = Math.round(n * 0.18);
    const name = (placesOf(pack).find((p) => p.id === x.placeId)?.name ?? x.placeId).toUpperCase();
    const detail = x.stage === 'leave' ? 'fire expected within ~1h' : x.stage === 'shelter' ? 'fire imminent, stay inside' : 'fire expected within 3h';
    return { t: x.t, stage: x.stage, place: name, text: `${x.stage.toUpperCase()} · ${name} · ${detail} · SMS sent to ~${n} residents · voice calls to ~${m} (elderly list) · SIMULATED` };
  }).sort((a, b) => a.t - b.t);
}

export interface Counters { alertZones: number; warned: number; moved: number }
export function counters(pack: ScenarioPack | null, t: Ms): Counters {
  const alerts = placeAlerts(pack, t);
  const alertZones = alerts.filter((p) => STAGE_RANK[p.stage] >= 1).reduce((n, p) => n + p.residents, 0);
  const tr = transitions(pack, t);
  const firstWarn = new Map<string, Ms>();
  for (const x of tr) if (x.stage === 'prepare') { const cur = firstWarn.get(x.placeId); if (cur == null || x.t < cur) firstWarn.set(x.placeId, x.t); }
  let warned = 0, moved = 0;
  for (const [id, at] of firstWarn) {
    const n = alerts.find((p) => p.id === id)?.residents ?? 0;
    warned += n;
    const frac = Math.max(0, Math.min(1, (t - at) / (40 * 60000)));
    moved += Math.round(n * 0.85 * frac);
  }
  return { alertZones, warned, moved };
}

/* ------------------------------------------------------------------ escape routes */

export interface Routes { best: EscapeRoute | null; second: EscapeRoute | null; status: 'loading' | 'unavailable' | 'ready' }
const routesFor = (home: Geo | null): Routes => {
  const s = consoleStore.get();
  if (!graph || !home || !entryAt(s.clock.t)) return { best: null, second: null, status: 'loading' };
  const routes = escapeRoutes(graph, home, hazardAt(s.pack, s.clock.t), MATI_EXITS, { clearanceM: 500 });
  return { best: routes[0] ?? null, second: routes[1] ?? null, status: routes.length ? 'ready' : 'unavailable' };
};

export function useRoutes(home: Geo | null, rev: number): Routes {
  const v = useAlertVersion();
  const t = useConsoleSelector((s) => s.clock.t);
  const pack = useConsoleSelector((s) => s.pack);
  const entry = entryAt(t);
  const perimeterT = pack?.perimeters.reduce((latest, p) => p.t <= t ? Math.max(latest, p.t) : latest, -Infinity);
  return useMemo(() => routesFor(home), [home, rev, v, entry, pack, perimeterT]);
}

/** Current hazard + routes for verification/debug. */
export const hazardNow = (): Hazard => { const s = consoleStore.get(); return hazardAt(s.pack, s.clock.t); };
export const routesNow = (home: Geo | null): Routes => routesFor(home);

export { NO_EXIT_ZONES, MATI_EXITS, leaveBy, distanceM, pointInPolygon, hazardOf };
export type { AlertStage, EscapeRoute };

/** Ordered road names for display. */
export const routeRoads = (r: EscapeRoute): string[] => summarizeRoads(r, 4);

/* ------------------------------------------------------------------ subscription */

export function useAlertVersion(): number {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => version, () => version);
}

/* ------------------------------------------------------------------ cesium color helpers */

export const cesiumOf = (hex: string, alpha = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
export const danger = () => cesiumOf(role.danger);
export const accent = () => cesiumOf(role.accent);
export const warnCol = () => cesiumOf(role.warning);
export const neutralCol = () => cesiumOf(color.bone.dim);
