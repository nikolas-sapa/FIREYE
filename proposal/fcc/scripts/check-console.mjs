// Uses the esbuild bundled with Vite. No additional test dependency.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import './check-pages-assets.mjs';
import '../tests/acceptance-receipt.mjs';
const nodeRequire = createRequire(import.meta.url);
try {
  for (const test of ['provider-policy', 'ops-handoff.mjs', 'ops-bridge', 'ops-bridge-http.mjs', 'thermal', 'crew-store', 'console', 'ops', 'saferoute', 'announce', 'tamagotchi', 'appearance', 'appearance-sync', 'cartography', 'motion', 'fireye', 'recon', 'boot', 'sweep-dispatch-parity', 'rewind']) {
    const result = await build({
      entryPoints: [new URL(`../tests/${test.endsWith('.mjs') ? test : `${test}.ts`}`, import.meta.url).pathname],
      bundle: true, platform: 'node', format: test === 'tamagotchi' ? 'cjs' : 'esm', write: false,
    });
    if (test === 'tamagotchi') {
      const testModule = { exports: {} };
      new Function('require', 'module', 'exports', result.outputFiles[0].text)(nodeRequire, testModule, testModule.exports);
    } else {
      await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
