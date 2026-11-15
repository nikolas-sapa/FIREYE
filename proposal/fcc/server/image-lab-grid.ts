import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { GRID_MAX_RETRIES, imageryUrl, randomGridScene, type GridScene } from '../src/image-lab/grid';
import { reviewPrompt, type LandscapePayload, type WeatherSeries } from '../src/image-lab/landscape';
import { LAB_API } from '../src/image-lab/protocol';
import { SourceError, buildLandscape, fetchWeather } from './image-lab-landscape';

interface Slot {
  state: 'submitting' | 'accepted' | 'uncertain';
  accepted?: { jobId: string; requestId: string };
}
interface Batch {
  scene: GridScene;
  /** Per cell, one slot per attempt: the first generation, then gate-rejected retries in order. */
  slots: Map<number, Slot[]>;
  settings?: { model: unknown; retries: number };
  loading: boolean;
  /** Keyless public inputs, fetched at most once per scene (weather refreshes after 10 min). */
  landscape?: Promise<LandscapePayload>;
  weather?: { at: number; data: Promise<WeatherSeries> };
}

interface GridDependencies {
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  send: (res: ServerResponse, status: number, data: unknown) => void;
  fail: (status: number, message: string) => never;
  submit: (input: Record<string, unknown>) => Promise<{ jobId: string; requestId: string }>;
  validate: (input: Record<string, unknown>) => unknown;
  resultUrl: (jobId: string) => string | undefined;
  fetcher: typeof fetch;
}

