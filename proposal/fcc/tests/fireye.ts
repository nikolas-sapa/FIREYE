import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadScenario } from '../src/console/scenario';
import { contextFor } from '../src/console/world/engine';
import { buildChronicle, visibleAt } from '../src/console/fireye/data/chronicle';
import { sensorModel } from '../src/console/fireye/data/sensors';
import { sectorRisk } from '../src/console/fireye/data/risk';
import {
  ASSESSMENT_STATUSES, COMMAND_FLOW, COMMAND_TERMINAL, FEED_STATUSES, RECEIPT_STAGES, fromBridge, type BridgeViewLite,
} from '../src/console/fireye/data/fleet';
import type { ChronicleEntry, ChronicleKind, SensorReading, SensorSpec } from '../src/console/fireye/data/types';
import type { ChronicleRecord, SensorNode, SensorSample } from '../src/console/contracts';

// Local FIREYE shapes must stay assignable to the published contract.
const wire = {
  entry: (e: ChronicleEntry): ChronicleRecord => e,
  node: (s: SensorSpec): SensorNode => s,
  sample: (r: SensorReading): SensorSample => r,
};
void wire;

const root = resolve(process.cwd(), 'public');
globalThis.fetch = (async (url: string | URL | Request) => {
  const path = resolve(root, `.${String(url)}`);
  assert.ok(path.startsWith(`${root}/`));
  try { return new Response(readFileSync(path), { status: 200 }); } catch { return new Response(null, { status: 404 }); }
}) as typeof fetch;

const MIN = 60000;
const pack = await loadScenario('mati-2018');
const ctx = contextFor(pack);
assert.equal(new Date(ctx.start).toISOString(), '2018-07-23T11:00:00.000Z', 'FIREYE window opens at 14:00 local');
const ch = buildChronicle(pack, { start: ctx.start, end: ctx.end }, 'recon');
assert.ok(ch.entries.length > 80, 'chronicle has content');
assert.ok(ch.entries.every((e, i, a) => i === 0 || a[i - 1]!.t <= e.t), 'entries sorted by time');
assert.ok(ch.entries.every((e) => e.t >= ctx.start && e.t <= ctx.end), 'entries stay in the window');

// Same log after scrubbing away and back.
const ids = (t: number) => visibleAt(ch, t).map((e) => e.id).join('|');
const probes = [ctx.start + 30 * MIN, ch.ignitionT + 2 * MIN, ch.ignitionT + 90 * MIN, ctx.end - MIN];
const first = probes.map(ids);
for (const t of [...probes].reverse()) ids(t);
assert.deepEqual(probes.map(ids), first, 'scrub round trip is identical');
assert.ok(visibleAt(ch, ctx.start - 1).length === 0);
for (const t of probes) assert.ok(visibleAt(ch, t).every((e) => e.t <= t), 'nothing from the future is visible');
console.log(`Chronicle: ${ch.entries.length} entries, ${ch.chapters.length} chapters, scrub round trip identical PASS`);

// Chapters in story order, starting before ignition.
const order = ch.chapters.map((c) => c.id);
assert.ok(order.length >= 5);
assert.ok(ch.chapters[0]!.t < ch.ignitionT, 'a pre-ignition chapter opens the story');

// Tab classification.
const INTAKE = new Set<ChronicleKind>(['radio', 'iot', 'web', 'report', 'satellite', 'social', 'weather']);
const OPS = new Set<ChronicleKind>(['analysis', 'orchestrator', 'fleet', 'command', 'projection', 'detection']);
for (const e of ch.entries) {
  assert.ok(e.tab === 'intake' ? INTAKE.has(e.kind) : OPS.has(e.kind), `${e.id}: ${e.kind} on ${e.tab}`);
  if (e.provenance === 'historical') assert.equal(e.tab, 'intake', 'historical reports are outside information');
  assert.doesNotMatch(`${e.title} ${e.body ?? ''}`, /\b(victims?|bodies|corpses?|died|dead)\b/i, `${e.id}: no victim content`);
}
assert.ok(ch.entries.some((e) => e.tab === 'intake' && e.kind === 'radio') && ch.entries.some((e) => e.tab === 'ops' && e.kind === 'analysis'));
assert.ok(ch.entries.every((e) => !e.decision && !e.command && !['command', 'fleet', 'orchestrator', 'projection'].includes(e.kind)), 'no scripted decisions, dispatch or fleet/projection claims');
const legacy = buildChronicle(pack, { start: ctx.start, end: ctx.end }, 'legacy');
assert.ok(legacy.entries.some(e => e.decision === 'needed'), 'Ops retains scripted human review');
assert.ok(legacy.entries.some(e => e.command), 'Ops retains receipt history');
assert.equal(buildChronicle(pack, { start: ctx.start, end: ctx.end }, 'recon'), ch, 'profile caches stay isolated');
assert.equal(buildChronicle(pack, { start: ctx.start, end: ctx.end }), legacy, 'existing callers keep legacy review history');
console.log('Intake / Ops classification, profile isolation and content rules PASS');

