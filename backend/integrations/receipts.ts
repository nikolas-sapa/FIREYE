import { createHash, randomUUID } from 'node:crypto';
import { types } from 'node:util';

export type Adapter = 'iris' | 'gemini' | 'fal' | 'treg';
export type Failure = 'DISABLED' | 'UNAUTHORIZED' | 'UNSUPPORTED' | 'INVALID_INPUT' | 'STALE' | 'BUDGET' | 'DEADLINE' | 'TRANSPORT' | 'REDIRECT' | 'OVERSIZE' | 'INVALID_REPLY' | 'QUEUE_FULL' | 'IDENTITY_CONFLICT';
export type Result<T> = Readonly<{ ok: true; value: T; receipt?: Receipt }> | Readonly<{ ok: false; code: Failure; receipt?: Receipt }>;
export type Evidence = Readonly<{
  evidence_id: string; source_id: string; rights_manifest_id: string;
  source_kind: 'simulated' | 'uploaded' | 'live' | 'public-link';
  captured_at_ms: number | null; received_at_ms: number;
  modality: 'eo' | 'thermal' | 'text'; synthetic: boolean;
  radiometric: false | 'unknown'; calibration: null;
  content_hash: string; byte_length: number; width_px: number | null; height_px: number | null;
}>;
export type Snapshot = Readonly<{
  incident_id: string; run_id: string; authority_epoch: number; input_revision: number;
  snapshot_id: string; received_cutoff_ms: number; valid_until_ms: number;
  evidence: readonly Evidence[];
}>;
export type Receipt = Readonly<{
  contract_version: 'sponsor-jobs.v1'; receipt_id: string; adapter: Adapter;
  provenance: 'fixture' | 'local-http' | 'provider'; fresh_provider_call: boolean;
  snapshot_id: string; input_hash: string; evidence_ids: readonly string[];
  started_at_ms: number; finished_at_ms: number; status: 'accepted' | Failure;
  endpoint: string; model: string | null; invocation_id: string | null;
  cost_micro: number | null; reserved_micro: number; upstream_cancelled: 'unknown';
}>;
export type TransportRequest = Readonly<{ url: string; method: 'POST'; headers: Readonly<Record<string, string>>; body: string; signal: AbortSignal; redirect: 'error' }>;
export type Transport = (request: TransportRequest) => Promise<Response>;
export type ClientConfig = Readonly<{
  enabled?: boolean; authorization_id?: string; max_call_micro?: number; deadline_ms?: number;
  budget?: SponsorBudget; now?: () => number; is_current?: (snapshot: Snapshot) => boolean;
  credential?: string; model?: string; registered_candidate_ids?: readonly string[];
  transport?: Transport; transport_mode?: 'fixture' | 'local-http';
  reservation?: Reservation;
}>;

const reservationBrand: unique symbol = Symbol('server-budget-reservation');
export type Reservation = Readonly<{ readonly [reservationBrand]: true }>;
const reservations = new WeakMap<object, { budget: SponsorBudget; micro: number; used: boolean }>();
const issuedReceipts = new WeakSet<object>();
export const serverReceipt = (value: unknown): value is Receipt => value !== null && typeof value === 'object' && issuedReceipts.has(value);

export const fail = (code: Failure): Result<never> => Object.freeze({ ok: false, code });
export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
export const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const positive = (value: unknown): value is number => integer(value) && value > 0;
export const secretLike = (value: string): boolean => /(?:bearer|api[_-]?key|token|secret|password|sk[_-]|AIza)/i.test(value) || /[A-Za-z0-9_-]{48,}/.test(value);
export const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
  && (!secretLike(value) || /^(?:proposed:candidate|candidate|job|snapshot):[a-f0-9]{64}$/.test(value));
export const closed = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
export const ids = (value: unknown, nonempty = true): value is readonly string[] => Array.isArray(value) && value.length <= 32 && (!nonempty || value.length > 0) && value.every(id) && new Set(value).size === value.length;

