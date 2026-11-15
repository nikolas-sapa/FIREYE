// Reuse Vite's esbuild; no additional test package and no paid network calls.
import { build } from 'esbuild';
try {
  const result = await build({
    entryPoints: [new URL('../tests/image-lab.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false,
    jsx: 'automatic',
    packages: 'external',
    absWorkingDir: new URL('..', import.meta.url).pathname,
  });
  // A file URL keeps external React package resolution relative to this project.
  const { writeFile, unlink } = await import('node:fs/promises');
  const file = new URL('../.scratch-image-lab-test.mjs', import.meta.url);
  await writeFile(file, result.outputFiles[0].text);
  try { await import(file.href); }
  finally { await unlink(file); }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
