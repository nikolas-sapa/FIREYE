import { daylight, sunPosition } from '../stage3d/sun';

const DEG = Math.PI / 180;

export interface WeatherInput {
  tempC: number | null;
  rh: number | null;
  windKph: number | null;
  windFromDeg: number | null;
  gustKph: number | null;
  precipMm: number | null;
  cloud?: number | null;
  /** Human-readable provenance, e.g. "MET Norway forecast" or "ERA5 reanalysis". */
  source: string;
}
export interface EnvInput {
  view: string;
  /** Epoch ms of the world clock at `anchorPerfMs`. */
  timeMs: number;
  /** Live views follow the wall clock; historical views advance in real time from the case time. */
  live: boolean;
  /** False for replay-driven environments: timeMs is the authoritative playhead, even while paused. */
  advance?: boolean;
  lat: number;
  lon: number;
  weather: WeatherInput;
}
export function environmentTime(input: Pick<EnvInput, 'timeMs' | 'live' | 'advance'>, elapsedMs: number, wallMs: number) {
  return input.live ? wallMs : input.timeMs + (input.advance === false ? 0 : Math.max(0, elapsedMs));
}
export interface EnvOverrides { hour?: number; dayOfYear?: number; precipMm?: number; windKph?: number; windFromDeg?: number; cloud?: number; rh?: number; tempC?: number }

export type Vec3 = [number, number, number];
export interface WorldEnv {
  t: number;
  localHour: number;
  utcOffsetMin: number;
  dayOfYear: number;
  season: 'winter' | 'spring' | 'summer' | 'autumn';
  sunDir: Vec3;
  sunEl: number;
  moonDir: Vec3;
  moonEl: number;
  moonIllum: number;
  daylight: number;
  night: number;
  sunColor: Vec3;
  sunIntensity: number;
  moonIntensity: number;
  ambient: number;
  skyZenith: Vec3;
  skyHorizon: Vec3;
  ground: Vec3;
  fogColor: Vec3;
  fogDensity: number;
  visibilityKm: number;
  cloud: number;
  rain: number;
  wet: number;
  windX: number;
  windZ: number;
  windMs: number;
  windKph: number;
  windFromDeg: number;
  gust: number;
  tempC: number;
  rh: number;
  /** 0 green … 1 fully cured annual grasses. */
  curing: number;
  /** Deciduous foliage fraction. */
  leaf: number;
  /** Illustrative 0–1 dryness index (curing, humidity, heat, rain); not a fire-danger rating. */
  dryness: number;
  weatherSource: string;
  assumed: string[];
}

