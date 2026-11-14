import { types } from 'node:util';
import { validateApproval, validateEvent, validateSeed } from '../protocol/index.ts';
import type {
  Command, CommitContext, CommittedEvent, CommittedFor, IncidentSeed, IncidentState,
  ReceivedSnapshot, RejectionCode, Reservation, Result,
} from '../protocol/types.ts';
import { commitEvent, createIncidentState } from './reducer.ts';

const reject = (code: RejectionCode, reason: string): Result<never> => Object.freeze({ ok: false, code, reason });
const success = <T>(value: T): Result<T> => Object.freeze({ ok: true, value });
const id = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 1 && value.length <= 128 && value.trim().length > 0;
const integer = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0;
const eventKeys = [
  'contract_version', 'incident_id', 'run_id', 'authority_epoch', 'event_id', 'stream_id',
  'stream_sequence', 'trace_id', 'causation_id', 'kind', 'payload', 'incident_revision',
  'actor_id', 'actor_kind', 'session_id', 'recorded_at', 'received_at', 'sim_tick',
] as const;
const commandKeys = [
  'contract_version', 'incident_id', 'run_id', 'authority_epoch', 'command_id', 'command_version',
  'idempotency_key', 'transmission_id', 'asset_id', 'mission_id', 'mission_version', 'route_id',
  'action_id', 'approval_id', 'proposal_id', 'proposal_revision', 'input_revision', 'plan_revision',
  'reservation_revision', 'chief_epoch', 'chief_id', 'sent_sim_tick', 'deadline_sim_tick',
  'lease_expires_at_sim_tick', 'status',
] as const;
const reservationKeys = ['reservation_id', 'asset_id', 'route_id', 'approval_id', 'reservation_revision', 'expires_at_sim_tick'] as const;

function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time)
    && new Date(time).toISOString() === (value.length === 20 ? `${value.slice(0, -1)}.000Z` : value);
}

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every(key => Object.hasOwn(descriptors, key))
    && ownKeys.every(key => typeof key === 'string' && keys.includes(key)
      && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'));
}

