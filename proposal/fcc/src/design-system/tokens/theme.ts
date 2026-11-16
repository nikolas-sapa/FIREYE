/**
 * Runtime theme switch. Two themes share every token name; `data-theme` on <html> swaps the values
 * (see tokens.css). JS consumers (canvas, WebGL, Cesium) read the live accent through `getAccent()`
 * or the `color.signal` getters and re-render on `onThemeChange`.
 */
import { useSyncExternalStore } from 'react';

export type ThemeId = 'fcc' | 'team';

export interface ThemeAccent {
  DEFAULT: string;
  hot: string;
  deep: string;
  wash: string;
}

export interface ThemeSpec {
  id: ThemeId;
  label: string;
  description: string;
  accent: ThemeAccent;
  /** Warning status hue. Team shifts it to yellow so nothing in the chrome reads as orange. */
  amber: string;
  sans: string;
  mono: string;
}

export const THEMES: Record<ThemeId, ThemeSpec> = {
  fcc: {
    id: 'fcc',
    label: 'FCC',
    description: 'Fire-orange signal, Inter Tight + JetBrains Mono',
    accent: { DEFAULT: '#FF5A1F', hot: '#FF8A4C', deep: '#C23A0C', wash: '#2E140C' },
    amber: '#FFB800',
    sans: '"Inter Tight Variable", ui-sans-serif, system-ui, sans-serif',
    mono: '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, monospace',
  },
  team: {
    id: 'team',
    label: 'Team',
    description: 'Blue #006BFF signal, Geist + Geist Mono, no orange in the chrome',
    accent: { DEFAULT: '#006BFF', hot: '#4D94FF', deep: '#0052CC', wash: '#031633' },
    amber: '#F5C518',
    sans: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
    mono: '"Geist Mono Variable", ui-monospace, SFMono-Regular, monospace',
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
export const THEME_STORAGE_KEY = 'fcc.theme';
/** Fired on `window` after the theme changes; `detail` is `{ theme: ThemeId; accent: ThemeAccent }`. */
export const THEME_EVENT = 'fcc:themechange';

const isTheme = (v: unknown): v is ThemeId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(THEMES, v);
const hasDom = typeof window !== 'undefined' && typeof document !== 'undefined';

let current: ThemeId = 'fcc';
const listeners = new Set<(t: ThemeId) => void>();

/**
 * The product is locked to the FCC brand theme. The Team tokens stay defined (and `setTheme` still
 * works for code that asks), but no saved, query or attribute choice selects them at start-up.
 */
function readInitial(): ThemeId {
  if (!hasDom) return 'fcc';
  try {
    if (window.localStorage.getItem(THEME_STORAGE_KEY) !== 'fcc') window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* storage can throw in private mode */
  }
  return 'fcc';
}

function apply(id: ThemeId) {
  current = id;
  if (!hasDom) return;
  document.documentElement.dataset.theme = id;
}

/** Current theme id. */
export function getTheme(): ThemeId {
  return current;
}

/** Spec of the current theme (accent hexes, font stacks). */
export function getThemeSpec(): ThemeSpec {
  return THEMES[current];
}

/** Live accent (signal) hexes of the current theme. */
export function getAccent(): ThemeAccent {
  return THEMES[current].accent;
}

/** Reads any token from the live CSS (e.g. `cssToken('signal')` → "#006BFF"). Falls back to `fallback` off-DOM. */
export function cssToken(name: string, fallback = '#000000'): string {
  if (!hasDom) return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return raw || fallback;
  return '#' + parts.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Switches theme. Persists to localStorage `fcc.theme` unless `persist` is false. */
export function setTheme(id: ThemeId, opts: { persist?: boolean } = {}) {
  if (!isTheme(id)) return;
  const changed = id !== current;
  apply(id);
  if (hasDom && opts.persist !== false) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  }
  if (!changed) return;
  listeners.forEach((fn) => fn(id));
  if (hasDom) window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme: id, accent: THEMES[id].accent } }));
}

export function toggleTheme() {
  setTheme(current === 'fcc' ? 'team' : 'fcc');
}

/** Subscribe to theme changes; returns an unsubscribe function. */
export function onThemeChange(fn: (theme: ThemeId) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React hook: current theme id, re-renders on change. */
export function useTheme(): ThemeId {
  return useSyncExternalStore(onThemeChange, getTheme, () => 'fcc' as ThemeId);
}

// Applied at import so the first paint already uses the chosen theme. A `?theme=` override is not persisted.
apply(readInitial());
