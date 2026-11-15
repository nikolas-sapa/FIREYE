import { build } from 'esbuild';
import { writeFile, unlink } from 'node:fs/promises';
const file = new URL('../.scratch-monitoring-test.mjs', import.meta.url);
try {
  const result = await build({
    entryPoints: [new URL('../tests/monitoring.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external',
  });
  await writeFile(file, result.outputFiles[0].text);
  try { await import(file.href); } finally { await unlink(file); }
} catch (error) { console.error(error); process.exitCode = 1; }
