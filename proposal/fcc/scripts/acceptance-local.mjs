import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { cpus, release, platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildReceipt, receiptMarkdown } from './acceptance-receipt.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = new URL('../../../.scratch/acceptance/', import.meta.url);
const start = performance.now(), date = new Date().toISOString(), seed = 20261115;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const metadata = { date, seed, git_sha: git('rev-parse', 'HEAD'), working_tree_dirty: !!git('status', '--porcelain'),
  node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown' };
const checks = [];
const record = row => { checks.push(row); console.log(`${row.name}: ${row.status} (${row.duration_ms} ms)`); };
const cases = {
  SC01: { status: 'skipped', reason: 'Headless subset: 2 received-only stores, 20 commits. No 10-minute producer/2 browser pages or camera/pin/lens isolation measurement.' },
  SC02: { status: 'skipped', reason: 'Bounded single-command duplicate/rejection/stale/replay checks only; not 20 valid + 20 duplicate + 20 obsolete + 10 interleave trials.' },
  SC03: { status: 'skipped', reason: 'Enqueued/running/completed ordering and no HTTP-only terminal checked. No sent/delivered/accepted labels fabricated; 10 delivered-then-rejected trials remain unrun.' },
  SC04: { status: 'skipped', reason: '10 store reconnects and 20 unknown geography/confidence observations checked; not 20 replay/offline/Director attempts or browser-local views.' },
  SC05: { status: 'skipped', reason: 'Actual bundled Runtime/localhost cycle has not completed yet.' },
  DA01: { status: 'skipped', reason: 'Actual bundled Runtime/HTTP approval/execution/synthetic status frame subset only. No full evidence capture/hypothesis-before-review/replay or all receipt stages.' },
  DA02: { status: 'skipped', reason: '2 GET-only crew stores converge on 20 commits, not actual browser pages for 10 minutes, view actions or 20 competing approvals.' },
  DA03: { status: 'skipped', reason: 'Bounded reconnect/stale/replay/unknown/freeze checks only; full obsolete/offline/aging/critical-evidence trial matrix remains unrun.' },
  DA04: { status: 'skipped', reason: 'No browser, viewport, M3 hardware, FPS, p95, 10-minute soak or native installation measurement. Build is a separate check.' },
  DA05: { status: 'skipped', reason: 'No recording, portal/deadline confirmation, publication or submission authorized/performed.' },
  DA06: { status: 'skipped', reason: 'Genuine provider smokes not authorized: 0 calls, no keys, no provider requests.' },
};
let child, exited, ready;
let interrupted = false;
const interrupt = () => { interrupted = true; child?.kill('SIGTERM'); };
process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
const freePort = async port => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
};
try {
  await mkdir(scratch, { recursive: true });
  const bootStart = performance.now();
  // Deliberately do not inherit provider credentials or application environment files.
  child = spawn(process.execPath, [fileURLToPath(new URL('../../../backend/scripts/start-local.ts', import.meta.url)), '--await-producer'], {
    cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, FCC_LOCAL_PORT: '0',
      FCC_LOCAL_HOST: '127.0.0.1', FCC_LOCAL_MODE: 'EXERCISE', FCC_LOCAL_PROVIDERS: 'disabled',
      FCC_LOCAL_ORIGIN: 'http://localhost:5173', FCC_LOCAL_CAPABILITY_TTL_MS: '120000', FCC_LOCAL_TASK_TTL_S: '120' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  exited = new Promise(resolve => { child.once('exit', resolve); child.once('error', resolve); });
  ready = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Backend startup timeout')), 10000);
    const fail = () => { clearTimeout(timer); reject(new Error('Backend exited before readiness')); };
    child.once('exit', fail); child.once('error', fail);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 65536) { clearTimeout(timer); reject(new Error('Backend readiness too large')); return; }
      if (!output.includes('\n')) return;
      try {
        const value = JSON.parse(output.slice(0, output.indexOf('\n')));
        assert.equal(value.ready, true); assert.equal(value.providers, 'disabled'); assert.equal(value.mode, 'EXERCISE');
        assert.equal(new URL(value.url).hostname, '127.0.0.1');
        clearTimeout(timer); child.removeListener('exit', fail); resolve(value);
      } catch { clearTimeout(timer); reject(new Error('Invalid backend readiness')); }
    });
    child.stderr.resume();
  });
  const handoff = JSON.parse(await readFile(ready.capabilities_file, 'utf8'));
  record({ name: 'backend-cli', status: 'pass', reason: 'Real start-local.ts --await-producer, disabled providers, ephemeral loopback port; private capabilities stay in memory.', duration_ms: Math.round(performance.now() - bootStart) });
  const isolation = await build({ entryPoints: [fileURLToPath(new URL('../src/console/crew/CrewApp.tsx', import.meta.url))],
    bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true });
  assert.ok(Object.keys(isolation.metafile.inputs).every(path => !/console\/(?:store\.tsx|world\/(?:runtime|sim|engine)\.ts|director\/|world3d\/)/.test(path)));
  record({ name: 'crew-import-isolation', status: 'pass', reason: 'Actual Crew entry bundle imports no Runtime/store/Director/world truth.', duration_ms: Math.round(performance.now() - bootStart) });
  const bundled = await build({ entryPoints: [fileURLToPath(new URL('./acceptance-runtime.mjs', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false });
  const { rehearse } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  await rehearse(handoff, fileURLToPath(new URL('../public/', import.meta.url)).replace(/\/$/, ''), seed, record);
  cases.SC05 = { status: 'pass', reason: 'Non-mocked esbuild-bundled actual Runtime executed 1 Chief-approved finite simulated task through real localhost bridge; synthetic SVG execution-status frame/receipt received by both crew stores at canonical revision. Not camera pixels or browser/dist UI.' };
  record({ name: 'preview-console', status: 'skipped', reason: 'Optional vite preview serving check omitted: headless acceptance is bounded to Runtime/HTTP, not UI/browser validation.', duration_ms: 0 });
} catch {
  cases.SC05 = { status: 'fail', reason: 'Local acceptance did not finish; see named failing check. No raw transport or private handoff data retained.' };
  console.error('Local acceptance failed (private transport details suppressed).');
  process.exitCode = 1;
} finally {
  const cleanupStart = performance.now();
  try {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
      try { await exited; } finally { clearTimeout(kill); }
    }
    if (ready) {
      await freePort(Number(new URL(ready.url).port));
      await assert.rejects(access(ready.capabilities_file), { code: 'ENOENT' });
    }
    record({ name: 'cleanup', status: 'pass', reason: ready ? 'Backend exited, ephemeral port rebound successfully, private capability file removed.' : 'Spawned backend stopped; no ready listener handed off.', duration_ms: Math.round(performance.now() - cleanupStart) });
  } catch {
    record({ name: 'cleanup', status: 'fail', reason: 'Backend listener or private handoff cleanup failed.', duration_ms: Math.round(performance.now() - cleanupStart) });
    process.exitCode = 1;
  }
  if (interrupted) { process.exitCode = 1; cases.SC05 = { status: 'fail', reason: 'Run interrupted; acceptance incomplete.' }; }
  const receipt = buildReceipt({ ...metadata, duration_ms: Math.round(performance.now() - start), cases, checks });
  const name = `${date.replaceAll(/[:.]/g, '-')}-${process.pid}`;
  await writeFile(new URL(`${name}.json`, scratch), `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(new URL(`${name}.md`, scratch), receiptMarkdown(receipt));
  console.log(`Receipt: .scratch/acceptance/${name}.md`);
  console.log(`Local rehearsal: ${receipt.aggregate}; ${receipt.counts.pass} pass / ${receipt.counts.fail} fail / ${receipt.counts.skipped} skipped issue gates; 0 provider calls.`);
  if (receipt.aggregate === 'fail') process.exitCode = 1;
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
}
