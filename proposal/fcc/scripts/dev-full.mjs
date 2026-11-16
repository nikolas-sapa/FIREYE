import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
let stopping = false;
let startup;
function stop(code = 0) {
  if (stopping) return;
  stopping = true; clearTimeout(startup); process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
  const kill = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 3000);
  kill.unref();
}
function launch(entry, args, options) {
  const child = spawn(process.execPath, [entry, ...args], options);
  children.add(child);
  child.on('error', () => { console.error('Local exercise process could not start'); stop(1); });
  child.on('exit', code => { children.delete(child); if (!stopping) stop(code || 1); });
  return child;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
if (process.env.FCC_LOCAL_ORIGIN && process.env.FCC_LOCAL_ORIGIN !== 'http://localhost:5173') {
  throw new Error('dev:full requires FCC_LOCAL_ORIGIN=http://localhost:5173');
}
const backend = launch(fileURLToPath(new URL('../../../backend/scripts/start-local.ts', import.meta.url)), ['--await-producer'], {
  cwd: root, env: { ...process.env, FCC_LOCAL_ORIGIN: 'http://localhost:5173',
    FCC_LOCAL_TASK_TTL_S: process.env.FCC_LOCAL_TASK_TTL_S ?? '2400',
    FCC_LOCAL_CAPABILITY_TTL_MS: process.env.FCC_LOCAL_CAPABILITY_TTL_MS ?? '1800000' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
startup = setTimeout(() => { console.error('Local backend startup timed out'); stop(1); }, 10000);
let output = '';
backend.stdout.setEncoding('utf8');
backend.stdout.on('data', chunk => {
  if (stopping) return;
  output += chunk;
  if (output.length > 65536) { stop(1); return; }
  if (!output.includes('\n')) return;
  try {
    const ready = JSON.parse(output.slice(0, output.indexOf('\n')));
    if (!ready.ready || ready.mode !== 'EXERCISE' || ready.providers !== 'disabled') throw new Error('Invalid startup');
    clearTimeout(startup); backend.stdout.removeAllListeners('data');
    console.log('Local EXERCISE backend ready; capabilities remain private. Session limit: 30 minutes.');
    launch(fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)),
      ['--host', 'localhost', '--port', '5173', '--strictPort'], { cwd: root, env: process.env, stdio: 'inherit' });
  } catch { console.error('Local backend startup failed'); stop(1); }
});
