// Local deterministic image handling using macOS image decoding and Node's PNG encoder.
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
export const dir = fileURLToPath(new URL('../experiments/crete-study-2026-11-15/', import.meta.url));
export function decode(name) {
  const input = join(dir, name), temporary = `${input}.decode.bmp`;
  execFileSync('/usr/bin/sips', ['-s', 'format', 'bmp', input, '--out', temporary], { stdio: 'pipe' });
  try {
    const bytes = readFileSync(temporary), offset = bytes.readUInt32LE(10);
    const width = bytes.readInt32LE(18), signedHeight = bytes.readInt32LE(22), height = Math.abs(signedHeight);
    const bits = bytes.readUInt16LE(28), compression = bytes.readUInt32LE(30);
    if (width <= 0 || height <= 0 || ![24, 32].includes(bits) || ![0, 3].includes(compression)) throw Error(`Unsupported BMP ${bits}/${compression}`);
    const step = bits / 8, stride = Math.ceil(width * step / 4) * 4, data = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const src = offset + (signedHeight > 0 ? height - y - 1 : y) * stride + x * step, dst = (y * width + x) * 3;
      data[dst] = bytes[src + 2]; data[dst + 1] = bytes[src + 1]; data[dst + 2] = bytes[src];
    }
    return { width, height, data };
  } finally { unlinkSync(temporary); }
}
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const tag = Buffer.from(type), body = Buffer.concat([tag, data]), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); body.copy(result, 4);
  let crc = 0xffffffff;
  for (const byte of body) crc = table[(crc ^ byte) & 255] ^ crc >>> 8;
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
export function save(name, image) {
  const { width, height, data } = image, header = Buffer.alloc(13), raw = Buffer.alloc(height * (1 + width * 3));
  if (data.length !== width * height * 3) throw Error('Invalid raster length');
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  writeFileSync(join(dir, name), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
export function crop(image, x, y, width, height) {
  if (x < 0 || y < 0 || x + width > image.width || y + height > image.height) throw Error('Crop outside source');
  const data = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row++) data.set(image.data.subarray(((y + row) * image.width + x) * 3, ((y + row) * image.width + x + width) * 3), row * width * 3);
  return { width, height, data };
}
export function resize(image, width, height) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (Math.min(image.height - 1, Math.floor((y + .5) * image.height / height)) * image.width +
      Math.min(image.width - 1, Math.floor((x + .5) * image.width / width))) * 3;
    data.set(image.data.subarray(src, src + 3), (y * width + x) * 3);
  }
  return { width, height, data };
}
export function mosaic(images) {
  if (images.length !== 4 || images.some(im => im.width !== 512 || im.height !== 512)) throw Error('Need exactly four 512 px tiles');
  const result = { width: 1024, height: 1024, data: new Uint8Array(1024 * 1024 * 3) };
  images.forEach((image, index) => {
    for (let y = 0; y < 512; y++) result.data.set(image.data.subarray(y * 512 * 3, (y + 1) * 512 * 3), ((Math.floor(index / 2) * 512 + y) * 1024 + index % 2 * 512) * 3);
  });
  return result;
}
export const palette = [[255, 184, 0], [92, 200, 255], [146, 146, 152]];
export function classify(image) {
  const labels = new Uint8Array(image.width * image.height), data = new Uint8Array(image.data.length), counts = [0, 0, 0];
  let invalid = 0, sumDistance = 0;
  for (let i = 0; i < labels.length; i++) {
    const distances = palette.map(rgb => rgb.reduce((sum, channel, c) => sum + (channel - image.data[i * 3 + c]) ** 2, 0));
    let best = distances.indexOf(Math.min(...distances)), distance = Math.sqrt(distances[best]);
    // Reject off-palette texture/decoration instead of turning it into confident cover.
    if (distance > 45) { best = 2; invalid++; }
    sumDistance += distance; labels[i] = best; counts[best]++;
    data.set(palette[best], i * 3);
  }
  return { width: image.width, height: image.height, data, labels,
    metrics: { counts, invalidFraction: invalid / labels.length, meanPaletteDistance: sumDistance / labels.length } };
}
export function overlay(source, mask, opacity = .30) {
  if (source.width !== mask.width || source.height !== mask.height) throw Error('Overlay dimensions differ');
  const data = new Uint8Array(source.data.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(source.data[i] * (1 - opacity) + mask.data[i] * opacity);
  return { width: source.width, height: source.height, data };
}
function prepare() {
  const source = decode('source.jpg');
  if (source.width !== 1024 || source.height !== 1024) throw Error('Wrong source dimensions');
  save('source.png', source);
  for (let index = 0; index < 4; index++) {
    const label = ['NW', 'NE', 'SW', 'SE'][index], x = index % 2 * 512, y = Math.floor(index / 2) * 512;
    save(`input-${label}.png`, crop(source, x, y, 512, 512));
    const hx = x === 0 ? 0 : 448, hy = y === 0 ? 0 : 448;
    save(`halo-${label}.png`, crop(source, hx, hy, 576, 576));
  }
  save('input-center.png', crop(source, 256, 256, 512, 512));
  save('baseline.png', mosaic(['NW', 'NE', 'SW', 'SE'].map(label => resize(decode(`baseline-${label}.png`), 512, 512))));
  // Independent corner/order roundtrip checks for the raster utilities.
  const reassembled = mosaic(['NW', 'NE', 'SW', 'SE'].map(label => decode(`input-${label}.png`)));
  if (!reassembled.data.every((v, i) => v === source.data[i])) throw Error('Source crop roundtrip mismatch');
  console.log('Prepared exact crops and 64 px halos; 3,145,728 source RGB channels roundtrip exactly.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'prepare') prepare();
  else if (process.argv[2] === 'render') {
    const name = process.argv[3], sourceName = process.argv[4] ?? 'source.png';
    const source = decode(sourceName), mask = classify(resize(decode(`${name}.png`), source.width, source.height));
    save(`${name}-mask.png`, mask); save(`${name}-overlay.png`, overlay(source, mask));
    writeFileSync(join(dir, `${name}-metrics.json`), JSON.stringify(mask.metrics, null, 2));
    console.log(JSON.stringify({ name, ...mask.metrics }));
  } else throw Error('Use prepare or render <name> [source.png]');
}
