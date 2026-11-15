#!/usr/bin/env node
/**
 * Builds the Mati / NE Attica fire (23 July 2018) scenario pack under public/data/mati/.
 *
 *   node scripts/fetch-data.mjs --scenario mati          # cache in $TMPDIR/fcc-mati-cache
 *   node scripts/fetch-data.mjs --scenario mati --fresh  # ignores the cache
 *
 * FIRMS_MAP_KEY (environment or .env.local) enables real FIRMS archive hotspots; without it hotspots stay empty.
 * Node 22+, no dependencies. Sources, licences and every synthesized element: public/data/mati/README.md.
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECKPOINTS, REPORTS, FACTS, IGNITION_ALTERNATIVES } from './mati-timeline.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/data/mati');
const CACHE = path.join(tmpdir(), 'fcc-mati-cache');
const FRESH = process.argv.includes('--fresh');
const UA = 'fcc-hackathon-scenario-builder/1.0 (offline cache build)';

/* ------------------------------------------------------------------ configuration */

/** [west, south, east, north]: Penteli east slopes (Daou, Ntrafi) -> Neos Voutzas -> Mati / Kokkino Limanaki -> Rafina. */
const BBOX = [23.87, 37.98, 24.05, 38.10];
const CELL_M = 20;
const H_PER_MS = 3600e3;
const MIN = 60e3;
const TZ_OFFSET_MIN = 180;
const eest = (s) => Date.parse(s.replace(' ', 'T') + ':00+03:00');
/** 199 call at 16:41 EEST (IAWF, Kathimerini/prosecutor). Position approximate (Daou Penteli, west tip of the EFFIS polygon). */
const IGNITION_DOC = { t: eest('2018-07-23 16:41'), pos: { lon: 23.952, lat: 38.040 } };
const REPLAY_START = eest('2018-07-23 16:20');
const REPLAY_END = eest('2018-07-23 22:00');
/** Wind FROM direction for the spread model: between IAWF (Penteli NOA station, WNW) and Open-Meteo ERA5 (259-275 deg). */
const MODEL_WIND_FROM = +(process.env.MATI_WIND_FROM ?? 275);
/** Head/flank anisotropy of the wind factor (1 + k cos). The EFFIS mask dominates the shape; 1.6-2.2 changes checkpoint errors by < 2 min. */
const MODEL_ANISO = +(process.env.MATI_ANISO ?? 2.0);

const lat0 = (BBOX[1] + BBOX[3]) / 2;
const M_PER_DEG_LAT = 111132.954 - 559.822 * Math.cos(2 * lat0 * Math.PI / 180);
const M_PER_DEG_LON = 111412.84 * Math.cos(lat0 * Math.PI / 180);
const W = Math.round((BBOX[2] - BBOX[0]) * M_PER_DEG_LON / CELL_M);
const H = Math.round((BBOX[3] - BBOX[1]) * M_PER_DEG_LAT / CELL_M);
const N = W * H;
const DX = (BBOX[2] - BBOX[0]) * M_PER_DEG_LON / W;
const DY = (BBOX[3] - BBOX[1]) * M_PER_DEG_LAT / H;
const CELL_HA = (DX * DY) / 1e4;

const sources = [];
const notes = [];
const nowIso = new Date().toISOString();
const log = (...a) => console.log('[fetch-mati]', ...a);
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const fmtL = (t) => new Date(t + TZ_OFFSET_MIN * MIN).toISOString().slice(11, 16);

function envKey(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = readFileSync(path.join(ROOT, '.env.local'), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
  } catch { return ''; }
}

/* ------------------------------------------------------------------ http + cache */

async function cached(key, fn) {
  const file = path.join(CACHE, createHash('sha1').update(key).digest('hex'));
  if (!FRESH && existsSync(file)) return readFile(file);
  const buf = await fn();
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, buf);
  return buf;
}
async function get(url, opts = {}, tries = 3) {
  return cached(url + (opts.body ?? ''), async () => {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(opts.timeoutMs ?? 120e3) });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${url.replace(/[0-9a-f]{32}/, '<key>').slice(0, 140)}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (opts.validate) opts.validate(buf);
        return buf;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
      }
    }
    throw lastErr;
  });
}
const isJson = (b) => { if (b[0] !== 0x7b && b[0] !== 0x5b) throw new Error('not JSON: ' + b.toString('utf8', 0, 120)); };
const getJson = async (url, opts = {}) => JSON.parse((await get(url, { validate: isJson, ...opts })).toString('utf8'));

/* ------------------------------------------------------------------ grid helpers */

const cellLon = (x) => BBOX[0] + ((x + 0.5) / W) * (BBOX[2] - BBOX[0]);
const cellLat = (y) => BBOX[3] - ((y + 0.5) / H) * (BBOX[3] - BBOX[1]);
const lonToX = (lon) => ((lon - BBOX[0]) / (BBOX[2] - BBOX[0])) * W;
const latToY = (lat) => ((BBOX[3] - lat) / (BBOX[3] - BBOX[1])) * H;
const cellOf = (p) => {
  const x = Math.floor(lonToX(p.lon)), y = Math.floor(latToY(p.lat));
  return x < 0 || y < 0 || x >= W || y >= H ? -1 : y * W + x;
};
const cellGeo = (i) => ({ lon: r5(cellLon(i % W)), lat: r5(cellLat((i / W) | 0)) });
const distM = (a, b) => Math.hypot((a.lon - b.lon) * M_PER_DEG_LON, (a.lat - b.lat) * M_PER_DEG_LAT);

/** Even-odd scanline fill of rings (lon/lat) into out (sets val), limited to the rings' row span. */
function rasterizeRings(rings, out, val = 1) {
  const edges = [];
  let yMin = Infinity, yMax = -Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const e = [lonToX(ring[j][0]), latToY(ring[j][1]), lonToX(ring[i][0]), latToY(ring[i][1])];
      edges.push(e);
      yMin = Math.min(yMin, e[1], e[3]); yMax = Math.max(yMax, e[1], e[3]);
    }
  }
  const xs = [];
  for (let y = Math.max(0, Math.floor(yMin)); y < Math.min(H, Math.ceil(yMax) + 1); y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (const [x1, y1, x2, y2] of edges) {
      if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) xs.push(x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5));
      const b = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) out[y * W + x] = val;
    }
  }
}
const polygonsOf = (geom) => !geom ? [] : geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];

class Heap {
  constructor(cap) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) {
      const k = new Float64Array(this.k.length * 2); k.set(this.k); this.k = k;
      const v = new Int32Array(this.v.length * 2); v.set(this.v); this.v = v;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
    }
    this.k[i] = key; this.v[i] = val;
  }
  pop() {
    const top = this.v[0], topK = this.k[0];
    const k = this.k[--this.n], v = this.v[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= k) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = k; this.v[i] = v;
    this.lastKey = topK;
    return top;
  }
}

