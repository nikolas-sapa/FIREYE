import * as Cesium from 'cesium';
import { FuelClass, type ScenarioPack } from '../contracts';
import type { FireField } from './fire';
import { getProfile } from './profile';
import { SMOKE_H_MAX, type SmokeField } from './smoke';
import { daylight, sunEnu, sunPosition } from './sun';

/**
 * Scene-referred atmosphere, run as the first post-process of a scene:
 * - ray-marched wildfire smoke from the SmokeField (spectral extinction, so sunlight through the plume
 *   reddens and the plume reads brown-grey), fire glow lighting the column from below,
 * - near-ground smoke haze and distance haze,
 * - sun light and colour from the real solar position at the replay time (warm low sun, dusk),
 *   plume shadow on the ground,
 * - sky with sun disc and forward-scatter glow (feed cameras), water reflection and sun glint,
 * - heat shimmer over the active front,
 * - a thermal mode that outputs a temperature image for IR camera models (smoke mostly transparent).
 * All colours come from physics (Rayleigh/aerosol optical depth, Planck emission), not UI tokens.
 */
export type AtmosphereLook = 'stage' | 'camera' | 'thermal';

const FS = `
precision highp float;
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform sampler2D smokeA;
uniform sampler2D smokeB;
uniform sampler2D fireTex;
uniform sampler2D maskTex;
uniform float smokeMix;
uniform mat3 toLocal;
uniform vec3 camLocal;
uniform vec4 domain;   // minX, minY, size, plume ceiling
uniform vec4 bboxL;    // minX, minY, sizeX, sizeY (local metres)
uniform vec3 sunDir;   // local ENU
uniform vec3 wind;     // x, y m/s; z speed
uniform vec4 look;     // x real sky, y thermal, z daylight, w coastal
uniform vec4 tune;     // x smoke extinction /m, y base haze /m, z ground reference alt, w shimmer
uniform vec4 tune2;    // x sea level alt, y fire glow gain, z steps scale, w stage dimming
uniform float time;
in vec2 v_textureCoordinates;

const vec3 LAMBDA = vec3(680.0, 550.0, 440.0);
const float H_MAX = ${SMOKE_H_MAX.toFixed(1)};
const float R_EARTH = 6371000.0;

float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h13(i), b = h13(i + vec3(1, 0, 0)), c = h13(i + vec3(0, 1, 0)), d = h13(i + vec3(1, 1, 0));
  float e = h13(i + vec3(0, 0, 1)), g = h13(i + vec3(1, 0, 1)), h = h13(i + vec3(0, 1, 1)), k = h13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float hg(float cosT, float gg) {
  float g2 = gg * gg;
  float d = max(1.0 + g2 - 2.0 * gg * cosT, 1e-4);
  return (1.0 - g2) / (12.566 * d * sqrt(d));
}

/* Planck emission at three wavelengths, normalised at 550 nm. */
vec3 planck(float T) {
  vec3 l = LAMBDA * 1e-9;
  vec3 b = 1.0 / (pow(l, vec3(5.0)) * (exp(1.4388e-2 / (l * T)) - 1.0));
  return b / b.g;
}

/* Sun irradiance after the atmosphere: Rayleigh + aerosol optical depth through the air mass. */
vec3 sunColor(vec3 sd) {
  float el = max(sd.z, -0.02);
  float zen = degrees(acos(clamp(el, -1.0, 1.0)));
  float m = 1.0 / (max(el, 0.0) + 0.50572 * pow(max(96.07995 - zen, 0.5), -1.6364));
  vec3 tau = vec3(0.042, 0.098, 0.236) + 0.1 * pow(LAMBDA / 550.0, vec3(-1.3));
  float up = clamp((sd.z + 0.05) / 0.08, 0.0, 1.0);
  return exp(-tau * m) * (1.65 * up * up * (3.0 - 2.0 * up));
}
vec3 skyAmbient(vec3 s) {
  vec3 tau = vec3(0.042, 0.098, 0.236);
  /* the command stage keeps a legibility floor after sunset; camera looks get the true twilight */
  float dl = look.x > 0.5 ? look.z : max(look.z, 0.6);
  return (1.0 - exp(-tau)) * 2.3 * (0.03 + 0.97 * dl) + vec3(0.004, 0.005, 0.008);
}

float altOf(vec3 p) { return p.z + dot(p.xy, p.xy) / (2.0 * R_EARTH); }

vec4 smokeAt(vec2 xy) {
  vec2 uv = (xy - domain.xy) / domain.z;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  vec4 v = mix(texture(smokeA, uv), texture(smokeB, uv), smokeMix);
  return vec4(v.r, v.g * H_MAX, v.b * H_MAX, v.a);
}
vec2 bboxUv(vec2 xy) { return (xy - bboxL.xy) / bboxL.zw; }
bool inBox(vec2 uv) { return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0; }
vec4 fireAt(vec2 xy) { vec2 uv = bboxUv(xy); return inBox(uv) ? texture(fireTex, uv) : vec4(0.0); }
float heatNear(vec2 xy, float r) {
  float h = fireAt(xy).g * 0.4;
  h += fireAt(xy + vec2(r, 0.0)).g * 0.15 + fireAt(xy - vec2(r, 0.0)).g * 0.15;
  h += fireAt(xy + vec2(0.0, r)).g * 0.15 + fireAt(xy - vec2(0.0, r)).g * 0.15;
  return h;
}

/* Raw (log) depth into czm_windowToEyeCoordinates: it undoes the logarithmic depth itself. Using
   czm_readDepth with a plain inverse projection loses precision far away and misplaces hits. */
vec4 pixelToEye(vec2 uv) {
  float d = czm_unpackDepth(texture(depthTexture, uv));
  vec4 e = czm_windowToEyeCoordinates(gl_FragCoord.xy, d);
  return e / e.w;
}

vec3 skyColor(vec3 d, vec3 sc, vec3 amb) {
  float z = max(d.z, 0.0);
  vec3 zen = amb * 1.25;
  vec3 hor = sc * 0.32 + amb * 1.05;
  vec3 c = mix(hor, zen, pow(z, 0.45));
  float cs = dot(d, sunDir);
  c += sc * (0.22 * hg(cs, 0.78) + 0.02);
  c += sc * 30.0 * smoothstep(0.99996, 0.99999, cs);
  if (d.z < 0.0) c = mix(c, hor * 0.6, clamp(-d.z * 8.0, 0.0, 1.0));
  return c;
}

void main() {
  vec2 uv = v_textureCoordinates;
  vec2 res = czm_viewport.zw;
  float rawDepth = czm_readDepth(depthTexture, uv);
  bool sky = rawDepth >= 1.0;
  /* z = 0, not the far plane: Cesium's far plane is effectively at infinity, where w = 0 */
  vec4 ndcMid = czm_inverseProjection * vec4(2.0 * uv - 1.0, 0.0, 1.0);
  vec3 dirEye = normalize(ndcMid.xyz / ndcMid.w);
  vec3 dir = normalize(toLocal * (mat3(czm_inverseView) * dirEye));
  float dist = 1e9;
  if (!sky) dist = length(pixelToEye(uv).xyz);
  vec3 hit = camLocal + dir * min(dist, 2e6);
  float hitAlt = altOf(hit);

  vec3 sc = sunColor(sunDir);
  vec3 amb = skyAmbient(sunDir);
  /* Fresh wildfire smoke: weak spectral extinction (large particles) and brown-carbon absorption in the blue. */
  vec3 spec = pow(LAMBDA / 550.0, vec3(-0.7));
  vec3 albedo = vec3(0.9, 0.8, 0.64);
  float day = look.z;
  bool thermal = look.y > 0.5;
  bool real = look.x > 0.5;

  /* heat shimmer over the front */
  vec2 suv = uv;
  float hHit = 0.0;
  if (!sky) {
    hHit = heatNear(hit.xy, 60.0);
    float amp = tune.w * hHit * clamp(350.0 / max(dist, 1.0), 0.0, 1.5);
    if (amp > 0.001) {
      vec3 q = vec3(uv * vec2(110.0, 70.0), time * 5.0);
      suv += (vec2(vn3(q), vn3(q + 9.7)) - 0.5) * amp * 6.0 / res;
    }
  }
  vec3 col = texture(colorTexture, suv).rgb;
  vec4 fHit = sky ? vec4(0.0) : fireAt(hit.xy);
  vec2 bu = bboxUv(hit.xy);
  vec4 mask = inBox(bu) ? texture(maskTex, bu) : vec4(0.0);
  /* the 20 m mask scallops the shore at drone range; near the coast the streamed surface height decides */
  bool coastNear = look.w > 0.5 && (!inBox(bu) || mask.r > 0.02);
  bool water = !sky && (mask.r > 0.98 || (coastNear && hitAlt < tune2.x + 2.0));

  if (thermal) {
    float T;
    if (sky) T = 0.03 + 0.05 * (1.0 - max(dir.z, 0.0));
    else if (water) T = 0.2;
    else {
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      T = 0.28 + 0.22 * l * day + mask.g * 0.06;
      /* recently burned ground cools unevenly: smouldering pockets over a warm base */
      float pockets = smoothstep(0.55, 0.9, vn3(vec3(hit.xy / 18.0, 1.0)) * 0.6 + vn3(vec3(hit.xy / 6.0, 2.0)) * 0.4);
      T += fHit.r * (1.0 - fHit.b) * (0.1 + 0.55 * pockets);
      T += smoothstep(0.02, 0.5, fHit.g) * 1.4;
      float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
      if (l > 0.93 && sat < 0.08) T = max(T, 0.9);
      T *= 1.0 - 0.25 * clamp(dist / 9000.0, 0.0, 1.0);
    }
    /* Hot gas in the lower column reads warm; LWIR sees through most of the smoke. */
    float g = 0.0;
    int nT = 10;
    float tN = min(dist, 3000.0);
    for (int i = 0; i < 10; i++) {
      float t = (float(i) + 0.5) / float(nT) * tN;
      vec3 p = camLocal + dir * t;
      g += heatNear(p.xy, 120.0) * exp(-max(altOf(p) - tune.z, 0.0) / 90.0);
    }
    T += g * 0.06;
    out_FragColor = vec4(vec3(T), 1.0);
    return;
  }

  /* lighting of the visible surface: sun, ambient, plume shadow */
  if (!sky) {
    vec4 s0 = smokeAt(hit.xy);
    vec2 sxy = sunDir.xy / max(sunDir.z, 0.12);
    float mid = max(0.5 * (s0.g + s0.b), hitAlt + 300.0);
    vec4 s1 = smokeAt(hit.xy + sxy * (mid - hitAlt));
    vec3 shadowT = exp(-tune.x * s1.r * max(s1.b - s1.g, 300.0) * 0.45 * spec / max(sunDir.z, 0.12));
    vec3 light = sc * shadowT * 0.62 + amb * 0.55;
    float fireK = clamp(fHit.g * 2.5 + fHit.r * (1.0 - fHit.b) * 0.4, 0.0, 1.0);
    if (water) {
      /* Streamed imagery changes its sea colour between zoom levels (tile-stepped seams offshore), so the
         sea gets a physical deep-water albedo with only a trace of the imagery. */
      col = mix(vec3(0.018, 0.04, 0.052), col, 0.18);
      vec2 wq = hit.xy * 0.11 + vec2(time * 0.35, time * 0.21);
      vec2 grad = vec2(vn3(vec3(wq, time * 0.2)) - 0.5, vn3(vec3(wq + 5.3, time * 0.2)) - 0.5) * 0.09;
      vec3 n = normalize(vec3(grad, 1.0));
      vec3 r = reflect(dir, n);
      float fr = 0.02 + 0.98 * pow(1.0 - max(dot(-dir, n), 0.0), 5.0);
      vec3 refl = real ? skyColor(r, sc, amb) : amb * 0.3;
      vec3 glint = sc * shadowT * pow(max(dot(r, sunDir), 0.0), 700.0) * (real ? 40.0 : 6.0);
      col = mix(col * light, refl, fr * (real ? 0.85 : 0.35)) + glint;
    } else {
      vec3 lit = col * light;
      col = mix(real ? lit : mix(col, lit, 0.55), col, fireK);
    }
    /* fire light spill on nearby ground */
    col += planck(1300.0) * heatNear(hit.xy, 90.0) * 0.05 * (1.0 - fHit.g) * tune2.y;
  } else if (real) {
    col = skyColor(dir, sc, amb);
  }

  /* ray-march smoke + haze */
  vec3 inv = 1.0 / (dir + vec3(1e-6));
  vec3 bmin = vec3(domain.x, domain.y, tune.z - 40.0);
  vec3 bmax = vec3(domain.x + domain.z, domain.y + domain.z, domain.w);
  vec3 ta = (bmin - camLocal) * inv, tb = (bmax - camLocal) * inv;
  vec3 tmin = min(ta, tb), tmax = max(ta, tb);
  float t0 = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
  float t1 = min(min(tmax.x, tmax.y), tmax.z);
  t1 = min(t1, dist);
  vec3 T = vec3(1.0);
  vec3 L = vec3(0.0);
  if (t1 > t0) {
    int steps = int(clamp(18.0 * tune2.z + (t1 - t0) / 900.0, 12.0, 40.0));
    float dt = (t1 - t0) / float(steps);
    float jit = h13(vec3(gl_FragCoord.xy, fract(time) * 61.0));
    float cs = dot(dir, sunDir);
    float phS = hg(cs, 0.55) * 4.0 + 0.25;
    float phH = hg(cs, 0.7) * 3.0 + 0.4;
    vec3 adv = vec3(wind.xy * time, -time * 2.5);
    for (int i = 0; i < 40; i++) {
      if (i >= steps) break;
      float t = t0 + (float(i) + jit) * dt;
      vec3 p = camLocal + dir * t;
      float a = altOf(p);
      vec4 s = smokeAt(p.xy);
      float th = max(s.b - s.g, 60.0);
      float prof = smoothstep(s.g - 120.0, s.g + 0.25 * th, a) * (1.0 - smoothstep(s.b - 0.45 * th, s.b + 80.0, a));
      /* fade at the smoke domain walls so a plume leaving the grid does not end in a straight cut */
      float wall = min(min(p.x - domain.x, domain.x + domain.z - p.x), min(p.y - domain.y, domain.y + domain.z - p.y));
      float dens = s.r * prof * smoothstep(0.0, 0.08 * domain.z, wall);
      float hz = (tune.y + s.a * 3.2e-4) * exp(-max(a - tune.z, 0.0) / 520.0);
      vec3 emit = vec3(0.0);
      if (dens > 0.003) {
        vec3 q = p - adv;
        float n = vn3(q / 620.0) * 0.55 + vn3(q / 170.0) * 0.3 + vn3(q / 55.0) * 0.15;
        dens *= smoothstep(0.18, 0.78, n) * 1.8;
        float hn = heatNear(p.xy, 140.0);
        /* flame light reaches only the lowest part of the column above the fire (s.g ~ local ground there) */
        emit = planck(1450.0) * hn * exp(-max(a - s.g, 0.0) / 200.0) * 0.75 * tune2.y * (1.0 - 0.6 * day);
      }
      float se = dens * tune.x;
      vec3 ext = se * spec + hz * vec3(0.9, 1.0, 1.12);
      /* no continue statement here: loops with continue + break miscompile on some ANGLE/Metal drivers */
      if (ext.g >= 1e-7) {
        vec3 sunT = exp(-tune.x * s.r * max(s.b - a, 0.0) * 0.32 * spec / max(sunDir.z, 0.1));
        vec3 lumS = sc * sunT * phS + amb * 0.9;
        vec3 lumH = sc * phH * 0.8 + amb;
        vec3 scat = se * spec * albedo * lumS + hz * lumH + se * emit;
        vec3 stepT = exp(-ext * dt);
        L += T * scat * (1.0 - stepT) / max(ext, vec3(1e-7));
        T *= stepT;
      }
      if (T.g < 0.02) break;
    }
  }
  /* distance haze beyond the march */
  if (!sky || real) {
    float dd = sky ? 60000.0 : dist;
    float f = 1.0 - exp(-dd * tune.y * 0.35);
    vec3 fogC = real ? skyColor(normalize(vec3(dir.xy, 0.02)), sc, amb) : amb * 0.25;
    col = mix(col, fogC, f);
  }
  col = col * T + L * tune2.w;
  out_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

export interface AtmosphereOptions {
  look: AtmosphereLook;
  /** Scale of the step budget (feeds 1.4, stage 1). */
  quality?: number;
  shimmer?: boolean;
}

/** Local ENU frame of the scenario; also used by poses and the CPU smoke model. */
export function localFrame(pack: ScenarioPack) {
  const c = getProfile(pack).center;
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(c.lon, c.lat, 0));
  const inv = Cesium.Matrix4.inverseTransformation(enu, new Cesium.Matrix4());
  return { enu, inv, rot: Cesium.Matrix4.getMatrix3(inv, new Cesium.Matrix3()) };
}

const maskCache = new WeakMap<ScenarioPack, HTMLCanvasElement>();
function maskCanvas(pack: ScenarioPack): HTMLCanvasElement {
  let c = maskCache.get(pack);
  if (c) return c;
  const { w, h } = pack.raster;
  c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const f = pack.fuel[i];
    img.data[i * 4] = f === FuelClass.Water ? 255 : 0;
    img.data[i * 4 + 1] = f === FuelClass.Urban ? 255 : 0;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  maskCache.set(pack, c);
  return c;
}

interface GlTexture { width: number; height: number; copyFrom(o: { source: TexImageSource }): void; destroy(): void }
type TextureCtor = new (o: { context: unknown; source: TexImageSource }) => GlTexture;

/**
 * A texture fed from a canvas that changes over time. Assigning a new canvas to a PostProcessStage
 * uniform drops the old texture one frame before the new one exists (Cesium renders with an undefined
 * sampler and stops), so dynamic inputs are uploaded here and handed to the stage through a function.
 */
class DynTex {
  private tex: GlTexture | null = null;
  private dirty = true;
  constructor(private scene: Cesium.Scene, private src: HTMLCanvasElement) {}
  set(src: HTMLCanvasElement) {
    this.src = src;
    this.dirty = true;
  }
  get(): GlTexture {
    if (!this.tex || (this.dirty && (this.tex.width !== this.src.width || this.tex.height !== this.src.height))) {
      this.tex?.destroy();
      const Tex = (Cesium as unknown as { Texture: TextureCtor }).Texture;
      this.tex = new Tex({ context: (this.scene as unknown as { context: unknown }).context, source: this.src });
    } else if (this.dirty) {
      this.tex.copyFrom({ source: this.src });
    }
    this.dirty = false;
    return this.tex;
  }
  destroy() {
    this.tex?.destroy();
    this.tex = null;
  }
}

/** Feed cameras often sit beside or inside the plume, so their path extinction is lower; LWIR sees through most smoke. */
function extinctionFor(look: AtmosphereLook): number {
  return look === 'stage' ? 2.6e-3 : look === 'thermal' ? 3.5e-4 : 1.3e-3;
}

export class AtmospherePass {
  readonly stage: Cesium.PostProcessStage;
  private frame: ReturnType<typeof localFrame>;
  private state = {
    camLocal: new Cesium.Cartesian3(),
    sun: new Cesium.Cartesian3(0, 0, 1),
    wind: new Cesium.Cartesian3(),
    look: new Cesium.Cartesian4(0, 0, 1, 0),
    tune: new Cesium.Cartesian4(),
    tune2: new Cesium.Cartesian4(),
    smokeMix: 1,
    time: 0,
  };
  private offs: (() => void)[] = [];
  private texA: DynTex;
  private texB: DynTex;
  private texFire: DynTex;
  private sunKey = NaN;
  private lastSmokeRev = -1;
  sunElevDeg = 45;

  constructor(
    private scene: Cesium.Scene,
    private pack: ScenarioPack,
    field: FireField,
    private smoke: SmokeField,
    o: AtmosphereOptions,
  ) {
    this.frame = localFrame(pack);
    const prof = getProfile(pack);
    const sw = smoke.local(pack.raster.bbox[0], pack.raster.bbox[1]);
    const ne = smoke.local(pack.raster.bbox[2], pack.raster.bbox[3]);
    const st = this.state;
    const camera = o.look === 'camera';
    this.texA = new DynTex(scene, smoke.previous);
    this.texB = new DynTex(scene, smoke.current);
    this.texFire = new DynTex(scene, field.canvas);
    this.stage = new Cesium.PostProcessStage({
      name: `fcc-atmos-${Math.random().toString(36).slice(2, 7)}`,
      fragmentShader: FS,
      uniforms: {
        smokeA: () => this.texA.get(),
        smokeB: () => this.texB.get(),
        fireTex: () => this.texFire.get(),
        maskTex: maskCanvas(pack),
        smokeMix: () => st.smokeMix,
        toLocal: this.frame.rot,
        camLocal: () => st.camLocal,
        domain: new Cesium.Cartesian4(smoke.domain.minX, smoke.domain.minY, smoke.domain.size, 5000),
        bboxL: new Cesium.Cartesian4(sw[0], sw[1], ne[0] - sw[0], ne[1] - sw[1]),
        sunDir: () => st.sun,
        wind: () => st.wind,
        look: () => st.look,
        tune: () => st.tune,
        tune2: () => st.tune2,
        time: () => st.time,
      },
    });
    scene.postProcessStages.add(this.stage);
    // Base extinction tuned to scene size: a 10 km scene keeps ~20 km visibility, larger scenes more.
    const baseHaze = camera ? 3.2e-5 : 1.2e-5 * (12000 / Math.max(12000, prof.spanM));
    st.look.x = camera ? 1 : 0;
    st.look.y = o.look === 'thermal' ? 1 : 0;
    st.look.w = prof.coastal ? 1 : 0;
    st.tune.x = extinctionFor(o.look);
    st.tune.y = baseHaze;
    st.tune.w = o.shimmer === false ? 0 : 1;
    st.tune2.y = 1;
    st.tune2.z = o.quality ?? 1;
    st.tune2.w = camera ? 1 : 0.85;
    this.offs.push(field.onChange(() => this.texFire.set(field.canvas)));
  }

  setLook(look: AtmosphereLook) {
    this.state.look.x = look === 'camera' ? 1 : 0;
    this.state.look.y = look === 'thermal' ? 1 : 0;
    this.state.tune.y = look === 'camera' || look === 'thermal' ? 3.2e-5 : this.state.tune.y;
    this.state.tune2.w = look === 'stage' ? 0.85 : 1;
    this.state.tune.x = extinctionFor(look);
  }

  set shimmer(on: boolean) { this.state.tune.w = on ? 1 : 0; }

  /** Per frame: camera, sun, wind, smoke cross-fade. `sceneT` is scenario time, `wallS` animation seconds. */
  update(sceneT: number, wallS: number, exaggeration: number, groundRef: number, seaLevel: number) {
    const st = this.state;
    const cam = this.scene.camera.positionWC;
    Cesium.Matrix4.multiplyByPoint(this.frame.inv, cam, st.camLocal);
    st.time = wallS;
    const key = Math.round(sceneT / 60000);
    if (key !== this.sunKey) {
      this.sunKey = key;
      const c = getProfile(this.pack).center;
      const [x, y, z] = sunEnu(sceneT, c.lat, c.lon);
      st.sun.x = x; st.sun.y = y; st.sun.z = z;
      const el = sunPosition(sceneT, c.lat, c.lon).elDeg;
      this.sunElevDeg = el;
      st.look.z = daylight(el);
    }
    if (this.smoke.rev !== this.lastSmokeRev) {
      this.lastSmokeRev = this.smoke.rev;
      this.texA.set(this.smoke.previous);
      this.texB.set(this.smoke.current);
    }
    st.smokeMix = Math.min(1, (performance.now() - this.smoke.changedAt) / 2500);
    st.wind.x = this.smoke.wind.x;
    st.wind.y = this.smoke.wind.y;
    st.wind.z = this.smoke.wind.ms;
    st.tune.z = groundRef;
    st.tune2.x = seaLevel;
    const d = this.stage.uniforms.domain as Cesium.Cartesian4;
    d.w = (this.smoke.plumeTopM || 3000) + getProfile(this.pack).maxElev * exaggeration + 400;
  }

  destroy() {
    for (const f of this.offs) f();
    if (!this.scene.isDestroyed()) {
      this.scene.postProcessStages.remove(this.stage);
      this.texA.destroy();
      this.texB.destroy();
      this.texFire.destroy();
    }
  }
}
