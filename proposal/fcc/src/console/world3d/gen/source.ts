import type { ScenarioPack } from '../../contracts';
import { hashString } from '../rng';
import { LocalFrame } from '../frame';
import type { CuratedSite, SourceImagery, WorldSource } from '../types';

/** Convert the pack into the compact local-metre source the generator worker owns. */
export function buildSource(pack: ScenarioPack, clc: Uint16Array | null, opts: { imagery?: SourceImagery; sites?: CuratedSite[]; scar?: { lon: number; lat: number; r: number } } = {}): WorldSource {
  const frame = new LocalFrame(pack.manifest.center.lon, pack.manifest.center.lat, pack.raster.bbox);
  const roads = pack.roads.filter(r => r.coords.length > 1).map(r => {
    const pts = new Float32Array(r.coords.length * 2), cum = new Float32Array(r.coords.length);
    r.coords.forEach((c, i) => {
      pts[i * 2] = frame.x(c.lon); pts[i * 2 + 1] = frame.z(c.lat);
      if (i) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    });
    return { kind: r.kind, pts, cum };
  });
  const buildings = pack.buildings.map(b => ({ x: frame.x(b.pos.lon), z: frame.z(b.pos.lat), kind: b.kind ?? '', id: hashString(b.id) }));
  return {
    grid: { w: pack.raster.w, h: pack.raster.h, bbox: pack.raster.bbox, center: pack.manifest.center, elevation: pack.elevation, fuel: pack.fuel, clc },
    roads, buildings, imagery: opts.imagery, sites: opts.sites ?? [],
    scar: opts.scar ? { x: frame.x(opts.scar.lon), z: frame.z(opts.scar.lat), r: opts.scar.r } : undefined,
  };
}
