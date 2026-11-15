import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AgentJob, ConsoleApi, ConsoleState } from '../src/console/contracts';
import { consoleEntry } from '../src/console/entry';
import { applyDecision } from '../src/console/fireye/data/decision';
import { journal } from '../src/console/fireye/data/journal';
import type { Decision } from '../src/console/fireye/shell/OrchestratorCallout';
import { commVersion, filterCommRows, getCommRows, ingestSnapshot, jobStatusOf, subscribeCommRows, type CommRow } from '../src/console/ops/opsStore';

const routes = [
  ['?mode=crew', 'crew'],
  ['?mode=crew&scenario=mati', 'crew'],
  ['?mode=replay', 'replay'],
  ['?mode=monitoring', 'monitoring'],
  ['?mode=fireye', 'fireye'],
  ['', 'ops'],
] as const;

for (const [search, expected] of routes) assert.equal(consoleEntry(search), expected);
console.log('OPS51-01 routing: 6/6');

const row = (id: string, lane: CommRow['lane'], from: string, to: string | undefined, t: number): CommRow => ({ id, lane, from, to, t, seq: 1, text: id });
const rows = [
  row('alpha', 'operator', 'ALPHA', undefined, 10),
  row('bravo', 'operator', 'BRAVO', undefined, 10),
  row('orch-alpha', 'agent', 'ORCH', 'ALPHA', 10),
  row('future', 'agent', 'ORCH', 'ALPHA', 20),
];
assert.deepEqual(filterCommRows(rows, 'all', { agent: 'ALPHA' }, 10).map((r) => r.id), ['alpha', 'orch-alpha']);
assert.deepEqual(filterCommRows(rows, 'all', { agent: 'BRAVO' }, 10).map((r) => r.id), ['bravo']);

const packA = {} as unknown as ConsoleState['pack'];
const packB = {} as unknown as ConsoleState['pack'];
const queuedJob = { id: 'job-alpha', agent: 'ALPHA', poolId: 'alpha', input: 'inspect', findingIds: [], provider: 'local', model: 'fixture', status: 'queued', queuedAt: 90 } as unknown as AgentJob;
const ledger = { id: 'entry-1', at: 90, agent: 'ALPHA', text: 'entry', minutesSaved: 1 };
const message = { id: 'message-1', at: 90, role: 'user', text: 'message' };
const snapshot = (t: number, pack: ConsoleState['pack'], text = 'entry', jobs: AgentJob[] = [queuedJob], messages: unknown[] = [{ ...message, text }]) => ({
  clock: { t }, pack, jobs, ledger: { entries: [{ ...ledger, text }] }, messages, findings: [],
}) as unknown as ConsoleState;
let resets = 0;
const unsubscribe = subscribeCommRows(() => { resets++; });
ingestSnapshot(snapshot(100, packA));
assert.equal(getCommRows('all', {}, 100).length, 3);
assert.equal(jobStatusOf('job-alpha'), 'queued');
const beforeRewindVersion = commVersion();
const beforeRewindNotify = resets;
ingestSnapshot(snapshot(50, packA));
assert.equal(commVersion(), beforeRewindVersion + 1);
assert.equal(resets, beforeRewindNotify + 1);
assert.equal(getCommRows('all', {}, 50).length, 0);
assert.equal(jobStatusOf('job-alpha'), undefined);
ingestSnapshot(snapshot(100, packA, 'rewound snapshot'));
ingestSnapshot(snapshot(100, packA, 'rewound snapshot'));
assert.deepEqual(getCommRows('all', {}, 100).map((r) => r.text), ['inspect', 'rewound snapshot', 'rewound snapshot']);
const beforePackVersion = commVersion();
const beforePackNotify = resets;
ingestSnapshot(snapshot(100, packB, 'new pack snapshot'));
assert.equal(commVersion() > beforePackVersion, true);
assert.equal(resets > beforePackNotify, true);
assert.deepEqual(getCommRows('all', {}, 100).map((r) => r.text), ['inspect', 'new pack snapshot', 'new pack snapshot']);
unsubscribe();
console.log('OPS51-02 comms: operator isolation, ORCH routing, rewind/pack reset, future status and dedupe PASS');

