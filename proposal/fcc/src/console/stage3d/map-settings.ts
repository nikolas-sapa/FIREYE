import { useSyncExternalStore } from 'react';
import type { FindingKind, UnitKind } from '../contracts';

export type MapMode = 'outline' | 'satellite';
export const MAP_LAYERS = {
  contours: 'Elevation contours', roads: 'Road outlines', buildings: 'Building outlines',
  places: 'Place labels', units: 'Show units', findings: 'Show findings',
  drones: 'Drones', helicopters: 'Helicopters', airplanes: 'Airplanes / tankers',
  engines: 'Fire engines', crews: 'Ground crews', dozers: 'Dozers', ems: 'Medical units', law: 'Law enforcement',
  unitLabels: 'Unit callsigns', trails: 'Movement trails', sensorFootprints: 'Drone sensor footprints', altitudeStems: 'Aircraft altitude stems',
  people: 'People', animals: 'Animals', structures: 'Structures', vehicles: 'Vehicles',
  hazards: 'Hazards & road blocks', fuel: 'Fuel observations', waterSources: 'Water sources', observations: 'Smoke & spot fires',
  findingLabels: 'Finding labels', uncertainty: 'Uncertainty areas',
  perimeter: 'Replay perimeter',
  fire: 'Fire surface & active edge', projection: 'Prediction bands',
  actions: 'Proposed routes', coverage: 'Drone coverage', atmosphere: 'Smoke & atmosphere (Satellite)',
} as const;
export type MapLayer = keyof typeof MAP_LAYERS;
export interface MapSettings { mode: MapMode; layers: Record<MapLayer, boolean> }
export const DEFAULT_MAP_SETTINGS: MapSettings = {
  mode: 'outline',
  layers: { contours: true, roads: true, buildings: true, places: true, units: true, findings: true,
    drones: true, helicopters: true, airplanes: true, engines: true, crews: true, dozers: true, ems: true, law: true,
    unitLabels: true, trails: true, sensorFootprints: true, altitudeStems: true,
    people: true, animals: true, structures: true, vehicles: true, hazards: true, fuel: true, waterSources: true, observations: true,
    findingLabels: true, uncertainty: true, perimeter: true,
    fire: true, projection: false, actions: false, coverage: false, atmosphere: true },
};
export const UNIT_LAYERS: Record<UnitKind, MapLayer> = {
  drone: 'drones', helo: 'helicopters', tanker: 'airplanes', engine: 'engines', crew: 'crews', dozer: 'dozers', ems: 'ems', law: 'law',
};
export const FINDING_LAYERS: Record<FindingKind, MapLayer> = {
  human: 'people', animal: 'animals', structure: 'structures', vehicle: 'vehicles', combustible: 'hazards', 'road-block': 'hazards',
  fuel: 'fuel', water: 'waterSources', smoke: 'observations', spot: 'observations',
};
export const MAP_LAYER_GROUPS: { label: string; parent?: 'units' | 'findings'; keys: MapLayer[] }[] = [
  { label: 'Geography', keys: ['contours', 'roads', 'buildings', 'places'] },
  { label: 'Units & aircraft', parent: 'units', keys: ['units', 'drones', 'helicopters', 'airplanes', 'engines', 'crews', 'dozers', 'ems', 'law', 'unitLabels', 'trails', 'sensorFootprints', 'altitudeStems'] },
  { label: 'Findings & detections', parent: 'findings', keys: ['findings', 'people', 'animals', 'structures', 'vehicles', 'hazards', 'fuel', 'waterSources', 'observations', 'findingLabels', 'uncertainty'] },
  { label: 'Incident layers', keys: ['fire', 'perimeter', 'projection', 'actions', 'coverage', 'atmosphere'] },
];
export const unitVisible = (layers: MapSettings['layers'], kind: UnitKind) => layers.units && layers[UNIT_LAYERS[kind]];
export const findingVisible = (layers: MapSettings['layers'], kind: FindingKind) => layers.findings && layers[FINDING_LAYERS[kind]];
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
    if (typeof input.layers.fire === 'boolean' && !Object.prototype.hasOwnProperty.call(input.layers, 'perimeter')) out.layers.perimeter = input.layers.fire;
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
export const setMapLayers = (patch: Partial<MapSettings['layers']>) => commit(parseMapSettings({ ...current, layers: { ...current.layers, ...patch } }));
export function airUnitsOnly() {
  setMapLayers({ ...Object.fromEntries(Object.entries(UNIT_LAYERS).map(([kind, key]) => [key, ['drone', 'helo', 'tanker'].includes(kind)])),
    units: true, findings: false });
}
export const basemapOnly = () => setMapLayers({ units: false, findings: false, fire: false, perimeter: false, projection: false, actions: false, coverage: false, atmosphere: false });
export const resetMapSettings = () => commit(parseMapSettings(null));
export const useMapSettings = () => useSyncExternalStore(onMapSettingsChange, getMapSettings, () => DEFAULT_MAP_SETTINGS);
