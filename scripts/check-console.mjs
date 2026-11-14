// Uses the esbuild bundled with Vite. No additional test dependency.
import { build } from 'esbuild';
const result = await build({
  entryPoints: [new URL('../tests/console.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
try {
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
