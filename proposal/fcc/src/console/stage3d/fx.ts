import * as Cesium from 'cesium';
import { color as ds } from '@ds';
import type { Feed, FeedFx } from '../contracts';
import { FIRE, glsl3 } from './palette';

/**
 * Camera models for the feed renderer. Each runs after the atmosphere pass and turns a clean render into
 * what that sensor would deliver: optics (barrel distortion, vignetting, chromatic aberration), sensor
 * (noise, rolling shutter, AGC / auto exposure, NUC on thermal cores), and transport (H.264 / JPEG
 * blocking, chroma subsampling).
 */
export type CameraModel = 'uav-eo' | 'ir-white' | 'ir-iron' | 'dash' | 'helmet' | 'phone' | 'ridge' | 'lltv' | 'sat';

export function modelFor(feed: Pick<Feed, 'kind' | 'fx'>): CameraModel {
  if (feed.fx === 'ir-whitehot') return 'ir-white';
  if (feed.fx === 'ir-ironbow') return 'ir-iron';
  if (feed.fx === 'night') return 'lltv';
  if (feed.kind === 'satellite' || feed.fx === 'sat') return 'sat';
  if (feed.kind === 'social' || feed.fx === 'phone') return 'phone';
  if (feed.kind === 'dash-cam') return 'dash';
  if (feed.kind === 'helmet-cam') return 'helmet';
  if (feed.kind === 'ridge-cam') return 'ridge';
  return 'uav-eo';
}

export const isThermal = (m: CameraModel) => m === 'ir-white' || m === 'ir-iron';

const COMMON = `
uniform sampler2D colorTexture;
uniform float time;
uniform vec2 res;
uniform float exposure;
uniform float motion;
uniform float nuc;
uniform float shake;
in vec2 v_textureCoordinates;
float fx_hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fx_luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float fx_vignette(vec2 uv, float k) { vec2 d = uv - 0.5; return 1.0 - k * dot(d, d) * 2.2; }
vec3 fx_tex(vec2 uv) { return texture(colorTexture, clamp(uv, vec2(0.001), vec2(0.999))).rgb; }
/* Filmic shoulder so flames roll off instead of clipping flat. */
vec3 fx_tone(vec3 c) { c = max(c, 0.0); return (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14); }
/* Bloom from bright pixels (flames, sun). */
vec3 fx_bloom(vec2 uv, float r) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    float rr = r * (0.5 + 0.5 * fract(float(i) * 0.618));
    vec3 s = fx_tex(uv + vec2(cos(a), sin(a)) * rr / res);
    acc += max(s - 0.72, 0.0);
  }
  return acc / 12.0;
}
/* Macroblock compression: flat blocks lose detail, edges keep it (H.264 / JPEG look). */
vec3 fx_blocks(vec2 uv, vec3 c, float bs, float k) {
  vec2 b = (floor(uv * res / bs) + 0.5) * bs / res;
  vec2 o = 0.3 * bs / res;
  vec3 m = (fx_tex(b + vec2(-o.x, -o.y)) + fx_tex(b + vec2(o.x, -o.y)) + fx_tex(b + vec2(-o.x, o.y)) + fx_tex(b + o)) * 0.25;
  float detail = length(c - m);
  c = mix(c, m, k * (1.0 - smoothstep(0.02, 0.12, detail)));
  /* 4:2:0 chroma: chroma from the block, luma from the pixel */
  vec3 cb = fx_tex(b);
  return vec3(fx_luma(c)) + (cb - vec3(fx_luma(cb))) * 0.9;
}
vec2 fx_barrel(vec2 uv, float k1, float k2, float zoom) {
  vec2 p = (uv - 0.5) * 2.0;
  float asp = res.x / res.y;
  p.x *= asp;
  /* radius normalised to the half-diagonal, and the corner mapped back onto the corner, so the
     distortion never samples outside the rendered frame (clamped edges smear into streaks) */
  float r2 = dot(p, p) / (asp * asp + 1.0);
  p *= (1.0 + k1 * r2 + k2 * r2 * r2) / ((1.0 + k1 + k2) * zoom);
  p.x /= res.x / res.y;
  return p * 0.5 + 0.5;
}
`;

const IRONBOW = `
vec3 fx_ironbow(float v) {
  vec3 c0 = ${glsl3(ds.void)};
  vec3 c1 = ${glsl3(ds.violet)} * 0.42;
  vec3 c2 = ${glsl3(FIRE.ember)} * 0.85;
  vec3 c3 = ${glsl3(FIRE.signal)};
  vec3 c4 = ${glsl3(FIRE.amber)};
  vec3 c5 = ${glsl3(ds.bone.DEFAULT)};
  if (v < 0.25) return mix(c0, c1, v / 0.25);
  if (v < 0.5) return mix(c1, c2, (v - 0.25) / 0.25);
  if (v < 0.7) return mix(c2, c3, (v - 0.5) / 0.2);
  if (v < 0.86) return mix(c3, c4, (v - 0.7) / 0.16);
  return mix(c4, c5, (v - 0.86) / 0.14);
}
`;

