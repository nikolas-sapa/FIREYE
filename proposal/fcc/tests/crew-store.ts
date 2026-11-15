import assert from 'node:assert/strict';
import { CrewStore } from '../src/console/bus/crew-transport';
import { parseCrewView } from '../src/console/bus/crew-view';

export const crewFixture = (revision = 1) => ({
  contract_version: 'backend-protocol.v1', bridge_version: 'backend-bridge.v1', mode: 'EXERCISE',
  incident_id: 'i1', run_id: 'r1', authority_epoch: 1, incident_revision: revision,
  input_revision: revision, plan_revision: 1, reservation_revision: 0, chief_epoch: 1,
  authority_active: true, as_of_received_at: '2026-11-15T08:00:00Z', media_verified: false, coordinate_frame: null,
  feeds: [{ feed_id: 't1', asset_id: 'd1', modality: 'thermal', source_kind: 'simulated', synthetic: true,
    radiometric: false, calibration: null, source_id: 'source1', source_revision: 1, capture_owner_id: 'p1', capture_epoch: 1, status: 'available' }],
  telemetry: { d1: { incident_revision: revision, received_at: '2026-11-15T07:59:59Z', payload: {
    asset_id: 'd1', mission_id: null, mission_version: 0, sim_tick: revision, position: null, battery_percent: null,
    producer_id: 'p1', capture_epoch: 1, captured_at: null, capture_time_status: 'unknown',
  } } }, frames: {}, hypotheses: {}, proposals: [], candidates: [], commands: [],
});

const base = crewFixture();
const critical = {
  incident_revision: 1, received_at: '2026-11-15T07:59:59Z', payload: {
    hypothesis_id: 'critical1', kind: 'human', verification_status: 'unverified', evidence_ids: ['e1'],
    source_snapshot_id: 's1', input_revision: 1, geography: null, location_uncertainty_m: null, model_score: null,
    contradictions: ['Occluded: location and identity unknown'], critical: true,
  },
};
assert.equal(parseCrewView({ data: base }, 'i1').telemetry.d1.payload.position, null);
for (let i = 0; i < 20; i++) {
  for (const invalid of [
    { ...base, contract_version: `unknown-${i}` }, { ...base, incident_id: 'foreign' },
    { ...base, incident_revision: NaN }, { ...base, frames: undefined },
    { ...base, feeds: [{ ...base.feeds[0], modality: 'infrared' }] },
    { ...base, telemetry: { d1: { ...base.telemetry.d1, incident_revision: 999 } } },
    { ...base, telemetry: { d1: { ...base.telemetry.d1, payload: { ...base.telemetry.d1.payload, position: { x_m: Infinity, y_m: 0, z_m: 0 } } } } },
  ]) assert.throws(() => parseCrewView(invalid, 'i1'), /snapshot/);
}
const withSecrets = { ...base, hidden_world: { answer: true }, telemetry: { d1: { ...base.telemetry.d1,
  actor: 'private-session', payload: { ...base.telemetry.d1.payload, hidden_answer: 'truth' } } } };
const filtered = parseCrewView(withSecrets, 'i1');
assert.doesNotMatch(JSON.stringify(filtered), /hidden|private-session|truth/);
assert.ok(Object.isFrozen(filtered.telemetry.d1.payload));
assert.throws(() => { (filtered as { incident_revision: number }).incident_revision = 500; });
console.log('CR01: malformed version/identity/revision/rows/enums rejected; unknowns and allowlisted immutable received facts PASS');

