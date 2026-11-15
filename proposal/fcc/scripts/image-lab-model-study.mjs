// Explicitly authorized model comparison: at most eight paid submissions per model, no automatic retries.
// Every slot is reserved in models/ledger.json BEFORE the paid POST; an uncertain submission is never resubmitted.
import { readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const study = join(root, 'experiments/crete-study-2026-11-15');
const dir = join(study, 'models');
const ledgerPath = join(dir, 'ledger.json');
const CAP = 8;
const MODELS = {
  'nb21-minimal': { endpoint: 'google/nano-banana-2.1/edit', imageField: 'image_urls', price: 'about $0.04 per 1K image (token billed)' },
  'kontext-dev': { endpoint: 'fal-ai/flux-kontext/dev', imageField: 'image_url', price: '$0.025 per megapixel, rounded up' },
  'qwen-2511': { endpoint: 'fal-ai/qwen-image-edit-2511', imageField: 'image_urls', price: '$0.03 per megapixel, rounded up' },
  'seedream-v4': { endpoint: 'fal-ai/bytedance/seedream/v4/edit', imageField: 'image_urls', price: '$0.03 per image' },
  'sam3': { endpoint: 'fal-ai/sam-3/image', imageField: 'image_url', price: '$0.005 per request' },
};
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
// Unique temp names: parallel waits must never share one temp file (that corrupted the ledger once).
const saveJson = async (path, data) => { const tmp = `${path}.${process.pid}.${Date.now()}.tmp`; await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); await rename(tmp, path); };
const inside = path => {
  const absolute = resolve(study, path);
  if (relative(study, absolute).startsWith('..')) throw Error('Paths must stay within the study directory.');
  return absolute;
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const approved = host => host === 'fal.media' || host.endsWith('.fal.media') || host === 'storage.googleapis.com' || host === 'queue.fal.run';
function key() {
  const value = process.env.FAL_KEY || loadEnv('development', root, '').FAL_KEY;
  if (!value) throw Error('FAL_KEY is not configured');
  return value;
}
async function fal(url, method = 'GET', body) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'queue.fal.run') throw Error('Unexpected fal URL');
  const response = await fetch(parsed, { method, headers: { Authorization: `Key ${key()}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(90000) });
  const text = await response.text();
  if (!response.ok) throw Error(`fal HTTP ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
async function download(url, target) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !approved(parsed.hostname)) throw Error(`Unapproved media host ${parsed.hostname}`);
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`Media download HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw Error('Media too large');
  await writeFile(target, bytes);
  return { bytes: bytes.length, sha256: digest(bytes), contentType: response.headers.get('content-type') };
}
async function ledger() {
  try { return await readJson(ledgerPath); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const fresh = { schema: 'fcc-model-study-budget-v1', capPerModel: CAP, authorizedOn: '2026-11-15',
      authorization: 'User: test each suggested model properly, eight generations total per model.', models: MODELS, entries: [] };
    await saveJson(ledgerPath, fresh);
    return fresh;
  }
}
async function submit(name, specPath) {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error('Invalid name');
  key();
  const lock = await open(join(dir, '.submission-lock'), 'wx');
  try {
    const book = await ledger();
    const spec = await readJson(inside(specPath));
    const model = MODELS[spec.model];
    if (!model) throw Error('Unknown model');
    if (book.entries.some(e => e.name === name)) throw Error('Name already reserved. Use wait, never submit again.');
    const used = book.entries.filter(e => e.model === spec.model).length;
    if (book.capPerModel !== CAP || used >= CAP) throw Error(`${spec.model}: eight-submission cap reached`);
    const images = await Promise.all(spec.images.map(async path => {
      const data = await readFile(inside(path));
      if (data.length > 8 * 1024 * 1024) throw Error('Input too large');
      return { path, url: `data:image/${path.endsWith('.png') ? 'png' : 'jpeg'};base64,${data.toString('base64')}`, sha256: digest(data) };
    }));
    const prompt = spec.prompt ? await readFile(inside(spec.prompt), 'utf8') : spec.text;
    const payload = { ...spec.params, ...(prompt ? { prompt } : {}),
      [model.imageField]: model.imageField === 'image_url' ? images[0].url : images.map(i => i.url) };
    if (model.imageField === 'image_url' && images.length !== 1) throw Error('This model takes exactly one image');
    const entry = { name, model: spec.model, endpoint: model.endpoint, reservedAt: new Date().toISOString(), state: 'reserved',
      spec: { ...spec, promptText: prompt }, inputs: images.map(i => ({ path: i.path, sha256: i.sha256 })) };
    book.entries.push(entry);
    await saveJson(ledgerPath, book);
    try {
      const accepted = await fal(`https://queue.fal.run/${model.endpoint}`, 'POST', payload);
      if (!/^[\w-]{1,128}$/.test(accepted.request_id ?? '')) throw Error('No valid request ID; inspect fal history');
      Object.assign(entry, { requestId: accepted.request_id, statusUrl: accepted.status_url, responseUrl: accepted.response_url,
        state: 'accepted', submittedAt: new Date().toISOString() });
      await saveJson(ledgerPath, book);
      console.log(JSON.stringify({ name, model: spec.model, requestId: entry.requestId, used: used + 1, cap: CAP }));
    } catch (error) {
      entry.state = 'uncertain-no-retry';
      entry.error = error.message;
      await saveJson(ledgerPath, book);
      throw error;
    }
  } finally { await lock.close(); await unlink(join(dir, '.submission-lock')); }
}
async function withLedgerLock(fn) {
  for (let i = 0; ; i++) {
    try {
      const lock = await open(join(dir, '.ledger-lock'), 'wx');
      try { return await fn(); } finally { await lock.close(); await unlink(join(dir, '.ledger-lock')); }
    } catch (error) {
      if (error.code !== 'EEXIST' || i > 200) throw error;
      await new Promise(r => setTimeout(r, 50));
    }
  }
}
async function update(name, patch) {
  await withLedgerLock(async () => {
    const latest = await ledger();
    Object.assign(latest.entries.find(e => e.name === name), patch);
    await saveJson(ledgerPath, latest);
  });
}
async function wait(name) {
  const entry = (await ledger()).entries.find(e => e.name === name);
  if (!entry?.statusUrl) throw Error('No saved request; never blindly submit again');
  if (entry.state === 'completed') { console.log(`${name}: already completed`); return; }
  const until = Date.now() + 10 * 60 * 1000;
  while (Date.now() < until) {
    const status = await fal(`${entry.statusUrl}?logs=0`);
    if (status.status === 'COMPLETED') {
      const result = await fal(entry.responseUrl);
      const files = [...(result.images ?? []), ...(result.masks ?? [])];
      if (!files.length && result.image) files.push(result.image);
      if (!files.length) {
        await update(name, { state: 'completed-empty', finishedAt: new Date().toISOString(),
          inferenceSeconds: status.metrics?.inference_time ?? null, note: 'Paid request returned no output (for SAM 3: no mask for the prompt).' });
        await saveJson(join(dir, `${name}-result.json`), result);
        console.log(JSON.stringify({ name, state: 'completed-empty', inference: status.metrics?.inference_time ?? null }));
        return;
      }
      const downloads = [];
      for (let k = 0; k < files.length; k++) {
        const kind = result.masks?.includes(files[k]) ? 'm' : '';
        const target = files.length === 1 ? `${name}.png` : `${name}-${kind || 'i'}${k}.png`;
        downloads.push({ file: target, ...await download(files[k].url, join(dir, target)), width: files[k].width, height: files[k].height });
      }
      const finishedAt = new Date().toISOString();
      const wallSeconds = +((Date.parse(finishedAt) - Date.parse(entry.submittedAt)) / 1000).toFixed(1);
      await update(name, { state: 'completed', finishedAt, downloads, wallSeconds,
        inferenceSeconds: status.metrics?.inference_time ?? null, timings: result.timings ?? null, seed: result.seed ?? null,
        scores: result.scores ?? null, usage: result.usage ?? null, nsfw: result.has_nsfw_concepts ?? null, description: result.description ?? null });
      await saveJson(join(dir, `${name}-result.json`), result);
      console.log(JSON.stringify({ name, files: downloads.map(d => `${d.file} ${d.width}x${d.height}`), wallSeconds, inference: status.metrics?.inference_time ?? null }));
      return;
    }
    if (!['IN_QUEUE', 'IN_PROGRESS'].includes(status.status)) throw Error(`Unknown queue state ${JSON.stringify(status).slice(0, 200)}`);
    await new Promise(r => setTimeout(r, 2000));
  }
  throw Error('Polling timed out. Run wait again, not submit.');
}
const [command, a, b] = process.argv.slice(2);
try {
  if (command === 'submit') await submit(a, b);
  else if (command === 'wait') await wait(a);
  else if (command === 'status') {
    const book = await ledger();
    const per = {};
    for (const e of book.entries) per[e.model] = (per[e.model] ?? 0) + 1;
    console.log(JSON.stringify({ used: per, cap: CAP, entries: book.entries.map(({ name, model, state, wallSeconds }) => ({ name, model, state, wallSeconds })) }, null, 1));
  } else throw Error('Use submit <name> <spec.json>, wait <name>, or status');
} catch (error) { console.error(error.message); process.exitCode = 1; }
