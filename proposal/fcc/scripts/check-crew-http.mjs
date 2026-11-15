// Finite real loopback test; no dev server, provider, media fetch or backend source change.
import { build } from 'esbuild';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
const scratch = new URL('../.scratch/', import.meta.url);
await mkdir(scratch, { recursive: true });
const file = new URL('crew-http-test.mjs', scratch);
try {
  const entry = await build({
    entryPoints: [new URL('../src/console/crew/CrewApp.tsx', import.meta.url).pathname],
    bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
  });
  const inputs = Object.keys(entry.metafile.inputs);
  assert.ok(inputs.every(path => !/console\/(?:store\.tsx|world\/(?:runtime|sim|engine)\.ts|director\/|world3d\/)/.test(path)),
    'crew dependency graph must not import the simulator, Director, or world truth');
  console.log('Crew entry dependency isolation PASS: no Runtime/store/Director/world truth imports.');
  const result = await build({
    entryPoints: [new URL('../tests/crew-http.mjs', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false, packages: 'external',
  });
  await writeFile(file, result.outputFiles[0].text);
  await import(file.href);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await unlink(file).catch(() => {}); }
