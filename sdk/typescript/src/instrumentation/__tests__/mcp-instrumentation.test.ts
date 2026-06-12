/**
 * Integration tests for MCP instrumentation.
 *
 * Mirrors how a real user wires OpenLIT: register an OTel SDK provider, call
 * `Openlit.init()` (which auto-registers the MCP instrumentation), and assert
 * spans flow into the provider's exporter. The in-memory exporter is only the
 * sink we read assertions from — the same role the OTLP collector plays in the
 * openinference / openllmetry MCP tests.
 */

import { context, trace, SpanContext } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
} from '@opentelemetry/sdk-trace-node';
import { defaultResource } from '@opentelemetry/resources';
import Openlit from '../../index';
import Tracing from '../../otel/tracing';
import Instrumentations from '../index';
import SemanticConvention from '../../semantic-convention';

const memoryExporter = new InMemorySpanExporter();

describe('MCP instrumentation integration', () => {
  beforeAll(() => {
    // Register an SDK provider first, exactly like an app that already has OTel
    // set up. Openlit.init() must reuse this provider so spans reach our sink.
    const provider = new NodeTracerProvider({
      resource: defaultResource(),
      spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
    });
    provider.register();

    Tracing.resetForTesting();
    Openlit.init({
      applicationName: 'mcp-test',
      environment: 'test',
      otlpEndpoint: 'http://localhost:4318',
      disableBatch: true,
      disableMetrics: false,
      disableEvents: true,
      captureMessageContent: true,
    });
  });

  beforeEach(() => {
    memoryExporter.reset();
  });

  it('reuses the host-registered provider via Openlit.init()', () => {
    expect(Tracing.traceProvider).toBeDefined();
  });

  it('creates mcp tools/call and mcp initialize spans for a real in-memory session', async () => {
    const clientModule = await import('@modelcontextprotocol/sdk/client/index.js');
    const serverModule = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const inMemoryModule = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { InMemoryTransport } = inMemoryModule;
    const { McpServer } = serverModule;
    const { z } = await import('zod/v3');

    // Under Jest, require-in-the-middle (auto-instrumentation) does not fire, so
    // patch the imported modules with the MCP instance Openlit.init() registered
    // (already wired to the reused provider). This is the documented manualPatch
    // fallback for environments where module hooks don't apply.
    const mcp = Instrumentations.availableInstrumentations.mcp;
    mcp.manualPatch(clientModule);
    mcp.manualPatch(serverModule);
    mcp.manualPatch(inMemoryModule); // transport hooks for context propagation

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    server.registerTool(
      'echo',
      {
        description: 'Echo tool',
        inputSchema: { message: z.string() },
      },
      async ({ message }) => ({
        content: [{ type: 'text' as const, text: message }],
      }),
    );

    await server.connect(serverTransport);

    const client = new clientModule.Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    );

    await client.connect(clientTransport);
    await client.callTool({ name: 'echo', arguments: { message: 'hello' } });
    await client.close();
    await server.close();

    await new Promise((resolve) => setTimeout(resolve, 50));

    const spans = memoryExporter.getFinishedSpans();
    const spanNames = spans.map((s) => s.name);

    expect(spanNames).toContain('mcp initialize');
    expect(spanNames).toContain('mcp tools/call');

    // McpServer.connect delegates to Server.connect; ensure exactly one server span.
    const serverRunSpans = spanNames.filter((n) => n === 'mcp server/run');
    expect(serverRunSpans).toHaveLength(1);

    const toolSpan = spans.find((s) => s.name === 'mcp tools/call');
    expect(toolSpan?.attributes[SemanticConvention.MCP_TOOL_NAME]).toBe('echo');
    expect(toolSpan?.attributes[SemanticConvention.MCP_OPERATION]).toBe('tools_call');
    // mcp.method is the JSON-RPC wire method, not the tool name.
    expect(toolSpan?.attributes[SemanticConvention.MCP_METHOD]).toBe('tools/call');
    expect(toolSpan?.attributes[SemanticConvention.MCP_JSONRPC_VERSION]).toBe('2.0');
    expect(toolSpan?.attributes[SemanticConvention.MCP_SERVER_NAME]).toBe('test-server');
    expect(toolSpan?.attributes[SemanticConvention.MCP_TOOL_ARGUMENTS]).toContain('hello');
  });

  it('propagates trace context from client to server across the transport', async () => {
    const clientModule = await import('@modelcontextprotocol/sdk/client/index.js');
    const serverModule = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const inMemoryModule = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { InMemoryTransport } = inMemoryModule;
    const { McpServer } = serverModule;
    const { z } = await import('zod/v3');

    const mcp = Instrumentations.availableInstrumentations.mcp;
    mcp.manualPatch(clientModule);
    mcp.manualPatch(serverModule);
    mcp.manualPatch(inMemoryModule);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const server = new McpServer(
      { name: 'test-server', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    let serverSideContext: SpanContext | undefined;
    server.registerTool(
      'echo',
      { description: 'Echo tool', inputSchema: { message: z.string() } },
      async ({ message }) => {
        serverSideContext = trace.getSpanContext(context.active());
        return { content: [{ type: 'text' as const, text: message }] };
      },
    );
    await server.connect(serverTransport);

    const client = new clientModule.Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(clientTransport);
    await client.callTool({ name: 'echo', arguments: { message: 'hello' } });
    await client.close();
    await server.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const toolSpan = memoryExporter
      .getFinishedSpans()
      .find((s) => s.name === 'mcp tools/call');

    // The server handler ran under the client tools/call span's trace.
    expect(serverSideContext).toBeDefined();
    expect(serverSideContext?.traceId).toBe(toolSpan?.spanContext().traceId);
    expect(serverSideContext?.spanId).toBe(toolSpan?.spanContext().spanId);
  });
});
