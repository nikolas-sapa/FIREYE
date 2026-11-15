// Public, non-billable presentation fixtures. No credentials or webcam URLs.
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const out = new URL('public/data/monitoring/', root);
const bundled = await build({ entryPoints: [new URL('server/monitoring.ts', root).pathname], bundle: true, platform: 'node', format: 'esm', write: false });
const { createMonitoringMiddleware } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const middleware = createMonitoringMiddleware(() => ({}));
await mkdir(out, { recursive: true });
async function save(path, filename) {
  const response = await new Promise((resolve, reject) => {
    let status;
    const req = { method: 'GET', url: `/api/monitor/${path}`, headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } };
    const res = { writeHead(code) { status = code; }, end(bytes) { status === 200 ? resolve(bytes) : reject(new Error(`${filename}: HTTP ${status}: ${new TextDecoder().decode(bytes)}`)); } };
    void middleware(req, res, () => reject(new Error('Unknown route'))).catch(reject);
  });
  if (response.byteLength > 5 * 1024 * 1024) throw new Error(`${filename} exceeds snapshot limit`);
  await writeFile(new URL(filename, out), response);
  console.log(`${filename}: ${response.byteLength} bytes`);
}
const tasks = [
  ['case2024', 'attica2024.json'],
  ['image?kind=gibs&view=attica2024&date=2024-08-12', 'attica2024-gibs.jpg'],
  ['firms', 'current-firms.json'], ['metar', 'current-metar.json'],
];
const results = await Promise.allSettled(tasks.map(([path, name]) => save(path, name)));
results.forEach(r => { if (r.status === 'rejected') { console.error(r.reason.message); process.exitCode = 1; } });
