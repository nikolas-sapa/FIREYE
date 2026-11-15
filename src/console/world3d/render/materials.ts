import * as THREE from 'three';

export type WorldMaterialKind = 'terrain' | 'road' | 'veg' | 'grass' | 'rigid' | 'agent' | 'far';

const blank = (format: THREE.PixelFormat, type: THREE.TextureDataType, data: Uint8Array | Float32Array | Uint16Array) => {
  const t = new THREE.DataTexture(data, 1, 1, format, type);
  t.needsUpdate = true;
  return t;
};

/** Uniforms shared by every world material; updated once per rendered camera. */
export function createWorldUniforms() {
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uGust: { value: 0 },
    uCuring: { value: 0.5 },
    uLeaf: { value: 1 },
    uNight: { value: 0 },
    uWindows: { value: 0.5 },
    uWet: { value: 0 },
    uGrassFar: { value: 110 },
    /** Distance where the current view's loaded tiles end; objects dither out before it so the edge never pops. */
    uObjFar: { value: 1e6 },
    uTileMask: { value: null as THREE.Texture | null },
    uTileGrid: { value: new THREE.Vector4() },
    /** Fire arrival raster (minutes since start, 1e6 = never) and heat-glow grid; see render/fire.ts. */
    uArrival: { value: blank(THREE.RedFormat, THREE.FloatType, new Float32Array([1e6])) as THREE.Texture },
    uGlow: { value: blank(THREE.RedFormat, THREE.UnsignedByteType, new Uint8Array([0])) as THREE.Texture },
    /** xMin, zMin, 1 / width, 1 / depth of the arrival raster in local metres. */
    uFireBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    uFireT: { value: -1e6 },
    uFireOn: { value: 0 },
    uFlameMin: { value: 6 },
    uActiveMin: { value: 30 },
    uSmoulderMin: { value: 150 },
    /** Firelight strength on surfaces (stronger at night). */
    uFireLight: { value: 0 },
    /** 1 = output scene temperature for the LWIR sensor models. */
    uThermal: { value: 0 },
    uDay: { value: 1 },
  };
}
export type WorldUniforms = ReturnType<typeof createWorldUniforms>;

const FIRE_PARS = /* glsl */`
uniform sampler2D uArrival; uniform sampler2D uGlow; uniform vec4 uFireBox; uniform float uFireT; uniform float uFireOn;
uniform float uFlameMin; uniform float uActiveMin; uniform float uSmoulderMin; uniform float uFireLight; uniform float uThermal; uniform float uDay;
vec2 fireUv(vec2 xz) { return (xz - uFireBox.xy) * uFireBox.zw; }
/** Minutes since the fire reached xz (negative: not yet, or never). */
float fireAgeAt(vec2 xz) {
  vec2 uv = fireUv(xz);
  if (uFireOn < 0.5 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1e6;
  return uFireT - texture2D(uArrival, uv).r;
}
/** (burned, heat, flaming, residual) for an age in minutes. */
vec4 fireState(float age) {
  if (age < 0.0) return vec4(0.0);
  float heat = age < uActiveMin ? sqrt(1.0 - age / uActiveMin) : 0.0;
  float flame = age < uFlameMin ? smoothstep(0.0, 0.06, age / uFlameMin) * (1.0 - smoothstep(0.5, 1.0, age / uFlameMin)) : 0.0;
  float resid = age < uSmoulderMin ? 1.0 - age / uSmoulderMin : 0.0;
  return vec4(smoothstep(0.0, uFlameMin * 0.6, age), heat, flame, resid);
}
float fireGlowAt(vec2 xz) { vec2 uv = fireUv(xz); return uFireOn > 0.5 ? texture2D(uGlow, clamp(uv, 0.0, 1.0)).r : 0.0; }
`;

const PRELUDE = /* glsl */`
attribute vec2 aMeta;
attribute vec4 aParams;
uniform float uTime; uniform vec2 uWind; uniform float uGust; uniform float uCuring; uniform float uLeaf;
uniform float uNight; uniform float uWindows; uniform float uWet; uniform float uGrassFar;
${FIRE_PARS}
varying vec3 vEmis;
varying vec3 vWorldPos;
varying vec4 vFire;
varying float vTherm;
#ifdef WORLD_TRUTH
flat varying vec4 vTruth;
#endif
float wHash(float n) { return fract(sin(n) * 43758.5453123); }
`;

const instanced = (kind: WorldMaterialKind) => kind === 'veg' || kind === 'grass' || kind === 'rigid' || kind === 'agent';

