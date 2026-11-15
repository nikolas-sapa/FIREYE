#!/usr/bin/env node
/**
 * Sanity check for public/data/mati/: burned area and perimeter at each documented checkpoint, model arrival
 * near each checkpoint position vs the documented time, first arrival at the coast, and FIRMS consistency.
 *   node scripts/check-mati.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/data/mati');
const j = (f) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
const bin = (f, T) => { const b = readFileSync(path.join(DIR, f)); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
const m = j('manifest.json'), r = j('raster.json');
const { checkpoints } = j('checkpoints.json');
const { hotspots } = j('hotspots.json');
const arr = bin('arrival.bin', Float32Array), fuel = bin('fuel.bin', Uint8Array);
const { w: W, h: H, bbox: B } = r;
const N = W * H, HA = r.cellHa, DX = r.dxM, DY = r.dyM;
const loc = (t) => new Date(t + m.tzOffsetMin * 60e3).toISOString().slice(11, 16);
const cellOf = (p) => Math.floor(((B[3] - p.lat) / (B[3] - B[1])) * H) * W + Math.floor(((p.lon - B[0]) / (B[2] - B[0])) * W);

function state(t) {
  const rel = t - m.start;
  const burn = new Uint8Array(N);
  let n = 0;
  for (let i = 0; i < N; i++) if (arr[i] <= rel) { burn[i] = 1; n++; }
  let eh = 0, ev = 0;
  for (let i = 0; i < N; i++) {
    if (!burn[i]) continue;
    const x = i % W;
    if (x === 0 || !burn[i - 1]) ev++;
    if (x === W - 1 || !burn[i + 1]) ev++;
    if (i < W || !burn[i - W]) eh++;
    if (i >= N - W || !burn[i + W]) eh++;
  }
  return { ha: n * HA, perimM: ((eh * DX + ev * DY) * Math.PI) / 4 };
}
function firstArrivalNear(pos, rM) {
  const c = cellOf(pos), x0 = c % W, y0 = (c / W) | 0;
  let best = Infinity;
  for (let dy = -Math.ceil(rM / DY); dy <= Math.ceil(rM / DY); dy++) for (let dx = -Math.ceil(rM / DX); dx <= Math.ceil(rM / DX); dx++) {
    const x = x0 + dx, y = y0 + dy;
    if (x < 0 || y < 0 || x >= W || y >= H || Math.hypot(dx * DX, dy * DY) > rM) continue;
    const a = arr[y * W + x];
    if (a === a && a < best) best = a;
  }
  return best === Infinity ? null : m.start + best;
}

console.log(`Mati pack: grid ${W}x${H} @ ${r.cellM} m, replay ${loc(m.start)}-${loc(m.end)} ${m.tz}`);
console.log('\ncheckpoint        documented  burned ha  perimeter m  doc perim  model at point  err min  first within radius  err min  +/-');
for (const c of checkpoints) {
  const s = state(c.t);
  const at = c.pos ? firstArrivalNear(c.pos, 30) : null;
  const near = c.pos ? firstArrivalNear(c.pos, c.radiusM ?? 300) : null;
  const e = (v) => (v != null ? String(Math.round((v - c.t) / 60e3)).padStart(5) : '    -');
  console.log(`${c.id.padEnd(17)} ${loc(c.t)}       ${s.ha.toFixed(0).padStart(6)}     ${s.perimM.toFixed(0).padStart(6)}      ${String(c.perimeterM ?? '-').padStart(5)}      ${at != null ? loc(at) : '  -  '}      ${e(at)}    ${near != null ? loc(near) : '  -  '} (${String(c.radiusM ?? '-').padStart(3)} m)     ${e(near)}    ${c.uncertaintyMin ?? '-'}`);
}
let coast = Infinity, coastCell = -1;
for (let i = 0; i < N; i++) {
  const a = arr[i];
  if (!(a === a) || a >= coast) continue;
  const x = i % W, y = (i / W) | 0;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H && fuel[ny * W + nx] === 1 && (nx > W * 0.6)) { if (a < coast) { coast = a; coastCell = i; } }
  }
}
const cg = { lon: B[0] + ((coastCell % W) + 0.5) / W * (B[2] - B[0]), lat: B[3] - (((coastCell / W) | 0) + 0.5) / H * (B[3] - B[1]) };
console.log(`\nfirst arrival at the coast: ${loc(m.start + coast)} ${m.tz} at ${cg.lat.toFixed(4)}, ${cg.lon.toFixed(4)} (documented 18:45, prosecutor ~19:00, IAWF < 2 h after 16:41)`);
let total = 0, last = -Infinity;
for (let i = 0; i < N; i++) if (arr[i] === arr[i]) { total++; last = Math.max(last, arr[i]); }
console.log(`total burned ${(total * HA).toFixed(0)} ha (EFFIS ${m.effis?.areaHa} ha); last cell ${loc(m.start + last)} ${m.tz}`);
for (const t of ['17:00', '17:30', '18:00', '18:30', '19:00', '19:30']) {
  const tt = Date.parse(`2018-07-23T${t}:00+03:00`);
  console.log(`  ${t} ${m.tz}: ${state(tt).ha.toFixed(0)} ha`);
}
let inBurn = 0;
for (const h of hotspots) { const i = cellOf(h.pos); if (i >= 0 && i < N && arr[i] === arr[i]) inBurn++; }
console.log(`\nFIRMS: ${hotspots.length} detections (${hotspots.map((h) => `${new Date(h.t).toISOString().slice(5, 16)}Z ${h.satellite}`).filter((v, k, a) => a.indexOf(v) === k).join('; ')}); ${inBurn} fall on burned cells`);
