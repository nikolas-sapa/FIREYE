import type { ScenarioPack } from '../contracts';
import { RasterSampler } from './raster';

const samplerCache = new WeakMap<ScenarioPack, RasterSampler>();

/** One sampler per pack, shared by the stage and the feed renderer. */
export function getSampler(pack: ScenarioPack): RasterSampler {
  let s = samplerCache.get(pack);
  if (!s) {
    s = new RasterSampler(pack);
    samplerCache.set(pack, s);
  }
  return s;
}
