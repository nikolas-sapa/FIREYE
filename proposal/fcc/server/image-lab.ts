import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { LAB_API, LAB_MODELS, MAX_IMAGE_BYTES, MAX_PROMPT_LENGTH, type LabResult } from '../src/image-lab/protocol';
import { createGridHandler } from './image-lab-grid';

const BODY_LIMIT = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + MAX_PROMPT_LENGTH * 6 + 2048;
const TTL = 60 * 60 * 1000;
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, 'Send JSON.');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > BODY_LIMIT) throw new HttpError(413, 'Image exceeds the 8 MiB limit.');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
}

export function validateInput(input: Record<string, unknown>) {
  if (!input || typeof input !== 'object') throw new HttpError(400, 'Invalid input.');
  const model = LAB_MODELS.find(m => m.value === input.model);
  if (!model) throw new HttpError(400, 'Select a supported image-edit model.');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > MAX_PROMPT_LENGTH) {
    throw new HttpError(400, 'Prompt must contain 1–16,000 characters.');
  }
  if (typeof input.image !== 'string') throw new HttpError(400, 'An image is required.');
  const images = [input.image, ...(input.context === undefined ? [] : [input.context])];
  let total = 0;
  for (const image of images) {
    const match = typeof image === 'string' ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image) : null;
    if (!match || match[2].length % 4 !== 0) throw new HttpError(400, 'Use a JPEG, PNG, or WebP image, not a URL.');
    const bytes = Buffer.from(match[2], 'base64');
    total += bytes.length;
    if (!bytes.length || total > MAX_IMAGE_BYTES) throw new HttpError(413, 'Image exceeds the 8 MiB limit.');
    const valid = match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw new HttpError(400, 'Image content does not match its file type.');
  }
  const resolution = input.resolution ?? '1K';
  if (!['1K', '2K', '4K'].includes(String(resolution))) throw new HttpError(400, 'Unsupported resolution.');
  return { model, payload: {
    prompt: input.prompt.trim(), image_urls: images, num_images: 1,
    aspect_ratio: 'auto', output_format: 'png', limit_generations: true,
    ...(model.resolution ? { resolution } : {}),
  } };
}

/** Local research tool only. No public, unauthenticated billable proxy. */
export function createImageLabMiddleware(getKey: () => string, fetcher: typeof fetch = fetch) {
  const jobs = new Map<string, { root: string; requestId: string; created: number; result?: LabResult }>();
  let submissions: number[] = [];
  /** Concurrent provider handshakes; four lets every grid cell submit at once. */
  let inFlight = 0;

  async function provider(path: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetcher(`https://queue.fal.run/${path}`, {
        method, headers: { Authorization: `Key ${getKey()}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000), redirect: 'error',
      });
    } catch { throw new HttpError(502, 'Could not reach fal. Submission may have succeeded; check fal history before resubmitting.'); }
    if (!response.ok) {
      // Never forward provider bodies, which can echo user images, prompts, or credentials.
      const message = response.status === 401 || response.status === 403 ? 'fal rejected the key or model access. Check FAL_KEY and your account.'
        : response.status === 429 ? 'fal rate limit reached. Wait before trying again.'
          : response.status === 422 ? 'fal could not process this input. Check the image, prompt, and model.'
            : `fal returned HTTP ${response.status}. Check the request in fal history.`;
      throw new HttpError(502, message);
    }
    try { return await response.json() as Record<string, unknown>; }
    catch { throw new HttpError(502, 'fal returned an unreadable response. Check fal history before resubmitting.'); }
  }

  async function submit(input: Record<string, unknown>) {
    if (!getKey()) throw new HttpError(503, 'Add FAL_KEY to .env or .env.local, then restart the local server.');
    const now = Date.now();
    submissions = submissions.filter(t => now - t < 60000);
    if (inFlight >= 4 || submissions.length >= 20 || jobs.size >= 100) throw new HttpError(429, 'Local request limit reached. Wait before submitting again.');
    inFlight++;
    try {
      const { model, payload } = validateInput(input);
      submissions.push(now);
      const data = await provider(model.value, 'POST', payload);
      if (typeof data.request_id !== 'string' || !/^[\w-]{1,128}$/.test(data.request_id)) {
        throw new HttpError(502, 'fal did not return a request ID. Check fal history before resubmitting.');
      }
      const id = randomUUID();
      jobs.set(id, { root: model.value.split('/').slice(0, 2).join('/'), requestId: data.request_id, created: now });
      return { jobId: id, requestId: data.request_id };
    } finally { inFlight--; }
  }

  const grid = createGridHandler({
    readJson, send, submit, validate: validateInput, fetcher,
    resultUrl: id => jobs.get(id)?.result?.images?.[0]?.url,
    fail(status, message): never { throw new HttpError(status, message); },
  });

  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== LAB_API && !path.startsWith(`${LAB_API}/`)) return next();
    try {
      const host = req.headers.host ?? '';
      const url = new URL(`http://${host}`);
      const remote = req.socket.remoteAddress;
      if (!localHosts.has(url.hostname) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '')) {
        throw new HttpError(403, 'The image lab is available on localhost only.');
      }
      if (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) {
        throw new HttpError(403, 'Cross-origin requests are not allowed.');
      }
      if (req.method === 'GET' && path === `${LAB_API}/config`) return send(res, 200, { configured: !!getKey() });
      const now = Date.now();
      for (const [id, job] of jobs) if (now - job.created > TTL) jobs.delete(id);
      if (await grid(req, res, path)) return;
      if (!getKey()) throw new HttpError(503, 'Add FAL_KEY to .env or .env.local, then restart the local server.');
      if (req.method === 'POST' && path === LAB_API) {
        if (!req.headers.origin) throw new HttpError(403, 'A same-origin browser request is required.');
        return send(res, 202, await submit(await readJson(req)));
      }
      const id = path.slice(LAB_API.length + 1);
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      const job = jobs.get(id);
      if (!job) throw new HttpError(404, 'Request expired or server restarted. Check fal history; do not blindly resubmit.');
      if (job.result) return send(res, 200, job.result);
      const root = `${job.root}/requests/${encodeURIComponent(job.requestId)}`;
      const status = await provider(`${root}/status`);
      if (!['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'].includes(String(status.status))) throw new HttpError(502, 'Unrecognized fal queue status.');
      if (status.error) throw new HttpError(502, 'fal could not complete this request. Check fal history for details.');
      if (status.status !== 'COMPLETED') return send(res, 200, {
        status: status.status, requestId: job.requestId,
        queuePosition: typeof status.queue_position === 'number' ? status.queue_position : undefined,
      });
      const data = await provider(root);
      const images = Array.isArray(data.images) ? data.images.flatMap((image: unknown) => {
        if (!image || typeof image !== 'object' || !('url' in image) || typeof image.url !== 'string') return [];
        try {
          const imageUrl = new URL(image.url);
          if (imageUrl.protocol !== 'https:' || imageUrl.username || imageUrl.password) return [];
        } catch { return []; }
        return [{ url: image.url }];
      }).slice(0, 1) : [];
      if (!images.length) throw new HttpError(502, 'fal returned no usable image. The request may have been filtered. Check fal history.');
      job.result = {
        status: 'COMPLETED', requestId: job.requestId, images,
        description: typeof data.description === 'string' ? data.description.slice(0, 30000) : '',
      };
      return send(res, 200, job.result);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) send(res, error instanceof HttpError ? error.status : 500, {
        error: error instanceof HttpError ? error.message : 'The image lab could not process the request.',
      });
    }
  };
}
