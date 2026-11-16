import { types } from 'node:util';
import { generateMissionCandidates } from './mission-candidates.ts';
import type { MissionPlanningContext, ProposedMissionAssignment } from './mission-types.ts';
import type { ActorContext, Result } from '../protocol/types.ts';

export interface CandidateMapping {
  readonly candidate_id: string;
  readonly route_id: string;
  readonly mission_id: string;
  readonly drone_id: string;
  readonly asset_id: string;
}

export interface RegistrationRequest {
  readonly run_id: string;
  readonly input_revision: number;
  readonly candidate_id: string;
  readonly route_id: string;
  readonly mission_id: string;
  readonly asset_id: string;
  readonly decision: 'approve';
}

export interface RegistrationInputs {
  readonly snapshot: unknown;
  readonly context: unknown;
  readonly known_asset_ids: readonly string[];
  readonly mappings: readonly CandidateMapping[];
}

export interface ReviewedProposal {
  readonly identity: RegistrationRequest;
  readonly proposal: ProposedMissionAssignment;
  readonly reviewer_id: string;
  readonly reviewer_session_id: string;
  readonly incident_id: string;
  readonly executable: false;
  readonly status: 'reviewed_proposal';
  readonly eligible: boolean;
}

export interface CandidateRegistry {
  readonly run_id: string | null;
  readonly input_revision: number | null;
  readonly entries: readonly ReviewedProposal[];
}

export type RegistrationEvent =
  | { readonly kind: 'current'; readonly inputs: RegistrationInputs }
  | { readonly kind: 'registered'; readonly request: RegistrationRequest; readonly actor: ActorContext }
  | { readonly kind: 'repeated'; readonly request: RegistrationRequest; readonly actor: ActorContext }
  | { readonly kind: 'rejected'; readonly code: string; readonly reason: string };

const requestKeys = ['run_id', 'input_revision', 'candidate_id', 'route_id', 'mission_id', 'asset_id', 'decision'];
const mappingKeys = ['candidate_id', 'route_id', 'mission_id', 'drone_id', 'asset_id'];
const actorKeys = ['principal_id', 'session_id', 'incident_id', 'run_id', 'actor_kind', 'chief_epoch', 'producer_id', 'capture_epoch'];
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 128 && v.trim().length > 0;
const revision = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const closed = (v: unknown, keys: readonly string[]): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));

function json(v: unknown, active = new WeakSet<object>(), budget = { nodes: 0 }, depth = 0): boolean {
  if (++budget.nodes > 16384 || depth > 20) return false;
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'string') return v.length <= 256;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v !== 'object' || types.isProxy(v) || active.has(v)) return false;
  const array = Array.isArray(v); const proto = Object.getPrototypeOf(v);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return false;
  const keys = Reflect.ownKeys(v);
  if (keys.length > 257 || (array && keys.length !== v.length + 1)) return false;
  active.add(v);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(v, key)!;
    if (typeof key !== 'string' || !Object.hasOwn(d, 'value')) return false;
    if (array && key === 'length') continue;
    if (!d.enumerable || ['__proto__', 'constructor', 'prototype'].includes(key)
      || (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= v.length))
      || !json(d.value, active, budget, depth + 1)) return false;
  }
  active.delete(v); return true;
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const copy = <T>(value: T): T => freeze(structuredClone(value));
const sameIdentity = (a: CandidateMapping, b: RegistrationRequest): boolean =>
  a.candidate_id === b.candidate_id && a.route_id === b.route_id
  && a.mission_id === b.mission_id && a.asset_id === b.asset_id;

