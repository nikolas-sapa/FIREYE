#!/usr/bin/env node
/**
 * Builds the Caldor Fire (2021) scenario pack under public/data/caldor/.
 *
 *   node scripts/fetch-data.mjs            # uses the download cache in $TMPDIR/fcc-caldor-cache
 *   node scripts/fetch-data.mjs --fresh    # ignores the cache
 *   FIRMS_MAP_KEY=... node scripts/fetch-data.mjs   # real FIRMS VIIRS archive hotspots
 *
 * Node 22+, no dependencies (global fetch, node:zlib for PNG decoding).
 * Every source, licence and synthesized element is documented in public/data/caldor/README.md.
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/data/caldor');
const CACHE = path.join(tmpdir(), 'fcc-caldor-cache');
const FRESH = process.argv.includes('--fresh');
const UA = 'fcc-hackathon-scenario-builder/1.0 (offline cache build)';

/* ------------------------------------------------------------------ configuration */

/** [west, south, east, north]: ignition (Middle Fork Cosumnes) -> Grizzly Flats -> Pollock Pines / US-50. */
const BBOX = [-120.70, 38.52, -120.24, 38.82];
const CELL_M = 40;
const H_PER_MS = 3600e3;
const PDT_OFFSET_H = -7;
/** IRWIN discovery time 2021-08-15T01:54:24Z = 2021-08-14 18:54 PDT; IRWIN initial lat/lon. */
const IGNITION = { t: 1628992464000, pos: { lon: -120.537833, lat: 38.586 } };
/** Replay window used by the demo: Aug 16 12:00 PDT -> Aug 17 12:00 PDT (Grizzly Flats burns overnight). */
const REPLAY_START = Date.UTC(2021, 7, 16, 19, 0, 0);
const REPLAY_END = Date.UTC(2021, 7, 17, 19, 0, 0);
const DATA_END = Date.UTC(2021, 7, 19, 12, 0, 0);

const lat0 = (BBOX[1] + BBOX[3]) / 2;
const M_PER_DEG_LAT = 111132.954 - 559.822 * Math.cos(2 * lat0 * Math.PI / 180);
const M_PER_DEG_LON = 111412.84 * Math.cos(lat0 * Math.PI / 180);
const W = Math.round((BBOX[2] - BBOX[0]) * M_PER_DEG_LON / CELL_M);
const H = Math.round((BBOX[3] - BBOX[1]) * M_PER_DEG_LAT / CELL_M);
const N = W * H;
const DX = (BBOX[2] - BBOX[0]) * M_PER_DEG_LON / W;
const DY = (BBOX[3] - BBOX[1]) * M_PER_DEG_LAT / H;

