import { types } from 'node:util';
import { validateEvent, validateSeed } from '../protocol/index.ts';
import { approveProposal, commitEvent, createIncidentState, validateCommandAcceptance } from '../state/index.ts';
import type { ActorContext, Command, CommitContext, IncidentSeed, IncidentState, Result } from '../protocol/types.ts';

export interface TrustedClock {
  readonly received_at: string;
  readonly sim_tick: number;
}

export type BridgeResult<T> = Result<T> | {
  readonly ok: false;
  readonly code: 'LIMIT_REACHED';
  readonly reason: string;
};

export interface BridgeAuthority {
  /** Internal state only. Never serialize this directly to an HTTP response. */
  read(): IncidentState;
  now(): TrustedClock;
  ingest(input: unknown, actor: ActorContext): BridgeResult<IncidentState>;
  approve(input: unknown, actor: ActorContext): BridgeResult<IncidentState>;
  pending(actor: ActorContext): BridgeResult<readonly Command[]>;
  check(input: unknown, actor: ActorContext): BridgeResult<Command>;
  heartbeat(actor: ActorContext): BridgeResult<null>;
  expireProducer(): BridgeResult<IncidentState>;
}

const success = <T>(value: T): BridgeResult<T> => Object.freeze({ ok: true, value });
const reject = (code: 'UNAUTHORIZED' | 'INVALID_SCHEMA' | 'INVALID_TIME' | 'FROZEN' | 'CONFLICT' | 'LIMIT_REACHED',
  reason: string): BridgeResult<never> => Object.freeze({ ok: false, code, reason });
const id = (value: unknown): value is string => typeof value === 'string'
  && value.length >= 1 && value.length <= 128 && value.trim().length > 0;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const terminal = (command: Command): boolean => ['completed', 'failed', 'cancelled', 'rejected'].includes(command.status);
const MAX_REVISIONS = 1000;
const PRODUCER_TIMEOUT_MS = 5000;

function utc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === (value.length === 20 ? `${value.slice(0, -1)}.000Z` : value);
}

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value); const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every(key => Object.hasOwn(descriptors, key))
    && ownKeys.every(key => typeof key === 'string' && keys.includes(key)
      && descriptors[key].enumerable && Object.hasOwn(descriptors[key], 'value'));
}

export interface BridgeAuthorityOptions { readonly await_producer?: boolean }

