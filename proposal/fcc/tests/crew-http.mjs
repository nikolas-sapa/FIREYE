import assert from 'node:assert/strict';
import { createBridgeAuthority } from '../../../backend/integration/session.ts';
import { startLocalBridge } from '../../../backend/integration/local-http.ts';
import { seed, context, telemetry, frame } from '../../../backend/tests/fixtures.ts';
import { CrewStore } from '../src/console/bus/crew-transport.ts';

const origin = 'http://localhost:5173';
let tick = 0;
let wall = Date.now();
const created = createBridgeAuthority(seed(), () => ({ received_at: new Date(wall).toISOString(), sim_tick: tick }));
assert.equal(created.ok, true);
if (!created.ok) throw new Error(created.reason);
const sessions = new Map([
  ['producer-fixture', { actor: context('simulator').actor, expires_at: new Date(Date.now() + 60000).toISOString() }],
  ['reader-fixture', { actor: context('fixture').actor, expires_at: new Date(Date.now() + 60000).toISOString() }],
]);
const bridge = await startLocalBridge(created.value, { port: 0, allowed_origin: origin, fixture_sessions: sessions });
let reads = 0, writes = 0;
const http = async (url, options) => {
  reads++;
  assert.equal(options.method, 'GET', 'consumer has no write request');
  return fetch(url, { ...options, headers: { ...options.headers, Origin: origin } });
};
const first = new CrewStore({ url: bridge.url, incident: 'i1', token: () => 'reader-fixture', fetchImpl: http });
const second = new CrewStore({ url: bridge.url, incident: 'i1', token: () => 'reader-fixture', fetchImpl: http });
try {
  await Promise.all([first.pollOnce(0), second.pollOnce(0)]);
  assert.equal(first.get().view.incident_revision, 0, 'initial revision zero is readable before any producer event');
  assert.equal(first.get().view.frames.t1, undefined);
  for (let n = 1; n <= 20; n++) {
    tick = n;
    const event = telemetry(n);
    const response = await fetch(`${bridge.url}/incidents/i1/events`, { method: 'POST',
      headers: { Origin: origin, Authorization: 'Bearer producer-fixture', 'Content-Type': 'application/json' },
      body: JSON.stringify(event) });
    writes++; assert.equal(response.status, 200); await response.arrayBuffer();
    await Promise.all([first.pollOnce(0), second.pollOnce(0)]);
    assert.deepEqual(first.get().view, second.get().view);
    assert.equal(first.get().view.incident_revision, n);
    assert.equal(first.get().view.telemetry.d1.payload.position.x_m, 100);
    assert.equal(first.get().view.coordinate_frame, null, 'raw metres never become map coordinates');
  }
  for (let n = 0; n < 10; n++) {
    first.stop();
    assert.equal(await first.pollOnce(0), false);
    assert.equal(first.get().view.incident_revision, 20);
  }
  const input = frame(1);
  const response = await fetch(`${bridge.url}/incidents/i1/events`, { method: 'POST',
    headers: { Origin: origin, Authorization: 'Bearer producer-fixture', 'Content-Type': 'application/json' },
    body: JSON.stringify(input) });
  writes++; assert.equal(response.status, 200); await response.arrayBuffer();
  await Promise.all([first.pollOnce(0), second.pollOnce(0)]);
  const received = first.get().view.frames.t1;
  assert.equal(received.payload.frame_id, input.payload.frame_id);
  assert.equal(received.payload.source_position, null);
  assert.equal(first.get().view.media_verified, false);
  assert.notEqual(received.received_at, received.payload.captured_at, 'actual receipt is not acquisition');
  assert.doesNotMatch(JSON.stringify(first.get().view), /reader-fixture|producer-fixture|"actor"|session_id|"seed"/);
  wall += 6000;
  await assert.rejects(first.pollOnce(0), /identity changed/i);
  assert.equal(first.get().state, 'error', 'producer-loss epoch change cannot leave a live UI state');
  const rejoined = new CrewStore({ url: bridge.url, incident: 'i1', token: () => 'reader-fixture', fetchImpl: http });
  try {
    await rejoined.pollOnce(0);
    assert.equal(rejoined.get().state, 'frozen', 'explicit reconnect reads actual frozen authority');
    assert.equal(rejoined.get().view.authority_active, false);
    assert.ok(rejoined.get().view.authority_epoch > first.get().view.authority_epoch);
  } finally { rejoined.stop(); }
  console.log(`Crew HTTP PASS: real exported bridge, 2 frontend readers, revision-zero seed, 20/20 converged commits, 10 rejoins, actual frame provenance; ${reads} reads/${writes} fixture writes, 0 consumer writes/providers.`);
} finally {
  first.stop(); second.stop();
  await bridge.close();
}
