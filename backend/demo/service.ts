import { createServer, request as httpRequest } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readLocalDemoConfig } from '../config/local-demo.ts';
import { startLocalBridge } from '../integration/local-http.ts';
import type { FixtureSession } from '../integration/local-http.ts';
import { createBridgeAuthority } from '../integration/session.ts';
import type { TrustedClock } from '../integration/session.ts';
import { createExerciseCoordinator } from '../orchestration/coordinator.ts';
import { closed, plainJson } from '../integrations/receipts.ts';
import type { LocalRole, LocalSetup } from '../scripts/start-local.ts';
import { createDemoScenario, demoActor, initializeDemoScenario } from './scenario.ts';

export interface DemoServiceOptions {
  readonly port?: number;
  readonly allowed_origin?: string;
  readonly capability_ttl_ms?: number;
  readonly clock?: () => TrustedClock;
}
const LIMIT = 64 * 1024;
const failures = new WeakSet<object>();
function failure(status: number, code: string, reason: string) {
  const value = Object.freeze({ status, code, reason }); failures.add(value); return value;
}
function send(response: ServerResponse, status: number, body: unknown): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }); response.end(JSON.stringify(body));
}
async function body(request: IncomingMessage): Promise<unknown> {
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > LIMIT)) {
    request.resume(); throw failure(413, 'BODY_LIMIT', 'Request exceeds 64 KiB');
  }
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += bytes.length;
    if (length > LIMIT) { request.resume(); throw failure(413, 'BODY_LIMIT', 'Request exceeds 64 KiB'); }
    chunks.push(bytes);
  }
  if (request.headers['content-type'] !== 'application/json') throw failure(400, 'INVALID_SCHEMA', 'Expected application/json');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw failure(400, 'INVALID_SCHEMA', 'Expected valid JSON'); }
}

