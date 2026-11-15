import { hash2 } from './rng';
import type { MeshArrays } from './types';

export interface Xf { x?: number; y?: number; z?: number; ry?: number; rx?: number; rz?: number; sx?: number; sy?: number; sz?: number }
export type Rgb = readonly [number, number, number];

export function srgbToLinear(c: number) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function hex(h: number): Rgb { return [srgbToLinear(((h >> 16) & 255) / 255), srgbToLinear(((h >> 8) & 255) / 255), srgbToLinear((h & 255) / 255)]; }
export function mix(a: Rgb, b: Rgb, t: number): Rgb { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function scale(a: Rgb, k: number): Rgb { return [a[0] * k, a[1] * k, a[2] * k]; }

/** Low-poly, flat-coloured, non-indexed triangle builder. Pure data so it runs in workers and Node tests. */
export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private flag: number[] = [];
  private face = 0;
  constructor(private seed = 1, private facet = 0.12) {}

  private xf(p: [number, number, number], t?: Xf): [number, number, number] {
    if (!t) return p;
    let [x, y, z] = p;
    x *= t.sx ?? 1; y *= t.sy ?? 1; z *= t.sz ?? 1;
    if (t.rx) { const c = Math.cos(t.rx), s = Math.sin(t.rx); [y, z] = [y * c - z * s, y * s + z * c]; }
    if (t.rz) { const c = Math.cos(t.rz), s = Math.sin(t.rz); [x, y] = [x * c - y * s, x * s + y * c]; }
    if (t.ry) { const c = Math.cos(t.ry), s = Math.sin(t.ry); [x, z] = [x * c + z * s, -x * s + z * c]; }
    return [x + (t.x ?? 0), y + (t.y ?? 0), z + (t.z ?? 0)];
  }

  tri(a: [number, number, number], b: [number, number, number], c: [number, number, number], color: Rgb, flag = 0, t?: Xf) {
    const k = 1 - this.facet / 2 + this.facet * hash2(this.face++, 3, this.seed);
    for (const p of [a, b, c]) {
      const q = this.xf(p, t);
      this.pos.push(q[0], q[1], q[2]);
      this.col.push(color[0] * k, color[1] * k, color[2] * k);
      this.flag.push(flag);
    }
  }
  quad(a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], color: Rgb, flag = 0, t?: Xf) {
    const k = this.face;
    this.tri(a, b, c, color, flag, t);
    this.face = k; // both halves of a quad share one facet tone
    this.tri(a, c, d, color, flag, t);
  }

  /** Axis-aligned box, origin at the bottom centre. `faces` drops hidden faces (bit 0 bottom). */
  box(w: number, h: number, d: number, color: Rgb, t?: Xf, flag = 0, opts: { bottom?: boolean; top?: Rgb; sideFlag?: number } = {}) {
    const x = w / 2, z = d / 2;
    const p = (px: number, py: number, pz: number): [number, number, number] => [px, py, pz];
    const sf = opts.sideFlag ?? flag;
    this.quad(p(-x, 0, z), p(x, 0, z), p(x, h, z), p(-x, h, z), color, sf, t);
    this.quad(p(x, 0, -z), p(-x, 0, -z), p(-x, h, -z), p(x, h, -z), color, sf, t);
    this.quad(p(x, 0, z), p(x, 0, -z), p(x, h, -z), p(x, h, z), color, sf, t);
    this.quad(p(-x, 0, -z), p(-x, 0, z), p(-x, h, z), p(-x, h, -z), color, sf, t);
    this.quad(p(-x, h, z), p(x, h, z), p(x, h, -z), p(-x, h, -z), opts.top ?? color, flag, t);
    if (opts.bottom) this.quad(p(-x, 0, -z), p(x, 0, -z), p(x, 0, z), p(-x, 0, z), color, flag, t);
  }

  /** Cylinder / cone / frustum on the +y axis, bottom at y = 0. */
  cyl(rb: number, rt: number, h: number, seg: number, color: Rgb, t?: Xf, flag = 0, opts: { top?: boolean; bottom?: boolean; capColor?: Rgb } = {}) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const b0: [number, number, number] = [Math.cos(a0) * rb, 0, Math.sin(a0) * rb], b1: [number, number, number] = [Math.cos(a1) * rb, 0, Math.sin(a1) * rb];
      const t0: [number, number, number] = [Math.cos(a0) * rt, h, Math.sin(a0) * rt], t1: [number, number, number] = [Math.cos(a1) * rt, h, Math.sin(a1) * rt];
      if (rt > 1e-4) this.quad(b1, b0, t0, t1, color, flag, t); else this.tri(b1, b0, [0, h, 0], color, flag, t);
      if (opts.top !== false && rt > 1e-4) this.tri([0, h, 0], t1, t0, opts.capColor ?? color, flag, t);
      if (opts.bottom) this.tri([0, 0, 0], b0, b1, opts.capColor ?? color, flag, t);
    }
  }

  /** Faceted blob: octahedron (detail 0) or icosahedron (detail 1), jittered for organic crowns. */
  blob(r: number, color: Rgb, t?: Xf, flag = 0, detail = 1, jitter = 0.18, squash = 1) {
    const verts: [number, number, number][] = [];
    let faces: [number, number, number][];
    if (detail === 0) {
      verts.push([1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]);
      faces = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];
    } else {
      const g = (1 + Math.sqrt(5)) / 2;
      for (const [a, b] of [[-1, g], [1, g], [-1, -g], [1, -g]]) verts.push([a, b, 0]);
      for (const [a, b] of [[-1, g], [1, g], [-1, -g], [1, -g]]) verts.push([0, a, b]);
      for (const [a, b] of [[-1, g], [1, g], [-1, -g], [1, -g]]) verts.push([b, 0, a]);
      faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    }
    const s = this.seed * 31 + verts.length;
    const v = verts.map(([x, y, z], i) => {
      const len = Math.hypot(x, y, z), k = r * (1 - jitter / 2 + jitter * hash2(i, s, 5)) / len;
      return [x * k, y * k * squash, z * k] as [number, number, number];
    });
    for (const [a, b, c] of faces) this.tri(v[a], v[b], v[c], color, flag, t);
  }

  /** Gable roof over a w×d footprint, ridge along x. */
  gable(w: number, d: number, h: number, color: Rgb, t?: Xf, gableColor?: Rgb) {
    const x = w / 2 + 0.3, z = d / 2 + 0.3;
    this.quad([-x, 0, z], [x, 0, z], [x, h, 0], [-x, h, 0], color, 0, t);
    this.quad([x, 0, -z], [-x, 0, -z], [-x, h, 0], [x, h, 0], color, 0, t);
    const gc = gableColor ?? color;
    this.tri([x - 0.3, 0, z - 0.3], [x - 0.3, 0, -z + 0.3], [x - 0.3, h, 0], gc, 0, t);
    this.tri([-x + 0.3, 0, -z + 0.3], [-x + 0.3, 0, z - 0.3], [-x + 0.3, h, 0], gc, 0, t);
  }
  /** Hip roof (pyramid to a short ridge). */
  hip(w: number, d: number, h: number, color: Rgb, t?: Xf) {
    const x = w / 2 + 0.35, z = d / 2 + 0.35, r = Math.max(0, x - z) * 0.9;
    this.quad([-x, 0, z], [x, 0, z], [r, h, 0], [-r, h, 0], color, 0, t);
    this.quad([x, 0, -z], [-x, 0, -z], [-r, h, 0], [r, h, 0], color, 0, t);
    this.tri([x, 0, z], [x, 0, -z], [r, h, 0], color, 0, t);
    this.tri([-x, 0, -z], [-x, 0, z], [-r, h, 0], color, 0, t);
  }
  /** Torus-like ring lying flat (tyres). */
  ring(R: number, r: number, seg: number, color: Rgb, t?: Xf, flag = 0) {
    const sides = 4;
    const at = (i: number, j: number): [number, number, number] => {
      const a = (i / seg) * Math.PI * 2, b = (j / sides) * Math.PI * 2 + Math.PI / 4;
      const rr = R + Math.cos(b) * r;
      return [Math.cos(a) * rr, r + Math.sin(b) * r, Math.sin(a) * rr];
    };
    for (let i = 0; i < seg; i++) for (let j = 0; j < sides; j++)
      this.quad(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j), color, flag, t);
  }
  /** Vertical blade (double sided triangle) for grass and reeds. */
  blade(x: number, z: number, w: number, h: number, ang: number, lean: number, color: Rgb, tip: Rgb, flag = 1) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const a: [number, number, number] = [x - c * w, 0, z - s * w], b: [number, number, number] = [x + c * w, 0, z + s * w];
    const top: [number, number, number] = [x + s * lean, h, z - c * lean];
    const col = mix(color, tip, 0.5);
    this.tri(a, b, top, col, flag); this.tri(b, a, top, col, flag);
  }

  get vertexCount() { return this.pos.length / 3; }

  /** windRef: height at which sway weight reaches 1 (0 = rigid). */
  build(windRef = 0, windPow = 1.6): MeshArrays {
    const n = this.pos.length / 3;
    const position = new Float32Array(this.pos), color = new Float32Array(this.col);
    const meta = new Float32Array(n * 2), params = new Float32Array(0);
    for (let i = 0; i < n; i++) {
      const y = position[i * 3 + 1];
      meta[i * 2] = windRef > 0 ? Math.pow(Math.max(0, y) / windRef, windPow) : 0;
      meta[i * 2 + 1] = this.flag[i];
    }
    return { position, color, meta, params };
  }
}