/** Unpack (phase, sensitivity, class, id) from instance-matrix row 3 and restore an affine matrix; fire state per instance. */
function mainPrelude(kind: WorldMaterialKind) {
  return /* glsl */`
#ifdef USE_INSTANCING
  vec4 P = vec4(instanceMatrix[0][3], instanceMatrix[1][3], instanceMatrix[2][3], instanceMatrix[3][3]);
  mat4 IM = instanceMatrix; IM[0][3] = 0.0; IM[1][3] = 0.0; IM[2][3] = 0.0; IM[3][3] = 1.0;
#else
  vec4 P = aParams;
  mat4 IM = mat4(1.0);
#endif
  float flag = aMeta.y;
  float cls = floor(P.z + 0.5);
  vec4 fireS = vec4(0.0);
  ${instanced(kind) && kind !== 'agent' ? `
  // Response units (41, 42) are live proxies and never burn.
  if (uFireOn > 0.5 && (cls < 40.5 || cls > 42.5)) {
    vec3 o = (modelMatrix * (IM * vec4(0.0, 0.0, 0.0, 1.0))).xyz;
    float j = wHash(o.x * 0.173 + o.z * 0.311);
    fireS = fireState(fireAgeAt(o.xz + (vec2(j, fract(j * 7.3)) - 0.5) * 14.0) - j * 0.6);
  }` : ''}
  vFire = fireS;
`;
}

const COLOR = /* glsl */`
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3(1.0);
  #ifdef USE_COLOR
  vColor *= color;
  #endif
  #ifdef USE_INSTANCING_COLOR
  if ((flag > 0.5 && flag < 1.5) || (flag > 4.5 && flag < 5.5)) vColor *= instanceColor.xyz;
  #endif
  float sens = mod(P.y, 2.0);
  if (flag > 0.5 && flag < 1.5) {
    // Seasonal curing of live foliage: yellow-grey in summer drought, a fresher flush after winter rain.
    vec3 cured = vec3(dot(vColor, vec3(0.4, 0.45, 0.15))) * vec3(1.42, 1.12, 0.6);
    vColor = mix(vColor, cured, clamp(uCuring * sens, 0.0, 1.0) * 0.9);
    vColor *= mix(vec3(1.0), vec3(0.82, 1.12, 0.78), (1.0 - uCuring) * min(1.0, sens * 1.4) * 0.7);
    if (P.y >= 2.0) vColor = mix(vec3(0.42, 0.33, 0.22), vColor, uLeaf);
  }
  if ((flag > 10.5 && flag < 11.5) || (flag > 14.5 && flag < 15.5)) {
    vec3 green = vColor * vec3(0.55, 1.08, 0.5);
    vColor = mix(green, vColor * vec3(1.1, 1.0, 0.82), uCuring);
  }
  if (flag < 0.5 || flag > 9.5 || (flag > 3.5 && flag < 4.5)) vColor *= 1.0 - 0.3 * uWet;
  if (fireS.x > 0.0) {
    // Burned: foliage scorched brown or black, wood and debris charred, buildings soot-stained, vehicles burnt out.
    float h = wHash(P.w * 0.37 + P.x * 13.1);
    vec3 charred = vec3(0.028, 0.025, 0.023);
    vec3 burnt = flag > 0.5 && flag < 1.5 ? (h < 0.45 ? vec3(0.19, 0.09, 0.035) : charred)
      : cls > 29.5 && cls < 30.5 ? vColor * (h < 0.6 ? 0.22 : 0.75)
      : cls > 39.5 && cls < 40.5 ? vec3(0.13, 0.1, 0.085)
      : cls > 51.5 && cls < 52.5 ? vColor * 0.55 : charred;
    vColor = mix(vColor, burnt, fireS.x);
  }
#endif
  vEmis = vec3(0.0);
  if (flag > 1.5 && flag < 2.5 && fireS.x < 0.5) {
    float on = step(1.0 - uWindows, wHash(P.w * 0.0137 + floor(position.x * 0.4) * 3.1 + floor(position.y * 0.3) * 7.7 + floor(position.z * 0.4) * 1.3));
    vEmis = vec3(1.0, 0.68, 0.36) * on * uNight * 2.2;
  }
  if (flag > 2.5 && flag < 3.5 && fireS.x < 0.5) vEmis = vec3(1.0, 0.8, 0.52) * uNight * 9.0;
  if (flag > 6.5 && flag < 7.5) {
    float blink = step(0.55, fract(uTime * 1.7 + step(0.0, position.z) * 0.5 + P.x));
    vEmis = vColor * blink * (2.5 + 9.0 * uNight);
  }
  if (fireS.z > 0.0) {
    float fl = 0.7 + 0.3 * sin(uTime * 11.0 + P.x * 40.0 + position.y * 0.7) * sin(uTime * 4.3 + P.w);
    vEmis += vec3(1.0, 0.3, 0.05) * fireS.z * fl * (flag > 0.5 && flag < 1.5 ? 2.2 : 1.4);
  } else if (fireS.y > 0.0) {
    vEmis += vec3(1.0, 0.25, 0.04) * fireS.y * fireS.y * step(0.82, wHash(P.w + floor(position.y * 2.0))) * 1.6;
  }
  // Scene temperature for LWIR (0 cold sky … ~0.3 ambient … 1+ flame).
  vTherm = flag > 0.5 && flag < 1.5 ? 0.27 : flag > 1.5 && flag < 2.5 ? 0.22 : flag > 2.5 && flag < 3.5 ? 0.3 + 0.35 * uNight : 0.31;
  if (flag > 18.5 && flag < 19.5) vTherm = 0.17;
  if ((flag > 13.5 && flag < 14.5) || (flag > 16.5 && flag < 17.5)) vTherm = 0.34 + 0.05 * uNight;
  if (cls > 40.5 && cls < 42.5) vTherm = 0.5;
  if (cls > 59.5 && cls < 61.5) vTherm = 0.63;
  if (flag > 6.5 && flag < 7.5) vTherm = 0.45;
  vTherm += fireS.y * 0.55 + fireS.z * 0.9 + fireS.w * 0.22;
`;

