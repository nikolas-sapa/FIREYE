// Explicitly authorized research only. No automatic paid retries; sixteen reserved attempts maximum
// (eight for the v1-v3 study, then four each for the authorized v4 and v5 grid checks).
import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = join(root, 'experiments/crete-study-2026-11-15');
const endpoint = 'google/nano-banana-2.1/edit';
const queueRoot = 'https://queue.fal.run/google/nano-banana-2.1';
const ledgerPath = join(dir, 'ledger.json');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const saveJson = async (path, data) => {
  await writeFile(`${path}.tmp`, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(`${path}.tmp`, path);
};
const inside = path => {
  const absolute = resolve(dir, path);
  if (relative(dir, absolute).startsWith('..')) throw Error('Study paths must stay within the study directory.');
  return absolute;
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function download(url, target) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
    !['tiles.maps.eox.at', 'storage.googleapis.com'].includes(parsed.hostname) &&
    parsed.hostname !== 'fal.media' && !parsed.hostname.endsWith('.fal.media')) throw Error('Unapproved media host');
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(45000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw Error(`Media download HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 12 * 1024 * 1024) { await reader.cancel(); throw Error('Media download too large'); }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  await writeFile(target, bytes);
  return { bytes: bytes.length, sha256: digest(bytes) };
}
function key() {
  const value = process.env.FAL_KEY || loadEnv('development', root, '').FAL_KEY;
  if (!value) throw Error('FAL_KEY is not configured');
  return value;
}
async function provider(path, method = 'GET', body) {
  const response = await fetch(`${queueRoot}${path}`, {
    method, headers: { Authorization: `Key ${key()}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Error(`fal HTTP ${response.status}; no automatic resubmission`);
  return response.json();
}
async function prepare(sourcePath) {
  const source = await readJson(sourcePath);
  if (source.schema !== 'fcc-satellite-grid-v1' || source.scene.id !== 'c31edf00-afd5-4153-b8ad-832177e4a1ad') throw Error('Unexpected study scene');
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, 'prompts'), { recursive: true });
  let ledger;
  try { ledger = await readJson(ledgerPath); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    ledger = { schema: 'fcc-study-budget-v1', maxSubmissions: 16, model: endpoint, resolution: '1K',
      sourceScene: source.scene, authorizedOn: '2026-11-15', entries: [] };
    await saveJson(ledgerPath, ledger);
  }
  await saveJson(join(dir, 'original-run.json'), source);
  const query = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap',
    LAYERS: source.scene.source.layer, STYLES: '', SRS: source.scene.crs,
    BBOX: source.scene.bounds.join(','), WIDTH: '1024', HEIGHT: '1024', FORMAT: 'image/jpeg' });
  const provenance = { source: source.scene.source, bounds: source.scene.bounds,
    recoveredAt: new Date().toISOString(), note: 'Re-fetched same source/layer/bounds. Original export contains no input hash, so byte identity to the original run cannot be proven.',
    imagery: await download(`https://tiles.maps.eox.at/wms?${query}`, join(dir, 'source.jpg')), originals: [] };
  for (const tile of source.tiles) {
    provenance.originals.push({ index: tile.index,
      ...await download(tile.output.images[0].url, join(dir, `baseline-${tile.cell.label}.png`)) });
  }
  await saveJson(join(dir, 'provenance.json'), provenance);
  console.log(JSON.stringify({ prepared: dir, existingPaidAttempts: ledger.entries.length, source: provenance.imagery }));
}
async function submit(name, specPath) {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error('Invalid experiment name');
  key(); // Fail before reservation when credentials are missing.
  const lock = await open(join(dir, '.submission-lock'), 'wx');
  try {
    const ledger = await readJson(ledgerPath);
    if (ledger.entries.some(entry => entry.name === name)) throw Error('Name already reserved. Use wait, never submit again.');
    if (ledger.maxSubmissions !== 16 || ledger.entries.length >= 16) throw Error('Sixteen-attempt hard limit reached');
    const spec = await readJson(inside(specPath));
    const prompt = await readFile(inside(spec.prompt), 'utf8');
    if (!prompt.trim() || prompt.length > 16000 || !Array.isArray(spec.images) || spec.images.length < 1 || spec.images.length > 3) throw Error('Invalid input spec');
    const images = await Promise.all(spec.images.map(async path => {
      if (!/\.(png|jpg)$/.test(path)) throw Error('Use PNG or JPEG');
      const data = await readFile(inside(path));
      if (data.length > 8 * 1024 * 1024) throw Error('Input too large');
      return { path, data, hash: digest(data) };
    }));
    const payload = { prompt, image_urls: images.map(image => `data:image/${image.path.endsWith('.png') ? 'png' : 'jpeg'};base64,${image.data.toString('base64')}`),
      num_images: 1, resolution: '1K', aspect_ratio: '1:1', output_format: 'png',
      seed: 41729, limit_generations: true, enable_web_search: false, thinking_level: 'medium' };
    const entry = { name, reservedAt: new Date().toISOString(), state: 'reserved',
      spec: { ...spec, promptText: prompt, seed: payload.seed, thinkingLevel: payload.thinking_level },
      inputs: images.map(image => ({ path: image.path, sha256: image.hash })) };
    ledger.entries.push(entry);
    await saveJson(ledgerPath, ledger); // Reserve BEFORE any paid POST.
    try {
      const accepted = await provider('/edit', 'POST', payload);
      if (!/^[\w-]{1,128}$/.test(accepted.request_id ?? '')) throw Error('No valid request ID; inspect fal history');
      entry.requestId = accepted.request_id;
      entry.state = 'accepted';
      await saveJson(ledgerPath, ledger);
      console.log(JSON.stringify({ name, requestId: entry.requestId, reserved: ledger.entries.length, cap: ledger.maxSubmissions }));
    } catch (error) {
      entry.state = 'uncertain-no-retry';
      entry.error = error.message.includes('fal HTTP') ? error.message : 'Submission outcome uncertain; inspect fal history. Never retry this slot.';
      await saveJson(ledgerPath, ledger);
      throw Error(entry.error);
    }
  } finally { await lock.close(); await unlink(join(dir, '.submission-lock')); }
}
async function wait(name) {
  const ledger = await readJson(ledgerPath);
  const entry = ledger.entries.find(entry => entry.name === name);
  if (!entry?.requestId) throw Error('No saved request ID; never blindly submit again');
  if (entry.state === 'completed') { console.log(`${name}: already completed`); return; }
  const until = Date.now() + 10 * 60 * 1000;
  let previous;
  while (Date.now() < until) {
    const status = await provider(`/requests/${entry.requestId}/status`);
    if (status.status !== previous) console.log(`${name}: ${status.status}`);
    previous = status.status;
    if (status.error) throw Error('Provider reported a job error; inspect fal history');
    if (status.status === 'COMPLETED') {
      const result = await provider(`/requests/${entry.requestId}`);
      if (!result.images?.[0]?.url) throw Error('No output image');
      entry.output = result;
      entry.state = 'completed';
      entry.finishedAt = new Date().toISOString();
      entry.download = await download(result.images[0].url, join(dir, `${name}.png`));
      await saveJson(join(dir, `${name}-result.json`), result);
      // Re-read so concurrent waits on other entries do not overwrite each other.
      const latest = await readJson(ledgerPath);
      Object.assign(latest.entries.find(item => item.name === name), entry);
      await saveJson(ledgerPath, latest);
      console.log(JSON.stringify({ name, requestId: entry.requestId, image: `${name}.png`, reserved: ledger.entries.length, usage: result.usage ?? null }));
      return;
    }
    if (!['IN_QUEUE', 'IN_PROGRESS'].includes(status.status)) throw Error('Unknown queue state');
    await new Promise(resolve => setTimeout(resolve, 3500));
  }
  throw Error('Polling timed out. Run wait again, not submit.');
}
const [command, arg, extra] = process.argv.slice(2);
try {
  if (command === 'prepare') await prepare(resolve(arg));
  else if (command === 'submit') await submit(arg, extra);
  else if (command === 'wait') await wait(arg);
  else if (command === 'status') {
    const ledger = await readJson(ledgerPath);
    console.log(JSON.stringify({ reserved: ledger.entries.length, cap: ledger.maxSubmissions,
      entries: ledger.entries.map(({ name, state, requestId }) => ({ name, state, requestId })) }, null, 2));
  } else throw Error('Use prepare <run.json>, submit <name> <spec.json>, wait <name>, or status');
} catch (error) { console.error(error.message); process.exitCode = 1; }
