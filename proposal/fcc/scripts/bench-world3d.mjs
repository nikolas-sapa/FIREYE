import { build } from 'esbuild';
import { writeFile, unlink } from 'node:fs/promises';
const entry = process.argv[2] ?? 'tests/world3d-bench.ts';
const file = new URL('../.scratch-world3d.mjs', import.meta.url);
try {
  const result = await build({ entryPoints: [new URL('../' + entry, import.meta.url).pathname], bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external' });
  await writeFile(file, result.outputFiles[0].text);
  try { await import(file.href); } finally { await unlink(file); }
} catch (error) { console.error(error); process.exitCode = 1; }
