import type { StageCapabilities } from './types';

/**
 * URL override for the basemap path: `?tokens=0` (or `?basemap=offline`) forces the offline pack
 * basemap even when tokens are configured; `?tokens=ion` skips Google 3D tiles.
 */
function tokenOverride(): 'all' | 'none' | 'ion' {
  if (typeof window === 'undefined') return 'all';
  try {
    const q = new URLSearchParams(window.location.search);
    const t = (q.get('tokens') ?? '').toLowerCase();
    const b = (q.get('basemap') ?? '').toLowerCase();
    if (t === '0' || t === 'off' || t === 'none' || b === 'offline') return 'none';
    if (t === 'ion' || b === 'ion') return 'ion';
  } catch {
    /* ignore */
  }
  return 'all';
}

/** Which token-gated data paths are configured. Everything renders without them (offline fallback). */
export function getStageCapabilities(): StageCapabilities {
  const env = import.meta.env;
  const o = tokenOverride();
  return {
    cesium: o !== 'none' && typeof env.VITE_CESIUM_ION_TOKEN === 'string' && env.VITE_CESIUM_ION_TOKEN.trim().length > 0,
    google: o === 'all' && typeof env.VITE_GOOGLE_MAPS_KEY === 'string' && env.VITE_GOOGLE_MAPS_KEY.trim().length > 0,
  };
}

let webgl2: boolean | null = null;
/** True when the browser can create a WebGL context at all. */
export function hasWebGL(): boolean {
  if (webgl2 !== null) return webgl2;
  try {
    const c = document.createElement('canvas');
    webgl2 = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    webgl2 = false;
  }
  return webgl2;
}
