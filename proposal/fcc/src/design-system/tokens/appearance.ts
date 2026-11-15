import { useSyncExternalStore } from 'react';
import { appearancePalette, rgb } from './appearance-palette';
import { getThemeSpec, onThemeChange } from './theme';

export type Appearance = 'auto' | 'light' | 'dark';
export const APPEARANCE_STORAGE_KEY = 'fcc.appearance';
const listeners = new Set<() => void>();
const dom = typeof window !== 'undefined' && typeof document !== 'undefined';
const valid = (v: unknown): v is Appearance => v === 'auto' || v === 'light' || v === 'dark';
let mode: Appearance = 'auto';
let solar: number | null = null;
/** Solar daylight claims in claim order; the newest claim with a value wins. */
const claims = new Map<symbol, number | null>();
const blendListeners = new Set<(blend: number) => void>();
let frame = 0;
let rendered = 0;
let target = 0;
let last = 0;
let initialized = false;
let lastMeta = '';
const system = dom ? window.matchMedia('(prefers-color-scheme: light)') : null;
const reduced = dom ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

if (dom) {
  try {
    const value = new URLSearchParams(location.search).get('appearance') ?? localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (valid(value)) mode = value;
  } catch { /* storage is optional */ }
}

export const getAppearance = () => mode;
export const getDaylightBlend = () => rendered;
export function onAppearanceChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
/** Called with the rendered day/night blend on every painted step, including animation frames. */
export function onDaylightRender(fn: (blend: number) => void) {
  blendListeners.add(fn);
  return () => { blendListeners.delete(fn); };
}
export function useAppearance() {
  return useSyncExternalStore(onAppearanceChange, getAppearance, () => 'auto' as Appearance);
}

function paint() {
  const root = document.documentElement;
  const p = appearancePalette(rendered, getThemeSpec());
  for (const [k, hex] of Object.entries(p)) root.style.setProperty(`--${k}`, rgb(hex).join(' '));
  root.dataset.appearance = mode;
  root.dataset.colorMode = rendered >= 0.5 ? 'light' : 'dark';
  root.style.colorScheme = rendered >= 0.5 ? 'light' : 'dark';
  root.style.setProperty('--daylight', rendered.toFixed(5));
  if (p['ink-950'] !== lastMeta) {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p['ink-950']);
    lastMeta = p['ink-950'];
  }
  blendListeners.forEach((fn) => fn(rendered));
}

function animate(now: number) {
  const dt = Math.min(100, Math.max(0, now - last));
  last = now;
  rendered += (target - rendered) * (1 - Math.exp(-dt / 450));
  if (Math.abs(target - rendered) < 0.0005) rendered = target;
  paint();
  frame = rendered === target ? 0 : requestAnimationFrame(animate);
}

function update() {
  if (!dom) return;
  target = mode === 'light' ? 1 : mode === 'dark' ? 0 : solar ?? (system?.matches ? 1 : 0);
  if (!initialized || reduced?.matches) {
    initialized = true;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    rendered = target;
    paint();
  } else if (!frame && target !== rendered) {
    last = performance.now();
    frame = requestAnimationFrame(animate);
  } else if (!frame) paint();
}

function resolveSolar() {
  let next: number | null = null;
  for (const v of claims.values()) if (v != null) next = v;
  if (next === solar) return;
  solar = next;
  update();
}

const clampSolar = (value: number | null) => (value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(1, value)));

export interface SolarClaim {
  set(value: number | null): void;
  /** Removes only this claim; another view's newer value stays in force. */
  release(): void;
}

/**
 * Scoped solar daylight for one view. A view that mounts while another unmounts keeps its value even
 * when the outgoing view's cleanup runs later, because a release only drops its own claim.
 */
export function claimSolarDaylight(): SolarClaim {
  const key = Symbol('solar');
  claims.set(key, null);
  return {
    set(value) {
      if (!claims.has(key)) return;
      claims.set(key, clampSolar(value));
      resolveSolar();
    },
    release() {
      if (claims.delete(key)) resolveSolar();
    },
  };
}

const legacyClaim = Symbol('solar-legacy');
/** Auto in the console follows the same solar factor as the map, not the computer's clock. */
export function setSolarDaylight(value: number | null) {
  const next = clampSolar(value);
  if (next == null) claims.delete(legacyClaim);
  else {
    claims.delete(legacyClaim);
    claims.set(legacyClaim, next);
  }
  resolveSolar();
}

export function setAppearance(value: Appearance, opts: { persist?: boolean } = {}) {
  if (!valid(value)) return;
  mode = value;
  if (dom && opts.persist !== false) {
    try { localStorage.setItem(APPEARANCE_STORAGE_KEY, value); } catch { /* optional */ }
  }
  update();
  listeners.forEach((fn) => fn());
}

if (dom) {
  onThemeChange(() => { paint(); });
  system?.addEventListener('change', update);
  reduced?.addEventListener('change', update);
  window.addEventListener('storage', (e) => {
    if (e.key === APPEARANCE_STORAGE_KEY) setAppearance(valid(e.newValue) ? e.newValue : 'auto', { persist: false });
  });
  update();
}
