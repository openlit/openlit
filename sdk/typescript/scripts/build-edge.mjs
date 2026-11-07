// Builds dist/edge/index.mjs: one self-contained ESM file for runtimes without
// Node.js. Sources stay shared with the Node build; the files named in REPLACED
// are swapped for their edge versions, so both builds expose the same API.
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (file) => resolve(root, 'src', file);

const REPLACED = new Map([
  [src('platform'), src('platform/index.edge.ts')],
  [src('otel/tracing'), src('otel/tracing.edge.ts')],
  [src('otel/events'), src('otel/events.edge.ts')],
  [src('otel/metrics'), src('otel/metrics.edge.ts')],
  [src('instrumentation/gpu'), src('instrumentation/gpu/index.edge.ts')],
]);

const replaceNodeModules = {
  name: 'openlit-edge',
  setup(build) {
    build.onResolve({ filter: /^\.\.?(\/|$)/ }, (args) => {
      const target = resolve(args.resolveDir, args.path);
      const edge = REPLACED.get(target) ?? REPLACED.get(target.replace(/\/index$/, ''));
      return edge ? { path: edge } : undefined;
    });
    build.onResolve({ filter: /^(@opentelemetry\/instrumentation|require-in-the-middle)$/ }, () => ({
      path: src('platform/instrumentation-shim.ts'),
    }));
  },
};

// `process` is absent or partial on the edge, so a module-local stand-in covers
// the SDK's environment reads. Workers bindings come in through `withWorker`.
const banner = `const process = {
  ...globalThis.process,
  env: globalThis.process?.env ?? {},
  stderr: globalThis.process?.stderr ?? { isTTY: false, write: (text) => console.error(text) },
};`;

const result = await esbuild.build({
  entryPoints: [src('index.ts')],
  outfile: resolve(root, 'dist/edge/index.mjs'),
  bundle: true,
  format: 'esm',
  // `browser` selects the fetch-based OTLP transport in the OpenTelemetry packages.
  platform: 'browser',
  mainFields: ['browser', 'module', 'main'],
  target: 'es2022',
  minify: true,
  keepNames: true,
  sourcemap: true,
  metafile: true,
  banner: { js: banner },
  define: {
    __OPENLIT_PRICING__: readFileSync(resolve(root, '../../assets/pricing.json'), 'utf8'),
  },
  plugins: [replaceNodeModules],
  logLevel: 'warning',
});

const nodeOnly = Object.keys(result.metafile.inputs).filter((input) =>
  /require-in-the-middle|import-in-the-middle|sdk-trace-node|context-async-hooks|js-tiktoken|src\/otel\/(tracing|events|metrics)\.ts|src\/platform\/index\.ts/.test(input)
);
if (nodeOnly.length > 0) {
  throw new Error(`Node-only modules in the edge bundle:\n${nodeOnly.join('\n')}`);
}

// Node's native ESM loader sees a CommonJS module's `exports` object as the default
// export, so `import openlit from "openlit"` would have no `init`. This thin file
// gives ESM callers the class and every named export, from the same CommonJS module.
const { default: _default, ...named } = createRequire(import.meta.url)(resolve(root, 'dist/index.js'));
writeFileSync(
  resolve(root, 'dist/index.mjs'),
  [
    "import cjs from './index.js';",
    'export default cjs.default;',
    `export const { ${Object.keys(named).join(', ')} } = cjs;`,
    '',
  ].join('\n')
);

const size = statSync(resolve(root, 'dist/edge/index.mjs')).size;
console.log(`dist/edge/index.mjs ${(size / 1024).toFixed(0)} KiB`);