/** Single-process proposal registry. The caller owns trusted currentness and authentication. */
export function createCandidateRegistry() {
  let current: RegistrationInputs | null = null;
  let run: string | null = null; let inputRevision: number | null = null; let incident: string | null = null;
  let catalog: readonly ProposedMissionAssignment[] = [];
  const entries: ReviewedProposal[] = []; const events: RegistrationEvent[] = [];

  function reject(code: 'INVALID_SCHEMA' | 'STALE_VERSION' | 'CONFLICT' | 'UNAUTHORIZED', reason: string): Result<never> {
    events.push(freeze({ kind: 'rejected', code, reason }));
    return freeze({ ok: false, code, reason });
  }

  function setCurrent(value: unknown): Result<null> {
    if (!json(value) || !closed(value, ['snapshot', 'context', 'known_asset_ids', 'mappings'])
      || !closed(value.context, ['incident_id', 'run_id', 'input_revision', 'current_sim_tick', 'mode', 'used_intent_ids'])
      || !id(value.context.run_id) || !id(value.context.incident_id) || !revision(value.context.input_revision)
      || !revision(value.context.current_sim_tick) || value.context.mode !== 'live'
      || !Array.isArray(value.context.used_intent_ids) || !value.context.used_intent_ids.every(id)
      || !Array.isArray(value.known_asset_ids) || !value.known_asset_ids.every(id)
      || new Set(value.known_asset_ids).size !== value.known_asset_ids.length
      || !Array.isArray(value.mappings) || !value.mappings.every(m => closed(m, mappingKeys) && mappingKeys.every(k => id(m[k])))) {
      return reject('INVALID_SCHEMA', 'Invalid closed current-input DTO');
    }
    const next = value as unknown as RegistrationInputs;
    const ctx = value.context as unknown as MissionPlanningContext;
    if (run !== null && (run !== ctx.run_id || incident !== ctx.incident_id || ctx.input_revision < inputRevision!)) {
      return reject('STALE_VERSION', 'Run/incident is fixed and input revision cannot decrease');
    }
    if (current && ctx.input_revision === inputRevision) {
      if (JSON.stringify(current) !== JSON.stringify(next)) return reject('CONFLICT', 'Changed inputs require a new revision');
      events.push(copy({ kind: 'current', inputs: next }));
      return freeze({ ok: true, value: null });
    }
    const plan = generateMissionCandidates(next.snapshot, next.context);
    const proposals = plan.ok ? plan.value.options.flatMap(option => option.assignments) : [];
    const mappings = next.mappings;
    if (new Set(mappings.map(m => m.candidate_id)).size !== mappings.length
      || mappings.some(m => !next.known_asset_ids.includes(m.asset_id)
        || !proposals.some(p => p.candidate_id === m.candidate_id && p.route_id === m.route_id
          && p.mission_id === m.mission_id && p.drone_id === m.drone_id)
        || mappings.some(other => (other.drone_id === m.drone_id) !== (other.asset_id === m.asset_id)))) {
      return reject('INVALID_SCHEMA', 'Mappings must identify exact planner proposals and known one-to-one assets');
    }
    current = copy(next); catalog = copy(proposals);
    run = ctx.run_id; incident = ctx.incident_id; inputRevision = ctx.input_revision;
    for (let n = 0; n < entries.length; n++) entries[n] = freeze({ ...entries[n], eligible: false });
    events.push(copy({ kind: 'current', inputs: next }));
    return freeze({ ok: true, value: null });
  }

  function register(request: unknown, trustedActor: ActorContext): Result<ReviewedProposal> {
    if (!json(request) || !closed(request, requestKeys) || request.decision !== 'approve'
      || !revision(request.input_revision) || !requestKeys.filter(k => k !== 'input_revision').every(k => id(request[k]))) {
      return reject('INVALID_SCHEMA', 'Explicit closed approve review required');
    }
    if (!json(trustedActor) || !closed(trustedActor, actorKeys) || trustedActor.actor_kind !== 'human'
      || !id(trustedActor.principal_id) || !id(trustedActor.session_id)
      || trustedActor.run_id !== run || trustedActor.incident_id !== incident
      || !(trustedActor.chief_epoch === null || revision(trustedActor.chief_epoch))
      || trustedActor.producer_id !== null || trustedActor.capture_epoch !== null) {
      return reject('UNAUTHORIZED', 'Trusted current human reviewer required');
    }
    const body = request as unknown as RegistrationRequest;
    if (!current || body.run_id !== run || body.input_revision !== inputRevision) {
      return reject('STALE_VERSION', 'Review must match current run and input revision');
    }
    const mapping = current.mappings.find(m => sameIdentity(m, body));
    const proposal = catalog.find(p => p.candidate_id === body.candidate_id);
    if (!mapping || !proposal) return reject('INVALID_SCHEMA', 'Unknown or unmapped exact identity');
    const existing = entries.find(e => e.identity.candidate_id === body.candidate_id);
    if (existing) {
      if (!existing.eligible || JSON.stringify(existing.proposal) !== JSON.stringify(proposal)
        || !sameIdentity(mapping, existing.identity)) return reject('CONFLICT', 'Candidate identity/geometry is immutable');
      events.push(copy({ kind: 'repeated', request: body, actor: trustedActor }));
      return freeze({ ok: true, value: existing });
    }
    if (entries.some(e => e.eligible && e.identity.asset_id === body.asset_id)) {
      return reject('CONFLICT', 'Asset already has a reviewed proposal in this revision');
    }
    const entry: ReviewedProposal = copy({ identity: body, proposal, reviewer_id: trustedActor.principal_id,
      reviewer_session_id: trustedActor.session_id, incident_id: incident!, executable: false,
      status: 'reviewed_proposal', eligible: true });
    entries.push(entry); events.push(copy({ kind: 'registered', request: body, actor: trustedActor }));
    return freeze({ ok: true, value: entry });
  }

  return Object.freeze({ setCurrent, register,
    snapshot: (): CandidateRegistry => freeze({ run_id: run, input_revision: inputRevision, entries: Object.freeze([...entries]) }),
    auditLog: (): readonly RegistrationEvent[] => Object.freeze([...events]),
  });
}

/** Replays trusted local audit receipts, not authentication of an imported log. */
export function replayCandidateRegistrations(log: readonly RegistrationEvent[]): CandidateRegistry {
  const registry = createCandidateRegistry();
  for (const event of log) {
    if (event.kind === 'current') {
      if (!registry.setCurrent(event.inputs).ok) throw new Error('Invalid current audit event');
    } else if (event.kind === 'registered' || event.kind === 'repeated') {
      const result = registry.register(event.request, event.actor);
      const actual = registry.auditLog().at(-1);
      if (!result.ok || actual?.kind !== event.kind) throw new Error('Invalid review audit event');
    } else if (event.kind !== 'rejected') throw new Error('Unknown audit event');
  }
  return registry.snapshot();
}
