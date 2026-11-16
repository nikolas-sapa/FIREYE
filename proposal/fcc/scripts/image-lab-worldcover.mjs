// Fetches ESA WorldCover 2020 (10 m, CC BY 4.0) for the Crete study scene from the public AWS COG with
// HTTP range reads, and resamples it nearest-neighbour onto the scene's 1,024 px EPSG:3857 grid.
// Independent reference for the model study: a different product and method than any model under test.
import { writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { dir, save } from './image-lab-study-images.mjs';

const URL_COG = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v100/2020/map/ESA_WorldCover_10m_2020_v100_N33E024_Map.tif';
const BOUNDS = [2763664.1616828335, 4175560.4552622074, 2776185.110357446, 4188081.40393682];
const SIDE = 1024, R = 6378137;

async function range(start, length) {
  const response = await fetch(URL_COG, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal: AbortSignal.timeout(60000) });
  if (response.status !== 206) throw Error(`Range read HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const head = await range(0, 1 << 16);
const le = head.toString('latin1', 0, 2) === 'II';
const u16 = (b, o) => le ? b.readUInt16LE(o) : b.readUInt16BE(o);
const u32 = (b, o) => le ? b.readUInt32LE(o) : b.readUInt32BE(o);
if (u16(head, 2) !== 42) throw Error('BigTIFF or not a TIFF');
const ifd = u32(head, 4), count = u16(head, ifd), tags = {};
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 12: 8, 16: 8 };
async function values(type, n, valueOffset, inline) {
  const size = SIZES[type] * n;
  const buf = size <= 4 ? inline : valueOffset + size <= head.length ? head.subarray(valueOffset, valueOffset + size) : await range(valueOffset, size);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (type === 3) out.push(u16(buf, i * 2));
    else if (type === 4) out.push(u32(buf, i * 4));
    else if (type === 12) out.push(le ? buf.readDoubleLE(i * 8) : buf.readDoubleBE(i * 8));
    else if (type === 1 || type === 2) out.push(buf[i]);
    else throw Error(`Unsupported tag type ${type}`);
  }
  return out;
}
for (let i = 0; i < count; i++) {
  const e = ifd + 2 + i * 12, tag = u16(head, e), type = u16(head, e + 2), n = u32(head, e + 4);
  tags[tag] = await values(type, n, u32(head, e + 8), head.subarray(e + 8, e + 12));
}
const width = tags[256][0], height = tags[257][0], tw = tags[322][0], th = tags[323][0];
const offsets = tags[324], counts = tags[325], compression = tags[259][0], predictor = tags[317]?.[0] ?? 1;
const [sx, sy] = tags[33550], [, , , lon0, lat0] = tags[33922];
if (![1, 8, 32946, 5].includes(compression) || tags[258][0] !== 8) throw Error(`Unsupported compression ${compression}`);
const tilesAcross = Math.ceil(width / tw);

function lzw(input) {
  const out = []; let dict = [], bits = 9, pos = 0, prev = null;
  const reset = () => { dict = Array.from({ length: 258 }, (_, i) => [i]); bits = 9; };
  const read = () => { let v = 0; for (let i = 0; i < bits; i++) { const bit = pos >> 3 < input.length ? input[pos >> 3] >> (7 - (pos & 7)) & 1 : 0; v = v << 1 | bit; pos++; } return v; };
  reset();
  while (true) {
    const code = read();
    if (code === 257 || pos > input.length * 8) break;
    if (code === 256) { reset(); prev = null; continue; }
    let entry = code < dict.length ? dict[code] : code === dict.length && prev ? [...prev, prev[0]] : null;
    if (!entry) throw Error('Bad LZW stream');
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length + 1 >= 1 << bits && bits < 12) bits++;
  }
  return Uint8Array.from(out);
}
const cache = new Map();
async function tile(t) {
  if (!cache.has(t)) cache.set(t, (async () => {
    const raw = await range(offsets[t], counts[t]);
    let px = compression === 1 ? new Uint8Array(raw) : compression === 5 ? lzw(raw) : new Uint8Array(inflateSync(raw));
    if (predictor === 2) for (let y = 0; y < th; y++) for (let x = 1; x < tw; x++) px[y * tw + x] = px[y * tw + x] + px[y * tw + x - 1] & 255;
    return px;
  })());
  return cache.get(t);
}
const lonOf = x => x / R * 180 / Math.PI, latOf = y => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
const classes = new Uint8Array(SIDE * SIDE);
const need = new Set(), where = [];
for (let r = 0; r < SIDE; r++) for (let c = 0; c < SIDE; c++) {
  const x = BOUNDS[0] + (c + 0.5) / SIDE * (BOUNDS[2] - BOUNDS[0]), y = BOUNDS[3] - (r + 0.5) / SIDE * (BOUNDS[3] - BOUNDS[1]);
  const px = Math.floor((lonOf(x) - lon0) / sx), py = Math.floor((lat0 - latOf(y)) / sy);
  if (px < 0 || py < 0 || px >= width || py >= height) throw Error('Scene outside the WorldCover tile');
  const t = Math.floor(py / th) * tilesAcross + Math.floor(px / tw);
  need.add(t); where.push([t, (py % th) * tw + px % tw]);
}
await Promise.all([...need].map(tile));
for (let i = 0; i < where.length; i++) classes[i] = (await tile(where[i][0]))[where[i][1]];
const COLORS = { 10: [0, 100, 0], 20: [255, 187, 34], 30: [255, 255, 76], 40: [240, 150, 255], 50: [250, 0, 0], 60: [180, 180, 180], 70: [240, 240, 240], 80: [0, 100, 200], 90: [0, 150, 160], 95: [0, 207, 117], 100: [250, 230, 160] };
const hist = {};
const img = { width: SIDE, height: SIDE, data: new Uint8Array(SIDE * SIDE * 3) };
classes.forEach((k, i) => { hist[k] = (hist[k] ?? 0) + 1; img.data.set(COLORS[k] ?? [0, 0, 0], i * 3); });
writeFileSync(join(dir, 'models/worldcover-2020.bin'), classes);
save('models/worldcover-2020.png', img);
console.log(JSON.stringify({ width, height, tile: [tw, th], compression, predictor, tilesRead: need.size, histogram: Object.fromEntries(Object.entries(hist).map(([k, v]) => [k, +(v / classes.length).toFixed(3)])) }));
