// Sends spans from each runtime to a fake OTLP collector and asserts what arrives.
// `npm run build` first. Deno, Bun and webpack cases run only where available.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EdgeVM } from '@edge-runtime/vm';
import esbuild from 'esbuild';
import { Miniflare } from 'miniflare';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const fixtures = join(here, 'fixtures');
const require = createRequire(import.meta.url);

const EDGE_BUNDLE_BUDGET_KIB = 1024;

// Consumers import `openlit` by name, so tests must go through package.json
// `exports` too. The symlink gives bundlers the same lookup a real install has.
const workspace = mkdtempSync(join(tmpdir(), 'openlit-runtime-'));
mkdirSync(join(workspace, 'node_modules/@anthropic-ai'), { recursive: true });
symlinkSync(root, join(workspace, 'node_modules/openlit'));
symlinkSync(join(root, 'node_modules/@anthropic-ai/sdk'), join(workspace, 'node_modules/@anthropic-ai/sdk'));
symlinkSync(join(root, 'node_modules/openai'), join(workspace, 'node_modules/openai'));

function attrs(span) {
  const out = {};
  for (const { key, value } of span.attributes ?? []) out[key] = Object.values(value)[0];
  return out;
}

// The Anthropic SDK emits its own `chat` span unless OpenLIT switched it off, so
// a check on the operation name alone would pass with instrumentation broken.
const isOpenlitChat = (span) => span.scope?.includes('openlit') && span.attrs['gen_ai.operation.name'] === 'chat';

class Collector {
  requests = [];
  spans = [];
  failNext = 0;
  rejectNext = 0;

  async start() {
    this.server = http.createServer((request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        this.requests.push(request.url);
        if (this.rejectNext > 0 && request.url === '/v1/traces') {
          this.rejectNext -= 1;
          response.writeHead(400);
          response.end();
          return;
        }
        if (this.failNext > 0 && request.url === '/v1/traces') {
          this.failNext -= 1;
          response.writeHead(429, { 'retry-after': '0' });
          response.end();
          return;
        }
        if (request.url === '/v1/traces') {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          for (const { resource, scopeSpans } of body.resourceSpans ?? []) {
            for (const { scope, spans } of scopeSpans) {
              for (const span of spans) {
                this.spans.push({ ...span, scope: scope?.name, attrs: attrs(span), resource: attrs(resource) });
              }
            }
          }
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      });
    });
    await new Promise((done) => this.server.listen(0, '127.0.0.1', done));
    this.url = `http://127.0.0.1:${this.server.address().port}`;
  }

  reset() {
    this.requests = [];
    this.spans = [];
    this.failNext = 0;
    this.rejectNext = 0;
  }

  async waitFor(predicate, what) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (predicate(this.spans)) return this.spans;
      await new Promise((done) => setTimeout(done, 25));
    }
    assert.fail(`timed out waiting for ${what}; got ${JSON.stringify(this.spans.map((s) => s.name))}`);
  }

  stop() {
    return new Promise((done) => this.server.close(done));
  }
}

async function bundle(fixture, conditions, options = {}) {
  const entry = join(workspace, fixture);
  writeFileSync(entry, readFileSync(join(fixtures, fixture)));
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    conditions,
    metafile: true,
    logLevel: 'silent',
    ...options,
  });
  return { code: result.outputFiles[0].text, inputs: Object.keys(result.metafile.inputs) };
}

function worker(script, collector, { flags = ['nodejs_compat'], bindings = {}, date = '2026-01-01' } = {}) {
  return new Miniflare({
    modules: true,
    script,
    compatibilityDate: date,
    compatibilityFlags: flags,
    cfFetch: false,
    bindings: {
      OTEL_EXPORTER_OTLP_ENDPOINT: collector.url,
      OTEL_SERVICE_NAME: 'from-binding',
      ...bindings,
    },
  });
}

const results = [];
let failed = false;

