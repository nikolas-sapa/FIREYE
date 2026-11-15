import { types } from 'node:util';
import type {
  ApprovalRequest, Asset, AuthorityPayload, Calibration, Candidate, CaptureClock,
  ChiefPayload, EventEnvelope, EventInput, Feed, FramePayload, HypothesisPayload,
  Identity, IncidentSeed, ModelScore, Position, ProposalPayload, ReceiptPayload,
  RejectionCode, Result, SourcePosition, TelemetryPayload,
} from './types.ts';

type Guard<T> = (input: unknown) => input is T;
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

const reservedKeys = new Set(['__proto__', 'constructor', 'prototype']);
const id = (input: unknown): input is string => typeof input === 'string'
  && input.length >= 1 && input.length <= 128 && input.trim().length > 0;
const text = (input: unknown): input is string => typeof input === 'string' && input.trim().length > 0;
const finite = (input: unknown): input is number => typeof input === 'number' && Number.isFinite(input);
const integer = (input: unknown): input is number => finite(input) && Number.isSafeInteger(input) && input >= 0;
const positiveInteger = (input: unknown): input is number => integer(input) && input > 0;
const boolean = (input: unknown): input is boolean => typeof input === 'boolean';
const nonnegative = (input: unknown): input is number => finite(input) && input >= 0;

function choice<T extends string>(input: unknown, choices: readonly T[]): input is T {
  return typeof input === 'string' && choices.some(value => value === input);
}

const invalid = (reason: string, code: RejectionCode = 'INVALID_SCHEMA'): Result<never> =>
  Object.freeze({ ok: false, code, reason });

function record(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

// Inspect descriptors, never call untrusted getters or proxy traps. This precedes all guards.
function json(input: unknown, active: WeakSet<object>, completed: WeakSet<object>): input is Json {
  if (input === null || typeof input === 'string' || typeof input === 'boolean') return true;
  if (typeof input === 'number') return Number.isFinite(input);
  if (typeof input !== 'object' || types.isProxy(input) || active.has(input)) return false;
  if (completed.has(input)) return true;
  const array = Array.isArray(input);
  const prototype = Object.getPrototypeOf(input);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(input);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (array && keys.length !== input.length + 1) return false;
  active.add(input);
  for (const key of keys) {
    if (typeof key !== 'string' || reservedKeys.has(key)) return false;
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) return false;
    if (array && key === 'length') continue;
    if (!descriptor.enumerable || (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length))) return false;
    if (!json(descriptor.value, active, completed)) return false;
  }
  active.delete(input);
  completed.add(input);
  return true;
}

function closed(input: unknown, required: readonly string[], optional: readonly string[] = []): input is Record<string, unknown> {
  if (!record(input)) return false;
  const keys = Object.keys(input);
  return required.every(key => Object.hasOwn(input, key))
    && keys.every(key => required.includes(key) || optional.includes(key));
}

function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return (input): input is T | null => input === null || guard(input);
}

function list<T>(input: unknown, guard: Guard<T>, nonempty = false): input is readonly T[] {
  return Array.isArray(input) && (!nonempty || input.length > 0) && input.every(guard);
}

function uniqueIds(input: unknown, nonempty = false): input is readonly string[] {
  return list(input, id, nonempty) && new Set(input).size === input.length;
}

function utc(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(input);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour < 24 && minute < 60 && second < 60;
}

const identityKeys = ['contract_version', 'incident_id', 'run_id', 'authority_epoch'] as const;
const envelopeKeys = [...identityKeys, 'event_id', 'stream_id', 'stream_sequence', 'trace_id', 'causation_id'] as const;

function identity(input: Record<string, unknown>): input is Record<string, unknown> & Identity {
  return input.contract_version === 'backend-protocol.v1'
    && id(input.incident_id) && id(input.run_id) && integer(input.authority_epoch);
}

function envelope(input: Record<string, unknown>): input is Record<string, unknown> & EventEnvelope {
  return identity(input) && id(input.event_id) && id(input.stream_id)
    && positiveInteger(input.stream_sequence) && id(input.trace_id) && nullable(id)(input.causation_id);
}

function clock(input: Record<string, unknown>): input is Record<string, unknown> & CaptureClock {
  return (input.capture_time_status === 'known' && utc(input.captured_at))
    || (input.capture_time_status === 'unknown' && input.captured_at === null);
}

function position(input: unknown): input is Position {
  return closed(input, ['x_m', 'y_m', 'z_m']) && finite(input.x_m) && finite(input.y_m) && finite(input.z_m);
}

