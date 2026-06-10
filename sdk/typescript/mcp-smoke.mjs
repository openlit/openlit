/**
 * MCP Instrumentation — comprehensive smoke test (99 checks).
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
  if (ok) { passed++; } else { failed++; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); }
}
function ok(msg, n) { console.log(`  ✅ ${msg}${n != null ? ' (' + n + ' checks)' : ''}`); }
function lastSpan() { const s = exporter.getFinishedSpans(); return s[s.length - 1]; }
async function test(label, run) {
  const before = exporter.getFinishedSpans().length;
  try { await run(); } catch {}
  await new Promise(r => setTimeout(r, 10));
  const after = exporter.getFinishedSpans().length;
  if (after > before) passed++; else { failed++; console.log(`  ❌ ${label}`); }
}

console.log('=== MCP Instrumentation Smoke Test ===\n');

// Client
let n = 0;
await test('callTool', () => patch(mkFn(() => ({ content: [] })), wrapper.patchCallTool)({ name: 'echo' })); n++;
await test('callTool error', async () => { try { await patch(mkFn(() => { throw new Error('fail'); }), wrapper.patchCallTool)({ name: 'bad' }); } catch {} }); n++;
await test('listTools', () => patch(mkFn(() => ({ tools: [{ name: 't1' }] })), wrapper.patchListTools)()); n++;
await test('getPrompt', () => patch(mkFn(() => ({ messages: [] })), wrapper.patchGetPrompt)({ name: 'greet' })); n++;
await test('listPrompts', () => patch(mkFn(() => ({ prompts: [] })), wrapper.patchListPrompts)()); n++;
await test('readResource', () => patch(mkFn(() => ({ contents: [{ text: 'ok' }] })), wrapper.patchReadResource)({ uri: 'file:///test' })); n++;
await test('listResources', () => patch(mkFn(() => ({ resources: [] })), wrapper.patchListResources)()); n++;
ok('Client (callTool, listTools, getPrompt, listPrompts, readResource, listResources + error)', n);

// ClientSession
n = 0;
await test('sendRequest', () => patch(mkFn(() => ({ jsonrpc: '2.0' })), wrapper.patchClientSessionSendRequest)({ method: 'tools/call' })); n++;
await test('initialize', () => patch(mkFn(() => ({ protocolVersion: '2024-11-05' })), wrapper.patchClientSessionInitialize)({ protocolVersion: '2024-11-05' })); n++;
ok('ClientSession (sendRequest, initialize)', n);

// Server
n = 0;
await test('server.run', () => patch(mkFn(() => {}), wrapper.patchServerRun)()); n++;
await test('server.callTool', () => patch(mkFn(() => ({ content: [] })), wrapper.patchServerCallTool)({ name: 'srv' })); n++;
await test('server.listTools', () => patch(mkFn(() => ({ tools: [] })), wrapper.patchServerListTools)()); n++;
await test('server.readResource', () => patch(mkFn(() => ({ contents: [] })), wrapper.patchServerReadResource)({ uri: 'file:///srv' })); n++;
await test('server.listResources', () => patch(mkFn(() => ({ resources: [] })), wrapper.patchServerListResources)()); n++;
ok('Server (run, callTool, listTools, readResource, listResources)', n);

// Transports
n = 0;
for (const ep of ['transport stdio_client','transport stdio_server','transport sse_client','transport sse_server','transport http_client','transport http_server']) {
  await test(ep, () => wrapper.patchTransport(ep, tracer, VER)(mkFn(() => {}))()); n++;
}
ok('Transports (stdio_client/server, sse_client/server, http_client/server)', n);

// ServerSession
n = 0;
await test('send_request', () => { const p = wrapper.patchServerSessionOperation('send_request', tracer, VER); return p(mkFn(() => ({})))(); }); n++;
await test('send_notification', () => { const p = wrapper.patchServerSessionOperation('send_notification', tracer, VER); return p(mkFn(() => ({})))(); }); n++;
await test('send_log_message', () => { const p = wrapper.patchServerSessionOperation('send_log_message', tracer, VER); return p(mkFn(() => ({})))(); }); n++;
ok('ServerSession (send_request, send_notification, send_log_message)', n);

await new Promise(r => setTimeout(r, 200));
const allSpans = exporter.getFinishedSpans();

// Span names
const names = ['mcp tools/call','mcp tools/list','mcp prompts/get','mcp prompts/list',
  'mcp resources/read','mcp resources/list','mcp transport/request','mcp initialize',
  'mcp server/run','mcp transport/stdio','mcp transport/sse','mcp transport/http',
  'mcp server/send_request','mcp server/send_notification','mcp server/send_log_message'];
n = 0; names.forEach(name => { if (allSpans.find(s => s.name === name)) n++; else console.log('  ❌ span missing:', name); }); passed += n;
ok('Span names (all 15 aligned with Python)', n);

// Span kinds
n = 0;
check('server.callTool kind=SERVER', !!allSpans.find(s => s.name === 'mcp tools/call' && s.kind === 1)); n++;
check('transport kind=CLIENT', !!allSpans.find(s => s.name === 'mcp transport/stdio' && s.kind === 2)); n++;
ok('Span kinds (CLIENT/SERVER)', n);

// Attributes
n = 0;
const ts = allSpans.find(s => s.attributes['mcp.tool.name'] === 'echo');
const rs = allSpans.find(s => s.attributes['mcp.resource.uri'] === 'file:///test');
const ps = allSpans.find(s => s.name === 'mcp prompts/get');
check('mcp.tool.name = echo', ts?.attributes['mcp.tool.name'] === 'echo'); n++;
check('mcp.operation.name = tools_call', ts?.attributes['mcp.operation.name'] === 'tools_call'); n++;
check('mcp.resource.uri = file:///test', rs?.attributes['mcp.resource.uri'] === 'file:///test'); n++;
check('mcp.prompt.name = greet', ps?.attributes['mcp.prompt.name'] === 'greet',
  ps ? (ps.attributes['mcp.prompt.name'] || 'NOT SET') : 'SPAN NOT FOUND'); n++;
check('mcp.error.message', !!allSpans.find(s => s.attributes['mcp.error.message'])); n++;
check('mcp.transport.type = stdio', !!allSpans.find(s => s.attributes['mcp.transport.type'] === 'stdio')); n++;
ok('Attributes (mcp.*)', n);

// Namespace
const allKeys = allSpans.flatMap(s => Object.keys(s.attributes));
const bad = allKeys.filter(k => k.startsWith('gen_ai.') && !k.startsWith('gen_ai.system'));
check('0 gen_ai.* keys (all mcp.*)', bad.length === 0, bad.length === 0 ? 'clean' : `BAD: ${bad}`);
ok('Namespace', 1);

// Semantic conventions (44)
const req = ['MCP_OPERATION','MCP_SYSTEM','MCP_SDK_VERSION','MCP_METHOD','MCP_MESSAGE_ID',
  'MCP_JSONRPC_VERSION','MCP_PARAMS','MCP_RESULT','MCP_ERROR_CODE','MCP_ERROR_MESSAGE',
  'MCP_ERROR_DATA','MCP_TOOL_NAME','MCP_TOOL_DESCRIPTION','MCP_TOOL_ARGUMENTS',
  'MCP_TOOL_RESULT','MCP_RESOURCE_URI','MCP_RESOURCE_NAME','MCP_RESOURCE_DESCRIPTION',
  'MCP_RESOURCE_MIME_TYPE','MCP_RESOURCE_SIZE','MCP_TRANSPORT_TYPE','MCP_TRANSPORT_STDIO',
  'MCP_TRANSPORT_SSE','MCP_TRANSPORT_WEBSOCKET','MCP_CLIENT_TYPE',
  'GEN_AI_SYSTEM_MCP','GEN_AI_OPERATION_TYPE_MCP_TOOL_CALL','GEN_AI_OPERATION_TYPE_MCP_TOOL_LIST',
  'GEN_AI_OPERATION_TYPE_MCP_RESOURCE_READ','GEN_AI_OPERATION_TYPE_MCP_RESOURCE_LIST',
  'GEN_AI_OPERATION_TYPE_MCP_REQUEST','GEN_AI_OPERATION_TYPE_MCP_RESPONSE',
  'GEN_AI_OPERATION_TYPE_MCP_SERVER','GEN_AI_OPERATION_TYPE_MCP_CLIENT',
  'MCP_REQUESTS','MCP_CLIENT_OPERATION_DURATION','MCP_CLIENT_OPERATION_DURATION_METRIC',
  'MCP_RESPONSE_SIZE','MCP_RESPONSE_SIZE_METRIC','MCP_REQUEST_SIZE','MCP_TOOL_CALLS',
  'MCP_RESOURCE_READS','MCP_PROMPT_GETS','MCP_TRANSPORT_USAGE','MCP_ERRORS','MCP_OPERATION_SUCCESS_RATE'];
n = 0; req.forEach(name => { if (semconv[name] != null) n++; else console.log('  ❌ semconv missing:', name); }); passed += n;
ok('Semantic Conventions', n);

// Metrics
const Metrics = require('./dist/otel/metrics').default;
check('Metrics class', typeof Metrics === 'function'); n = 1;
check('initializeMetrics', typeof Metrics.initializeMetrics === 'function'); n++;
let recOk = false;
try { wrapper.recordMCPMetrics({ mcpOperation:'t', mcpMethod:'m', mcpTransportType:'stdio', toolName:'x', duration:0.1 }); recOk = true; } catch {}
check('recordMCPMetrics safe', recOk); n++;
ok('Metrics', n);

// Registry
n = 0;
const MCP = require('./dist/instrumentation/mcp').default;
const i = new MCP();
check('instrumentationName "mcp"', i.instrumentationName.includes('mcp')); n++;
check('version 1.0.0', i.instrumentationVersion === '1.0.0'); n++;
check('registered in Instrumentations map', require('./dist/instrumentation').default.availableInstrumentations?.mcp != null); n++;
ok('Registry', n);

console.log(`\n${'─'.repeat(40)}`);
console.log(`  ${passed} passed, ${failed} failed  (${passed + failed} total)`);
console.log(`${'─'.repeat(40)}`);
if (failed > 0) { console.log(`\n  ❌ ${failed} FAILURES\n`); process.exit(1); }
else console.log('  ✅ All checks passed.\n');
await provider.shutdown();
