// Compile and execute the actual solver module; no mocked solver and no network/provider calls.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseline = process.argv.includes('--baseline');
const source = 'c2682d4e855b8daf76e297315a63b86e58ce43ff';
try {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../tests/spread-precision.ts', import.meta.url))],
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: baseline ? [{
      name: 'pinned-review-source',
      setup(builder) {
        builder.onLoad({ filter: /[/\\]console[/\\]agents[/\\]spread\.ts$/ }, args => ({
          contents: execFileSync('git', ['show', `${source}:proposal/fcc/src/console/agents/spread.ts`], { encoding: 'utf8' }),
          loader: 'ts', resolveDir: dirname(args.path),
        }));
      },
    }] : [],
  });
  console.log(baseline ? `Pinned RED source ${source}` : 'Current source, actual compiled runSpread');
  await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
