import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { startDemoService } from '../demo/service.ts';
import type { LocalRole } from '../scripts/start-local.ts';

async function fixture(clock?: () => { received_at: string; sim_tick: number }) {
  return startDemoService({ port: 0, allowed_origin: 'http://localhost:5173', capability_ttl_ms: 600_000, clock });
}
type Demo = Awaited<ReturnType<typeof fixture>>;
async function request(demo: Demo, resource: string, input?: unknown, role: LocalRole = 'analyst') {
  const response = await fetch(`${demo.url}/incidents/${demo.incident_id}/${resource}`, {
    method: input === undefined ? 'GET' : 'POST', headers: { Origin: demo.allowed_origin,
      Authorization: `Bearer ${demo.setup.roles[role].capability}`, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  return { status: response.status, body: await response.json() };
}

test('DS01 twenty HTTP objectives dedupe and two readers share Chief command facts', async () => {
  const demo = await fixture();
  try {
    const replies = await Promise.all(Array.from({ length: 20 }, () => request(demo, 'objectives', demo.scenario.objective)));
    assert.equal(replies.every(row => row.status === 200), true);
    const assessment = replies[0].body.data;
    assert.equal(new Set(replies.map(row => row.body.data.assessment_id)).size, 1);
    assert.equal(assessment.mode, 'EXERCISE');
    assert.equal(assessment.status, 'review_ready');
    assert.equal(assessment.ranking.receipt, null);
    assert.equal((await request(demo, 'assessments')).body.data.assessment_count, 1);
    assert.equal((await request(demo, 'reviews', { assessment_id: assessment.assessment_id,
      option_id: assessment.selected_option_id })).status, 200);
    assert.equal((await request(demo, 'chief-decisions', { assessment_id: assessment.assessment_id,
      approval_id: 'approval-denied' })).status, 403);
    const winners = await Promise.all(Array.from({ length: 20 }, (_, n) => request(demo, 'chief-decisions', {
      assessment_id: assessment.assessment_id, approval_id: `approval-${n}` }, 'chief')));
    assert.equal(winners.filter(row => row.status === 200).length, 1);
    const readers = await Promise.all([request(demo, 'snapshot', undefined, 'reader'), request(demo, 'snapshot', undefined, 'chief')]);
    assert.deepEqual(readers[0].body, readers[1].body);
    assert.equal(Object.keys(demo.authority.read().commands).length, 1);
    assert.equal(Object.values(demo.authority.read().commands)[0].status, 'enqueued');
    assert.equal(demo.authority.read().log.filter(row => row.kind === 'command.receipt').length, 0);
    assert.equal(demo.authority.read().log.filter(row => row.kind === 'frame.received').length, 0);
  } finally { await demo.close(); }
});

test('DS02 twenty unknown stale expired or superseded reviews create zero commands', async () => {
  for (let n = 0; n < 20; n++) {
    let tick = 1;
    const demo = await fixture(() => ({ received_at: '2026-11-15T00:00:01Z', sim_tick: tick }));
    try {
      const before = (await request(demo, 'objectives', demo.scenario.objective)).body.data;
      if (n % 4 === 1) tick = 12;
      if (n % 4 === 2) await request(demo, 'objectives', { ...demo.scenario.objective, objective_id: `new-${n}` });
      if (n % 4 === 3) {
        const event = demo.scenario.received_events[0];
        assert.equal(event.kind, 'telemetry.received');
        assert.equal((await request(demo, 'events', { ...event, event_id: 'next-telemetry', stream_sequence: 2,
          payload: { ...event.payload, battery_percent: 89 } }, 'producer')).status, 200);
      }
      assert.equal((await request(demo, 'reviews', { assessment_id: n % 4 === 0 ? 'unknown' : before.assessment_id,
        option_id: before.selected_option_id })).status, 409);
      assert.equal(Object.keys(demo.authority.read().proposals).length, 0);
      assert.equal(Object.keys(demo.authority.read().commands).length, 0);
    } finally { await demo.close(); }
  }
});

test('DS03 twenty disabled objectives, changed registration remains review-only and reassessment preserves no media', async () => {
  const demo = await fixture();
  const original = globalThis.fetch;
  let external = 0;
  globalThis.fetch = ((input, init) => {
    if (!String(input).startsWith('http://127.0.0.1:')) { external++; throw new Error('external call forbidden'); }
    return original(input, init);
  }) as typeof fetch;
  try {
    assert.equal(demo.scenario.provenance, 'seeded-fixture');
    assert.equal(demo.scenario.reviewed_courses.length, 1);
    const replies = await Promise.all(Array.from({ length: 20 }, () => request(demo, 'objectives', demo.scenario.objective)));
    assert.equal(replies.every(row => row.status === 200), true);
    const changed = await request(demo, 'objectives', { ...demo.scenario.objective, objective_id: 'changed' });
    assert.equal(changed.body.data.status, 'review_only');
    assert.equal(changed.body.data.selected_option_id, null);
    assert.equal(external, 0);
  } finally { globalThis.fetch = original; await demo.close(); }
});

test('DS04 twenty boundary rejections, oversized body and ten close/rebind cycles', async () => {
  for (let n = 0; n < 10; n++) {
    const demo = await fixture();
    try {
      const headers: Record<string, string>[] = [{ Origin: 'http://evil.invalid' }, { Origin: demo.allowed_origin, Host: 'evil.invalid' }];
      for (const value of headers) {
        const status = await new Promise<number>((resolve, reject) => {
          const call = httpRequest(`${demo.url}/incidents/${demo.incident_id}/assessments`, { headers: value }, response => {
            response.resume(); resolve(response.statusCode!);
          }); call.on('error', reject); call.end();
        });
        assert.equal(status, 403);
      }
    const oversized = await fetch(`${demo.url}/incidents/${demo.incident_id}/objectives`, { method: 'POST',
      headers: { Origin: demo.allowed_origin, Authorization: `Bearer ${demo.setup.roles.analyst.capability}`,
        'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(65_536) }) });
    assert.equal(oversized.status, 413);
    const port = Number(new URL(demo.url).port);
    const start = performance.now(); await demo.close(); await demo.close();
    assert.ok(performance.now() - start < 1000);
    const rebound = createServer();
    await new Promise<void>((resolve, reject) => { rebound.once('error', reject); rebound.listen(port, '127.0.0.1', resolve); });
    await new Promise<void>((resolve, reject) => rebound.close(error => error ? reject(error) : resolve()));
    } finally { await demo.close(); }
  }
});

test('DS04 actual native or compiled --demo CLI exposes objective, private handoff and clean shutdown', async () => {
  const entry = new URL(`../scripts/start-local.${import.meta.url.endsWith('.js') ? 'js' : 'ts'}`, import.meta.url);
  const child = spawn(process.execPath, [fileURLToPath(entry), '--demo'], {
    env: { ...process.env, FCC_LOCAL_PORT: '0', FCC_LOCAL_MODE: 'EXERCISE', FCC_LOCAL_PROVIDERS: 'disabled' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exit = once(child, 'exit'); let output = ''; let errors = '';
  child.stdout.on('data', chunk => { output += String(chunk); });
  child.stderr.on('data', chunk => { errors += String(chunk); });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
  try {
    while (!output.includes('\n') && child.exitCode === null) await new Promise<void>(resolve => setTimeout(resolve, 10));
    const ready = JSON.parse(output.trim());
    assert.equal(ready.pid, child.pid); assert.equal(ready.provenance, 'seeded-fixture');
    assert.equal(ready.service, 'orchestration-demo'); assert.equal(ready.created_at_sim_tick, 1);
    assert.equal((await stat(ready.capabilities_file)).mode & 0o777, 0o600);
    const handoff = JSON.parse(await readFile(ready.capabilities_file, 'utf8'));
    for (const role of Object.values(handoff.roles) as { capability: string }[]) assert.equal(output.includes(role.capability), false);
    const response = await fetch(`${ready.url}/incidents/${ready.incident_id}/objectives`, { method: 'POST',
      headers: { Origin: ready.allowed_origin, Authorization: `Bearer ${handoff.roles.analyst.capability}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ objective_id: ready.objective_id, capture_goal: 'refresh_coverage', required_capabilities: ['thermal'], created_at_sim_tick: ready.created_at_sim_tick }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).data.status, 'review_ready');
    child.kill('SIGTERM'); assert.equal((await exit)[0], 0); assert.equal(errors, '');
    await assert.rejects(stat(ready.capabilities_file), { code: 'ENOENT' });
  } finally { clearTimeout(timeout); if (child.exitCode === null) { child.kill('SIGTERM'); await exit; } }
});
