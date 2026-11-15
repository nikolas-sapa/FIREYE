import { types } from 'node:util';
import { validateEvent, validateSeed } from '../protocol/index.ts';
import type {
  Command, CommitContext, CommittedEvent, CommittedFor, CommittedMetadata, EventInput,
  IncidentSeed, IncidentState, RejectionCode, Reservation, Result,
} from '../protocol/types.ts';

const reject = (code: RejectionCode, reason: string): Result<never> => Object.freeze({ ok: false, code, reason });
const success = <T>(value: T): Result<T> => Object.freeze({ ok: true, value });
const id = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 1 && value.length <= 128 && value.trim().length > 0;
const integer = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0;

function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  return new Date(time).toISOString() === (value.length === 20 ? `${value.slice(0, -1)}.000Z` : value);
}

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return ownKeys.length === keys.length && keys.every(key => Object.hasOwn(descriptors, key))
    && ownKeys.every(key => typeof key === 'string' && keys.includes(key)
      && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'));
}

function owned<T>(value: T, copies = new WeakMap<object, object>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (copies.has(value)) return copies.get(value) as T;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    copies.set(value, copy);
    for (const item of value) copy.push(owned(item, copies));
    return Object.freeze(copy) as T;
  }
  const copy = Object.create(Object.getPrototypeOf(value) === null ? null : Object.prototype) as Record<string, unknown>;
  copies.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = owned(item, copies);
  return Object.freeze(copy) as T;
}

function dictionary<T>(source: Readonly<Record<string, T>> = {}, key?: string, value?: T): Readonly<Record<string, T>> {
  const next: Record<string, T> = Object.assign(Object.create(null), source);
  if (key !== undefined && value !== undefined) next[key] = value;
  return Object.freeze(next);
}

function lookup<T>(source: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameJson(value, right[index]));
  }
  const first = left as Record<string, unknown>;
  const second = right as Record<string, unknown>;
  const keys = Object.keys(first);
  return keys.length === Object.keys(second).length
    && keys.every(key => Object.hasOwn(second, key) && sameJson(first[key], second[key]));
}

function eventBody(event: CommittedEvent): Omit<CommittedEvent, keyof CommittedMetadata> {
  const { contract_version, incident_id, run_id, authority_epoch, event_id, stream_id,
    stream_sequence, trace_id, causation_id, kind, payload } = event;
  return { contract_version, incident_id, run_id, authority_epoch, event_id, stream_id,
    stream_sequence, trace_id, causation_id, kind, payload };
}

function lastEvent(log: readonly CommittedEvent[], predicate: (event: CommittedEvent) => boolean): CommittedEvent | undefined {
  for (let n = log.length - 1; n >= 0; n--) if (predicate(log[n])) return log[n];
  return undefined;
}

export function createIncidentState(seed: IncidentSeed): IncidentState {
  const valid = validateSeed(seed);
  if (!valid.ok) throw new TypeError(`${valid.code}: ${valid.reason}`);
  const initial = valid.value;
  return Object.freeze({
    contract_version: initial.contract_version, incident_id: initial.incident_id,
    run_id: initial.run_id, authority_epoch: initial.authority_epoch, seed: initial,
    incident_revision: initial.incident_revision, input_revision: initial.input_revision,
    plan_revision: initial.plan_revision, reservation_revision: initial.reservation_revision,
    chief_id: initial.chief_id, chief_epoch: initial.chief_epoch,
    producer_id: initial.producer_id, capture_epoch: initial.capture_epoch,
    authority_active: initial.authority_active,
    stream_cursors: dictionary<number>(), telemetry: dictionary<CommittedFor<'telemetry.received'>>(),
    frames: dictionary<CommittedFor<'frame.received'>>(), hypotheses: dictionary<CommittedFor<'hypothesis.received'>>(),
    proposals: dictionary<CommittedFor<'proposal.created'>>(), reservations: dictionary<Reservation>(),
    commands: dictionary<Command>(), log: Object.freeze([]),
  });
}