function sourcePosition(input: unknown): input is SourcePosition {
  return closed(input, ['coordinate_frame', 'units', 'altitude_datum', 'x', 'y', 'z'])
    && text(input.coordinate_frame) && text(input.units) && text(input.altitude_datum)
    && finite(input.x) && finite(input.y) && finite(input.z);
}

function asset(input: unknown): input is Asset {
  if (!closed(input, ['asset_id', 'capabilities', 'thermal_feed_id'], ['eo_feed_id'])) return false;
  if (!id(input.asset_id) || !id(input.thermal_feed_id)
    || !list(input.capabilities, (value): value is 'thermal' | 'eo' => value === 'thermal' || value === 'eo', true)) return false;
  if (new Set(input.capabilities).size !== input.capabilities.length || !input.capabilities.includes('thermal')) return false;
  if (input.capabilities.includes('eo')) return id(input.eo_feed_id) && input.eo_feed_id !== input.thermal_feed_id;
  return !Object.hasOwn(input, 'eo_feed_id');
}

function calibration(input: unknown): input is Calibration {
  return closed(input, ['calibration_id', 'source_id', 'sensor_id', 'method', 'units', 'calibrated_at', 'verified_source', 'verification_status'])
    && id(input.calibration_id) && id(input.source_id) && id(input.sensor_id)
    && text(input.method) && text(input.units) && nullable(utc)(input.calibrated_at)
    && nullable(id)(input.verified_source)
    && (input.verification_status === 'verified' || input.verification_status === 'unverified' || input.verification_status === 'unknown');
}

function feed(input: unknown): input is Feed {
  if (!closed(input, ['feed_id', 'asset_id', 'modality', 'source_kind', 'synthetic', 'radiometric', 'calibration', 'source_id', 'source_revision', 'capture_owner_id', 'capture_epoch', 'status'])) return false;
  if (!id(input.feed_id) || !id(input.asset_id) || (input.modality !== 'thermal' && input.modality !== 'eo')
    || (input.source_kind !== 'simulated' && input.source_kind !== 'uploaded' && input.source_kind !== 'live')
    || !boolean(input.synthetic) || !(boolean(input.radiometric) || input.radiometric === 'unknown')
    || !nullable(calibration)(input.calibration) || !id(input.source_id) || !integer(input.source_revision)
    || !id(input.capture_owner_id) || !integer(input.capture_epoch)
    || !choice(input.status, ['available', 'paused', 'stale', 'unavailable'])) return false;
  if (input.source_kind === 'simulated' && (input.synthetic !== true || input.radiometric !== false || input.calibration !== null)) return false;
  if (input.modality === 'eo' && input.calibration !== null) return false;
  return input.calibration === null || input.calibration.source_id === input.source_id;
}

function candidate(input: unknown): input is Candidate {
  return closed(input, ['candidate_id', 'action_id', 'asset_id', 'mission_id', 'mission_version', 'route_id', 'plan_revision', 'feasibility_snapshot_id', 'feasible', 'expires_at_sim_tick'])
    && id(input.candidate_id) && id(input.action_id) && id(input.asset_id) && id(input.mission_id)
    && integer(input.mission_version) && id(input.route_id) && integer(input.plan_revision)
    && id(input.feasibility_snapshot_id) && boolean(input.feasible) && integer(input.expires_at_sim_tick);
}

function seedGuard(input: unknown): input is IncidentSeed {
  if (!closed(input, [...identityKeys, 'incident_revision', 'input_revision', 'plan_revision', 'reservation_revision', 'chief_id', 'chief_epoch', 'producer_id', 'capture_epoch', 'authority_active', 'assets', 'feeds', 'candidates'])) return false;
  if (!identity(input) || input.incident_revision !== 0 || input.input_revision !== 0
    || input.plan_revision !== 0 || input.reservation_revision !== 0 || !id(input.chief_id)
    || !integer(input.chief_epoch) || !id(input.producer_id) || !integer(input.capture_epoch)
    || !boolean(input.authority_active) || !list(input.assets, asset, true) || !list(input.feeds, feed, true)
    || !list(input.candidates, candidate)) return false;
  const assetIds = new Set(input.assets.map(value => value.asset_id));
  const feedIds = new Set(input.feeds.map(value => value.feed_id));
  if (assetIds.size !== input.assets.length || feedIds.size !== input.feeds.length
    || new Set(input.candidates.map(value => value.candidate_id)).size !== input.candidates.length) return false;
  const expected = input.assets.flatMap(value => [value.thermal_feed_id, ...(value.eo_feed_id ? [value.eo_feed_id] : [])]);
  if (new Set(expected).size !== expected.length || expected.length !== input.feeds.length) return false;
  for (const value of input.assets) {
    const thermal = input.feeds.find(item => item.feed_id === value.thermal_feed_id);
    if (!thermal || thermal.asset_id !== value.asset_id || thermal.modality !== 'thermal') return false;
    if (value.eo_feed_id) {
      const eo = input.feeds.find(item => item.feed_id === value.eo_feed_id);
      if (!eo || eo.asset_id !== value.asset_id || eo.modality !== 'eo') return false;
    }
  }
  return input.feeds.every(value => value.capture_owner_id === input.producer_id && value.capture_epoch === input.capture_epoch)
    && input.candidates.every(value => assetIds.has(value.asset_id) && value.plan_revision === input.plan_revision);
}