function hash01(a, b, c) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function dpSimplify(pts, tolM, keep) {
  if (pts.length <= 2) return pts.map((_, i) => i);
  const kx = M_PER_DEG_LON, ky = M_PER_DEG_LAT;
  const mark = new Uint8Array(pts.length);
  mark[0] = mark[pts.length - 1] = 1;
  keep?.forEach((k, i) => { if (k) mark[i] = 1; });
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0] * kx, ay = pts[a][1] * ky, bx = pts[b][0] * kx, by = pts[b][1] * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * kx, py = pts[i][1] * ky;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tolM) { mark[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const idx = [];
  for (let i = 0; i < pts.length; i++) if (mark[i]) idx.push(i);
  return idx;
}

/* ------------------------------------------------------------------ PNG decoder (8-bit, non-interlaced) */

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, palette = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG depth=${depth} interlace=${interlace}`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[dst + i - ch] : 0;
      const b = y > 0 ? px[dst - stride + i] : 0;
      const c = i >= ch && y > 0 ? px[dst - stride + i - ch] : 0;
      let v = raw[src + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + i] = v & 255;
    }
  }
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    if (ctype === 3) { const p = px[i] * 3; rgb[i * 3] = palette[p]; rgb[i * 3 + 1] = palette[p + 1]; rgb[i * 3 + 2] = palette[p + 2]; }
    else if (ch <= 2) { rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = px[i * ch]; }
    else { rgb[i * 3] = px[i * ch]; rgb[i * 3 + 1] = px[i * ch + 1]; rgb[i * 3 + 2] = px[i * ch + 2]; }
  }
  return { w, h, rgb };
}

/* ------------------------------------------------------------------ 1. elevation + sea mask */

async function buildElevation() {
  const Z = 13, n = 2 ** Z;
  const mx = (lon) => ((lon + 180) / 360) * n * 256;
  const my = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n * 256; };
  const tx0 = Math.floor(mx(BBOX[0]) / 256), tx1 = Math.floor(mx(BBOX[2]) / 256);
  const ty0 = Math.floor(my(BBOX[3]) / 256), ty1 = Math.floor(my(BBOX[1]) / 256);
  const TW = (tx1 - tx0 + 1) * 256, TH = (ty1 - ty0 + 1) * 256;
  const mosaic = new Float32Array(TW * TH);
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  log(`terrarium z${Z}: ${jobs.length} tiles`);
  for (let i = 0; i < jobs.length; i += 8) {
    await Promise.all(jobs.slice(i, i + 8).map(async ([tx, ty]) => {
      const png = decodePng(await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`));
      const ox = (tx - tx0) * 256, oy = (ty - ty0) * 256;
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        const p = (y * 256 + x) * 3;
        mosaic[(oy + y) * TW + ox + x] = png.rgb[p] * 256 + png.rgb[p + 1] + png.rgb[p + 2] / 256 - 32768;
      }
    }));
  }
  const elevF = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    const py = Math.min(TH - 2, Math.max(0, my(cellLat(y)) - ty0 * 256 - 0.5));
    const iy = Math.floor(py), fy = py - iy;
    for (let x = 0; x < W; x++) {
      const pxx = Math.min(TW - 2, Math.max(0, mx(cellLon(x)) - tx0 * 256 - 0.5));
      const ix = Math.floor(pxx), fx = pxx - ix;
      const a = mosaic[iy * TW + ix], b = mosaic[iy * TW + ix + 1], c = mosaic[(iy + 1) * TW + ix], d = mosaic[(iy + 1) * TW + ix + 1];
      elevF[y * W + x] = a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
    }
  }
  // Sea = cells at or below ~0.5 m connected to the east edge (excludes inland depressions).
  const sea = new Uint8Array(N);
  const stack = [];
  for (let y = 0; y < H; y++) { const i = y * W + W - 1; if (elevF[i] <= 0.5) { sea[i] = 1; stack.push(i); } }
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (!sea[i] && elevF[i] <= 0.5 && x > W * 0.6) { sea[i] = 1; stack.push(i); } }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!sea[j] && elevF[j] <= 0.5) { sea[j] = 1; stack.push(j); }
    }
  }
  const elev = new Int16Array(N);
  for (let i = 0; i < N; i++) elev[i] = Math.round(elevF[i]);
  let seaN = 0; for (let i = 0; i < N; i++) seaN += sea[i];
  sources.push({ id: 'terrarium', name: 'Mapzen/AWS Terrain Tiles (Terrarium encoding), zoom 13', url: 'https://registry.opendata.aws/terrain-tiles/', license: 'Various open sources (SRTM / EU-DEM / GMTED, bathymetry ETOPO1); attribution per https://github.com/tilezen/joerd/blob/master/docs/attribution.md', fetchedAt: nowIso, note: `Bilinear resample of ${jobs.length} tiles to ${W}x${H} grid. Sea mask = cells <= 0.5 m connected to the east edge (${(seaN * CELL_HA / 100).toFixed(1)} km2).` });
  return { elev, sea };
}

/* ------------------------------------------------------------------ 2. land cover (CORINE 2018) -> fuel */

const F = { None: 0, Water: 1, Rock: 2, Grass: 3, Shrub: 4, TimberLitter: 5, TimberUnderstory: 6, Urban: 7, Agriculture: 8 };
function clcToClass(c) {
  if (c === 111) return F.Urban;
  if (c === 112) return F.Urban; // refined to an Urban / TimberLitter mix below
  if (c >= 121 && c <= 133) return F.Urban;
  if (c === 141 || c === 142) return F.Grass;
  if (c >= 211 && c <= 244) return F.Agriculture;
  if (c === 311 || c === 313) return F.TimberUnderstory;
  if (c === 312) return F.TimberLitter;
  if (c === 321 || c === 333) return F.Grass;
  if (c === 322 || c === 323 || c === 324) return F.Shrub;
  if (c === 334) return F.Shrub;
  if (c === 331 || c === 332) return F.Rock;
  if (c >= 411 && c <= 423) return F.Grass;
  if (c >= 511) return F.Water;
  return F.None;
}

