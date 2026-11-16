/**
 * Fire state for World3D, derived only from the pack's arrival raster at one sim time.
 * Every query returns cells whose arrival is at or before `tRel`; nothing here reads later arrivals.
 * Pure and deterministic (no DOM, three.js, clocks or randomness) so it runs in Node tests.
 */

export interface FireTiming {
  /** Cells that ignited within this window count as actively burning (heat 1 → 0). */
  activeMs: number;
  /** Visible flaming window after ignition. */
  flameMs: number;
  /** Smouldering tail: faint embers and residual smoke after the active window. */
  smoulderMs: number;
}

export interface FireSource { x: number; y: number; heat: number }

export interface FireSnapshot {
  tRel: number;
  burned: number;
  active: number;
  /** Flaming cells: raster index and arrival (ms since start), oldest first. */
  flames: { cell: number; arrival: number }[];
  /** Heat density on a coarse grid (0..1), blurred; drives firelight, haze and thermal glow. */
  glow: Float32Array;
  gw: number;
  gh: number;
  /** Clustered active/smouldering areas in raster cell coordinates, hottest first (smoke columns). */
  sources: FireSource[];
}

/** Arrival-sorted index of burnable cells; built once per pack. */
export class FireTimeline {
  readonly order: Uint32Array;
  readonly times: Float64Array;
  constructor(readonly arrival: Float32Array, readonly w: number, readonly h: number) {
    const idx: number[] = [];
    for (let i = 0; i < arrival.length; i++) if (Number.isFinite(arrival[i])) idx.push(i);
    idx.sort((a, b) => arrival[a] - arrival[b] || a - b);
    this.order = Uint32Array.from(idx);
    this.times = Float64Array.from(idx, i => arrival[i]);
  }
  /** Number of cells with arrival <= t. */
  upTo(t: number): number {
    let lo = 0, hi = this.times.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.times[m] <= t) lo = m + 1; else hi = m; }
    return lo;
  }
}

export function fireTiming(activeMs: number): FireTiming {
  return { activeMs, flameMs: Math.min(activeMs * 0.5, 6 * 60000), smoulderMs: Math.max(activeMs * 4, 150 * 60000) };
}

const hashCell = (i: number) => {
  let h = (i ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * State at `tRel` (ms since manifest start). Cells are only ever read from the sorted prefix that has
 * already ignited, so the result cannot depend on future arrivals.
 */
export function fireSnapshot(tl: FireTimeline, tRel: number, timing: FireTiming, opts: { maxFlames?: number; glowCells?: number; binCells?: number; maxSources?: number } = {}): FireSnapshot {
  const { w, h, order, times } = tl;
  const maxFlames = opts.maxFlames ?? 3500, g = opts.glowCells ?? 6, bin = opts.binCells ?? 12, maxSources = opts.maxSources ?? 40;
  const end = tl.upTo(tRel);
  const lowerBound = (t: number) => { let lo = 0, hi = end; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m + 1; else hi = m; } return lo; };
  const flameStart = lowerBound(tRel - timing.flameMs), activeStart = lowerBound(tRel - timing.activeMs), smoulderStart = lowerBound(tRel - timing.smoulderMs);

  // Flames: stable deterministic thinning keeps the same cells lit as time advances (no flicker between rebuilds).
  const flameCount = end - flameStart, keep = flameCount > maxFlames ? maxFlames / flameCount : 1;
  const flames: FireSnapshot['flames'] = [];
  for (let k = flameStart; k < end; k++) { const cell = order[k]; if (keep >= 1 || hashCell(cell) < keep) flames.push({ cell, arrival: times[k] }); }

  const gw = Math.ceil(w / g), gh = Math.ceil(h / g);
  let glow = new Float32Array(gw * gh);
  const bw = Math.ceil(w / bin), bh = Math.ceil(h / bin);
  const sum = new Float32Array(bw * bh), sx = new Float32Array(bw * bh), sy = new Float32Array(bw * bh);
  for (let k = smoulderStart; k < end; k++) {
    const cell = order[k], age = tRel - times[k];
    const x = cell % w, y = (cell / w) | 0;
    const heat = age < timing.activeMs ? Math.sqrt(1 - age / timing.activeMs) : 0;
    const smoulder = 0.12 * (1 - (age - timing.activeMs) / (timing.smoulderMs - timing.activeMs));
    const e = Math.max(heat, smoulder);
    if (e <= 0) continue;
    glow[((y / g) | 0) * gw + ((x / g) | 0)] += e;
    const b = ((y / bin) | 0) * bw + ((x / bin) | 0);
    sum[b] += e; sx[b] += x * e; sy[b] += y * e;
  }
  const norm = 1 / (g * g * 0.45);
  for (let i = 0; i < glow.length; i++) glow[i] = Math.min(1, glow[i] * norm);
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(glow.length);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const k = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
        s += glow[yy * gw + xx] * k; n += k;
      }
      out[y * gw + x] = s / n;
    }
    glow = out;
  }

  const bins: number[] = [];
  for (let i = 0; i < sum.length; i++) if (sum[i] > bin * 0.15) bins.push(i);
  bins.sort((a, b) => sum[b] - sum[a] || a - b);
  const sources = bins.slice(0, maxSources).map(b => ({ x: sx[b] / sum[b], y: sy[b] / sum[b], heat: Math.min(1, sum[b] / (bin * bin * 0.3)) }));
  return { tRel, burned: end, active: end - activeStart, flames, glow, gw, gh, sources };
}
