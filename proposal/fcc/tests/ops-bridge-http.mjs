import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startLocalBackend } from '../../../backend/scripts/start-local.ts';
import { OpsBridge, parseOpsSetup, approveWithBridge, candidateForAction } from '../src/console/bus/ops-bridge.ts';
import { CrewStore } from '../src/console/bus/crew-transport.ts';
import { loadScenario } from '../src/console/scenario/index.ts';
import { createBus } from '../src/console/bus/index.ts';
import { Runtime } from '../src/console/world/runtime.ts';
import { fastForward, ops } from '../src/console/world/engine.ts';

const originalFetch = globalThis.fetch;
const root = resolve('public');
let pack;
try {
  globalThis.fetch = async url => {
    const path = resolve(root, `.${String(url)}`);
    assert.ok(path.startsWith(`${root}/`));
    return new Response(readFileSync(path));
  };
  pack = await loadScenario('mati-2018');
} finally { globalThis.fetch = originalFetch; }
const rt = new Runtime(pack, createBus());
fastForward(rt.sim, Date.parse('2018-07-23T16:44:00+03:00'), { speed: 60, dtReal: 0.5 });
const firstRetask = rt.sim.actions.filter(a => a.kind === 'retask-drone').sort((a, b) => a.proposedAt - b.proposedAt)[0];
assert.ok(firstRetask, 'normal Mati playback produces a retask');
assert.deepEqual(firstRetask.unitIds, ['uav-4']);
assert.match(firstRetask.title, /AETOS-4/);

