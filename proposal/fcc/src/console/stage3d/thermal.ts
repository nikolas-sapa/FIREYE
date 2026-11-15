import * as Cesium from 'cesium';
import { prefersReducedMotion } from './easing';

/**
 * Simulated white-hot thermal look for the main globe: a post-process over the rendered frame.
 * Fire-hued pixels (front, flames, embers) become the hottest whites; everything else is a cool
 * luminance ramp. Not radiometric and never a temperature measurement.
 */
export class ThermalPass {
  readonly stage: Cesium.PostProcessStage;
  private target = 0;
  private value = 0;
  private raf = 0;
  private last = 0;
  private t0 = performance.now();
  private offTick: () => void;

  constructor(private scene: Cesium.Scene) {
    this.stage = new Cesium.PostProcessStage({
      name: 'fireye-thermal',
      fragmentShader: `
uniform sampler2D colorTexture;
uniform float blend;
uniform float time;
uniform vec2 texel;
in vec2 v_textureCoordinates;
float heatOf(vec3 c) {
  float warm = clamp((c.r - max(c.g * 0.82, c.b) ) * 2.6, 0.0, 1.0);
  return warm * smoothstep(0.18, 0.75, c.r);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = v_textureCoordinates;
  vec3 c = texture(colorTexture, uv).rgb;
  if (blend <= 0.0) { out_FragColor = vec4(c, 1.0); return; }
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float h = heatOf(c);
  float glow = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    vec2 o = vec2(cos(a), sin(a)) * texel * 3.0;
    glow += heatOf(texture(colorTexture, uv + o).rgb) + heatOf(texture(colorTexture, uv + o * 2.2).rgb) * 0.6;
  }
  glow /= 12.8;
  float base = 0.07 + 0.30 * pow(l, 0.85);
  float v = base + (1.0 - base) * clamp(h * 1.15 + glow * 0.75, 0.0, 1.0);
  v += (hash(uv * 900.0 + time) - 0.5) * 0.035;
  vec2 d = uv - 0.5;
  v *= 1.0 - 0.38 * dot(d, d) * 2.0;
  vec3 th = vec3(clamp(v, 0.0, 1.0));
  out_FragColor = vec4(mix(c, th, blend), 1.0);
}`,
      uniforms: {
        blend: () => this.value,
        time: () => ((performance.now() - this.t0) / 1000) % 100,
        texel: () => new Cesium.Cartesian2(1 / Math.max(1, scene.drawingBufferWidth), 1 / Math.max(1, scene.drawingBufferHeight)),
      },
    });
    this.stage.enabled = false;
    scene.postProcessStages.add(this.stage);
    // Grain animates only while the pass is visible.
    this.offTick = scene.preRender.addEventListener(() => { if (this.value > 0) scene.requestRender(); });
  }

  get on() { return this.target > 0; }

  set(on: boolean) {
    this.target = on ? 1 : 0;
    if (prefersReducedMotion()) {
      this.value = this.target;
      this.stage.enabled = this.value > 0;
      this.scene.requestRender();
      return;
    }
    this.stage.enabled = true;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.step);
    }
  }

  private step = (now: number) => {
    const dt = Math.min(64, now - this.last);
    this.last = now;
    const dir = Math.sign(this.target - this.value);
    this.value = Math.max(0, Math.min(1, this.value + dir * dt / 520));
    this.scene.requestRender();
    if (this.value === this.target) {
      this.raf = 0;
      this.stage.enabled = this.value > 0;
      return;
    }
    this.raf = requestAnimationFrame(this.step);
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.offTick();
    if (!this.scene.isDestroyed()) this.scene.postProcessStages.remove(this.stage);
  }
}
