import * as THREE from 'three';
import { FuelClass, type ScenarioPack } from '../../contracts';
import type { WorldEnv } from '../env';
import { fireSnapshot, FireTimeline, type FireSnapshot, type FireTiming } from '../fire/state';
import type { HeightField } from '../frame';
import type { WorldUniforms } from './materials';

const NEVER_MIN = 1e6;
const FLAME_CAP = 6000;
const SMOKE_SOURCES = 40;
const PUFFS = 34;

const hash = (i: number, s = 0) => {
  let h = (Math.imul(i, 0x27d4eb2d) ^ Math.imul(s + 0x165667b1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Flame height (m) and width by fuel: crown fire in pine, a few metres in shrubs, knee-high in grass. */
function flameShape(fuel: number, r: number): [number, number] {
  switch (fuel) {
    case FuelClass.TimberUnderstory: return [16 + 14 * r, 11 + 5 * r];
    case FuelClass.TimberLitter: return [11 + 10 * r, 10 + 5 * r];
    case FuelClass.Shrub: return [4.5 + 4 * r, 8 + 5 * r];
    case FuelClass.Urban: return [6 + 7 * r, 7 + 5 * r];
    case FuelClass.Agriculture: return [2 + 2 * r, 7 + 4 * r];
    case FuelClass.Grass: return [1.6 + 1.8 * r, 7 + 5 * r];
    default: return [3 + 3 * r, 7 + 4 * r];
  }
}

const FLAME_VERT = /* glsl */`
attribute vec4 aFire;   // x, y, z, arrival (min)
attribute vec4 aShape;  // height, width, seed, lean
uniform float uFireT; uniform float uFlameMin; uniform float uTime; uniform vec2 uWind;
varying vec2 vUv; varying float vI; varying float vSeed; varying float vFog;
uniform float uFogDensity;
void main() {
  float age = uFireT - aFire.w;
  float life = age / uFlameMin;
  vUv = position.xy + vec2(0.5, 0.0);
  vSeed = aShape.z;
  if (age < 0.0 || life > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vI = 0.0; return; }
  float env = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.45, 1.0, life));
  float flick = 0.8 + 0.14 * sin(uTime * 8.7 + aShape.z * 40.0) + 0.09 * sin(uTime * 21.0 + aShape.z * 13.0);
  float h = aShape.x * (0.35 + 0.65 * env) * flick, w = aShape.y * (0.55 + 0.45 * env);
  vI = env;
  vec4 c = viewMatrix * vec4(aFire.xyz, 1.0);
  vec2 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
  float ul = length(up);
  vec2 u = ul > 0.15 ? up / ul : vec2(0.0, 1.0);
  vec2 r = vec2(u.y, -u.x);
  // Seen from above, flames foreshorten into a bright patch over the burning cell.
  float hh = h * max(ul, 0.3);
  vec2 lean = (viewMatrix * vec4(uWind.x, 0.0, uWind.y, 0.0)).xy * aShape.w * position.y * position.y;
  c.xy += r * position.x * w + u * position.y * hh + lean * h;
  float d = length(c.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  gl_Position = projectionMatrix * c;
}`;

const FLAME_FRAG = /* glsl */`
uniform float uTime; uniform float uThermal;
varying vec2 vUv; varying float vI; varying float vSeed; varying float vFog;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  if (vI <= 0.0) discard;
  vec2 p = vUv;
  float n = vn(vec2(p.x * 4.0 + vSeed * 17.0, p.y * 3.2 - uTime * 2.6)) * 0.65 + vn(vec2(p.x * 9.0 - vSeed * 5.0, p.y * 7.0 - uTime * 4.1)) * 0.35;
  float x = abs(p.x - 0.5) * 2.0;
  float body = (1.0 - smoothstep(0.25, 1.0, x / (1.05 - p.y * 0.75))) * (1.0 - smoothstep(0.55, 1.0, p.y));
  float f = body * (0.55 + 0.9 * n) - p.y * 0.35;
  float a = smoothstep(0.12, 0.5, f);
  if (a <= 0.003) discard;
  vec3 col = mix(vec3(0.95, 0.16, 0.02), vec3(1.0, 0.55, 0.12), smoothstep(0.25, 0.65, f));
  col = mix(col, vec3(1.0, 0.92, 0.65), smoothstep(0.62, 0.95, f) * (1.0 - p.y));
  float k = a * vI * (1.0 - 0.9 * vFog);
  if (uThermal > 0.5) { gl_FragColor = vec4(vec3(1.1 * k), 1.0); return; }
  gl_FragColor = vec4(col * k * 5.5, 1.0);
}`;

const SMOKE_VERT = /* glsl */`
attribute vec4 aSmoke;  // x, y, z, heat
attribute vec4 aPuff;   // phase, lateral seed, size, column scale
uniform float uTime; uniform vec2 uWind; uniform float uWindMs; uniform float uFogDensity;
varying vec2 vUv; varying float vA; varying float vS; varying float vHeat; varying float vFog; varying float vSeed;
void main() {
  float heat = aSmoke.w;
  float H = (380.0 + 1700.0 * heat) * aPuff.w;
  float rise = 6.0 + 7.0 * heat;
  float life = H / rise;
  float s = fract(aPuff.x + uTime / life);
  vS = s; vHeat = heat; vSeed = aPuff.y;
  vUv = position.xy + 0.5;
  // Buoyant column that bends over in the wind and spreads as it rises.
  float t = s * life;
  float hgt = H * (1.0 - pow(1.0 - s, 1.6));
  vec2 drift = uWind * t * mix(0.35, 1.0, s) / max(0.5, uWindMs) * min(uWindMs, 24.0);
  float spread = 25.0 + s * (160.0 + 520.0 * heat);
  float ang = aPuff.y * 6.2831;
  vec3 p = aSmoke.xyz + vec3(drift.x + cos(ang) * spread * 0.45, hgt + spread * 0.25, drift.y + sin(ang) * spread * 0.45);
  float r = spread * aPuff.z;
  vA = smoothstep(0.0, 0.07, s) * (1.0 - smoothstep(0.55, 1.0, s)) * (0.25 + 0.75 * heat);
  vec4 c = viewMatrix * vec4(p, 1.0);
  c.xy += position.xy * r;
  float d = length(c.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d * 0.5);
  gl_Position = projectionMatrix * c;
}`;

const SMOKE_FRAG = /* glsl */`
uniform float uTime; uniform float uThermal; uniform vec3 uSunColor; uniform float uSunI; uniform float uAmbient; uniform vec3 uFogColor; uniform float uFireLight;
varying vec2 vUv; varying float vA; varying float vS; varying float vHeat; varying float vFog; varying float vSeed;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main() {
  vec2 q = vUv - 0.5;
  float d = length(q) * 2.0;
  float n = vn(vUv * 3.0 + vSeed * 23.0 + vec2(0.0, uTime * 0.03)) * 0.6 + vn(vUv * 7.0 - vSeed * 11.0) * 0.4;
  float a = (1.0 - smoothstep(0.25, 1.0, d + (n - 0.5) * 0.6)) * vA;
  if (a < 0.004) discard;
  // Dense grey-brown over active flame, paler drifting smoke from smouldering ground; lit from above, glowing from below.
  vec3 base = mix(vec3(0.58, 0.56, 0.53), vec3(0.24, 0.21, 0.19), vHeat);
  float top = clamp(0.5 - q.y, 0.0, 1.0);
  vec3 lit = base * (uAmbient * 0.9 + uSunColor * uSunI * (0.22 + 0.18 * top));
  lit += vec3(1.0, 0.38, 0.1) * pow(1.0 - vS, 6.0) * vHeat * (0.6 + 2.5 * uFireLight);
  lit = mix(lit, uFogColor, vFog * 0.85);
  if (uThermal > 0.5) { gl_FragColor = vec4(vec3(0.3 + 0.25 * vHeat * pow(1.0 - vS, 4.0)), a * 0.12); return; }
  gl_FragColor = vec4(lit, a * (0.72 + 0.2 * vHeat));
}`;

function quad() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
function centredQuad() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * Reconstructed fire drawn into the world from the arrival raster at the current sim time:
 * arrival/glow textures for burned ground, scorched vegetation and firelight in the world materials,
 * instanced flame billboards on flaming cells and buoyant smoke columns over the hottest clusters.
 * Everything is a function of `tRel` (scrubbing reproduces it); only flicker and puff motion use visual time.
 */
export class FireLayer {
  readonly group = new THREE.Group();
  readonly timeline: FireTimeline;
  snapshot: FireSnapshot | null = null;
  private arrival: THREE.DataTexture;
  private glow: THREE.DataTexture;
  private glowData: Uint8Array;
  private flames: THREE.Mesh;
  private flameAttr: { fire: THREE.InstancedBufferAttribute; shape: THREE.InstancedBufferAttribute };
  private smoke: THREE.Mesh;
  private smokeAttr: { src: THREE.InstancedBufferAttribute; puff: THREE.InstancedBufferAttribute };
  readonly flameMat: THREE.ShaderMaterial;
  readonly smokeMat: THREE.ShaderMaterial;
  private cellX: number; private cellZ: number;
  private builtAt = NaN;
  private builtWall = -Infinity;
  private sourceXZ: Float32Array = new Float32Array(0);
  ms = 0;

  constructor(private pack: ScenarioPack, private hf: HeightField, private U: WorldUniforms, readonly timing: FireTiming) {
    const { w, h } = pack.raster;
    this.timeline = new FireTimeline(pack.arrival, w, h);
    const f = hf.frame;
    this.cellX = (f.xMax - f.xMin) / w; this.cellZ = (f.zMax - f.zMin) / h;
    const minutes = new Float32Array(w * h);
    for (let i = 0; i < minutes.length; i++) { const a = pack.arrival[i]; minutes[i] = Number.isFinite(a) ? a / 60000 : NEVER_MIN; }
    this.arrival = new THREE.DataTexture(minutes, w, h, THREE.RedFormat, THREE.FloatType);
    this.arrival.magFilter = this.arrival.minFilter = THREE.NearestFilter;
    this.arrival.needsUpdate = true;
    const probe = fireSnapshot(this.timeline, 0, timing);
    this.glowData = new Uint8Array(probe.gw * probe.gh);
    this.glow = new THREE.DataTexture(this.glowData, probe.gw, probe.gh, THREE.RedFormat, THREE.UnsignedByteType);
    this.glow.magFilter = this.glow.minFilter = THREE.LinearFilter;
    this.glow.needsUpdate = true;
    U.uArrival.value = this.arrival; U.uGlow.value = this.glow;
    U.uFireBox.value.set(f.xMin, f.zMin, 1 / (f.xMax - f.xMin), 1 / (f.zMax - f.zMin));
    U.uFlameMin.value = timing.flameMs / 60000; U.uActiveMin.value = timing.activeMs / 60000; U.uSmoulderMin.value = timing.smoulderMs / 60000;
    U.uFireOn.value = 1;

    const shared = { uFireT: U.uFireT, uFlameMin: U.uFlameMin, uTime: U.uTime, uWind: U.uWind, uThermal: U.uThermal, uFireLight: U.uFireLight };
    this.flameMat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { ...shared, uFogDensity: { value: 0 } },
    });
    this.smokeMat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { ...shared, uFogDensity: { value: 0 }, uWindMs: { value: 1 }, uSunColor: { value: new THREE.Vector3(1, 1, 1) }, uSunI: { value: 1 }, uAmbient: { value: 0.5 }, uFogColor: { value: new THREE.Vector3() } },
    });
    const fg = quad();
    this.flameAttr = {
      fire: new THREE.InstancedBufferAttribute(new Float32Array(FLAME_CAP * 4), 4).setUsage(THREE.DynamicDrawUsage),
      shape: new THREE.InstancedBufferAttribute(new Float32Array(FLAME_CAP * 4), 4).setUsage(THREE.DynamicDrawUsage),
    };
    fg.setAttribute('aFire', this.flameAttr.fire); fg.setAttribute('aShape', this.flameAttr.shape);
    fg.instanceCount = 0;
    this.flames = new THREE.Mesh(fg, this.flameMat);
    const sg = centredQuad();
    const n = SMOKE_SOURCES * PUFFS;
    this.smokeAttr = {
      src: new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage),
      puff: new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4),
    };
    const puff = this.smokeAttr.puff.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const k = i % PUFFS, col = Math.floor(i / PUFFS);
      puff.set([(k + hash(i, 3) * 0.6) / PUFFS, hash(i, 5), 0.8 + 0.6 * hash(i, 7), 0.8 + 0.4 * hash(col, 9)], i * 4);
    }
    sg.setAttribute('aSmoke', this.smokeAttr.src); sg.setAttribute('aPuff', this.smokeAttr.puff);
    sg.instanceCount = 0;
    this.smoke = new THREE.Mesh(sg, this.smokeMat);
    for (const m of [this.flames, this.smoke]) { m.frustumCulled = false; m.matrixAutoUpdate = false; }
    this.flames.renderOrder = 5; this.smoke.renderOrder = 6;
    this.group.add(this.flames, this.smoke);
    this.group.name = 'fire';
  }

  /** Raster cell centre in local metres. */
  private cellXZ(cell: number): [number, number] {
    const { w } = this.pack.raster, f = this.hf.frame;
    return [f.xMin + ((cell % w) + 0.5) * this.cellX, f.zMin + (Math.floor(cell / w) + 0.5) * this.cellZ];
  }

  /**
   * Bring the fire to `tRel` (ms since manifest start). Shader age is exact every frame; the instance
   * set (flames, smoke columns, glow) is rebuilt when time has moved enough or on any backwards jump.
   */
  setTime(tRel: number, wallNow: number) {
    this.U.uFireT.value = tRel / 60000;
    const last = this.builtAt;
    const moved = !Number.isFinite(last) || tRel < last || Math.abs(tRel - last) > 20 * 60000;
    if (!moved && (Math.abs(tRel - last) < 1000 || wallNow - this.builtWall < 180)) return false;
    const t0 = performance.now();
    this.build(fireSnapshot(this.timeline, tRel, this.timing, { maxFlames: FLAME_CAP / 1.4 }));
    this.builtAt = tRel; this.builtWall = wallNow;
    this.ms = performance.now() - t0;
    return true;
  }

  private build(s: FireSnapshot) {
    this.snapshot = s;
    const fire = this.flameAttr.fire.array as Float32Array, shape = this.flameAttr.shape.array as Float32Array;
    let n = 0;
    for (const fl of s.flames) {
      const fuel = this.pack.fuel[fl.cell];
      const [cx, cz] = this.cellXZ(fl.cell);
      const count = (fuel === FuelClass.TimberUnderstory || fuel === FuelClass.TimberLitter) && n < FLAME_CAP - 2 ? 2 : 1;
      for (let k = 0; k < count && n < FLAME_CAP; k++) {
        const r = hash(fl.cell, k * 11 + 1);
        const x = cx + (hash(fl.cell, k * 11 + 2) - 0.5) * this.cellX * 0.9, z = cz + (hash(fl.cell, k * 11 + 3) - 0.5) * this.cellZ * 0.9;
        const [fh, fw] = flameShape(fuel, r);
        fire.set([x, this.hf.height(x, z) - 0.4, z, fl.arrival / 60000 + r * 0.25], n * 4);
        shape.set([fh, fw, hash(fl.cell, k * 11 + 4), 0.06 + 0.05 * r], n * 4);
        n++;
      }
    }
    const g = this.flames.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = n;
    for (const a of [this.flameAttr.fire, this.flameAttr.shape]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }

    for (let i = 0; i < s.glow.length; i++) this.glowData[i] = Math.round(Math.min(1, s.glow[i] * 1.4) * 255);
    this.glow.needsUpdate = true;

    const src = this.smokeAttr.src.array as Float32Array;
    const cols = Math.min(SMOKE_SOURCES, s.sources.length);
    this.sourceXZ = new Float32Array(cols * 3);
    const { w, h } = this.pack.raster;
    const f = this.hf.frame;
    for (let c = 0; c < cols; c++) {
      const so = s.sources[c];
      const x = f.xMin + (so.x + 0.5) / w * (f.xMax - f.xMin), z = f.zMin + (so.y + 0.5) / h * (f.zMax - f.zMin);
      const y = Math.max(0, this.hf.height(x, z));
      this.sourceXZ.set([x, z, so.heat], c * 3);
      for (let k = 0; k < PUFFS; k++) src.set([x, y, z, so.heat], (c * PUFFS + k) * 4);
    }
    const sg = this.smoke.geometry as THREE.InstancedBufferGeometry;
    sg.instanceCount = cols * PUFFS;
    this.smokeAttr.src.clearUpdateRanges(); this.smokeAttr.src.addUpdateRange(0, cols * PUFFS * 4); this.smokeAttr.src.needsUpdate = true;
  }

  /** Per-frame lighting inputs shared by every camera. */
  setEnv(env: WorldEnv) {
    const u = this.smokeMat.uniforms;
    u.uWindMs.value = Math.max(0.5, env.windMs);
    u.uSunColor.value.set(env.sunColor[0], env.sunColor[1], env.sunColor[2]);
    u.uSunI.value = env.sunIntensity * 0.45;
    u.uAmbient.value = env.ambient;
    u.uFogColor.value.set(env.fogColor[0], env.fogColor[1], env.fogColor[2]);
    this.U.uFireLight.value = 0.35 + 2.6 * env.night;
  }

  setFog(density: number) { this.flameMat.uniforms.uFogDensity.value = density; this.smokeMat.uniforms.uFogDensity.value = density; }

  /** Smoke load near a camera (0..1): drives local haze and the brown fog tint. */
  smokeNear(x: number, z: number) {
    const s = this.sourceXZ;
    let k = 0;
    for (let i = 0; i < s.length; i += 3) { const d = Math.hypot(s[i] - x, s[i + 1] - z); k += s[i + 2] * Math.exp(-d / 2200); }
    return Math.min(1, k * 0.5);
  }

  /** Active clusters (local x, z, heat) for sensor auto-exposure and fire-in-view estimates. */
  sources(): Float32Array { return this.sourceXZ; }

  /** True when the cell under xz has burned or is within reach of current heat (agents keep away). */
  unsafe(x: number, z: number) {
    const s = this.snapshot;
    if (!s) return false;
    const [cx, cz] = this.hf.cell(x, z);
    const { w } = this.pack.raster;
    const i = Math.floor(cz) * w + Math.floor(cx);
    if (i >= 0 && i < this.pack.arrival.length && this.pack.arrival[i] <= s.tRel) return true;
    const gx = Math.floor(cx / (w / s.gw)), gz = Math.floor(cz / (this.pack.raster.h / s.gh));
    return gx >= 0 && gz >= 0 && gx < s.gw && gz < s.gh && s.glow[gz * s.gw + gx] > 0.04;
  }

  dispose() {
    this.flames.geometry.dispose(); this.smoke.geometry.dispose(); this.flameMat.dispose(); this.smokeMat.dispose();
    this.arrival.dispose(); this.glow.dispose();
    this.U.uFireOn.value = 0;
  }
}