const origin = 'http://localhost:5173';
const backend = await startLocalBackend({ mode: 'EXERCISE', providers: 'disabled', port: 0, allowed_origin: origin,
  capability_ttl_ms: 1800000, task_ttl_s: 2400 }, undefined, undefined, { await_producer: true });
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
async function withExercise(check) {
  const backend = await startLocalBackend({ mode: 'EXERCISE', providers: 'disabled', port: 0, allowed_origin: origin,
    capability_ttl_ms: 1800000, task_ttl_s: 2400 }, undefined, undefined, { await_producer: true });
  const setup = parseOpsSetup(JSON.stringify({ url: backend.url, incident_id: backend.incident_id, run_id: backend.run_id, ...backend.setup }));
  const http = (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: origin } });
  const crew = new CrewStore({ url: backend.url, incident: backend.incident_id, token: () => backend.setup.roles.reader.capability,
    fetchImpl: http });
  try { await check({ backend, setup, http, crew }); }
  finally { crew.stop(); await backend.close(); }
}
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
  const snapshot = await bridge.snapshot();
  for (let n = 1; n <= 6; n++) {
    assert.equal(candidateForAction({ ...firstRetask, unitIds: [`uav-${n}`] }, snapshot.candidates, snapshot.feeds).asset_id, `d${n}`);
  }
  assert.equal(candidateForAction(firstRetask, snapshot.candidates, snapshot.feeds).candidate_id, 'c4');
  await approveWithBridge(bridge, firstRetask, () => { ops.approve(rt.sim, firstRetask.id); executed++; }, Math.floor(rt.sim.t / 1000));
  assert.equal(executed, 2);
  const local = rt.sim.actions.find(a => a.id === firstRetask.id);
  assert.equal(local.status, 'executing');
  assert.equal(rt.sim.units.find(u => u.id === 'uav-4').taskId, firstRetask.id);
  const command = Object.values(backend.authority.read().commands).find(c => c.asset_id === 'd4');
  assert.ok(command);
  assert.equal(command.status, 'running');
  await crew.pollOnce(0);
  assert.equal(crew.get().view.commands.find(c => c.asset_id === 'd4').status, 'running');
  const count = Object.keys(backend.authority.read().commands).length;
  await assert.rejects(approveWithBridge(bridge, { ...firstRetask, id: 'unsupported', unitIds: ['uav-7'] }, () => executed++, 0), /Unsupported backend asset: uav-7/);
  assert.equal(executed, 2);
  assert.equal(Object.keys(backend.authority.read().commands).length, count);
  console.log('F03 real dev:full server path: 6/6 candidates; first generated Mati retask AETOS-4 approved, local task executing and Crew command d4 running; unknown asset executes 0 PASS');

  for (const failure of ['committed', 'uncommitted', 'malformed', 'command-read']) {
    let loseReply = true;
    let offline = false;
    let localExecutions = 0;
    const approvalIds = [];
    const recovering = new OpsBridge(setup, async (url, options) => {
      if (offline) throw new TypeError('Offline during reconciliation');
      if (String(url).endsWith('/approvals')) {
        const approval = JSON.parse(options.body);
        approvalIds.push(approval.approval_id);
        assert.equal(recovering.pending, 1, 'approval identity retained before mutation');
        if (loseReply && failure !== 'command-read') {
          loseReply = false;
          if (failure !== 'uncommitted') await http(url, options);
          if (failure === 'malformed') return new Response('{', { status: 200 });
          throw new TypeError('Lost approval reply');
        }
      }
      if (loseReply && failure === 'command-read' && String(url).endsWith('/commands')) {
        loseReply = false;
        throw new TypeError('Lost command query reply');
      }
      return http(url, options);
    });
    const proposed = { ...action, id: `lost-approval-${failure}`, unitIds: ['uav-5'] };
    await assert.rejects(approveWithBridge(recovering, proposed, () => localExecutions++, 0), /Backend unavailable|outcome is unknown/);
    assert.equal(localExecutions, 0);
    assert.equal(recovering.pending, 1);
    const before = Object.values(backend.authority.read().commands).filter(c => c.approval_id === approvalIds[0]);
    assert.equal(before.length, failure === 'uncommitted' ? 0 : 1);
    if (before.length) assert.equal(before[0].status, 'enqueued');
    offline = true;
    await assert.rejects(approveWithBridge(recovering, proposed, () => localExecutions++, 0), /Backend unavailable/);
    assert.equal(localExecutions, 0, 'retained approval blocks offline local fallback');
    assert.equal(recovering.pending, 1);
    offline = false;
    if (failure !== 'uncommitted') {
      await recovering.observe([proposed], 1);
      assert.equal(recovering.pending, 0);
      assert.equal(localExecutions, 0, 'reconciliation never starts local execution');
    }
    await approveWithBridge(recovering, proposed, () => localExecutions++, 2);
    assert.equal(localExecutions, 1, 'explicit retry succeeds');
    assert.equal(recovering.pending, 1);
    assert.equal(approvalIds[0], approvalIds[1], 'ambiguous approval replay uses the stable identity');
    assert.notEqual(approvalIds[0], approvalIds.at(-1), 'new identity only after prior command is cancelled');
    const old = Object.values(backend.authority.read().commands).filter(c => c.approval_id === approvalIds[0]);
    assert.equal(old.length, 1);
    assert.equal(old[0].status, 'cancelled');
    await recovering.observe([{ ...proposed, status: 'done' }], 3);
    assert.equal(recovering.pending, 0);
    await crew.pollOnce(0);
    assert.equal(crew.get().view.commands.find(c => c.approval_id === approvalIds[0]).status, 'cancelled');
  }
  console.log('F04 real HTTP: committed/lost, uncommitted, malformed approval replies and lost command query retain identity; offline fallback executes 0; reconciliation cancels exactly 1 old command and explicit retries succeed (4/4) PASS');

  await withExercise(async ({ backend, setup, http, crew }) => {
    for (const failure of ['throw', 'async-reject', 'rewound-before-start']) {
      let localExecutions = 0;
      let valid = true;
      const cancelling = new OpsBridge(setup, async (url, options) => {
        const response = await http(url, options);
        if (failure === 'rewound-before-start' && String(url).endsWith('/command-checks')) valid = false;
        return response;
      });
      const proposed = { ...action, id: `callback-${failure}`, unitIds: ['uav-6'] };
      await assert.rejects(approveWithBridge(cancelling, proposed, () => {
        if (failure === 'async-reject') return Promise.reject(new Error('Local task changed during approval; no local execution'));
        if (failure === 'throw' || !valid) throw new Error('Local task changed during approval; no local execution');
        localExecutions++;
      }, 0), /Local task changed/);
      assert.equal(localExecutions, 0);
      assert.equal(cancelling.pending, 0);
      const latest = Object.values(backend.authority.read().commands).at(-1);
      assert.equal(latest.asset_id, 'd6');
      assert.equal(latest.status, 'cancelled');
      await crew.pollOnce(0);
      assert.equal(crew.get().view.commands.find(c => c.command_id === latest.command_id).status, 'cancelled');
    }
    console.log('F05 real HTTP: throwing callback, async rejection and task rewound during approval each execute 0, reach cancelled and clear pending (3/3) PASS');

    for (const state of ['proposed', 'rejected', 'undone', 'missing', 'replaced']) {
      const cancelling = new OpsBridge(setup, http);
      const proposed = { ...action, id: `observed-${state}`, unitIds: ['uav-6'] };
      await approveWithBridge(cancelling, proposed, () => {}, 0);
      const observed = state === 'missing' ? [] : [{ ...proposed,
        status: state === 'replaced' ? 'executing' : state,
        proposedAt: state === 'replaced' ? proposed.proposedAt + 1 : proposed.proposedAt }];
      await cancelling.observe(observed, 1);
      assert.equal(cancelling.pending, 0);
      assert.equal(Object.values(backend.authority.read().commands).at(-1).status, 'cancelled');
    }
    console.log('F05 observed actions: proposed/rejected/undone/missing/replaced tasks cancel and clear pending (5/5) PASS');

    let loseCancellation = true;
    const retryCancellation = new OpsBridge(setup, async (url, options) => {
      const event = options?.body ? JSON.parse(options.body) : null;
      const response = await http(url, options);
      if (loseCancellation && event?.kind === 'command.receipt' && event.payload.stage === 'cancelled') {
        loseCancellation = false;
        throw new TypeError('Lost cancellation reply');
      }
      return response;
    });
    const failed = { ...action, id: 'cancel-reply-lost', unitIds: ['uav-6'] };
    await assert.rejects(approveWithBridge(retryCancellation, failed, () => { throw new Error('Local start rejected'); }, 0), /Local start rejected/);
    assert.equal(retryCancellation.pending, 1, 'lost terminal reply remains tracked');
    const cancelled = Object.values(backend.authority.read().commands).at(-1);
    assert.equal(cancelled.status, 'cancelled');
    await retryCancellation.observe([failed], 1);
    assert.equal(retryCancellation.pending, 0);
    assert.equal(backend.authority.read().log.filter(e => e.kind === 'command.receipt'
      && e.payload.command_id === cancelled.command_id && e.payload.stage === 'cancelled').length, 1);
    console.log('F05 cancellation response loss: terminal command remains tracked until idempotent receipt retry, exactly 1 cancelled fact PASS');
  });
} finally { crew.stop(); await backend.close(); }