export function createBridgeAuthority(seed: IncidentSeed, clock: () => TrustedClock,
  options: BridgeAuthorityOptions = {}): BridgeResult<BridgeAuthority> {
  const valid = validateSeed(seed);
  if (!valid.ok) return valid;
  let state = createIncidentState(valid.value);
  let lastClock: TrustedClock;
  try {
    const initial = clock();
    if (!closed(initial, ['received_at', 'sim_tick']) || !utc(initial.received_at) || !integer(initial.sim_tick)) {
      return reject('INVALID_TIME', 'Expected a valid trusted exercise clock');
    }
    lastClock = Object.freeze({ received_at: initial.received_at, sim_tick: initial.sim_tick });
  } catch { return reject('INVALID_TIME', 'Trusted exercise clock unavailable'); }
  let heartbeatTime = Date.parse(lastClock.received_at);
  let producerArmed = !options.await_producer;

  function now(): TrustedClock {
    const next = clock();
    if (!closed(next, ['received_at', 'sim_tick']) || !utc(next.received_at) || !integer(next.sim_tick)
      || Date.parse(next.received_at) < Date.parse(lastClock.received_at) || next.sim_tick < lastClock.sim_tick) {
      throw new TypeError('Trusted exercise clock invalid or regressed');
    }
    lastClock = Object.freeze({ received_at: next.received_at, sim_tick: next.sim_tick });
    return lastClock;
  }

  function trusted(actor: ActorContext): BridgeResult<CommitContext> {
    if (!closed(actor, ['principal_id', 'session_id', 'incident_id', 'run_id', 'actor_kind', 'chief_epoch', 'producer_id', 'capture_epoch'])
      || ![actor.principal_id, actor.session_id, actor.incident_id, actor.run_id].every(id)
      || !['human', 'simulator', 'analyst', 'fixture'].includes(actor.actor_kind)
      || !(actor.chief_epoch === null || integer(actor.chief_epoch))
      || !(actor.producer_id === null || id(actor.producer_id))
      || !(actor.capture_epoch === null || integer(actor.capture_epoch))
      || actor.incident_id !== state.incident_id || actor.run_id !== state.run_id) {
      return reject('UNAUTHORIZED', 'Fixture actor is not a member of this exercise');
    }
    try {
      const time = now();
      return success({ actor, recorded_at: time.received_at, received_at: time.received_at, sim_tick: time.sim_tick, mode: 'live' });
    } catch { return reject('INVALID_TIME', 'Trusted exercise clock unavailable or regressed'); }
  }

  function producer(actor: ActorContext): BridgeResult<CommitContext> {
    const context = trusted(actor);
    if (!context.ok) return context;
    if (actor.actor_kind !== 'simulator' || actor.principal_id !== state.producer_id
      || actor.producer_id !== state.producer_id || actor.capture_epoch !== state.capture_epoch) {
      return reject('UNAUTHORIZED', 'Current designated producer fixture required');
    }
    return context;
  }

  function freeze(time: TrustedClock): BridgeResult<IncidentState> {
    if (!state.authority_active) return success(state);
    const stream_id = 'bridge:authority';
    const context: CommitContext = { actor: { principal_id: 'bridge-server', session_id: 'bridge-server',
      incident_id: state.incident_id, run_id: state.run_id, actor_kind: 'server', chief_epoch: null,
      producer_id: null, capture_epoch: null }, recorded_at: time.received_at, received_at: time.received_at,
      sim_tick: time.sim_tick, mode: 'live' };
    const next = commitEvent(state, { contract_version: state.contract_version, incident_id: state.incident_id,
      run_id: state.run_id, authority_epoch: state.authority_epoch, event_id: `bridge:freeze:${state.authority_epoch}`,
      stream_id, stream_sequence: (state.stream_cursors[stream_id] ?? 0) + 1, trace_id: 'bridge:producer-loss',
      causation_id: null, kind: 'authority.changed', payload: { authority_active: false, producer_id: state.producer_id,
        capture_epoch: state.capture_epoch, next_authority_epoch: state.authority_epoch + 1 } }, context);
    if (next.ok) state = next.value;
    return next;
  }

  function expire(time: TrustedClock): BridgeResult<IncidentState> {
    return producerArmed && Date.parse(time.received_at) - heartbeatTime > PRODUCER_TIMEOUT_MS ? freeze(time) : success(state);
  }

  function active(context: CommitContext): BridgeResult<null> {
    const expired = expire(context);
    if (!expired.ok) return expired;
    if (!state.authority_active) return reject('FROZEN', 'Exercise authority frozen, start a new reconciled run');
    return success(null);
  }

  function store(next: Result<IncidentState>, time: TrustedClock): BridgeResult<IncidentState> {
    if (!next.ok || next.value === state) return next;
    if (state.log.length >= MAX_REVISIONS - 1) {
      const frozen = freeze(time);
      if (!frozen.ok) return frozen;
      return reject('LIMIT_REACHED', 'Exercise revision limit reached, authority frozen');
    }
    state = next.value;
    return success(state);
  }

  function ingest(input: unknown, actor: ActorContext): BridgeResult<IncidentState> {
    const validEvent = validateEvent(input);
    if (!validEvent.ok) return validEvent;
    const event = validEvent.value;
    if (event.kind === 'authority.changed' || event.kind === 'chief.changed'
      || event.event_id.startsWith('bridge:') || event.stream_id.startsWith('bridge:')) {
      return reject('UNAUTHORIZED', 'Server ownership streams are not wire inputs');
    }
    const context = trusted(actor);
    if (!context.ok) return context;
    if (actor.actor_kind === 'human' && (actor.principal_id !== state.chief_id || actor.chief_epoch !== state.chief_epoch)) {
      return reject('UNAUTHORIZED', 'Only the current Chief fixture may propose');
    }
    const live = active(context.value);
    if (!live.ok) return live;
    const next = commitEvent(state, event, context.value);
    if (!next.ok && next.code === 'STREAM_GAP' && actor.actor_kind === 'simulator'
      && ['telemetry.received', 'frame.received', 'command.receipt'].includes(event.kind)) {
      // Semantic preflight on a discarded immutable state, never store the adjusted event.
      // A malformed foreign payload must not be able to freeze a valid producer run.
      const probe = commitEvent(state, { ...event, stream_sequence: (state.stream_cursors[event.stream_id] ?? 0) + 1 }, context.value);
      if (!probe.ok) return probe;
      const frozen = freeze(context.value);
      if (!frozen.ok) return frozen;
    }
    return store(next, context.value);
  }

  function approve(input: unknown, actor: ActorContext): BridgeResult<IncidentState> {
    const context = trusted(actor);
    if (!context.ok) return context;
    if (actor.actor_kind !== 'human' || actor.principal_id !== state.chief_id || actor.chief_epoch !== state.chief_epoch) {
      return reject('UNAUTHORIZED', 'Current Chief fixture required');
    }
    const live = active(context.value);
    if (!live.ok) return live;
    return store(approveProposal(state, input, context.value), context.value);
  }

  function pending(actor: ActorContext): BridgeResult<readonly Command[]> {
    const context = producer(actor);
    if (!context.ok) return context;
    const live = active(context.value);
    if (!live.ok) return live;
    return success(Object.freeze(Object.values(state.commands).filter(command => !terminal(command)
      && validateCommandAcceptance(state, command, context.value).ok)));
  }

  function check(input: unknown, actor: ActorContext): BridgeResult<Command> {
    const context = producer(actor);
    if (!context.ok) return context;
    const live = active(context.value);
    if (!live.ok) return live;
    if (!closed(input, ['command_id', 'expected_incident_revision']) || !id(input.command_id)
      || !integer(input.expected_incident_revision)) return reject('INVALID_SCHEMA', 'Expected a closed command check');
    if (input.expected_incident_revision !== state.incident_revision) return reject('CONFLICT', 'Incident revision changed');
    if (!Object.hasOwn(state.commands, input.command_id)) return reject('INVALID_SCHEMA', 'Command is not registered');
    return validateCommandAcceptance(state, state.commands[input.command_id], context.value);
  }

  function heartbeat(actor: ActorContext): BridgeResult<null> {
    const context = producer(actor);
    if (!context.ok) return context;
    const live = active(context.value);
    if (!live.ok) return live;
    heartbeatTime = Date.parse(context.value.received_at);
    producerArmed = true;
    return success(null);
  }

  function expireProducer(): BridgeResult<IncidentState> {
    try { return expire(now()); } catch { return reject('INVALID_TIME', 'Trusted exercise clock unavailable or regressed'); }
  }

  return success(Object.freeze({ read: () => state, now, ingest, approve, pending, check, heartbeat, expireProducer }));
}
