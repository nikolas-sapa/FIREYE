import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = fileURLToPath(new URL('..', import.meta.url));
const compiler = join(backend, 'node_modules', 'typescript', 'bin', 'tsc');
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: backend, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Backend check failed (${result.status ?? result.signal ?? 'spawn'})`);
}
async function typescriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.filter(entry => !['node_modules', '.scratch', '.git'].includes(entry.name)).map(entry => entry.isDirectory()
    ? typescriptFiles(join(directory, entry.name))
    : entry.isFile() && entry.name.endsWith('.ts') ? [join(directory, entry.name)] : []));
  return groups.flat().sort();
}
let output;
try {
  run([compiler, '--noEmit']);
  const tests = (await typescriptFiles(join(backend, 'tests'))).filter(path => path.endsWith('.test.ts'));
  run(['--test', ...tests]);
  const sources = await typescriptFiles(backend);
  const scratch = join(backend, '.scratch');
  await mkdir(scratch, { recursive: true });
  output = await mkdtemp(join(scratch, 'backend-check-'));
  run([compiler, '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--erasableSyntaxOnly', '--types', 'node', '--rewriteRelativeImportExtensions', '--rootDir', backend,
    '--outDir', output, ...sources]);
  const compiled = tests.map(path => join(output, 'tests', path.slice(join(backend, 'tests').length + 1).replace(/\.ts$/, '.js')));
  run(['--test', ...compiled]);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Backend check failed'}\n`);
  process.exitCode = 1;
} finally {
  if (output) await rm(output, { recursive: true });
}
