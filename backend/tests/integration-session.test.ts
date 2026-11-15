import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridgeAuthority } from '../integration/session.ts';
import type { BridgeResult, TrustedClock } from '../integration/session.ts';
import { seed, context, telemetry, frame, proposal, approval, malformedEvents } from './fixtures.ts';

export function unwrap<T>(result: BridgeResult<T>): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function setup() {
  let clock: TrustedClock = { received_at: context().received_at, sim_tick: 1 };
  const authority = unwrap(createBridgeAuthority(seed(), () => clock));
  return { authority, setClock(value: TrustedClock) { clock = value; } };
}

test('B02 20 competitors yield 1 command and 10 identical retries add 0 revisions', async () => {
  const { authority } = setup();
  unwrap(authority.ingest(proposal(), context('analyst').actor));
  const results = await Promise.all(Array.from({ length: 20 }, (_, n) => Promise.resolve(
    authority.approve({ ...approval(), approval_id: `a${n}` }, context('human').actor))));
  assert.equal(results.filter(value => value.ok).length, 1);
  assert.equal(results.filter(value => !value.ok && value.code === 'CONFLICT').length, 19);
  assert.equal(Object.keys(authority.read().commands).length, 1);
  assert.equal(Object.keys(authority.read().reservations).length, 1);
  for (let n = 0; n < 10; n++) unwrap(authority.approve({ ...approval(), approval_id: 'a0' }, context('human').actor));
  assert.equal(authority.read().incident_revision, 2);
});

test('B03 100 malformed events and 20 wrong roles commit 0 records', () => {
  const { authority } = setup();
  for (const input of malformedEvents()) assert.equal(authority.ingest(input, context().actor).ok, false);
  for (let n = 0; n < 20; n++) assert.equal(authority.approve(approval(), context('fixture').actor).ok, false);
  assert.equal(authority.read().incident_revision, 0);
  const event = proposal();
  assert.equal(authority.ingest(event, { ...context('human').actor, principal_id: 'viewer' }).ok, false);
  assert.equal(authority.ingest({ ...telemetry(), run_id: 'foreign' }, context().actor).ok, false);
  assert.equal(authority.ingest(telemetry(), { ...context().actor, producer_id: 'foreign' }).ok, false);
});

test('B04 24 stale proposals yield 0 commands and 10 interleaves reject acceptance', () => {
  const { authority } = setup();
  unwrap(authority.ingest(telemetry(), context().actor));
  for (let n = 0; n < 24; n++) assert.equal(authority.ingest(proposal(), context('analyst').actor).ok, false);
  assert.equal(Object.keys(authority.read().commands).length, 0);
  for (let n = 0; n < 10; n++) {
    const fresh = setup().authority;
    unwrap(fresh.ingest(proposal(), context('analyst').actor));
    unwrap(fresh.approve(approval(), context('human').actor));
    unwrap(fresh.ingest(n % 2 === 0 ? telemetry() : frame(), context().actor));
    assert.equal(fresh.check({ command_id: 'command:a1', expected_incident_revision: 3 }, context().actor).ok, false);
    assert.equal(fresh.read().commands['command:a1'].status, 'enqueued');
    assert.equal(unwrap(fresh.pending(context().actor)).length, 0);
  }
});

test('B05 >5s absence freezes once, 10 old reconnects execute 0 commands', () => {
  const { authority, setClock } = setup();
  unwrap(authority.ingest(proposal(), context('analyst').actor));
  unwrap(authority.approve(approval(), context('human').actor));
  setClock({ received_at: '2026-11-14T00:00:06Z', sim_tick: 2 });
  unwrap(authority.expireProducer());
  assert.equal(authority.read().authority_active, true);
  setClock({ received_at: '2026-11-14T00:00:06.001Z', sim_tick: 2 });
  unwrap(authority.expireProducer());
  assert.equal(authority.read().authority_active, false);
  assert.equal(authority.read().incident_revision, 3);
  for (let n = 0; n < 10; n++) {
    assert.equal(authority.heartbeat(context().actor).ok, false);
    assert.equal(authority.pending(context().actor).ok, false);
    assert.equal(authority.check({ command_id: 'command:a1', expected_incident_revision: 3 }, context().actor).ok, false);
  }
  unwrap(authority.expireProducer());
  assert.equal(authority.read().incident_revision, 3);
  assert.equal(authority.read().commands['command:a1'].status, 'enqueued');
});

test('B05 valid producer gap freezes but malformed/foreign gaps cause 0 freezes', () => {
  const { authority } = setup();
  assert.equal(authority.ingest({ ...telemetry(3), payload: { ...telemetry(3).payload, producer_id: 'foreign' } }, context().actor).ok, false);
  assert.equal(authority.read().authority_active, true);
  assert.equal(authority.ingest(telemetry(3), context().actor).ok, false);
  assert.equal(authority.read().authority_active, false);
  assert.equal(authority.read().incident_revision, 1);
  assert.equal(authority.read().log[0].kind, 'authority.changed');
});

test('B03 check rejects extra keys, foreign actors and unknown command without mutation', () => {
  const { authority } = setup();
  unwrap(authority.ingest(proposal(), context('analyst').actor));
  unwrap(authority.approve(approval(), context('human').actor));
  for (const input of [{ command_id: 'command:a1', expected_incident_revision: 2, chief_id: 'chief1' },
    { command_id: 'missing', expected_incident_revision: 2 }, { command_id: 'command:a1', expected_incident_revision: 1 }]) {
    assert.equal(authority.check(input, context().actor).ok, false);
  }
  assert.equal(authority.pending(context('fixture').actor).ok, false);
  assert.equal(authority.read().incident_revision, 2);
  assert.equal(unwrap(authority.check({ command_id: 'command:a1', expected_incident_revision: 2 }, context().actor)).status, 'enqueued');
});

test('B03 cap freezes at 1000 revisions and 0 further commits', () => {
  const { authority } = setup();
  for (let n = 1; n <= 999; n++) unwrap(authority.ingest(telemetry(n), context().actor));
  const limited = authority.ingest(telemetry(1000), context().actor);
  assert.equal(limited.ok, false);
  if (!limited.ok) assert.equal(limited.code, 'LIMIT_REACHED');
  assert.equal(authority.read().incident_revision, 1000);
  assert.equal(authority.read().authority_active, false);
  assert.equal(authority.ingest(telemetry(1000), context().actor).ok, false);
  assert.equal(authority.read().incident_revision, 1000);
});
