import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = /* glsl */`
uniform sampler2D tScene; uniform float uExposure; uniform float uTime; uniform float uGrain; uniform float uVignette; uniform float uSat; uniform vec2 uRes; uniform float uContrast; uniform float uThermal;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 i = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 o = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c *= uExposure / 0.6; c = i * c; c = RRTAndODTFit(c); c = o * c; return clamp(c, 0.0, 1.0);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  if (uThermal > 0.5) {
    // Fixed AGC window: background terrain sits near 0.3–0.45, active flame reaches 1+.
    float t = pow(clamp((c.r - 0.26) / 0.6, 0.0, 1.0), 0.9);
    vec3 iron = clamp(vec3(1.6 * t - 0.05, 2.0 * t * t - 0.25, 0.6 * sin(t * 3.1416) + max(0.0, 3.0 * t - 2.2)), 0.0, 1.0);
    vec3 o = uThermal > 1.5 ? iron : vec3(t);
    float nn = hash(floor(vUv * uRes) + fract(uTime * 7.31) * 811.0) - 0.5;
    o += nn * 0.035;
    vec2 qq = vUv - 0.5;
    o *= 1.0 - 0.25 * dot(qq, qq) * 2.2;
    gl_FragColor = vec4(clamp(o, 0.0, 1.0), 1.0);
    return;
  }
  c = aces(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = srgb(c);
  c = (c - 0.5) * uContrast + 0.5;
  float n = hash(floor(vUv * uRes) + fract(uTime * 7.31) * 811.0) + hash(floor(vUv * uRes) * 1.7 + fract(uTime * 3.17) * 419.0) - 1.0;
  c += n * uGrain * (0.35 + 0.9 * (1.0 - l));
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * dot(q, q) * 2.2;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

/** EO sensor finish: ACES tonemap, sensor gain/grain that rises in low light, mild vignette. */
export class SensorPost {
  readonly material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
    uniforms: { tScene: { value: null }, uExposure: { value: 1 }, uTime: { value: 0 }, uGrain: { value: 0.02 }, uVignette: { value: 0.3 }, uSat: { value: 1 }, uRes: { value: new THREE.Vector2(384, 216) }, uContrast: { value: 1.04 }, uThermal: { value: 0 } },
  });
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const m = new THREE.Mesh(g, this.material); m.frustumCulled = false;
    this.scene.add(m);
  }
  render(renderer: THREE.WebGLRenderer, input: THREE.Texture, w: number, h: number) {
    this.material.uniforms.tScene.value = input;
    this.material.uniforms.uRes.value.set(w, h);
    // The full-screen triangle covers its atlas slot; clearing would wipe the slots of cameras drawn earlier this frame.
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = clear;
  }
  dispose() { this.material.dispose(); }
}
