import type { Ms } from '../../contracts';
import type { SensorModel } from './sensors';
import type { RiskSample, SensorReading } from './types';

export interface SectorRisk { sector: string; value: number; ffwi: number; minFmc: number; gustKph: number; alarms: number }

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Ignition-risk index per sector, 0..100, from the IoT readings at t only (weather, fuel moisture,
 * gusts and detector alarms). Readings never consult future fire arrival, so the index is causal.
 * A simulated planning aid, not a validated fire-danger rating.
 */
export function sectorRisk(model: SensorModel, t: Ms): SectorRisk[] {
  const readings = model.all(t);
  const bySector = new Map<string, SensorReading[]>();
  model.specs.forEach((s, i) => {
    const list = bySector.get(s.sector) ?? [];
    list.push(readings[i]);
    bySector.set(s.sector, list);
  });
  const out: SectorRisk[] = [];
  for (const [sector, list] of bySector) {
    const live = list.filter((r) => r.status !== 'offline');
    const use = live.length ? live : list;
    const ffwi = use.reduce((a, r) => a + r.ffwi, 0) / use.length;
    const minFmc = Math.min(...use.map((r) => r.fmc));
    const gustKph = Math.max(...use.map((r) => r.gustKph));
    const alarms = list.filter((r) => r.status === 'alarm' || r.status === 'offline').length;
    const dryness = clamp01((9 - minFmc) / 6);
    const gust = clamp01((gustKph - 25) / 55);
    const base = 0.5 * ffwi + 22 * dryness + 18 * gust;
    const value = Math.min(100, base + Math.min(20, alarms * 7));
    out.push({ sector, value: Math.round(value * 10) / 10, ffwi, minFmc, gustKph, alarms });
  }
  return out.sort((a, b) => b.value - a.value);
}

const curves = new WeakMap<SensorModel, Map<string, RiskSample[]>>();

/** Peak sector risk sampled every `stepMin` minutes (the timeline curve). */
export function riskCurve(model: SensorModel, from: Ms, to: Ms, stepMin = 5): RiskSample[] {
  const key = `${from}/${to}/${stepMin}`;
  const cache = curves.get(model) ?? new Map<string, RiskSample[]>();
  curves.set(model, cache);
  const hit = cache.get(key);
  if (hit) return hit;
  const out: RiskSample[] = [];
  for (let t = from; t <= to; t += stepMin * 60000) {
    const top = sectorRisk(model, t)[0];
    out.push({ t, value: top?.value ?? 0, sector: top?.sector ?? '' });
  }
  cache.set(key, out);
  return out;
}

export const RISK_WATCH = 68;
export const RISK_ALERT = 72;
export function riskBand(v: number): 'low' | 'elevated' | 'high' | 'extreme' {
  return v >= 88 ? 'extreme' : v >= RISK_ALERT ? 'high' : v >= RISK_WATCH ? 'elevated' : 'low';
}