async function test(name, fn) {
  try {
    const note = await fn();
    results.push(`ok    ${name}${typeof note === 'string' ? ` (${note})` : ''}`);
  } catch (error) {
    failed = true;
    results.push(`FAIL  ${name}\n      ${String(error.message).split('\n').join('\n      ')}`);
  }
}

function skip(name, reason) {
  results.push(`skip  ${name} (${reason})`);
}

const collector = new Collector();
await collector.start();

const workerBundle = await bundle('worker.mjs', ['workerd', 'worker']);
const mf = worker(workerBundle.code, collector, { bindings: { APP_NAME: 'configured-app' } });

await test('bundle: wrangler conditions pick the edge entry with no Node-only package', () => {
  assert.ok(workerBundle.inputs.some((input) => input.endsWith('dist/edge/index.mjs')));
  const nodeOnly = workerBundle.inputs.filter((input) => /sdk-trace-node|require-in-the-middle|js-tiktoken/.test(input));
  assert.deepEqual(nodeOnly, []);
});

await test('bundle: edge entry stays inside its size budget', () => {
  const kib = readFileSync(join(root, 'dist/edge/index.mjs')).length / 1024;
  assert.ok(kib < EDGE_BUNDLE_BUDGET_KIB, `${kib} KiB`);
  return `${kib.toFixed(0)} KiB of ${EDGE_BUNDLE_BUDGET_KIB}`;
});

await test('workerd: module-scope init works and sends nothing before a request', async () => {
  await mf.ready;
  assert.deepEqual(collector.requests, []);
});

await test('workerd: request span parents the patched model span, with cost from the snapshot', async () => {
  collector.reset();
  assert.equal(await (await mf.dispatchFetch('http://worker/anthropic')).text(), 'ok');
  const spans = await collector.waitFor((s) => s.length >= 2, 'request and model spans');
  const request = spans.find((s) => s.name === 'GET /anthropic');
  const model = spans.find((s) => isOpenlitChat(s));
  assert.ok(model, 'OpenLIT model span');
  assert.equal(model.parentSpanId, request.spanId);
  assert.equal(model.traceId, request.traceId);
  assert.equal(model.attrs['gen_ai.usage.input_tokens'], 1000);
  assert.ok(Number(model.attrs['gen_ai.usage.cost']) > 0, 'cost');
  assert.equal(model.resource['service.name'], 'configured-app');
  assert.equal(model.resource['telemetry.sdk.name'], 'openlit');
  assert.deepEqual(spans.filter((s) => s.attrs['gen_ai.operation.name'] === 'chat').length, 1, 'no native SDK span');
});

await test('workerd: a patched OpenAI call survives bundling', async () => {
  collector.reset();
  assert.equal((await mf.dispatchFetch('http://worker/openai')).status, 200);
  const spans = await collector.waitFor((s) => s.some(isOpenlitChat), 'OpenAI span');
  assert.equal(spans.find(isOpenlitChat).attrs['gen_ai.provider.name'], 'openai');
});

await test('workerd: messages.stream gives one span', async () => {
  collector.reset();
  assert.equal((await mf.dispatchFetch('http://worker/anthropic-stream')).status, 200);
  const spans = await collector.waitFor((s) => s.length >= 2, 'stream span');
  assert.equal(spans.filter(isOpenlitChat).length, 1);
  assert.equal(spans.filter((s) => s.attrs['gen_ai.operation.name'] === 'chat').length, 1, 'no native SDK span');
});

await test('workerd: a streamed response still delivers its model span', async () => {
  collector.reset();
  const response = await mf.dispatchFetch('http://worker/stream-response');
  await response.text();
  const spans = await collector.waitFor((s) => s.some(isOpenlitChat), 'model span');
  assert.equal(spans.find(isOpenlitChat).attrs['gen_ai.usage.output_tokens'], 500);
});

