import type { StageCapabilities } from './types';

/** Which token-gated data paths are configured. Everything renders without them (offline fallback). */
export function getStageCapabilities(): StageCapabilities {
  const env = import.meta.env;
  return {
    cesium: typeof env.VITE_CESIUM_ION_TOKEN === 'string' && env.VITE_CESIUM_ION_TOKEN.trim().length > 0,
    google: typeof env.VITE_GOOGLE_MAPS_KEY === 'string' && env.VITE_GOOGLE_MAPS_KEY.trim().length > 0,
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