function logArray(value: unknown): value is readonly unknown[] {
  if (!value || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const keys = Reflect.ownKeys(value); const descriptors = Object.getOwnPropertyDescriptors(value);
  return keys.length === value.length + 1 && keys.every(key => key === 'length'
    || typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length
      && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'));
}

function owned<T>(value: T, copies = new WeakMap<object, object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (copies.has(value)) return copies.get(value) as T;
  const copy = Array.isArray(value) ? []
    : Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
  copies.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = owned(item, copies);
  return Object.freeze(copy) as T;
}

function lookup<T>(source: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function dictionary<T>(source: Readonly<Record<string, T>>, key: string, value: T): Readonly<Record<string, T>> {
  return Object.freeze(Object.assign(Object.create(null), source, { [key]: value }));
}

function sameRecord(left: object, right: object): boolean {
  const first = left as Record<string, unknown>; const second = right as Record<string, unknown>;
  const keys = Object.keys(first);
  return keys.length === Object.keys(second).length
    && keys.every(key => Object.hasOwn(second, key) && first[key] === second[key]);
}

function commandGuard(value: unknown): value is Command {
  if (!closed(value, commandKeys)) return false;
  const ids = ['incident_id', 'run_id', 'command_id', 'idempotency_key', 'transmission_id',
    'asset_id', 'mission_id', 'route_id', 'action_id', 'approval_id', 'proposal_id', 'chief_id'];
  const integers = ['authority_epoch', 'command_version', 'mission_version', 'proposal_revision',
    'input_revision', 'plan_revision', 'reservation_revision', 'chief_epoch', 'deadline_sim_tick', 'lease_expires_at_sim_tick'];
  return value.contract_version === 'backend-protocol.v1' && ids.every(key => id(value[key]))
    && integers.every(key => integer(value[key])) && value.status === 'enqueued' && value.sent_sim_tick === null;
}

function reservationGuard(value: unknown): value is Reservation {
  return closed(value, reservationKeys) && id(value.reservation_id) && id(value.asset_id)
    && id(value.route_id) && id(value.approval_id) && integer(value.reservation_revision)
    && integer(value.expires_at_sim_tick);
}

function canonical(input: unknown): Result<CommittedEvent> {
  if (!closed(input, eventKeys)) return reject('INVALID_SCHEMA', 'Expected a closed canonical event');
  if (!id(input.actor_id) || !id(input.session_id) || typeof input.actor_kind !== 'string'
    || !['human', 'simulator', 'analyst', 'server', 'fixture'].includes(input.actor_kind)) {
    return reject('UNAUTHORIZED', 'Invalid recorded canonical actor');
  }
  if (!integer(input.incident_revision) || !integer(input.sim_tick)) return reject('INVALID_SCHEMA', 'Invalid canonical revision or tick');
  if (!utc(input.recorded_at) || !utc(input.received_at)) return reject('INVALID_TIME', 'Invalid canonical UTC clock');
  const { contract_version, incident_id, run_id, authority_epoch, event_id, stream_id,
    stream_sequence, trace_id, causation_id, kind, payload } = input;
  if (kind === 'approval.committed') {
    if (contract_version !== 'backend-protocol.v1') return reject('VERSION_MISMATCH', 'Incompatible canonical approval version');
    if (![incident_id, run_id, event_id, stream_id, trace_id].every(id) || !integer(authority_epoch)
      || !integer(stream_sequence) || stream_sequence === 0 || !(causation_id === null || id(causation_id))
      || !closed(payload, ['request', 'command', 'reservation'])) return reject('INVALID_SCHEMA', 'Invalid canonical approval envelope');
    const request = validateApproval(payload.request);
    if (!request.ok) return request;
    if (!commandGuard(payload.command) || !reservationGuard(payload.reservation)) return reject('INVALID_SCHEMA', 'Invalid recorded command or reservation');
    return success(owned({ contract_version, incident_id: incident_id as string, run_id: run_id as string,
      authority_epoch, event_id: event_id as string, stream_id: stream_id as string, stream_sequence,
      trace_id: trace_id as string, causation_id, kind, payload: { request: request.value,
        command: payload.command, reservation: payload.reservation }, incident_revision: input.incident_revision,
      actor_id: input.actor_id, actor_kind: input.actor_kind as CommitContext['actor']['actor_kind'],
      session_id: input.session_id, recorded_at: input.recorded_at, received_at: input.received_at,
      sim_tick: input.sim_tick }));
  }
  const valid = validateEvent({ contract_version, incident_id, run_id, authority_epoch, event_id,
    stream_id, stream_sequence, trace_id, causation_id, kind, payload });
  if (!valid.ok) return valid;
  return success(Object.freeze({ ...valid.value, incident_revision: input.incident_revision,
    actor_id: input.actor_id, actor_kind: input.actor_kind as CommitContext['actor']['actor_kind'],
    session_id: input.session_id, recorded_at: input.recorded_at, received_at: input.received_at,
    sim_tick: input.sim_tick }));
}

function recordedContext(state: IncidentState, event: CommittedEvent): CommitContext {
  return {
    actor: { principal_id: event.actor_id, session_id: event.session_id, incident_id: state.incident_id,
      run_id: state.run_id, actor_kind: event.actor_kind,
      chief_epoch: event.actor_kind === 'human' ? state.chief_epoch : null,
      producer_id: event.actor_kind === 'simulator' ? state.producer_id : null,
      capture_epoch: event.actor_kind === 'simulator' ? state.capture_epoch : null },
    recorded_at: event.recorded_at, received_at: event.received_at, sim_tick: event.sim_tick,
    // The reducer is pure. Its live mode validates the recorded historical transition, not new intent.
    mode: 'live',
  };
}

function replayApproval(state: IncidentState, event: CommittedFor<'approval.committed'>): Result<IncidentState> {
  const { request, command, reservation } = event.payload;
  if (event.actor_kind !== 'human' || event.actor_id !== state.chief_id) return reject('UNAUTHORIZED', 'Recorded approval did not belong to the current Chief');
  if (!state.authority_active) return reject('FROZEN', 'Recorded approval occurred without active authority');
  if (event.incident_id !== state.incident_id || event.run_id !== state.run_id || event.authority_epoch !== state.authority_epoch
    || request.incident_id !== state.incident_id || request.run_id !== state.run_id || request.authority_epoch !== state.authority_epoch
    || request.input_revision !== state.input_revision || request.plan_revision !== state.plan_revision
    || request.reservation_revision !== state.reservation_revision || request.chief_epoch !== state.chief_epoch) {
    return reject('STALE_VERSION', 'Recorded approval is not bound to the historical authority and versions');
  }
  if (request.expected_incident_revision !== state.incident_revision) return reject('CONFLICT', 'Recorded approval revision changed');
  const previous = state.log.at(-1);
  if (previous && (Date.parse(event.received_at) < Date.parse(previous.received_at)
    || Date.parse(event.recorded_at) < Date.parse(previous.recorded_at))) return reject('INVALID_TIME', 'Recorded approval clock moved backwards');
  if (previous && event.sim_tick < previous.sim_tick) return reject('STALE_VERSION', 'Recorded approval tick moved backwards');
  const proposal = lookup(state.proposals, request.proposal_id);
  if (!proposal || proposal.authority_epoch !== state.authority_epoch || proposal.payload.proposal_revision !== request.proposal_revision
    || proposal.payload.input_revision !== request.input_revision || proposal.payload.plan_revision !== request.plan_revision
    || proposal.payload.reservation_revision !== request.reservation_revision || proposal.payload.chief_epoch !== request.chief_epoch) {
    return reject('STALE_VERSION', 'Recorded approval does not match the historical proposal');
  }
  const candidate = state.seed.candidates.find(value => value.candidate_id === request.candidate_id);
  if (!candidate || !proposal.payload.candidate_ids.includes(candidate.candidate_id)
    || !state.seed.assets.some(value => value.asset_id === candidate.asset_id)) return reject('INVALID_SCHEMA', 'Recorded approval has unknown candidate scope');
  if (!candidate.feasible || candidate.plan_revision !== state.plan_revision) return reject('STALE_VERSION', 'Recorded candidate was not declared feasible');
  if (request.expires_at_sim_tick <= event.sim_tick || proposal.payload.expires_at_sim_tick <= event.sim_tick
    || candidate.expires_at_sim_tick <= event.sim_tick) return reject('EXPIRED', 'Recorded approval scope had expired');
  if (request.expires_at_sim_tick > proposal.payload.expires_at_sim_tick
    || proposal.payload.expires_at_sim_tick > candidate.expires_at_sim_tick) return reject('STALE_VERSION', 'Recorded approval extended historical scope');
  if (Object.values(state.reservations).some(value => {
    const existing = Object.values(state.commands).find(item => item.approval_id === value.approval_id);
    const terminal = existing && ['completed', 'failed', 'cancelled', 'rejected'].includes(existing.status);
    return value.expires_at_sim_tick > event.sim_tick && !terminal
      && (value.asset_id === candidate.asset_id || value.route_id === candidate.route_id);
  })) return reject('CONFLICT', 'Recorded approval reused a live asset or route reservation');
  const stream_id = `approval:${event.actor_id}`;
  const sequence = (lookup(state.stream_cursors, stream_id) ?? 0) + 1;
  const command_id = `command:${request.approval_id}`;
  const reservation_id = `reservation:${request.approval_id}`;
  const transmission_id = `${command_id}:tx:1`;
  const reservation_revision = state.reservation_revision + 1;
  if (![stream_id, command_id, reservation_id, transmission_id, `approval:${request.approval_id}`].every(id)
    || !integer(sequence) || !integer(reservation_revision)) return reject('INVALID_SCHEMA', 'Recorded generated identity or revision exhausted');
  if (event.event_id !== `approval:${request.approval_id}` || event.stream_id !== stream_id
    || event.stream_sequence !== sequence || event.trace_id !== request.approval_id || event.causation_id !== request.proposal_id) {
    return reject('CONFLICT', 'Recorded approval envelope differs from canonical generation');
  }
  if (lookup(state.commands, command_id) || lookup(state.reservations, reservation_id)) return reject('CONFLICT', 'Recorded generated identity was already used');
  const lease_expires_at_sim_tick = Math.min(event.sim_tick + 120, request.expires_at_sim_tick);
  const expectedReservation: Reservation = { reservation_id, asset_id: candidate.asset_id, route_id: candidate.route_id,
    approval_id: request.approval_id, reservation_revision, expires_at_sim_tick: lease_expires_at_sim_tick };
  const expectedCommand: Command = {
    contract_version: state.contract_version, incident_id: state.incident_id, run_id: state.run_id, authority_epoch: state.authority_epoch,
    command_id, command_version: 1, idempotency_key: command_id, transmission_id, asset_id: candidate.asset_id,
    mission_id: candidate.mission_id, mission_version: candidate.mission_version, route_id: candidate.route_id,
    action_id: candidate.action_id, approval_id: request.approval_id, proposal_id: request.proposal_id,
    proposal_revision: request.proposal_revision, input_revision: request.input_revision, plan_revision: request.plan_revision,
    reservation_revision, chief_epoch: request.chief_epoch, chief_id: event.actor_id, sent_sim_tick: null,
    deadline_sim_tick: Math.min(event.sim_tick + 10, lease_expires_at_sim_tick), lease_expires_at_sim_tick, status: 'enqueued',
  };
  if (!sameRecord(command, expectedCommand) || !sameRecord(reservation, expectedReservation)) {
    return reject('STALE_VERSION', 'Recorded command or reservation differs from approved canonical bindings');
  }
  // Materialize already recorded facts only. No approval, acceptance, dispatch or provider function is called.
  return success(owned({ ...state, incident_revision: event.incident_revision, reservation_revision,
    stream_cursors: dictionary(state.stream_cursors, stream_id, sequence),
    commands: dictionary(state.commands, command_id, command), reservations: dictionary(state.reservations, reservation_id, reservation),
    log: [...state.log, event] }));
}

export function replayLog(seed: IncidentSeed, log: readonly CommittedEvent[]): Result<IncidentState> {
  const valid = validateSeed(seed);
  if (!valid.ok) return valid;
  if (!logArray(log)) return reject('INVALID_SCHEMA', 'Expected a dense canonical JSON log');
  let state = createIncidentState(valid.value);
  for (const input of log) {
    const validEvent = canonical(input);
    if (!validEvent.ok) return validEvent;
    const event = validEvent.value;
    if (event.incident_revision !== state.incident_revision + 1) return reject('CONFLICT', 'Canonical revisions must be contiguous');
    if (state.log.some(value => value.event_id === event.event_id)) return reject('CONFLICT', 'Canonical event identity was reused');
    if (event.kind === 'approval.committed') {
      const next = replayApproval(state, event);
      if (!next.ok) return next;
      state = next.value;
      continue;
    }
    const { contract_version, incident_id, run_id, authority_epoch, event_id, stream_id,
      stream_sequence, trace_id, causation_id, kind, payload } = event;
    const next = commitEvent(state, { contract_version, incident_id, run_id, authority_epoch, event_id,
      stream_id, stream_sequence, trace_id, causation_id, kind, payload }, recordedContext(state, event));
    if (!next.ok) return next;
    state = next.value;
  }
  return success(state);
}

export function selectReceivedSnapshot(state: IncidentState, received_at: string): Result<ReceivedSnapshot> {
  if (!utc(received_at)) return reject('INVALID_TIME', 'Expected an explicit valid UTC receipt cutoff');
  // Validate the complete log, including its future suffix, before exposing any successful prefix.
  const complete = replayLog(state.seed, state.log);
  if (!complete.ok) return complete;
  const cutoff = Date.parse(received_at);
  const count = complete.value.log.findIndex(event => Date.parse(event.received_at) > cutoff);
  const prefix = count < 0 ? complete.value.log : complete.value.log.slice(0, count);
  const visible = replayLog(complete.value.seed, prefix);
  if (!visible.ok) return visible;
  const current = visible.value;
  return success(Object.freeze({ contract_version: current.contract_version, incident_id: current.incident_id,
    run_id: current.run_id, authority_epoch: current.authority_epoch, incident_revision: current.incident_revision,
    telemetry: current.telemetry, frames: current.frames, hypotheses: current.hypotheses,
    commands: current.commands, received_at }));
}
