import assert from 'node:assert/strict';
import type { Action } from '../src/console/contracts';
import { approveWithBridge, approvalForProposal, BridgeOffline, candidateForAction, localActionId,
  OpsBridge, parseOpsSetup, proposalForAction, receiptForCommand, simulatedExecutionFrame } from '../src/console/bus/ops-bridge';
import type { Candidate, Command } from '../../../backend/protocol/types';
import { createLocalDemoSeed } from '../../../backend/config/local-demo';

const setup = { mode: 'EXERCISE', url: 'http://127.0.0.1:8787', incident_id: 'i1', run_id: 'r1',
  roles: { chief: { capability: 'chief-fixture' }, producer: { capability: 'producer-fixture', principal_id: 'p1' } } };
const candidate: Candidate = { candidate_id: 'c1', action_id: 'inspect', asset_id: 'd1', mission_id: 'm1', mission_version: 1,
  route_id: 'declared-fixture', plan_revision: 0, feasibility_snapshot_id: 'fixture1', feasible: true, expires_at_sim_tick: 120 };
const action: Action = { id: 'local1', kind: 'retask-drone', title: 'Inspect', summary: 'Simulation', risk: 'high', requiresApproval: true,
  status: 'proposed', proposedAt: 0, audiences: [], unitIds: ['uav-1'], target: { lat: 38, lon: 24 } };
const view = { contract_version: 'backend-protocol.v1', bridge_version: 'backend-bridge.v1', mode: 'EXERCISE', incident_id: 'i1', run_id: 'r1',
  authority_epoch: 1, incident_revision: 0, input_revision: 0, plan_revision: 0, reservation_revision: 0, chief_epoch: 1,
  authority_active: true, as_of_received_at: '2026-11-15T08:00:00Z', media_verified: false, coordinate_frame: null,
  feeds: [{ feed_id: 't1', asset_id: 'd1', modality: 'thermal', source_kind: 'simulated', synthetic: true, radiometric: false,
    calibration: null, source_id: 's1', source_revision: 0, capture_owner_id: 'p1', capture_epoch: 1, status: 'available' }],
  telemetry: {}, frames: {}, hypotheses: {}, proposals: [], candidates: [candidate], commands: [] } as const;
const parsedSetup = parseOpsSetup(JSON.stringify(setup));
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async function (this: unknown) {
    assert.equal(this, globalThis, 'native browser fetch requires its global receiver');
    return Response.json({ data: null });
  };
  await new OpsBridge(parsedSetup).heartbeat();
} finally { globalThis.fetch = originalFetch; }
console.log('OPS-BRIDGE-00: default browser fetch retains its global receiver PASS');
for (const url of ['https://example.com', 'http://127.0.0.1:8787/?token=x', 'http://a:b@localhost:8787']) {
  assert.throws(() => parseOpsSetup(JSON.stringify({ ...setup, url })));
}
assert.throws(() => parseOpsSetup('invalid'));
assert.throws(() => parseOpsSetup(JSON.stringify({ ...setup, roles: {} })));
assert.equal(candidateForAction(action, [candidate]), candidate);
assert.throws(() => candidateForAction(action, []), /Unsupported backend asset/);
assert.throws(() => candidateForAction({ ...action, unitIds: ['d2'] }, [candidate]), /Unsupported backend asset/);
assert.throws(() => candidateForAction(action, [], view.feeds), /No eligible.*scope expired/);
assert.throws(() => candidateForAction(action, [{ ...candidate, feasible: false }]), /No eligible.*scope expired/);
assert.throws(() => candidateForAction({ ...action, kind: 'rescue' }, [candidate]), /Only single/);
const defaultSeed = createLocalDemoSeed();
for (let n = 1; n <= 6; n++) {
  const resolved = candidateForAction({ ...action, unitIds: [`uav-${n}`] }, defaultSeed.candidates, defaultSeed.assets);
  assert.equal(resolved.asset_id, `d${n}`);
  assert.equal(resolved.candidate_id, `c${n}`);
}
for (const unitId of ['uav-7', 'raf-11']) {
  assert.throws(() => candidateForAction({ ...action, unitIds: [unitId] }, defaultSeed.candidates, defaultSeed.assets), error => {
    assert.match((error as Error).message, /Unsupported backend asset/);
    assert.doesNotMatch((error as Error).message, /restart/);
    return true;
  });
}
console.log('F03 candidate mapping: default seed resolves uav-1..6 to d1..6 (6/6); unsupported assets and unavailable scope distinguished PASS');
const mapped = proposalForAction(action, view, candidate, 'mapping');
assert.equal(mapped.kind, 'proposal.created');
if (mapped.kind !== 'proposal.created') throw new Error('proposal');
assert.deepEqual(mapped.payload.candidate_ids, ['c1']);
assert.equal(mapped.payload.expires_at_sim_tick, 120);
assert.match(mapped.payload.rationale, /EXERCISE fixture alias/);
const approval = approvalForProposal({ ...view, incident_revision: 1 }, candidate, 'mapping');
assert.equal(approval.expected_incident_revision, 1);
assert.equal(approval.proposal_id, mapped.payload.proposal_id);
console.log('OPS-BRIDGE-01: setup validation, same-drone mapping, empty/foreign/unsupported rejection PASS');