let next: unknown = { data: base };
const urls: string[] = [], requests: RequestInit[] = [];
const fetcher = (async (url, options) => {
  urls.push(String(url)); requests.push(options!);
  return next instanceof Response ? next : Response.json(next);
}) as typeof fetch;
const store = new CrewStore({ incident: 'i1', token: () => 'reader-test', fetchImpl: fetcher });
for (let rev = 1; rev <= 20; rev++) {
  next = { data: crewFixture(rev) }; await store.pollOnce(0);
  assert.equal(store.get().view?.incident_revision, rev);
}
next = { data: crewFixture(19) };
await assert.rejects(store.pollOnce(0), /revision/i);
assert.equal(store.get().view?.incident_revision, 20);
assert.ok(urls.at(-1)?.includes('after_revision=20'));
for (let i = 0; i < 10; i++) {
  store.stop();
  next = { data: crewFixture(20) }; await store.pollOnce(0);
  assert.equal(store.get().view?.incident_revision, 20);
}
next = new Response(null, { status: 204 });
await store.pollOnce(0);
assert.equal(store.get().state, 'connected', '204 recovers connectivity without fabricating source facts');
assert.equal(store.get().view?.incident_revision, 20);
for (const change of [{ run_id: 'r2' }, { authority_epoch: 2 }]) {
  next = { data: { ...crewFixture(21), ...change } };
  await assert.rejects(store.pollOnce(0), /reconnect/i);
  assert.equal(store.get().view?.run_id, 'r1');
}
next = { data: { ...crewFixture(21), authority_active: false } }; await store.pollOnce(0);
assert.equal(store.get().state, 'frozen');
assert.equal(store.get().view?.authority_active, false);
assert.ok(requests.every(r => !r.method || r.method === 'GET'));
assert.ok(requests.every(r => r.redirect === 'error' && r.credentials === 'omit' && r.cache === 'no-store'));
assert.ok(urls.every(u => !u.includes('reader-test')));
for (const url of ['https://evil.example', 'http://127.0.0.1:8787@evil.example', 'http://127.0.0.1:8787/?token=x', 'http://localhost.evil.example']) {
  assert.throws(() => new CrewStore({ url, incident: 'i1', token: () => 'secret' }), /loopback/i);
}

let release: ((r: Response) => void) | undefined;
const late = new CrewStore({ incident: 'i1', token: () => 'reader-test', fetchImpl: (() => new Promise<Response>(r => { release = r; })) as typeof fetch });
const pending = late.pollOnce(0);
const rejection = assert.rejects(pending, /stopped/i);
late.stop(); await rejection;
release!(Response.json({ data: base }));
await Promise.resolve(); await Promise.resolve();
assert.equal(late.get().view, null, 'late abort-insensitive reply cannot resurrect stopped state');
const failing = new CrewStore({ incident: 'i1', token: () => 'reader-test', fetchImpl: (async () => { throw new Error('secret-provider-body'); }) as typeof fetch });
await assert.rejects(failing.pollOnce(0), /unavailable/i);
assert.doesNotMatch(JSON.stringify(failing.get()), /secret-provider-body/);
const unauthorized = new CrewStore({ incident: 'i1', token: () => 'reader-test', fetchImpl: (async () => new Response('secret', { status: 401 })) as typeof fetch });
await assert.rejects(unauthorized.pollOnce(0), /capability/i);
assert.doesNotMatch(JSON.stringify(unauthorized.get()), /secret/);
let criticalNext = { ...crewFixture(1), hypotheses: { critical1: critical } };
const retained = new CrewStore({ incident: 'i1', token: () => 'reader-test', fetchImpl: (async () => Response.json({ data: criticalNext })) as typeof fetch });
await retained.pollOnce(0);
criticalNext = { ...crewFixture(2), hypotheses: {} as typeof criticalNext.hypotheses };
await assert.rejects(retained.pollOnce(0), /critical/i);
assert.equal(retained.get().view?.hypotheses.critical1.payload.critical, true);
const huge = new CrewStore({ incident: 'i1', token: () => 'reader-test', fetchImpl: (async () => new Response('x', { headers: { 'content-length': '3000000' } })) as typeof fetch });
await assert.rejects(huge.pollOnce(0), /limits/);
assert.equal(huge.get().view, null);
console.log('CR02/03: 20 revisions, 10 reconnects, rollback/run/epoch/freeze/204, late stop replies and loopback-only credential handling PASS');
