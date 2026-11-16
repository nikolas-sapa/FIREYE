import type { Geo, ScenarioPack } from '../contracts';
import { localTime } from '../ui/format';
import { polygonDistanceM } from './geo/evac';

export function leaveByText(leaveAt: number | null, now: number, tz: string): string {
  return leaveAt == null ? '—' : leaveAt <= now ? 'Leave now' : `${localTime(leaveAt, tz)} ${tz}`;
}

export function residentSummary(pack: Pick<ScenarioPack, 'perimeters'> | null, now: number,
  home: { name: string; pos: Geo } | null, eta: number | null, tz: string): string {
  if (!home) return 'Choose your location to see nearby fire information.';
  const perimeter = pack?.perimeters.filter((p) => p.t <= now).at(-1);
  const rings = perimeter?.polygon.filter((ring) => ring.length >= 3) ?? [];
  if (!rings.length) return `No fire reported near ${home.name} yet.`;
  const distance = Math.min(...rings.map((ring) => polygonDistanceM(home.pos, ring)));
  if (distance === 0) return `Fire has reached ${home.name}. Follow 112 instructions now.`;
  const direction = eta != null ? 'spreading toward you' : 'not currently projected to reach you';
  return `Fire is ${(distance / 1000).toFixed(1)} km from ${home.name}, ${direction}.${eta != null ? ` Expected ${localTime(eta, tz)} ${tz}.` : ''}`;
}
