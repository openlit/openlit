/**
 * MCP Instrumentation — comprehensive smoke test (103 checks).
 *
 * Usage: cd sdk/typescript && node mcp-smoke.mjs
 */
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
provider.register();
const tracer = trace.getTracer('mcp-demo');
const VER = '1.0.0';

const wrapper = require('./dist/instrumentation/mcp/wrapper');
const semconv = require('./dist/semantic-convention').default;

const patch = (fn, factory) => factory(tracer, VER)(fn);
const mkFn = (impl) => Object.assign(async (...a) => impl(...a), {});

let passed = 0, failed = 0;
function check(label, ok, detail) {
  if (ok) { passed++; console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`); }
  else    { failed++; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ' — MISSING'}`); }
}
function lastSpan() { const s = exporter.getFinishedSpans(); return s[s.length - 1]; }
async function test(label, run) {
  const before = exporter.getFinishedSpans().length;
  try { await run(); } catch {}
  await new Promise(r => setTimeout(r, 10));
  const after = exporter.getFinishedSpans().length;
  check(label, after > before, lastSpan()?.name || 'no span');
}

console.log('╔══════════════════════════════════════════════════╗');
console.log('║   MCP Instrumentation — Comprehensive Smoke Test  ║');
console.log('╚══════════════════════════════════════════════════╝');

// ── 1. Client Methods (7) ──────────────────────────────────────────
console.log('\n── 1. Client Methods (7) ──');
await test('callTool',               () => patch(mkFn(() => ({ content: [] })), wrapper.patchCallTool)({ name: 'echo' }));
await test('callTool (error path)',   async () => { try { await patch(mkFn(() => { throw new Error('fail'); }), wrapper.patchCallTool)({ name: 'bad' }); } catch {} });
await test('listTools',              () => patch(mkFn(() => ({ tools: [{ name: 't1' }] })), wrapper.patchListTools)());
await test('getPrompt',              () => patch(mkFn(() => ({ messages: [] })), wrapper.patchGetPrompt)({ name: 'greet' }));
await test('listPrompts',            () => patch(mkFn(() => ({ prompts: [] })), wrapper.patchListPrompts)());
await test('readResource',           () => patch(mkFn(() => ({ contents: [{ text: 'ok' }] })), wrapper.patchReadResource)({ uri: 'file:///test' }));
await test('listResources',          () => patch(mkFn(() => ({ resources: [] })), wrapper.patchListResources)());

// ── 2. ClientSession (2) ───────────────────────────────────────────
console.log('\n── 2. ClientSession (2) ──');
await test('sendRequest',            () => patch(mkFn(() => ({ jsonrpc: '2.0', id: 1, result: {} })), wrapper.patchClientSessionSendRequest)({ method: 'tools/call', params: {} }));
await test('initialize',             () => patch(mkFn(() => ({ protocolVersion: '2024-11-05' })), wrapper.patchClientSessionInitialize)({ protocolVersion: '2024-11-05' }));

// ── 3. Server Methods (5) ──────────────────────────────────────────
console.log('\n── 3. Server Methods (5) ──');
await test('server.run',              () => patch(mkFn(() => {}), wrapper.patchServerRun)());
await test('server.callTool',         () => patch(mkFn(() => ({ content: [] })), wrapper.patchServerCallTool)({ name: 'srvTool' }));
await test('server.listTools',        () => patch(mkFn(() => ({ tools: [] })), wrapper.patchServerListTools)());
await test('server.readResource',     () => patch(mkFn(() => ({ contents: [] })), wrapper.patchServerReadResource)({ uri: 'file:///srv' }));
await test('server.listResources',    () => patch(mkFn(() => ({ resources: [] })), wrapper.patchServerListResources)());

// ── 4. Transports (6) ──────────────────────────────────────────────
console.log('\n── 4. Transports (6) ──');
const transportEndpoints = [
  'transport stdio_client', 'transport stdio_server',
  'transport sse_client',   'transport sse_server',
  'transport http_client',  'transport http_server',
];
for (const ep of transportEndpoints) {
  await test(`transport ${ep.split(' ').pop()}`, () => {
    return wrapper.patchTransport(ep, tracer, VER)(mkFn(() => {}))();
  });
}