function checkContext(state: IncidentState, event: EventInput, context: CommitContext): Result<null> {
  if (!closed(context, ['actor', 'recorded_at', 'received_at', 'sim_tick', 'mode'])
    || !closed(context.actor, ['principal_id', 'session_id', 'incident_id', 'run_id', 'actor_kind', 'chief_epoch', 'producer_id', 'capture_epoch'])) {
    return reject('UNAUTHORIZED', 'Expected verified actor context');
  }
  const actor = context.actor;
  if (![actor.principal_id, actor.session_id, actor.incident_id, actor.run_id].every(id)
    || !(actor.chief_epoch === null || integer(actor.chief_epoch))
    || !(actor.producer_id === null || id(actor.producer_id))
    || !(actor.capture_epoch === null || integer(actor.capture_epoch))
    || !['human', 'simulator', 'analyst', 'server', 'fixture'].includes(actor.actor_kind)) {
    return reject('UNAUTHORIZED', 'Invalid actor identity or lease');
  }
  if (!integer(context.sim_tick) || !['live', 'replay', 'offline'].includes(context.mode)) {
    return reject('INVALID_SCHEMA', 'Invalid trusted mode or simulation tick');
  }
  if (!utc(context.recorded_at) || !utc(context.received_at)) return reject('INVALID_TIME', 'Expected valid trusted UTC clocks');
  if (actor.incident_id !== state.incident_id || actor.run_id !== state.run_id) {
    return reject('UNAUTHORIZED', 'Actor is not a member of this incident and run');
  }
  if (event.stream_id.startsWith('approval:')) return reject('UNAUTHORIZED', 'Approval stream is server-generated only');
  switch (event.kind) {
    case 'telemetry.received':
    case 'frame.received':
    case 'command.receipt':
      if (actor.actor_kind !== 'simulator' || actor.principal_id !== state.producer_id
        || actor.producer_id !== state.producer_id || actor.capture_epoch !== state.capture_epoch) {
        return reject('UNAUTHORIZED', 'Only the designated producer with the current capture lease may write');
      }
      break;
    case 'hypothesis.received':
      if (actor.actor_kind !== 'analyst') return reject('UNAUTHORIZED', 'Only analysts may submit hypotheses');
      break;
    case 'proposal.created':
      if (actor.actor_kind !== 'analyst' && actor.actor_kind !== 'human') return reject('UNAUTHORIZED', 'Only analysts or human members may propose');
      if (actor.actor_kind === 'human' && actor.chief_epoch !== state.chief_epoch) return reject('UNAUTHORIZED', 'Human context has an obsolete Chief epoch');
      break;
    case 'authority.changed':
    case 'chief.changed':
      if (actor.actor_kind !== 'server') return reject('UNAUTHORIZED', 'Only server authority may change ownership');
      break;
  }
  return success(null);
}

function checkOrder(state: IncidentState, event: EventInput, context: CommitContext): Result<null> {
  if (event.authority_epoch !== state.authority_epoch) return reject('STALE_VERSION', 'Obsolete authority epoch');
  if (context.mode !== 'live' || (!state.authority_active && event.kind !== 'authority.changed' && event.kind !== 'chief.changed')) {
    return reject('FROZEN', 'Canonical mutation is unavailable until explicit server takeover');
  }
  const last = state.log.at(-1);
  if (last && Date.parse(context.received_at) < Date.parse(last.received_at)) return reject('INVALID_TIME', 'Received clock moved backwards');
  const owner = lastEvent(state.log, item => item.stream_id === event.stream_id && item.authority_epoch === state.authority_epoch);
  if (owner && owner.actor_id !== context.actor.principal_id) return reject('UNAUTHORIZED', 'This stream has another principal in the current epoch');
  const cursor = lookup(state.stream_cursors, event.stream_id) ?? 0;
  if (event.stream_sequence <= cursor) return reject('CONFLICT', 'Stream sequence was already used');
  if (event.stream_sequence !== cursor + 1) return reject('STREAM_GAP', 'Expected the next stream sequence');
  if (!integer(state.incident_revision + 1)) return reject('INVALID_SCHEMA', 'Canonical revision exhausted');
  return success(null);
}

function checkProducerPayload(state: IncidentState, producer_id: string, capture_epoch: number): Result<null> {
  if (producer_id !== state.producer_id) return reject('UNAUTHORIZED', 'Payload producer does not match the current lease');
  if (capture_epoch !== state.capture_epoch) return reject('STALE_VERSION', 'Payload capture epoch is obsolete');
  return success(null);
}

function knownEvidence(state: IncidentState, ids: readonly string[]): boolean {
  return ids.every(id => state.log.some(event => event.kind === 'frame.received' && event.payload.evidence_id === id));
}