await test('workerd: openlit.llm with tags', async () => {
  collector.reset();
  await mf.dispatchFetch('http://worker/llm');
  const spans = await collector.waitFor((s) => s.some((x) => x.attrs['gen_ai.provider.name'] === 'typesafe'), 'llm span');
  const span = spans.find((s) => s.attrs['gen_ai.provider.name'] === 'typesafe');
  assert.equal(span.name, 'chat jev-latest');
  assert.equal(span.attrs['openlit.request.purpose'], 'classification');
  assert.equal(span.attrs['openlit.route'], 'gateway');
});

await test('workerd: concurrent requests each deliver their own spans', async () => {
  collector.reset();
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => mf.dispatchFetch('http://worker/anthropic'))
  );
  assert.ok(responses.every((response) => response.status === 200));
  await collector.waitFor((s) => s.filter(isOpenlitChat).length === 20, '20 model spans');
});

await test('workerd: a collector answering 429 once loses no spans', async () => {
  collector.reset();
  collector.failNext = 1;
  await mf.dispatchFetch('http://worker/anthropic');
  await collector.waitFor((s) => s.length >= 2, 'spans after the retry');
  assert.equal(collector.requests.filter((url) => url === '/v1/traces').length, 2);
});

await test('workerd: a handler error is recorded and still sent', async () => {
  collector.reset();
  await mf.dispatchFetch('http://worker/fail').then((r) => r.text()).catch(() => {});
  const [span] = await collector.waitFor((s) => s.length >= 1, 'error span');
  assert.equal(span.status.code, 2);
});

await mf.dispose();

await test('workerd: three steps in three isolates form one trace with one root', async () => {
  collector.reset();
  for (const n of [1, 2, 3]) {
    const isolate = worker(workerBundle.code, collector);
    await isolate.dispatchFetch(`http://worker/step?run=run-42&n=${n}`);
    await collector.waitFor((s) => s.filter((x) => x.name.startsWith('step ')).length === n, `step ${n}`);
    await isolate.dispose();
  }
  const finish = worker(workerBundle.code, collector);
  await finish.dispatchFetch('http://worker/finish?run=run-42');
  const spans = await collector.waitFor((s) => s.some((x) => x.name === 'workflow run'), 'root span');
  await finish.dispose();

  const root = spans.find((s) => s.name === 'workflow run');
  const steps = spans.filter((s) => s.name.startsWith('step '));
  assert.equal(steps.length, 3);
  assert.ok(!root.parentSpanId, 'root has no parent');
  for (const step of steps) {
    assert.equal(step.traceId, root.traceId);
    assert.equal(step.parentSpanId, root.spanId);
  }
});

await test('workerd without nodejs_compat: loads, and spans still arrive', async () => {
  collector.reset();
  const plain = worker(workerBundle.code, collector, { flags: [] });
  assert.equal((await plain.dispatchFetch('http://worker/llm')).status, 200);
  await collector.waitFor((s) => s.some((x) => x.attrs['gen_ai.provider.name'] === 'typesafe'), 'span');
  await plain.dispose();
  return 'parents after await need withParent here';
});

await test('workerd: one client with instrument(), configured only by bindings', async () => {
  collector.reset();
  const { code } = await bundle('client-worker.mjs', ['workerd', 'worker']);
  const clientWorker = worker(code, collector);
  assert.equal((await clientWorker.dispatchFetch('http://worker/')).status, 200);
  const spans = await collector.waitFor((s) => s.some(isOpenlitChat), 'model span');
  assert.equal(spans[0].resource['service.name'], 'from-binding');
  await clientWorker.dispose();
});

await test('workerd: a span the collector rejects cannot block later spans', async () => {
  collector.reset();
  collector.rejectNext = 1;
  const isolate = worker(workerBundle.code, collector);
  await isolate.dispatchFetch('http://worker/llm');
  await new Promise((done) => setTimeout(done, 200));
  await isolate.dispatchFetch('http://worker/llm');
  await collector.waitFor((s) => s.some((x) => x.attrs['gen_ai.provider.name'] === 'typesafe'), 'spans after rejection');
  await isolate.dispose();
});

