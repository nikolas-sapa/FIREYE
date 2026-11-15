// Uses the esbuild bundled with Vite. No additional test dependency.
import { build } from 'esbuild';
try {
  for (const test of ['spread-precision', 'console', 'appearance', 'cartography', 'motion']) {
    const result = await build({
      entryPoints: [new URL(`../tests/${test}.ts`, import.meta.url).pathname],
      bundle: true, platform: 'node', format: 'esm', write: false,
    });
    await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