/** Inert on import. Explicit fixture startup, providers disabled, no synthetic executor. */
export async function startDemoService(options: DemoServiceOptions = {}) {
  const config = readLocalDemoConfig({ FCC_LOCAL_PORT: String(options.port ?? 8787),
    FCC_LOCAL_ORIGIN: options.allowed_origin ?? 'http://localhost:5173',
    FCC_LOCAL_CAPABILITY_TTL_MS: String(options.capability_ttl_ms ?? 600_000) });
  const epoch = Date.now(); const started = performance.now();
  const clock = options.clock ?? (() => {
    const elapsed = Math.floor(performance.now() - started);
    return { received_at: new Date(epoch + elapsed).toISOString(), sim_tick: 1 + Math.floor(elapsed / 1000) };
  });
  const initial = clock(); const scenario = createDemoScenario(initial);
  // Clock switches after immutable seed/received fixture setup; no hidden producer tick.
  let ready = false;
  const real = createBridgeAuthority(scenario.seed, () => ready ? clock() : initial);
  if (!real.ok) throw new TypeError('Demo authority invalid');
  const shared = real.value; initializeDemoScenario(shared, scenario); ready = true;
  const coordinator = createExerciseCoordinator(shared, { analyst: demoActor(scenario.seed, 'analyst'),
    layout: scenario.layout, reviewed_courses: scenario.reviewed_courses });
  const expires_at = new Date(Date.parse(initial.received_at) + config.capability_ttl_ms).toISOString();
  const sessions = new Map<string, FixtureSession>();
  const roles = {} as Record<LocalRole, { principal_id: string; capability: string }>;
  for (const role of ['reader', 'chief', 'analyst', 'producer'] as const) {
    const actor = role === 'producer' || role === 'analyst' ? demoActor(scenario.seed, role) : {
      principal_id: role === 'chief' ? scenario.seed.chief_id : 'exercise-reader', session_id: `${scenario.seed.run_id}:${role}`,
      incident_id: scenario.seed.incident_id, run_id: scenario.seed.run_id, actor_kind: role === 'chief' ? 'human' as const : 'fixture' as const,
      chief_epoch: role === 'chief' ? 1 : null, producer_id: null, capture_epoch: null };
    const capability = randomBytes(24).toString('base64url');
    sessions.set(capability, { actor, expires_at }); roles[role] = Object.freeze({ principal_id: actor.principal_id, capability });
  }
  const setup: LocalSetup = Object.freeze({ mode: 'EXERCISE', expires_at, roles: Object.freeze(roles) });
  const bridge = await startLocalBridge(shared, { port: 0, allowed_origin: config.allowed_origin, fixture_sessions: sessions });
  let host = ''; let closing = false;
  const windows = new Map<string, { start: number; attempts: number }>();
  function authenticate(request: IncomingMessage): FixtureSession {
    const header = request.headers.authorization;
    const session = sessions.get(typeof header === 'string' && /^Bearer [^\s]+$/.test(header) ? header.slice(7) : '');
    if (!session || Date.parse(session.expires_at) <= Date.parse(shared.now().received_at)) {
      throw failure(401, 'UNAUTHENTICATED', 'Missing or expired local fixture capability');
    }
    return session;
  }
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    for (const key of ['host', 'origin', 'authorization', 'content-type']) {
      if (request.rawHeaders.filter((value, n) => n % 2 === 0 && value.toLowerCase() === key).length > 1) {
        throw failure(400, 'INVALID_SCHEMA', 'Repeated security header');
      }
    }
    if (request.headers.host !== host || request.headers.origin !== config.allowed_origin) throw failure(403, 'FORBIDDEN_ORIGIN', 'Exact loopback Host and Origin required');
    response.setHeader('Access-Control-Allow-Origin', config.allowed_origin); response.setHeader('Vary', 'Origin');
    if (closing) throw failure(503, 'CLOSED', 'Local demo closing');
    if (!request.url?.startsWith('/') || request.url.startsWith('//')) throw failure(400, 'INVALID_SCHEMA', 'Relative resource required');
    const url = new URL(request.url, `http://${host}`);
    const match = /^\/incidents\/([^/]+)\/(objectives|assessments|reviews|chief-decisions)$/.exec(url.pathname);
    if (!match) {
      if (!/^\/incidents\/[^/]+\/(snapshot|events|approvals|commands|command-checks|producer-heartbeats)$/.test(url.pathname)) {
        throw failure(404, 'NOT_FOUND', 'Unknown local resource');
      }
      // Fixed private destination only. Existing bridge validates its own canonical paths/body/roles.
      const forwarded = httpRequest(`${bridge.url}${request.url}`, { method: request.method,
        headers: { ...request.headers, host: new URL(bridge.url).host }, timeout: 10_000 }, upstream => {
        response.writeHead(upstream.statusCode ?? 502, upstream.headers); upstream.pipe(response);
      });
      forwarded.on('timeout', () => forwarded.destroy());
      forwarded.on('error', () => send(response, 502, { error: { code: 'BRIDGE_UNAVAILABLE', reason: 'Canonical bridge unavailable' } }));
      response.on('close', () => forwarded.destroy()); request.pipe(forwarded); return;
    }
    if (match[1] !== scenario.seed.incident_id) throw failure(404, 'NOT_FOUND', 'Unknown exercise');
    if (url.search) throw failure(400, 'INVALID_SCHEMA', 'Unexpected query');
    if (request.method === 'OPTIONS') {
      if (!['GET', 'POST'].includes(String(request.headers['access-control-request-method']))
        || typeof request.headers['access-control-request-headers'] !== 'string'
        || request.headers['access-control-request-headers'].split(',').some(key => !['authorization', 'content-type'].includes(key.trim().toLowerCase()))) {
        throw failure(403, 'FORBIDDEN_PREFLIGHT', 'Unexpected preflight');
      }
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST'); response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.writeHead(204); response.end(); return;
    }
    const session = authenticate(request); const resource = match[2];
    if (request.method !== (resource === 'assessments' ? 'GET' : 'POST')) throw failure(405, 'METHOD_NOT_ALLOWED', 'Unexpected method');
    if (resource === 'assessments') {
      if (request.headers['transfer-encoding'] || Number(request.headers['content-length'] ?? '0') !== 0) throw failure(400, 'INVALID_SCHEMA', 'GET body forbidden');
      shared.expireProducer(); send(response, 200, { data: coordinator.read() }); return;
    }
    const role = session.actor.actor_kind;
    if (resource === 'chief-decisions' ? role !== 'human' : role !== 'analyst' && role !== 'human') throw failure(403, 'UNAUTHORIZED', 'Required local fixture role missing');
    const chief = (actor: FixtureSession['actor']) => actor.actor_kind !== 'human'
      || actor.principal_id === shared.read().chief_id && actor.chief_epoch === shared.read().chief_epoch;
    if (!chief(session.actor)) throw failure(403, 'UNAUTHORIZED', 'Current Chief fixture required');
    const now = Date.parse(shared.now().received_at); const key = session.actor.session_id;
    let window = windows.get(key);
    if (!window || now - window.start >= 60_000) { window = { start: now, attempts: 0 }; windows.set(key, window); }
    if (++window.attempts > 60) throw failure(429, 'RATE_LIMIT', '60 local mutations per minute');
    const input = await body(request); const current = authenticate(request);
    if (response.destroyed || response.writableEnded || closing) throw failure(408, 'DEADLINE', 'Request no longer active');
    if (!chief(current.actor)) throw failure(403, 'UNAUTHORIZED', 'Current Chief fixture required');
    const expired = shared.expireProducer(); if (!expired.ok) throw failure(409, expired.code, expired.reason);
    let result;
    if (resource === 'objectives') result = await coordinator.assess(input);
    else {
      const keys = resource === 'reviews' ? ['assessment_id', 'option_id'] : ['assessment_id', 'approval_id'];
      if (!plainJson(input) || !closed(input, keys) || !keys.every(key => typeof input[key] === 'string' && input[key].length > 0 && input[key].length <= 128)) throw failure(400, 'INVALID_SCHEMA', 'Closed local decision required');
      result = resource === 'reviews' ? coordinator.commitReview(input.assessment_id as string, input.option_id as string)
        : coordinator.approve(input.assessment_id as string, input.approval_id as string, current.actor);
    }
    authenticate(request);
    coordinator.refresh();
    if (result.ok && resource === 'objectives') {
      const fresh = coordinator.read().assessments.find(row => row.assessment_id === result.value.assessment_id);
      if (!fresh || fresh.status === 'superseded') throw failure(409, 'STALE_VERSION', 'Assessment superseded before response');
      send(response, 200, { data: fresh });
    } else if (result.ok) send(response, 200, { data: result.value });
    else throw failure(result.code === 'INVALID_SCHEMA' ? 400 : result.code === 'UNAUTHORIZED' ? 403 : 409, result.code, result.reason);
  }
  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 10_000, headersTimeout: 10_000 }, (request, response) => {
    const deadline = setTimeout(() => { send(response, 408, { error: { code: 'DEADLINE', reason: '10 second local deadline' } }); request.destroy(); }, 10_000);
    response.once('close', () => clearTimeout(deadline));
    void handle(request, response).catch(error => {
      const known = error !== null && typeof error === 'object' && failures.has(error)
        ? error as ReturnType<typeof failure> : undefined;
      send(response, known?.status ?? 500,
        { error: { code: known?.code ?? 'INTERNAL_ERROR', reason: known?.reason ?? 'Local demo request failed' } });
    });
  });
  server.maxConnections = 64;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  } catch (error) { await bridge.close(); throw error; }
  const address = server.address(); if (!address || typeof address === 'string') { await bridge.close(); throw new TypeError('Loopback unavailable'); }
  host = `127.0.0.1:${address.port}`;
  let stopped: Promise<void> | undefined;
  return Object.freeze({ url: `http://${host}`, incident_id: scenario.seed.incident_id, run_id: scenario.seed.run_id,
    allowed_origin: config.allowed_origin, authority: shared, setup, scenario, close(): Promise<void> {
      if (stopped) return stopped; closing = true;
      stopped = Promise.all([bridge.close(), new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
      })]).then(() => undefined); return stopped;
    } });
}
