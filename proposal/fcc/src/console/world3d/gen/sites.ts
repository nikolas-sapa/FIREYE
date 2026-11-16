import { DEMO_FEEDS } from '../../monitoring/feed-motion';
import type { CuratedSite, DumpKind } from '../types';

const RAD = 180 / Math.PI;

/** Fictional analysis material placed in front of each fixed camera and under each drone orbit. */
export function curatedSites(frameX: (lon: number) => number, frameZ: (lat: number) => number): CuratedSite[] {
  const kinds: DumpKind[] = ['household', 'mixed', 'tyres', 'mixed', 'household', 'green'];
  return DEMO_FEEDS.map((f, i) => {
    const pose = f.pose;
    if (pose.mode === 'fixed' && pose.pos) {
      const dist = f.id === 'demo-ridge' ? 135 : f.id === 'demo-road' ? 32 : 30, side = f.id === 'demo-road' ? 8 : 3;
      const h = (pose.headingDeg ?? 0) / RAD;
      const x = frameX(pose.pos.lon) + Math.sin(h) * dist + Math.cos(h) * side, z = frameZ(pose.pos.lat) - Math.cos(h) * dist + Math.sin(h) * side;
      return { x, z, seed: 1000 + i, kind: kinds[i] };
    }
    const t = pose.target!;
    return { x: frameX(t.lon) + 40, z: frameZ(t.lat) - 30, seed: 1000 + i, kind: kinds[i] };
  });
}
