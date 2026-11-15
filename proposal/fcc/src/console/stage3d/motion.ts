import type { Geo, Unit } from '../contracts';

interface Sample { at: number; lon: number; lat: number; alt: number; heading: number }
type Axis = 'lon' | 'lat' | 'alt' | 'heading';
export const MOTION_DELAY_MS = 250;
export const angleDelta = (a: number, b: number) => ((b - a) % 360 + 540) % 360 - 180;

/** Shape-preserving cubic interpolation. Shared endpoint derivatives avoid packet-boundary jerks,
 * while the monotone slope limiter prevents overshoot at stops and road corners. */
function slope(a: Sample | undefined, b: Sample, c: Sample | undefined, axis: Axis) {
  if (!a || !c) return 0;
  const h0 = b.at - a.at, h1 = c.at - b.at;
  const d0 = (b[axis] - a[axis]) / h0, d1 = (c[axis] - b[axis]) / h1;
  if (d0 * d1 <= 0) return 0;
  const w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}

export class UnitMotion {
  private tracks = new Map<string, Sample[]>();

  update(units: Unit[], at: number, reset = false) {
    if (reset) this.tracks.clear();
    const seen = new Set<string>();
    for (const u of units) {
      seen.add(u.id);
      const list = this.tracks.get(u.id) ?? [];
      const previous = list[list.length - 1];
      const heading = previous ? previous.heading + angleDelta(previous.heading, u.heading) : u.heading;
      const sample = { at, lon: u.pos.lon, lat: u.pos.lat, alt: u.pos.alt ?? 0, heading };
      if (previous && at <= previous.at) list[list.length - 1] = sample;
      else list.push(sample);
      if (list.length > 12) list.shift();
      this.tracks.set(u.id, list);
    }
    for (const id of this.tracks.keys()) if (!seen.has(id)) this.tracks.delete(id);
  }

  private value(u: Unit, now: number, axis: Axis): number {
    const list = this.tracks.get(u.id);
    if (!list?.length) return axis === 'heading' ? u.heading : u.pos[axis] ?? 0;
    const at = now - MOTION_DELAY_MS;
    if (at <= list[0].at) return list[0][axis];
    const last = list[list.length - 1];
    if (at >= last.at) return last[axis]; // Never invent motion after telemetry stops.
    let i = 0;
    while (list[i + 1].at < at) i++;
    const a = list[i], b = list[i + 1];
    if (a[axis] === b[axis]) return a[axis]; // Preserve exact holds, including non-binary GPS coordinates.
    const h = b.at - a.at, t = (at - a.at) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * a[axis] + (t3 - 2 * t2 + t) * h * slope(list[i - 1], a, b, axis)
      + (-2 * t3 + 3 * t2) * b[axis] + (t3 - t2) * h * slope(a, b, list[i + 2], axis);
  }

  position(u: Unit, now: number, out: Geo = { lon: 0, lat: 0 }): Geo {
    out.lon = this.value(u, now, 'lon'); out.lat = this.value(u, now, 'lat'); out.alt = this.value(u, now, 'alt');
    return out;
  }
  heading(u: Unit, now: number) { return (this.value(u, now, 'heading') % 360 + 360) % 360; }
}
