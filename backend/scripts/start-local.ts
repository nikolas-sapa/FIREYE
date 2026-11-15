import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLocalDemoSeed, readLocalDemoConfig } from '../config/local-demo.ts';
import type { LocalDemoConfig } from '../config/local-demo.ts';
import { startLocalBridge } from '../integration/local-http.ts';
import type { FixtureSession } from '../integration/local-http.ts';
import { createBridgeAuthority } from '../integration/session.ts';
import type { BridgeAuthority, TrustedClock } from '../integration/session.ts';
import type { ActorContext, IncidentSeed } from '../protocol/types.ts';

export type LocalRole = 'reader' | 'chief' | 'analyst' | 'producer';
export interface LocalRoleSetup {
  readonly principal_id: string;
  readonly capability: string;
}
export interface LocalSetup {
  readonly mode: 'EXERCISE';
  readonly expires_at: string;
  readonly roles: Readonly<Record<LocalRole, LocalRoleSetup>>;
}
export interface LocalBackend {
  readonly url: string;
  readonly incident_id: string;
  readonly run_id: string;
  readonly allowed_origin: string;
  /** Internal only, never send or bundle as a crew DTO. */
  readonly authority: BridgeAuthority;
  /** Private local role handoff only, never stdout, URL parameters or repository files. */
  readonly setup: LocalSetup;
  close(): Promise<void>;
}

/** Importing this module never opens a listener, writes files or starts work. */
export async function startLocalBackend(config: LocalDemoConfig = readLocalDemoConfig(),
  clock?: () => TrustedClock, seed: IncidentSeed = createLocalDemoSeed()): Promise<LocalBackend> {
  // Revalidate programmatic configuration before any listener or capability creation.
  const valid = readLocalDemoConfig({ FCC_LOCAL_MODE: config.mode, FCC_LOCAL_PROVIDERS: config.providers,
    FCC_LOCAL_PORT: String(config.port), FCC_LOCAL_ORIGIN: config.allowed_origin,
    FCC_LOCAL_CAPABILITY_TTL_MS: String(config.capability_ttl_ms) });
  const epoch = Date.now(); const started = performance.now();
  const trustedClock = clock ?? (() => {
    const elapsed = Math.floor(performance.now() - started);
    return { received_at: new Date(epoch + elapsed).toISOString(), sim_tick: Math.floor(elapsed / 1000) };
  });
  const created = createBridgeAuthority(seed, trustedClock);
  if (!created.ok) throw new Error('Local exercise authority could not initialize');
  const authority = created.value;
  const expires_at = new Date(Date.parse(authority.now().received_at) + valid.capability_ttl_ms).toISOString();
  const sessions = new Map<string, FixtureSession>();
  const role = (name: LocalRole, actor_kind: ActorContext['actor_kind'], principal_id: string): LocalRoleSetup => {
    const capability = randomBytes(24).toString('base64url');
    sessions.set(capability, { expires_at, actor: { principal_id, session_id: `${seed.run_id}:${name}`,
      incident_id: seed.incident_id, run_id: seed.run_id, actor_kind,
      chief_epoch: name === 'chief' ? seed.chief_epoch : null,
      producer_id: name === 'producer' ? seed.producer_id : null,
      capture_epoch: name === 'producer' ? seed.capture_epoch : null } });
    return Object.freeze({ principal_id, capability });
  };
  const roles = Object.freeze({ reader: role('reader', 'fixture', 'exercise-reader'),
    chief: role('chief', 'human', seed.chief_id), analyst: role('analyst', 'analyst', 'exercise-analyst'),
    producer: role('producer', 'simulator', seed.producer_id) });
  const bridge = await startLocalBridge(authority, { port: valid.port, allowed_origin: valid.allowed_origin,
    fixture_sessions: sessions });
  return Object.freeze({ url: bridge.url, incident_id: seed.incident_id, run_id: seed.run_id,
    allowed_origin: valid.allowed_origin, authority, setup: Object.freeze({ mode: 'EXERCISE', expires_at, roles }),
    close: () => bridge.close() });
}

async function runCli(): Promise<void> {
  let backend: LocalBackend | undefined;
  let demoObjective: { readonly objective_id: string; readonly created_at_sim_tick: number } | undefined;
  let privateDirectory: string | undefined;
  let capabilityFile: string | undefined;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (backend) await backend.close();
      if (capabilityFile) await unlink(capabilityFile);
      if (privateDirectory) await rmdir(privateDirectory);
    })();
    return stopping;
  };
  const signal = () => { void stop().catch(() => { process.exitCode = 1; }); };
  try {
    const demo = process.argv.length === 3 && process.argv[2] === '--demo';
    if (process.argv.length !== 2 && !demo) throw new TypeError('Unexpected launcher arguments');
    if (demo) {
      const config = readLocalDemoConfig();
      const { startDemoService } = await import('../demo/service.ts');
      const service = await startDemoService({ port: config.port, allowed_origin: config.allowed_origin,
        capability_ttl_ms: config.capability_ttl_ms });
      backend = service; demoObjective = service.scenario.objective;
    } else backend = await startLocalBackend();
    const scratch = join(dirname(fileURLToPath(import.meta.url)), '..', '.scratch');
    await mkdir(scratch, { recursive: true, mode: 0o700 });
    privateDirectory = await mkdtemp(join(scratch, 'local-demo-'));
    capabilityFile = join(privateDirectory, 'capabilities.json');
    await writeFile(capabilityFile, JSON.stringify({ url: backend.url, incident_id: backend.incident_id,
      run_id: backend.run_id, allowed_origin: backend.allowed_origin, ...backend.setup }), { flag: 'wx', mode: 0o600 });
    process.once('SIGINT', signal); process.once('SIGTERM', signal);
    const entry_sha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
    process.stdout.write(`${JSON.stringify({ ready: true, mode: 'EXERCISE', providers: 'disabled', pid: process.pid,
      ...(demo ? { service: 'orchestration-demo', orchestration: 'enabled', provenance: 'seeded-fixture',
        objective_id: demoObjective?.objective_id, created_at_sim_tick: demoObjective?.created_at_sim_tick } : {}),
      entry_sha256, url: backend.url, incident_id: backend.incident_id, run_id: backend.run_id,
      allowed_origin: backend.allowed_origin, expires_at: backend.setup.expires_at, capabilities_file: capabilityFile,
      chief_id: backend.setup.roles.chief.principal_id, producer_id: backend.setup.roles.producer.principal_id })}\n`);
  } catch {
    process.exitCode = 1;
    try { await stop(); } catch { /* No private values or raw failure details in diagnostics. */ }
    process.stderr.write('Local EXERCISE backend failed to start or close. Check configuration and port.\n');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runCli();
}