// ── 5. ServerSession (3) ───────────────────────────────────────────
console.log('\n── 5. ServerSession (3) ──');
await test('send_request',      () => { const p = wrapper.patchServerSessionOperation('send_request', tracer, VER); return p(mkFn(() => ({})))(); });
await test('send_notification', () => { const p = wrapper.patchServerSessionOperation('send_notification', tracer, VER); return p(mkFn(() => ({})))(); });
await test('send_log_message',  () => { const p = wrapper.patchServerSessionOperation('send_log_message', tracer, VER); return p(mkFn(() => ({})))(); });

await new Promise(r => setTimeout(r, 200));
const allSpans = exporter.getFinishedSpans();

// ── 6. Span Names (22) ─────────────────────────────────────────────
console.log('\n── 6. Span Names ──');
check('mcp tools/call',         !!allSpans.find(s => s.name === 'mcp tools/call'));
check('mcp tools/list',         !!allSpans.find(s => s.name === 'mcp tools/list'));
check('mcp prompts/get',        !!allSpans.find(s => s.name === 'mcp prompts/get'));
check('mcp prompts/list',       !!allSpans.find(s => s.name === 'mcp prompts/list'));
check('mcp resources/read',     !!allSpans.find(s => s.name === 'mcp resources/read'));
check('mcp resources/list',     !!allSpans.find(s => s.name === 'mcp resources/list'));
check('mcp transport/request',  !!allSpans.find(s => s.name === 'mcp transport/request'));
check('mcp initialize',         !!allSpans.find(s => s.name === 'mcp initialize'));
check('mcp server/run',         !!allSpans.find(s => s.name === 'mcp server/run'));
check('mcp transport/stdio',    !!allSpans.find(s => s.name === 'mcp transport/stdio'));
check('mcp transport/sse',      !!allSpans.find(s => s.name === 'mcp transport/sse'));
check('mcp transport/http',     !!allSpans.find(s => s.name === 'mcp transport/http'));
check('mcp server/send_request',      !!allSpans.find(s => s.name === 'mcp server/send_request'));
check('mcp server/send_notification', !!allSpans.find(s => s.name === 'mcp server/send_notification'));
check('mcp server/send_log_message',  !!allSpans.find(s => s.name === 'mcp server/send_log_message'));

// ── 7. Span Kinds ──────────────────────────────────────────────────
console.log('\n── 7. Span Kinds ──');
check('server.callTool kind=SERVER',  !!allSpans.find(s => s.name === 'mcp tools/call' && s.kind === 1));
check('server.run kind=SERVER',       !!allSpans.find(s => s.name === 'mcp server/run' && s.kind === 1));
check('transport kind=CLIENT',        !!allSpans.find(s => s.name === 'mcp transport/stdio' && s.kind === 2));

// ── 8. Attributes ──────────────────────────────────────────────────
console.log('\n── 8. Attributes ──');
const ts = allSpans.find(s => s.attributes['mcp.tool.name'] === 'echo');
const rs = allSpans.find(s => s.attributes['mcp.resource.uri'] === 'file:///test');
const es = allSpans.find(s => s.attributes['mcp.error.message']);
const tr = allSpans.find(s => s.attributes['mcp.transport.type']);
check('mcp.tool.name = echo',             ts?.attributes['mcp.tool.name'] === 'echo');
check('mcp.operation.name = tools_call',  ts?.attributes['mcp.operation.name'] === 'tools_call');
check('mcp.resource.uri = file:///test',  rs?.attributes['mcp.resource.uri'] === 'file:///test');
check('mcp.error.message on failure',     es != null);
check('mcp.transport.type = stdio',       tr?.attributes['mcp.transport.type'] === 'stdio');

// ── 9. Namespace ───────────────────────────────────────────────────
console.log('\n── 9. Namespace ──');
const allKeys = allSpans.flatMap(s => Object.keys(s.attributes));
const badKeys = allKeys.filter(k => k.startsWith('gen_ai.') && !k.startsWith('gen_ai.system'));
check('0 gen_ai.* keys (all mcp.*)',   badKeys.length === 0, badKeys.length === 0 ? 'clean' : `BAD: ${badKeys.join(', ')}`);