const BEGIN_AGENT = /* glsl */`
  vec3 transformed = vec3(position);
  {
    float code = floor(aMeta.x + 0.001), pivot = fract(aMeta.x + 0.0001) * 10.0, ph = P.x, amp = P.y;
    if (code > 0.5 && code < 4.5) {
      float sgn = (code < 1.5 || (code > 3.5)) ? 1.0 : -1.0;
      float a = sin(ph) * amp * 0.55 * sgn;
      float y = transformed.y - pivot, z = transformed.z;
      transformed.y = pivot + y * cos(a) - z * sin(a);
      transformed.z = y * sin(a) + z * cos(a);
    } else if (code > 6.5 && code < 8.5) {
      float a = sin(ph * 3.0) * amp * 0.9 * (code < 7.5 ? -1.0 : 1.0);
      float x = transformed.x, y = transformed.y - pivot;
      transformed.x = x * cos(a) - y * sin(a);
      transformed.y = pivot + x * sin(a) + y * cos(a);
    } else if (code > 8.5) {
      float a = sin(uTime * 4.0 + ph) * 0.4;
      float x = transformed.x, z = transformed.z;
      transformed.x = x * cos(a) + z * sin(a);
    }
    transformed.y += abs(sin(ph)) * 0.035 * amp;
  }
`;

// Burned shrubs and grass are consumed to stubble; tree crowns thin out but stay standing.
const BURN_SHAPE = /* glsl */`
  if (fireS.x > 0.0) {
    float consumed = fireS.x * (cls > 21.5 && cls < 22.5 ? 0.93 : cls > 20.5 && cls < 21.5 ? 0.6 : flag > 0.5 && flag < 1.5 ? 0.25 : 0.0);
    transformed.y *= 1.0 - consumed;
    if (flag > 0.5 && flag < 1.5) transformed.xz *= 1.0 - consumed * 0.5;
  }
`;

const BEGIN_VEG = /* glsl */`
  vec3 transformed = vec3(position);
  if (P.y >= 2.0 && flag > 0.5 && flag < 1.5) transformed.xz *= mix(0.12, 1.0, uLeaf);
${BURN_SHAPE}`;

const BEGIN_GRASS = /* glsl */`
  vec3 transformed = vec3(position);
${BURN_SHAPE}`;