// Bound graph visits/depth and inspect descriptors before accessing caller data.
export function plainJson(value: unknown): boolean {
  let visits = 0;
  const active = new WeakSet<object>();
  function visit(input: unknown, depth: number): boolean {
    if (++visits > 4096 || depth > 16) return false;
    if (input === null || typeof input === 'boolean') return true;
    if (typeof input === 'string') return input.length <= 400_000;
    if (typeof input === 'number') return Number.isFinite(input);
    if (typeof input !== 'object' || types.isProxy(input) || active.has(input)) return false;
    const array = Array.isArray(input);
    if (Object.getPrototypeOf(input) !== (array ? Array.prototype : Object.prototype) && Object.getPrototypeOf(input) !== null) return false;
    const keys = Reflect.ownKeys(input);
    if (keys.length > 1024 || (array && keys.length !== input.length + 1)) return false;
    active.add(input);
    for (const key of keys) {
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      if (!Object.hasOwn(descriptor, 'value')) return false;
      if (array && key === 'length') continue;
      if (!descriptor.enumerable || !visit(descriptor.value, depth + 1)) return false;
    }
    active.delete(input);
    return true;
  }
  try { return visit(value, 0); } catch { return false; }
}

export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

export function validSnapshot(input: unknown, now: number): input is Snapshot {
  if (!plainJson(input) || !closed(input, ['incident_id', 'run_id', 'authority_epoch', 'input_revision', 'snapshot_id', 'received_cutoff_ms', 'valid_until_ms', 'evidence'])) return false;
  if (!id(input.incident_id) || !id(input.run_id) || !id(input.snapshot_id) || !integer(input.authority_epoch) || !integer(input.input_revision)
    || !integer(input.received_cutoff_ms) || !integer(input.valid_until_ms) || input.received_cutoff_ms > now || input.valid_until_ms <= now
    || input.valid_until_ms - input.received_cutoff_ms > 60_000 || !Array.isArray(input.evidence) || input.evidence.length < 1 || input.evidence.length > 16) return false;
  const seen = new Set<string>();
  for (const e of input.evidence) {
    if (!closed(e, ['evidence_id', 'source_id', 'rights_manifest_id', 'source_kind', 'captured_at_ms', 'received_at_ms', 'modality', 'synthetic', 'radiometric', 'calibration', 'content_hash', 'byte_length', 'width_px', 'height_px'])
      || !id(e.evidence_id) || seen.has(e.evidence_id) || !id(e.source_id) || !id(e.rights_manifest_id)
      || !['simulated', 'uploaded', 'live', 'public-link'].includes(String(e.source_kind))
      || !integer(e.captured_at_ms) || !integer(e.received_at_ms) || e.captured_at_ms > e.received_at_ms || e.received_at_ms > input.received_cutoff_ms
      || now - e.captured_at_ms > 60_000 || !['eo', 'thermal', 'text'].includes(String(e.modality))
      || typeof e.synthetic !== 'boolean' || ![false, 'unknown'].includes(e.radiometric as false | 'unknown') || e.calibration !== null
      || typeof e.content_hash !== 'string' || !/^[a-f0-9]{64}$/.test(e.content_hash) || !integer(e.byte_length) || e.byte_length > 262_144
      || !(e.width_px === null || positive(e.width_px)) || !(e.height_px === null || positive(e.height_px))) return false;
    if (e.source_kind === 'simulated' && (!e.synthetic || e.radiometric !== false)) return false;
    seen.add(e.evidence_id);
  }
  return true;
}

