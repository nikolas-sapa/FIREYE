import { useMemo } from 'react';
import type { Geo, Ms, Projection, ScenarioPack } from '../contracts';
import { useConsoleSelector } from '../store';

/** Interpolated acres at time t from the perimeter sequence. */
export function acresAt(pack: ScenarioPack | null, t: Ms): number {
  const p = pack?.perimeters;
  if (!p || p.length === 0) return 0;
  const first = p[0]!;
  if (t <= first.t) {
    const t0 = pack!.manifest.start;
    return t <= t0 ? 0 : first.acres * Math.max(0, Math.min(1, (t - t0) / Math.max(1, first.t - t0)));
  }
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!;
    const b = p[i]!;
    if (t <= b.t) return a.acres + ((b.acres - a.acres) * (t - a.t)) / Math.max(1, b.t - a.t);
  }
  return p[p.length - 1]!.acres;
}

export function weatherAt(pack: ScenarioPack | null, t: Ms) {
  const w = pack?.weather;
  if (!w || w.length === 0) return null;
  let best = w[0]!;
  for (const x of w) {
    if (x.t <= t) best = x;
    else break;
  }
  return best;
}

function pointInRing(pt: Geo, ring: Geo[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.lat > pt.lat !== b.lat > pt.lat && pt.lon < ((b.lon - a.lon) * (pt.lat - a.lat)) / (b.lat - a.lat || 1e-12) + a.lon) inside = !inside;
  }
  return inside;
}

/** Buildings inside the widest projection band. */
export function structuresThreatened(pack: ScenarioPack | null, proj: Projection | null): number {
  if (!pack || !proj || proj.bands.length === 0) return 0;
  const band = [...proj.bands].sort((a, b) => b.horizonMin - a.horizonMin)[0]!;
  const ring = band.polygon;
  if (ring.length < 3) return 0;
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const g of ring) {
    if (g.lon < w) w = g.lon;
    if (g.lon > e) e = g.lon;
    if (g.lat < s) s = g.lat;
    if (g.lat > n) n = g.lat;
  }
  let c = 0;
  for (const b of pack.buildings) {
    const p = b.pos;
    if (p.lon < w || p.lon > e || p.lat < s || p.lat > n) continue;
    if (pointInRing(p, ring)) c++;
  }
  return c;
}

/** Perimeter-based acres series for sparklines and the scrubber. */
export function acresSeries(pack: ScenarioPack | null) {
  if (!pack) return [];
  const pts = [{ t: pack.manifest.start, v: acresAt(pack, pack.manifest.start) }, ...pack.perimeters.map((p) => ({ t: p.t, v: p.acres }))];
  const last = pack.perimeters[pack.perimeters.length - 1];
  if (last && last.t < pack.manifest.end) pts.push({ t: pack.manifest.end, v: last.acres });
  return pts.filter((p) => p.t >= pack.manifest.start - 864e5 * 3).sort((a, b) => a.t - b.t);
}

/** Metrics for the stage strip, recomputed at the clock's minute resolution. */
export function useIncidentMetrics() {
  const pack = useConsoleSelector((s) => s.pack);
  const minute = useConsoleSelector((s) => Math.floor(s.clock.t / 60000));
  const projection = useConsoleSelector((s) => s.projection);
  const findings = useConsoleSelector((s) => s.findings);
  const items = useConsoleSelector((s) => s.items);
  const actions = useConsoleSelector((s) => s.actions);

  const t = minute * 60000;
  const acres = useMemo(() => acresAt(pack, t), [pack, t]);
  const wx = useMemo(() => weatherAt(pack, t), [pack, t]);
  const structures = useMemo(() => structuresThreatened(pack, projection), [pack, projection]);

  const lives = useMemo(() => {
    const rescued = new Set<string>();
    for (const a of actions) {
      if (a.kind !== 'rescue' || a.status !== 'done') continue;
      if (a.itemId) rescued.add(a.itemId);
      const it = items.find((i) => i.id === a.itemId);
      if (it) {
        rescued.add(it.refId);
        it.bundleOf?.forEach((m) => rescued.add(m));
      }
    }
    let n = 0;
    for (const f of findings) {
      if (f.kind !== 'human') continue;
      if (!f.live && f.freshness < 0.1) continue;
      if (rescued.has(f.id)) continue;
      n += f.count ?? 1;
    }
    return n;
  }, [findings, items, actions]);

  const containment = useMemo(() => {
    // Simulated: a point per completed or executing line/resource action. Caldor was 0 % through Aug 18.
    const done = actions.filter((a) => (a.kind === 'move-group' || a.kind === 'resource-order') && (a.status === 'done' || a.status === 'executing')).length;
    return Math.min(9, done);
  }, [actions]);

  return { acres, wx, structures, lives, containment, ros: projection?.rosMpm ?? null, headDir: projection?.headDirDeg ?? null };
}