const pendingMessage = { id: 'reply-1', at: 90, role: 'assistant', text: 'pending', thinking: true };
const completedMessage = { id: 'reply-1', at: 90, role: 'assistant', text: 'Deterministic local reply', thinking: false };
const futureMessage = { id: 'reply-future', at: 130, role: 'assistant', text: 'Future reply', thinking: false };
let messageNotifications = 0;
const unsubscribeMessages = subscribeCommRows(() => { messageNotifications++; });
ingestSnapshot(snapshot(120, packB, 'entry', [], [pendingMessage]));
const pendingRow = getCommRows('operator', {}, 120).find((r) => r.id === 'msg-reply-1');
assert.equal(pendingRow?.text, '…');
const pendingSeq = pendingRow?.seq;
const pendingVersion = commVersion();
const pendingNotifications = messageNotifications;
ingestSnapshot(snapshot(120, packB, 'entry', [], [completedMessage]));
const completedRow = getCommRows('operator', {}, 120).filter((r) => r.id === 'msg-reply-1');
assert.equal(completedRow.length, 1);
assert.equal(completedRow[0]?.text, 'Deterministic local reply');
assert.equal(completedRow[0]?.seq, pendingSeq);
assert.equal(commVersion(), pendingVersion + 1);
assert.equal(messageNotifications, pendingNotifications + 1);
const completedVersion = commVersion();
const completedNotifications = messageNotifications;
ingestSnapshot(snapshot(120, packB, 'entry', [], [completedMessage]));
assert.equal(commVersion(), completedVersion);
assert.equal(messageNotifications, completedNotifications);
ingestSnapshot(snapshot(120, packB, 'entry', [], [completedMessage, futureMessage]));
assert.equal(getCommRows('operator', {}, 120).some((r) => r.id === 'msg-reply-future'), false);
ingestSnapshot(snapshot(130, packB, 'entry', [], [completedMessage, futureMessage]));
assert.equal(getCommRows('operator', {}, 130).filter((r) => r.id === 'msg-reply-future').length, 1);
ingestSnapshot(snapshot(80, packB, 'entry', [], [completedMessage]));
ingestSnapshot(snapshot(100, packB, 'entry', [], [completedMessage]));
assert.deepEqual(getCommRows('operator', {}, 100).filter((r) => r.id === 'msg-reply-1').map((r) => r.text), ['Deterministic local reply']);
unsubscribeMessages();
console.log('OPS51-02 messages: same-ID completion, future gating and rewind regeneration PASS');

const calls: string[] = [];
const api = {
  approve: (id: string) => calls.push(`approve:${id}`),
  reject: (id: string) => calls.push(`reject:${id}`),
  acknowledge: (id: string) => calls.push(`acknowledge:${id}`),
  dismiss: (id: string) => calls.push(`dismiss:${id}`),
} as unknown as Pick<ConsoleApi, 'approve' | 'reject' | 'acknowledge' | 'dismiss'>;
const decision = (key: string, origin: Decision['origin'], action?: Decision['action'], item?: Decision['item']): Decision => ({
  key, origin, t: 10, title: key, score: 1, evidence: [], action, item,
});
const action = { id: 'action-1', kind: 'scan' } as unknown as Decision['action'];
const item = { id: 'item-1' } as unknown as Decision['item'];
journal.clear();
for (const choice of ['approved', 'rejected'] as const) {
  calls.length = 0;
  const value = decision(`action-${choice}`, 'runtime', action);
  applyDecision(value, 11, choice, api);
  assert.deepEqual(calls, [`${choice === 'approved' ? 'approve' : 'reject'}:action-1`]);
  assert.deepEqual(journal.at(value.key, 11), { key: value.key, t: 11, decision: choice, title: value.title, actionKind: 'scan' });
}
for (const choice of ['approved', 'rejected'] as const) {
  calls.length = 0;
  const value = decision(`item-${choice}`, 'runtime', undefined, item);
  applyDecision(value, 12, choice, api);
  assert.deepEqual(calls, [`${choice === 'approved' ? 'acknowledge' : 'dismiss'}:item-1`]);
  assert.deepEqual(journal.at(value.key, 12), { key: value.key, t: 12, decision: choice, title: value.title, actionKind: undefined });
}
for (const choice of ['approved', 'rejected'] as const) {
  calls.length = 0;
  const value = decision(`chronicle-${choice}`, 'chronicle');
  applyDecision(value, 13, choice, api);
  assert.deepEqual(calls, []);
  assert.deepEqual(journal.at(value.key, 13), { key: value.key, t: 13, decision: choice, title: value.title, actionKind: undefined });
}
console.log('OPS51-03 decisions: six action/item/chronicle branches PASS');

const unitCard = readFileSync('src/console/ops/OpsInspect.tsx', 'utf8').split('function UnitCard')[1]?.split('function FindingCard')[0] ?? '';
assert.match(unitCard, /Simulated state/);
assert.doesNotMatch(unitCard, /Updated|ago\(|animate-pulse/);
console.log('OPS51-04 UnitCard: neutral simulated state, no fabricated age/pulse PASS');