function project(kind: WorldMaterialKind) {
  const wind = kind === 'veg' || kind === 'grass';
  return /* glsl */`
  vec4 wp = modelMatrix * (IM * vec4(transformed, 1.0));
  ${wind ? `
  float ww = aMeta.x * (1.0 - fireS.x);
  if (ww > 0.0) {
    float ph = P.x * 6.2831;
    float gust = 0.55 + 0.45 * sin(uTime * 0.6 + wp.x * 0.021 + wp.z * 0.017);
    float osc = sin(uTime * ${kind === 'grass' ? '2.6' : '1.5'} + ph + wp.x * 0.08) * 0.55 + sin(uTime * 3.9 + ph * 1.7) * 0.2;
    vec2 disp = uWind * (0.55 + uGust * gust) * (0.6 + osc) + vec2(osc * 0.06);
    wp.xz += disp * ww * ${kind === 'grass' ? '1.1' : '1.0'};
  }` : ''}
  ${kind === 'grass' ? `
  float gd = length(wp.xyz - cameraPosition);
  float gk = 1.0 - smoothstep(uGrassFar * 0.55, uGrassFar, gd);
  float baseY = (modelMatrix * (IM * vec4(0.0, 0.0, 0.0, 1.0))).y;
  wp.y = mix(baseY - 0.05, wp.y, gk);` : ''}
  ${kind === 'terrain' ? `
  if (flag > 16.5 && flag < 18.5) { vec3 tc = cameraPosition - wp.xyz; float td = length(tc); wp.xyz += tc / max(td, 1e-3) * min(3.0, 0.04 + 0.0016 * td); }` : ''}
  vWorldPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
#ifdef WORLD_TRUTH
  float tid = P.w;
  vec3 enc = tid < -0.5 ? vec3(255.0) : vec3(mod(tid, 256.0), mod(floor(tid / 256.0), 256.0), floor(tid / 65536.0));
  vTruth = vec4(enc, P.z) / 255.0;
#endif
`;
}

const WORLDPOS = /* glsl */`
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = vec4(wp.xyz, 1.0);
#endif
`;

export function patchVertex(shader: { vertexShader: string }, kind: WorldMaterialKind) {
  const main = mainPrelude(kind);
  let v = shader.vertexShader.replace('#include <common>', `#include <common>\n${PRELUDE}`)
    .replace('void main() {', `void main() {\n${main}`)
    .replace('#include <project_vertex>', project(kind))
    .replace('#include <worldpos_vertex>', WORLDPOS);
  if (v.includes('#include <color_vertex>')) v = v.replace('#include <color_vertex>', COLOR);
  else v = v.replace(main, `${main}\n  vEmis = vec3(0.0); vTherm = 0.3;\n`);
  if (kind === 'agent') v = v.replace('#include <begin_vertex>', BEGIN_AGENT);
  else if (kind === 'veg') v = v.replace('#include <begin_vertex>', BEGIN_VEG);
  else if (kind === 'grass' || kind === 'rigid') v = v.replace('#include <begin_vertex>', BEGIN_GRASS);
  shader.vertexShader = v;
}

const OBJ_FADE = /* glsl */`void main() {
  float objD = length(vWorldPos - cameraPosition);
  float objK = smoothstep(uObjFar * 0.8, uObjFar, objD);
  if (objK > 0.0 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) < objK) discard;`;

const FAR_FRAG_PARS = /* glsl */`
uniform sampler2D uTileMask;
uniform vec4 uTileGrid;
`;

const FRAG_PARS = /* glsl */`
varying vec3 vEmis;
varying vec3 vWorldPos;
varying vec4 vFire;
varying float vTherm;
uniform float uTime;
${FIRE_PARS}
float fHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float fNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y); }
#ifdef WORLD_TRUTH
flat varying vec4 vTruth;
#endif
`;

// Ground burn per fragment: noise-warped arrival so cell edges read as an irregular front, ash with white patches, embers.
const groundBurn = (road: boolean) => /* glsl */`
  vec3 fireEmis = vec3(0.0);
  float groundTherm = 0.0;
  if (uFireOn > 0.5) {
    vec2 q = vWorldPos.xz;
    vec2 warp = vec2(fNoise(q * 0.045), fNoise(q * 0.045 + 31.7)) - 0.5;
    float age = fireAgeAt(q + warp * 26.0) - fNoise(q * 0.21) * 0.8;
    vec4 fs = fireState(age);
    if (fs.x > 0.0) {
      float n = fNoise(q * 0.33), n2 = fNoise(q * 1.7 + 9.1);
      vec3 ash = mix(vec3(0.022, 0.02, 0.019), vec3(0.2, 0.19, 0.18), smoothstep(0.62, 0.9, n) * 0.85 + n2 * 0.08);
      diffuseColor.rgb = mix(diffuseColor.rgb, ${road ? 'diffuseColor.rgb * 0.55' : 'ash'}, fs.x);
      float ember = pow(fNoise(q * 0.9 + uTime * 0.15), 3.0) * 2.4 + pow(n2, 6.0) * 3.0;
      float front = fs.z * (0.6 + 0.4 * sin(uTime * 7.0 + n * 20.0));
      fireEmis = vec3(1.0, 0.3, 0.05) * (fs.y * fs.y * ember * 0.9 + front * 1.2 + fs.w * fs.w * pow(n2, 8.0) * 1.2);
      groundTherm = fs.y * 0.55 + fs.z * 0.8 + fs.w * 0.25 * (0.6 + 0.4 * n);
    }
  }
`;

