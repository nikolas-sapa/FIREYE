import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createImageLabMiddleware, validateInput } from '../server/image-lab';
import { LAB_API, LAB_MODELS, MAX_IMAGE_BYTES, MAX_PROMPT_LENGTH } from '../src/image-lab/protocol';
import { DEFAULT_LAB_PROMPT, LAB_PALETTE } from '../src/image-lab/prompt';
import ImageLabSection from '../src/sections/ImageLabSection';
import { ImageComparison } from '../src/design-system/components/ImageComparison';

const jpeg = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 217]).toString('base64')}`;
const input = { model: LAB_MODELS[0].value, prompt: DEFAULT_LAB_PROMPT, image: jpeg, resolution: '1K' };
assert.equal(LAB_MODELS[0].value, 'google/nano-banana-2.1/edit');
assert.equal(validateInput(input).payload.image_urls[0], jpeg);
for (const model of LAB_MODELS) {
  const checked = validateInput({ ...input, model: model.value, resolution: '4K' });
  assert.equal('resolution' in checked.payload, model.resolution);
  assert.equal(checked.payload.num_images, 1);
  assert.equal(checked.payload.aspect_ratio, 'auto');
}
assert.throws(() => validateInput({ ...input, model: 'https://attacker.example' }));
assert.throws(() => validateInput({ ...input, image: 'https://localhost/private' }));
assert.throws(() => validateInput({ ...input, image: 'data:image/svg+xml;base64,PHN2Zz4=' }));
assert.throws(() => validateInput({ ...input, image: 'data:image/png;base64,AAAA' }));
assert.throws(() => validateInput({ ...input, image: 'data:image/jpeg;base64,AAAA' }));
assert.throws(() => validateInput({ ...input, prompt: ' ' }));
assert.throws(() => validateInput({ ...input, prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1) }));
assert.doesNotThrow(() => validateInput({ ...input, prompt: 'x'.repeat(MAX_PROMPT_LENGTH) }));
assert.throws(() => validateInput({ ...input, resolution: '8K' }));
const boundaryImage = Buffer.alloc(MAX_IMAGE_BYTES);
boundaryImage.set([255, 216, 255]);
assert.doesNotThrow(() => validateInput({ ...input, image: `data:image/jpeg;base64,${boundaryImage.toString('base64')}` }));
assert.throws(() => validateInput({ ...input, image: `data:image/jpeg;base64,${Buffer.concat([boundaryImage, Buffer.from([0])]).toString('base64')}` }));
assert.deepEqual(LAB_PALETTE.map(p => p.id), ['H', 'V', 'O', 'N', 'U']);
for (const p of LAB_PALETTE) assert.ok(DEFAULT_LAB_PROMPT.includes(p.hex));
assert.match(DEFAULT_LAB_PROMPT, /Brown is not proof of dryness/);
assert.match(DEFAULT_LAB_PROMPT, /predicted fire paths/);
console.log('Input validation, exact limits, model payloads, fixed palette and seed prompt PASS');

let key = '';
let queueStatus = 'IN_QUEUE';
let providerStatus = 200;
let noImage = false;
let includeNotes = true;
let invalidJson = false;
const calls: { url: string; init: RequestInit }[] = [];
const secret = 'test-only-fal-key-never-return';
const fetcher: typeof fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  assert.equal(new Headers(init.headers).get('Authorization'), `Key ${secret}`);
  if (providerStatus !== 200) return Response.json({ error: secret, echoedImage: jpeg }, { status: providerStatus });
  if (invalidJson) return new Response('not json');
  if (init.method === 'POST') return Response.json({ request_id: `req-${calls.length}` });
  if (String(url).endsWith('/status')) return Response.json({ status: queueStatus, queue_position: 2 });
  return Response.json({ images: noImage ? [] : [{ url: 'https://fal.media/test-output.png' }], description: includeNotes ? 'V1: visible shrubs; moisture unknown.' : '' });
};
const middleware = createImageLabMiddleware(() => key, fetcher);
const server = createServer((req, res) => {
  void middleware(req, res, () => { res.writeHead(404); res.end(); });
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
async function request(path = '', method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; data: Record<string, any> }>((resolve, reject) => {
    const request = httpRequest(`${origin}${LAB_API}${path}`, {
      method, headers: { ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers },
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          assert.ok(!text.includes(secret));
          assert.ok(!text.includes(jpeg));
          assert.equal(response.headers['cache-control'], 'no-store');
          resolve({ status: response.statusCode ?? 0, data: JSON.parse(text) });
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}
try {
  assert.deepEqual((await request('/config')).data, { configured: false });
  assert.equal((await request('', 'POST', input)).status, 503);
  assert.equal(calls.length, 0);
  key = secret;
  assert.deepEqual((await request('/config')).data, { configured: true });
  assert.equal((await request('', 'POST', input, { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await request('', 'POST', input, { Host: 'attacker.example' })).status, 403);
  assert.equal((await request('', 'POST', input, { Origin: '' })).status, 403);
  assert.equal((await request('', 'POST', input, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await request('', 'POST', { ...input, model: 'unlisted' })).status, 400);
  assert.equal(calls.length, 0);
  const accepted = await request('', 'POST', input);
  assert.equal(accepted.status, 202);
  assert.equal(calls[0].url, 'https://queue.fal.run/google/nano-banana-2.1/edit');
  assert.equal(JSON.parse(String(calls[0].init.body)).resolution, '1K');
  const jobPath = `/${accepted.data.jobId}`;
  const queued = await request(jobPath);
  assert.equal(queued.data.status, 'IN_QUEUE');
  assert.equal(queued.data.queuePosition, 2);
  assert.equal(calls[1].url, `https://queue.fal.run/google/nano-banana-2.1/requests/${accepted.data.requestId}/status`);
  queueStatus = 'IN_PROGRESS';
  assert.equal((await request(jobPath)).data.status, 'IN_PROGRESS');
  queueStatus = 'COMPLETED';
  const completed = await request(jobPath);
  assert.equal(completed.data.images[0].url, 'https://fal.media/test-output.png');
  assert.match(completed.data.description, /moisture unknown/);
  const count = calls.length;
  assert.deepEqual((await request(jobPath)).data, completed.data);
  assert.equal(calls.length, count, 'Cached result must not generate another provider request');
  assert.equal((await request('/unknown')).status, 404);
  assert.equal((await request('', 'DELETE')).status, 405);

  const legacy = await request('', 'POST', { ...input, model: 'fal-ai/nano-banana/edit' });
  noImage = true;
  assert.equal((await request(`/${legacy.data.jobId}`)).status, 502);
  noImage = false;
  includeNotes = false;
  const recovered = await request(`/${legacy.data.jobId}`);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.data.description, '');
  assert.ok(calls.some(c => c.url.includes('/fal-ai/nano-banana/requests/')));
  for (const status of [401, 403, 422, 429, 500]) {
    providerStatus = status;
    assert.equal((await request('', 'POST', input)).status, 502);
  }
  providerStatus = 200;
  invalidJson = true;
  assert.equal((await request('', 'POST', input)).status, 502);
  invalidJson = false;
  const attempted = calls.filter(call => call.init.method === 'POST').length;
  for (let i = attempted; i < 20; i++) assert.equal((await request('', 'POST', input)).status, 202);
  assert.equal((await request('', 'POST', input)).status, 429);
  console.log('Loopback/same-origin API, secret isolation, queue lifecycle, recovery, errors and rate limits PASS');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

