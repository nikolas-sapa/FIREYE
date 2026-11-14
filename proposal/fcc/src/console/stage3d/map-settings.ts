import { useSyncExternalStore } from 'react';

export type MapMode = 'outline' | 'satellite';
export const MAP_LAYERS = {
  contours: 'Elevation contours', roads: 'Road outlines', buildings: 'Building outlines',
  places: 'Place labels', units: 'Units & aircraft', findings: 'Findings & detections',
  fire: 'Fire & replay perimeter', projection: 'Prediction bands',
  actions: 'Proposed routes', coverage: 'Drone coverage', atmosphere: 'Smoke & atmosphere (Satellite)',
} as const;
export type MapLayer = keyof typeof MAP_LAYERS;
export interface MapSettings { mode: MapMode; layers: Record<MapLayer, boolean> }
export const DEFAULT_MAP_SETTINGS: MapSettings = {
  mode: 'outline',
  layers: { contours: true, roads: true, buildings: false, places: true, units: true, findings: true,
    fire: true, projection: false, actions: false, coverage: false, atmosphere: true },
};
const KEY = 'fcc.map';
const listeners = new Set<() => void>();

/** Validate saved settings, including old/unknown fields, without changing incident state. */
export function parseMapSettings(raw: unknown): MapSettings {
  const out = { mode: DEFAULT_MAP_SETTINGS.mode, layers: { ...DEFAULT_MAP_SETTINGS.layers } };
  if (!raw || typeof raw !== 'object') return out;
  const input = raw as Partial<MapSettings>;
  if (input.mode === 'outline' || input.mode === 'satellite') out.mode = input.mode;
  if (input.layers && typeof input.layers === 'object') {
    for (const k of Object.keys(MAP_LAYERS) as MapLayer[]) {
      if (typeof input.layers[k] === 'boolean') out.layers[k] = input.layers[k];
    }
  }
  return out;
}
let current = parseMapSettings(null);
if (typeof window !== 'undefined') {
  try { current = parseMapSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { /* optional */ }
}
export const getMapSettings = () => current;
export function onMapSettingsChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function commit(next: MapSettings) {
  current = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* optional */ }
  listeners.forEach((fn) => fn());
}
export const setMapMode = (mode: MapMode) => commit({ ...current, mode });
export const setMapLayer = (key: MapLayer, visible: boolean) => commit({ ...current, layers: { ...current.layers, [key]: visible } });
export const resetMapSettings = () => commit(parseMapSettings(null));
export const useMapSettings = () => useSyncExternalStore(onMapSettingsChange, getMapSettings, () => DEFAULT_MAP_SETTINGS);
