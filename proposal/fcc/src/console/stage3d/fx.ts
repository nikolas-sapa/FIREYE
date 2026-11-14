import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import type { FeedFx } from '../contracts';
import { glsl3 } from './palette';

const COMMON = `
uniform sampler2D colorTexture;
uniform float time;
uniform vec2 res;
in vec2 v_textureCoordinates;
float fx_hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fx_luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float fx_vignette(vec2 uv, float k) {
  vec2 d = uv - 0.5;
  return 1.0 - k * dot(d, d) * 2.2;
}
/* Fire-ish pixels (saturated warm & bright) read hot in thermal modes; local contrast keeps terrain legible. */
float fx_heat(vec3 c, vec3 blur) {
  float l = fx_luma(c);
  float hp = (l - fx_luma(blur)) * 2.6;
  float warm = clamp((c.r - c.b) * 1.6, 0.0, 1.0) * smoothstep(0.25, 0.75, c.r);
  float white = smoothstep(0.78, 0.95, l);
  return clamp(0.22 + l * 0.9 + hp + warm * 0.7 + white * 0.5, 0.0, 1.0);
}
vec3 fx_blur(vec2 uv, vec2 px) {
  return (texture(colorTexture, uv + vec2(px.x, px.y) * 3.0).rgb + texture(colorTexture, uv + vec2(-px.x, px.y) * 3.0).rgb
    + texture(colorTexture, uv + vec2(px.x, -px.y) * 3.0).rgb + texture(colorTexture, uv - px * 3.0).rgb) * 0.25;
}
`;

/** Ironbow built from tokens: void -> violet -> ember -> signal -> amber -> bone. */
const IRONBOW = `
vec3 fx_ironbow(float v) {
  vec3 c0 = ${glsl3(ds.void)};
  vec3 c1 = ${glsl3(ds.violet)} * 0.42;
  vec3 c2 = ${glsl3(ds.ember)} * 0.85;
  vec3 c3 = ${glsl3(ds.signal.DEFAULT)};
  vec3 c4 = ${glsl3(ds.amber)};
  vec3 c5 = ${glsl3(ds.bone.DEFAULT)};
  if (v < 0.25) return mix(c0, c1, v / 0.25);
  if (v < 0.5) return mix(c1, c2, (v - 0.25) / 0.25);
  if (v < 0.7) return mix(c2, c3, (v - 0.5) / 0.2);
  if (v < 0.86) return mix(c3, c4, (v - 0.7) / 0.16);
  return mix(c4, c5, (v - 0.86) / 0.14);
}
`;

