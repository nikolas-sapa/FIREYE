import { randomUUID } from 'node:crypto';
import type { IncidentSeed } from '../protocol/types.ts';

export interface LocalDemoConfig {
  readonly mode: 'EXERCISE';
  readonly providers: 'disabled';
  readonly port: number;
  readonly allowed_origin: string;
  readonly capability_ttl_ms: number;
  readonly task_ttl_s?: number;
}

/** Only these local variables are read. Provider keys never enter this configuration. */
export function readLocalDemoConfig(environment: Readonly<Record<string, string | undefined>> = process.env): LocalDemoConfig {
  const integer = (key: string, fallback: number, minimum: number, maximum: number): number => {
    const value = environment[key];
    if (value === undefined) return fallback;
    if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))
      || Number(value) < minimum || Number(value) > maximum) throw new TypeError(`Invalid ${key}`);
    return Number(value);
  };
  if (environment.FCC_LOCAL_MODE !== undefined && environment.FCC_LOCAL_MODE !== 'EXERCISE') {
    throw new TypeError('Local mode must be EXERCISE');
  }
  if (environment.FCC_LOCAL_PROVIDERS !== undefined && environment.FCC_LOCAL_PROVIDERS !== 'disabled') {
    throw new TypeError('Providers must remain disabled');
  }
  if (environment.FCC_LOCAL_HOST !== undefined && environment.FCC_LOCAL_HOST !== '127.0.0.1') {
    throw new TypeError('Local host must be 127.0.0.1');
  }
  const origin = environment.FCC_LOCAL_ORIGIN ?? 'http://localhost:5173';
  let url: URL;
  try { url = new URL(origin); } catch { throw new TypeError('Invalid local origin'); }
  if (url.origin !== origin || url.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new TypeError('Expected an exact loopback HTTP origin');
  return Object.freeze({ mode: 'EXERCISE', providers: 'disabled',
    port: integer('FCC_LOCAL_PORT', 8787, 0, 65535), allowed_origin: origin,
    ...(environment.FCC_LOCAL_TASK_TTL_S === undefined ? {} : { task_ttl_s: integer('FCC_LOCAL_TASK_TTL_S', 120, 1, 7200) }),
    capability_ttl_ms: integer('FCC_LOCAL_CAPABILITY_TTL_MS', 600_000, 1, 1_800_000) });
}

/** New disposable run, declared metadata only. No observations, movement or live model answers. */
export function createLocalDemoSeed(taskTtlS = 120): IncidentSeed {
  if (!Number.isSafeInteger(taskTtlS) || taskTtlS < 1 || taskTtlS > 7200) throw new TypeError('Invalid local task TTL');
  const run = randomUUID();
  const producer = `exercise-producer:${run}`;
  const drones = [1, 2, 3, 4, 5, 6];
  return {
    contract_version: 'backend-protocol.v1', incident_id: 'exercise-local', run_id: `run:${run}`,
    authority_epoch: 1, incident_revision: 0, input_revision: 0, plan_revision: 0, reservation_revision: 0,
    chief_id: `exercise-chief:${run}`, chief_epoch: 1, producer_id: producer, capture_epoch: 1, authority_active: true,
    assets: drones.map(n => ({ asset_id: `d${n}`, capabilities: ['thermal'], thermal_feed_id: `t${n}` })),
    feeds: drones.map(n => ({ feed_id: `t${n}`, asset_id: `d${n}`, modality: 'thermal',
      source_kind: 'simulated', synthetic: true, radiometric: false, calibration: null,
      source_id: `exercise-source:d${n}`, source_revision: 0, capture_owner_id: producer,
      capture_epoch: 1, status: 'available' })),
    candidates: drones.map(n => ({ candidate_id: `c${n}`, action_id: 'inspect', asset_id: `d${n}`,
      mission_id: `m${n}`, mission_version: 1, route_id: `declared-route${n}`, plan_revision: 0,
      feasibility_snapshot_id: `exercise-fixture${n}`, feasible: true, expires_at_sim_tick: taskTtlS })),
  };
}
