import assert from 'node:assert/strict';
import { startLocalBackend } from '../../../backend/scripts/start-local.ts';
import { OpsBridge, parseOpsSetup, approveWithBridge } from '../src/console/bus/ops-bridge.ts';
import { CrewStore } from '../src/console/bus/crew-transport.ts';

const origin = 'http://localhost:5173';
const backend = await startLocalBackend({ mode: 'EXERCISE', providers: 'disabled', port: 0, allowed_origin: origin, capability_ttl_ms: 60000 });
const setup = parseOpsSetup(JSON.stringify({ url: backend.url, incident_id: backend.incident_id, run_id: backend.run_id, ...backend.setup }));
const paths = [];
const http = (url, options) => {
  paths.push(String(url).split('/').at(-1));
  return fetch(url, { ...options, headers: { ...options.headers, Origin: origin } });
};
const bridge = new OpsBridge(setup, http);
const crew = new CrewStore({ url: backend.url, incident: backend.incident_id, token: () => backend.setup.roles.reader.capability,
  fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: origin } }) });
const action = { id: 'local-d1-task', kind: 'retask-drone', title: 'Inspect simulated report', summary: 'Local exercise',
  risk: 'high', requiresApproval: true, status: 'proposed', proposedAt: 0, audiences: [], unitIds: ['uav-1'], target: { lat: 38, lon: 24 } };
try {
  let executed = 0;
  await approveWithBridge(bridge, action, () => { executed++; }, 0);
  assert.equal(executed, 1);
  assert.ok(paths.includes('commands')); assert.ok(paths.includes('command-checks')); assert.ok(paths.includes('producer-heartbeats'));
  await crew.pollOnce(0);
  assert.equal(crew.get().view.commands[0].status, 'running');
  await bridge.observe([{ ...action, status: 'done' }], 12);
  await crew.pollOnce(0);
  assert.equal(crew.get().view.commands[0].status, 'completed');
  assert.equal(Object.keys(backend.authority.read().commands).length, 1);
  assert.equal(backend.authority.read().log.filter(e => e.kind === 'command.receipt' && e.payload.stage === 'completed').length, 1);
  const completed = backend.authority.read().log.find(e => e.kind === 'command.receipt' && e.payload.stage === 'completed');
  const evidence = backend.authority.read().log.find(e => e.kind === 'frame.received');
  assert.deepEqual(completed.payload.evidence_ids, [evidence.payload.evidence_id]);
  assert.equal(evidence.payload.asset_id, 'd1');
  assert.equal(evidence.payload.media_limits_version, 'ops-simulated-execution.v1');
  assert.equal(crew.get().view.media_verified, false);
  const denied = new OpsBridge({ ...setup, roles: { ...setup.roles, chief: { capability: 'invalid-fixture' } } }, http);
  await assert.rejects(approveWithBridge(denied, { ...action, id: 'denied' }, () => executed++, 0), /UNAUTHENTICATED/);
  assert.equal(executed, 1);
  console.log('OPS-BRIDGE-HTTP: real loopback approval, producer check, 1 execution, 1 completed Crew command; denied capability executes 0 PASS');
  for (const [index, committed] of [[2, true], [3, false]]) {
    const ambiguous = new OpsBridge(setup, async (url, options) => {
      const event = options?.body ? JSON.parse(options.body) : null;
      if (event?.kind === 'command.receipt' && event.payload.stage === 'running') {
        if (committed) await http(url, options);
        throw new TypeError('Lost running receipt reply');
      }
      return http(url, options);
    });
    const proposed = { ...action, id: `ambiguous-${index}`, unitIds: [`uav-${index}`] };
    await assert.rejects(approveWithBridge(ambiguous, proposed, () => executed++, 0), /Backend unavailable/);
    assert.equal(ambiguous.pending, 1);
    assert.equal(executed, 1);
    const count = Object.keys(backend.authority.read().commands).length;
    await assert.rejects(approveWithBridge(ambiguous, proposed, () => executed++, 0), /already pending/);
    assert.equal(Object.keys(backend.authority.read().commands).length, count);
    await crew.pollOnce(0);
    assert.equal(crew.get().view.commands.find(c => c.asset_id === `d${index}`).status, committed ? 'running' : 'enqueued');
    await ambiguous.observe([proposed], 1);
    await ambiguous.observe([proposed], 2);
    await crew.pollOnce(0);
    assert.equal(crew.get().view.commands.find(c => c.asset_id === `d${index}`).status, 'cancelled');
    assert.equal(ambiguous.pending, 0);
    assert.equal(executed, 1);
    assert.equal(backend.authority.read().log.filter(e => e.kind === 'command.receipt'
      && e.payload.stage === 'cancelled' && e.payload.mission_id === `m${index}`).length, 1);
  }
  console.log('OPS-BRIDGE-HTTP-AMBIGUOUS: committed/lost and uncommitted running replies retain binding, block duplicate approvals, execute 0 and reach exactly 1 cancelled Crew receipt each PASS');
} finally { crew.stop(); await backend.close(); }