const SHADERS: Record<FeedFx, string> = {
  'ir-ironbow': `${COMMON}${IRONBOW}
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / res;
  vec3 c = texture(colorTexture, uv).rgb * 0.4 + (texture(colorTexture, uv + vec2(px.x, 0.0)).rgb + texture(colorTexture, uv - vec2(px.x, 0.0)).rgb + texture(colorTexture, uv + vec2(0.0, px.y)).rgb + texture(colorTexture, uv - vec2(0.0, px.y)).rgb) * 0.15;
  float h = fx_heat(c, fx_blur(uv, px));
  h = clamp(h + (fx_hash(uv * res + time * 61.0) - 0.5) * 0.05, 0.0, 1.0);
  vec3 o = fx_ironbow(pow(h, 1.15));
  o *= fx_vignette(uv, 0.45);
  out_FragColor = vec4(o, 1.0);
}`,
  'ir-whitehot': `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / res;
  vec3 c = texture(colorTexture, uv).rgb * 0.5 + (texture(colorTexture, uv + px).rgb + texture(colorTexture, uv - px).rgb) * 0.25;
  float h = fx_heat(c, fx_blur(uv, px));
  h = pow(h, 1.4);
  h += (fx_hash(uv * res + time * 47.0) - 0.5) * 0.06;
  float row = fx_hash(vec2(floor(uv.y * res.y), floor(time * 9.0))) * 0.02;
  vec3 o = vec3(clamp(h + row, 0.0, 1.0));
  o *= fx_vignette(uv, 0.35);
  out_FragColor = vec4(o, 1.0);
}`,
  eo: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / res;
  vec3 c = texture(colorTexture, uv).rgb;
  vec3 blur = (texture(colorTexture, uv + vec2(px.x, 0.0)).rgb + texture(colorTexture, uv - vec2(px.x, 0.0)).rgb + texture(colorTexture, uv + vec2(0.0, px.y)).rgb + texture(colorTexture, uv - vec2(0.0, px.y)).rgb) * 0.25;
  c = c + (c - blur) * 0.7;
  float l = fx_luma(c);
  c = mix(vec3(l), c, 0.78);
  c = (c - 0.5) * 1.12 + 0.5;
  c += (fx_hash(uv * res + time * 37.0) - 0.5) * 0.045;
  c *= fx_vignette(uv, 0.4);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
  night: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec3 c = texture(colorTexture, uv).rgb;
  float l = fx_luma(c);
  l = pow(clamp(l * 2.1, 0.0, 1.0), 0.8);
  l += (fx_hash(uv * res + time * 71.0) - 0.5) * 0.18;
  vec3 o = ${glsl3(ds.phosphor)} * l * 0.9 + vec3(l) * 0.12;
  o *= fx_vignette(uv, 0.9);
  out_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
}`,
  phone: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 block = 8.0 / res;
  vec2 buv = (floor(uv / block) + 0.5) * block;
  vec3 c = texture(colorTexture, uv).rgb;
  vec3 b = texture(colorTexture, buv).rgb;
  float edge = fx_hash(floor(uv / block) + floor(time * 4.0));
  c = mix(c, b, 0.28 + 0.25 * step(0.82, edge));
  // Chroma from the block, luma from the pixel (cheap 4:2:0 look).
  float l = fx_luma(c);
  vec3 chroma = b - fx_luma(b);
  c = vec3(l) + chroma * 0.55;
  c = mix(vec3(fx_luma(c)), c, 0.75) * vec3(1.03, 1.0, 0.95);
  c = (c - 0.5) * 1.18 + 0.52;
  c += (fx_hash(uv * res + time * 29.0) - 0.5) * 0.05;
  c *= fx_vignette(uv, 0.55);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
  sat: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 block = 6.0 / res;
  vec2 buv = (floor(uv / block) + 0.5) * block;
  vec3 c = texture(colorTexture, buv).rgb;
  float l = fx_luma(c);
  c = mix(vec3(l), c, 0.85);
  c = (c - 0.5) * 1.25 + 0.48;
  float scan = 0.96 + 0.04 * step(0.5, fract(uv.y * res.y / 3.0));
  c *= scan;
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
};

export function createFeedFxStages(scene: Cesium.Scene, getTime: () => number): Record<FeedFx, Cesium.PostProcessStage> {
  const out = {} as Record<FeedFx, Cesium.PostProcessStage>;
  for (const k of Object.keys(SHADERS) as FeedFx[]) {
    const st = new Cesium.PostProcessStage({
      name: `fcc-feed-${k}`,
      fragmentShader: SHADERS[k],
      uniforms: {
        time: () => getTime(),
        res: () => new Cesium.Cartesian2(scene.drawingBufferWidth, scene.drawingBufferHeight),
      },
    });
    st.enabled = false;
    scene.postProcessStages.add(st);
    out[k] = st;
  }
  return out;
}

/** Stage-wide grade: slight desaturation, contrast, cool lift in blacks, vignette. */
export function createGradeStage(scene: Cesium.Scene, opts: { saturation: number; vignette: number }) {
  const st = new Cesium.PostProcessStage({
    name: 'fcc-grade',
    fragmentShader: `
uniform sampler2D colorTexture;
uniform float saturation;
uniform float vignette;
in vec2 v_textureCoordinates;
void main() {
  vec2 uv = v_textureCoordinates;
  vec3 c = texture(colorTexture, uv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.5) * 1.06 + 0.5;
  c = mix(${glsl3(ds.ink[950])}, vec3(1.0), c);
  vec2 d = uv - 0.5;
  c *= 1.0 - vignette * dot(d, d) * 2.0;
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
    uniforms: { saturation: opts.saturation, vignette: opts.vignette },
  });
  scene.postProcessStages.add(st);
  return st;
}

export const FX_LABEL: Record<FeedFx, string> = {
  eo: 'EO · DAY',
  'ir-ironbow': 'IR · IRONBOW',
  'ir-whitehot': 'IR · WHITE-HOT',
  night: 'LLTV · NIGHT',
  phone: 'PHONE · 720P',
  sat: 'VIIRS · 375 M',
};
