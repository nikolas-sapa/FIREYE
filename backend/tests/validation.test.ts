import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { validateApproval, validateEvent, validateSeed } from '../protocol/index.ts';
import { approval, frame, malformedEvents, proposal, seed, telemetry } from './fixtures.ts';
import type { EventInput } from '../protocol/types.ts';

test('BP01 rejects 100 malformed events with 10 valid positive controls', () => {
  const fixtures = malformedEvents();
  assert.equal(fixtures.length, 100);
  for (const input of fixtures) {
    const result = validateEvent(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.length > 0);
  }
  for (let n = 0; n < 10; n++) assert.equal(validateEvent(telemetry(n + 1)).ok, true);
});

test('BP02 four assets retain four thermal feeds and two distinct EO channels', () => {
  const result = validateSeed(seed());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(new Set(result.value.assets.map(asset => asset.thermal_feed_id)).size, 4);
  assert.equal(result.value.feeds.filter(feed => feed.modality === 'eo').length, 2);
  assert.equal(new Set(result.value.feeds.map(feed => feed.feed_id)).size, 6);
});

test('BP02 rejects 100 non-radiometric temperature fields', () => {
  const fields = ['temperature_celsius', 'temperature_samples', 'min_celsius', 'max_celsius', 'celsius_overlay'];
  for (let n = 0; n < 100; n++) {
    const event = frame(n + 1);
    assert.equal(validateEvent({ ...event, payload: { ...event.payload, [fields[n % fields.length]]: 100 } }).ok, false);
  }
});

test('BP02 preserves 10 explicit unknown capture and geography records', () => {
  for (let n = 1; n <= 10; n++) {
    const event = frame(n);
    const input = { ...event, payload: { ...event.payload, captured_at: null, capture_time_status: 'unknown', source_position: null, location_uncertainty_m: null } };
    const result = validateEvent(input);
    assert.equal(result.ok, true);
    if (!result.ok || result.value.kind !== 'frame.received') continue;
    assert.equal(result.value.payload.captured_at, null);
    assert.equal(result.value.payload.capture_time_status, 'unknown');
    assert.equal(result.value.payload.source_position, null);
    assert.equal(result.value.payload.location_uncertainty_m, null);
  }
});

test('BP01 validates approval concurrency without accepting body identities', () => {
  assert.equal(validateApproval(approval()).ok, true);
  for (const key of ['actor_id', 'actor_kind', 'session_id', 'chief_id']) {
    assert.equal(validateApproval({ ...approval(), [key]: 'chief1' }).ok, false);
  }
  assert.equal(validateEvent(proposal()).ok, true);
});

test('BP01 accepted event and seed outputs are owned immutable copies', () => {
  const input = telemetry();
  const before = structuredClone(input);
  const event = validateEvent(input);
  assert.equal(event.ok, true);
  if (event.ok && event.value.kind === 'telemetry.received' && input.kind === 'telemetry.received') {
    assert.notEqual(event.value, input);
    assert.notEqual(event.value.payload, input.payload);
    assert.notEqual(event.value.payload.position, input.payload.position);
    assert.ok(Object.isFrozen(event.value));
    assert.ok(Object.isFrozen(event.value.payload));
    assert.ok(Object.isFrozen(event.value.payload.position));
    assert.equal(Object.isFrozen(input), false);
    assert.deepEqual(input, before);
  }
  const originalSeed = seed();
  const registration = validateSeed(originalSeed);
  assert.equal(registration.ok, true);
  if (registration.ok) {
    assert.notEqual(registration.value.assets, originalSeed.assets);
    assert.ok(Object.isFrozen(registration.value.assets));
    assert.ok(Object.isFrozen(registration.value.assets[0]));
    assert.ok(Object.isFrozen(registration.value.assets[0].capabilities));
    assert.equal(Object.isFrozen(originalSeed.assets), false);
  }
});

