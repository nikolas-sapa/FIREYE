import * as THREE from 'three';
import type { WorldEnv } from '../env';
import { TruthClass } from '../types';

const v3 = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2]);

/* ---------------------------------------------------------------- sky */

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uFog;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunI;
uniform vec3 uMoonDir; uniform float uMoonIllum; uniform float uNight; uniform float uCloud; uniform float uTime; uniform vec2 uWind; uniform float uRain;
varying vec3 vDir;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
  float cs = max(dot(d, uSunDir), 0.0);
  float day = clamp(uSunDir.y * 6.0 + 0.4, 0.0, 1.0);
  col += uSunColor * (pow(cs, 6.0) * 0.28 + pow(cs, 40.0) * 0.35) * uSunI * 0.25 * (1.0 - 0.7 * uCloud);
  // stars and moon
  if (uNight > 0.01 && h > 0.0) {
    vec2 g = vec2(atan(d.z, d.x) * 180.0, asin(clamp(h, -1.0, 1.0)) * 180.0);
    vec2 cell = floor(g); float r = h21(cell);
    float star = step(0.985, r) * smoothstep(0.42, 0.0, length(fract(g) - 0.5)) * (0.4 + 0.6 * h21(cell + 7.0));
    star *= 0.75 + 0.25 * sin(uTime * (2.0 + r * 5.0) + r * 40.0);
    col += vec3(0.75, 0.8, 1.0) * star * uNight * (1.0 - uCloud) * 0.5 * smoothstep(0.0, 0.2, h);
  }
  float cm = dot(d, uMoonDir);
  float moonDisc = smoothstep(0.99997, 0.999985, cm);
  col += vec3(0.85, 0.85, 0.8) * moonDisc * (0.25 + 1.6 * uMoonIllum) * (1.0 - 0.85 * uCloud) * mix(0.22, 1.0, uNight);
  col += vec3(0.25, 0.27, 0.32) * pow(max(cm, 0.0), 300.0) * uMoonIllum * uNight * 0.3;
  col += uSunColor * smoothstep(0.99955, 0.9998, cs) * 40.0 * uSunI * (1.0 - 0.95 * uCloud);
  // clouds on a virtual plane
  if (h > 0.0) {
    vec2 p = d.xz / (h + 0.06) * 0.9 + uWind * uTime * 0.0035;
    float n = fbm(p * 0.9);
    float cover = mix(0.22, 1.0, uCloud);
    float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.32, n) * smoothstep(0.0, 0.12, h);
    dens = max(dens, uRain * 0.9 * smoothstep(0.0, 0.2, h));
    vec3 lit = mix(uHorizon, vec3(1.0), 0.6) * (0.25 + 0.75 * day) + uSunColor * pow(cs, 4.0) * 0.35 * day;
    vec3 shade = mix(uZenith, uHorizon, 0.5) * mix(0.55, 0.35, uCloud);
    vec3 cc = mix(lit, shade, smoothstep(0.45, 0.95, n) * 0.7 + uRain * 0.3);
    cc = mix(cc, vec3(0.012, 0.014, 0.02), uNight * 0.92);
    col = mix(col, cc, dens * 0.92);
  }
  // below horizon: haze into the ground colour
  col = mix(col, mix(uFog, uGround, 0.35), smoothstep(0.0, -0.06, h));
  col = mix(col, uFog, smoothstep(0.12, 0.0, abs(h)) * 0.55);
  #ifdef WORLD_TRUTH
  gl_FragColor = vec4(1.0, 1.0, 1.0, ${TruthClass.Sky}.0 / 255.0);
  #else
  gl_FragColor = vec4(col, 1.0);
  #endif
}`;

export function createSky(truth = false) {
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true,
    uniforms: {
      uZenith: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() }, uGround: { value: new THREE.Vector3() }, uFog: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Vector3(1, 1, 1) }, uSunI: { value: 1 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonIllum: { value: 0 }, uNight: { value: 0 }, uCloud: { value: 0 }, uTime: { value: 0 },
      uWind: { value: new THREE.Vector2() }, uRain: { value: 0 },
    },
    defines: truth ? { WORLD_TRUTH: '' } : {},
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  mesh.frustumCulled = false; mesh.renderOrder = 10; mesh.matrixAutoUpdate = false;
  return mesh;
}

export function updateSky(mat: THREE.ShaderMaterial, env: WorldEnv, time: number) {
  const u = mat.uniforms;
  u.uZenith.value.copy(v3(env.skyZenith)); u.uHorizon.value.copy(v3(env.skyHorizon)); u.uGround.value.copy(v3(env.ground)); u.uFog.value.copy(v3(env.fogColor));
  u.uSunDir.value.copy(v3(env.sunDir)); u.uSunColor.value.copy(v3(env.sunColor)); u.uSunI.value = env.sunIntensity;
  u.uMoonDir.value.copy(v3(env.moonDir)); u.uMoonIllum.value = env.moonIllum; u.uNight.value = env.night; u.uCloud.value = env.cloud;
  u.uTime.value = time; u.uWind.value.set(env.windX, env.windZ); u.uRain.value = env.rain;
}

/* ---------------------------------------------------------------- sea */

const SEA_VERT = /* glsl */`
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const SEA_FRAG = /* glsl */`
#include <fog_pars_fragment>
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunI; uniform float uAmbient;
uniform float uTime; uniform vec2 uWind; uniform float uRain; uniform vec3 uMoonDir; uniform float uMoonI;
varying vec3 vWorld;
vec2 wave(vec2 p, vec2 dir, float f, float s, float a) { float ph = dot(p, dir) * f + uTime * s; return dir * cos(ph) * a * f; }
void main() {
  vec2 p = vWorld.xz;
  float wk = 0.25 + clamp(length(uWind) / 12.0, 0.0, 1.0);
  vec2 g = wave(p, normalize(vec2(0.8, 0.6)), 0.21, 1.3, 0.12) + wave(p, normalize(vec2(-0.5, 0.86)), 0.37, 1.9, 0.07)
    + wave(p, normalize(vec2(0.95, -0.3)), 0.83, 2.7, 0.03) + wave(p, normalize(vec2(-0.2, -0.98)), 1.7, 3.6, 0.015);
  vec3 n = normalize(vec3(-g.x * wk, 1.0, -g.y * wk));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(r.y, 0.0, 1.0), 0.5));
  vec3 body = vec3(0.012, 0.055, 0.075) * (uAmbient * 1.4 + max(uSunDir.y, 0.0) * uSunI * 0.35);
  vec3 col = mix(body, sky, fres * 0.85);
  float sp = pow(max(dot(r, uSunDir), 0.0), 220.0) * 30.0 + pow(max(dot(r, uSunDir), 0.0), 30.0) * 0.25;
  col += uSunColor * sp * uSunI * step(0.0, uSunDir.y) * (1.0 - 0.8 * uRain);
  col += vec3(0.6, 0.62, 0.65) * pow(max(dot(r, uMoonDir), 0.0), 300.0) * uMoonI * 20.0;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  #ifdef WORLD_TRUTH
  gl_FragColor = vec4(1.0, 1.0, 1.0, ${TruthClass.Water}.0 / 255.0);
  #endif
}`;

