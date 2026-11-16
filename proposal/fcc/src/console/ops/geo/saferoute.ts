import type { Geo } from '../../contracts';
import { alertStage, pointInPolygon, type Hazard, type Road } from './evac';

interface HazardEntry { t: number; bands: { horizonMin: number; polygon: Geo[] }[] }
interface KnownPerimeter { t: number; polygon: Geo[][] }

export function routingHazardAt(t: number, entries: HazardEntry[], perimeters: KnownPerimeter[]): Hazard | null {
  const entry = entries.filter((e) => e.t <= t).sort((a, b) => b.t - a.t)[0];
  if (!entry) return null;
  const perimeter = perimeters.filter((p) => p.t <= t).sort((a, b) => b.t - a.t)[0];
  const band = (h: number) => entry.bands.filter((b) => b.horizonMin === h && b.polygon.length >= 3).map((b) => b.polygon);
  return { blocked: [...band(60), ...(perimeter?.polygon ?? [])], caution: band(180) };
}

export function residentEstimateAt(pos: Geo, t: number, entries: HazardEntry[], perimeters: KnownPerimeter[]) {
  const entry = entries.filter((e) => e.t <= t).sort((a, b) => b.t - a.t)[0];
  const band = entry?.bands.filter((b) => pointInPolygon(pos, b.polygon)).sort((a, b) => a.horizonMin - b.horizonMin)[0];
  const hazard = routingHazardAt(t, entries, perimeters);
  const inBlocked = hazard?.blocked.some((p) => pointInPolygon(pos, p)) ?? false;
  const eta = entry && band ? entry.t + band.horizonMin * 60000 : null;
  const etaMin = eta === null ? null : Math.max(0, Math.round((eta - t) / 60000));
  return { eta, etaMin, inBlocked, stage: alertStage(etaMin, inBlocked) };
}

export function inScenario(p: Geo, bbox: readonly number[]): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lon >= bbox[0] && p.lat >= bbox[1] && p.lon <= bbox[2] && p.lat <= bbox[3];
}

const greek: Record<string, string> = { α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o' };
const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ου/g, 'ou').replace(/[α-ω]/g, (c) => greek[c] ?? c).replace(/[^a-z0-9]/g, '');
export type LocationResult = { pos: Geo; name: string } | { error: string };
export function parseLocation(text: string, places: { name: string; pos: Geo }[], roads: Road[], bbox: readonly number[]): LocationResult {
  const m = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(text);
  let hit: { pos: Geo; name: string } | undefined;
  if (m) hit = { pos: { lat: Number(m[1]), lon: Number(m[2]) }, name: 'Custom location' };
  else {
    const q = normalize(text);
    if (q) {
      const candidates = [...places, ...roads.filter((r) => r.name && r.coords.length).map((r) => ({ name: r.name!, pos: r.coords[Math.floor(r.coords.length / 2)] }))];
      hit = candidates.find((p) => normalize(p.name) === q) ?? candidates.find((p) => normalize(p.name).includes(q));
    }
  }
  if (!hit) return { error: 'No matching place or road. Try lat, lon.' };
  return inScenario(hit.pos, bbox) ? { name: hit.name, pos: hit.pos } : { error: 'Outside the exercise area. Current location kept.' };
}