await test('workerd: guards passed through instrumentations block the call', async () => {
  collector.reset();
  const { code } = await bundle('guard-worker.mjs', ['workerd', 'worker']);
  const guarded = worker(code, collector);
  const response = await guarded.dispatchFetch('http://worker/');
  assert.equal(await response.text(), 'blocked');
  await guarded.dispose();
});

await test('workerd: capture opt-out binding works without nodejs_compat', async () => {
  collector.reset();
  const plain = worker(workerBundle.code, collector, {
    flags: [],
    bindings: { OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'false' },
  });
  await plain.dispatchFetch('http://worker/llm');
  const spans = await collector.waitFor((s) => s.some((x) => x.attrs['gen_ai.provider.name'] === 'typesafe'), 'span');
  assert.equal(spans.find((s) => s.attrs['gen_ai.provider.name'] === 'typesafe').attrs['gen_ai.input.messages'], undefined);
  await plain.dispose();
});

await test('workerd: setAgentVersion neither fails a request nor reaches the next one', async () => {
  for (const flags of [['nodejs_compat'], []]) {
    const isolate = worker(workerBundle.code, collector, { flags });
    assert.equal((await isolate.dispatchFetch('http://worker/set-version')).status, 200);
    assert.equal(await (await isolate.dispatchFetch('http://worker/read-version')).text(), 'none');
    await isolate.dispose();
  }
});

await test('workerd: a text/plain stream and waitUntil work both deliver without a later request', async () => {
  collector.reset();
  const isolate = worker(workerBundle.code, collector);
  await (await isolate.dispatchFetch('http://worker/plain-stream')).text();
  await collector.waitFor((s) => s.some((x) => x.name === 'chat streamed'), 'streamed span');
  await isolate.dispatchFetch('http://worker/background');
  await collector.waitFor((s) => s.some((x) => x.name === 'chat background'), 'background span');
  await isolate.dispose();
});

await test('workerd: withWorker wraps a WorkerEntrypoint class', async () => {
  collector.reset();
  const { code } = await bundle('class-worker.mjs', ['workerd', 'worker'], { external: ['cloudflare:workers'] });
  const classWorker = worker(code, collector);
  const response = await classWorker.dispatchFetch('http://worker/hello');
  assert.equal(await response.text(), 'helped');
  await collector.waitFor((s) => s.some((x) => x.name === 'GET /hello'), 'request span');
  await classWorker.dispose();
});

await test('bundle: a browser build resolves the edge entry', async () => {
  const { inputs } = await bundle('edge.mjs', []);
  assert.ok(inputs.some((input) => input.endsWith('dist/edge/index.mjs')));
});

await test('vercel edge: edge-light picks the edge entry; nested spans arrive after flush', async () => {
  collector.reset();
  const { code, inputs } = await bundle('edge.mjs', ['edge-light'], { format: 'iife' });
  assert.ok(inputs.some((input) => input.endsWith('dist/edge/index.mjs')));
  // Next.js and Vercel provide this global; the bare VM does not.
  const vm = new EdgeVM();
  vm.context.AsyncLocalStorage = AsyncLocalStorage;
  vm.context.OTLP_ENDPOINT = collector.url;
  vm.evaluate(code);
  await vm.evaluate('runEdge()');
  const spans = await collector.waitFor((s) => s.length >= 2, 'spans');
  const model = spans.find((s) => s.name === 'chat private-model');
  assert.equal(model.parentSpanId, spans.find((s) => s.name === 'request').spanId);
});

await test('node: keeps today\'s entry, and flush() beats process exit', async () => {
  collector.reset();
  const script = join(workspace, 'node.cjs');
  writeFileSync(script, readFileSync(join(fixtures, 'node.cjs')));
  const resolved = execFileSync(process.execPath, ['-p', "require.resolve('openlit')"], { cwd: workspace }).toString().trim();
  assert.ok(resolved.endsWith('dist/index.js'), resolved);
  execFileSync(process.execPath, [script], { env: { ...process.env, OTLP_ENDPOINT: collector.url }, stdio: 'pipe' });
  const spans = await collector.waitFor((s) => s.length >= 2, 'spans');
  assert.equal(spans.find((s) => s.name === 'chat private-model').parentSpanId, spans.find((s) => s.name === 'request').spanId);
  return `node ${process.version}`;
});

