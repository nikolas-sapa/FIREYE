import { types } from 'node:util';
import { validateApproval } from '../protocol/index.ts';
import type {
  ApprovalRequest, Candidate, Command, CommitContext, CommittedFor,
  IncidentState, RejectionCode, Reservation, Result,
} from '../protocol/types.ts';

const reject = (code: RejectionCode, reason: string): Result<never> => Object.freeze({ ok: false, code, reason });
const success = <T>(value: T): Result<T> => Object.freeze({ ok: true, value });
const id = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 1 && value.length <= 128 && value.trim().length > 0;
const integer = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0;
const terminal = (command: Command): boolean => ['completed', 'failed', 'cancelled', 'rejected'].includes(command.status);

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

function owned<T>(value: T, copies = new WeakMap<object, object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (copies.has(value)) return copies.get(value) as T;
  const copy = Array.isArray(value) ? []
    : Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype);
  copies.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = owned(item, copies);
  return Object.freeze(copy) as T;
}

function dictionary<T>(source: Readonly<Record<string, T>>, key: string, value: T): Readonly<Record<string, T>> {
  return Object.freeze(Object.assign(Object.create(null), source, { [key]: value }));
}

function lookup<T>(source: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function sameRecord(left: object, right: object, ignored: readonly string[] = []): boolean {
  const first = left as Record<string, unknown>; const second = right as Record<string, unknown>;
  const keys = Object.keys(first).filter(key => !ignored.includes(key));
  return keys.length === Object.keys(second).filter(key => !ignored.includes(key)).length
    && keys.every(key => Object.hasOwn(second, key) && first[key] === second[key]);
}

function checkContext(state: IncidentState, context: CommitContext, kind: 'human' | 'simulator'): Result<null> {
  if (!closed(context, ['actor', 'recorded_at', 'received_at', 'sim_tick', 'mode'])
    || !closed(context.actor, ['principal_id', 'session_id', 'incident_id', 'run_id', 'actor_kind', 'chief_epoch', 'producer_id', 'capture_epoch'])) {
    return reject('UNAUTHORIZED', 'Expected verified actor context');
  }
  const actor = context.actor;
  if (![actor.principal_id, actor.session_id, actor.incident_id, actor.run_id].every(id)
    || !(actor.chief_epoch === null || integer(actor.chief_epoch))
    || !(actor.producer_id === null || id(actor.producer_id))
    || !(actor.capture_epoch === null || integer(actor.capture_epoch))
    || actor.actor_kind !== kind || actor.incident_id !== state.incident_id || actor.run_id !== state.run_id) {
    return reject('UNAUTHORIZED', 'Actor is not a verified member with the required role');
  }
  if (kind === 'human' ? actor.principal_id !== state.chief_id || actor.chief_epoch !== state.chief_epoch
    : actor.principal_id !== state.producer_id || actor.producer_id !== state.producer_id || actor.capture_epoch !== state.capture_epoch) {
    return reject('UNAUTHORIZED', 'Actor does not hold the current Chief or producer lease');
  }
  if (!integer(context.sim_tick) || !['live', 'replay', 'offline'].includes(context.mode)) {
    return reject('INVALID_SCHEMA', 'Invalid trusted mode or simulation tick');
  }
  if (!utc(context.recorded_at) || !utc(context.received_at)) return reject('INVALID_TIME', 'Expected valid trusted UTC clocks');
  if (context.mode !== 'live' || !state.authority_active) return reject('FROZEN', 'Live active authority is required');
  return success(null);
}

function checkClocks(state: IncidentState, context: CommitContext): Result<null> {
  const last = state.log.at(-1);
  if (last && (Date.parse(context.received_at) < Date.parse(last.received_at)
    || Date.parse(context.recorded_at) < Date.parse(last.recorded_at))) {
    return reject('INVALID_TIME', 'Trusted canonical clock moved backwards');
  }
  if (last && context.sim_tick < last.sim_tick) return reject('STALE_VERSION', 'Trusted simulation tick moved backwards');
  return success(null);
}

function currentCandidate(state: IncidentState, request: ApprovalRequest, context: CommitContext): Result<Candidate> {
  const proposal = lookup(state.proposals, request.proposal_id);
  if (!proposal || proposal.incident_id !== state.incident_id || proposal.run_id !== state.run_id
    || proposal.authority_epoch !== state.authority_epoch || proposal.payload.proposal_revision !== request.proposal_revision
    || proposal.payload.input_revision !== request.input_revision || proposal.payload.plan_revision !== request.plan_revision
    || proposal.payload.reservation_revision !== request.reservation_revision || proposal.payload.chief_epoch !== request.chief_epoch) {
    return reject('STALE_VERSION', 'Approval does not match the current committed proposal');
  }
  const candidate = state.seed.candidates.find(value => value.candidate_id === request.candidate_id);
  if (!candidate || !proposal.payload.candidate_ids.includes(request.candidate_id)
    || !state.seed.assets.some(value => value.asset_id === candidate.asset_id)) {
    return reject('INVALID_SCHEMA', 'Approval references an unknown candidate or asset scope');
  }
  if (!candidate.feasible || candidate.plan_revision !== state.plan_revision) return reject('STALE_VERSION', 'Candidate is not currently declared feasible');
  if (request.expires_at_sim_tick <= context.sim_tick || proposal.payload.expires_at_sim_tick <= context.sim_tick
    || candidate.expires_at_sim_tick <= context.sim_tick) return reject('EXPIRED', 'Approved candidate scope expired');
  if (request.expires_at_sim_tick > proposal.payload.expires_at_sim_tick
    || proposal.payload.expires_at_sim_tick > candidate.expires_at_sim_tick) return reject('STALE_VERSION', 'Approval cannot extend the declared scope');
  return success(candidate);
}

function liveReservation(state: IncidentState, reservation: Reservation, sim_tick: number): boolean {
  if (reservation.expires_at_sim_tick <= sim_tick) return false;
  const command = Object.values(state.commands).find(value => value.approval_id === reservation.approval_id);
  return !command || !terminal(command);
}

function scopeConflict(state: IncidentState, candidate: Candidate, sim_tick: number, own_id?: string): boolean {
  return Object.values(state.reservations).some(value => value.reservation_id !== own_id
    && liveReservation(state, value, sim_tick)
    && (value.asset_id === candidate.asset_id || value.route_id === candidate.route_id));
}

export function approveProposal(state: IncidentState, input: unknown, context: CommitContext): Result<IncidentState> {
  const valid = validateApproval(input);
  if (!valid.ok) return valid;
  const request = valid.value;
  const trusted = checkContext(state, context, 'human');
  if (!trusted.ok) return trusted;
  const event_id = `approval:${request.approval_id}`;
  const duplicate = state.log.find(event => event.event_id === event_id);
  if (duplicate) {
    return duplicate.kind === 'approval.committed' && duplicate.actor_id === context.actor.principal_id
      && sameRecord(duplicate.payload.request, request)
      ? success(state) : reject('CONFLICT', 'Approval identity has conflicting request or principal');
  }
  if (request.expected_incident_revision !== state.incident_revision) return reject('CONFLICT', 'Incident revision changed');
  if (request.incident_id !== state.incident_id || request.run_id !== state.run_id || request.authority_epoch !== state.authority_epoch
    || request.input_revision !== state.input_revision || request.plan_revision !== state.plan_revision
    || request.reservation_revision !== state.reservation_revision || request.chief_epoch !== state.chief_epoch) {
    return reject('STALE_VERSION', 'Approval is not bound to current authority and received versions');
  }
  const clocks = checkClocks(state, context);
  if (!clocks.ok) return clocks;
  const candidate = currentCandidate(state, request, context);
  if (!candidate.ok) return candidate;
  if (scopeConflict(state, candidate.value, context.sim_tick)) return reject('CONFLICT', 'Asset or route already has a live reservation');
  const stream_id = `approval:${context.actor.principal_id}`;
  const stream_sequence = (lookup(state.stream_cursors, stream_id) ?? 0) + 1;
  const command_id = `command:${request.approval_id}`;
  const reservation_id = `reservation:${request.approval_id}`;
  const transmission_id = `${command_id}:tx:1`;
  const incident_revision = state.incident_revision + 1;
  const reservation_revision = state.reservation_revision + 1;
  if (![event_id, stream_id, command_id, reservation_id, transmission_id].every(id)
    || ![stream_sequence, incident_revision, reservation_revision].every(integer)) {
    return reject('INVALID_SCHEMA', 'Generated identity or canonical revision exhausted');
  }
  if (lookup(state.commands, command_id) || lookup(state.reservations, reservation_id)) return reject('CONFLICT', 'Generated command or reservation identity already exists');
  const lease_expires_at_sim_tick = Math.min(context.sim_tick + 120, request.expires_at_sim_tick);
  const reservation: Reservation = { reservation_id, asset_id: candidate.value.asset_id, route_id: candidate.value.route_id,
    approval_id: request.approval_id, reservation_revision, expires_at_sim_tick: lease_expires_at_sim_tick };
  const command: Command = {
    contract_version: state.contract_version, incident_id: state.incident_id, run_id: state.run_id, authority_epoch: state.authority_epoch,
    command_id, command_version: 1, idempotency_key: command_id, transmission_id, asset_id: candidate.value.asset_id,
    mission_id: candidate.value.mission_id, mission_version: candidate.value.mission_version, route_id: candidate.value.route_id,
    action_id: candidate.value.action_id, approval_id: request.approval_id, proposal_id: request.proposal_id,
    proposal_revision: request.proposal_revision, input_revision: request.input_revision, plan_revision: request.plan_revision,
    reservation_revision, chief_epoch: request.chief_epoch, chief_id: context.actor.principal_id,
    sent_sim_tick: null, deadline_sim_tick: Math.min(context.sim_tick + 10, lease_expires_at_sim_tick),
    lease_expires_at_sim_tick, status: 'enqueued',
  };
  const committed: CommittedFor<'approval.committed'> = {
    contract_version: state.contract_version, incident_id: state.incident_id, run_id: state.run_id, authority_epoch: state.authority_epoch,
    event_id, stream_id, stream_sequence, trace_id: request.approval_id, causation_id: request.proposal_id,
    kind: 'approval.committed', payload: { request, command, reservation }, incident_revision,
    actor_id: context.actor.principal_id, actor_kind: context.actor.actor_kind, session_id: context.actor.session_id,
    recorded_at: context.recorded_at, received_at: context.received_at, sim_tick: context.sim_tick,
  };
  return success(owned({ ...state, incident_revision, reservation_revision,
    stream_cursors: dictionary(state.stream_cursors, stream_id, stream_sequence),
    commands: dictionary(state.commands, command_id, command), reservations: dictionary(state.reservations, reservation_id, reservation),
    log: [...state.log, committed] }));
}

const commandKeys = [
  'contract_version', 'incident_id', 'run_id', 'authority_epoch', 'command_id', 'command_version', 'idempotency_key',
  'transmission_id', 'asset_id', 'mission_id', 'mission_version', 'route_id', 'action_id', 'approval_id', 'proposal_id',
  'proposal_revision', 'input_revision', 'plan_revision', 'reservation_revision', 'chief_epoch', 'chief_id',
  'sent_sim_tick', 'deadline_sim_tick', 'lease_expires_at_sim_tick', 'status',
] as const;

function commandGuard(value: unknown): value is Command {
  if (!closed(value, commandKeys)) return false;
  const ids = ['incident_id', 'run_id', 'command_id', 'idempotency_key', 'transmission_id', 'asset_id',
    'mission_id', 'route_id', 'action_id', 'approval_id', 'proposal_id', 'chief_id'];
  const integers = ['authority_epoch', 'command_version', 'mission_version', 'proposal_revision', 'input_revision',
    'plan_revision', 'reservation_revision', 'chief_epoch', 'deadline_sim_tick', 'lease_expires_at_sim_tick'];
  return value.contract_version === 'backend-protocol.v1' && ids.every(key => id(value[key]))
    && integers.every(key => integer(value[key])) && (value.sent_sim_tick === null || integer(value.sent_sim_tick))
    && typeof value.status === 'string'
    && ['enqueued', 'sent', 'delivered', 'accepted', 'running', 'completed', 'failed', 'cancelled', 'rejected'].includes(value.status);
}

export function validateCommandAcceptance(state: IncidentState, command: Command, context: CommitContext): Result<Command> {
  const trusted = checkContext(state, context, 'simulator');
  if (!trusted.ok) return trusted;
  if (!commandGuard(command)) return reject('INVALID_SCHEMA', 'Expected the exact closed command record');
  const existing = lookup(state.commands, command.command_id);
  if (!existing) return reject('INVALID_SCHEMA', 'Command is not committed in current state');
  if (!sameRecord(existing, command)) return reject('STALE_VERSION', 'Command does not match its current committed version');
  if (command.contract_version !== state.contract_version || command.incident_id !== state.incident_id
    || command.run_id !== state.run_id || command.authority_epoch !== state.authority_epoch
    || command.input_revision !== state.input_revision || command.plan_revision !== state.plan_revision
    || command.reservation_revision !== state.reservation_revision || command.chief_epoch !== state.chief_epoch
    || command.chief_id !== state.chief_id) return reject('STALE_VERSION', 'Command intent is not bound to current authority and versions');
  const clocks = checkClocks(state, context);
  if (!clocks.ok) return clocks;
  if (terminal(command)) return reject('CONFLICT', 'Terminal command cannot be newly accepted');
  if (command.deadline_sim_tick <= context.sim_tick || command.lease_expires_at_sim_tick <= context.sim_tick) {
    return reject('EXPIRED', 'Command acceptance deadline or lease expired');
  }
  const approval = state.log.find((event): event is CommittedFor<'approval.committed'> =>
    event.kind === 'approval.committed' && event.payload.request.approval_id === command.approval_id);
  if (!approval || approval.actor_kind !== 'human' || approval.actor_id !== command.chief_id
    || !sameRecord(approval.payload.command, command, ['status', 'sent_sim_tick'])) {
    return reject('STALE_VERSION', 'Command is not bound to its canonical Chief approval');
  }
  const request = approval.payload.request;
  if (request.incident_id !== state.incident_id || request.run_id !== state.run_id || request.authority_epoch !== state.authority_epoch
    || request.input_revision !== command.input_revision || request.plan_revision !== command.plan_revision
    || request.chief_epoch !== command.chief_epoch || request.proposal_id !== command.proposal_id
    || request.proposal_revision !== command.proposal_revision || request.reservation_revision + 1 !== command.reservation_revision
    || request.expected_incident_revision + 1 !== approval.incident_revision) {
    return reject('STALE_VERSION', 'Canonical approval versions do not bind this command');
  }
  const candidate = currentCandidate(state, request, context);
  if (!candidate.ok) return candidate;
  if (candidate.value.asset_id !== command.asset_id || candidate.value.route_id !== command.route_id
    || candidate.value.action_id !== command.action_id || candidate.value.mission_id !== command.mission_id
    || candidate.value.mission_version !== command.mission_version || command.command_id !== `command:${request.approval_id}`
    || command.command_version !== 1 || command.idempotency_key !== command.command_id
    || command.transmission_id !== `${command.command_id}:tx:1`) {
    return reject('STALE_VERSION', 'Command mission, transmission or action exceeds its approved candidate');
  }
  const reservation = lookup(state.reservations, approval.payload.reservation.reservation_id);
  if (!reservation || !sameRecord(reservation, approval.payload.reservation)
    || reservation.approval_id !== command.approval_id || reservation.reservation_revision !== command.reservation_revision
    || reservation.asset_id !== command.asset_id || reservation.route_id !== command.route_id
    || reservation.expires_at_sim_tick !== command.lease_expires_at_sim_tick) return reject('STALE_VERSION', 'Command reservation no longer matches approved scope');
  if (command.deadline_sim_tick > approval.sim_tick + 10 || command.lease_expires_at_sim_tick > approval.sim_tick + 120
    || command.deadline_sim_tick > command.lease_expires_at_sim_tick || command.lease_expires_at_sim_tick > request.expires_at_sim_tick) {
    return reject('STALE_VERSION', 'Command deadline or lease exceeds approved bounds');
  }
  if (scopeConflict(state, candidate.value, context.sim_tick, reservation.reservation_id)) return reject('CONFLICT', 'Command scope conflicts with a live reservation');
  return success(owned(command));
}