const sources = [];
const notes = [];
const nowIso = new Date().toISOString();
const log = (...a) => console.log('[fetch-data]', ...a);
const r5 = (v) => Math.round(v * 1e5) / 1e5;

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
        if (!res.ok) throw new Error(`HTTP ${res.status} ${url.slice(0, 120)}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw lastErr;
  });
}
const getJson = async (url, opts) => JSON.parse((await get(url, opts)).toString('utf8'));

/* ------------------------------------------------------------------ grid helpers */

const cellLon = (x) => BBOX[0] + ((x + 0.5) / W) * (BBOX[2] - BBOX[0]);
const cellLat = (y) => BBOX[3] - ((y + 0.5) / H) * (BBOX[3] - BBOX[1]);
const lonToX = (lon) => ((lon - BBOX[0]) / (BBOX[2] - BBOX[0])) * W;
const latToY = (lat) => ((BBOX[3] - lat) / (BBOX[3] - BBOX[1])) * H;
const CELL_ACRES = (DX * DY) / 4046.8564224;

/** Even-odd scanline fill of rings (lon/lat) into mask (sets 1). */
function rasterizeRings(rings, mask) {
  const edges = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      edges.push([lonToX(ring[j][0]), latToY(ring[j][1]), lonToX(ring[i][0]), latToY(ring[i][1])]);
    }
  }
  const xs = [];
  for (let y = 0; y < H; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (const [x1, y1, x2, y2] of edges) {
      if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) xs.push(x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5));
      const b = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = a; x <= b; x++) mask[y * W + x] = 1;
    }
  }
}

/** Binary min-heap keyed by Float64 priority over Int32 cell ids. */
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

/* ------------------------------------------------------------------ PNG decoder (8-bit gray/RGB/RGBA/palette, non-interlaced) */

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

/* ------------------------------------------------------------------ 1. elevation (AWS Terrarium) */

async function buildElevation() {
  const Z = 12, n = 2 ** Z;
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
  const elev = new Int16Array(N);
  for (let y = 0; y < H; y++) {
    const py = my(cellLat(y)) - ty0 * 256 - 0.5;
    const iy = Math.floor(py), fy = py - iy;
    for (let x = 0; x < W; x++) {
      const pxx = mx(cellLon(x)) - tx0 * 256 - 0.5;
      const ix = Math.floor(pxx), fx = pxx - ix;
      const a = mosaic[iy * TW + ix], b = mosaic[iy * TW + ix + 1], c = mosaic[(iy + 1) * TW + ix], d = mosaic[(iy + 1) * TW + ix + 1];
      elev[y * W + x] = Math.round(a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy);
    }
  }
  sources.push({ id: 'terrarium', name: 'Mapzen/AWS Terrain Tiles (Terrarium encoding), zoom 12', url: 'https://registry.opendata.aws/terrain-tiles/', license: 'Various open sources (USGS 3DEP/NED public domain in the US); attribution per https://github.com/tilezen/joerd/blob/master/docs/attribution.md', fetchedAt: nowIso, note: `Bilinear resample of ${jobs.length} tiles to ${W}x${H} grid` });
  return elev;
}

/* ------------------------------------------------------------------ 2. fuel (LANDFIRE LF2016 FBFM40, pre-fire) */

/** FuelClass enum mirror (src/console/contracts.ts). */
const F = { None: 0, Water: 1, Rock: 2, Grass: 3, Shrub: 4, TimberLitter: 5, TimberUnderstory: 6, Urban: 7, Agriculture: 8 };
function fbfm40ToClass(c) {
  if (c === 91) return F.Urban;
  if (c === 93) return F.Agriculture;
  if (c === 98) return F.Water;
  if (c === 92 || c === 99) return F.Rock;
  if (c >= 101 && c <= 109) return F.Grass;
  if (c >= 121 && c <= 149) return F.Shrub;
  if (c >= 161 && c <= 165) return F.TimberUnderstory;
  if (c >= 181 && c <= 204) return F.TimberLitter;
  return F.None;
}

async function buildFuel(elev, osm) {
  const fuel = new Uint8Array(N);
  const fb = new Uint8Array(N);
  const base = 'https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2016/LF2016_FBFM40_CONUS/ImageServer/exportImage';
  try {
    const q = `bbox=${BBOX.join(',')}&bboxSR=4326&imageSR=4326&size=${W},${H}&format=bsq&pixelType=S16&interpolation=RSP_NearestNeighbor&noData=0`;
    const meta = await getJson(`${base}?${q}&f=json`, { timeoutMs: 180e3 });
    const buf = await get(meta.href, { timeoutMs: 180e3 });
    const iw = meta.width, ih = meta.height, ext = meta.extent;
    if (buf.length < iw * ih * 2) throw new Error(`LANDFIRE payload ${buf.length} < ${iw * ih * 2}`);
    const v = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + iw * ih * 2));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const sx = Math.min(iw - 1, Math.max(0, Math.floor(((cellLon(x) - ext.xmin) / (ext.xmax - ext.xmin)) * iw)));
      const sy = Math.min(ih - 1, Math.max(0, Math.floor(((ext.ymax - cellLat(y)) / (ext.ymax - ext.ymin)) * ih)));
      const code = v[sy * iw + sx];
      fb[y * W + x] = code > 0 && code < 256 ? code : 0;
      fuel[y * W + x] = fbfm40ToClass(code);
    }
    sources.push({ id: 'landfire', name: 'LANDFIRE LF2016 Remap FBFM40 (40 Scott & Burgan fire behavior fuel models)', url: 'https://lfps.usgs.gov/arcgis/rest/services/Landfire_LF2016/LF2016_FBFM40_CONUS/ImageServer', license: 'Public domain (USGS / USDA Forest Service / DOI LANDFIRE)', fetchedAt: nowIso, note: `exportImage ${iw}x${ih}, nearest neighbour; pre-fire vintage chosen deliberately (LF2022+ already contain the Caldor burn scar). FBFM40 codes mapped to FuelClass; raw codes kept in fbfm40.bin` });
    return { fuel, fb, real: true };
  } catch (e) {
    log('LANDFIRE failed, using heuristic fuel:', e.message);
    notes.push('LANDFIRE unavailable at build time: fuel derived heuristically from elevation/aspect + OSM.');
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, z = elev[i];
      const dzdy = (elev[i + W] - elev[i - W]) / (2 * DY);
      const south = dzdy > 0.05;
      fuel[i] = z < 500 ? F.Grass : z < 1000 ? (south ? F.Shrub : F.TimberUnderstory) : z < 2100 ? (south ? F.TimberUnderstory : F.TimberLitter) : F.Rock;
    }
    for (const b of osm.buildings) { const x = Math.floor(lonToX(b.pos.lon)), y = Math.floor(latToY(b.pos.lat)); if (x >= 0 && y >= 0 && x < W && y < H) fuel[y * W + x] = F.Urban; }
    for (const wpoly of osm.water) { const m = new Uint8Array(N); rasterizeRings([wpoly.polygon.map((p) => [p.lon, p.lat])], m); for (let i = 0; i < N; i++) if (m[i]) fuel[i] = F.Water; }
    sources.push({ id: 'fuel-heuristic', name: 'Heuristic fuel classes (synthesized)', url: 'n/a', license: 'n/a', fetchedAt: nowIso, note: 'elevation/aspect bands + OSM buildings (urban) + OSM water' });
    return { fuel, fb, real: false };
  }
}

/* ------------------------------------------------------------------ 3. perimeters + hotspots (NASA FEDS / VEDA) */

const FEDS = 'https://openveda.cloud/api/features/collections';
/**
 * FEDS time stamps are 12-hourly slots named after the local overpass: T00 = night pass (~01:30 local),
 * T12 = day pass (~13:30 local). We convert to the actual overpass instants in PDT.
 */
function fedsSlotToMs(t) {
  const [d, hh] = t.split('T');
  const [Y, Mo, D] = d.split('-').map(Number);
  const localH = hh.startsWith('12') ? 13.5 : 1.5;
  return Date.UTC(Y, Mo - 1, D, 0, 0, 0) + (localH - PDT_OFFSET_H) * H_PER_MS;
}

async function fetchFeds(collection) {
  const url = `${FEDS}/${collection}/items?bbox=${BBOX.join(',')}&datetime=2021-08-14T00:00:00Z/2021-08-19T12:00:00Z&limit=500`;
  const j = await getJson(url);
  return { url, features: (j.features ?? []).filter((f) => f.properties?.fireid === pickFireId(j.features)) };
}
function pickFireId(features) {
  const counts = {};
  for (const f of features ?? []) counts[f.properties.fireid] = (counts[f.properties.fireid] ?? 0) + (f.properties.farea ?? 1);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

function outerRings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0]);
  return [];
}

async function buildPerimeters() {
  const { url, features } = await fetchFeds('public.eis_fire_lf_perimeter_archive');
  const fireId = features[0]?.properties?.fireid;
  const per = features
    .map((f) => ({ t: fedsSlotToMs(f.properties.t), slot: f.properties.t, acres: Math.round(f.properties.farea * 247.105), meanFrp: f.properties.meanfrp, rings: outerRings(f.geometry) }))
    .sort((a, b) => a.t - b.t);
  sources.push({ id: 'feds-perimeters', name: `NASA FEDS (Fire Event Data Suite) 12-hourly VIIRS fire perimeters, event ${fireId}`, url, license: 'NASA open data (no restrictions); cite Chen et al. 2022, Sci. Data 9:249', fetchedAt: nowIso, note: 'Perimeter slot T00 -> 01:30 PDT night overpass, T12 -> 13:30 PDT day overpass (FEDS convention). Acres = FEDS farea (km2) x 247.105; VIIRS-derived areas run higher than official IR-mapped acreage.' });
  log(`perimeters: ${per.length} (${per.map((p) => `${p.slot}=${p.acres}ac`).join(', ')})`);
  return { per, fireId };
}

async function buildHotspots(per, arrival) {
  const key = process.env.FIRMS_MAP_KEY;
  if (key) {
    try {
      const out = [];
      for (const src of ['VIIRS_SNPP_SP', 'VIIRS_NOAA20_SP', 'MODIS_SP']) {
        const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${BBOX.join(',')}/5/2021-08-14`;
        const csv = (await get(url)).toString('utf8').trim().split('\n');
        const hdr = csv[0].split(',');
        const ix = (n) => hdr.indexOf(n);
        for (const line of csv.slice(1)) {
          const c = line.split(',');
          const hhmm = c[ix('acq_time')].padStart(4, '0');
          const [Y, Mo, D] = c[ix('acq_date')].split('-').map(Number);
          const t = Date.UTC(Y, Mo - 1, D, +hhmm.slice(0, 2), +hhmm.slice(2));
          const conf = c[ix('confidence')];
          const confidence = /^(h|high)$/i.test(conf) || +conf >= 80 ? 'h' : /^(l|low)$/i.test(conf) || +conf < 30 ? 'l' : 'n';
          out.push({ t, pos: { lon: r5(+c[ix('longitude')]), lat: r5(+c[ix('latitude')]) }, frp: +c[ix('frp')], confidence, satellite: src.startsWith('MODIS') ? `MODIS ${c[ix('satellite')]}` : `VIIRS ${src.includes('SNPP') ? 'S-NPP' : 'NOAA-20'}` });
        }
      }
      sources.push({ id: 'firms', name: 'NASA FIRMS archive (VIIRS S-NPP / NOAA-20 375 m, MODIS 1 km) standard processing', url: 'https://firms.modaps.eosdis.nasa.gov/api/area/', license: 'NASA open data; acknowledge LANCE/FIRMS', fetchedAt: nowIso });
      return { hotspots: out.sort((a, b) => a.t - b.t), mode: 'firms' };
    } catch (e) {
      log('FIRMS failed, falling back:', e.message);
    }
  }
  try {
    const { url, features } = await fetchFeds('public.eis_fire_lf_newfirepix_archive');
    const frpBySlot = Object.fromEntries(per.map((p) => [p.slot, p.meanFrp]));
    const out = [];
    for (const f of features) {
      const t = fedsSlotToMs(f.properties.t);
      const pts = f.geometry.type === 'MultiPoint' ? f.geometry.coordinates : [f.geometry.coordinates];
      const mean = frpBySlot[f.properties.t] ?? 30;
      pts.forEach((p, i) => {
        const u = hash01(p[0] * 1e4, p[1] * 1e4, i);
        const frp = Math.round(mean * (0.25 + 1.75 * u * u) * 10) / 10;
        out.push({ t: t + Math.round((u - 0.5) * 6 * 60e3), pos: { lon: r5(p[0]), lat: r5(p[1]) }, frp, confidence: frp > 60 ? 'h' : frp < 8 ? 'l' : 'n', satellite: 'VIIRS 375 m (FEDS new fire pixels; FRP synthesized)' });
      });
    }
    sources.push({ id: 'feds-firepix', name: 'NASA FEDS new active-fire pixels (VIIRS 375 m) per 12-hour slot', url, license: 'NASA open data (no restrictions)', fetchedAt: nowIso, note: 'Pixel positions and slot times are real; per-pixel FRP and confidence are synthesized from the slot mean FRP (FIRMS archive needs FIRMS_MAP_KEY). Times jittered +/-3 min around the overpass.' });
    notes.push('Hotspot positions are real VIIRS pixels from NASA FEDS; FRP/confidence per pixel synthesized. Set FIRMS_MAP_KEY to use the FIRMS archive instead.');
    return { hotspots: out.sort((a, b) => a.t - b.t), mode: 'feds' };
  } catch (e) {
    log('FEDS fire pixels failed, synthesizing along the arrival front:', e.message);
  }
  const out = [];
  for (let day = Date.UTC(2021, 7, 14); day < DATA_END; day += 24 * H_PER_MS) {
    for (const lh of [1.5, 13.5]) {
      const t = day + (lh - PDT_OFFSET_H) * H_PER_MS;
      const rel = t - REPLAY_START;
      for (let i = 0; i < N; i += 7) {
        const a = arrival[i];
        if (!(a <= rel && a > rel - 3 * H_PER_MS)) continue;
        const x = i % W, y = (i / W) | 0, u = hash01(x, y, t);
        if (u > 0.08) continue;
        out.push({ t, pos: { lon: r5(cellLon(x)), lat: r5(cellLat(y)) }, frp: Math.round((5 + 120 * u * 12) * 10) / 10, confidence: u < 0.03 ? 'h' : 'n', satellite: 'VIIRS (synthesized)' });
      }
    }
  }
  notes.push('Hotspots synthesized along the arrival-time front at VIIRS overpass times (~01:30/13:30 PDT).');
  sources.push({ id: 'hotspots-synth', name: 'VIIRS-like hotspots (synthesized)', url: 'n/a', license: 'n/a', fetchedAt: nowIso });
  return { hotspots: out, mode: 'synth' };
}

