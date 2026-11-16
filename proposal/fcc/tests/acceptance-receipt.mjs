import assert from 'node:assert/strict';
import { buildReceipt, CASE_IDS, receiptMarkdown } from '../scripts/acceptance-receipt.mjs';

const cases = Object.fromEntries(CASE_IDS.map(id => [id, { status: 'pass', reason: 'Executed fixture check' }]));
const input = { cases, date: '2026-11-16', git_sha: 'fixture-sha', working_tree_dirty: true, node: 'v24', os: 'Linux', cpu: 'fixture', seed: 9, duration_ms: 1 };
assert.equal(buildReceipt(input).aggregate, 'pass');
for (const status of ['skipped', 'fail']) {
  const r = buildReceipt({ ...input, cases: { ...cases, DA04: { status, reason: 'Not a browser measurement' } } });
  assert.equal(r.counts.pass, 10);
  assert.equal(r.counts[status], 1);
  assert.notEqual(r.aggregate, 'pass');
  assert.equal(r.mode, 'simulated-local-rehearsal');
  assert.match(receiptMarkdown(r), /SIMULATION ONLY/);
}
const empty = buildReceipt({ ...input, cases: {} });
assert.equal(empty.counts.pass, 0);
assert.equal(empty.counts.skipped, 11);
assert.equal(empty.aggregate, 'incomplete');
assert.throws(() => buildReceipt({ ...input, cases: { SC01: { status: 'green', reason: 'invalid' } } }), TypeError);
assert.throws(() => buildReceipt({ ...input, cases: { SC01: { status: 'pass', reason: '' } } }), TypeError);
assert.throws(() => buildReceipt({ ...input, os: { token: 'secret-sentinel' } }), TypeError);
assert.throws(() => buildReceipt({ ...input, checks: [{ name: 'bad', status: 'green', reason: 'invalid', duration_ms: 0 }] }), TypeError);
assert.equal(buildReceipt({ ...input, checks: [{ name: 'cleanup', status: 'fail', reason: 'failed', duration_ms: 1 }] }).aggregate, 'fail');
const r = buildReceipt({ ...input, token: 'secret-sentinel', roles: { chief: 'secret-sentinel' },
  cases: { ...cases, SC01: { ...cases.SC01, capability: 'secret-sentinel' } },
  checks: [{ name: 'fixture', status: 'pass', reason: 'safe', duration_ms: 1, authorization: 'secret-sentinel' }] });
assert.doesNotMatch(JSON.stringify(r), /secret-sentinel|token|capability|authorization|roles/);
console.log('Acceptance receipt PASS: skipped/failed never pass; 11 explicit cases, mode/disclaimer, empty/error handling, allowlisted fields.');
