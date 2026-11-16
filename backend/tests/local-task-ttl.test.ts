import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalDemoSeed, readLocalDemoConfig } from '../config/local-demo.ts';
import { startLocalBackend } from '../scripts/start-local.ts';

test('local task TTL defaults to 120; explicit 2400 survives launcher validation', async () => {
  assert.equal(readLocalDemoConfig({}).task_ttl_s, undefined);
  assert.ok(createLocalDemoSeed().candidates.every(c => c.expires_at_sim_tick === 120));
  const config = readLocalDemoConfig({ FCC_LOCAL_PORT: '0', FCC_LOCAL_TASK_TTL_S: '2400' });
  assert.equal(config.task_ttl_s, 2400);
  const backend = await startLocalBackend(config);
  try { assert.ok(backend.authority.read().seed.candidates.every(c => c.expires_at_sim_tick === 2400)); }
  finally { await backend.close(); }
  for (const value of ['1', '7200']) assert.equal(readLocalDemoConfig({ FCC_LOCAL_TASK_TTL_S: value }).task_ttl_s, Number(value));
});

test('local task TTL rejects empty, fractional, nonnumeric and out-of-range values', () => {
  for (const value of ['', '0', '-1', '1.5', 'NaN', '7201', '99999999999999999']) {
    assert.throws(() => readLocalDemoConfig({ FCC_LOCAL_TASK_TTL_S: value }), /FCC_LOCAL_TASK_TTL_S/);
  }
  for (const value of [0, -1, 1.5, NaN, Infinity, 7201]) assert.throws(() => createLocalDemoSeed(value), /task TTL/);
});