function hash01(a, b, c) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ 4. weather (Open-Meteo archive) */

async function buildWeather() {
  const c = { lat: (BBOX[1] + BBOX[3]) / 2, lon: (BBOX[0] + BBOX[2]) / 2 };
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${c.lat}&longitude=${c.lon}&start_date=2021-08-14&end_date=2021-08-19&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh&timezone=GMT`;
  const j = await getJson(url);
  const h = j.hourly;
  const out = h.time.map((ts, i) => ({ t: Date.parse(ts + ':00Z'), windKph: h.wind_speed_10m[i], windDirDeg: h.wind_direction_10m[i], gustKph: h.wind_gusts_10m[i], tempC: h.temperature_2m[i], rh: h.relative_humidity_2m[i] }))
    .filter((w) => w.windKph != null);
  sources.push({ id: 'open-meteo', name: 'Open-Meteo Historical Weather API (ERA5 / ERA5-Land reanalysis), hourly', url, license: 'CC BY 4.0 (Open-Meteo.com); contains modified Copernicus Climate Change Service information', fetchedAt: nowIso, note: `Grid point ${j.latitude},${j.longitude} (model elev ${j.elevation} m). Reanalysis winds are smoother than observed ridge-top gusts.` });
  return out;
}

/* ------------------------------------------------------------------ 5. OSM (Overpass) */

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
  // Protected (junction) vertices split the run so each sub-run is simplified independently.
  const idx = [];
  for (let i = 0; i < pts.length; i++) if (mark[i]) idx.push(i);
  return idx;
}

async function buildOsm() {
  const bb = `${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}`;
  const q = `[out:json][timeout:180];
(way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|track)$"](${bb}););
out body geom;
(way["building"](${bb});node["building"](${bb}););
out center tags;
(way["natural"="water"](${bb});relation["natural"="water"](${bb});way["landuse"="reservoir"](${bb}););
out geom tags;
(node["place"~"^(town|village|hamlet|locality|isolated_dwelling)$"](${bb});node["amenity"~"^(fire_station|school)$"](${bb});way["amenity"~"^(fire_station|school)$"](${bb});node["highway"="trailhead"](${bb});node["tourism"="camp_site"](${bb});way["tourism"="camp_site"](${bb}););
out center tags;`;
  let j, endpoint;
  for (endpoint of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      j = await getJson(endpoint, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeoutMs: 240e3 });
      break;
    } catch (e) { log('overpass failed', endpoint, e.message); }
  }
  if (!j) throw new Error('Overpass unavailable');
  const els = j.elements;
  const roadsRaw = els.filter((e) => e.type === 'way' && e.tags?.highway && e.geometry);
  const nodeUse = new Map();
  for (const r of roadsRaw) for (const n of r.nodes) nodeUse.set(n, (nodeUse.get(n) ?? 0) + 1);
  const roads = [];
  for (const r of roadsRaw) {
    const hw = r.tags.highway;
    const kind = /^(motorway|trunk|primary)/.test(hw) ? 'highway' : hw === 'track' ? 'track' : 'road';
    const pts = r.geometry.map((g) => [g.lon, g.lat]);
    const keep = r.nodes.map((n) => (nodeUse.get(n) ?? 0) > 1);
    const idx = dpSimplify(pts, kind === 'track' ? 15 : 8, keep);
    roads.push({ id: `w${r.id}`, name: r.tags.name ?? r.tags.ref ?? '', kind, ...(r.tags.ref ? { ref: r.tags.ref } : {}), coords: idx.map((i) => ({ lon: r5(pts[i][0]), lat: r5(pts[i][1]) })) });
  }
  const buildings = els
    .filter((e) => e.tags?.building && (e.type === 'node' || e.center))
    .map((e) => {
      const p = e.type === 'node' ? e : e.center;
      const k = e.tags.building;
      return { id: `${e.type[0]}${e.id}`, pos: { lon: r5(p.lon), lat: r5(p.lat) }, ...(k && k !== 'yes' ? { kind: k } : {}) };
    });
  const water = [];
  for (const e of els) {
    const isWater = e.tags?.natural === 'water' || e.tags?.landuse === 'reservoir';
    if (!isWater) continue;
    const rings = [];
    if (e.type === 'way' && e.geometry) rings.push(e.geometry.map((g) => [g.lon, g.lat]));
    if (e.type === 'relation') {
      const segs = (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((g) => [g.lon, g.lat]));
      while (segs.length) {
        let ring = segs.shift();
        let grown = true;
        while (grown && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) {
          grown = false;
          for (let i = 0; i < segs.length; i++) {
            const s = segs[i], end = ring.at(-1);
            if (s[0][0] === end[0] && s[0][1] === end[1]) { ring = ring.concat(s.slice(1)); }
            else if (s.at(-1)[0] === end[0] && s.at(-1)[1] === end[1]) { ring = ring.concat(s.slice(0, -1).reverse()); }
            else continue;
            segs.splice(i, 1); grown = true; break;
          }
        }
        rings.push(ring);
      }
    }
    rings.forEach((ring, k) => {
      const idx = dpSimplify(ring, 10);
      if (idx.length >= 4) water.push({ id: `${e.type[0]}${e.id}${k ? '-' + k : ''}`, ...(e.tags.name ? { name: e.tags.name } : {}), polygon: idx.map((i) => ({ lon: r5(ring[i][0]), lat: r5(ring[i][1]) })) });
    });
  }
  const pois = els.filter((e) => e.tags?.name && (e.tags.place || e.tags.amenity || e.tags.highway === 'trailhead' || e.tags.tourism) && !e.tags.building).map((e) => {
    const p = e.type === 'node' ? e : e.center;
    const t = e.tags;
    const kind = t.place === 'town' || t.place === 'village' ? 'town' : t.place ? 'hamlet' : t.amenity === 'school' ? 'school' : t.amenity === 'fire_station' ? 'station' : t.highway === 'trailhead' ? 'trailhead' : 'landmark';
    return { name: t.name, kind, pos: { lon: r5(p.lon), lat: r5(p.lat) }, osm: `${e.type}/${e.id}` };
  });
  sources.push({ id: 'osm', name: 'OpenStreetMap via Overpass API (roads, buildings, water, places)', url: endpoint, license: 'ODbL 1.0 - (c) OpenStreetMap contributors', fetchedAt: nowIso, note: `Current OSM snapshot (${j.osm3s?.timestamp_osm_base ?? 'n/a'}), not a 2021 snapshot: some buildings lost in 2021 may be missing or rebuilt. Roads simplified (Douglas-Peucker 8 m, tracks 15 m, junction vertices preserved); buildings reduced to centroids.` });
  log(`osm: ${roads.length} roads, ${buildings.length} buildings, ${water.length} water, ${pois.length} pois`);
  return { roads, buildings, water, pois };
}

/* ------------------------------------------------------------------ 6. arrival-time raster */

function buildArrival(per, elev, fuel, weather) {
  const arrival = new Float32Array(N).fill(NaN);
  const absT = new Float64Array(N).fill(Infinity);
  const prev = new Uint8Array(N);
  const rate = { [F.None]: 0.1, [F.Water]: 0.03, [F.Rock]: 0.15, [F.Grass]: 1.6, [F.Shrub]: 1.3, [F.TimberLitter]: 0.8, [F.TimberUnderstory]: 1.0, [F.Urban]: 0.7, [F.Agriculture]: 0.9 };
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const stepLen = NB.map(([dx, dy]) => Math.hypot(dx * DX, dy * DY));
  const stepBearing = NB.map(([dx, dy]) => (Math.atan2(dx * DX, -dy * DY) * 180) / Math.PI);
  const wxAt = (t) => { let best = weather[0]; for (const w of weather) if (Math.abs(w.t - t) < Math.abs(best.t - t)) best = w; return best; };

  /** Dijkstra travel time over the whole grid from seed cells; `reverse` evaluates costs as fire moving toward the expanding node. */
  function travel(seeds, wx, reverse) {
    const T = new Float64Array(N).fill(Infinity);
    const heap = new Heap(1 << 16);
    for (const s of seeds) { T[s] = 0; heap.push(0, s); }
    const downwind = (wx.windDirDeg + 180) % 360;
    const wn = Math.min(1.2, wx.windKph / 25);
    const windF = stepBearing.map((b) => {
      const cos = Math.cos(((b - downwind) * Math.PI) / 180);
      return Math.max(0.35, 1 + 0.9 * wn * cos);
    });
    const windR = stepBearing.map((b) => {
      const cos = Math.cos(((b + 180 - downwind) * Math.PI) / 180);
      return Math.max(0.35, 1 + 0.9 * wn * cos);
    });
    while (heap.n) {
      const i = heap.pop();
      const ti = heap.lastKey;
      if (ti > T[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + NB[k][0], ny = y + NB[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        const from = reverse ? j : i, to = reverse ? i : j;
        const slope = (elev[to] - elev[from]) / stepLen[k];
        const sf = Math.min(3, Math.max(0.55, 1 + 2.2 * slope));
        const r = rate[fuel[to]] * sf * (reverse ? windR[k] : windF[k]);
        const tj = ti + stepLen[k] / r;
        if (tj < T[j]) { T[j] = tj; heap.push(tj, j); }
      }
    }
    return T;
  }

  /**
   * Diurnal activity: low before dawn, peak ~18:00 local (Caldor made its major runs late afternoon into the
   * night), scaled by gusts. Integrated to warp time inside each interval.
   */
  const activity = (t) => {
    const h = (((t / H_PER_MS + PDT_OFFSET_H) % 24) + 24) % 24;
    const d = Math.min(Math.abs(h - 18), 24 - Math.abs(h - 18));
    const w = wxAt(t);
    return (0.15 + Math.exp(-(d * d) / (2 * 4.2 * 4.2))) * (0.6 + Math.min(1.4, w.gustKph / 30));
  };
  const warp = (t0, t1) => {
    const n = 240, cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + activity(t0 + ((i + 0.5) / n) * (t1 - t0));
    return (f) => {
      const target = f * cum[n];
      let lo = 0, hi = n;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= target) lo = m; else hi = m; }
      const seg = cum[lo + 1] - cum[lo] || 1;
      return t0 + ((lo + (target - cum[lo]) / seg) / n) * (t1 - t0);
    };
  };

  let tPrev = IGNITION.t;
  const ig = Math.floor(latToY(IGNITION.pos.lat)) * W + Math.floor(lonToX(IGNITION.pos.lon));
  absT[ig] = tPrev;
  prev[ig] = 1;
  for (const p of per) {
    const cur = new Uint8Array(N);
    rasterizeRings(p.rings, cur);
    for (let i = 0; i < N; i++) if (prev[i]) cur[i] = 1;
    const seeds = [], outer = [];
    let fresh = 0;
    for (let i = 0; i < N; i++) {
      if (!cur[i] || prev[i]) continue;
      fresh++;
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) { continue; }
        const j = ny * W + nx;
        if (prev[j]) seeds.push(j);
        else if (!cur[j]) outer.push(j);
      }
    }
    if (!seeds.length) seeds.push(ig);
    const wx = wxAt((tPrev + p.t) / 2);
    const Tf = travel([...new Set(seeds)], wx, false);
    const Tb = travel([...new Set(outer)], wx, true);
    const tw = warp(tPrev, p.t);
    for (let i = 0; i < N; i++) {
      if (!cur[i] || prev[i]) continue;
      const a = Tf[i], b = Tb[i];
      let f = Number.isFinite(a) && Number.isFinite(b) ? a / (a + b) : 0.5;
      const x = i % W, y = (i / W) | 0;
      f = Math.min(1, Math.max(0, f + 0.05 * (hash01(x >> 2, y >> 2, 7) - 0.5) + 0.02 * (hash01(x, y, 11) - 0.5)));
      absT[i] = tw(f);
    }
    log(`interval -> ${new Date(p.t).toISOString()} (${p.acres} ac): +${fresh} cells, wind ${wx.windKph.toFixed(0)} kph @ ${wx.windDirDeg}`);
    prev.set(cur);
    tPrev = p.t;
  }
  for (let i = 0; i < N; i++) if (Number.isFinite(absT[i])) arrival[i] = absT[i] - REPLAY_START;
  notes.push('Arrival-time raster: cells inside FEDS perimeter k but not k-1 get a time between the two overpasses from the ratio of fuel/slope/wind-weighted travel time from the previous perimeter vs to the new edge, with a diurnal (peak ~18:00 PDT, gust-scaled) time warp and light deterministic noise. Before the first perimeter the fire grows from the IRWIN ignition point at discovery time.');
  return arrival;
}

/* ------------------------------------------------------------------ 7. imagery */

async function buildImagery() {
  const out = {};
  const iw = 4096, ih = Math.round(iw * ((H * DY) / (W * DX)));
  try {
    const url = `https://tiles.maps.eox.at/wms?service=WMS&version=1.1.1&request=GetMap&layers=s2cloudless-2020&styles=&srs=EPSG:4326&bbox=${BBOX.join(',')}&width=${iw}&height=${ih}&format=image/jpeg`;
    const buf = await get(url, { timeoutMs: 240e3 });
    if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
    await writeFile(path.join(OUT, 'imagery.jpg'), buf);
    out.main = { url: '/data/caldor/imagery.jpg', bbox: BBOX, date: '2020 (pre-fire cloudless composite)', source: 'Sentinel-2 cloudless 2020 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)', width: iw, height: ih };
    sources.push({ id: 's2cloudless', name: 'Sentinel-2 cloudless 2020 (EOX), WMS GetMap', url: 'https://s2maps.eu', license: 'CC BY-NC-SA 4.0 - Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2020). Non-commercial use; replace for commercial deployments.', fetchedAt: nowIso, note: `${iw}x${ih} JPEG, EPSG:4326, ~10 m/px, pre-fire` });
  } catch (e) { log('EOX imagery failed:', e.message); }
  const gibs = async (layer, date, fmt, file, w) => {
    const h = Math.round(w * ((H * DY) / (W * DX)));
    const url = `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${layer}&STYLES=&CRS=EPSG:4326&BBOX=${BBOX[1]},${BBOX[0]},${BBOX[3]},${BBOX[2]}&WIDTH=${w}&HEIGHT=${h}&FORMAT=${fmt}&TRANSPARENT=TRUE&TIME=${date}`;
    const buf = await get(url);
    await writeFile(path.join(OUT, file), buf);
    return { url: `/data/caldor/${file}`, bbox: BBOX, date, source: `NASA GIBS ${layer}`, width: w, height: h };
  };
  out.gibs = [];
  for (const date of ['2021-08-16', '2021-08-17', '2021-08-18']) {
    try { out.gibs.push(await gibs('VIIRS_SNPP_CorrectedReflectance_TrueColor', date, 'image/jpeg', `gibs-viirs-truecolor-${date}.jpg`, 512)); } catch (e) { log('GIBS true color failed', date, e.message); }
    try { out.gibs.push(await gibs('VIIRS_SNPP_Thermal_Anomalies_375m_All', date, 'image/png', `gibs-viirs-thermal-${date}.png`, 1024)); } catch (e) { log('GIBS thermal failed', date, e.message); }
  }
  if (out.gibs.length) sources.push({ id: 'gibs', name: 'NASA GIBS WMS: VIIRS S-NPP Corrected Reflectance True Color and Thermal Anomalies 375 m', url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi', license: 'NASA open data (no restrictions); acknowledge NASA EOSDIS GIBS', fetchedAt: nowIso, note: 'Daily dated snapshots for Aug 16-18 2021 (smoke plume, thermal anomalies)' });
  if (!out.main && out.gibs[0]) out.main = out.gibs[0];
  return out;
}

/* ------------------------------------------------------------------ 8. final perimeter (reference) */

async function buildFinalPerimeter() {
  const base = 'https://services2.arcgis.com/iq8zYa0SRsvIFFKz/arcgis/rest/services/Caldor_Fire_Progression_Polygons/FeatureServer/0/query';
  const url = `${base}?where=1%3D1&outFields=GISAcres,DateCurren&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.0003&f=geojson`;
  try {
    const j = await getJson(url);
    const f = j.features[0];
    const rings = outerRings(f.geometry).map((r) => r.map(([lon, lat]) => ({ lon: r5(lon), lat: r5(lat) })));
    sources.push({ id: 'calfire-final', name: 'CAL FIRE / NIFC Caldor final perimeter (Wildfire Daily Fire Perimeter, 2021-09-16)', url: base, license: 'Public (CAL FIRE / NIFC open data)', fetchedAt: nowIso, note: `${Math.round(f.properties.GISAcres)} acres; reference only (outside replay window)` });
    return { t: f.properties.DateCurren, acres: Math.round(f.properties.GISAcres), polygon: rings };
  } catch (e) { log('final perimeter failed', e.message); return null; }
}

/* ------------------------------------------------------------------ places */

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function buildPlaces(pois) {
  const want = [
    { id: 'grizzly-flats', name: 'Grizzly Flats', kind: 'town', pos: { lon: -120.5302, lat: 38.6341 } },
    { id: 'omo-ranch', name: 'Omo Ranch', kind: 'hamlet', pos: { lon: -120.5730, lat: 38.5811 } },
    { id: 'pollock-pines', name: 'Pollock Pines', kind: 'town', pos: { lon: -120.5866, lat: 38.7616 } },
    { id: 'somerset', name: 'Somerset', kind: 'hamlet', pos: { lon: -120.6830, lat: 38.6477 } },
    { id: 'sly-park', name: 'Sly Park', kind: 'hamlet', pos: { lon: -120.5294, lat: 38.7332 } },
  ];
  const places = [];
  for (const w of want) {
    const hit = pois.find((p) => p.name.toLowerCase() === w.name.toLowerCase() && p.kind !== 'school' && p.kind !== 'station');
    places.push({ ...w, pos: hit ? hit.pos : w.pos, ...(hit ? { osm: hit.osm } : { note: 'approximate (GNIS) position' }) });
  }
  const pick = (re, kind) => pois.filter((p) => re.test(p.name) && (!kind || p.kind === kind));
  for (const p of [...pick(/Jenkinson|Sly Park Rec|Leoni|Capps/i), ...pois.filter((p) => p.kind === 'station' || p.kind === 'school'), ...pois.filter((p) => p.kind === 'hamlet' || p.kind === 'town')]) {
    const id = slug(p.name);
    if (places.some((q) => q.id === id)) continue;
    places.push({ id, name: p.name, kind: p.kind, pos: p.pos, osm: p.osm });
  }
  places.push({ id: 'ignition', name: 'Caldor origin (Middle Fork Cosumnes)', kind: 'landmark', pos: IGNITION.pos, note: 'IRWIN initial lat/lon' });
  places.push({ id: 'cosumnes-ridge-th', name: 'Cosumnes Ridge Trailhead', kind: 'trailhead', pos: { lon: -120.5075, lat: 38.6115 }, fictional: true, note: 'Fictional trailhead for the simulated rescue storyline' });
  places.push({ id: 'bear-hollow-ranch', name: 'Bear Hollow Ranch', kind: 'ranch', pos: { lon: -120.4885, lat: 38.6420 }, fictional: true, note: 'Fictional ranch (livestock) for the simulated storyline' });
  return places;
}

/* ------------------------------------------------------------------ main */

async function main() {
  await mkdir(OUT, { recursive: true });
  log(`grid ${W}x${H} = ${N} cells, ${DX.toFixed(1)} x ${DY.toFixed(1)} m`);
  const [elev, osm, weather, { per, fireId }, finalPer] = await Promise.all([buildElevation(), buildOsm(), buildWeather(), buildPerimeters(), buildFinalPerimeter()]);
  const { fuel, fb } = await buildFuel(elev, osm);
  const arrival = buildArrival(per, elev, fuel, weather);
  const { hotspots, mode } = await buildHotspots(per, arrival);
  const imagery = await buildImagery();
  const places = buildPlaces(osm.pois);

  const raster = { w: W, h: H, bbox: BBOX, cellM: Math.round(((DX + DY) / 2) * 100) / 100, dxM: Math.round(DX * 100) / 100, dyM: Math.round(DY * 100) / 100, cellAcres: Math.round(CELL_ACRES * 1e4) / 1e4, rowOrder: 'north-to-south', endianness: 'little', files: { elevation: 'elevation.bin (Int16 m)', fuel: 'fuel.bin (Uint8 FuelClass)', fbfm40: 'fbfm40.bin (Uint8 raw LANDFIRE FBFM40 code)', arrival: 'arrival.bin (Float32 ms since manifest.start, NaN = never)' } };
  const buf = (ta) => Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength);
  await Promise.all([
    writeFile(path.join(OUT, 'raster.json'), JSON.stringify(raster, null, 1)),
    writeFile(path.join(OUT, 'elevation.bin'), buf(elev)),
    writeFile(path.join(OUT, 'fuel.bin'), buf(fuel)),
    writeFile(path.join(OUT, 'fbfm40.bin'), buf(fb)),
    writeFile(path.join(OUT, 'arrival.bin'), buf(arrival)),
    writeFile(path.join(OUT, 'perimeters.json'), JSON.stringify({ fireId, perimeters: per.map((p) => ({ t: p.t, acres: p.acres, slot: p.slot, polygon: p.rings.map((r) => r.map(([lon, lat]) => ({ lon: r5(lon), lat: r5(lat) }))) })), final: finalPer })),
    writeFile(path.join(OUT, 'hotspots.json'), JSON.stringify({ mode, hotspots })),
    writeFile(path.join(OUT, 'weather.json'), JSON.stringify({ point: { lon: (BBOX[0] + BBOX[2]) / 2, lat: (BBOX[1] + BBOX[3]) / 2 }, weather })),
    writeFile(path.join(OUT, 'osm.json'), JSON.stringify({ roads: osm.roads, buildings: osm.buildings, water: osm.water })),
  ]);
  const manifest = {
    id: 'caldor-2021',
    name: 'Caldor Fire replay',
    disclaimer: 'Scenario built from public data; units, people and events are simulated.',
    bbox: BBOX,
    center: { lon: -120.51, lat: 38.64 },
    start: REPLAY_START,
    end: REPLAY_END,
    tz: 'PDT',
    tzOffsetMin: PDT_OFFSET_H * 60,
    dataStart: IGNITION.t,
    dataEnd: per.at(-1)?.t ?? DATA_END,
    ignition: IGNITION,
    replayNote: 'Replay window Aug 16 12:00 PDT -> Aug 17 12:00 PDT. Arrival values < 0 burned before the replay start; the full data range runs from ignition (Aug 14 18:54 PDT) to the last FEDS perimeter.',
    places,
    sources,
    imagery: imagery.main ? { url: imagery.main.url, bbox: imagery.main.bbox, date: imagery.main.date, source: imagery.main.source } : undefined,
    imageryExtra: imagery.gibs,
    hotspotMode: mode,
    notes,
    generatedAt: nowIso,
  };
  await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  let total = 0;
  for (const f of ['manifest.json', 'raster.json', 'elevation.bin', 'fuel.bin', 'fbfm40.bin', 'arrival.bin', 'perimeters.json', 'hotspots.json', 'weather.json', 'osm.json', 'imagery.jpg']) {
    try { const s = await stat(path.join(OUT, f)); total += s.size; log(`${f}: ${(s.size / 1024).toFixed(0)} KB`); } catch { /* optional */ }
  }
  log(`done: ${(total / 1048576).toFixed(1)} MB core payload, hotspots=${hotspots.length} (${mode})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
