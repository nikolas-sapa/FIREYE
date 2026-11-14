const DEG = Math.PI / 180;

/**
 * Solar azimuth (deg from north, clockwise) and elevation (deg) for an epoch time and location.
 * Low-precision almanac (about 0.01 deg), plenty for lighting.
 */
export function sunPosition(tMs: number, latDeg: number, lonDeg: number): { azDeg: number; elDeg: number } {
  const d = tMs / 86400000 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const H = (gmst * 15 + lonDeg) * DEG - ra;
  const lat = latDeg * DEG;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));
  return { azDeg: ((az / DEG) + 360) % 360, elDeg: el / DEG };
}

/** Unit vector toward the sun in local east-north-up. */
export function sunEnu(tMs: number, latDeg: number, lonDeg: number): [number, number, number] {
  const { azDeg, elDeg } = sunPosition(tMs, latDeg, lonDeg);
  const az = azDeg * DEG, el = elDeg * DEG;
  return [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
}

/** 0 at night, 1 in full day (civil twilight ramps between). */
export function daylight(elDeg: number): number {
  const k = Math.min(1, Math.max(0, (elDeg + 6) / 14));
  return k * k * (3 - 2 * k);
}