function checkProposal(state: IncidentState, event: CommittedFor<'proposal.created'>, context: CommitContext): Result<null> {
  const payload = event.payload;
  if (payload.input_revision !== state.input_revision || payload.plan_revision !== state.plan_revision
    || payload.reservation_revision !== state.reservation_revision || payload.chief_epoch !== state.chief_epoch) {
    return reject('STALE_VERSION', 'Proposal is not based on current received and approval versions');
  }
  if (payload.expires_at_sim_tick <= context.sim_tick) return reject('EXPIRED', 'Proposal scope expired');
  for (const id of payload.candidate_ids) {
    const candidate = state.seed.candidates.find(value => value.candidate_id === id);
    if (!candidate) return reject('INVALID_SCHEMA', 'Proposal references an unknown candidate');
    if (!candidate.feasible || candidate.plan_revision !== state.plan_revision) return reject('STALE_VERSION', 'Candidate is not currently declared feasible');
    if (candidate.expires_at_sim_tick <= context.sim_tick) return reject('EXPIRED', 'Candidate scope expired');
    if (payload.expires_at_sim_tick > candidate.expires_at_sim_tick) return reject('STALE_VERSION', 'Proposal cannot extend candidate scope');
  }
  const previous = lastEvent(state.log, value => value.kind === 'proposal.created' && value.payload.proposal_id === payload.proposal_id);
  if (previous?.kind === 'proposal.created' && payload.proposal_revision <= previous.payload.proposal_revision) {
    return reject('CONFLICT', 'Proposal revision must increase for a new event');
  }
  return success(null);
}

function checkReceipt(state: IncidentState, event: CommittedFor<'command.receipt'>): Result<Command> {
  const payload = event.payload;
  const producer = checkProducerPayload(state, payload.producer_id, payload.capture_epoch);
  if (!producer.ok) return producer;
  const command = lookup(state.commands, payload.command_id);
  if (!command) return reject('INVALID_SCHEMA', 'Receipt references an unknown command');
  if (command.contract_version !== state.contract_version || command.incident_id !== state.incident_id
    || command.run_id !== state.run_id || command.command_id !== payload.command_id
    || command.command_version !== payload.command_version || command.transmission_id !== payload.transmission_id
    || command.mission_id !== payload.mission_id || command.mission_version !== payload.mission_version) {
    return reject('STALE_VERSION', 'Receipt does not match the original command and transmission');
  }
  if (!knownEvidence(state, payload.evidence_ids)) return reject('INVALID_SCHEMA', 'Receipt references unreceived evidence');
  if (state.log.some(value => value.kind === 'command.receipt' && value.payload.receipt_id === payload.receipt_id)) {
    return reject('CONFLICT', 'Receipt identity was already used by another event');
  }
  return success(command);
}

const stageOrder = { enqueued: 0, sent: 1, delivered: 2, accepted: 3, running: 4, completed: 5, failed: 5, cancelled: 5, rejected: 5 } as const;

function receiptCommand(command: Command, event: CommittedFor<'command.receipt'>): Command {
  const payload = event.payload;
  const status = stageOrder[command.status] === 5 || stageOrder[payload.stage] < stageOrder[command.status]
    ? command.status : payload.stage;
  return { ...command, status,
    sent_sim_tick: command.sent_sim_tick ?? (payload.stage === 'sent' ? payload.sim_tick : null) };
}

function newerCapture(next: CommittedFor<'telemetry.received'> | CommittedFor<'frame.received'>,
  previous: CommittedFor<'telemetry.received'> | CommittedFor<'frame.received'> | undefined): boolean {
  if (!previous) return true;
  if (next.payload.capture_epoch !== previous.payload.capture_epoch) return next.payload.capture_epoch > previous.payload.capture_epoch;
  const nextTick = next.payload.sim_tick;
  const previousTick = previous.payload.sim_tick;
  if (nextTick !== null && previousTick !== null && nextTick !== previousTick) return nextTick > previousTick;
  if (nextTick !== null && previousTick === null) return true;
  if (nextTick === null && previousTick !== null) return false;
  if (next.payload.captured_at !== null && previous.payload.captured_at !== null) {
    return Date.parse(next.payload.captured_at) >= Date.parse(previous.payload.captured_at);
  }
  return previous.payload.captured_at === null;
}