// IoT readings are deterministic and do not depend on future fire arrivals.
const model = sensorModel(pack);
assert.ok(model.specs.length >= 20);
const tA = ch.ignitionT + 25 * MIN;
const a1 = JSON.stringify(model.all(tA));
model.all(ctx.end); model.all(ctx.start);
assert.equal(JSON.stringify(model.all(tA)), a1, 'readings repeat exactly');
for (const s of model.specs.slice(0, 6)) assert.deepEqual(model.readingAt(s.id, tA), model.readingAt(s.id, tA));
for (const t of [ch.ignitionT - 20 * MIN, ch.ignitionT + 10 * MIN, tA]) {
  const cut = t - pack.manifest.start;
  const arrival = pack.arrival.map((v) => (v > cut ? Number.POSITIVE_INFINITY : v)) as Float32Array;
  const blind = sensorModel({ ...pack, arrival });
  assert.equal(JSON.stringify(blind.all(t)), JSON.stringify(model.all(t)), `sensor readings at ${new Date(t).toISOString()} ignore future arrivals`);
  assert.deepEqual(sectorRisk(blind, t), sectorRisk(model, t), 'risk index ignores future arrivals');
  const blindChronicle = buildChronicle({ ...pack, arrival }, { start: ctx.start, end: ctx.end }, 'recon');
  assert.deepEqual(visibleAt(blindChronicle, t), visibleAt(ch, t), 'chronicle ignores future fire arrivals, including debounced transitions');
}
assert.ok(ch.risk.some((r) => r.t < ch.ignitionT && r.value >= 68), 'elevated risk shows before ignition');
console.log(`IoT mesh: ${model.specs.length} nodes deterministic, no future-arrival reads PASS`);

// Mirrored backend unions (backend/protocol/types.ts, review/pr-35).
assert.deepEqual([...FEED_STATUSES], ['available', 'paused', 'stale', 'unavailable']);
assert.deepEqual([...RECEIPT_STAGES], ['sent', 'delivered', 'accepted', 'running', 'completed', 'failed', 'cancelled', 'rejected']);
assert.deepEqual([...COMMAND_FLOW], ['enqueued', 'sent', 'delivered', 'accepted', 'running', 'completed']);
assert.ok(COMMAND_TERMINAL.every((s) => s === 'completed' || (RECEIPT_STAGES as readonly string[]).includes(s)));
assert.deepEqual([...ASSESSMENT_STATUSES], ['assessing', 'review_ready', 'review_only', 'proposed', 'approved', 'superseded']);

// Bridge adapter against a received-view fixture.
const fixture: BridgeViewLite = {
  bridge_version: 'backend-bridge.v1', mode: 'EXERCISE', incident_id: 'i1', run_id: 'r1', incident_revision: 42, authority_active: true,
  as_of_received_at: '2026-11-15T08:00:00Z', media_verified: false, coordinate_frame: null,
  feeds: [
    { feed_id: 'f-d1-th', asset_id: 'd1', modality: 'thermal', source_kind: 'simulated', synthetic: true, radiometric: false, status: 'stale' },
    { feed_id: 'f-d1-eo', asset_id: 'd1', modality: 'eo', source_kind: 'simulated', synthetic: true, radiometric: 'unknown', status: 'available' },
    { feed_id: 'f-d2-th', asset_id: 'd2', modality: 'thermal', source_kind: 'simulated', synthetic: true, radiometric: false, status: 'unavailable' },
  ],
  telemetry: { d1: { incident_revision: 41, received_at: '2026-11-15T07:59:58Z', payload: { asset_id: 'd1', mission_id: 'm-7', mission_version: 3, sim_tick: 9, position: { x_m: 10, y_m: 20, z_m: 120 }, battery_percent: 71 } } },
  proposals: [{ proposal_id: 'p-1', rationale: 'Thermal sweep east ridge', candidate_ids: ['c1', 'c2'] }],
  commands: [
    { command_id: 'c-old', command_version: 1, asset_id: 'd1', mission_id: 'm-6', mission_version: 2, approval_id: 'a0', proposal_id: 'p-0', status: 'completed' },
    { command_id: 'c-new', command_version: 2, asset_id: 'd1', mission_id: 'm-7', mission_version: 3, approval_id: 'a1', proposal_id: 'p-1', status: 'delivered' },
  ],
};
const snap = fromBridge(fixture);
assert.deepEqual(snap.assets.map((x) => x.asset_id), ['d1', 'd2']);
const d1 = snap.assets[0]!;
assert.equal(d1.feed_status, 'available', 'best feed status wins');
assert.deepEqual([...d1.capabilities].sort(), ['eo', 'thermal']);
assert.equal(d1.thermal_feed_id, 'f-d1-th');
assert.equal(d1.position, null, 'no map frame: position unmapped');
assert.equal(d1.command?.status, 'delivered', 'latest command status verbatim');
assert.equal(d1.battery_percent, 71);
assert.equal(snap.assets[1]!.feed_status, 'unavailable');
assert.equal(snap.revision, 42);
assert.ok(snap.providers.every((p) => p.status !== 'connected'), 'no fake active providers');
console.log('Backend unions and bridge adapter fixture PASS');
