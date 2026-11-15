import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { types } from 'node:util';
import type { ActorContext } from '../protocol/types.ts';
import { createReceivedView } from './received-view.ts';
import type { BridgeAuthority, BridgeResult } from './session.ts';

export interface FixtureSession {
  readonly actor: ActorContext;
  readonly expires_at: string;
}

export interface LocalBridgeOptions {
  readonly port: number;
  readonly allowed_origin: string;
  readonly fixture_sessions: ReadonlyMap<string, FixtureSession>;
}

interface HttpFailure { readonly status: number; readonly code: string; readonly reason: string }
interface Poll { readonly finish: () => void; readonly cancel: () => void }
const fail = (status: number, code: string, reason: string): HttpFailure => ({ status, code, reason });
const BODY_LIMIT = 64 * 1024;
const MAX_POLLS = 16;
const MAX_MUTATIONS = 60;
const SESSION_TTL_MS = 30 * 60 * 1000;

function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === (value.length === 20 ? `${value.slice(0, -1)}.000Z` : value);
}

function status(code: string): number {
  if (code === 'UNAUTHORIZED') return 403;
  if (code === 'INVALID_SCHEMA' || code === 'INVALID_TIME' || code === 'VERSION_MISMATCH') return 400;
  if (code === 'LIMIT_REACHED') return 503;
  return 409;
}

function fixtureActor(value: unknown, authority: BridgeAuthority): value is ActorContext {
  const keys = ['principal_id', 'session_id', 'incident_id', 'run_id', 'actor_kind', 'chief_epoch', 'producer_id', 'capture_epoch'];
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || !ownKeys.every(key => typeof key === 'string' && keys.includes(key)
    && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'))) return false;
  const actor = value as ActorContext;
  const id = (input: unknown): input is string => typeof input === 'string' && input.length >= 1 && input.length <= 128 && input.trim().length > 0;
  const integer = (input: unknown): input is number => typeof input === 'number' && Number.isSafeInteger(input) && input >= 0;
  return [actor.principal_id, actor.session_id, actor.incident_id, actor.run_id].every(id)
    && ['human', 'simulator', 'analyst', 'fixture'].includes(actor.actor_kind)
    && (actor.chief_epoch === null || integer(actor.chief_epoch)) && (actor.producer_id === null || id(actor.producer_id))
    && (actor.capture_epoch === null || integer(actor.capture_epoch))
    && actor.incident_id === authority.read().incident_id && actor.run_id === authority.read().run_id;
}

function send(response: ServerResponse, statusCode: number, body?: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(statusCode, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function failure(response: ServerResponse, error: HttpFailure): void {
  send(response, error.status, { error: { code: error.code, reason: error.reason } });
}

async function body(request: IncomingMessage, empty: boolean): Promise<unknown> {
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > BODY_LIMIT)) {
    request.resume(); throw fail(413, 'BODY_LIMIT', 'Request exceeds 64 KiB');
  }
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > BODY_LIMIT) {
      // Do not destroy the socket before the 413 response can be delivered.
      request.resume(); throw fail(413, 'BODY_LIMIT', 'Request exceeds 64 KiB');
    }
    chunks.push(bytes);
  }
  if (empty) {
    if (length !== 0) throw fail(400, 'INVALID_SCHEMA', 'Expected an empty body');
    return null;
  }
  if (request.headers['content-type'] !== 'application/json') throw fail(400, 'INVALID_SCHEMA', 'Expected application/json');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
  catch { throw fail(400, 'INVALID_SCHEMA', 'Expected valid JSON'); }
}

function query(url: URL, snapshot: boolean): { after?: number; wait: number; cutoff?: string } {
  const allowed = snapshot ? ['after_revision', 'wait_ms', 'received_at'] : [];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) throw fail(400, 'INVALID_SCHEMA', 'Unexpected or repeated query field');
  }
  const number = (key: string, maximum: number): number | undefined => {
    const value = url.searchParams.get(key);
    if (value === null) return undefined;
    if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) {
      throw fail(400, 'INVALID_SCHEMA', 'Invalid snapshot revision or wait bound');
    }
    return Number(value);
  };
  const after = number('after_revision', Number.MAX_SAFE_INTEGER);
  const wait = number('wait_ms', 10_000) ?? 0;
  const cutoff = url.searchParams.get('received_at') ?? undefined;
  if (cutoff !== undefined && (!utc(cutoff) || after !== undefined || url.searchParams.has('wait_ms'))) {
    throw fail(400, 'INVALID_TIME', 'Historical receipt cutoff must be valid UTC and cannot poll');
  }
  if (wait > 0 && after === undefined) throw fail(400, 'INVALID_SCHEMA', 'Polling requires after_revision');
  return { after, wait, cutoff };
}