function applyEvent(state: IncidentState, event: CommittedEvent, context: CommitContext): Result<IncidentState> {
  switch (event.kind) {
    case 'telemetry.received': {
      const payload = event.payload;
      const producer = checkProducerPayload(state, payload.producer_id, payload.capture_epoch);
      if (!producer.ok) return producer;
      if (!state.seed.assets.some(value => value.asset_id === payload.asset_id)) return reject('INVALID_SCHEMA', 'Telemetry references an unknown asset');
      if (payload.mission_id === null ? payload.mission_version !== 0
        : !state.seed.candidates.some(value => value.asset_id === payload.asset_id && value.mission_id === payload.mission_id && value.mission_version === payload.mission_version)
          && !Object.values(state.commands).some(value => value.asset_id === payload.asset_id && value.mission_id === payload.mission_id && value.mission_version === payload.mission_version)) {
        return reject('INVALID_SCHEMA', 'Telemetry mission is not registered for this asset');
      }
      return success({ ...state, input_revision: state.input_revision + 1,
        telemetry: newerCapture(event, lookup(state.telemetry, payload.asset_id)) ? dictionary(state.telemetry, payload.asset_id, event) : state.telemetry });
    }
    case 'frame.received': {
      const payload = event.payload;
      const producer = checkProducerPayload(state, payload.capture_owner_id, payload.capture_epoch);
      if (!producer.ok) return producer;
      const feed = state.seed.feeds.find(value => value.feed_id === payload.feed_id);
      if (!feed || feed.asset_id !== payload.asset_id) return reject('INVALID_SCHEMA', 'Frame source/feed/asset registration does not match');
      if (feed.source_revision !== payload.source_revision) return reject('STALE_VERSION', 'Frame source revision does not match registration');
      return success({ ...state, input_revision: state.input_revision + 1,
        frames: newerCapture(event, lookup(state.frames, payload.feed_id)) ? dictionary(state.frames, payload.feed_id, event) : state.frames });
    }
    case 'hypothesis.received': {
      const payload = event.payload;
      if (payload.input_revision !== state.input_revision) return reject('STALE_VERSION', 'Hypothesis input revision is obsolete');
      if (!knownEvidence(state, payload.evidence_ids)
        || !state.log.some(value => value.kind === 'frame.received' && value.payload.source_snapshot_id === payload.source_snapshot_id)) {
        return reject('INVALID_SCHEMA', 'Hypothesis references unreceived evidence or source snapshot');
      }
      return success({ ...state, hypotheses: dictionary(state.hypotheses, payload.hypothesis_id, event) });
    }
    case 'proposal.created': {
      const valid = checkProposal(state, event, context);
      if (!valid.ok) return valid;
      return success({ ...state, proposals: dictionary(state.proposals, event.payload.proposal_id, event) });
    }
    case 'command.receipt': {
      const valid = checkReceipt(state, event);
      if (!valid.ok) return valid;
      return success({ ...state, commands: dictionary(state.commands, valid.value.command_id, receiptCommand(valid.value, event)) });
    }
    case 'authority.changed': {
      const payload = event.payload;
      if (payload.authority_active ? payload.next_authority_epoch <= state.authority_epoch || payload.capture_epoch <= state.capture_epoch
        : payload.next_authority_epoch !== state.authority_epoch + 1 || payload.capture_epoch !== state.capture_epoch || payload.producer_id !== state.producer_id) {
        return reject('STALE_VERSION', 'Loss must advance authority once; takeover must advance authority and capture leases');
      }
      return success({ ...state, authority_active: payload.authority_active, authority_epoch: payload.next_authority_epoch,
        producer_id: payload.producer_id, capture_epoch: payload.capture_epoch, proposals: dictionary() });
    }
    case 'chief.changed':
      if (event.payload.chief_epoch <= state.chief_epoch) return reject('STALE_VERSION', 'Chief epoch must strictly increase');
      return success({ ...state, chief_id: event.payload.chief_id, chief_epoch: event.payload.chief_epoch, proposals: dictionary() });
    case 'approval.committed':
      return reject('UNAUTHORIZED', 'Approval must use the trusted compare-and-commit path');
  }
}

export function commitEvent(state: IncidentState, input: unknown, context: CommitContext): Result<IncidentState> {
  const valid = validateEvent(input);
  if (!valid.ok) return valid;
  const event = valid.value;
  const trusted = checkContext(state, event, context);
  if (!trusted.ok) return trusted;
  if (event.incident_id !== state.incident_id || event.run_id !== state.run_id) return reject('STALE_VERSION', 'Event incident or run is obsolete');
  const duplicate = state.log.find(value => value.event_id === event.event_id);
  if (duplicate) {
    return duplicate.actor_id === context.actor.principal_id && sameJson(eventBody(duplicate), event)
      ? success(state) : reject('CONFLICT', 'Event identity has conflicting content or principal');
  }
  const ordered = checkOrder(state, event, context);
  if (!ordered.ok) return ordered;
  const committed = Object.freeze({ ...event, incident_revision: state.incident_revision + 1,
    actor_id: context.actor.principal_id, actor_kind: context.actor.actor_kind, session_id: context.actor.session_id,
    recorded_at: context.recorded_at, received_at: context.received_at, sim_tick: context.sim_tick });
  const transition = applyEvent(state, committed, context);
  if (!transition.ok) return transition;
  return success(owned({ ...transition.value, incident_revision: committed.incident_revision,
    stream_cursors: dictionary(state.stream_cursors, event.stream_id, event.stream_sequence),
    log: [...state.log, committed] }));
}
