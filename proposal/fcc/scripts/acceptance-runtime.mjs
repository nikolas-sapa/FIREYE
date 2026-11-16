import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Runtime } from '../src/console/world/runtime.ts';
import { createBus } from '../src/console/bus/index.ts';
import { loadScenario } from '../src/console/scenario/index.ts';
import { ops, contextFor } from '../src/console/world/engine.ts';
import { buildCatalog } from '../src/console/agents/catalog.ts';
import { propose } from '../src/console/orchestrator/actions.ts';
import { OpsBridge, parseOpsSetup, candidateForAction } from '../src/console/bus/ops-bridge.ts';
import { CrewStore } from '../src/console/bus/crew-transport.ts';

export async function rehearse(handoff, publicRoot, seed, record) {
  const setup = parseOpsSetup(JSON.stringify(handoff));
  const origin = handoff.allowed_origin;
  const requests = [];
  const http = async (url, options) => {
    assert.equal(new URL(url).origin, setup.url, 'no external transport');
    const body = options?.body ? JSON.parse(options.body) : null;
    const response = await fetch(url, { ...options, headers: { ...options?.headers, Origin: origin } });
    requests.push({ path: new URL(url).pathname.split('/').at(-1), body, status: response.status });
    return response;
  };
  const send = async (path, role, body) => {
    const response = await http(`${setup.url}/incidents/${setup.incident_id}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${handoff.roles[role].capability}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    return { response, result };
  };
  const bridge = new OpsBridge(setup, http);
  let readerWrites = 0;
  const readerHttp = async (url, options) => {
    if (options.method !== 'GET') readerWrites++;
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, `Bearer ${handoff.roles.reader.capability}`);
    return http(url, options);
  };
  const reader = () => new CrewStore({ url: setup.url, incident: setup.incident_id,
    token: () => handoff.roles.reader.capability, fetchImpl: readerHttp });
  const first = reader(), second = reader();
  const readers = [first, second];
  let converged = 0, revision = -1;
  const converge = async () => {
    await Promise.all(readers.map(r => r.pollOnce(0)));
    const canonical = await bridge.snapshot();
    assert.deepEqual(first.get().view, second.get().view);
    assert.equal(first.get().view.incident_revision, canonical.incident_revision);
    assert.ok(canonical.incident_revision >= revision);
    revision = canonical.incident_revision;
    return canonical;
  };
  const timed = async (name, reason, fn) => {
    const start = performance.now();
    try { await fn(); record({ name, status: 'pass', reason, duration_ms: Math.round(performance.now() - start) }); }
    catch (e) {
      let diagnostic = String(e.message);
      for (const role of Object.values(handoff.roles)) diagnostic = diagnostic.replaceAll(role.capability, '[redacted]');
      console.error(`${name}: ${diagnostic}`);
      record({ name, status: 'fail', reason: 'Assertion failed; inspect local stderr (private handoff excluded).', duration_ms: Math.round(performance.now() - start) }); throw e;
    }
  };
  try {
    let rt, action, executions = 0, command, approval;
    await timed('runtime-command-cycle', '1 bundled actual Runtime; real Chief/producer HTTP; 1 execution and synthetic SVG completion, not camera pixels.', async () => {
      const savedFetch = globalThis.fetch;
      try {
        globalThis.fetch = async url => {
          const path = resolve(publicRoot, `.${String(url)}`);
          assert.ok(path.startsWith(`${publicRoot}${sep}`));
          try { return new Response(await readFile(path)); } catch { return new Response(null, { status: 404 }); }
        };
        const pack = await loadScenario('mati-2018');
        const inspection = buildCatalog(contextFor(pack)).find(f => f.confirmable && 'at' in f.reveal);
        assert.ok(inspection, 'committed scenario has a timed confirmable fictional finding');
        rt = new Runtime(pack, createBus(), { seed, t: inspection.reveal.at + 60000, tokens: { cesium: false, google: false } });
      } finally { globalThis.fetch = savedFetch; }
      assert.equal((await converge()).commands.length, 0, 'await-producer starts without commands');
      const drone = rt.sim.units.find(u => u.id === 'uav-1');
      assert.ok(drone);
      const finding = rt.sim.findings.find(f => rt.sim.fmeta.get(f.id)?.confirmable && !rt.sim.fmeta.get(f.id).confirmed);
      assert.ok(finding, 'scenario supplies a confirmable synthetic finding');
      action = propose(rt.sim, { kind: 'retask-drone', title: 'Local acceptance simulated inspection',
        summary: 'Synthetic exercise only; backend route is an explicit fixture alias, not calibrated geometry.',
        risk: 'high', audiences: ['air'], unitIds: [drone.id], target: { ...finding.pos }, itemId: finding.id });
      candidateForAction(action, (await bridge.snapshot()).candidates);
      const initialPosition = { ...drone.pos };
      let sawEnqueued = false;
      const checkedBridge = new OpsBridge(setup, async (url, options) => {
        if (String(url).endsWith('/command-checks')) {
          const view = await converge();
          assert.equal(view.commands[0].status, 'enqueued');
          assert.equal(executions, 0);
          sawEnqueued = true;
        }
        return http(url, options);
      });
      await checkedBridge.approve(action, () => { executions++; ops.approve(rt.sim, action.id, 'user'); }, 0);
      assert.equal(sawEnqueued, true);
      assert.equal(executions, 1);
      assert.equal(rt.sim.actions.find(a => a.id === action.id).status, 'executing');
      assert.equal(drone.taskId, action.id);
      assert.equal((await converge()).commands[0].status, 'running');
      assert.equal(requests.filter(r => r.body?.payload?.stage === 'completed').length, 0, 'HTTP approval/running 200 is not completion');
      const running = requests.find(r => r.body?.kind === 'command.receipt').body;
      const beforeDuplicate = (await bridge.snapshot()).incident_revision;
      const retransmission = await send('events', 'producer', running);
      assert.equal(retransmission.response.ok, true);
      assert.equal((await bridge.snapshot()).incident_revision, beforeDuplicate, 'identical transmission is deduplicated by authority');
      assert.equal(executions, 1);
      approval = requests.find(r => r.path === 'approvals').body;
      command = (await send('commands', 'producer')).result.data[0];
      await assert.rejects(checkedBridge.approve(action, () => executions++, 0), /already pending/);
      assert.equal(executions, 1);
      const duplicate = await send('approvals', 'chief', approval);
      assert.equal(duplicate.response.ok, true);
      assert.equal((await bridge.snapshot()).commands.length, 1);
      const commandRead = await send('commands', 'producer');
      assert.equal(commandRead.result.data.length, 1);
      assert.equal(executions, 1, 'repeated delivery is not a second submit');
      rt.sim.speed = 60;
      let ticks = 0;
      while (rt.sim.actions.find(a => a.id === action.id).status !== 'done' && ticks++ < 600) {
        rt.tick(0.25);
        if (ticks % 40 === 0) await checkedBridge.heartbeat();
      }
      assert.equal(rt.sim.actions.find(a => a.id === action.id).status, 'done', 'actual Runtime confirms finding and finishes task');
      assert.notDeepEqual(drone.pos, initialPosition, 'actual simulated drone moved');
      assert.equal((await converge()).commands[0].status, 'running', 'local completion alone is not a backend terminal');
      await checkedBridge.observe(rt.sim.actions, 1);
      await checkedBridge.observe(rt.sim.actions, 1);
      const view = await converge();
      assert.equal(view.commands[0].status, 'completed');
      const frame = Object.values(view.frames)[0].payload;
      assert.equal(frame.media_limits_version, 'ops-simulated-execution.v1');
      assert.equal(frame.mime_type, 'image/svg+xml');
      assert.equal(frame.source_position, null);
      assert.equal(frame.captured_at, null);
      assert.equal(view.media_verified, false);
      const receipts = requests.filter(r => r.path === 'events' && r.body?.kind === 'command.receipt');
      assert.deepEqual(receipts.map(r => r.body.payload.stage), ['running', 'running', 'completed']);
      assert.equal(new Set(receipts.map(r => r.body.event_id)).size, 2, 'one logical running and one terminal receipt');
      assert.deepEqual(receipts[2].body.payload.evidence_ids, [frame.evidence_id]);
      assert.ok(requests.findIndex(r => r.body?.kind === 'frame.received') < requests.findIndex(r => r.body?.payload?.stage === 'completed'));
    });
    await timed('negative-commands', 'Duplicate approval/pending submit/repeated command delivery, invalid Chief, stale revision and replayed terminal command: 0 extra executions.', async () => {
      const denied = new OpsBridge({ ...setup, roles: { ...setup.roles, chief: { capability: 'invalid-local-test' } } }, http);
      await assert.rejects(denied.approve({ ...action, id: 'denied', unitIds: ['uav-2'] }, () => executions++, 1), /UNAUTHENTICATED/);
      const stale = new OpsBridge(setup, (url, options) => {
        if (String(url).endsWith('/command-checks')) {
          const body = JSON.parse(options.body); body.expected_incident_revision = 0;
          return http(url, { ...options, body: JSON.stringify(body) });
        }
        return http(url, options);
      });
      await assert.rejects(stale.approve({ ...action, id: 'stale', unitIds: ['uav-2'] }, () => executions++, 1), /CONFLICT: Incident revision changed/);
      const view = await bridge.snapshot();
      const replay = await send('command-checks', 'producer', { command_id: command.command_id, expected_incident_revision: view.incident_revision });
      assert.equal(replay.response.ok, false, 'completed command cannot authorize replay');
      if (replay.response.ok) executions++;
      assert.equal(executions, 1);
      assert.equal((await bridge.snapshot()).commands.filter(c => c.status === 'completed').length, 1);
    });
    await timed('crew-convergence-and-unknowns', '20/20 received hypothesis commits match canonical revision in 2 GET-only readers; 10 reconnects, 0 regressions/writes; geography/confidence unknown 20/20.', async () => {
      const frame = Object.values((await bridge.snapshot()).frames)[0].payload;
      for (let n = 1; n <= 20; n++) {
        await bridge.heartbeat();
        const view = await bridge.snapshot();
        const event = { contract_version: view.contract_version, incident_id: view.incident_id, run_id: view.run_id,
          authority_epoch: view.authority_epoch, event_id: `acceptance:h${n}`, stream_id: 'acceptance:hypotheses', stream_sequence: n,
          trace_id: `acceptance:${n}`, causation_id: null, kind: 'hypothesis.received', payload: {
            hypothesis_id: `local-h${n}`, kind: 'other', verification_status: 'unverified', evidence_ids: [frame.evidence_id],
            source_snapshot_id: frame.source_snapshot_id, input_revision: view.input_revision,
            geography: null, location_uncertainty_m: null, model_score: null, contradictions: [], critical: true,
          } };
        const result = await send('events', 'analyst', event);
        assert.equal(result.response.ok, true);
        const next = await converge();
        assert.equal(next.incident_revision, view.incident_revision + 1);
        const received = first.get().view.hypotheses[`local-h${n}`].payload;
        assert.equal(received.geography, null); assert.equal(received.model_score, null);
        assert.equal(received.verification_status, 'unverified');
        converged++;
        if (n % 2 === 0) {
          first.stop();
          await converge();
          assert.equal(first.get().view.incident_revision, next.incident_revision);
        }
      }
      assert.equal(converged, 20); assert.equal(readerWrites, 0);
      assert.equal(executions, 1);
    });
    await timed('producer-loss-freeze', 'No producer heartbeats for >5 wall seconds; explicit new reader sees frozen authority and obsolete producer command check is rejected.', async () => {
      await bridge.heartbeat();
      await new Promise(resolve => setTimeout(resolve, 5300));
      const rejoined = reader(); readers.push(rejoined);
      await rejoined.pollOnce(0);
      assert.equal(rejoined.get().state, 'frozen');
      assert.equal(rejoined.get().view.authority_active, false);
      const obsolete = await send('command-checks', 'producer', { command_id: command.command_id,
        expected_incident_revision: rejoined.get().view.incident_revision });
      assert.equal(obsolete.response.ok, false);
      assert.equal(executions, 1);
    });
  } finally { readers.forEach(r => r.stop()); }
}