export function validPng(base64: unknown, evidence: Evidence): base64 is string {
  if (typeof base64 !== 'string' || base64.length > 349_528 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return false;
  const bytes = Buffer.from(base64, 'base64');
  return bytes.toString('base64') === base64 && bytes.length >= 33 && bytes.length === evidence.byte_length
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(8) === 13
    && positive(evidence.width_px) && evidence.width_px <= 1024 && positive(evidence.height_px) && evidence.height_px <= 1024
    && bytes.readUInt32BE(16) === evidence.width_px && bytes.readUInt32BE(20) === evidence.height_px
    && createHash('sha256').update(bytes).digest('hex') === evidence.content_hash;
}

export class SponsorBudget {
  #calls = 0;
  #reserved = 0;
  #active = 0;
  readonly #maxCalls: number;
  readonly #maxMicro: number;
  constructor(maxCalls = 0, maxMicro = 0) {
    this.#maxCalls = positive(maxCalls) ? maxCalls : 0;
    this.#maxMicro = positive(maxMicro) ? maxMicro : 0;
  }
  reserve(micro: number): boolean {
    if (!positive(micro) || this.#calls >= this.#maxCalls || micro > this.#maxMicro - this.#reserved) return false;
    this.#calls++;
    this.#reserved += micro;
    return true;
  }
  usage(): Readonly<{ calls: number; reserved_micro: number }> { return Object.freeze({ calls: this.#calls, reserved_micro: this.#reserved }); }
  acquire(micro: number): boolean {
    if (this.#active >= 2 || !this.reserve(micro)) return false;
    this.#active++;
    return true;
  }
  release(): void { if (this.#active > 0) this.#active--; }
  inFlight(): number { return this.#active; }
  prepay(micro: number): Reservation | null {
    if (!this.reserve(micro)) return null;
    const reservation: Reservation = Object.freeze({ [reservationBrand]: true });
    reservations.set(reservation, { budget: this, micro, used: false });
    return reservation;
  }
  acquireReserved(reservation: Reservation, micro: number): boolean {
    const entry = reservations.get(reservation);
    if (!entry || entry.budget !== this || entry.used || entry.micro !== micro || this.#active >= 2) return false;
    entry.used = true;
    this.#active++;
    return true;
  }
}

type RequestSpec = Readonly<{ url: string; model: string | null; headers: Readonly<Record<string, string>>; body: unknown }>;
export function configured(config: ClientConfig): Failure | null {
  if (config.enabled !== true) return 'DISABLED';
  if (!id(config.authorization_id) || !positive(config.max_call_micro) || !positive(config.deadline_ms) || config.deadline_ms > 10_000
    || !(config.budget instanceof SponsorBudget) || typeof config.is_current !== 'function') return 'UNAUTHORIZED';
  return null;
}

export async function perform<T>(adapter: Adapter, snapshot: Snapshot, input: unknown, config: ClientConfig, spec: RequestSpec,
  parse: (body: unknown, response: Response) => T | null): Promise<Result<T>> {
  const gate = configured(config);
  if (gate) return fail(gate);
  const endpointAllowed = adapter === 'treg' ? spec.url === 'https://treg.to/call/treg.web.search' && spec.model === null
    : adapter === 'iris' ? spec.url === 'https://inference.oumi.ai/v1/systemone'
    : adapter === 'fal' ? spec.url === 'https://fal.run/fal-ai/florence-2-large/caption'
    : /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-[a-z0-9.-]{1,80}:generateContent$/.test(spec.url);
  if (!endpointAllowed) return fail('UNSUPPORTED');
  const now = config.now ?? Date.now;
  const started = now();
  const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  try { if (!validSnapshot(snapshot, started) || !config.is_current!(snapshot)) return fail('STALE'); } catch { return fail('STALE'); }
  if (!config.transport && adapter !== 'treg') return fail('UNSUPPORTED');
  if (config.transport && !['fixture', 'local-http'].includes(config.transport_mode ?? '')) return fail('UNAUTHORIZED');
  if (!config.transport && (typeof config.credential !== 'string' || config.credential.length < 1 || /[\r\n]/.test(config.credential))) return fail('UNAUTHORIZED');
  if (!(config.reservation ? config.budget!.acquireReserved(config.reservation, config.max_call_micro!) : config.budget!.acquire(config.max_call_micro!))) return fail('BUDGET');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const end = started + config.deadline_ms!;
  const mode = config.transport ? config.transport_mode! : 'provider';
  const receipt = (status: Receipt['status'], response?: Response): Receipt => {
    const value: Receipt = freeze({
    contract_version: 'sponsor-jobs.v1', receipt_id: randomUUID(), adapter, provenance: mode,
    fresh_provider_call: mode === 'provider' && !response?.headers.has('X-Treg-Original-Cost-Micro'),
    snapshot_id: snapshot.snapshot_id, input_hash: inputHash,
    evidence_ids: snapshot.evidence.map(e => e.evidence_id), started_at_ms: started, finished_at_ms: now(), status,
    endpoint: spec.url, model: spec.model,
    invocation_id: adapter === 'treg' && id(response?.headers.get('X-Treg-Call-Id')) ? response!.headers.get('X-Treg-Call-Id') : null,
    cost_micro: adapter === 'treg' && /^\d{1,12}$/.test(response?.headers.get('X-Treg-Cost-Micro') ?? '')
      && integer(Number(response!.headers.get('X-Treg-Cost-Micro'))) ? Number(response!.headers.get('X-Treg-Cost-Micro')) : null,
    reserved_micro: config.max_call_micro!, upstream_cancelled: 'unknown',
    });
    issuedReceipts.add(value);
    return value;
  };
  try {
    const operation = async (): Promise<Result<T>> => {
      try {
      const request: TransportRequest = Object.freeze({ url: spec.url, method: 'POST', headers: Object.freeze({ 'Content-Type': 'application/json', ...spec.headers }),
        body: JSON.stringify(spec.body), signal: controller.signal, redirect: 'error' });
      const response = config.transport ? await config.transport(request) : await fetch(request.url, {
        method: request.method, headers: request.headers, body: request.body, signal: request.signal, redirect: 'manual',
      });
      if (response.redirected || (response.status >= 300 && response.status < 400)) return Object.freeze({ ...fail('REDIRECT'), receipt: receipt('REDIRECT') });
      if (!response.ok) return Object.freeze({ ...fail('TRANSPORT'), receipt: receipt('TRANSPORT', response) });
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > 262_144)) return Object.freeze({ ...fail('OVERSIZE'), receipt: receipt('OVERSIZE', response) });
      const reader = response.body?.getReader();
      if (!reader) return Object.freeze({ ...fail('INVALID_REPLY'), receipt: receipt('INVALID_REPLY', response) });
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const next = await reader.read();
          if (controller.signal.aborted) return Object.freeze({ ...fail('DEADLINE'), receipt: receipt('DEADLINE', response) });
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 262_144) { void reader.cancel().catch(() => {}); return Object.freeze({ ...fail('OVERSIZE'), receipt: receipt('OVERSIZE', response) }); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      if (controller.signal.aborted || now() >= end) return Object.freeze({ ...fail('DEADLINE'), receipt: receipt('DEADLINE', response) });
      if (!validSnapshot(snapshot, now()) || !config.is_current!(snapshot)) return Object.freeze({ ...fail('STALE'), receipt: receipt('STALE', response) });
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!plainJson(body)) return Object.freeze({ ...fail('INVALID_REPLY'), receipt: receipt('INVALID_REPLY', response) });
      const value = parse(body, response);
      if (value === null) return Object.freeze({ ...fail('INVALID_REPLY'), receipt: receipt('INVALID_REPLY', response) });
      return freeze({ ok: true as const, value, receipt: receipt('accepted', response) });
      } finally { config.budget!.release(); }
    };
    const deadline = new Promise<Result<T>>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(Object.freeze({ ...fail('DEADLINE'), receipt: receipt('DEADLINE') })); }, config.deadline_ms!);
    });
    return await Promise.race([operation(), deadline]);
  } catch {
    return Object.freeze({ ...fail(controller.signal.aborted ? 'DEADLINE' : 'INVALID_REPLY'), receipt: receipt(controller.signal.aborted ? 'DEADLINE' : 'INVALID_REPLY') });
  } finally { if (timer) clearTimeout(timer); }
}
