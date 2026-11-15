// One permitted, non-commercial archive mosaic, not incident-date or live imagery.
import { writeFile } from 'node:fs/promises';
const bbox = [23.55, 37.85, 24.15, 38.35], width = 3840, height = 4035;
const url = `https://tiles.maps.eox.at/wms?${new URLSearchParams({
  service: 'WMS', version: '1.1.1', request: 'GetMap', layers: 's2cloudless-2020',
  styles: '', srs: 'EPSG:4326', bbox: bbox.join(','), width: String(width), height: String(height), format: 'image/jpeg',
})}`;
const r = await fetch(url, { signal: AbortSignal.timeout(90000), redirect: 'error' });
if (!r.ok) throw new Error(`EOX returned ${r.status}`);
const bytes = new Uint8Array(await r.arrayBuffer());
if (bytes.length > 8 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Invalid or oversized archive imagery');
const dir = new URL('../public/data/monitoring/', import.meta.url);
await writeFile(new URL('attica-detail-2020.jpg', dir), bytes);
await writeFile(new URL('attica-detail-2020.json', dir), JSON.stringify({
  source: 'Sentinel-2 cloudless 2020 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)',
  url, bbox, width, height, fetchedAt: new Date().toISOString(),
  license: 'CC BY-NC-SA 4.0 · https://s2maps.eu · non-commercial use only',
  note: 'Historical composite. Approximately 10 m source imagery, resampled to approximately 14 m output. Not a 2024 or current observation.',
}, null, 2) + '\n');
console.log(`Saved EOX 2020 archive: ${width}×${height}, ${bytes.length} bytes`);