async function buildLandcover() {
  const base = 'https://image.discomap.eea.europa.eu/arcgis/rest/services/Corine/CLC2018_WM/MapServer/0/query';
  const clc = new Uint16Array(N);
  let off = 0, total = 0;
  const feats = [];
  for (;;) {
    const q = `where=1%3D1&geometry=${BBOX.join(',')}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=Code_18&returnGeometry=true&outSR=4326&maxAllowableOffset=0.00005&geometryPrecision=6&resultOffset=${off}&resultRecordCount=1000&f=geojson`;
    const j = await getJson(`${base}?${q}`, { timeoutMs: 240e3 });
    const fs = j.features ?? [];
    feats.push(...fs);
    total += fs.length;
    if (fs.length < 1000 && !j.exceededTransferLimit && !j.properties?.exceededTransferLimit) break;
    off += fs.length;
    if (!fs.length) break;
  }
  for (const f of feats) {
    const code = +f.properties.Code_18;
    for (const poly of polygonsOf(f.geometry)) rasterizeRings(poly, clc, code);
  }
  const hist = {};
  for (let i = 0; i < N; i++) hist[clc[i]] = (hist[clc[i]] ?? 0) + 1;
  log(`clc2018: ${total} polygons; codes ${Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${(v * CELL_HA).toFixed(0)}ha`).join(' ')}`);
  sources.push({ id: 'clc2018', name: 'CORINE Land Cover 2018 (Copernicus Land Monitoring Service, EEA), vector, 25 ha MMU', url: base, license: 'Copernicus open data; (c) European Union, Copernicus Land Monitoring Service 2018, European Environment Agency (EEA)', fetchedAt: nowIso, note: `${total} polygons rasterized (even-odd) to the grid; raw Code_18 kept in clc2018.bin (Uint16). Reference year 2018 (imagery 2017-2018), i.e. pre-fire.` });
  return clc;
}

function buildFuel(clc, sea, osm) {
  const fuel = new Uint8Array(N);
  for (let i = 0; i < N; i++) fuel[i] = clcToClass(clc[i]);
  const bld = new Uint16Array(N);
  for (const b of osm.buildings) { const i = cellOf(b.pos); if (i >= 0) bld[i]++; }
  let mixU = 0, mixT = 0;
  for (let i = 0; i < N; i++) {
    if (clc[i] !== 112) continue;
    const x = i % W, y = (i / W) | 0;
    let nb = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) nb += bld[ny * W + nx]; }
    if (nb) { mixU++; continue; }
    // Discontinuous urban fabric on the Penteli/Mati WUI is houses under Aleppo pine: open lots carry pine litter.
    fuel[i] = F.TimberLitter; mixT++;
  }
  for (const w of osm.water) { rasterizeRings([w.polygon.map((p) => [p.lon, p.lat])], fuel, F.Water); }
  for (let i = 0; i < N; i++) if (sea[i]) fuel[i] = F.Water;
  for (let i = 0; i < N; i++) if (fuel[i] === F.None) fuel[i] = F.Shrub;
  notes.push(`Fuel: CORINE 2018 classes mapped to FuelClass (312 conifer -> TimberLitter, 311/313 -> TimberUnderstory, 32x/334 -> Shrub, 2xx -> Agriculture, 321/333 -> Grass). CLC 112 (discontinuous urban: Mati, Neos Voutzas, Kokkino Limanaki) is a WUI mix: cells with an OSM building centroid within one cell (3x3, ~60 m block) -> Urban (${(mixU * CELL_HA).toFixed(0)} ha), the rest -> TimberLitter (pine between houses, ${(mixT * CELL_HA).toFixed(0)} ha). Sea from the elevation mask plus CORINE 523.`);
  return fuel;
}

/* ------------------------------------------------------------------ 3. OSM (Overpass) */

async function overpass(q) {
  let last;
  for (const endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']) {
    try {
      const j = await getJson(endpoint, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeoutMs: 240e3 });
      return { j, endpoint };
    } catch (e) { last = e; log('overpass failed', endpoint, e.message); }
  }
  throw last;
}

async function buildOsm() {
  const bb = `${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}`;
  const qRoads = `[out:json][timeout:180];
way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|track)$"](${bb});
out body geom;`;
  const qBld = `[out:json][timeout:180];(way["building"](${bb});node["building"](${bb}););out center tags;`;
  const qMisc = `[out:json][timeout:120];
(way["natural"="water"](${bb});relation["natural"="water"](${bb});way["landuse"="reservoir"](${bb}););
out geom tags;
(node["place"](${bb});node["amenity"~"^(fire_station|ferry_terminal|place_of_worship)$"]["name"](${bb});way["amenity"~"^(fire_station|ferry_terminal)$"](${bb});node["natural"="beach"]["name"](${bb});way["natural"="beach"]["name"](${bb}););
out center tags;`;
  const [{ j: jr, endpoint }, { j: jb }, { j: jm }] = [await overpass(qRoads), await overpass(qBld), await overpass(qMisc)];
  const roadsRaw = jr.elements.filter((e) => e.type === 'way' && e.tags?.highway && e.geometry);
  const nodeUse = new Map();
  for (const r of roadsRaw) for (const n of r.nodes) nodeUse.set(n, (nodeUse.get(n) ?? 0) + 1);
  const roads = [];
  for (const r of roadsRaw) {
    const hw = r.tags.highway;
    const kind = /^(motorway|trunk|primary)/.test(hw) ? 'highway' : hw === 'track' ? 'track' : 'road';
    const pts = r.geometry.map((g) => [g.lon, g.lat]);
    const keep = r.nodes.map((n) => (nodeUse.get(n) ?? 0) > 1);
    const idx = dpSimplify(pts, kind === 'track' ? 12 : 6, keep);
    const name = r.tags.name ?? r.tags.ref ?? '';
    roads.push({ id: `w${r.id}`, name, ...(r.tags['name:en'] ? { nameEn: r.tags['name:en'] } : {}), kind, ...(r.tags.ref ? { ref: r.tags.ref } : {}), coords: idx.map((i) => ({ lon: r5(pts[i][0]), lat: r5(pts[i][1]) })) });
  }
  const buildings = jb.elements
    .filter((e) => e.tags?.building && (e.type === 'node' || e.center))
    .map((e) => {
      const p = e.type === 'node' ? e : e.center;
      const k = e.tags.building;
      return { id: `${e.type[0]}${e.id}`, pos: { lon: r5(p.lon), lat: r5(p.lat) }, ...(k && k !== 'yes' ? { kind: k } : {}) };
    });
  const water = [];
  for (const e of jm.elements) {
    if (!(e.tags?.natural === 'water' || e.tags?.landuse === 'reservoir')) continue;
    const rings = [];
    if (e.type === 'way' && e.geometry) rings.push(e.geometry.map((g) => [g.lon, g.lat]));
    if (e.type === 'relation') for (const m of e.members ?? []) if (m.role === 'outer' && m.geometry) rings.push(m.geometry.map((g) => [g.lon, g.lat]));
    rings.forEach((ring, k) => {
      const idx = dpSimplify(ring, 6);
      if (idx.length >= 4) water.push({ id: `${e.type[0]}${e.id}${k ? '-' + k : ''}`, ...(e.tags.name ? { name: e.tags.name } : {}), polygon: idx.map((i) => ({ lon: r5(ring[i][0]), lat: r5(ring[i][1]) })) });
    });
  }
  const pois = jm.elements.filter((e) => e.tags?.name && !(e.tags.natural === 'water')).map((e) => {
    const p = e.type === 'node' ? e : e.center;
    return { name: e.tags.name, nameEn: e.tags['name:en'] ?? '', tags: e.tags, pos: { lon: r5(p.lon), lat: r5(p.lat) }, osm: `${e.type}/${e.id}` };
  });
  sources.push({ id: 'osm', name: 'OpenStreetMap via Overpass API (roads, buildings, water, places)', url: endpoint, license: 'ODbL 1.0 - (c) OpenStreetMap contributors', fetchedAt: nowIso, note: `Current OSM snapshot (${jr.osm3s?.timestamp_osm_base ?? 'n/a'}), not a July 2018 snapshot: many houses in Mati were destroyed in 2018 and rebuilt or demolished since. Roads simplified (Douglas-Peucker 6 m, tracks 12 m, junctions kept); buildings reduced to centroids. Road names are Greek as in OSM (nameEn when tagged).` });
  log(`osm: ${roads.length} roads, ${buildings.length} buildings, ${water.length} water, ${pois.length} pois`);
  return { roads, buildings, water, pois };
}

/* ------------------------------------------------------------------ 4. EFFIS final burnt area */

async function buildEffis() {
  const url = 'https://maps.effis.emergency.copernicus.eu/effis?service=WFS&version=1.1.0&request=GetFeature&typeName=ms:modis.ba.poly&bbox=37.98,23.85,38.10,24.08,EPSG:4326&outputFormat=geojson';
  const j = await getJson(url, { timeoutMs: 180e3 });
  const f = j.features.find((x) => String(x.properties.id) === '15060');
  if (!f) throw new Error('EFFIS feature 15060 not found');
  const polys = polygonsOf(f.geometry);
  const mask = new Uint8Array(N);
  for (const poly of polys) rasterizeRings(poly, mask, 1);
  let cells = 0; for (let i = 0; i < N; i++) cells += mask[i];
  const p = f.properties;
  sources.push({ id: 'effis', name: 'EFFIS (European Forest Fire Information System) burnt area, MODIS/Sentinel-2 mapped, feature 15060', url, license: 'Copernicus EMS / JRC EFFIS open data; (c) European Union, EFFIS', fetchedAt: nowIso, note: `FIREDATE ${p.FIREDATE}, AREA_HA ${p.AREA_HA}, ${polys.reduce((s, q) => s + q[0].length, 0)} vertices; rasterized ${(cells * CELL_HA).toFixed(0)} ha. Land cover inside (EFFIS): artificial ${(+p.ARTIFSURF).toFixed(1)}%, conifer ${(+p.CONIFER).toFixed(1)}%, other natural ${(+p.OTHERNATLC).toFixed(1)}%, agriculture ${(+p.AGRIAREAS).toFixed(1)}%, transitional ${(+p.TRANSIT).toFixed(1)}%, sclerophyllous ${(+p.SCLEROPH).toFixed(1)}%.` });
  log(`effis 15060: ${p.AREA_HA} ha documented, ${(cells * CELL_HA).toFixed(0)} ha rasterized; props ${Object.keys(p).join(',')}`);
  return { mask, cells, props: p, polygon: polys.map((poly) => poly[0].map(([lon, lat]) => ({ lon: r5(lon), lat: r5(lat) }))) };
}

/* ------------------------------------------------------------------ 5. weather (Open-Meteo archive, ERA5) */

async function buildWeather() {
  const c = { lat: 38.04, lon: 23.96 };
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${c.lat}&longitude=${c.lon}&start_date=2018-07-23&end_date=2018-07-24&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh&timezone=GMT`;
  const j = await getJson(url);
  const h = j.hourly;
  const weather = h.time.map((ts, i) => ({ t: Date.parse(ts + ':00Z'), windKph: h.wind_speed_10m[i], windDirDeg: h.wind_direction_10m[i], gustKph: h.wind_gusts_10m[i], tempC: h.temperature_2m[i], rh: h.relative_humidity_2m[i] })).filter((w) => w.windKph != null);
  sources.push({ id: 'open-meteo', name: 'Open-Meteo Historical Weather API (ERA5 / ERA5-Land reanalysis), hourly', url, license: 'CC BY 4.0 (Open-Meteo.com); contains modified Copernicus Climate Change Service information', fetchedAt: nowIso, note: `Grid point ${j.latitude},${j.longitude} (model elev ${j.elevation} m). Reanalysis is smoother than observed: Penteli NOA station recorded WNW 32-56 km/h with gusts 50-89 km/h, Rafina gusts occasionally to ~120 km/h (IAWF, FIRElinks, BAMS); see facts.json.` });
  return { point: c, weather };
}