export async function startLocalBridge(authority: BridgeAuthority, options: LocalBridgeOptions): Promise<{
  readonly url: string;
  close(): Promise<void>;
}> {
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535) throw new TypeError('Invalid diagnostic port');
  const configuredOrigin = new URL(options.allowed_origin);
  const allowedOrigin = options.allowed_origin;
  if (configuredOrigin.origin !== options.allowed_origin || configuredOrigin.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(configuredOrigin.hostname)) throw new TypeError('Expected an exact loopback HTTP origin');
  const initialTime = authority.now().received_at;
  const sessions = new Map<string, FixtureSession>();
  for (const [credential, session] of options.fixture_sessions) {
    if (!credential || credential.length > 256 || /\s/.test(credential) || !utc(session.expires_at)
      || Date.parse(session.expires_at) - Date.parse(initialTime) > SESSION_TTL_MS) throw new TypeError('Invalid fixture session lifetime');
    const actor = session.actor;
    if (!fixtureActor(actor, authority)) {
      throw new TypeError('Invalid fixture exercise member');
    }
    sessions.set(credential, Object.freeze({ actor: Object.freeze({ ...actor }), expires_at: session.expires_at }));
  }
  const windows = new Map<string, { start: number; attempts: number }>();
  const polls = new Set<Poll>();
  let host = ''; let closing = false; let unhealthy = false;

  function authenticate(request: IncomingMessage): FixtureSession {
    const header = request.headers.authorization;
    const token = typeof header === 'string' && /^Bearer [^\s]+$/.test(header) ? header.slice(7) : '';
    const session = sessions.get(token);
    const time = Date.parse(authority.now().received_at);
    if (!session || Date.parse(session.expires_at) <= time) throw fail(401, 'UNAUTHENTICATED', 'Missing or expired fixture capability');
    return session;
  }

  function mutation(session: FixtureSession): void {
    const time = Date.parse(authority.now().received_at);
    let window = windows.get(session.actor.session_id);
    if (!window || time - window.start >= 60_000) {
      window = { start: time, attempts: 0 }; windows.set(session.actor.session_id, window);
    }
    window.attempts++;
    if (window.attempts > MAX_MUTATIONS) throw fail(429, 'RATE_LIMIT', '60 mutation attempts per fixture session per minute');
  }

  function view(response: ServerResponse, cutoff?: string): void {
    const state = authority.read();
    const result = createReceivedView(state, cutoff ?? state.log.at(-1)?.received_at ?? initialTime);
    if (!result.ok) failure(response, fail(status(result.code), result.code, result.reason));
    else send(response, 200, { data: result.value });
  }

  function result<T>(response: ServerResponse, value: BridgeResult<T>, projection: boolean): void {
    if (!value.ok) failure(response, fail(status(value.code), value.code, value.reason));
    else if (projection) view(response);
    else send(response, 200, { data: value.value });
  }

  function boundary(request: IncomingMessage, response: ServerResponse): URL {
    for (const key of ['host', 'origin', 'authorization', 'content-type']) {
      if (request.rawHeaders.filter((_, n) => n % 2 === 0 && request.rawHeaders[n].toLowerCase() === key).length > 1) {
        throw fail(400, 'INVALID_SCHEMA', 'Repeated security header');
      }
    }
    if (request.headers.host !== host || request.headers.origin !== allowedOrigin) {
      throw fail(403, 'FORBIDDEN_ORIGIN', 'Exact diagnostic Host and Origin required');
    }
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Vary', 'Origin');
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) throw fail(400, 'INVALID_SCHEMA', 'Expected a relative resource URL');
    return new URL(request.url, `http://${host}`);
  }

  function poll(request: IncomingMessage, response: ServerResponse, after: number, wait: number): void {
    if (polls.size >= MAX_POLLS) throw fail(429, 'POLL_LIMIT', '16 pending polls maximum');
    const deadline = setTimeout(() => finish(true), wait);
    const entry: Poll = { finish: () => finish(false), cancel: () => {
      cleanup(); failure(response, fail(503, 'CLOSED', 'Diagnostic server closing'));
    } };
    function cleanup(): void { clearTimeout(deadline); polls.delete(entry); response.off('close', cleanup); }
    function finish(timeout: boolean): void {
      if (!timeout && authority.read().incident_revision <= after && !unhealthy) return;
      cleanup();
      try {
        authenticate(request);
        if (unhealthy) throw fail(503, 'CLOCK_UNAVAILABLE', 'Trusted diagnostic clock unavailable');
        if (authority.read().incident_revision > after) view(response);
        else send(response, 204);
      } catch (error) { handleFailure(response, error); }
    }
    polls.add(entry); response.on('close', cleanup);
  }

  function handleFailure(response: ServerResponse, error: unknown): void {
    const value = error as Partial<HttpFailure> | null;
    if (value && typeof value.status === 'number' && typeof value.code === 'string' && typeof value.reason === 'string') {
      failure(response, value as HttpFailure);
    } else failure(response, fail(500, 'INTERNAL_ERROR', 'Diagnostic request failed'));
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = boundary(request, response);
    if (closing || unhealthy) throw fail(503, 'UNAVAILABLE', 'Diagnostic authority unavailable');
    const match = /^\/incidents\/([^/]+)\/(snapshot|events|approvals|commands|command-checks|producer-heartbeats)$/.exec(url.pathname);
    if (!match || match[1] !== authority.read().incident_id) throw fail(404, 'NOT_FOUND', 'Exercise resource not found');
    const resource = match[2];
    if (request.method === 'OPTIONS') {
      const method = request.headers['access-control-request-method'];
      const headers = request.headers['access-control-request-headers'];
      if (!['GET', 'POST'].includes(typeof method === 'string' ? method : '') || typeof headers !== 'string'
        || headers.split(',').some(key => !['authorization', 'content-type'].includes(key.trim().toLowerCase()))) {
        throw fail(403, 'FORBIDDEN_PREFLIGHT', 'Unexpected preflight method or headers');
      }
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      send(response, 204); return;
    }
    const session = authenticate(request);
    const parameters = query(url, resource === 'snapshot');
    const get = resource === 'snapshot' || resource === 'commands';
    if (request.method !== (get ? 'GET' : 'POST')) throw fail(405, 'METHOD_NOT_ALLOWED', 'Unexpected resource method');
    if (get) {
      if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? '0') !== 0) {
        request.resume(); throw fail(400, 'INVALID_SCHEMA', 'GET requests cannot carry bodies');
      }
      const expired = authority.expireProducer();
      if (!expired.ok) { result(response, expired, false); return; }
      if (resource === 'commands') { result(response, authority.pending(session.actor), false); return; }
      if (parameters.after !== undefined && parameters.after > authority.read().incident_revision) throw fail(409, 'CONFLICT', 'Client revision exceeds exercise authority');
      if (parameters.after !== undefined && parameters.after === authority.read().incident_revision) {
        if (parameters.wait > 0) poll(request, response, parameters.after, parameters.wait);
        else send(response, 204);
      } else view(response, parameters.cutoff);
      return;
    }
    mutation(session);
    const actor = session.actor;
    const state = authority.read();
    if (resource === 'approvals' && (actor.actor_kind !== 'human' || actor.principal_id !== state.chief_id
      || actor.chief_epoch !== state.chief_epoch)) throw fail(403, 'UNAUTHORIZED', 'Current Chief fixture required');
    if (['command-checks', 'producer-heartbeats'].includes(resource) && (actor.actor_kind !== 'simulator'
      || actor.principal_id !== state.producer_id || actor.producer_id !== state.producer_id
      || actor.capture_epoch !== state.capture_epoch)) throw fail(403, 'UNAUTHORIZED', 'Current producer fixture required');
    const input = await body(request, resource === 'producer-heartbeats');
    // Capability lifetime checked again after slow body read, before any synchronous mutation.
    const current = authenticate(request);
    if (resource === 'events') result(response, authority.ingest(input, current.actor), true);
    else if (resource === 'approvals') result(response, authority.approve(input, current.actor), true);
    else if (resource === 'command-checks') result(response, authority.check(input, current.actor), false);
    else result(response, authority.heartbeat(current.actor), false);
    for (const entry of polls) entry.finish();
  }

  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 10_000, headersTimeout: 10_000 },
    (request, response) => { void handle(request, response).catch(error => handleFailure(response, error)); });
  server.maxConnections = 64;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback address unavailable');
  host = `127.0.0.1:${address.port}`;
  const timer = setInterval(() => {
    try { if (!authority.expireProducer().ok) unhealthy = true; }
    catch { unhealthy = true; }
    for (const entry of polls) entry.finish();
  }, 250);
  timer.unref();
  let closed: Promise<void> | undefined;
  return Object.freeze({ url: `http://${host}`, close() {
    if (closed) return closed;
    closing = true; clearInterval(timer);
    for (const entry of polls) entry.cancel();
    closed = new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    return closed;
  } });
}
