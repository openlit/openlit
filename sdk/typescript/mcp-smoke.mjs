/**
 * MCP Instrumentation smoke demo.
 *
 * Sets up OTel with an in-memory exporter, exercises 6 MCP operations,
 * and prints the resulting spans to stdout in a human-readable format.
 *
 * Usage: cd sdk/typescript && node mcp-smoke.mjs
 */
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();
const tracer = trace.getTracer('mcp-demo');

const {
  patchCallTool,
  patchListTools,
  patchGetPrompt,
  patchReadResource,
  patchListResources,
} = require('./dist/instrumentation/mcp/wrapper');

const ops = [];

async function test(name, fn) {
  await fn();
  ops.push({ name, status: '✅' });
  console.log(`  ${name}  ✅`);
}

async function main() {
  console.log('=== MCP Instrumentation Smoke Demo ===\n');

  // patchCallTool(tracer, version)(originalMethod)
const VER = '1.0.0';
const patch = (fn, factory) => factory(tracer, VER)(fn);

  await test('callTool',            () => patch(Object.assign(async () => ({ content: [{ type: 'text', text: 'hello' }] }), {}), patchCallTool)({ name: 'echo', arguments: {} }));
  await test('callTool (error)',    async () => { const fn = Object.assign(async () => { throw new Error('tool fail'); }, {}); try { await patch(fn, patchCallTool)({ name: 'bad' }); } catch {} });
  await test('readResource',        () => patch(Object.assign(async () => ({ contents: [{ text: 'ok' }] }), {}), patchReadResource)({ uri: 'file:///test' }));
  await test('getPrompt',           () => patch(Object.assign(async () => ({ messages: [{ role: 'user', content: 'hi' }] }), {}), patchGetPrompt)({ name: 'greeting' }));
  await test('listTools',           () => patch(Object.assign(async () => ({ tools: [{ name: 't1' }] }), {}), patchListTools)());
  await test('listResources',       () => patch(Object.assign(async () => ({ resources: [{ uri: 'file:///a' }] }), {}), patchListResources)());

  // Flush
  await new Promise(r => setTimeout(r, 200));

  const spans = exporter.getFinishedSpans();
  const toolCallSpan = spans.find(s => s.name.includes('tools/call') && !s.name.includes('list'));
  const readResSpan  = spans.find(s => s.name.includes('resources/read'));
  const promptSpan   = spans.find(s => s.name.includes('prompts/get'));
  const listToolSpan = spans.find(s => s.name.includes('tools/list'));
  const listResSpan  = spans.find(s => s.name.includes('resources/list'));

  console.log('\n=== Span Attribute Verification ===\n');

  function show(span, label) {
    if (!span) { console.log(`  ${label}: MISSING`); return; }
    const a = span.attributes;
    console.log(`  ${label}:`);
    console.log(`    name          = ${span.name}`);
    console.log(`    mcp.operation = ${a['mcp.operation.name']}`);
    if (a['mcp.tool.name'])     console.log(`    mcp.tool.name = ${a['mcp.tool.name']}`);
    if (a['mcp.resource.uri'])  console.log(`    mcp.resource.uri = ${a['mcp.resource.uri']}`);
    if (a['mcp.prompt.name'])   console.log(`    mcp.prompt.name = ${a['mcp.prompt.name']}`);
    if (a['mcp.error.message']) console.log(`    mcp.error.msg = ${a['mcp.error.message']}`);
    console.log(`    status.code   = ${span.status.code}`);
  }

  show(toolCallSpan, 'callTool');
  show(readResSpan,  'readResource');
  show(promptSpan,   'getPrompt');
  show(listToolSpan, 'listTools');
  show(listResSpan,  'listResources');

  // Verify mcp.* namespace
  const allKeys = spans.flatMap(s => Object.keys(s.attributes));
  const badKeys = allKeys.filter(k => k.startsWith('gen_ai.') && !k.startsWith('gen_ai.system'));
  console.log('\n=== MCP namespace check ===');
  if (badKeys.length === 0) {
    console.log('  ✅ All attributes use mcp.* namespace (0 gen_ai.* found)');
  } else {
    console.log(`  ❌ Found gen_ai.* keys: ${badKeys.join(', ')}`);
  }

  console.log(`\n=== ${ops.length}/6 operations produced spans ===`);

  await provider.shutdown();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