/** Greek civil time: EET (UTC+2), EEST (UTC+3) from the last Sunday of March to the last Sunday of October, 01:00 UTC. */
export function athensOffsetMin(t: number): number {
  const y = new Date(t).getUTCFullYear();
  const lastSunday = (m: number) => { const d = new Date(Date.UTC(y, m + 1, 0, 1)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime(); };
  return t >= lastSunday(2) && t < lastSunday(9) ? 180 : 120;
}

export function dayOfYear(t: number, offsetMin: number) {
  const d = new Date(t + offsetMin * 60000);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

/** Low-precision lunar position (about 1°) and illuminated fraction. */
export function moonPosition(t: number, lat: number, lon: number) {
  const d = t / 86400000 - 10957.5;
  const L = (218.316 + 13.176396 * d) * DEG, M = (134.963 + 13.064993 * d) * DEG, F = (93.272 + 13.22935 * d) * DEG;
  const l = L + 6.289 * DEG * Math.sin(M), b = 5.128 * DEG * Math.sin(F), e = 23.4397 * DEG;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const H = (280.16 + 360.9856235 * d) * DEG + lon * DEG - ra, phi = lat * DEG;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const ls = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const elong = Math.acos(Math.max(-1, Math.min(1, Math.cos(b) * Math.cos(l - ls))));
  return { azDeg: az / DEG, elDeg: el / DEG, illum: (1 - Math.cos(elong)) / 2 };
}

const dir = (azDeg: number, elDeg: number): Vec3 => {
  const az = azDeg * DEG, el = elDeg * DEG;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
};
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function ramp(keys: [number, Vec3][], x: number): Vec3 {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (x <= keys[i][0]) {
    const [x0, a] = keys[i - 1], [x1, b] = keys[i], t = (x - x0) / (x1 - x0);
    return lerp3(a, b, t * t * (3 - 2 * t));
  }
  return keys[keys.length - 1][1];
}
/** Monthly curve sampled at mid-month, interpolated by day of year. */
function monthly(values: number[], doy: number) {
  const m = ((doy - 15) / 30.44 + 12) % 12, i = Math.floor(m), f = m - i;
  return values[i] + (values[(i + 1) % 12] - values[i]) * f;
}
// Attica annual grasses: green through winter rains, curing May–June, fully cured July–September.
const CURING = [0.1, 0.06, 0.08, 0.25, 0.6, 0.88, 1, 1, 0.97, 0.8, 0.45, 0.2];
const LEAF = [0.1, 0.12, 0.45, 0.85, 1, 1, 1, 1, 0.95, 0.85, 0.55, 0.2];

const ZENITH: [number, Vec3][] = [[-18, [0.002, 0.003, 0.009]], [-8, [0.01, 0.018, 0.05]], [-2, [0.06, 0.09, 0.2]], [4, [0.14, 0.26, 0.52]], [20, [0.16, 0.34, 0.7]]];
const HORIZON: [number, Vec3][] = [[-18, [0.004, 0.005, 0.012]], [-8, [0.05, 0.04, 0.07]], [-2, [0.5, 0.24, 0.16]], [3, [0.86, 0.55, 0.34]], [10, [0.75, 0.72, 0.68]], [25, [0.58, 0.7, 0.84]]];
const SUN: [number, Vec3][] = [[-2, [1, 0.32, 0.12]], [3, [1, 0.55, 0.3]], [12, [1, 0.86, 0.68]], [30, [1, 0.96, 0.9]]];

export function computeEnv(input: EnvInput, o: EnvOverrides = {}): WorldEnv {
  const assumed: string[] = [];
  let t = input.timeMs;
  let offset = athensOffsetMin(t);
  if (o.dayOfYear !== undefined) {
    const local = new Date(t + offset * 60000);
    const start = Date.UTC(local.getUTCFullYear(), 0, 1);
    const ms = (t + offset * 60000) - (start + (dayOfYear(t, offset) - 1) * 86400000);
    t = start + (o.dayOfYear - 1) * 86400000 + ms - offset * 60000;
    offset = athensOffsetMin(t);
  }
  if (o.hour !== undefined) {
    const local = t + offset * 60000, midnight = Math.floor(local / 86400000) * 86400000;
    t = midnight + o.hour * 3600000 - offset * 60000;
  }
  const localHour = ((((t + offset * 60000) / 3600000) % 24) + 24) % 24;
  const doy = dayOfYear(t, offset);
  const w = input.weather;
  const pick = (ov: number | undefined, v: number | null | undefined, fallback: number, name: string) => {
    if (ov !== undefined) return ov;
    if (v !== null && v !== undefined && Number.isFinite(v)) return v;
    assumed.push(name); return fallback;
  };
  const summer = doy > 150 && doy < 280;
  const tempC = pick(o.tempC, w.tempC, summer ? 29 : 15, 'temperature');
  const rh = pick(o.rh, w.rh, summer ? 35 : 65, 'humidity');
  const windKph = pick(o.windKph, w.windKph, 8, 'wind speed');
  const windFromDeg = pick(o.windFromDeg, w.windFromDeg, 0, 'wind direction');
  const gustKph = w.gustKph ?? windKph * 1.6;
  const precip = pick(o.precipMm, w.precipMm, 0, 'precipitation');
  const rain = clamp(precip / 4);
  const cloud = clamp(o.cloud ?? w.cloud ?? (precip > 0.05 ? 0.85 : clamp((rh - 55) / 60)));

  const sun = sunPosition(t, input.lat, input.lon), moon = moonPosition(t, input.lat, input.lon);
  const day = daylight(sun.elDeg), night = 1 - day;
  const overcast = cloud * cloud;
  const grey: Vec3 = [0.42 * day + 0.004, 0.45 * day + 0.005, 0.48 * day + 0.008];
  const haze = summer && rh < 50 ? 0.25 : 0;
  let zenith = ramp(ZENITH, sun.elDeg), horizon = ramp(HORIZON, sun.elDeg);
  horizon = lerp3(horizon, [horizon[0] * 1.05 + 0.03 * day, horizon[1] * 1.0 + 0.02 * day, horizon[2] * 0.9], haze);
  zenith = lerp3(zenith, grey, overcast * 0.85);
  horizon = lerp3(horizon, lerp3(grey, [0.55 * day, 0.57 * day, 0.6 * day], 0.4), overcast * 0.8);
  const moonUp = clamp(moon.elDeg / 8 + 0.2);
  const moonIntensity = night * moonUp * (0.03 + 0.17 * moon.illum) * (1 - 0.85 * overcast);
  const sunIntensity = clamp((sun.elDeg + 1.5) / 6) * 2.9 * (1 - 0.82 * overcast);
  const visibilityKm = Math.max(2.5, 34 * (1 - 0.55 * Math.pow(rh / 100, 3)) * (1 - 0.45 * haze * 2) * (1 - 0.8 * rain));
  const fogColor = lerp3(horizon, zenith, 0.25);
  const to = (windFromDeg + 180) * DEG, ms = windKph / 3.6;
  const curingBase = monthly(CURING, doy);
  const curing = clamp(curingBase - (precip > 0.2 ? 0.08 : 0) - (rh > 80 ? 0.05 : 0) + (tempC > 33 && rh < 25 ? 0.04 : 0));
  const wet = precip > 0.05 ? clamp(0.55 + precip / 3) : rh > 92 ? 0.25 : 0;
  const dryness = clamp(0.55 * curing + 0.25 * (1 - rh / 100) + 0.2 * clamp((tempC - 10) / 30) - 0.35 * wet);
  const season = doy < 80 || doy >= 356 ? 'winter' : doy < 172 ? 'spring' : doy < 266 ? 'summer' : 'autumn';
  return {
    t, localHour, utcOffsetMin: offset, dayOfYear: doy, season,
    sunDir: dir(sun.azDeg, sun.elDeg), sunEl: sun.elDeg, moonDir: dir(moon.azDeg, moon.elDeg), moonEl: moon.elDeg, moonIllum: moon.illum,
    daylight: day, night, sunColor: ramp(SUN, sun.elDeg), sunIntensity, moonIntensity,
    ambient: 0.12 + 0.75 * day * (0.85 + 0.3 * overcast) + 0.6 * moonIntensity,
    skyZenith: zenith, skyHorizon: horizon, ground: lerp3([0.02, 0.02, 0.025], [0.32, 0.29, 0.22], day),
    fogColor, fogDensity: 1.97 / (visibilityKm * 1000), visibilityKm, cloud, rain, wet,
    windX: Math.sin(to) * ms, windZ: -Math.cos(to) * ms, windMs: ms, windKph, windFromDeg, gust: clamp((gustKph - windKph) / 30),
    tempC, rh, curing, leaf: monthly(LEAF, doy), dryness,
    weatherSource: o.precipMm !== undefined || o.windKph !== undefined || o.cloud !== undefined ? `${w.source} · manual override` : w.source,
    assumed,
  };
}