/* Thermal core: input is a temperature image from the atmosphere pass. */
const THERMAL = (palette: string) => `${COMMON}${IRONBOW}
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / res;
  /* microbolometers are soft: 3x3 blur */
  float T = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) T += fx_tex(uv + vec2(float(i), float(j)) * px).r * (i == 0 && j == 0 ? 0.36 : 0.08);
  /* AGC: ambient terrain spread over the lower half of the range, hot ground and flame rolled off on top */
  float h = T < 0.6 ? (T - 0.24) / 0.36 * 0.6 : 0.6 + 0.4 * (1.0 - exp(-(T - 0.6) * 3.0));
  h *= exposure;
  float fpn = (fx_hash(vec2(floor(uv.x * res.x), 3.0)) - 0.5) * 0.035 + (fx_hash(vec2(7.0, floor(uv.y * res.y))) - 0.5) * 0.012;
  h += fpn + (fx_hash(uv * res + floor(time * 30.0) * motion) - 0.5) * 0.03;
  h = mix(h, 0.46 + fpn * 0.4, nuc);
  h = clamp(h, 0.0, 1.0) * fx_vignette(uv, 0.3);
  ${palette}
}`;

const SHADERS: Record<CameraModel, string> = {
  'ir-white': THERMAL('out_FragColor = vec4(vec3(h), 1.0);'),
  'ir-iron': THERMAL('out_FragColor = vec4(fx_ironbow(pow(h, 1.1)), 1.0);'),
  'uav-eo': `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 px = 1.0 / res;
  /* lateral chromatic aberration toward the frame edge */
  vec2 d = (uv - 0.5) * 0.0016;
  vec3 c = vec3(fx_tex(uv + d).r, fx_tex(uv).g, fx_tex(uv - d).b);
  vec3 blur = (fx_tex(uv + vec2(px.x, 0.0)) + fx_tex(uv - vec2(px.x, 0.0)) + fx_tex(uv + vec2(0.0, px.y)) + fx_tex(uv - vec2(0.0, px.y))) * 0.25;
  c = c + (c - blur) * 0.55;
  c = fx_blocks(uv, c, 8.0, 0.55);
  c += fx_bloom(uv, 9.0) * 0.9;
  c = fx_tone(c * exposure * 1.05);
  c = mix(vec3(fx_luma(c)), c, 0.9);
  c += (fx_hash(uv * res + floor(time * 30.0) * motion) - 0.5) * 0.03 * (1.2 - fx_luma(c));
  c *= fx_vignette(uv, 0.32);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
  ridge: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec3 c = fx_tex(uv);
  c = fx_blocks(uv, c, 8.0, 0.45);
  c += fx_bloom(uv, 7.0) * 0.6;
  c = fx_tone(c * exposure);
  c = mix(vec3(fx_luma(c)), c, 0.82);
  c += (fx_hash(uv * res + floor(time * 15.0) * motion) - 0.5) * 0.045;
  c *= fx_vignette(uv, 0.25);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
  dash: `${COMMON}
void main() {
  vec2 uv0 = v_textureCoordinates;
  /* rolling shutter: rows read out top to bottom while the cab vibrates */
  float rs = (sin(uv0.y * 9.0 + time * 37.0) * 0.6 + sin(uv0.y * 23.0 - time * 53.0) * 0.4) * 0.0022 * motion * (0.4 + shake);
  vec2 uv = fx_barrel(uv0 + vec2(rs, 0.0), 0.16, 0.05, 1.02);
  vec3 c = fx_tex(uv);
  c = fx_blocks(uv0, c, 8.0, 0.6);
  c += fx_bloom(uv, 14.0) * 1.3;
  /* windshield: dust specks and a faint veil that glows against bright sky */
  float dust = smoothstep(0.93, 1.0, fx_hash(floor(uv0 * vec2(180.0, 100.0))));
  c += dust * 0.05 + fx_luma(fx_bloom(uv, 40.0)) * 0.25;
  c = fx_tone(c * exposure * 1.1);
  c = mix(vec3(fx_luma(c)), c, 1.18);
  /* dashboard edge with a dim reflection of the scene */
  float dash = smoothstep(0.115, 0.085, uv0.y + sin(uv0.x * 3.14) * 0.02);
  vec3 refl = fx_tex(vec2(uv0.x, 0.2 - uv0.y)) * 0.08;
  c = mix(c, refl, dash);
  c += (fx_hash(uv0 * res + floor(time * 30.0) * motion) - 0.5) * 0.04;
  c *= fx_vignette(uv0, 0.75);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
  helmet: `${COMMON}
void main() {
  vec2 uv0 = v_textureCoordinates;
  float rs = sin(uv0.y * 6.0 + time * 19.0) * 0.003 * motion * (0.3 + shake);
  vec2 uv = fx_barrel(uv0 + vec2(rs, 0.0), 0.28, 0.08, 1.03);
  vec3 c = fx_tex(uv);
  vec3 b = (fx_tex(uv + vec2(1.5, 0.0) / res) + fx_tex(uv - vec2(1.5, 0.0) / res)) * 0.5;
  c = c + (c - b) * 0.9;
  c = fx_blocks(uv0, c, 8.0, 0.5);
  c += fx_bloom(uv, 12.0) * 1.1;
  c = fx_tone(c * exposure * 1.08);
  c = mix(vec3(fx_luma(c)), c, 1.25);
  c += (fx_hash(uv0 * res + floor(time * 30.0) * motion) - 0.5) * 0.04;
  c *= fx_vignette(uv0, 0.9);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
  phone: `${COMMON}
void main() {
  vec2 uv0 = v_textureCoordinates;
  float rs = sin(uv0.y * 5.0 + time * 13.0) * 0.0025 * motion * shake;
  vec2 uv = uv0 + vec2(rs, 0.0);
  vec3 c = fx_tex(uv);
  vec3 b = (fx_tex(uv + vec2(1.0, 0.0) / res) + fx_tex(uv - vec2(1.0, 0.0) / res) + fx_tex(uv + vec2(0.0, 1.0) / res) + fx_tex(uv - vec2(0.0, 1.0) / res)) * 0.25;
  c = c + (c - b) * 1.1;
  c += fx_bloom(uv, 10.0) * 1.0;
  /* auto exposure: metering pumps when flames enter the frame, highlights clip */
  c = c * exposure * 1.15;
  c = mix(fx_tone(c), clamp(c, 0.0, 1.0), 0.35);
  c = mix(vec3(fx_luma(c)), c, 1.15);
  c = fx_blocks(uv0, c, 8.0, 0.75);
  /* JPEG ringing on edges */
  float e = length(c - fx_tex(uv + vec2(2.0, 0.0) / res));
  c += (fx_hash(floor(uv0 * res / 2.0)) - 0.5) * 0.06 * smoothstep(0.08, 0.3, e);
  c += (fx_hash(uv0 * res + floor(time * 30.0) * motion) - 0.5) * 0.05;
  c *= fx_vignette(uv0, 0.45);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
  lltv: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec3 c = fx_tex(uv);
  float l = fx_luma(c) + fx_luma(fx_bloom(uv, 10.0)) * 1.5;
  l = pow(clamp(l * 2.4 * exposure, 0.0, 1.0), 0.8);
  l += (fx_hash(uv * res + floor(time * 30.0) * motion) - 0.5) * 0.18;
  vec3 o = ${glsl3(ds.phosphor)} * l * 0.9 + vec3(l) * 0.12;
  o *= fx_vignette(uv, 0.9);
  out_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
}`,
  sat: `${COMMON}
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 block = 6.0 / res;
  vec2 buv = (floor(uv / block) + 0.5) * block;
  vec3 c = fx_tex(buv);
  float l = fx_luma(c);
  c = mix(vec3(l), c, 0.85);
  c = (c - 0.5) * 1.25 + 0.48;
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
};

export interface CameraUniforms {
  time: number;
  exposure: number;
  motion: number;
  nuc: number;
  shake: number;
}

export function createCameraStages(scene: Cesium.Scene, u: CameraUniforms): Record<CameraModel, Cesium.PostProcessStage> {
  const out = {} as Record<CameraModel, Cesium.PostProcessStage>;
  for (const k of Object.keys(SHADERS) as CameraModel[]) {
    const st = new Cesium.PostProcessStage({
      name: `fcc-cam-${k}`,
      fragmentShader: SHADERS[k],
      uniforms: {
        time: () => u.time,
        exposure: () => u.exposure,
        motion: () => u.motion,
        nuc: () => u.nuc,
        shake: () => u.shake,
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
uniform float daylight;
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
  c *= mix(0.32, 1.0, daylight);
  out_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
    uniforms: { saturation: opts.saturation, vignette: opts.vignette, daylight: 1 },
  });
  scene.postProcessStages.add(st);
  return st;
}

export const FX_LABEL: Record<FeedFx, string> = {
  eo: 'EO · DAY',
  'ir-ironbow': 'IR · IRONBOW',
  'ir-whitehot': 'IR · WHITE-HOT',
  night: 'LLTV · NIGHT',
  phone: 'PHONE · 1080P',
  sat: 'SAT · TRUE COLOUR',
};

export const MODEL_LABEL: Record<CameraModel, string> = {
  'uav-eo': 'EO · H.264',
  'ir-white': 'LWIR · WHITE-HOT',
  'ir-iron': 'LWIR · IRONBOW',
  dash: 'DASH · 1080P',
  helmet: 'ACTION CAM · 2.7K',
  phone: 'PHONE · 1080P',
  ridge: 'PTZ · 1080P',
  lltv: 'LLTV · NIGHT',
  sat: 'SAT · TRUE COLOUR',
};
