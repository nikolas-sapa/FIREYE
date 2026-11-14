import type { ThemeSpec } from './theme';

/** Chrome only. Scene, sensor pixels and fire colours keep their own physical/data palettes. */
export const DARK_SURFACES: Record<string, string> = {
  void: '#050506', 'ink-950': '#0A0A0B', 'ink-900': '#0F0F11', 'ink-850': '#141417',
  'ink-800': '#1A1A1E', 'ink-700': '#242429', 'ink-600': '#34343A', 'ink-500': '#4E4E56',
  'ink-400': '#6E6E76', 'ink-300': '#929298', 'ink-200': '#BEBDBA', 'ink-100': '#DEDCD7',
  bone: '#E8E6E1', 'bone-dim': '#B0AEA8', 'bone-mute': '#787773',
  'line-faint': '#1C1C20', line: '#28282D', 'line-strong': '#404046',
};

export const LIGHT_SURFACES: Record<string, string> = {
  void: '#DAE0E5', 'ink-950': '#EDF0F2', 'ink-900': '#F8F9FA', 'ink-850': '#F0F3F5',
  'ink-800': '#E5EAEE', 'ink-700': '#D7DEE4', 'ink-600': '#B8C3CD', 'ink-500': '#768591',
  'ink-400': '#586977', 'ink-300': '#435562', 'ink-200': '#2D3F4C', 'ink-100': '#192A36',
  bone: '#15232E', 'bone-dim': '#3B4D5B', 'bone-mute': '#526573',
  'line-faint': '#E1E6EB', line: '#CCD5DC', 'line-strong': '#9BAAB6',
};

export function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function contrast(a: string, b: string): number {
  const lum = (c: string) => rgb(c).map((v) => v / 255)
    .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Avoid the unreadable grey-on-grey midpoint of a naive foreground/background crossfade. */
function legible(fg: string, bg: string): string {
  if (contrast(fg, bg) >= 4.5) return fg;
  const pole = contrast('#FFFFFF', bg) >= contrast('#000000', bg) ? '#FFFFFF' : '#000000';
  let lo = 0, hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(fg, pole, mid), bg) >= 4.5) hi = mid;
    else lo = mid;
  }
  return mix(fg, pole, hi);
}

/** Shared by CSS application and numeric tests. t=0 night, t=1 day. */
export function appearancePalette(t: number, theme: ThemeSpec): Record<string, string> {
  t = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const p = Object.fromEntries(Object.entries(DARK_SURFACES).map(([k, v]) => [k, mix(v, LIGHT_SURFACES[k], t)]));
  const lightAccent = theme.id === 'team'
    ? { signal: '#0059D6', 'signal-hot': '#004DBB', 'signal-deep': '#003C99', 'signal-wash': '#DFEAFA' }
    : { signal: '#B53A0C', 'signal-hot': '#9B3009', 'signal-deep': '#802606', 'signal-wash': '#F5E5DD' };
  const dark = {
    signal: theme.accent.DEFAULT, 'signal-hot': theme.accent.hot, 'signal-deep': theme.accent.deep,
    'signal-wash': theme.accent.wash, ember: '#FF3B30', amber: theme.amber,
    phosphor: '#3DDC84', ice: '#5CC8FF', violet: '#A88CFF',
  };
  const light: Record<string, string> = {
    ...lightAccent, ember: '#B62328', amber: theme.id === 'team' ? '#796000' : '#865600',
    phosphor: '#17633E', ice: '#00658B', violet: '#6542AC',
  };
  for (const [k, v] of Object.entries(dark)) p[k] = mix(v, light[k], t);
  for (const k of ['bone', 'bone-dim', 'bone-mute', 'signal', 'ember', 'amber', 'phosphor', 'ice', 'violet']) {
    p[k] = legible(p[k], p['ink-900']);
  }
  // Primary-action text is independent of the surface ramp, including during twilight.
  p['on-signal'] = contrast('#FFFFFF', p.signal) > contrast('#0A0A0B', p.signal) ? '#FFFFFF' : '#0A0A0B';
  return p;
}
