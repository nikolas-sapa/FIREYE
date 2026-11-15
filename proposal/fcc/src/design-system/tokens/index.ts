/**
 * FCC design tokens (TypeScript mirror of tokens.css).
 * Use these when you need raw values in JS (canvas/WebGL rendering, charts).
 * In JSX/CSS, prefer Tailwind utilities (bg-ink-900, text-signal, border-line).
 */

import { THEMES, getTheme } from './theme';

export * from './theme';
export * from './appearance';

/**
 * `signal` and `amber` are getters that follow the active theme (see theme.ts). Read them at draw
 * time, not once at module load, if the drawing should follow a theme switch.
 */
export const color = {
  void: '#050506',
  ink: {
    950: '#0A0A0B', 900: '#0F0F11', 850: '#141417', 800: '#1A1A1E', 700: '#242429',
    600: '#34343A', 500: '#4E4E56', 400: '#6E6E76', 300: '#929298', 200: '#BEBDBA', 100: '#DEDCD7',
  },
  bone: { DEFAULT: '#E8E6E1', dim: '#B0AEA8', mute: '#787773' },
  line: { faint: '#1C1C20', DEFAULT: '#28282D', strong: '#404046' },
  signal: {
    get DEFAULT() { return THEMES[getTheme()].accent.DEFAULT; },
    get hot() { return THEMES[getTheme()].accent.hot; },
    get deep() { return THEMES[getTheme()].accent.deep; },
    get wash() { return THEMES[getTheme()].accent.wash; },
  },
  ember: '#FF3B30',
  get amber() { return THEMES[getTheme()].amber; },
  phosphor: '#3DDC84',
  ice: '#5CC8FF',
  violet: '#A88CFF',
} as const;

/** Semantic roles — map meaning to color. Always pick by role, not by hue. */
export const role = {
  get accent() { return color.signal.DEFAULT; },
  danger: color.ember,
  get warning() { return color.amber; },
  nominal: color.phosphor,
  telemetry: color.ice,
  detection: color.violet,
  fireFront: color.ember,
  get fireForecast() { return color.amber; },
  burnScar: '#2A1610',
  drone: color.ice,
  crew: color.bone.DEFAULT,
  water: color.ice,
} as const;

export type Tone = 'neutral' | 'signal' | 'danger' | 'warning' | 'nominal' | 'telemetry' | 'detection';

/** Tailwind class fragments per tone. Components should use this map for consistency. */
export const toneClass: Record<Tone, { text: string; bg: string; border: string; dot: string }> = {
  neutral:   { text: 'text-bone-dim', bg: 'bg-ink-800',       border: 'border-line-strong', dot: 'bg-ink-300' },
  signal:    { text: 'text-signal',   bg: 'bg-signal/10',     border: 'border-signal/50',   dot: 'bg-signal' },
  danger:    { text: 'text-ember',    bg: 'bg-ember/10',      border: 'border-ember/50',    dot: 'bg-ember' },
  warning:   { text: 'text-amber',    bg: 'bg-amber/10',      border: 'border-amber/50',    dot: 'bg-amber' },
  nominal:   { text: 'text-phosphor', bg: 'bg-phosphor/10',   border: 'border-phosphor/40', dot: 'bg-phosphor' },
  telemetry: { text: 'text-ice',      bg: 'bg-ice/10',        border: 'border-ice/40',      dot: 'bg-ice' },
  detection: { text: 'text-violet',   bg: 'bg-violet/10',     border: 'border-violet/40',   dot: 'bg-violet' },
};

/** Font stacks of the active theme (FCC: Inter Tight + JetBrains Mono; Team: Geist + Geist Mono). */
export const font = {
  get sans() { return THEMES[getTheme()].sans; },
  get mono() { return THEMES[getTheme()].mono; },
} as const;

/** Type scale. `micro`/`nano`/`tiny` are always mono + uppercase + tracked (micrographics). */
export const type = [
  { token: '6xl', px: 120, use: 'Hero display only. One per page.' },
  { token: '5xl', px: 80, use: 'Section display.' },
  { token: '4xl', px: 56, use: 'Section title.' },
  { token: '3xl', px: 40, use: 'Large readouts (KPI numerals, mono).' },
  { token: '2xl', px: 28, use: 'Panel hero numbers / sub-section titles.' },
  { token: 'xl', px: 22, use: 'Card titles.' },
  { token: 'lg', px: 18, use: 'Lead paragraph.' },
  { token: 'base', px: 15, use: 'Body copy.' },
  { token: 'sm', px: 13, use: 'Dense UI body, table cells.' },
  { token: 'xs', px: 12, use: 'Secondary UI, button text.' },
  { token: 'tiny', px: 11, use: 'Mono data values, coordinates.' },
  { token: 'nano', px: 10, use: 'Mono labels, uppercase, tracked.' },
  { token: 'micro', px: 9, use: 'Micrographic annotations, serials, rulers.' },
] as const;

/** 4px base grid. */
export const space = { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96, 30: 120 } as const;

export const radius = { none: 0, hair: 1, xs: 2, sm: 3, DEFAULT: 4, md: 6, lg: 10, pill: 999 } as const;

export const motion = {
  ease: { servo: 'cubic-bezier(0.2,0,0,1)', snap: 'cubic-bezier(0.7,0,0.2,1)', settle: 'cubic-bezier(0.16,1,0.3,1)' },
  duration: { instant: 80, quick: 140, base: 220, slow: 420, drift: 900 },
} as const;

export const z = { base: 0, raised: 10, overlay: 40, hud: 50, modal: 80, toast: 90 } as const;

export const tokens = { color, role, font, type, space, radius, motion, z } as const;
export default tokens;