export function createSea(truth = false) {
  const material = new THREE.ShaderMaterial({
    vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uZenith: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Vector3() },
      uSunI: { value: 1 }, uAmbient: { value: 0.5 }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uRain: { value: 0 },
      uMoonDir: { value: new THREE.Vector3() }, uMoonI: { value: 0 },
    }]),
    defines: truth ? { WORLD_TRUTH: '' } : {},
  });
  const geo = new THREE.PlaneGeometry(80000, 80000, 1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = 0; mesh.updateMatrix(); mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
  return mesh;
}

export function updateSea(mat: THREE.ShaderMaterial, env: WorldEnv, time: number) {
  const u = mat.uniforms;
  u.uZenith.value.copy(v3(env.skyZenith)); u.uHorizon.value.copy(v3(env.skyHorizon)); u.uSunDir.value.copy(v3(env.sunDir)); u.uSunColor.value.copy(v3(env.sunColor));
  u.uSunI.value = env.sunIntensity; u.uAmbient.value = env.ambient; u.uTime.value = time; u.uWind.value.set(env.windX, env.windZ); u.uRain.value = env.rain;
  u.uMoonDir.value.copy(v3(env.moonDir)); u.uMoonI.value = env.moonIntensity;
}

/* ---------------------------------------------------------------- rain */

const RAIN_VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime; uniform vec3 uWindV; uniform float uBox;
varying float vA;
void main() {
  vec3 vel = vec3(uWindV.x, -8.5, uWindV.z);
  vec3 base = aSeed.xyz * uBox + vel * (uTime + aSeed.w * 10.0);
  vec3 rel = mod(base - cameraPosition, uBox) - uBox * 0.5;
  vec3 p = cameraPosition + rel + vel * 0.045 * position.y;
  vA = 1.0 - smoothstep(uBox * 0.3, uBox * 0.5, length(rel));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAIN_FRAG = /* glsl */`
uniform float uRain; uniform vec3 uTint;
varying float vA;
void main() { gl_FragColor = vec4(uTint, vA * uRain * 0.38); }`;

export function createRain(count = 4000) {
  const pos = new Float32Array(count * 6), seed = new Float32Array(count * 8);
  for (let i = 0; i < count; i++) {
    pos[i * 6 + 4] = 1;
    const s = [Math.random(), Math.random(), Math.random(), Math.random()];
    seed.set(s, i * 8); seed.set(s, i * 8 + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const material = new THREE.ShaderMaterial({
    vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uWindV: { value: new THREE.Vector3() }, uBox: { value: 36 }, uRain: { value: 0 }, uTint: { value: new THREE.Vector3(0.7, 0.72, 0.75) } },
  });
  const lines = new THREE.LineSegments(g, material);
  lines.frustumCulled = false; lines.renderOrder = 20; lines.matrixAutoUpdate = false; lines.visible = false;
  return lines;
}
export function updateRain(rain: THREE.LineSegments, env: WorldEnv, time: number) {
  const u = (rain.material as THREE.ShaderMaterial).uniforms;
  rain.visible = env.rain > 0.01;
  u.uTime.value = time; u.uRain.value = Math.min(1, env.rain * 1.4); u.uWindV.value.set(env.windX * 0.6, 0, env.windZ * 0.6);
  const k = 0.25 + 0.75 * env.daylight;
  u.uTint.value.set(0.7 * k, 0.72 * k, 0.75 * k);
}