const THERMAL_OUT = /* glsl */`
#ifndef WORLD_TRUTH
  if (uThermal > 0.5) {
    float lum = dot(outgoingLight - totalEmissiveRadiance, vec3(0.3, 0.5, 0.2));
    float T = vTherm + groundTherm + clamp(lum, 0.0, 1.5) * 0.3 * uDay + fireGlowAt(vWorldPos.xz) * 0.05;
    #ifdef USE_FOG
    T = mix(T, 0.3, fogFactor * 0.3);
    #endif
    gl_FragColor = vec4(T, T, T, 1.0);
  }
#endif
`;

function patchFragment(shader: { fragmentShader: string }, kind: WorldMaterialKind) {
  const ground = kind === 'terrain' || kind === 'road' || kind === 'far';
  const burn = ground ? groundBurn(kind === 'road') : `
  vec3 fireEmis = vec3(0.0);
  float groundTherm = 0.0;`;
  let f = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAG_PARS}${kind === 'far' ? FAR_FRAG_PARS : ''}${kind === 'veg' || kind === 'rigid' || kind === 'grass' ? '\nuniform float uObjFar;' : ''}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${burn}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += vEmis + fireEmis;
  // Firelight: the heat-glow grid lights nearby surfaces orange (dominant at night).
  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.42, 0.13) * fireGlowAt(vWorldPos.xz) * uFireLight;`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${THERMAL_OUT}\n#ifdef WORLD_TRUTH\n  gl_FragColor = vTruth;\n#endif`);
  if (kind === 'veg' || kind === 'rigid' || kind === 'grass') f = f.replace('void main() {', OBJ_FADE);
  if (kind === 'far') f = f.replace('void main() {', /* glsl */`void main() {
  vec2 tc = (vWorldPos.xz - uTileGrid.xy) / 256.0;
  if (tc.x >= 0.0 && tc.y >= 0.0 && tc.x < uTileGrid.z && tc.y < uTileGrid.w && texture2D(uTileMask, (floor(tc) + 0.5) / uTileGrid.zw).r > 0.5) discard;`);
  shader.fragmentShader = f;
}

export interface WorldMaterialSet {
  get(kind: WorldMaterialKind, truth?: boolean): THREE.Material;
  depth(kind: WorldMaterialKind): THREE.Material | undefined;
  /** ID-pass variant of a world material, or null for foreign materials. */
  truthFor(m: THREE.Material): THREE.Material | null;
  dispose(): void;
}

export function createWorldMaterials(U: WorldUniforms): WorldMaterialSet {
  const cache = new Map<string, THREE.Material>();
  const make = (kind: WorldMaterialKind, truth: boolean) => {
    const m = new THREE.MeshLambertMaterial({
      vertexColors: true, flatShading: true,
      side: kind === 'veg' || kind === 'grass' || kind === 'terrain' || kind === 'road' ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (kind === 'road') { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -6; }
    if (truth) Object.assign(m, { defines: { WORLD_TRUTH: '' } });
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, U);
      patchVertex(shader, kind);
      patchFragment(shader, kind);
    };
    m.customProgramCacheKey = () => `world-${kind}-${truth ? 't' : 'v'}`;
    m.userData = { worldKind: kind, truth };
    return m;
  };
  const depthCache = new Map<string, THREE.Material>();
  return {
    get(kind, truth = false) {
      const key = `${kind}/${truth}`;
      let m = cache.get(key);
      if (!m) { m = make(kind, truth); cache.set(key, m); }
      return m;
    },
    depth(kind) {
      if (kind === 'terrain' || kind === 'road' || kind === 'far') return undefined;
      let m = depthCache.get(kind);
      if (!m) {
        const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        d.onBeforeCompile = shader => {
          Object.assign(shader.uniforms, U);
          patchVertex(shader, kind);
        };
        d.customProgramCacheKey = () => `world-depth-${kind}`;
        depthCache.set(kind, m = d);
      }
      return m;
    },
    truthFor(m) {
      const kind = m.userData.worldKind as WorldMaterialKind | undefined;
      return kind && !m.userData.truth ? this.get(kind, true) : null;
    },
    dispose() { for (const m of cache.values()) m.dispose(); for (const m of depthCache.values()) m.dispose(); cache.clear(); depthCache.clear(); },
  };
}
