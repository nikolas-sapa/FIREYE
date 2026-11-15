import type { Feed, FeedFx } from '../contracts';

/** Local rendered-pixel record, not a backend FramePayload or shared-media registration. */
export interface FrameMetadata {
  version: 'fcc-local-frame.v1';
  frame_id: string;
  feed_id: string;
  asset_id: string;
  evidence_id: string;
  source_snapshot_id: string;
  source_revision: number;
  capture_epoch: number;
  modality: 'thermal' | 'eo';
  source_kind: 'simulated';
  synthetic: true;
  radiometric: false;
  calibration: null;
  captured_at: string | null;
  capture_time_status: 'known' | 'unknown';
  received_at: string | null;
  scenario_time_ms: number | null;
  /** No agreed bridge clock/georegistration: do not invent them from the replay. */
  sim_tick: null;
  source_position: null;
  location_uncertainty_m: null;
  rendered_at_ms: number;
  width_px: number;
  height_px: number;
  display_transform: FeedFx;
}

export const LOCAL_FRAME_LIMITS = { width: 1920, height: 1080, bytes: 4 * 1024 * 1024, encodeMs: 5000 } as const;
const KEYS = new Set(('version frame_id feed_id asset_id evidence_id source_snapshot_id source_revision capture_epoch modality source_kind synthetic radiometric calibration captured_at capture_time_status received_at scenario_time_ms sim_tick source_position location_uncertainty_m rendered_at_ms width_px height_px display_transform').split(' '));
const FX = new Set(['eo', 'ir-ironbow', 'ir-whitehot', 'night', 'phone', 'sat']);
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f]/.test(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function isUtc(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === (v.includes('.') ? v : v.replace('Z', '.000Z'));
}

export function validateFrameMetadata(value: unknown): { ok: true; value: FrameMetadata } | { ok: false; reason: string } {
  const bad = (reason: string) => ({ ok: false as const, reason });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad('Frame metadata must be an object');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== KEYS.size || Object.keys(v).some(k => !KEYS.has(k))) return bad('Unexpected or missing frame metadata fields');
  if (v.version !== 'fcc-local-frame.v1' || !['frame_id', 'feed_id', 'asset_id', 'evidence_id', 'source_snapshot_id'].every(k => id(v[k]))) return bad('Invalid frame identity');
  if (!integer(v.source_revision) || !integer(v.capture_epoch) || v.capture_epoch < 1) return bad('Invalid source revision or capture epoch');
  if (!['thermal', 'eo'].includes(String(v.modality)) || v.source_kind !== 'simulated' || v.synthetic !== true
    || v.radiometric !== false || v.calibration !== null) return bad('Invalid simulated source metadata');
  if (!(v.capture_time_status === 'known' && isUtc(v.captured_at)) && !(v.capture_time_status === 'unknown' && v.captured_at === null)) return bad('Invalid acquisition clock');
  if (v.received_at !== null && !isUtc(v.received_at)) return bad('Invalid receipt clock');
  if (v.scenario_time_ms !== null && (!integer(v.scenario_time_ms) || v.scenario_time_ms > 8.64e15)) return bad('Invalid scenario time');
  if (v.sim_tick !== null || v.source_position !== null || v.location_uncertainty_m !== null) return bad('Bridge clock and geography are not registered');
  if (typeof v.rendered_at_ms !== 'number' || !Number.isFinite(v.rendered_at_ms) || v.rendered_at_ms < 0) return bad('Invalid rendering clock');
  if (!integer(v.width_px) || !integer(v.height_px) || v.width_px < 1 || v.height_px < 1
    || v.width_px > LOCAL_FRAME_LIMITS.width || v.height_px > LOCAL_FRAME_LIMITS.height || !FX.has(String(v.display_transform))) return bad('Invalid frame dimensions or display transform');
  return { ok: true, value: v as unknown as FrameMetadata };
}

const session = typeof crypto !== 'undefined' ? crypto.randomUUID() : 'unavailable';
let sequence = 0;

/** Call only after pixels were copied successfully. Never called for archive fallbacks or disconnects. */
export function renderedFrame(feed: Feed, canvas: Pick<HTMLCanvasElement, 'width' | 'height'>, scenarioTime: number, renderedAt: number): FrameMetadata | undefined {
  if (!feed.live || !feed.unitId || !feed.modality || feed.sourceKind !== 'simulated' || feed.synthetic !== true || feed.radiometric !== false) return;
  const key = `${session}:${++sequence}`;
  return Object.freeze({
    version: 'fcc-local-frame.v1', frame_id: `frame:${key}`, feed_id: feed.id, asset_id: feed.unitId,
    evidence_id: `evidence:${key}`, source_snapshot_id: `render:${key}`, source_revision: sequence, capture_epoch: 1,
    modality: feed.modality, source_kind: 'simulated', synthetic: true, radiometric: false, calibration: null,
    captured_at: new Date().toISOString(), capture_time_status: 'known', received_at: null,
    scenario_time_ms: Math.floor(scenarioTime), sim_tick: null, source_position: null, location_uncertainty_m: null,
    rendered_at_ms: renderedAt, width_px: canvas.width, height_px: canvas.height, display_transform: feed.fx,
  });
}

export function frameStatus(frame: FrameMetadata | null | undefined, now: { simTime: number; nowMs: number; connected: boolean }): 'available' | 'stale' | 'unavailable' {
  if (!frame || !now.connected) return 'unavailable';
  const age = frame.scenario_time_ms === null ? null : now.simTime - frame.scenario_time_ms;
  return !Number.isFinite(now.nowMs) || now.nowMs < frame.rendered_at_ms || now.nowMs - frame.rendered_at_ms > 3000
    || (age !== null && (!Number.isFinite(age) || age < 0 || age > 3000)) ? 'stale' : 'available';
}

const encoding = new WeakSet<HTMLCanvasElement>();

/** Opt-in local PNG copy. Never uploads, fetches media, reads truth passes, or generates a receipt. */
export async function captureFrame(canvas: HTMLCanvasElement, metadata: FrameMetadata): Promise<{ metadata: Readonly<FrameMetadata>; pixels: Blob; content_hash: string }> {
  const valid = validateFrameMetadata(metadata);
  if (!valid.ok) throw new Error(`Invalid frame metadata: ${valid.reason}`);
  if (canvas.dataset?.truthOverlay === 'true') throw new Error('Truth overlays are not eligible for frame capture');
  if (canvas.width !== metadata.width_px || canvas.height !== metadata.height_px) throw new Error('Frame dimension mismatch');
  if (encoding.has(canvas)) throw new Error('Frame capture already in progress');
  encoding.add(canvas);
  const copy = Object.freeze({ ...valid.value });
  let encoded = false, timedOut = false;
  try {
    const pixels = await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => { timedOut = true; reject(new Error('Frame encode timed out')); }, LOCAL_FRAME_LIMITS.encodeMs);
      try {
        canvas.toBlob(blob => {
          clearTimeout(timer); encoded = true;
          if (timedOut) encoding.delete(canvas);
          blob ? resolve(blob) : reject(new Error('Frame encode unavailable'));
        }, 'image/png');
      } catch { clearTimeout(timer); encoded = true; reject(new Error('Frame encode unavailable')); }
    });
    if (pixels.type !== 'image/png' || !pixels.size || pixels.size > LOCAL_FRAME_LIMITS.bytes) throw new Error('Frame encode exceeds local limits');
    const bytes = await pixels.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return { metadata: copy, pixels, content_hash: `sha256:${[...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')}` };
  } finally { if (encoded) encoding.delete(canvas); }
}
