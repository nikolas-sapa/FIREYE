import * as Cesium from 'cesium';
import { THEMES, color as ds, getAccent, role } from '@ds';

/** Cesium colors derived from design tokens. Never hardcode colors in the stage. */
const cache = new Map<string, Cesium.Color>();
const c = (hex: string, a = 1) => {
  const k = `${hex}|${a}`;
  let v = cache.get(k);
  if (!v) {
    v = Cesium.Color.fromCssColorString(hex).withAlpha(a);
    cache.set(k, v);
  }
  return v;
};

/**
 * Fire and thermal colours are scenario data, not UI accent: they stay on the FCC fire ramp whatever
 * theme is active (the Team theme only swaps the chrome accent).
 */
export const FIRE = {
  ember: ds.ember,
  signal: THEMES.fcc.accent.DEFAULT,
  hot: THEMES.fcc.accent.hot,
  deep: THEMES.fcc.accent.deep,
  wash: THEMES.fcc.accent.wash,
  amber: THEMES.fcc.amber,
} as const;

export const pal = {
  void: c(ds.void),
  ink950: c(ds.ink[950]),
  ink900: c(ds.ink[900]),
  ink800: c(ds.ink[800]),
  ink600: c(ds.ink[600]),
  ink400: c(ds.ink[400]),
  ink300: c(ds.ink[300]),
  bone: c(ds.bone.DEFAULT),
  boneDim: c(ds.bone.dim),
  boneMute: c(ds.bone.mute),
  line: c(ds.line.DEFAULT),
  lineStrong: c(ds.line.strong),
  /** Live UI accent (follows the theme). */
  get signal() { return c(getAccent().DEFAULT); },
  get signalHot() { return c(getAccent().hot); },
  get signalDeep() { return c(getAccent().deep); },
  ember: c(ds.ember),
  /** Forecast / warning hue (follows the theme). */
  get amber() { return c(ds.amber); },
  phosphor: c(ds.phosphor),
  ice: c(ds.ice),
  violet: c(ds.violet),
  burnScar: c(role.burnScar),
};

export type PalKey = keyof typeof pal;

export const alpha = (k: PalKey, a: number) => pal[k].withAlpha(a);

/** CSS rgba() string for canvas drawing from a token hex. */
export function rgba(hex: string, a = 1): string {
  const col = Cesium.Color.fromCssColorString(hex);
  return `rgba(${Math.round(col.red * 255)},${Math.round(col.green * 255)},${Math.round(col.blue * 255)},${a})`;
}

export const hex = ds;

/** Normalized vec3 for GLSL from a token hex. */
export function glsl3(hexStr: string): string {
  const col = Cesium.Color.fromCssColorString(hexStr);
  return `vec3(${col.red.toFixed(4)}, ${col.green.toFixed(4)}, ${col.blue.toFixed(4)})`;
}