let executions = 0;
await approveWithBridge(null, action, () => executions++, 0);
const unavailable = new OpsBridge(parsedSetup, (async () => { throw new TypeError('offline'); }) as typeof fetch);
assert.equal(await approveWithBridge(unavailable, action, () => executions++, 0), 'local');
assert.equal(executions, 2);
const denied = new OpsBridge(parsedSetup, (async () => Response.json({ error: { code: 'UNAUTHORIZED', reason: 'Chief denied' } }, { status: 403 })) as typeof fetch);
await assert.rejects(approveWithBridge(denied, action, () => executions++, 0), /Chief denied/);
assert.equal(executions, 2);
console.log('OPS-BRIDGE-02: unconfigured/unreachable execute locally; authorization rejection executes 0 actions PASS');
const malformed = new OpsBridge(parsedSetup, (async () => new Response('{', { status: 200 })) as typeof fetch);
await assert.rejects(approveWithBridge(malformed, action, () => executions++, 0), /Invalid backend response/);
assert.equal(executions, 2, 'malformed initial snapshot never authorizes local fallback');

const paths: string[] = [];
let command: Command;
let failAt = '';
const http = (async (url, options) => {
  const path = String(url).split('/').at(-1)!;
  paths.push(path);
  assert.equal(options?.credentials, 'omit');
  assert.equal(options?.cache, 'no-store');
  assert.equal(options?.redirect, 'error');
  assert.doesNotMatch(String(url), /capability|chief-fixture|producer-fixture/);
  const body = options?.body ? JSON.parse(String(options.body)) : null;
  if (failAt === path) throw new TypeError('dropped response');
  if (path === 'snapshot') return Response.json({ data: view });
  if (path === 'approvals') {
    command = { contract_version: 'backend-protocol.v1', incident_id: 'i1', run_id: 'r1', authority_epoch: 1,
      command_id: `command:${body.approval_id}`, command_version: 1, idempotency_key: 'key', transmission_id: 'tx',
      asset_id: 'd1', mission_id: 'm1', mission_version: 1, route_id: 'declared-fixture', action_id: 'inspect',
      approval_id: body.approval_id, proposal_id: body.proposal_id, proposal_revision: 1, input_revision: 0, plan_revision: 0,
      reservation_revision: 1, chief_epoch: 1, chief_id: 'chief1', sent_sim_tick: null, deadline_sim_tick: 10, lease_expires_at_sim_tick: 120, status: 'enqueued' };
  }
  if (path === 'commands') return Response.json({ data: [command] });
  if (path === 'command-checks') return Response.json({ data: command });
  return Response.json({ data: null });
}) as typeof fetch;
const transport = new OpsBridge(parsedSetup, http);
await approveWithBridge(transport, action, () => { assert.equal(paths.at(-1), 'events'); executions++; }, 42);
assert.equal(executions, 3);
assert.ok(paths.indexOf('commands') < paths.indexOf('command-checks'));
assert.equal(transport.pending, 1);
assert.equal(localActionId(command!, { actionId: action.id, approvalId: command!.approval_id, candidate }), action.id);
assert.throws(() => localActionId({ ...command!, asset_id: 'd2' }, { actionId: action.id, approvalId: command!.approval_id, candidate }), /does not match/);
const executionFrame = await simulatedExecutionFrame(command!, view.feeds[0], 'p1', 'completed', 42);
assert.equal(executionFrame.event.kind, 'frame.received');
if (executionFrame.event.kind !== 'frame.received') throw new Error('frame');
assert.equal(executionFrame.event.payload.byte_length, new TextEncoder().encode(executionFrame.image).byteLength);
assert.equal(executionFrame.event.payload.capture_owner_id, 'p1');
assert.equal(executionFrame.event.payload.asset_id, command!.asset_id);
assert.match(executionFrame.image, /Simulated execution evidence, not a camera frame/);
assert.match(executionFrame.event.payload.content_hash, /^sha256:[a-f0-9]{64}$/);
await assert.rejects(simulatedExecutionFrame(command!, { ...view.feeds[0], asset_id: 'd2' }, 'p1', 'completed', 42), /requires/);
const receipt = receiptForCommand(command!, 'p1', 1, 'completed', 42, [executionFrame.event.payload.evidence_id]);
assert.equal(receipt.kind, 'command.receipt');
if (receipt.kind !== 'command.receipt') throw new Error('receipt');
assert.equal(receipt.payload.transmission_id, command!.transmission_id);
assert.equal(receipt.payload.stage, 'completed');
await transport.observe([{ ...action, status: 'executing' }], 43);
assert.equal(transport.pending, 1);
failAt = 'events';
await assert.rejects(transport.observe([{ ...action, status: 'done' }], 44), BridgeOffline);
assert.equal(transport.pending, 1, 'completion remains retryable');
failAt = '';
await transport.observe([{ ...action, status: 'done' }], 45);
assert.equal(transport.pending, 0);
await transport.observe([], 46);
failAt = 'approvals';
await assert.rejects(approveWithBridge(new OpsBridge(parsedSetup, http), action, () => executions++, 0), BridgeOffline);
assert.equal(executions, 3, 'ambiguous mutation never falls back');
console.log('OPS-BRIDGE-03: approval -> commands -> preflight -> execution, factual completion retry, ambiguous failure executes 0 PASS');