test('BP01 accepts all seven closed event kinds without actor privilege', () => {
  const envelope = telemetry();
  const events: readonly EventInput[] = [
    envelope,
    frame(),
    proposal(),
    { ...envelope, kind: 'hypothesis.received', payload: {
      hypothesis_id: 'h1', kind: 'human', verification_status: 'unverified',
      evidence_ids: ['evidence1'], source_snapshot_id: 'snapshot1', input_revision: 0,
      geography: null, location_uncertainty_m: null, model_score: { value: 0.6, scale: 'model score 0-1' },
      contradictions: ['Smoke occludes the pixels.'], critical: true,
    } },
    { ...envelope, kind: 'command.receipt', payload: {
      receipt_id: 'receipt1', command_id: 'command:a1', command_version: 1,
      transmission_id: 'command:a1:tx:1', mission_id: 'm1', mission_version: 1,
      stage: 'completed', captured_at: '2026-11-14T00:00:01Z', capture_time_status: 'known',
      sim_tick: 1, producer_id: 'sim1', capture_epoch: 1, reason: null, evidence_ids: ['evidence1'],
    } },
    { ...envelope, kind: 'authority.changed', payload: { authority_active: false, producer_id: 'sim1', capture_epoch: 1, next_authority_epoch: 1 } },
    { ...envelope, kind: 'chief.changed', payload: { chief_id: 'chief2', chief_epoch: 2 } },
  ];
  assert.equal(events.length, 7);
  for (const event of events) {
    assert.equal(validateEvent(event).ok, true, event.kind);
    assert.equal(validateEvent({ ...event, actor_kind: 'human' }).ok, false, event.kind);
    assert.equal(validateEvent({ ...event, payload: { ...event.payload, hidden_truth: 'answer' } }).ok, false, event.kind);
  }
  const receipt = events[4];
  assert.equal(validateEvent({ ...receipt, payload: { ...receipt.payload, evidence_ids: [] } }).ok, false);
  assert.equal(validateEvent({ ...receipt, payload: { ...receipt.payload, stage: 'rejected', reason: null } }).ok, false);
  assert.equal(validateEvent({ ...receipt, payload: { ...receipt.payload, stage: 'delivered', evidence_ids: [] } }).ok, true);
});

test('BP01 rejects non-JSON objects without invoking accessors or proxy traps', () => {
  let reads = 0;
  const accessor = { ...telemetry() };
  Object.defineProperty(accessor, 'incident_id', { enumerable: true, get() { reads++; return 'i1'; } });
  const proxy = new Proxy(telemetry(), { get() { reads++; throw new Error('must not read'); } });
  const cycle = { ...telemetry(), extra: null as unknown };
  cycle.extra = cycle;
  const extraSymbol = { ...telemetry(), [Symbol('extra')]: 'hidden' };
  const hidden = { ...telemetry() };
  Object.defineProperty(hidden, 'extra', { value: true, enumerable: false });
  const cases: readonly unknown[] = [
    accessor, proxy, cycle, extraSymbol, hidden,
    Object.create(telemetry()), new Date(), [], null, undefined,
    { ...telemetry(), extra: 1n }, { ...telemetry(), extra: () => true },
    { ...telemetry(), extra: Symbol('value') },
    { ...proposal(), payload: { ...proposal().payload, candidate_ids: Array(1) } },
  ];
  for (const input of cases) assert.equal(validateEvent(input).ok, false);
  assert.equal(reads, 0);
  assert.equal(validateEvent(JSON.parse(JSON.stringify(telemetry()))).ok, true);
});

test('BP01 real UTC calendar accepts leap days but rejects rollover and unknown-clock mismatch', () => {
  for (const captured_at of ['2000-02-29T23:59:59.999Z', '2024-02-29T00:00:00Z', '2026-12-31T23:59:59Z']) {
    const event = telemetry();
    assert.equal(validateEvent({ ...event, payload: { ...event.payload, captured_at } }).ok, true);
  }
  const event = telemetry();
  assert.equal(validateEvent({ ...event, payload: { ...event.payload, captured_at: null, capture_time_status: 'known' } }).ok, false);
  assert.equal(validateEvent({ ...event, payload: { ...event.payload, capture_time_status: 'unknown' } }).ok, false);
  assert.equal(validateEvent({ ...event, payload: { ...event.payload, captured_at: null, capture_time_status: 'unknown', position: null, battery_percent: null } }).ok, true);
});

test('BP02 rejects reused channels and mismatched asset source registration', () => {
  const original = seed();
  const mutations: readonly unknown[] = [
    { ...original, assets: original.assets.map((asset, n) => n === 0 ? { ...asset, capabilities: ['eo'] } : asset) },
    { ...original, assets: original.assets.map((asset, n) => n === 1 ? { ...asset, thermal_feed_id: 't1' } : asset) },
    { ...original, assets: original.assets.map((asset, n) => n === 0 ? { ...asset, eo_feed_id: 't1' } : asset) },
    { ...original, feeds: original.feeds.map((feed, n) => n === 0 ? { ...feed, modality: 'eo' } : feed) },
    { ...original, feeds: original.feeds.map((feed, n) => n === 0 ? { ...feed, asset_id: 'missing' } : feed) },
    { ...original, feeds: original.feeds.map((feed, n) => n === 0 ? { ...feed, synthetic: false } : feed) },
    { ...original, feeds: original.feeds.map((feed, n) => n === 0 ? { ...feed, radiometric: true } : feed) },
    { ...original, feeds: original.feeds.map((feed, n) => n === 0 ? { ...feed, capture_owner_id: 'sim2' } : feed) },
    { ...original, feeds: original.feeds.map((feed, n) => n === 0 ? { ...feed, capture_epoch: 0 } : feed) },
    { ...original, candidates: original.candidates.map((candidate, n) => n === 0 ? { ...candidate, asset_id: 'missing' } : candidate) },
    { ...original, incident_revision: 1 },
  ];
  for (const input of mutations) assert.equal(validateSeed(input).ok, false);
  assert.equal(validateSeed(original).ok, true);
});

