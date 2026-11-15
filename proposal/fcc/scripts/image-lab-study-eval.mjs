// Deterministic evaluation of a 2x2 halo grid run against the study's source-interpreted reference patches.
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir, decode, save, crop, resize, classify, overlay, palette } from './image-lab-study-images.mjs';

const LABELS = ['NW', 'NE', 'SW', 'SE'];
const HALO = 576, CELL = 512, SIDE = 1024;
const origin = i => ({ x: i % 2 ? SIDE - HALO : 0, y: Math.floor(i / 2) ? SIDE - HALO : 0 });

export function evaluate(run, overlapMode = 'halo') {
  const frames = LABELS.map((label, i) => {
    const out = classify(resize(decode(`${run}-${label.toLowerCase()}.png`), HALO, HALO));
    return { label, i, ...origin(i), labels: out.labels, invalid: out.metrics.invalidFraction, counts: out.metrics.counts };
  });
  const full = new Uint8Array(SIDE * SIDE);
  for (const f of frames) {
    const cx = f.i % 2 * CELL, cy = Math.floor(f.i / 2) * CELL;
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) full[(cy + y) * SIDE + cx + x] = f.labels[(cy + y - f.y) * HALO + cx + x - f.x];
  }
  const at = (f, x, y) => f.labels[(y - f.y) * HALO + x - f.x];
  const agree = (a, b, x0, x1, y0, y1) => {
    let same = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; if (at(a, x, y) === at(b, x, y)) same++; }
    return +(same / n).toFixed(3);
  };
  const [nw, ne, sw, se] = frames;
  const lo = SIDE - HALO, hi = HALO;
  const overlapAgreement = overlapMode === 'halo'
    ? { 'NW|NE': agree(nw, ne, lo, hi, 0, HALO), 'SW|SE': agree(sw, se, lo, hi, lo, SIDE), 'NW|SW': agree(nw, sw, 0, HALO, lo, hi), 'NE|SE': agree(ne, se, lo, SIDE, lo, hi) }
    : null;
  let cut = 0, cutN = 0, ctl = 0, ctlN = 0;
  for (let t = 0; t < SIDE; t++) {
    const v = k => full[t * SIDE + k], h = k => full[k * SIDE + t];
    cut += (v(511) === v(512)) + (h(511) === h(512)); cutN += 2;
    ctl += (v(508) === v(509)) + (v(514) === v(515)) + (h(508) === h(509)) + (h(514) === h(515)); ctlN += 4;
  }
  const ref = JSON.parse(readFileSync(join(dir, 'reference-patches.json'), 'utf8'));
  const ids = ['V', 'N', 'U'];
  const patches = ref.patches.map(p => {
    const [x, y, w, h] = p.rect, c = [0, 0, 0];
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) c[full[yy * SIDE + xx]]++;
    const got = ids[c.indexOf(Math.max(...c))];
    return { id: p.id, expected: p.expected, got, ok: got === p.expected };
  });
  const share = [0, 0, 0];
  for (const l of full) share[l]++;
  return {
    full,
    metrics: {
      perCell: Object.fromEntries(frames.map(f => [f.label, { invalid: +f.invalid.toFixed(4), counts: f.counts, gate15: f.invalid <= 0.15 }])),
      classShare: share.map(s => +(s / full.length).toFixed(3)),
      refPatches: `${patches.filter(p => p.ok).length}/${patches.length}`,
      patches: patches.map(p => `${p.id}:${p.expected}->${p.got}`),
      overlapAgreement,
      seam: { acrossCut: +(cut / cutN).toFixed(3), control: +(ctl / ctlN).toFixed(3) },
    },
  };
}

if (process.argv[1]?.endsWith('image-lab-study-eval.mjs')) {
  const run = process.argv[2];
  if (!/^[a-z0-9-]+$/.test(run ?? '')) throw Error('Use: node scripts/image-lab-study-eval.mjs <run> [--write]');
  const { full, metrics } = evaluate(run);
  if (process.argv.includes('--write')) {
    const source = decode('source.png');
    const mask = { width: SIDE, height: SIDE, data: new Uint8Array(SIDE * SIDE * 3) };
    full.forEach((l, i) => mask.data.set(palette[l], i * 3));
    save(`${run}-mask.png`, mask); save(`${run}-overlay.png`, overlay(source, mask));
    writeFileSync(join(dir, `${run}-metrics.json`), JSON.stringify(metrics, null, 2) + '\n');
  }
  console.log(JSON.stringify(metrics));
}