/** Reserves each attempt's slot BEFORE any provider call, including ambiguous failures. At most 1 + retries per cell. */
export function createGridHandler({ readJson, send, fail, submit, validate, resultUrl, fetcher }: GridDependencies) {
  const batches = new Map<string, Batch>();
  let picks: number[] = [];
  return async (req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> => {
    const root = `${LAB_API}/grid`;
    if (path !== root && !path.startsWith(`${root}/`)) return false;
    const now = Date.now();
    for (const [id, batch] of batches) {
      if (now - Date.parse(batch.scene.createdAt) > 3600000) batches.delete(id);
    }
    if (req.method === 'POST' && !req.headers.origin) fail(403, 'A same-origin browser request is required.');
    if (path === root && req.method === 'POST') {
      picks = picks.filter(t => now - t < 60000);
      if (picks.length >= 6 || batches.size >= 30) fail(429, 'Landscape limit reached. Wait before picking another spot.');
      const scene = randomGridScene(randomUUID());
      batches.set(scene.id, { scene, slots: new Map(), loading: false });
      picks.push(now);
      send(res, 201, scene);
      return true;
    }
    const match = /^\/([^/]+)\/(imagery|landscape|weather|tile\/([0-3])|output\/([0-3])(?:\/([0-3]))?)$/.exec(path.slice(root.length));
    if (!match) fail(400, 'Only a fixed 2 by 2 grid with tile indices 0–3 is supported.');
    const [, id, action, tileIndex, outputIndex, outputAttempt] = match!;
    const batch = batches.get(id);
    if (!batch) fail(404, 'Grid expired or server restarted. Pick a new landscape; check fal history for previous jobs.');
    const current = batch!;
    if ((action === 'landscape' || action === 'weather') && req.method === 'GET') {
      const sourceFailure = (what: string) => (error: unknown) => {
        if (action === 'landscape') current.landscape = undefined; else current.weather = undefined;
        if (error instanceof SourceError) fail(502, `${what} is unavailable (${error.message}). No fal analysis was submitted.`);
        throw error;
      };
      if (action === 'landscape') {
        current.landscape ??= buildLandscape(current.scene, fetcher);
        send(res, 200, await current.landscape.catch(sourceFailure('Land cover or terrain')));
      } else {
        if (!current.weather || now - current.weather.at > 600000) current.weather = { at: now, data: fetchWeather(current.scene, fetcher) };
        send(res, 200, await current.weather.data.catch(sourceFailure('Weather forecast')));
      }
      return true;
    }
    if ((action === 'imagery' || outputIndex !== undefined) && req.method === 'GET') {
      const isImagery = action === 'imagery';
      if (isImagery && current.loading) fail(429, 'This landscape is already loading.');
      if (isImagery) current.loading = true;
      try {
        let url = imageryUrl(current.scene);
        if (outputIndex !== undefined) {
          const attempts = current.slots.get(Number(outputIndex)) ?? [];
          // Without an attempt number, serve the latest attempt that has finished.
          const pick = outputAttempt !== undefined ? attempts[Number(outputAttempt)]
            : [...attempts].reverse().find(slot => slot.accepted && resultUrl(slot.accepted.jobId));
          const jobId = pick?.accepted?.jobId;
          const output = jobId ? resultUrl(jobId) : undefined;
          if (!output) fail(409, 'This tile has no completed image yet.');
          const media = new URL(output!);
          if (media.protocol !== 'https:' || media.username || media.password ||
            !(media.hostname === 'fal.media' || media.hostname.endsWith('.fal.media') || media.hostname === 'storage.googleapis.com')) {
            fail(502, 'This provider image host is not allowed for stitched downloads.');
          }
          url = media.href;
        }
        let response: Response;
        try { response = await fetcher(url, { signal: AbortSignal.timeout(30000), redirect: 'error' }); }
        catch { fail(502, 'Image download failed. No new fal analysis was submitted.'); }
        const contentType = response!.headers.get('content-type')?.split(';')[0];
        if (!response!.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType ?? '')) {
          fail(502, 'Image provider is unavailable or rate-limited. No new fal analysis was submitted.');
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        const reader = response!.body?.getReader();
        if (!reader) fail(502, 'Satellite provider returned no image.');
        try {
          while (true) {
            const part = await reader!.read();
            if (part.done) break;
            length += part.value.length;
            if (length > 8 * 1024 * 1024) { await reader!.cancel(); fail(502, 'Satellite image exceeds the download limit.'); }
            chunks.push(part.value);
          }
        } finally { reader!.releaseLock(); }
        const image = Buffer.concat(chunks);
        const valid = contentType === 'image/jpeg' ? image[0] === 255 && image[1] === 216 && image[2] === 255
          : contentType === 'image/png' ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP';
        if (!valid) fail(502, 'Image provider returned invalid image data.');
        res.writeHead(200, { 'Content-Type': contentType!, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(image);
      } finally { if (isImagery) current.loading = false; }
      return true;
    }
    if (tileIndex !== undefined && req.method === 'POST') {
      const index = Number(tileIndex);
      const input = await readJson(req);
      const attempt = input.attempt ?? 0, retries = input.retries ?? 0;
      if (!Number.isInteger(attempt) || (attempt as number) < 0 || (attempt as number) > GRID_MAX_RETRIES) fail(400, `Attempt must be 0 to ${GRID_MAX_RETRIES}.`);
      if (!Number.isInteger(retries) || (retries as number) < 0 || (retries as number) > GRID_MAX_RETRIES) fail(400, `Retries must be 0 to ${GRID_MAX_RETRIES}.`);
      const n = attempt as number;
      const attempts = current.slots.get(index) ?? [];
      const previous = attempts[n];
      if (previous?.accepted) { send(res, 200, previous.accepted); return true; }
      if (previous) fail(409, previous.state === 'submitting' ? 'This attempt is already submitting. Recover its existing request shortly.'
        : 'This attempt may already have been billed. Automatic resubmission is blocked; check fal history.');
      if (n !== attempts.length) fail(409, 'Attempts for a cell must run in order.');
      if (current.settings && current.settings.retries !== retries) fail(409, 'The retry budget is locked for this grid run. Pick a new landscape to change it.');
      if (n > (retries as number)) fail(409, 'This cell has used its retry budget.');
      // The palette gate runs in the browser; the server only allows a retry once the previous output exists.
      const before = attempts[n - 1]?.accepted;
      if (n > 0 && !(before && resultUrl(before.jobId))) fail(409, 'A retry needs the previous attempt for this cell to finish first.');
      if (input.resolution !== undefined && input.resolution !== '1K') fail(400, 'Grid analysis is capped at 1K per tile.');
      if (typeof input.context !== 'string') fail(400, 'The whole-scene context image is required.');
      // The review prompt is fixed server-side: the palette gate and fusion rules depend on its exact classes.
      const payload = { model: input.model, image: input.image, context: input.context, resolution: '1K',
        prompt: reviewPrompt(current.scene.tiles[index].label) };
      validate(payload); // Validate before spending the tile slot.
      if (current.settings && current.settings.model !== input.model) {
        fail(409, 'The model is locked for this grid run. Pick a new landscape for another experiment.');
      }
      // Recheck after the asynchronous body read to prevent double-click races.
      if ((current.slots.get(index)?.length ?? 0) !== n) fail(409, 'This attempt has already reserved its submission slot.');
      current.settings ??= { model: input.model, retries: retries as number };
      const slot: Slot = { state: 'submitting' };
      current.slots.set(index, [...attempts, slot]);
      try {
        slot.accepted = await submit(payload);
        slot.state = 'accepted';
        send(res, 202, slot.accepted);
      } catch (error) {
        slot.state = 'uncertain'; // No retries, even if a network failure hid the provider's acceptance.
        throw error;
      }
      return true;
    }
    fail(405, 'Method not allowed.');
    return true;
  };
}