test('BP02 uploaded unknown radiometry retains source flags without temperature fields', () => {
  const original = seed();
  const input = { ...original, feeds: original.feeds.map((feed, n) => n === 0
    ? { ...feed, source_kind: 'uploaded', synthetic: false, radiometric: 'unknown' }
    : feed) };
  const result = validateSeed(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.feeds[0].source_kind, 'uploaded');
    assert.equal(result.value.feeds[0].synthetic, false);
    assert.equal(result.value.feeds[0].radiometric, 'unknown');
    assert.equal(result.value.feeds[0].calibration, null);
  }
});

test('BP01 rejects invalid approval integers and canonical event fields', () => {
  const request = approval();
  for (const key of ['authority_epoch', 'proposal_revision', 'expected_incident_revision', 'input_revision', 'plan_revision', 'reservation_revision', 'chief_epoch', 'expires_at_sim_tick']) {
    for (const value of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal(validateApproval({ ...request, [key]: value }).ok, false);
    }
  }
  for (const key of ['approval_id', 'proposal_id', 'candidate_id', 'incident_id', 'run_id']) {
    for (const value of ['', ' ', 'x'.repeat(129)]) assert.equal(validateApproval({ ...request, [key]: value }).ok, false);
  }
  assert.equal(validateApproval({ ...request, contract_version: 'backend-protocol.v0' }).ok, false);
  assert.equal(validateEvent({ ...telemetry(), kind: 'approval.committed', payload: { request } }).ok, false);
  for (const key of ['incident_revision', 'recorded_at', 'received_at', 'sim_tick', 'actor_id', 'actor_kind', 'session_id']) {
    assert.equal(validateEvent({ ...telemetry(), [key]: 1 }).ok, false);
  }
});

test('BP01 enum arrays cannot masquerade as feed status, hypothesis kind or receipt stage', () => {
  const original = seed();
  assert.equal(validateSeed({ ...original, feeds: original.feeds.map((feed, n) => n === 0 ? { ...feed, status: ['available'] } : feed) }).ok, false);
  const event = telemetry();
  const hypothesis = { ...event, kind: 'hypothesis.received', payload: {
    hypothesis_id: 'h1', kind: ['human'], verification_status: 'unverified', evidence_ids: ['evidence1'],
    source_snapshot_id: 'snapshot1', input_revision: 0, geography: null, location_uncertainty_m: null,
    model_score: null, contradictions: [], critical: false,
  } };
  const receipt = { ...event, kind: 'command.receipt', payload: {
    receipt_id: 'receipt1', command_id: 'command:a1', command_version: 1, transmission_id: 'tx1',
    mission_id: 'm1', mission_version: 1, stage: ['accepted'], captured_at: null, capture_time_status: 'unknown',
    sim_tick: 1, producer_id: 'sim1', capture_epoch: 1, reason: null, evidence_ids: [],
  } };
  assert.equal(validateEvent(hypothesis).ok, false);
  assert.equal(validateEvent(receipt).ok, false);
  assert.equal(validateSeed(original).ok, true);
});

test('BP01 media references admit opaque namespaces but never URL or path data', () => {
  for (const media_ref of ['media1', 'media:frame-1.png', 'scope_1:frame.2']) {
    const event = frame();
    assert.equal(validateEvent({ ...event, payload: { ...event.payload, media_ref } }).ok, true);
  }
  for (const media_ref of ['https://example.com/pixels', 'http:payload', 'HTTPS:payload', 'file:path', 'data:payload', 'javascript:alert', '/etc/passwd', '../pixels', 'scope\\pixels', ' pixels', '-pixels']) {
    const event = frame();
    assert.equal(validateEvent({ ...event, payload: { ...event.payload, media_ref } }).ok, false);
  }
});

