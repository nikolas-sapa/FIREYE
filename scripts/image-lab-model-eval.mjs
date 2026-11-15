// Model study evaluation against independent ESA WorldCover 2020 (10 m) and the source-interpreted spot patches.
// Run kinds: grid (four 576 px halo outputs <run>-<nw|ne|sw|se>.png), scene (one whole-scene output <run>.png),
// masks (binary class masks <run>-V.png and optional <run>-N.png from a segmentation model).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { dir, decode, save, resize, classify, overlay, palette } from './image-lab-study-images.mjs';

const SIDE = 1024, HALO = 576, CELL = 512, LABELS = ['nw', 'ne', 'sw', 'se'];
const origin = i => ({ x: i % 2 ? SIDE - HALO : 0, y: i >= 2 ? SIDE - HALO : 0 });
const V = 0, N = 1, U = 2;
const wc = readFileSync(join(dir, 'models/worldcover-2020.bin'));
// WorldCover -> study classes. V: tree cover, shrubland. N: bare/sparse, water, snow. U: grass, crop, built, wetland, moss.
const wcClass = k => (k === 10 || k === 20 ? V : k === 60 || k === 70 || k === 80 ? N : U);
const ref = Uint8Array.from(wc, wcClass);
const tree = Uint8Array.from(wc, k => +(k === 10));
const file = name => join(dir, name);
const find = base => [`${base}.png`, `${base}.jpg`, `${base}.jpeg`, `${base}.webp`].find(n => existsSync(file(n)));

// snap: nearest palette color with no tolerance, to separate label semantics from exact-color compliance.
let snap = false;
function frameLabels(name, size) {
  const image = resize(decode(name), size, size), out = classify(image);
  if (snap) for (let i = 0; i < out.labels.length; i++) {
    const d = palette.map(rgb => rgb.reduce((s, c, k) => s + (c - image.data[i * 3 + k]) ** 2, 0));
    out.labels[i] = d.indexOf(Math.min(...d));
  }
  return { labels: out.labels, invalid: out.metrics.invalidFraction };
}
export function labelsOf(run, kind) {
  const full = new Uint8Array(SIDE * SIDE);
  const gate = {};
  let overlap = null;
  if (kind === 'grid') {
    const frames = LABELS.map((l, i) => ({ i, ...origin(i), ...frameLabels(find(`${run}-${l}`) ?? find(`${run}-${l.toUpperCase()}`), HALO) }));
    frames.forEach((f, i) => { gate[LABELS[i].toUpperCase()] = +f.invalid.toFixed(4); });
    for (const f of frames) {
      const cx = f.i % 2 * CELL, cy = f.i >= 2 ? CELL : 0;
      for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) full[(cy + y) * SIDE + cx + x] = f.labels[(cy + y - f.y) * HALO + cx + x - f.x];
    }
    const at = (f, x, y) => f.labels[(y - f.y) * HALO + x - f.x];
    const agree = (a, b, x0, x1, y0, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { n++; s += at(a, x, y) === at(b, x, y); } return +(s / n).toFixed(3); };
    const [nw, ne, sw, se] = frames, lo = SIDE - HALO, hi = HALO;
    overlap = { 'NW|NE': agree(nw, ne, lo, hi, 0, HALO), 'SW|SE': agree(sw, se, lo, hi, lo, SIDE), 'NW|SW': agree(nw, sw, 0, HALO, lo, hi), 'NE|SE': agree(ne, se, lo, SIDE, lo, hi) };
  } else if (kind === 'scene') {
    const f = frameLabels(find(run), SIDE);
    full.set(f.labels); gate.scene = +f.invalid.toFixed(4);
  } else if (kind === 'masks') {
    full.fill(U);
    const mask = cls => {
      const name = find(`${run}-${cls}`);
      if (!name) return null;
      const m = resize(decode(name), SIDE, SIDE);
      return Uint8Array.from({ length: SIDE * SIDE }, (_, i) => +(m.data[i * 3] + m.data[i * 3 + 1] + m.data[i * 3 + 2] > 384));
    };
    const mv = mask('V'), mn = mask('N');
    for (let i = 0; i < full.length; i++) {
      const v = mv?.[i], n = mn?.[i];
      full[i] = v && !n ? V : n && !v ? N : U;
    }
    gate.masks = 0;
  } else throw Error('kind must be grid, scene or masks');
  return { full, gate, overlap };
}

