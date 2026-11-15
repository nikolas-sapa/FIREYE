import { useSyncExternalStore } from 'react';
import { setMapLayers, type MapLayer } from '../../stage3d/map-settings';

/* ------------------------------------------------------------------ visibility (display only) */

export const VIS_GROUPS = {
  fleet: 'UAV fleet & aircraft',
  groundUnits: 'Ground units',
  groundCams: 'Ground cameras',
  iot: 'IoT sensors',
  flightPaths: 'Flight paths',
  footprints: 'Sensor footprints',
  findings: 'Detections',
  fireFront: 'Fire front & perimeter',
  projections: 'Projections',
  risk: 'Ignition risk',
  roadsPlaces: 'Roads & places',
  labels: 'Labels',
} as const;
export type VisGroup = keyof typeof VIS_GROUPS;
export type Visibility = Record<VisGroup, boolean>;
export type VisPreset = 'minimal' | 'standard' | 'everything';

export const VIS_PRESETS: Record<VisPreset, Visibility> = {
  minimal: { fleet: true, groundUnits: false, groundCams: false, iot: false, flightPaths: false, footprints: false, findings: false, fireFront: true, projections: false, risk: false, roadsPlaces: true, labels: false },
  standard: { fleet: true, groundUnits: true, groundCams: true, iot: true, flightPaths: true, footprints: false, findings: true, fireFront: true, projections: true, risk: false, roadsPlaces: true, labels: true },
  everything: { fleet: true, groundUnits: true, groundCams: true, iot: true, flightPaths: true, footprints: true, findings: true, fireFront: true, projections: true, risk: true, roadsPlaces: true, labels: true },
};

/** Visibility groups mapped onto the shared stage layer switches. Overlay-only groups are handled by FIREYE. */
export function mapPatch(v: Visibility): Partial<Record<MapLayer, boolean>> {
  return {
    units: v.fleet || v.groundUnits, drones: v.fleet, helicopters: v.fleet, airplanes: v.fleet,
    engines: v.groundUnits, crews: v.groundUnits, dozers: v.groundUnits, ems: v.groundUnits, law: v.groundUnits,
    trails: v.flightPaths, sensorFootprints: v.footprints, coverage: v.footprints, altitudeStems: v.fleet,
    findings: v.findings, uncertainty: v.findings,
    fire: v.fireFront, perimeter: v.fireFront, projection: v.projections,
    roads: v.roadsPlaces, buildings: v.roadsPlaces, places: v.roadsPlaces, contours: v.roadsPlaces,
    unitLabels: v.labels, findingLabels: v.labels, actions: v.projections,
  };
}

/* ------------------------------------------------------------------ layout */

export interface Layout { left: number; right: number; bottom: number; leftOpen: boolean; rightOpen: boolean; bottomOpen: boolean }
export const LAYOUT_LIMITS = { left: [240, 440], right: [320, 560], bottom: [128, 380] } as const;
const DEFAULT_LAYOUT: Layout = { left: 300, right: 380, bottom: 196, leftOpen: true, rightOpen: true, bottomOpen: true };

/* ------------------------------------------------------------------ state */

export type DivePhase = 'idle' | 'lock' | 'flying' | 'wipe' | 'feed' | 'exiting';
export interface FireyeUi {
  tab: 'intake' | 'ops';
  selected: string | null;
  thermal: boolean;
  dive: { phase: DivePhase; feedId?: string; unitId?: string };
  panel: 'legend' | 'layers' | null;
  chat: boolean;
  layout: Layout;
  vis: Visibility;
  preset: VisPreset | 'custom';
  /** Per drone feed: thermal (white-hot) or EO. Display-only. */
  fx: Record<string, 'eo' | 'thermal'>;
  /** Fleet data source. */
  source: 'sim' | 'bridge';
  booted: boolean;
  /** Slow camera orbit around the selection. */
  orbit: boolean;
  /** Decision keys the user deferred with Later (still counted in the ORCH queue). */
  snoozed: string[];
}

function read<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return valid(v) ? v : fallback;
  } catch { return fallback; }
}
const isLayout = (v: unknown): v is Layout => !!v && typeof v === 'object' && ['left', 'right', 'bottom'].every((k) => typeof (v as Record<string, unknown>)[k] === 'number');
const isVis = (v: unknown): v is Visibility => !!v && typeof v === 'object' && Object.keys(VIS_GROUPS).every((k) => typeof (v as Record<string, unknown>)[k] === 'boolean');

export function clampLayout(l: Layout): Layout {
  const c = (n: number, [a, b]: readonly [number, number]) => Math.round(Math.max(a, Math.min(b, n)));
  return { ...l, left: c(l.left, LAYOUT_LIMITS.left), right: c(l.right, LAYOUT_LIMITS.right), bottom: c(l.bottom, LAYOUT_LIMITS.bottom) };
}

const dom = typeof window !== 'undefined';
let state: FireyeUi = {
  tab: 'intake', selected: null, thermal: false, dive: { phase: 'idle' }, panel: null, chat: false,
  layout: dom ? clampLayout({ ...DEFAULT_LAYOUT, ...read('fireye.layout', DEFAULT_LAYOUT, isLayout) }) : DEFAULT_LAYOUT,
  vis: dom ? read('fireye.visibility', VIS_PRESETS.standard, isVis) : VIS_PRESETS.standard,
  preset: 'standard', fx: {}, source: 'sim', booted: dom && new URLSearchParams(window.location.search).get('boot') === '0', orbit: false, snoozed: [],
};
state.preset = (Object.keys(VIS_PRESETS) as VisPreset[]).find((p) => Object.keys(VIS_GROUPS).every((k) => VIS_PRESETS[p][k as VisGroup] === state.vis[k as VisGroup])) ?? 'custom';
const listeners = new Set<() => void>();

export const fireyeUi = {
  get: () => state,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  set(p: Partial<FireyeUi> | ((s: FireyeUi) => Partial<FireyeUi>)) {
    const patch = typeof p === 'function' ? p(state) : p;
    state = { ...state, ...patch };
    if (patch.layout) { try { localStorage.setItem('fireye.layout', JSON.stringify(state.layout)); } catch { /* optional */ } }
    if (patch.vis) {
      try { localStorage.setItem('fireye.visibility', JSON.stringify(state.vis)); } catch { /* optional */ }
      setMapLayers(mapPatch(state.vis));
    }
    listeners.forEach((fn) => fn());
  },
  setLayout(p: Partial<Layout>) { fireyeUi.set((s) => ({ layout: clampLayout({ ...s.layout, ...p }) })); },
  setVis(key: VisGroup, on: boolean) {
    fireyeUi.set((s) => {
      const vis = { ...s.vis, [key]: on };
      const preset = (Object.keys(VIS_PRESETS) as VisPreset[]).find((p) => Object.keys(VIS_GROUPS).every((k) => VIS_PRESETS[p][k as VisGroup] === vis[k as VisGroup])) ?? 'custom';
      return { vis, preset };
    });
  },
  preset(p: VisPreset) { fireyeUi.set({ vis: { ...VIS_PRESETS[p] }, preset: p }); },
  toggleFx(feedId: string, current: 'eo' | 'thermal') {
    fireyeUi.set((s) => ({ fx: { ...s.fx, [feedId]: current === 'eo' ? 'thermal' : 'eo' } }));
  },
};

export function useFireye<T>(sel: (s: FireyeUi) => T): T {
  return useSyncExternalStore(fireyeUi.subscribe, () => sel(state), () => sel(state));
}