const html = renderToStaticMarkup(createElement(ImageLabSection, { initialMode: 'single' }));
for (const text of ['id="image-lab"', 'google/nano-banana-2.1/edit', 'lab-image', 'lab-prompt', 'Generate review overlay',
  'EXPERIMENTAL', 'Model details and current pricing', 'No automatic paid retries', 'Potential vegetation fuel']) {
  assert.ok(html.includes(text), `Missing UI content: ${text}`);
}
assert.ok(!html.includes(secret));
const comparison = renderToStaticMarkup(createElement(ImageComparison, { before: '/image-lab/forest.jpg' }));
assert.match(comparison, /object-contain/);
assert.match(comparison, /Your generated review overlay will appear here/);
assert.match(comparison, /Source image/);
console.log('Landing-page tool, default model, seeded instructions and accessible image-pair empty state PASS');
const gridHtml = renderToStaticMarkup(createElement(ImageLabSection));
for (const text of ['satellite-grid-lab', 'Pick random Greece landscape', 'max 4 calls', 'Historical 2020 mosaic',
  'CC BY-NC-SA 4.0', 'grid-consent', 'grid-terms', 'Prototype spread, not a forecast', 'fcc-landscape-v1', 'CORINE', 'Open-Meteo']) {
  assert.ok(gridHtml.includes(text), `Missing grid UI: ${text}`);
}
console.log('Default Greece-grid UI and explicit cost/license consent PASS');
await import('./image-lab-grid');
await import('./image-lab-landscape');
