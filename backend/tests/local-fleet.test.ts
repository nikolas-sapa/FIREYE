import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalDemoSeed, readLocalDemoConfig } from '../config/local-demo.ts';
import { validateSeed } from '../protocol/index.ts';
import { startLocalBackend } from '../scripts/start-local.ts';
import type { BridgeView } from '../integration/received-view.ts';

test('F03 default local fixture declares six thermal drones and six feasible mission scopes', () => {
  const seed = createLocalDemoSeed();
  assert.equal(validateSeed(seed).ok, true);
  assert.deepEqual(seed.assets.map(a => a.asset_id), ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);
  assert.equal(seed.feeds.length, 6);
  assert.equal(seed.candidates.length, 6);
  for (let n = 1; n <= 6; n++) {
    const asset = seed.assets[n - 1];
    assert.deepEqual(asset.capabilities, ['thermal']);
    assert.equal(asset.thermal_feed_id, `t${n}`);
    const feed = seed.feeds[n - 1];
    assert.equal(feed.feed_id, asset.thermal_feed_id);
    assert.equal(feed.asset_id, asset.asset_id);
    assert.equal(feed.capture_owner_id, seed.producer_id);
    assert.equal(feed.synthetic, true);
    assert.equal(feed.radiometric, false);
    assert.equal(feed.calibration, null);
    const candidate = seed.candidates[n - 1];
    assert.equal(candidate.asset_id, asset.asset_id);
    assert.equal(candidate.candidate_id, `c${n}`);
    assert.equal(candidate.feasible, true);
    assert.equal(candidate.expires_at_sim_tick, 120);
  }
});

test('F03 loopback producer capability permits all six declared drones; 30-minute cap retained', async () => {
  const config = readLocalDemoConfig({ FCC_LOCAL_PORT: '0', FCC_LOCAL_CAPABILITY_TTL_MS: '1800000' });
  const backend = await startLocalBackend(config);
  try {
    assert.equal(new URL(backend.url).hostname, '127.0.0.1');
    for (let n = 1; n <= 6; n++) {
      const response = await fetch(`${backend.url}/incidents/${backend.incident_id}/events`, {
        method: 'POST', headers: { Origin: backend.allowed_origin,
          Authorization: `Bearer ${backend.setup.roles.producer.capability}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contract_version: 'backend-protocol.v1', incident_id: backend.incident_id,
          run_id: backend.run_id, authority_epoch: 1, event_id: `fleet-event${n}`, stream_id: `fleet:d${n}`,
          stream_sequence: 1, trace_id: `fleet-trace${n}`, causation_id: null, kind: 'telemetry.received',
          payload: { asset_id: `d${n}`, mission_id: null, mission_version: 0, captured_at: null,
            capture_time_status: 'unknown', sim_tick: 0, position: null, battery_percent: null,
            producer_id: backend.setup.roles.producer.principal_id, capture_epoch: 1 } }),
      });
      assert.equal(response.status, 200);
      const view = (await response.json() as { data: BridgeView }).data;
      assert.equal(view.telemetry[`d${n}`].payload.asset_id, `d${n}`);
      assert.deepEqual(view.candidates.map(c => c.asset_id), ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);
    }
    assert.equal(Object.keys(backend.authority.read().telemetry).length, 6);
  } finally { await backend.close(); }
  assert.throws(() => readLocalDemoConfig({ FCC_LOCAL_CAPABILITY_TTL_MS: '1800001' }), /FCC_LOCAL_CAPABILITY_TTL_MS/);
});
