/** Join class names, dropping falsy values. */
export function cn(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(' ');
}

/** Zero-padded integer, e.g. pad(7, 3) -> "007". */
export const pad = (n: number, width = 2) => String(Math.trunc(n)).padStart(width, '0');

/** Format decimal degrees as "34.0522°N". */
export const fmtLat = (d: number, p = 4) => `${Math.abs(d).toFixed(p)}°${d >= 0 ? 'N' : 'S'}`;
export const fmtLon = (d: number, p = 4) => `${Math.abs(d).toFixed(p)}°${d >= 0 ? 'E' : 'W'}`;

/** Zulu clock string HH:MM:SSZ. */
export const zulu = (date = new Date()) =>
  `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`;