/* ------------------------------------------------------------------ 6. FIRMS hotspots */

async function buildHotspots() {
  const key = envKey('FIRMS_MAP_KEY') || envKey('VITE_FIRMS_MAP_KEY');
  if (!key) { notes.push('Hotspots: FIRMS_MAP_KEY not set at build time, hotspots.json is empty (none fabricated).'); return { mode: 'none', hotspots: [] }; }
  const out = [];
  const errs = [];
  for (const src of ['VIIRS_SNPP_SP', 'MODIS_SP']) {
    try {
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${BBOX.join(',')}/2/2018-07-23`;
      const txt = (await get(url, { validate: (b) => { if (!/^latitude/.test(b.toString('utf8', 0, 20))) throw new Error('FIRMS: ' + b.toString('utf8', 0, 100)); } })).toString('utf8').trim();
      const csv = txt.split('\n');
      const hdr = csv[0].split(',');
      const ix = (n) => hdr.indexOf(n);
      for (const line of csv.slice(1)) {
        const c = line.split(',');
        if (c.length < hdr.length) continue;
        const hhmm = c[ix('acq_time')].padStart(4, '0');
        const [Y, Mo, D] = c[ix('acq_date')].split('-').map(Number);
        const t = Date.UTC(Y, Mo - 1, D, +hhmm.slice(0, 2), +hhmm.slice(2));
        const conf = c[ix('confidence')];
        const confidence = /^(h|high)$/i.test(conf) || +conf >= 80 ? 'h' : /^(l|low)$/i.test(conf) || +conf < 30 ? 'l' : 'n';
        out.push({ t, pos: { lon: r5(+c[ix('longitude')]), lat: r5(+c[ix('latitude')]) }, frp: +c[ix('frp')], confidence, satellite: src.startsWith('MODIS') ? `MODIS ${c[ix('satellite')] === 'T' ? 'Terra' : c[ix('satellite')] === 'A' ? 'Aqua' : c[ix('satellite')]}` : 'VIIRS S-NPP', ...(c[ix('daynight')] ? { daynight: c[ix('daynight')] } : {}) });
      }
      log(`firms ${src}: ${csv.length - 1} rows`);
    } catch (e) { errs.push(`${src}: ${e.message}`); log('FIRMS failed', src, e.message.replace(key, '<key>')); }
  }
  if (!out.length && errs.length) { notes.push(`Hotspots: FIRMS request failed (${errs.join('; ').replace(key, '<key>')}); hotspots.json is empty.`); return { mode: 'none', hotspots: [] }; }
  sources.push({ id: 'firms', name: 'NASA FIRMS archive (VIIRS S-NPP 375 m, MODIS Terra/Aqua 1 km) standard processing, 2018-07-23/24', url: 'https://firms.modaps.eosdis.nasa.gov/api/area/', license: 'NASA open data; acknowledge LANCE/FIRMS', fetchedAt: nowIso, note: 'Real detections at their acquisition times (UTC). Polar-orbit overpasses miss most of the 2-hour run; detections confirm extent rather than timing. All detections in the bbox are kept.' });
  return { mode: 'firms', hotspots: out.sort((a, b) => a.t - b.t) };
}

/* ------------------------------------------------------------------ 7. arrival raster */

function perimeterM(order, k) {
  // Boundary edge count x cell size x pi/4 (isotropic correction for 4-connected edge counting).
  const burn = new Uint8Array(N);
  for (let q = 0; q < k; q++) burn[order[q]] = 1;
  let eh = 0, ev = 0;
  for (let q = 0; q < k; q++) {
    const i = order[q], x = i % W, y = (i / W) | 0;
    if (x === 0 || !burn[i - 1]) ev++;
    if (x === W - 1 || !burn[i + 1]) ev++;
    if (y === 0 || !burn[i - W]) eh++;
    if (y === H - 1 || !burn[i + W]) eh++;
  }
  return (eh * DX + ev * DY) * Math.PI / 4;
}

function buildArrival({ elev, sea, fuel, effis, osm, places }) {
  const allowed = new Uint8Array(N);
  for (let i = 0; i < N; i++) allowed[i] = effis.mask[i] && !sea[i] ? 1 : 0;
  // Snap the documented ignition to the nearest allowed cell.
  let ig = cellOf(IGNITION_DOC.pos), best = Infinity;
  if (!allowed[ig]) {
    const x0 = ig % W, y0 = (ig / W) | 0;
    for (let dy = -60; dy <= 60; dy++) for (let dx = -60; dx <= 60; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || !allowed[y * W + x]) continue;
      const d = Math.hypot(dx * DX, dy * DY);
      if (d < best) { best = d; ig = y * W + x; }
    }
    log(`ignition snapped ${best.toFixed(0)} m into the EFFIS polygon`);
  } else best = 0;
  const ignition = { t: IGNITION_DOC.t, pos: cellGeo(ig), snappedM: Math.round(best) };

  const rate = { [F.None]: 0.6, [F.Water]: 0.05, [F.Rock]: 0.4, [F.Grass]: 1.4, [F.Shrub]: 1.3, [F.TimberLitter]: 1.15, [F.TimberUnderstory]: 1.0, [F.Urban]: 0.85, [F.Agriculture]: 0.9 };
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const stepLen = NB.map(([dx, dy]) => Math.hypot(dx * DX, dy * DY));
  const stepBearing = NB.map(([dx, dy]) => (Math.atan2(dx * DX, -dy * DY) * 180) / Math.PI);
  const downwind = (MODEL_WIND_FROM + 180) % 360;
  const windF = stepBearing.map((b) => Math.max(0.15, 1 + MODEL_ANISO * Math.cos(((b - downwind) * Math.PI) / 180)));
  const T = new Float64Array(N).fill(Infinity);
  const heap = new Heap(1 << 16);
  T[ig] = 0; heap.push(0, ig);
  while (heap.n) {
    const i = heap.pop();
    const ti = heap.lastKey;
    if (ti > T[i]) continue;
    const x = i % W, y = (i / W) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + NB[k][0], ny = y + NB[k][1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!allowed[j]) continue;
      const slope = (elev[j] - elev[i]) / stepLen[k];
      const sf = Math.min(2.5, Math.max(0.6, 1 + 1.5 * slope));
      const noise = 0.8 + 0.4 * hash01(nx >> 2, ny >> 2, 3);
      const r = rate[fuel[j]] * sf * windF[k] * noise;
      const tj = ti + stepLen[k] / r;
      if (tj < T[j]) { T[j] = tj; heap.push(tj, j); }
    }
  }
  const order = [];
  for (let i = 0; i < N; i++) if (Number.isFinite(T[i])) order.push(i);
  order.sort((a, b) => T[a] - T[b]);
  let unreached = 0; for (let i = 0; i < N; i++) if (allowed[i] && !Number.isFinite(T[i])) unreached++;

  /* calibration anchors (model travel time -> documented clock time) */
  const anchors = [{ id: 'ignition', T: 0, t: IGNITION_DOC.t }];
  const perimAnchor = (id, meters, t) => {
    let lo = 1, hi = order.length;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (perimeterM(order, m) < meters) lo = m; else hi = m; }
    anchors.push({ id, T: T[order[hi - 1]], t, note: `perimeter ${meters} m at ${(hi * CELL_HA).toFixed(1)} ha` });
  };
  perimAnchor('first-house', 400, eest('2018-07-23 16:46'));
  perimAnchor('two-fingers', 3500, eest('2018-07-23 17:21'));
  perimAnchor('nv-west-edge', 6000, eest('2018-07-23 17:41'));
  const minTNear = (pos, rM) => {
    const c = cellOf(pos); let m = Infinity;
    const rx = Math.ceil(rM / DX), ry = Math.ceil(rM / DY), x0 = c % W, y0 = (c / W) | 0;
    for (let dy = -ry; dy <= ry; dy++) for (let dx = -rx; dx <= rx; dx++) {
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || Math.hypot(dx * DX, dy * DY) > rM) continue;
      m = Math.min(m, T[y * W + x]);
    }
    return m;
  };
  const nv = places.find((p) => p.id === 'neos-voutzas');
  anchors.push({ id: 'neos-voutzas', T: minTNear(nv.pos, 60), t: eest('2018-07-23 18:02'), note: 'fire burns Neos Voutzas (place point)' });
  // Marathonos Ave: first crossing = minimum travel time over its cells.
  let marT = Infinity, marCell = -1;
  for (const r of osm.roads) {
    if (!/Μαραθ[ωώ]νος/.test(r.name) || r.kind === 'track') continue;
    for (let k = 0; k + 1 < r.coords.length; k++) {
      const a = r.coords[k], b = r.coords[k + 1];
      const steps = Math.max(1, Math.ceil(distM(a, b) / (CELL_M / 2)));
      for (let s = 0; s <= steps; s++) {
        const i = cellOf({ lon: a.lon + (b.lon - a.lon) * s / steps, lat: a.lat + (b.lat - a.lat) * s / steps });
        if (i >= 0 && T[i] < marT) { marT = T[i]; marCell = i; }
      }
    }
  }
  if (marCell >= 0) anchors.push({ id: 'marathonos', T: marT, t: eest('2018-07-23 18:19'), note: `first Marathonos Ave crossing at ${JSON.stringify(cellGeo(marCell))}` });
  // Coast: first burnable cell within ~80 m of the sea.
  let coastT = Infinity, coastCell = -1;
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(T[i]) || T[i] >= coastT) continue;
    const x = i % W, y = (i / W) | 0;
    let near = false;
    for (let dy = -4; dy <= 4 && !near; dy++) for (let dx = -4; dx <= 4; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && sea[ny * W + nx]) { near = true; break; } }
    if (near) { coastT = T[i]; coastCell = i; }
  }
  if (coastCell >= 0) anchors.push({ id: 'coast', T: coastT, t: eest('2018-07-23 18:45'), note: `first coastal cell at ${JSON.stringify(cellGeo(coastCell))}` });
  anchors.sort((a, b) => a.T - b.T);
  const used = [anchors[0]];
  for (const a of anchors.slice(1)) {
    if (a.t > used.at(-1).t && a.T > used.at(-1).T) used.push(a);
    else { log(`anchor ${a.id} dropped (non-monotonic: T=${a.T.toFixed(0)} t=${fmtL(a.t)})`); a.dropped = true; }
  }
  // Past the coast the head has nowhere to go; flanks keep burning more slowly (factor 1.8 on the last segment rate).
  const lastSlope = used.length > 1 ? (used.at(-1).t - used.at(-2).t) / (used.at(-1).T - used.at(-2).T) : MIN;
  const tOf = (Tv) => {
    if (Tv <= used[0].T) return used[0].t;
    for (let k = 1; k < used.length; k++) if (Tv <= used[k].T) { const a = used[k - 1], b = used[k]; return a.t + (Tv - a.T) / (b.T - a.T) * (b.t - a.t); }
    return used.at(-1).t + (Tv - used.at(-1).T) * lastSlope * 1.8;
  };
  const absT = new Float64Array(N).fill(NaN);
  const arrival = new Float32Array(N).fill(NaN);
  for (const i of order) { absT[i] = tOf(T[i]); arrival[i] = absT[i] - REPLAY_START; }
  const lastT = absT[order.at(-1)];
  log(`arrival: ${order.length} cells (${(order.length * CELL_HA).toFixed(0)} ha), ${unreached} allowed cells unreached; last cell ${fmtL(lastT)} EEST`);
  for (const a of anchors) log(`  anchor ${a.id.padEnd(14)} T=${a.T.toFixed(0).padStart(6)}  ${fmtL(a.t)} EEST ${a.dropped ? '(dropped)' : ''} ${a.note ?? ''}`);
  notes.push(`Arrival raster (synthesized): Dijkstra travel time from the ignition over the 8-neighbour grid, restricted to the real EFFIS burnt-area polygon (cells outside never burn), with fuel rate (CORINE-derived), slope factor and a fixed WNW wind (${MODEL_WIND_FROM} deg) anisotropy. Model time is mapped to clock time piecewise-linearly through documented anchors: ${used.map((a) => `${a.id} ${fmtL(a.t)}`).join(', ')} EEST; perimeter anchors use the IAWF perimeter lengths. After the coast anchor flank cells burn at 1/1.8 of the last segment rate (last cell ${fmtL(lastT)} EEST). Ember spotting, which the sources describe, is not modelled.`);
  return { arrival, absT, ignition, anchors, lastT, order, T, marCell, coastCell };
}

/* ------------------------------------------------------------------ 8. synthesized perimeters (marching squares) */

function contourRings(burn) {
  const val = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : burn[y * W + x]);
  const S = W + 2;
  const hid = (x, y) => ((y + 1) * S + (x + 1)) * 2;
  const vid = (x, y) => ((y + 1) * S + (x + 1)) * 2 + 1;
  const ptOf = (id) => { const e = id & 1, c = id >> 1, x = (c % S) - 1, y = Math.floor(c / S) - 1; return e === 0 ? [x + 1, y + 0.5] : [x + 0.5, y + 1]; };
  const adj = new Map();
  const link = (a, b) => { (adj.get(a) ?? adj.set(a, []).get(a)).push(b); (adj.get(b) ?? adj.set(b, []).get(b)).push(a); };
  for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
    const tl = val(x, y), tr = val(x + 1, y), bl = val(x, y + 1), br = val(x + 1, y + 1);
    const c = tl | (tr << 1) | (br << 2) | (bl << 3);
    if (c === 0 || c === 15) continue;
    const top = hid(x, y), bottom = hid(x, y + 1), left = vid(x, y), right = vid(x + 1, y);
    if (c === 5) { link(left, top); link(right, bottom); continue; }
    if (c === 10) { link(top, right); link(bottom, left); continue; }
    const pts = [];
    if (tl !== tr) pts.push(top);
    if (tr !== br) pts.push(right);
    if (bl !== br) pts.push(bottom);
    if (tl !== bl) pts.push(left);
    link(pts[0], pts[1]);
  }
  const seen = new Set();
  const rings = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const ring = [];
    let prev = -1, cur = start;
    while (!seen.has(cur)) {
      seen.add(cur);
      const [px, py] = ptOf(cur);
      ring.push([BBOX[0] + (px / W) * (BBOX[2] - BBOX[0]), BBOX[3] - (py / H) * (BBOX[3] - BBOX[1])]);
      const nb = adj.get(cur);
      const nxt = nb[0] !== prev ? nb[0] : nb[1];
      prev = cur; cur = nxt;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  const areaHa = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] * M_PER_DEG_LON) * (r[i][1] * M_PER_DEG_LAT) - (r[i][0] * M_PER_DEG_LON) * (r[j][1] * M_PER_DEG_LAT); return Math.abs(s / 2) / 1e4; };
  const inside = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
  const big = rings.map((r) => ({ r, a: areaHa(r) })).filter((o) => o.a >= 0.3).sort((a, b) => b.a - a.a);
  const outers = [];
  big.forEach((o, k) => {
    let depth = 0;
    for (let q = 0; q < k; q++) if (inside(o.r[0], big[q].r)) depth++;
    if (depth % 2 === 0) outers.push(o.r);
  });
  return outers.map((r) => { const idx = dpSimplify(r, 12); return idx.map((i) => ({ lon: r5(r[i][0]), lat: r5(r[i][1]) })); });
}

function buildPerimeters(absT, effis) {
  const times = ['16:46', '17:00', '17:21', '17:41', '18:02', '18:19', '18:45', '19:15', '20:00'].map((s) => eest('2018-07-23 ' + s));
  const out = [];
  for (const t of times) {
    const burn = new Uint8Array(N);
    let cells = 0;
    for (let i = 0; i < N; i++) if (absT[i] <= t) { burn[i] = 1; cells++; }
    if (!cells) continue;
    out.push({ t, acres: Math.round(cells * CELL_HA * 2.47105), ha: Math.round(cells * CELL_HA * 10) / 10, synthesized: true, source: 'arrival-model', polygon: contourRings(burn) });
  }
  const final = { t: REPLAY_END, acres: Math.round(+effis.props.AREA_HA * 2.47105), ha: +effis.props.AREA_HA, synthesized: false, source: 'effis', polygon: effis.polygon };
  out.push(final);
  return { perimeters: out, final };
}

/* ------------------------------------------------------------------ 9. imagery */

async function buildImagery() {
  const out = { gibs: [] };
  const iw = 4096, ih = Math.round(iw * ((H * DY) / (W * DX)));
  try {
    const url = `https://tiles.maps.eox.at/wms?service=WMS&version=1.1.1&request=GetMap&layers=s2cloudless-2018&styles=&srs=EPSG:4326&bbox=${BBOX.join(',')}&width=${iw}&height=${ih}&format=image/jpeg`;
    const buf = await get(url, { timeoutMs: 240e3, validate: (b) => { if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG'); } });
    await writeFile(path.join(OUT, 'imagery.jpg'), buf);
    out.main = { url: '/data/mati/imagery.jpg', bbox: BBOX, date: '2018 (cloudless composite; mostly pre-fire summer 2018 scenes, may include some post-fire pixels)', source: 'Sentinel-2 cloudless 2018 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2018)', width: iw, height: ih };
    sources.push({ id: 's2cloudless', name: 'Sentinel-2 cloudless 2018 (EOX), WMS GetMap', url: 'https://s2maps.eu', license: 'CC BY-NC-SA 4.0 - Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2018). Non-commercial use; replace for commercial deployments.', fetchedAt: nowIso, note: `${iw}x${ih} JPEG, EPSG:4326, ~4 m/px` });
  } catch (e) { log('EOX imagery failed:', e.message); }
  const gibs = async (layer, date, fmt, file, w) => {
    const h = Math.round(w * ((H * DY) / (W * DX)));
    const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}&STYLES=&CRS=EPSG:4326&BBOX=${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}&WIDTH=${w}&HEIGHT=${h}&FORMAT=${fmt}&TRANSPARENT=TRUE&TIME=${date}`;
    const buf = await get(url, { validate: (b) => { if (b[0] === 0x3c) throw new Error('GIBS error: ' + b.toString('utf8', 0, 160)); } });
    await writeFile(path.join(OUT, file), buf);
    return { url: `/data/mati/${file}`, bbox: BBOX, date, source: `NASA GIBS ${layer}`, width: w, height: h };
  };
  for (const [layer, date, fmt, file, w] of [
    ['MODIS_Terra_CorrectedReflectance_TrueColor', '2018-07-23', 'image/jpeg', 'gibs-modis-terra-truecolor-2018-07-23.jpg', 512],
    ['MODIS_Terra_CorrectedReflectance_TrueColor', '2018-07-24', 'image/jpeg', 'gibs-modis-terra-truecolor-2018-07-24.jpg', 512],
    ['VIIRS_SNPP_CorrectedReflectance_TrueColor', '2018-07-24', 'image/jpeg', 'gibs-viirs-truecolor-2018-07-24.jpg', 512],
    ['VIIRS_SNPP_Thermal_Anomalies_375m_All', '2018-07-23', 'image/png', 'gibs-viirs-thermal-2018-07-23.png', 1024],
    ['VIIRS_SNPP_Thermal_Anomalies_375m_All', '2018-07-24', 'image/png', 'gibs-viirs-thermal-2018-07-24.png', 1024],
  ]) {
    try { out.gibs.push(await gibs(layer, date, fmt, file, w)); } catch (e) { log('GIBS failed', layer, date, e.message); }
  }
  if (out.gibs.length) sources.push({ id: 'gibs', name: 'NASA GIBS WMS: MODIS Terra / VIIRS S-NPP Corrected Reflectance True Color, VIIRS Thermal Anomalies 375 m', url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi', license: 'NASA open data (no restrictions); acknowledge NASA EOSDIS GIBS', fetchedAt: nowIso, note: 'Daily snapshots: 23 Jul (Terra morning pass, pre-ignition) and 24 Jul (post-fire scar / plume). Coarse (250-375 m), context only.' });
  if (!out.main && out.gibs[0]) out.main = out.gibs[0];
  return out;
}

/* ------------------------------------------------------------------ places */

function buildPlaces(ignition) {
  const P = (id, name, kind, lat, lon, extra = {}) => ({ id, name, kind, pos: { lon, lat }, ...extra });
  const osmNote = { osm: 'OSM place/amenity node (Overpass lookup, name match)' };
  return [
    P('ignition', 'Fire origin, Daou Penteli', 'landmark', ignition.pos.lat, ignition.pos.lon, { note: `Approximate origin inside the 2009 burn scar (IAWF/prosecutor: Daou Penteli); snapped ${ignition.snappedM} m into the EFFIS polygon` }),
    P('ntaou-penteli', 'Ntaou Penteli', 'hamlet', 38.03904, 23.94493, osmNote),
    P('neos-voutzas', 'Neos Voutzas', 'town', 38.04226, 23.98115, osmNote),
    P('mati', 'Mati', 'town', 38.04932, 23.99247, osmNote),
    P('kokkino-limanaki', 'Kokkino Limanaki beach', 'landmark', 38.0334, 24.00043, osmNote),
    P('argyra-akti', 'Argyra Akti (Silver Coast)', 'landmark', 38.040, 23.997, { note: 'Approximate: not in OSM; coast between Kokkino Limanaki and Mati' }),
    P('rafina', 'Rafina', 'town', 38.02037, 24.00734, osmNote),
    P('rafina-port', 'Rafina ferry terminal', 'landmark', 38.0225, 24.0100, { note: 'Approximate (OSM port area)' }),
    P('rafina-beach', 'Rafina beach', 'landmark', 38.01938, 24.01188, osmNote),
    P('lidaki', 'Lidaki cove', 'landmark', 38.02631, 24.00906, osmNote),
    P('rafina-camp', 'Rafina Camp', 'landmark', 38.00753, 23.99551, osmNote),
    P('nea-makri', 'Nea Makri', 'town', 38.08305, 23.97907, osmNote),
    P('zouberi', 'Zouberi', 'hamlet', 38.06935, 23.99289, osmNote),
    P('agia-marina', 'Agia Marina', 'hamlet', 38.06236, 23.97212, osmNote),
    P('agios-andreas-camp', 'Agios Andreas camp', 'landmark', 38.05806, 23.99835, osmNote),
    P('neos-voutzas-fs', 'Neos Voutzas volunteer fire station', 'station', 38.05565, 23.98354, osmNote),
    P('kallitechnoupoli', 'Kallitechnoupoli', 'town', 38.02527, 23.95955, osmNote),
    P('ntrafi', 'Ntrafi', 'hamlet', 38.03266, 23.9019, osmNote),
    P('dioni', 'Dioni', 'hamlet', 38.02268, 23.93221, osmNote),
    P('palaios-mylos', 'Palaios Mylos', 'hamlet', 38.01635, 23.93441, osmNote),
    P('pikermi', 'Pikermi', 'town', 38.00163, 23.94103, osmNote),
    P('pallini', 'Pallini', 'town', 38.00397, 23.88108, osmNote),
    P('anthousa', 'Anthousa', 'town', 38.02868, 23.87571, osmNote),
    P('agia-varvara-rafina', 'Agia Varvara church, Marathonos Ave', 'landmark', 38.02735, 23.98238, { osm: 'way/698980490' }),
    P('penteli-summit', 'Mt Penteli summit', 'landmark', 38.050, 23.880, { note: 'Approximate' }),
    P('daou-ridge-trailhead', 'Daou Ridge trailhead', 'trailhead', 38.0445, 23.9555, { fictional: true, note: 'Fictional trailhead for the simulated rescue storyline' }),
    P('pefka-riding-stables', 'Pefka riding stables', 'ranch', 38.0365, 23.9690, { fictional: true, note: 'Fictional stables (horses) for the simulated storyline' }),
  ];
}

function enrichPlaces(places, pois) {
  // Prefer exact OSM positions when a POI with a matching English/Greek name exists.
  const greek = { 'neos-voutzas': /Ν[έε]ος Β[οό]υτζ[αά]ς/, mati: /^Μάτι$/, rafina: /^Ραφήνα$/, 'nea-makri': /^Νέα Μάκρη$/, pikermi: /^Πικέρμι$/ };
  for (const p of places) {
    const re = greek[p.id];
    if (!re) continue;
    const hit = pois.find((q) => re.test(q.name) && q.tags.place);
    if (hit && distM(hit.pos, p.pos) < 1500) { p.pos = hit.pos; p.osm = hit.osm; }
  }
  const kl = places.find((p) => p.id === 'kokkino-limanaki').pos;
  const find = (re) => pois.filter((q) => q.tags.amenity === 'place_of_worship' && re.test(q.name) && distM(q.pos, kl) < 2500).sort((a, b) => distM(a.pos, kl) - distM(b.pos, kl))[0];
  return { analipsi: find(/Ανάληψ/), agiaVarvara: find(/Βαρβάρ/) };
}

/* ------------------------------------------------------------------ main */

async function main() {
  await mkdir(OUT, { recursive: true });
  log(`grid ${W}x${H} = ${N} cells, ${DX.toFixed(1)} x ${DY.toFixed(1)} m`);
  const [{ elev, sea }, clc, osm, effis, wx] = await Promise.all([buildElevation(), buildLandcover(), buildOsm(), buildEffis(), buildWeather()]);
  // CORINE 523 (sea and ocean) completes the elevation-derived sea mask along the coast.
  let seaAdd = 0;
  for (let i = 0; i < N; i++) if (clc[i] === 523 && !sea[i] && elev[i] <= 3) { sea[i] = 1; seaAdd++; }
  log(`sea mask: +${seaAdd} cells from CLC 523`);
  const fuel = buildFuel(clc, sea, osm);
  const buf = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength);
  const raster = { w: W, h: H, bbox: BBOX, cellM: Math.round(((DX + DY) / 2) * 100) / 100, dxM: Math.round(DX * 100) / 100, dyM: Math.round(DY * 100) / 100, cellHa: Math.round(CELL_HA * 1e5) / 1e5, cellAcres: Math.round(CELL_HA * 2.47105 * 1e4) / 1e4, rowOrder: 'north-to-south', endianness: 'little', files: { elevation: 'elevation.bin (Int16 m)', fuel: 'fuel.bin (Uint8 FuelClass)', clc2018: 'clc2018.bin (Uint16 CORINE 2018 Code_18, 0 = none)', arrival: 'arrival.bin (Float32 ms since manifest.start, NaN = never)' } };
  await Promise.all([
    writeFile(path.join(OUT, 'raster.json'), JSON.stringify(raster, null, 1)),
    writeFile(path.join(OUT, 'elevation.bin'), buf(elev)),
    writeFile(path.join(OUT, 'fuel.bin'), buf(fuel)),
    writeFile(path.join(OUT, 'clc2018.bin'), buf(clc)),
    writeFile(path.join(OUT, 'weather.json'), JSON.stringify(wx)),
    writeFile(path.join(OUT, 'osm.json'), JSON.stringify({ roads: osm.roads, buildings: osm.buildings, water: osm.water })),
  ]);
  const places0 = buildPlaces({ pos: IGNITION_DOC.pos, snappedM: 0 });
  const pw = enrichPlaces(places0, osm.pois);
  const arr = buildArrival({ elev, sea, fuel, effis, osm, places: places0 });
  const places = buildPlaces(arr.ignition);
  enrichPlaces(places, osm.pois);
  if (pw.analipsi) places.push({ id: 'analipsi-church', name: 'Analipsi church (Rafina junction)', kind: 'landmark', pos: pw.analipsi.pos, osm: pw.analipsi.osm });
  if (pw.agiaVarvara && !places.some((p) => p.id === 'agia-varvara-rafina')) places.push({ id: 'agia-varvara-rafina', name: 'Agia Varvara church, Rafina', kind: 'landmark', pos: pw.agiaVarvara.pos, osm: pw.agiaVarvara.osm });
  if (arr.marCell >= 0) places.push({ id: 'marathonos-crossing', name: 'Marathonos Ave (first crossing, model)', kind: 'landmark', pos: cellGeo(arr.marCell), note: 'Where the arrival model first crosses Marathonos Ave; the documented crossing time is ~18:18-18:20 at several points' });
  {
    // Burned coastline cell nearest the Mati place node (Poseidonos Ave runs along this shore).
    const mati = places.find((p) => p.id === 'mati').pos;
    let bestD = Infinity, bestI = -1;
    for (let i = 0; i < N; i++) {
      if (sea[i] || !(arr.arrival[i] === arr.arrival[i])) continue;
      const x = i % W, y = (i / W) | 0;
      const d = distM(cellGeo(i), mati);
      if (d >= bestD) continue;
      let near = false;
      for (let dy = -4; dy <= 4 && !near; dy++) for (let dx = -4; dx <= 4; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && sea[ny * W + nx]) { near = true; break; } }
      if (!near) continue;
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI >= 0) places.push({ id: 'mati-coast', name: 'Mati shore (Poseidonos Ave)', kind: 'landmark', pos: cellGeo(bestI), note: `Burned (EFFIS) coastline cell nearest the Mati place node, ${Math.round(bestD)} m away; approximate` });
  }
  const { perimeters, final } = buildPerimeters(arr.absT, effis);
  const { mode, hotspots } = await buildHotspots();
  const placeById = Object.fromEntries(places.map((p) => [p.id, p]));
  const checkpoints = CHECKPOINTS.map((c) => {
    const { placeId, ...rest } = c;
    const pos = c.pos ?? placeById[placeId]?.pos;
    return { ...rest, ...(pos ? { pos } : {}), ...(placeId ? { placeId } : {}) };
  });
  await Promise.all([
    writeFile(path.join(OUT, 'arrival.bin'), buf(arr.arrival)),
    writeFile(path.join(OUT, 'perimeters.json'), JSON.stringify({ fireId: 'effis-15060', perimeters, final })),
    writeFile(path.join(OUT, 'hotspots.json'), JSON.stringify({ mode, hotspots })),
    writeFile(path.join(OUT, 'checkpoints.json'), JSON.stringify({ checkpoints }, null, 1)),
    writeFile(path.join(OUT, 'reports.json'), JSON.stringify({ reports: [...REPORTS].sort((a, b) => a.t - b.t) }, null, 1)),
    writeFile(path.join(OUT, 'facts.json'), JSON.stringify({ facts: FACTS }, null, 1)),
  ]);
  const imagery = await buildImagery();
  const manifest = {
    id: 'mati-2018',
    name: 'Mati fire, Attica',
    disclaimer: 'Scenario built from public data; units, people and events are simulated.',
    bbox: BBOX,
    center: { lon: 23.978, lat: 38.040 },
    start: REPLAY_START,
    end: REPLAY_END,
    tz: 'EEST',
    tzOffsetMin: TZ_OFFSET_MIN,
    dataStart: IGNITION_DOC.t,
    dataEnd: Math.ceil(arr.lastT / MIN) * MIN,
    ignition: { t: arr.ignition.t, pos: arr.ignition.pos, alternatives: IGNITION_ALTERNATIVES },
    replayNote: 'Replay window 23 Jul 2018 16:20 -> 22:00 EEST (13:20 -> 19:00 UTC). The fire started ~16:41 EEST in Daou Penteli and reached the coast at Mati around 18:45. Arrival times are a calibrated model inside the real EFFIS burnt area, not observations.',
    recommendedT0: eest('2018-07-23 16:38'),
    activeEdgeMin: 15,
    places,
    sources,
    imagery: imagery.main ? { url: imagery.main.url, bbox: imagery.main.bbox, date: imagery.main.date, source: imagery.main.source } : undefined,
    imageryExtra: imagery.gibs,
    hotspotMode: mode,
    calibration: arr.anchors.map((a) => ({ id: a.id, t: a.t, modelT: Math.round(a.T), used: !a.dropped, ...(a.note ? { note: a.note } : {}) })),
    effis: { id: '15060', areaHa: +effis.props.AREA_HA, fireDate: effis.props.FIREDATE, rasterHa: Math.round(effis.cells * CELL_HA) },
    notes,
    generatedAt: nowIso,
  };
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  let total = 0;
  for (const f of ['manifest.json', 'raster.json', 'elevation.bin', 'fuel.bin', 'clc2018.bin', 'arrival.bin', 'perimeters.json', 'hotspots.json', 'weather.json', 'osm.json', 'checkpoints.json', 'reports.json', 'facts.json', 'imagery.jpg']) {
    try { const s = await stat(path.join(OUT, f)); total += s.size; log(`${f}: ${(s.size / 1024).toFixed(0)} KB`); } catch { /* optional */ }
  }
  log(`done: ${(total / 1048576).toFixed(1)} MB, hotspots=${hotspots.length} (${mode}), places=${places.length}`);
}

await main();