await test('node: native ESM import gets the class and named exports', async () => {
  const script = join(workspace, 'esm.mjs');
  writeFileSync(
    script,
    `import openlit, { trace, withTags } from 'openlit';
     import assert from 'node:assert/strict';
     assert.equal(typeof openlit.init, 'function');
     assert.equal(typeof openlit.withLambda, 'function');
     assert.equal(typeof trace, 'function');
     assert.equal(typeof withTags, 'function');
     assert.equal(openlit.default, openlit);`
  );
  execFileSync(process.execPath, [script], { stdio: 'pipe', cwd: workspace });
});

function available(command) {
  return spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0;
}

if (available('bun')) {
  await test('bun: runs the Node entry; nested spans arrive after flush', async () => {
    collector.reset();
    const script = join(workspace, 'node.cjs');
    writeFileSync(script, readFileSync(join(fixtures, 'node.cjs')));
    execFileSync('bun', ['run', script], { env: { ...process.env, OTLP_ENDPOINT: collector.url }, stdio: 'pipe', cwd: workspace });
    const spans = await collector.waitFor((s) => s.length >= 2, 'spans');
    assert.equal(spans.find((s) => s.name === 'chat private-model').parentSpanId, spans.find((s) => s.name === 'request').spanId);
  });
} else {
  skip('bun', 'bun not on PATH');
}

if (available('deno')) {
  await test('deno: the deno condition picks the edge entry; nested spans arrive', async () => {
    collector.reset();
    const script = join(workspace, 'deno.mjs');
    writeFileSync(
      script,
      `globalThis.OTLP_ENDPOINT = ${JSON.stringify(collector.url)};\nawait import('./edge.mjs');\nawait globalThis.runEdge();\n`
    );
    writeFileSync(join(workspace, 'edge.mjs'), readFileSync(join(fixtures, 'edge.mjs')));
    writeFileSync(join(workspace, 'package.json'), '{"dependencies":{"openlit":"*"}}');
    execFileSync('deno', ['run', '-A', '--node-modules-dir=manual', script], { stdio: 'pipe', cwd: workspace });
    const spans = await collector.waitFor((s) => s.length >= 2, 'spans');
    assert.equal(spans.find((s) => s.name === 'chat private-model').parentSpanId, spans.find((s) => s.name === 'request').spanId);
  });
} else {
  skip('deno', 'deno not on PATH');
}

let webpack;
try {
  webpack = require('webpack');
} catch {
  skip('webpack', 'webpack not installed');
}
if (webpack) {
  await test('webpack: edge-light resolves the edge entry', async () => {
    const entry = join(workspace, 'edge.mjs');
    writeFileSync(entry, readFileSync(join(fixtures, 'edge.mjs')));
    const stats = await new Promise((done, reject) =>
      webpack(
        {
          mode: 'production',
          entry,
          target: 'webworker',
          context: workspace,
          output: { path: join(workspace, 'webpack-out') },
          resolve: { conditionNames: ['edge-light', 'worker', 'import', 'default'] },
          optimization: { minimize: false },
        },
        (error, result) => (error ? reject(error) : done(result))
      )
    );
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true }));
    const modules = stats.toJson({ modules: true }).modules.map((module) => module.name).join('\n');
    assert.match(modules, /dist\/edge\/index\.mjs/);
    assert.doesNotMatch(modules, /sdk-trace-node|js-tiktoken/);
  });
}

await collector.stop();
rmSync(workspace, { recursive: true, force: true });

console.log(results.join('\n'));
process.exit(failed ? 1 : 0);
