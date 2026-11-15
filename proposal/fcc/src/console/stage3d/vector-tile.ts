/** Small, bounds-checked reader for the public Mapbox Vector Tile 2.x wire format.
 * Only geometry and scalar attributes are retained. No provider styling or scripts execute.
 */
export interface TileFeature {
  type: number;
  properties: Record<string, string | number | boolean>;
  paths: number[][][];
}
export interface TileLayer { name: string; extent: number; features: TileFeature[] }

class Reader {
  pos = 0;
  constructor(readonly data: Uint8Array) {}
  uint() {
    let value = 0, factor = 1;
    for (let n = 0; n < 10; n++) {
      if (this.pos >= this.data.length) throw new Error('Truncated vector tile');
      const b = this.data[this.pos++];
      value += (b & 127) * factor;
      if (b < 128) return value;
      factor *= 128;
    }
    throw new Error('Invalid vector varint');
  }
  bytes() {
    const size = this.uint(), start = this.pos;
    if (size > this.data.length - start) throw new Error('Invalid vector field length');
    this.pos += size;
    return this.data.subarray(start, this.pos);
  }
  skip(wire: number) {
    if (wire === 0) this.uint();
    else if (wire === 2) this.bytes();
    else if (wire === 1 || wire === 5) this.pos += wire === 1 ? 8 : 4;
    else throw new Error('Unsupported vector wire type');
    if (this.pos > this.data.length) throw new Error('Truncated vector field');
  }
}
const decoder = new TextDecoder();
function value(data: Uint8Array): string | number | boolean {
  const r = new Reader(data);
  let out: string | number | boolean = '';
  while (r.pos < data.length) {
    const tag = r.uint(), field = tag >> 3, wire = tag & 7;
    if (field === 1 && wire === 2) out = decoder.decode(r.bytes());
    else if ((field === 2 && wire === 5) || (field === 3 && wire === 1)) {
      const size = wire === 5 ? 4 : 8;
      if (r.pos + size > data.length) throw new Error('Truncated vector number');
      const view = new DataView(data.buffer, data.byteOffset + r.pos, size);
      out = wire === 5 ? view.getFloat32(0, true) : view.getFloat64(0, true);
      r.pos += size;
    } else if (field >= 4 && field <= 7 && wire === 0) {
      const n = r.uint();
      out = field === 7 ? !!n : field === 6 ? (n % 2 ? -(n + 1) / 2 : n / 2) : n;
    } else r.skip(wire);
  }
  return out;
}
function packed(data: Uint8Array) {
  const r = new Reader(data), out: number[] = [];
  while (r.pos < data.length) out.push(r.uint());
  return out;
}
function geometry(commands: number[]) {
  const paths: number[][][] = [];
  let x = 0, y = 0, i = 0, path: number[][] = [];
  const signed = (n: number) => n % 2 ? -(n + 1) / 2 : n / 2;
  while (i < commands.length) {
    const cmd = commands[i++], op = cmd & 7, count = Math.floor(cmd / 8);
    if (!count || ![1, 2, 7].includes(op)) throw new Error('Invalid vector geometry');
    if (op === 7) {
      if (path.length) path.push([...path[0]]);
      continue;
    }
    if (count > (commands.length - i) / 2) throw new Error('Truncated vector geometry');
    for (let n = 0; n < count; n++) {
      x += signed(commands[i++]); y += signed(commands[i++]);
      if (op === 1) { path = []; paths.push(path); }
      path.push([x, y]);
    }
  }
  return paths;
}

export function readVectorTile(buffer: ArrayBuffer): TileLayer[] {
  if (buffer.byteLength > 8 * 1024 * 1024) throw new Error('Vector tile exceeds size budget');
  const tile = new Reader(new Uint8Array(buffer)), layers: TileLayer[] = [];
  while (tile.pos < tile.data.length) {
    const tag = tile.uint();
    if (tag !== 26) { tile.skip(tag & 7); continue; }
    const r = new Reader(tile.bytes()), keys: string[] = [], values: ReturnType<typeof value>[] = [];
    const records: Uint8Array[] = [];
    const layer: TileLayer = { name: '', extent: 4096, features: [] };
    while (r.pos < r.data.length) {
      const t = r.uint();
      if (t === 10) layer.name = decoder.decode(r.bytes());
      else if (t === 18) records.push(r.bytes());
      else if (t === 26) keys.push(decoder.decode(r.bytes()));
      else if (t === 34) values.push(value(r.bytes()));
      else if (t === 40) layer.extent = r.uint();
      else r.skip(t & 7);
    }
    if (!layer.extent || layer.extent > 65536 || records.length > 100000) throw new Error('Invalid vector layer');
    if (!['earth', 'water', 'landuse', 'landcover', 'roads', 'buildings', 'places'].includes(layer.name)) continue;
    for (const data of records) {
      const f = new Reader(data), properties: TileFeature['properties'] = {};
      let type = 0, tags: number[] = [], commands: number[] = [];
      while (f.pos < data.length) {
        const t = f.uint();
        if (t === 18) tags = packed(f.bytes());
        else if (t === 24) type = f.uint();
        else if (t === 34) commands = packed(f.bytes());
        else f.skip(t & 7);
      }
      if (tags.length % 2) throw new Error('Invalid vector attributes');
      for (let i = 0; i < tags.length; i += 2) {
        if (keys[tags[i]] === undefined || values[tags[i + 1]] === undefined) throw new Error('Invalid vector attribute index');
        properties[keys[tags[i]]] = values[tags[i + 1]];
      }
      layer.features.push({ type, properties, paths: geometry(commands) });
    }
    layers.push(layer);
  }
  return layers;
}