// ── 10. Semantic Conventions (44) ──────────────────────────────────
console.log('\n── 10. Semantic Conventions ──');
const required = [
  'MCP_OPERATION', 'MCP_SYSTEM', 'MCP_SDK_VERSION', 'MCP_METHOD', 'MCP_MESSAGE_ID',
  'MCP_JSONRPC_VERSION', 'MCP_PARAMS', 'MCP_RESULT', 'MCP_ERROR_CODE', 'MCP_ERROR_MESSAGE',
  'MCP_ERROR_DATA', 'MCP_TOOL_NAME', 'MCP_TOOL_DESCRIPTION', 'MCP_TOOL_ARGUMENTS',
  'MCP_TOOL_RESULT', 'MCP_RESOURCE_URI', 'MCP_RESOURCE_NAME', 'MCP_RESOURCE_DESCRIPTION',
  'MCP_RESOURCE_MIME_TYPE', 'MCP_RESOURCE_SIZE', 'MCP_TRANSPORT_TYPE', 'MCP_TRANSPORT_STDIO',
  'MCP_TRANSPORT_SSE', 'MCP_TRANSPORT_WEBSOCKET', 'MCP_CLIENT_TYPE',
  'GEN_AI_SYSTEM_MCP', 'GEN_AI_OPERATION_TYPE_MCP_TOOL_CALL',
  'GEN_AI_OPERATION_TYPE_MCP_TOOL_LIST', 'GEN_AI_OPERATION_TYPE_MCP_RESOURCE_READ',
  'GEN_AI_OPERATION_TYPE_MCP_RESOURCE_LIST', 'GEN_AI_OPERATION_TYPE_MCP_REQUEST',
  'GEN_AI_OPERATION_TYPE_MCP_RESPONSE', 'GEN_AI_OPERATION_TYPE_MCP_SERVER',
  'GEN_AI_OPERATION_TYPE_MCP_CLIENT',
  'MCP_REQUESTS', 'MCP_CLIENT_OPERATION_DURATION', 'MCP_CLIENT_OPERATION_DURATION_METRIC',
  'MCP_RESPONSE_SIZE', 'MCP_RESPONSE_SIZE_METRIC', 'MCP_REQUEST_SIZE', 'MCP_TOOL_CALLS',
  'MCP_RESOURCE_READS', 'MCP_PROMPT_GETS', 'MCP_TRANSPORT_USAGE', 'MCP_ERRORS',
  'MCP_OPERATION_SUCCESS_RATE',
];
for (const name of required) {
  check(`semconv.${name}`, semconv[name] != null, semconv[name] || 'undefined');
}

// ── 11. Metrics ────────────────────────────────────────────────────
console.log('\n── 11. Metrics ──');
const Metrics = require('./dist/otel/metrics').default;
check('Metrics class exists',        typeof Metrics === 'function');
check('initializeMetrics method',    typeof Metrics.initializeMetrics === 'function');
let recordOk = false;
try {
  wrapper.recordMCPMetrics({ mcpOperation: 'tools_call', mcpMethod: 'callTool', mcpTransportType: 'stdio', toolName: 'test', duration: 0.1, requestSize: 100, responseSize: 200, isError: false });
  recordOk = true;
} catch {}
check('recordMCPMetrics safe call',  recordOk);

// ── 12. Registry ───────────────────────────────────────────────────
console.log('\n── 12. Registry ──');
const MCPInstrumentation = require('./dist/instrumentation/mcp').default;
const instr = new MCPInstrumentation();
check('instrumentationName = "mcp"',  instr.instrumentationName.includes('mcp'));
check('version = 1.0.0',              instr.instrumentationVersion === '1.0.0');
const Instrumentations = require('./dist/instrumentation').default;
check('MCP in Instrumentations map',  Instrumentations.availableInstrumentations?.mcp != null);

// ── Summary ────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed  (${passed + failed} total)`);
console.log(`${'─'.repeat(50)}`);
if (failed > 0) { console.log(`\n  ❌ ${failed} FAILURES\n`); process.exit(1); }
else { console.log('\n  ✅ All checks passed.\n'); }
await provider.shutdown();