test('BP02 calibration is closed, source-linked and EO rejects thermal calibration', () => {
  const original = seed();
  const calibration = {
    calibration_id: 'cal1', source_id: 'source-d1', sensor_id: 'sensor1', method: 'source supplied', units: 'source units',
    calibrated_at: null, verified_source: null, verification_status: 'unknown',
  };
  const registered = { ...original, feeds: original.feeds.map((feed, n) => n === 0
    ? { ...feed, source_kind: 'uploaded', synthetic: false, radiometric: 'unknown', calibration }
    : feed) };
  assert.equal(validateSeed(registered).ok, true);
  for (const alteration of [
    { ...calibration, source_id: 'another-source' },
    { ...calibration, verification_status: 'confirmed' },
    { ...calibration, calibrated_at: '2026-02-30T00:00:00Z' },
    { ...calibration, temperature_celsius: 100 },
  ]) {
    const input = { ...registered, feeds: registered.feeds.map((feed, n) => n === 0 ? { ...feed, calibration: alteration } : feed) };
    assert.equal(validateSeed(input).ok, false);
  }
  const eo = { ...registered, feeds: registered.feeds.map((feed, n) => n === 4
    ? { ...feed, source_kind: 'uploaded', synthetic: false, calibration }
    : feed) };
  assert.equal(validateSeed(eo).ok, false);
});

test('BP01 JSON-safe malformed payloads retain exact type, finite and closed-key guards', () => {
  const event = telemetry();
  const badPositions = [
    { x_m: NaN, y_m: 0, z_m: 0 }, { x_m: 0, y_m: Infinity, z_m: 0 },
    { x_m: 0, y_m: 0, z_m: -Infinity }, { x_m: 0, y_m: 0 },
    { x_m: 0, y_m: 0, z_m: 0, hidden_truth: true }, [0, 0, 0],
  ];
  for (const position of badPositions) assert.equal(validateEvent({ ...event, payload: { ...event.payload, position } }).ok, false);
  for (const battery_percent of [-1, 101, '90', NaN, Infinity]) {
    assert.equal(validateEvent({ ...event, payload: { ...event.payload, battery_percent } }).ok, false);
  }
  for (const battery_percent of [0, 100, null]) {
    assert.equal(validateEvent({ ...event, payload: { ...event.payload, battery_percent } }).ok, true);
  }
  const pixels = frame();
  for (const key of ['byte_length', 'width_px', 'height_px']) {
    for (const value of [0, -1, 0.5, '320', Infinity]) {
      assert.equal(validateEvent({ ...pixels, payload: { ...pixels.payload, [key]: value } }).ok, false);
    }
  }
  assert.equal(validateEvent({ ...pixels, payload: { ...pixels.payload, location_uncertainty_m: -1 } }).ok, false);
  assert.equal(validateEvent({ ...pixels, payload: { ...pixels.payload, source_position: {
    coordinate_frame: 'local', units: 'm', altitude_datum: 'AMSL', x: 10, y: 20, z: 30,
  } } }).ok, true);
});

test('BP01 errors are finite structured reasons and valid outputs never freeze callers', () => {
  const badTime = telemetry();
  const time = validateEvent({ ...badTime, payload: { ...badTime.payload, captured_at: '2026-02-30T00:00:00Z' } });
  assert.equal(time.ok, false);
  if (!time.ok) assert.equal(time.code, 'INVALID_TIME');
  const version = validateApproval({ ...approval(), contract_version: 'backend-protocol.v0' });
  assert.equal(version.ok, false);
  if (!version.ok) assert.equal(version.code, 'VERSION_MISMATCH');
  const input = approval();
  const result = validateApproval(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.notEqual(result.value, input);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.value));
    assert.equal(Object.isFrozen(input), false);
    assert.deepEqual(result.value, input);
  }
});

test('BP01 shared depth-30 acyclic invalid data rejects within 100ms', () => {
  let extra: unknown = { leaf: 'untrusted' };
  for (let depth = 0; depth < 30; depth++) extra = { left: extra, right: extra };
  const started = performance.now();
  const result = validateEvent({ ...telemetry(), extra });
  const elapsed = performance.now() - started;
  assert.equal(result.ok, false);
  assert.ok(elapsed < 100, `Shared depth-30 DAG rejection took ${elapsed.toFixed(3)}ms`);
});

test('BP01 valid shared acyclic records remain accepted, aliased and owned frozen copies', () => {
  const original = seed();
  const shared = ['thermal', 'eo'] as const;
  const input = { ...original, assets: original.assets.map((asset, n) => n < 2
    ? { ...asset, capabilities: shared }
    : asset) };
  const result = validateSeed(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.assets[0].capabilities, result.value.assets[1].capabilities);
    assert.notEqual(result.value.assets[0].capabilities, shared);
    assert.ok(Object.isFrozen(result.value.assets[0].capabilities));
    assert.equal(Object.isFrozen(shared), false);
    assert.equal(Object.isFrozen(input), false);
    assert.deepEqual(result.value, input);
  }
  const cycle: { left?: unknown } = {};
  cycle.left = cycle;
  assert.equal(validateEvent({ ...telemetry(), extra: cycle }).ok, false);
});