function telemetry(input: unknown): input is TelemetryPayload {
  return closed(input, ['asset_id', 'mission_id', 'mission_version', 'captured_at', 'capture_time_status', 'sim_tick', 'position', 'battery_percent', 'producer_id', 'capture_epoch'])
    && id(input.asset_id) && nullable(id)(input.mission_id) && integer(input.mission_version)
    && clock(input) && integer(input.sim_tick) && nullable(position)(input.position)
    && (input.battery_percent === null || (finite(input.battery_percent) && input.battery_percent >= 0 && input.battery_percent <= 100))
    && id(input.producer_id) && integer(input.capture_epoch);
}

const mediaReference = (input: unknown): input is string => id(input)
  && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input)
  && !/^(?:https?|file|data|javascript):/i.test(input);

function frame(input: unknown): input is FramePayload {
  return closed(input, ['frame_id', 'feed_id', 'asset_id', 'evidence_id', 'source_snapshot_id', 'source_revision', 'capture_owner_id', 'capture_epoch', 'captured_at', 'capture_time_status', 'sim_tick', 'source_position', 'location_uncertainty_m', 'mime_type', 'byte_length', 'media_ref', 'content_hash', 'width_px', 'height_px', 'media_limits_version'])
    && id(input.frame_id) && id(input.feed_id) && id(input.asset_id) && id(input.evidence_id)
    && id(input.source_snapshot_id) && integer(input.source_revision) && id(input.capture_owner_id)
    && integer(input.capture_epoch) && clock(input) && nullable(integer)(input.sim_tick)
    && nullable(sourcePosition)(input.source_position) && nullable(nonnegative)(input.location_uncertainty_m)
    && text(input.mime_type) && positiveInteger(input.byte_length) && mediaReference(input.media_ref)
    && id(input.content_hash) && positiveInteger(input.width_px) && positiveInteger(input.height_px) && id(input.media_limits_version);
}

function modelScore(input: unknown): input is ModelScore {
  return closed(input, ['value', 'scale']) && finite(input.value) && text(input.scale);
}

function hypothesis(input: unknown): input is HypothesisPayload {
  return closed(input, ['hypothesis_id', 'kind', 'verification_status', 'evidence_ids', 'source_snapshot_id', 'input_revision', 'geography', 'location_uncertainty_m', 'model_score', 'contradictions', 'critical'])
    && id(input.hypothesis_id) && choice(input.kind, ['human', 'animal', 'fire', 'gas_canister', 'other'])
    && input.verification_status === 'unverified' && uniqueIds(input.evidence_ids, true)
    && id(input.source_snapshot_id) && integer(input.input_revision) && nullable(position)(input.geography)
    && nullable(nonnegative)(input.location_uncertainty_m) && nullable(modelScore)(input.model_score)
    && list(input.contradictions, text) && boolean(input.critical);
}

function proposal(input: unknown): input is ProposalPayload {
  return closed(input, ['proposal_id', 'proposal_revision', 'candidate_ids', 'input_revision', 'plan_revision', 'reservation_revision', 'chief_epoch', 'rationale', 'expires_at_sim_tick'])
    && id(input.proposal_id) && integer(input.proposal_revision) && uniqueIds(input.candidate_ids, true)
    && integer(input.input_revision) && integer(input.plan_revision) && integer(input.reservation_revision)
    && integer(input.chief_epoch) && text(input.rationale) && integer(input.expires_at_sim_tick);
}

