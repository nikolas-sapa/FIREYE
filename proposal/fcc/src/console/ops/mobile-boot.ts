import type { Geo, Ms } from '../contracts';
import type { Visibility } from '../fireye/shell/ui';

export const NARROW_QUERY = '(max-width: 767px)';

export function skipCivilianBoot(search: string, width: number, view: string): boolean {
  const boot = new URLSearchParams(search).get('boot');
  if (boot === '1') return false;
  return boot === '0' || (view === 'civilian' && width < 768);
}

/** Phones open on a burning, spreading fire rather than the pre-ignition minutes. */
export const RESIDENT_MOBILE_LEAD_MIN = 18;
export function residentMobileStart(ignition: Ms, start: Ms, end: Ms): Ms {
  return Math.max(start, Math.min(end, ignition + RESIDENT_MOBILE_LEAD_MIN * 60000));
}

/** Resident phone map: fire, places and roads only; responder fleet, sensors and labels hidden (display-only). */
export const RESIDENT_MOBILE_VIS: Visibility = {
  fleet: false, groundUnits: false, flightPaths: false, groundCams: false, iot: false, footprints: false,
  findings: false, fireFront: true, projections: false, risk: false, roadsPlaces: true, labels: false,
};

const M_PER_DEG_LAT = 110540;

/** Top-down-ish camera that fits the fire and the resident's location across the narrow viewport. */
export function fireFrame(home: Geo, fire: Geo[], width: number, height: number, fovRad = Math.PI / 3): { center: Geo; rangeM: number } {
  const pts = [home, ...fire];
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const p of pts) { w = Math.min(w, p.lon); e = Math.max(e, p.lon); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
  const center = { lon: (w + e) / 2, lat: (s + n) / 2 };
  const mPerDegLon = 111320 * Math.cos((center.lat * Math.PI) / 180);
  const spanX = (e - w) * mPerDegLon, spanY = (n - s) * M_PER_DEG_LAT;
  // Cesium's fov spans the larger canvas dimension.
  const t = Math.tan(fovRad / 2) / Math.max(width, height);
  const halfW = Math.max(1, width) * t, halfH = Math.max(1, height) * t;
  const rangeM = Math.max(spanX / 2 / halfW, spanY / 2 / halfH) * 2.4;
  return { center, rangeM: Math.max(4000, Math.min(30000, rangeM)) };
}
