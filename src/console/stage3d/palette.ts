import * as Cesium from 'cesium';
import { color as ds, role } from '@ds';

/** Cesium colors derived from design tokens. Never hardcode colors in the stage. */
const c = (hex: string, a = 1) => Cesium.Color.fromCssColorString(hex).withAlpha(a);

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
  signal: c(ds.signal.DEFAULT),
  signalHot: c(ds.signal.hot),
  signalDeep: c(ds.signal.deep),
  ember: c(ds.ember),
  amber: c(ds.amber),
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