function receipt(input: unknown): input is ReceiptPayload {
  if (!closed(input, ['receipt_id', 'command_id', 'command_version', 'transmission_id', 'mission_id', 'mission_version', 'stage', 'captured_at', 'capture_time_status', 'sim_tick', 'producer_id', 'capture_epoch', 'reason', 'evidence_ids'])) return false;
  if (!id(input.receipt_id) || !id(input.command_id) || !integer(input.command_version) || !id(input.transmission_id)
    || !id(input.mission_id) || !integer(input.mission_version)
    || !choice(input.stage, ['sent', 'delivered', 'accepted', 'running', 'completed', 'failed', 'cancelled', 'rejected'])
    || !clock(input) || !integer(input.sim_tick) || !id(input.producer_id) || !integer(input.capture_epoch)
    || !nullable(text)(input.reason) || !uniqueIds(input.evidence_ids)) return false;
  if (choice(input.stage, ['completed', 'failed', 'cancelled']) && input.evidence_ids.length === 0) return false;
  return input.stage !== 'rejected' || text(input.reason);
}

function authority(input: unknown): input is AuthorityPayload {
  return closed(input, ['authority_active', 'producer_id', 'capture_epoch', 'next_authority_epoch'])
    && boolean(input.authority_active) && id(input.producer_id) && integer(input.capture_epoch) && integer(input.next_authority_epoch);
}

function chief(input: unknown): input is ChiefPayload {
  return closed(input, ['chief_id', 'chief_epoch']) && id(input.chief_id) && integer(input.chief_epoch);
}

function eventGuard(input: unknown): input is EventInput {
  if (!closed(input, [...envelopeKeys, 'kind', 'payload']) || !envelope(input)) return false;
  switch (input.kind) {
    case 'telemetry.received': return telemetry(input.payload);
    case 'frame.received': return frame(input.payload);
    case 'hypothesis.received': return hypothesis(input.payload);
    case 'proposal.created': return proposal(input.payload);
    case 'command.receipt': return receipt(input.payload);
    case 'authority.changed': return authority(input.payload);
    case 'chief.changed': return chief(input.payload);
    default: return false;
  }
}

function approvalGuard(input: unknown): input is ApprovalRequest {
  return closed(input, [...identityKeys, 'approval_id', 'proposal_id', 'proposal_revision', 'candidate_id', 'expected_incident_revision', 'input_revision', 'plan_revision', 'reservation_revision', 'chief_epoch', 'expires_at_sim_tick'])
    && identity(input) && id(input.approval_id) && id(input.proposal_id) && integer(input.proposal_revision)
    && id(input.candidate_id) && integer(input.expected_incident_revision) && integer(input.input_revision)
    && integer(input.plan_revision) && integer(input.reservation_revision) && integer(input.chief_epoch) && integer(input.expires_at_sim_tick);
}

function invalidTimes(input: Json, completed: WeakSet<object>): boolean {
  if (input === null || typeof input !== 'object') return false;
  if (completed.has(input)) return false;
  completed.add(input);
  if (Array.isArray(input)) return input.some(value => invalidTimes(value, completed));
  for (const [key, value] of Object.entries(input)) {
    if ((key === 'captured_at' || key === 'calibrated_at') && value !== null && !utc(value)) return true;
    if (invalidTimes(value, completed)) return true;
  }
  return false;
}

function freeze<T>(input: T): T {
  if (input !== null && typeof input === 'object' && !Object.isFrozen(input)) {
    for (const value of Object.values(input)) freeze(value);
    Object.freeze(input);
  }
  return input;
}

function validate<T>(input: unknown, guard: Guard<T>, name: string): Result<T> {
  try {
    if (!json(input, new WeakSet(), new WeakSet())) return invalid('Expected closed JSON data');
    if (record(input) && Object.hasOwn(input, 'contract_version') && input.contract_version !== 'backend-protocol.v1') {
      return invalid('Unsupported contract version', 'VERSION_MISMATCH');
    }
    if (invalidTimes(input, new WeakSet())) return invalid('Expected valid UTC calendar time', 'INVALID_TIME');
    if (!guard(input)) return invalid(`Invalid ${name} schema`);
    return Object.freeze({ ok: true, value: freeze(structuredClone(input)) });
  } catch {
    return invalid('Expected closed JSON data');
  }
}

export function validateSeed(input: unknown): Result<IncidentSeed> {
  return validate(input, seedGuard, 'incident seed');
}

export function validateEvent(input: unknown): Result<EventInput> {
  return validate(input, eventGuard, 'event');
}

export function validateApproval(input: unknown): Result<ApprovalRequest> {
  return validate(input, approvalGuard, 'approval request');
}
