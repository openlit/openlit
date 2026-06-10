/**
 * MCP Instrumentation — comprehensive smoke test.
 *
 * Covers all 15+ patch functions across Client (6), ClientSession (2),
 * Server (5), Transports (6 endpoints), and ServerSession (3 operations).
 * Validates semantic conventions, span attributes, mcp.* namespace, and
 * metrics infrastructure.
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

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let passed = 0, failed = 0;

function check(label, ok, detail) {
  if (ok) { passed++; }
  else    { failed++; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ' — MISSING'}`); }
}

function lastSpan() { const s = exporter.getFinishedSpans(); return s[s.length - 1]; }

async function test(label, run) {
  const before = exporter.getFinishedSpans().length;
  try { await run(); } catch {}
  await new Promise(r => setTimeout(r, 10));
  const after = exporter.getFinishedSpans().length;
  const span = lastSpan();
  check(label + ' (span)', after > before && span != null, span ? span.name : 'no span emitted');
}

// ===========================================================================
// 1. CLIENT METHODS (6)
// ===========================================================================
await test('callTool',               () => patch(mkFn(() => ({ content: [] })), wrapper.patchCallTool)({ name: 'echo' }));
await test('callTool error',         async () => { try { await patch(mkFn(() => { throw new Error('fail'); }), wrapper.patchCallTool)({ name: 'bad' }); } catch {} });
await test('listTools',              () => patch(mkFn(() => ({ tools: [{ name: 't1' }] })), wrapper.patchListTools)());
await test('getPrompt',              () => patch(mkFn(() => ({ messages: [] })), wrapper.patchGetPrompt)({ name: 'greet' }));
await test('listPrompts',            () => patch(mkFn(() => ({ prompts: [] })), wrapper.patchListPrompts)());
await test('readResource',           () => patch(mkFn(() => ({ contents: [{ text: 'ok' }] })), wrapper.patchReadResource)({ uri: 'file:///test' }));
await test('listResources',          () => patch(mkFn(() => ({ resources: [] })), wrapper.patchListResources)());

// ===========================================================================
// 2. CLIENT SESSION (2)
// ===========================================================================
await test('session sendRequest',    () => patch(mkFn(() => ({ jsonrpc: '2.0', id: 1, result: {} })), wrapper.patchClientSessionSendRequest)({ method: 'tools/call', params: {} }));
await test('session initialize',     () => patch(mkFn(() => ({ protocolVersion: '2024-11-05', capabilities: {} })), wrapper.patchClientSessionInitialize)({ protocolVersion: '2024-11-05' }));

// ===========================================================================
// 3. SERVER METHODS (5)
// ===========================================================================
await test('server.run',              () => patch(mkFn(() => {}), wrapper.patchServerRun)());
await test('server.callTool',         () => patch(mkFn(() => ({ content: [] })), wrapper.patchServerCallTool)({ name: 'srvTool' }));
await test('server.listTools',        () => patch(mkFn(() => ({ tools: [] })), wrapper.patchServerListTools)());
await test('server.readResource',     () => patch(mkFn(() => ({ contents: [] })), wrapper.patchServerReadResource)({ uri: 'file:///srv' }));
await test('server.listResources',    () => patch(mkFn(() => ({ resources: [] })), wrapper.patchServerListResources)());

// ===========================================================================
// 4. TRANSPORTS (6 endpoints)
// ===========================================================================
const transports = [
  ['stdio_client',  'transport stdio_client'],
  ['stdio_server',  'transport stdio_server'],
  ['sse_client',    'transport sse_client'],
  ['sse_server',    'transport sse_server'],
  ['http_client',   'transport http_client'],
  ['http_server',   'transport http_server'],
];
for (const [, ep] of transports) {
  await test(`transport ${ep}`, () => {
    const patcher = wrapper.patchTransport(ep, tracer, VER);
    return patcher(mkFn(() => {}))();
  });
}

// ===========================================================================
// 5. SERVER SESSION (3 operations)
// ===========================================================================
await test('serversession send_request',      () => { const p = wrapper.patchServerSessionOperation('send_request', tracer, VER); return p(mkFn(() => ({})))(); });
await test('serversession send_notification', () => { const p = wrapper.patchServerSessionOperation('send_notification', tracer, VER); return p(mkFn(() => ({})))(); });
await test('serversession send_log_message',  () => { const p = wrapper.patchServerSessionOperation('send_log_message', tracer, VER); return p(mkFn(() => ({})))(); });

await new Promise(r => setTimeout(r, 200));
const allSpans = exporter.getFinishedSpans();

// ===========================================================================
// 6. SPAN NAMING & KIND VERIFICATION
// ===========================================================================
// Client spans
check('span: mcp tools/call',         !!allSpans.find(s => s.name === 'mcp tools/call'));
check('span: mcp tools/list',         !!allSpans.find(s => s.name === 'mcp tools/list'));
check('span: mcp prompts/get',        !!allSpans.find(s => s.name === 'mcp prompts/get'));
check('span: mcp prompts/list',       !!allSpans.find(s => s.name === 'mcp prompts/list'));
check('span: mcp resources/read',     !!allSpans.find(s => s.name === 'mcp resources/read'));
check('span: mcp resources/list',     !!allSpans.find(s => s.name === 'mcp resources/list'));
// ClientSession spans
check('span: mcp transport/request',  !!allSpans.find(s => s.name === 'mcp transport/request'));
check('span: mcp initialize',         !!allSpans.find(s => s.name === 'mcp initialize'));
// Server spans
check('span: mcp server/run',         !!allSpans.find(s => s.name === 'mcp server/run'));
check('span: server tools/call',      !!allSpans.find(s => s.name === 'mcp tools/call' && s.attributes['mcp.operation.name'] === 'tools_call' && s.kind === 1));
check('span: server tools/list',      !!allSpans.find(s => s.name === 'mcp tools/list' && s.kind === 1));
check('span: server resources/read',  !!allSpans.find(s => s.name === 'mcp resources/read' && s.kind === 1));
check('span: server resources/list',  !!allSpans.find(s => s.name === 'mcp resources/list' && s.kind === 1));
// Transport spans (all 6 merge into 3 distinct names: stdio, sse, http)
check('span: mcp transport/stdio',    !!allSpans.find(s => s.name === 'mcp transport/stdio'));
check('span: mcp transport/sse',      !!allSpans.find(s => s.name === 'mcp transport/sse'));
check('span: mcp transport/http',     !!allSpans.find(s => s.name === 'mcp transport/http'));
// ServerSession spans
check('span: mcp server/send_request',      !!allSpans.find(s => s.name === 'mcp server/send_request'));
check('span: mcp server/send_notification', !!allSpans.find(s => s.name === 'mcp server/send_notification'));
check('span: mcp server/send_log_message',  !!allSpans.find(s => s.name === 'mcp server/send_log_message'));

// ===========================================================================
// 7. ATTRIBUTE VERIFICATION
// ===========================================================================
const toolSpan = allSpans.find(s => s.name === 'mcp tools/call' && s.attributes['mcp.tool.name'] === 'echo');
check('attr: mcp.tool.name = echo',          toolSpan?.attributes['mcp.tool.name'] === 'echo');
check('attr: mcp.operation.name present',    toolSpan?.attributes['mcp.operation.name'] != null);

const resSpan = allSpans.find(s => s.name === 'mcp resources/read' && s.attributes['mcp.resource.uri']);
check('attr: mcp.resource.uri = file:///test', resSpan?.attributes['mcp.resource.uri'] === 'file:///test');

const promptSpan = allSpans.find(s => s.name === 'mcp prompts/get');
check('attr: mcp.prompt.name present',       promptSpan?.attributes['mcp.prompt.name'] != null);

const errSpan = allSpans.find(s => s.attributes['mcp.error.message']);
check('attr: mcp.error.message on error',    errSpan != null);

const transportSpan = allSpans.find(s => s.name === 'mcp transport/stdio');
check('attr: mcp.transport.type on transport', transportSpan?.attributes['mcp.transport.type'] != null);
check('attr: transport span kind CLIENT',    transportSpan?.kind === 2); // SpanKind.CLIENT

const serverRunSpan = allSpans.find(s => s.name === 'mcp server/run');
check('attr: server span kind SERVER',       serverRunSpan?.kind === 1); // SpanKind.SERVER

// ===========================================================================
// 8. NAMESPACE — all custom attrs use mcp.* (not gen_ai.*)
// ===========================================================================
const allKeys = allSpans.flatMap(s => Object.keys(s.attributes));
const badKeys = allKeys.filter(k => k.startsWith('gen_ai.') && !k.startsWith('gen_ai.system'));
check('namespace: 0 gen_ai.* keys',          badKeys.length === 0,
  badKeys.length === 0 ? 'all mcp.*' : `BAD: ${badKeys.join(', ')}`);

// ===========================================================================
// 9. SEMANTIC CONVENTIONS — all MCP_* constants defined
// ===========================================================================
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
  // Metric semconv constants
  'MCP_REQUESTS', 'MCP_CLIENT_OPERATION_DURATION', 'MCP_CLIENT_OPERATION_DURATION_METRIC',
  'MCP_RESPONSE_SIZE', 'MCP_RESPONSE_SIZE_METRIC', 'MCP_REQUEST_SIZE', 'MCP_TOOL_CALLS',
  'MCP_RESOURCE_READS', 'MCP_PROMPT_GETS', 'MCP_TRANSPORT_USAGE', 'MCP_ERRORS',
  'MCP_OPERATION_SUCCESS_RATE',
];
for (const name of required) {
  check(`semconv: ${name}`, semconv[name] != null, semconv[name] || 'undefined');
}

// ===========================================================================
// 10. METRICS INFRASTRUCTURE
// ===========================================================================
const Metrics = require('./dist/otel/metrics').default;
check('metrics: Metrics class exists',        typeof Metrics === 'function');
check('metrics: initializeMetrics method',    typeof Metrics.initializeMetrics === 'function');

// recordMCPMetrics uses ?. calls — verify it completes without throw
let recordOk = false;
try {
  wrapper.recordMCPMetrics({
    mcpOperation: 'tools_call', mcpMethod: 'callTool', mcpTransportType: 'stdio',
    toolName: 'test', duration: 0.1, requestSize: 100, responseSize: 200, isError: false,
  });
  recordOk = true;
} catch (e) { recordOk = false; }
check('metrics: recordMCPMetrics safe call',  recordOk);

// ===========================================================================
// 11. INSTRUMENTATION REGISTRY & TYPES
// ===========================================================================
const MCPInstrumentation = require('./dist/instrumentation/mcp').default;
const instr = new MCPInstrumentation();
check('registry: instrumentationName "mcp"',  instr.instrumentationName.includes('mcp'));
check('registry: version 1.0.0',              instr.instrumentationVersion === '1.0.0');

const Instrumentations = require('./dist/instrumentation').default;
const hasMCP = Instrumentations.availableInstrumentations?.mcp;
check('registry: MCP in Instrumentations map', hasMCP != null);

// ===========================================================================
// SUMMARY
// ===========================================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed  (${passed + failed} total)`);
console.log(`${'='.repeat(50)}\n`);
if (failed > 0) process.exit(1);
else console.log('  ✅ All checks passed.\n');
await provider.shutdown();
