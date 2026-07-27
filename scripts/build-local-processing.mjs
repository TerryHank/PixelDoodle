import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';

const outdir = 'static/local-processing';

await mkdir(outdir, { recursive: true });

const shared = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'info',
  external: ['/static/local-processing/wasm/*'],
};

await build({
  ...shared,
  entryPoints: {
    benchmark: 'frontend-local/src/benchmark.ts',
    'ts-worker': 'frontend-local/src/ts-worker.ts',
    'wasm-worker': 'frontend-local/src/wasm-worker.ts',
  },
  outdir,
});