export function score(full) {
  const cm = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < full.length; i++) cm[ref[i]][full[i]]++;
  const n = full.length, acc = (cm[0][0] + cm[1][1] + cm[2][2]) / n;
  const rows = cm.map(r => r.reduce((a, b) => a + b, 0)), cols = [0, 1, 2].map(j => cm.reduce((a, r) => a + r[j], 0));
  const pe = rows.reduce((s, r, k) => s + r * cols[k], 0) / n / n;
  const f1 = k => { const p = cm[k][k] / (cols[k] || 1), r = cm[k][k] / (rows[k] || 1); return p + r ? 2 * p * r / (p + r) : 0; };
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < full.length; i++) { const p = full[i] === V, t = tree[i] === 1; tp += p && t; fp += p && !t; fn += !p && t; }
  // Seam: label continuity across the cuts versus just inside the cells.
  let cut = 0, ctl = 0;
  for (let t = 0; t < SIDE; t++) {
    const v = k => full[t * SIDE + k], h = k => full[k * SIDE + t];
    cut += (v(511) === v(512)) + (h(511) === h(512));
    ctl += ((v(508) === v(509)) + (v(514) === v(515)) + (h(508) === h(509)) + (h(514) === h(515))) / 2;
  }
  const patches = JSON.parse(readFileSync(join(dir, 'reference-patches.json'), 'utf8')).patches;
  const ids = ['V', 'N', 'U'];
  const ok = patches.filter(p => {
    const [x, y, w, h] = p.rect, c = [0, 0, 0];
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) c[full[yy * SIDE + xx]]++;
    return ids[c.indexOf(Math.max(...c))] === p.expected;
  }).length;
  const share = [0, 1, 2].map(k => +(cols[k] / n).toFixed(3));
  return {
    worldcover: { accuracy: +acc.toFixed(3), kappa: +((acc - pe) / (1 - pe)).toFixed(3), f1: { V: +f1(0).toFixed(3), N: +f1(1).toFixed(3), U: +f1(2).toFixed(3) },
      treeIoU: +(tp / (tp + fp + fn)).toFixed(3), treeRecall: +(tp / (tp + fn)).toFixed(3) },
    patches: `${ok}/${patches.length}`, classShare: share, seam: { acrossCut: +(cut / (2 * SIDE)).toFixed(3), control: +(ctl / (2 * SIDE)).toFixed(3) },
  };
}

if (process.argv[1]?.endsWith('image-lab-model-eval.mjs')) {
  const [run, kind = 'grid'] = process.argv.slice(2);
  if (run === '--reference') {
    console.log(JSON.stringify({ refShare: [V, N, U].map(k => +(ref.filter(v => v === k).length / ref.length).toFixed(3)), ...score(ref) }));
  } else {
    if (!/^[a-z0-9/-]+$/i.test(run ?? '')) throw Error('Use: node scripts/image-lab-model-eval.mjs <run> [grid|scene|masks] [--write]');
    const { full, gate, overlap } = labelsOf(run, kind);
    const metrics = { run, kind, offPalette: gate, overlapAgreement: overlap, ...score(full) };
    if (kind !== 'masks') { snap = true; const snapped = score(labelsOf(run, kind).full); snap = false;
      metrics.snapped = { kappa: snapped.worldcover.kappa, f1V: snapped.worldcover.f1.V, treeIoU: snapped.worldcover.treeIoU, patches: snapped.patches, classShare: snapped.classShare }; }
    if (process.argv.includes('--write')) {
      const mask = { width: SIDE, height: SIDE, data: new Uint8Array(SIDE * SIDE * 3) };
      full.forEach((l, i) => mask.data.set(palette[l], i * 3));
      save(`${run}-mask.png`, mask); save(`${run}-overlay.png`, overlay(decode('source.png'), mask));
      writeFileSync(file(`${run}-metrics.json`), JSON.stringify(metrics, null, 2) + '\n');
    }
    console.log(JSON.stringify(metrics));
  }
}
